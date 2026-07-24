import { randomUUID } from 'node:crypto';

import { AppError } from '../lib/errors.js';
import { tenantCacheKey, type CacheStore } from '../platform/cache/cache-store.js';
import type { QueueClient } from '../platform/queue/queue-client.js';
import type { QueueMessageHandler } from '../platform/queue/queue-worker.js';
import type { StorageService, UploadSessionIdentity } from '../platform/storage/storage-service.js';
import type { CreatedUploadSession } from '../platform/storage/upload-session.js';
import type { ProfileAvatar } from '../types/profile.js';

export const AVATAR_BUCKET = 'avatars';
export const AVATAR_PARENT_TYPE = 'avatar';
export const AVATAR_MAX_SIZE_BYTES = 2 * 1024 * 1024;
export const AVATAR_ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const AVATAR_UPLOAD_LIMIT_PER_HOUR = 10;
export const AVATAR_UPLOAD_WINDOW_SECONDS = 60 * 60;
const AVATAR_RATE_LIMIT_LOCK_SECONDS = 5;

export interface AvatarProfileStore {
  setUploadedAvatar(
    userId: string,
    objectPath: string,
    sessionId: string,
  ): Promise<{
    cleanupIntentId: string | undefined;
    previousUploadedPath: string | undefined;
  } | null>;
}

export interface AvatarRateLimiter {
  consume(identity: UploadSessionIdentity): Promise<boolean>;
}

export interface AvatarUploadRequest {
  contentType: string;
  sizeBytes: number;
}

interface AvatarRateWindow {
  count: number;
  resetAt: string;
}

export class CacheAvatarRateLimiter implements AvatarRateLimiter {
  public constructor(
    private readonly cache: CacheStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async consume(identity: UploadSessionIdentity): Promise<boolean> {
    const key = tenantCacheKey(
      identity.schoolId,
      'avatar',
      'upload-rate',
      identity.userId,
    );
    const outcome = await this.cache.withLock(
      `${key}:lock`,
      AVATAR_RATE_LIMIT_LOCK_SECONDS,
      async () => {
        const now = this.now();
        const current = toRateWindow(await this.cache.get(key));
        const resetAtMilliseconds = current === undefined ? 0 : Date.parse(current.resetAt);
        const active = current !== undefined && resetAtMilliseconds > now.getTime();
        if (active && current.count >= AVATAR_UPLOAD_LIMIT_PER_HOUR) {
          return false;
        }

        const next: AvatarRateWindow = active
          ? { count: current.count + 1, resetAt: current.resetAt }
          : {
            count: 1,
            resetAt: new Date(
              now.getTime() + AVATAR_UPLOAD_WINDOW_SECONDS * 1_000,
            ).toISOString(),
          };
        const ttlSeconds = Math.max(
          1,
          Math.ceil((Date.parse(next.resetAt) - now.getTime()) / 1_000),
        );
        await this.cache.set(key, JSON.stringify(next), ttlSeconds);
        return true;
      },
    );

    return outcome ?? false;
  }
}

export interface AvatarServiceDependencies {
  limiter: AvatarRateLimiter;
  profiles: AvatarProfileStore;
  queue: QueueClient;
  storage: StorageService;
}

export interface ConfirmedAvatarUpload {
  avatar: ProfileAvatar;
  previousUploadedPath: string | undefined;
}

export interface AvatarCleanupPayload {
  intentId: string;
}

export interface AvatarObjectCleaner {
  deleteObjectIfExists(bucket: string, objectPath: string): Promise<boolean>;
}

export interface AvatarCleanupIntent {
  id: string;
  objectPath: string;
  schoolId: string;
  userId: string;
}

export interface AvatarCleanupIntentStore {
  claimForCleanup(intentId: string): Promise<AvatarCleanupIntent | null>;
  completeCleanup(intentId: string): Promise<void>;
  listPendingCleanup(schoolId: string, limit: number): Promise<ReadonlyArray<AvatarCleanupIntent>>;
}

export class AvatarService {
  public constructor(
    private readonly dependencies: AvatarServiceDependencies,
    private readonly createId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async createUploadSession(
    identity: UploadSessionIdentity,
    request: AvatarUploadRequest,
  ): Promise<CreatedUploadSession> {
    if (!AVATAR_ALLOWED_CONTENT_TYPES.includes(request.contentType as typeof AVATAR_ALLOWED_CONTENT_TYPES[number])) {
      throw new AppError('VALIDATION_ERROR', 400, 'Avatar image type must be JPEG, PNG, or WebP');
    }
    if (
      !Number.isSafeInteger(request.sizeBytes)
      || request.sizeBytes <= 0
      || request.sizeBytes > AVATAR_MAX_SIZE_BYTES
    ) {
      throw new AppError('VALIDATION_ERROR', 400, 'Avatar image must be no larger than 2 MiB');
    }
    if (!await this.dependencies.limiter.consume(identity)) {
      throw new AppError('RATE_LIMITED', 429, 'Too many avatar uploads. Please try again later.');
    }

    return this.dependencies.storage.createUploadSession(identity, {
      bucket: AVATAR_BUCKET,
      contentType: request.contentType,
      parentId: identity.userId,
      parentType: AVATAR_PARENT_TYPE,
      sizeBytes: request.sizeBytes,
    });
  }

  public async confirmUpload(
    identity: UploadSessionIdentity,
    sessionId: string,
  ): Promise<ConfirmedAvatarUpload> {
    const session = await this.dependencies.storage.assertUploadReady(identity, sessionId);
    const result = await this.dependencies.profiles.setUploadedAvatar(
      identity.userId,
      session.objectPath,
      session.id,
    );
    if (result === null) {
      throw new AppError('NOT_FOUND', 404, 'Profile not found');
    }

    if (result.cleanupIntentId !== undefined) {
      try {
        await this.dependencies.queue.enqueue('avatar_cleanup_dispatch', {
        eventId: this.createId(),
        eventType: 'avatar.cleanup.dispatch',
        occurredAt: this.now().toISOString(),
        schoolId: identity.schoolId,
        schemaVersion: 1,
          payload: {},
        });
      } catch {
        // The profile transaction already persisted the intent; the scheduled
        // dispatcher will retry it without making the confirmed avatar fail.
      }
    }

    const displayUrl = await this.dependencies.storage.createSignedDownloadUrl(
      AVATAR_BUCKET,
      session.objectPath,
    );

    return {
      avatar: { kind: 'upload', value: displayUrl },
      previousUploadedPath: result.previousUploadedPath,
    };
  }
}

export function createAvatarCleanupHandler(
  storage: AvatarObjectCleaner,
  cleanupIntents: AvatarCleanupIntentStore,
): QueueMessageHandler<unknown> {
  return async (message): Promise<void> => {
    if (!isAvatarCleanupPayload(message.payload)) {
      throw new Error('Invalid avatar cleanup job');
    }
    const intent = await cleanupIntents.claimForCleanup(message.payload.intentId);
    if (intent === null) return;
    await storage.deleteObjectIfExists(AVATAR_BUCKET, intent.objectPath);
    await cleanupIntents.completeCleanup(intent.id);
  };
}

export function createAvatarCleanupDispatchHandler(
  cleanupIntents: AvatarCleanupIntentStore,
  queue: QueueClient,
): QueueMessageHandler<unknown> {
  return async (message): Promise<void> => {
    const intents = await cleanupIntents.listPendingCleanup(message.schoolId, 100);
    for (const intent of intents) {
      await queue.enqueue('avatar_cleanup', {
        eventId: intent.id,
        eventType: 'avatar.cleanup',
        occurredAt: new Date().toISOString(),
        schoolId: intent.schoolId,
        schemaVersion: 1,
        payload: { intentId: intent.id },
      });
    }
  };
}

function isAvatarCleanupPayload(value: unknown): value is AvatarCleanupPayload {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { intentId?: unknown }).intentId === 'string'
    && (value as { intentId: string }).intentId.length > 0;
}

function toRateWindow(value: string | null): AvatarRateWindow | undefined {
  if (value === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === 'object'
      && parsed !== null
      && Number.isSafeInteger((parsed as { count?: unknown }).count)
      && (parsed as { count: number }).count >= 0
      && typeof (parsed as { resetAt?: unknown }).resetAt === 'string'
      && Number.isFinite(Date.parse((parsed as { resetAt: string }).resetAt))
    ) {
      return parsed as AvatarRateWindow;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
