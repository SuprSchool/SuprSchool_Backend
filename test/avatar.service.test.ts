import { describe, expect, it, vi } from 'vitest';

import {
  AvatarService,
  CacheAvatarRateLimiter,
  createAvatarCleanupDispatchHandler,
  createAvatarCleanupHandler,
  type AvatarCleanupIntentStore,
  type AvatarProfileStore,
  type AvatarRateLimiter,
} from '../src/services/avatar.service.js';
import type { CacheStore } from '../src/platform/cache/cache-store.js';
import type { QueueClient } from '../src/platform/queue/queue-client.js';
import {
  StorageService,
  UploadSessionIneligibleError,
  type StorageService as StorageServiceType,
} from '../src/platform/storage/storage-service.js';
import { createStorageCleanupHandler } from '../src/config/platform-dependencies.js';
import { QUEUE_NAMES } from '../src/platform/queue/queue-policy.js';

const identity = {
  schoolId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
};

describe('AvatarService', () => {
  it('creates an owner-bound session only after the avatar upload limit allows it', async () => {
    const storage = {
      createUploadSession: vi.fn().mockResolvedValue({
        expiresAt: '2026-07-13T12:00:00.000Z',
        id: 'session-2',
        objectPath: `${identity.schoolId}/avatar/${identity.userId}/session-2`,
        signedUploadUrl: 'https://storage.example.test/upload',
      }),
    } as unknown as StorageService;
    const limiter: AvatarRateLimiter = { consume: vi.fn().mockResolvedValue(true) };
    const service = new AvatarService({
      limiter,
      profiles: { setUploadedAvatar: vi.fn() },
      queue: { enqueue: vi.fn() } as unknown as QueueClient,
      storage,
    });

    const result = await service.createUploadSession(identity, {
      contentType: 'image/webp',
      sizeBytes: 1024,
    });

    expect(limiter.consume).toHaveBeenCalledWith(identity);
    expect(storage.createUploadSession).toHaveBeenCalledWith(identity, {
      bucket: 'avatars',
      contentType: 'image/webp',
      parentId: identity.userId,
      parentType: 'avatar',
      sizeBytes: 1024,
    });
    expect(result).toEqual({
      expiresAt: '2026-07-13T12:00:00.000Z',
      id: 'session-2',
      objectPath: `${identity.schoolId}/avatar/${identity.userId}/session-2`,
      signedUploadUrl: 'https://storage.example.test/upload',
    });
  });

  it('rejects an unsupported avatar image before creating a session', async () => {
    const storage = { createUploadSession: vi.fn() } as unknown as StorageService;
    const service = new AvatarService({
      limiter: { consume: vi.fn().mockResolvedValue(true) },
      profiles: { setUploadedAvatar: vi.fn() },
      queue: { enqueue: vi.fn() } as unknown as QueueClient,
      storage,
    });

    await expect(service.createUploadSession(identity, {
      contentType: 'image/gif',
      sizeBytes: 1024,
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });

    expect(storage.createUploadSession).not.toHaveBeenCalled();
  });

  it('rejects session creation when the distributed avatar limit is exhausted', async () => {
    const storage = { createUploadSession: vi.fn() } as unknown as StorageService;
    const service = new AvatarService({
      limiter: { consume: vi.fn().mockResolvedValue(false) },
      profiles: { setUploadedAvatar: vi.fn() },
      queue: { enqueue: vi.fn() } as unknown as QueueClient,
      storage,
    });

    await expect(service.createUploadSession(identity, {
      contentType: 'image/jpeg',
      sizeBytes: 1024,
    })).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });

    expect(storage.createUploadSession).not.toHaveBeenCalled();
  });

  it('enforces ten avatar session creations per user in one hour', async () => {
    const now = new Date('2026-07-13T10:00:00.000Z');
    const cache = {
      get: vi.fn().mockResolvedValue(JSON.stringify({
        count: 10,
        resetAt: '2026-07-13T11:00:00.000Z',
      })),
      set: vi.fn(),
      delete: vi.fn(),
      withLock: vi.fn().mockImplementation(async (_key, _ttl, work) => work()),
    } as unknown as CacheStore;
    const limiter = new CacheAvatarRateLimiter(cache, () => now);

    await expect(limiter.consume(identity)).resolves.toBe(false);

    expect(cache.withLock).toHaveBeenCalledTimes(1);
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('treats an already-deleted stale avatar object as successful cleanup', async () => {
    const objectPath = `${identity.schoolId}/avatar/${identity.userId}/session-1`;
    const storage = {
      deleteObjectIfExists: vi.fn().mockResolvedValue(false),
    } as unknown as StorageService;
    const cleanupIntents: AvatarCleanupIntentStore = {
      claimForCleanup: vi.fn().mockResolvedValue({
        id: '44444444-4444-4444-8444-444444444444',
        objectPath,
        schoolId: identity.schoolId,
        userId: identity.userId,
      }),
      completeCleanup: vi.fn(),
      listPendingCleanup: vi.fn(),
    };
    const handler = createAvatarCleanupHandler(storage, cleanupIntents);

    await expect(handler({
      eventId: '33333333-3333-4333-8333-333333333333',
      eventType: 'avatar.cleanup',
      occurredAt: '2026-07-13T10:00:00.000Z',
      schoolId: identity.schoolId,
      schemaVersion: 1,
      payload: {
        intentId: '44444444-4444-4444-8444-444444444444',
      },
    }, { providerIdempotencyKey: '33333333-3333-4333-8333-333333333333' })).resolves.toBeUndefined();

    expect(storage.deleteObjectIfExists).toHaveBeenCalledWith(
      'avatars',
      objectPath,
    );
    expect(cleanupIntents.completeCleanup).toHaveBeenCalledWith('44444444-4444-4444-8444-444444444444');
  });

  it('does not delete a replayed cleanup intent when its avatar is current again', async () => {
    const storage = {
      deleteObjectIfExists: vi.fn().mockResolvedValue(true),
    } as unknown as StorageService;
    const cleanupIntents: AvatarCleanupIntentStore = {
      claimForCleanup: vi.fn().mockResolvedValue(null),
      completeCleanup: vi.fn(),
      listPendingCleanup: vi.fn(),
    };
    const handler = createAvatarCleanupHandler(storage, cleanupIntents);

    await expect(handler({
      eventId: '33333333-3333-4333-8333-333333333333',
      eventType: 'avatar.cleanup',
      occurredAt: '2026-07-13T10:00:00.000Z',
      schoolId: identity.schoolId,
      schemaVersion: 1,
      payload: { intentId: '44444444-4444-4444-8444-444444444444' },
    }, { providerIdempotencyKey: '33333333-3333-4333-8333-333333333333' })).resolves.toBeUndefined();

    expect(cleanupIntents.claimForCleanup).toHaveBeenCalledWith(
      '44444444-4444-4444-8444-444444444444',
    );
    expect(storage.deleteObjectIfExists).not.toHaveBeenCalled();
  });

  it('rejects confirmation of a superseded session before it can restore an old avatar', async () => {
    const sessions = {
      confirm: vi.fn(),
      create: vi.fn(),
      deleteExpiredPending: vi.fn(),
      find: vi.fn().mockResolvedValue({
        bucket: 'avatars',
        confirmedSessionId: '44444444-4444-4444-8444-444444444444',
        contentType: 'image/png',
        expiresAt: '2026-07-13T12:00:00.000Z',
        id: '44444444-4444-4444-8444-444444444444',
        objectPath: `${identity.schoolId}/avatar/${identity.userId}/session-1`,
        parentId: identity.userId,
        parentType: 'avatar',
        schoolId: identity.schoolId,
        sizeBytes: 1024,
        status: 'superseded' as const,
        userId: identity.userId,
      }),
      findExpiredPending: vi.fn(),
    };
    const inspector = { inspect: vi.fn() };
    const storage = new StorageService(
      { createSignedReadUrl: vi.fn(), createSignedUploadUrl: vi.fn() },
      sessions as never,
      { avatars: { allowedContentTypes: ['image/png'], maxSizeBytes: 2 * 1024 * 1024 } },
      { authorize: vi.fn() },
      inspector,
    );

    await expect(storage.confirmUpload(identity, '44444444-4444-4444-8444-444444444444'))
      .rejects.toBeInstanceOf(UploadSessionIneligibleError);

    expect(inspector.inspect).not.toHaveBeenCalled();
    expect(sessions.confirm).not.toHaveBeenCalled();
  });

  it('leaves a persisted cleanup intent retryable when queue delivery fails', async () => {
    const objectPath = `${identity.schoolId}/avatar/${identity.userId}/session-1`;
    const storage = {
      assertUploadReady: vi.fn().mockResolvedValue({
        id: 'session-2',
        objectPath: `${identity.schoolId}/avatar/${identity.userId}/session-2`,
      }),
      createSignedDownloadUrl: vi.fn().mockResolvedValue('https://storage.example.test/avatar?token=short-lived'),
    } as unknown as StorageService;
    const profiles: AvatarProfileStore = {
      setUploadedAvatar: vi.fn().mockResolvedValue({
        cleanupIntentId: '44444444-4444-4444-8444-444444444444',
        previousUploadedPath: objectPath,
      }),
    };
    const queue = {
      enqueue: vi.fn().mockRejectedValueOnce(new Error('temporary queue outage')),
    } as unknown as QueueClient;
    const service = new AvatarService({
      limiter: { consume: vi.fn() },
      profiles,
      queue,
      storage,
    });

    await expect(service.confirmUpload(identity, 'session-2')).resolves.toMatchObject({
      avatar: { kind: 'upload' },
      previousUploadedPath: objectPath,
    });

    expect(profiles.setUploadedAvatar).toHaveBeenCalledTimes(1);
    expect(queue.enqueue).toHaveBeenCalledWith(
      'avatar_cleanup_dispatch',
      expect.objectContaining({ schoolId: identity.schoolId }),
    );
  });

  it('dispatches the same durable cleanup intent again after a failed queue attempt', async () => {
    const cleanupIntents: AvatarCleanupIntentStore = {
      claimForCleanup: vi.fn(),
      completeCleanup: vi.fn(),
      listPendingCleanup: vi.fn().mockResolvedValue([{
        id: '44444444-4444-4444-8444-444444444444',
        objectPath: `${identity.schoolId}/avatar/${identity.userId}/session-1`,
        schoolId: identity.schoolId,
        userId: identity.userId,
      }]),
    };
    const queue = {
      enqueue: vi.fn()
        .mockRejectedValueOnce(new Error('temporary queue outage'))
        .mockResolvedValueOnce(undefined),
    } as unknown as QueueClient;
    const handler = createAvatarCleanupDispatchHandler(cleanupIntents, queue);
    const message = {
      eventId: '55555555-5555-4555-8555-555555555555',
      eventType: 'avatar.cleanup.dispatch',
      occurredAt: '2026-07-13T10:00:00.000Z',
      schoolId: identity.schoolId,
      schemaVersion: 1 as const,
      payload: {},
    };

    await expect(handler(message, { providerIdempotencyKey: message.eventId })).rejects.toThrow('temporary queue outage');
    await expect(handler(message, { providerIdempotencyKey: message.eventId })).resolves.toBeUndefined();

    expect(queue.enqueue).toHaveBeenNthCalledWith(
      2,
      'avatar_cleanup',
      expect.objectContaining({
        eventId: '44444444-4444-4444-8444-444444444444',
        payload: { intentId: '44444444-4444-4444-8444-444444444444' },
      }),
    );
  });

  it('rejects a malformed avatar cleanup job before touching storage', async () => {
    const storage = {
      deleteObjectIfExists: vi.fn().mockResolvedValue(false),
    } as unknown as StorageService;
    const handler = createAvatarCleanupHandler(storage, {
      claimForCleanup: vi.fn(),
      completeCleanup: vi.fn(),
      listPendingCleanup: vi.fn(),
    });

    await expect(handler({
      eventId: '33333333-3333-4333-8333-333333333333',
      eventType: 'avatar.cleanup',
      occurredAt: '2026-07-13T10:00:00.000Z',
      schoolId: identity.schoolId,
      schemaVersion: 1,
      payload: {},
    } as never, { providerIdempotencyKey: '33333333-3333-4333-8333-333333333333' }))
      .rejects.toThrow('Invalid avatar cleanup job');

    expect(storage.deleteObjectIfExists).not.toHaveBeenCalled();
  });

  it('removes an expired pending avatar object before deleting its session record', async () => {
    const session = {
      bucket: 'avatars',
      confirmedSessionId: null,
      contentType: 'image/png',
      expiresAt: '2026-07-13T09:00:00.000Z',
      id: 'session-1',
      objectPath: `${identity.schoolId}/avatar/${identity.userId}/session-1`,
      parentId: identity.userId,
      parentType: 'avatar',
      schoolId: identity.schoolId,
      sizeBytes: 1024,
      status: 'pending' as const,
      userId: identity.userId,
    };
    const sessions = {
      create: vi.fn(),
      find: vi.fn(),
      confirm: vi.fn(),
      findExpiredPending: vi.fn().mockResolvedValue([session]),
      deleteExpiredPending: vi.fn().mockResolvedValue(true),
    };
    const remover = { remove: vi.fn().mockResolvedValue(undefined) };
    const storage = new StorageService(
      { createSignedReadUrl: vi.fn(), createSignedUploadUrl: vi.fn() },
      sessions as never,
      { avatars: { allowedContentTypes: ['image/png'], maxSizeBytes: 2 * 1024 * 1024 } },
      { authorize: vi.fn() },
      {
        inspect: vi.fn().mockResolvedValue({
          bucket: 'avatars',
          contentType: 'image/png',
          objectPath: session.objectPath,
          sizeBytes: 1024,
        }),
      },
      remover,
    );

    await expect(storage.cleanupExpiredPendingSessions(identity.schoolId)).resolves.toBe(1);

    expect(remover.remove).toHaveBeenCalledWith('avatars', [session.objectPath]);
    expect(sessions.deleteExpiredPending).toHaveBeenCalledWith(
      identity.schoolId,
      identity.userId,
      session.id,
    );
  });

  it('keeps the old avatar until a replacement is confirmed', async () => {
    const storage = {
      assertUploadReady: vi.fn().mockResolvedValue({
        id: 'session-2',
        objectPath: `${identity.schoolId}/avatar/${identity.userId}/session-2`,
      }),
      createSignedDownloadUrl: vi.fn().mockResolvedValue('https://storage.example.test/avatar?token=short-lived'),
    } as unknown as StorageService;
    const profiles: AvatarProfileStore = {
      setUploadedAvatar: vi.fn().mockResolvedValue({
        cleanupIntentId: '44444444-4444-4444-8444-444444444444',
        previousUploadedPath: `${identity.schoolId}/avatar/${identity.userId}/session-1`,
      }),
    };
    const queue = { enqueue: vi.fn().mockResolvedValue(undefined) } as unknown as QueueClient;
    const limiter: AvatarRateLimiter = { consume: vi.fn().mockResolvedValue(true) };
    const service = new AvatarService({ limiter, profiles, queue, storage });

    const result = await service.confirmUpload(identity, 'session-2');

    expect(profiles.setUploadedAvatar).toHaveBeenCalledWith(
      identity.userId,
      `${identity.schoolId}/avatar/${identity.userId}/session-2`,
      'session-2',
    );
    expect(result).toEqual({
      avatar: {
        kind: 'upload',
        value: 'https://storage.example.test/avatar?token=short-lived',
      },
      previousUploadedPath: `${identity.schoolId}/avatar/${identity.userId}/session-1`,
    });
    expect(queue.enqueue).toHaveBeenCalledWith(
      'avatar_cleanup_dispatch',
      expect.objectContaining({
        eventType: 'avatar.cleanup.dispatch',
        schoolId: identity.schoolId,
        payload: {},
      }),
    );
  });


  it('does not separately confirm an upload when profile assignment fails', async () => {
    const objectPath = `${identity.schoolId}/avatar/${identity.userId}/session-3`;
    const storage = {
      assertUploadReady: vi.fn().mockResolvedValue({ id: 'session-3', objectPath }),
      confirmUpload: vi.fn(),
    } as unknown as StorageService;
    const profiles: AvatarProfileStore = {
      setUploadedAvatar: vi.fn().mockRejectedValue(new Error('profile transaction failed')),
    };
    const service = new AvatarService({
      limiter: { consume: vi.fn() },
      profiles,
      queue: { enqueue: vi.fn() } as unknown as QueueClient,
      storage,
    });

    await expect(service.confirmUpload(identity, 'session-3')).rejects.toThrow('profile transaction failed');

    expect(storage.assertUploadReady).toHaveBeenCalledWith(identity, 'session-3');
    expect(storage.confirmUpload).not.toHaveBeenCalled();
    expect(profiles.setUploadedAvatar).toHaveBeenCalledWith(identity.userId, objectPath, 'session-3');
  });

  it('returns a signed display URL after atomically assigning an uploaded avatar', async () => {
    const objectPath = `${identity.schoolId}/avatar/${identity.userId}/session-4`;
    const storage = {
      assertUploadReady: vi.fn().mockResolvedValue({ id: 'session-4', objectPath }),
      createSignedDownloadUrl: vi.fn().mockResolvedValue('https://storage.example.test/avatar?token=short-lived'),
    } as unknown as StorageService;
    const profiles: AvatarProfileStore = {
      setUploadedAvatar: vi.fn().mockResolvedValue({
        cleanupIntentId: undefined,
        previousUploadedPath: undefined,
      }),
    };
    const service = new AvatarService({
      limiter: { consume: vi.fn() },
      profiles,
      queue: { enqueue: vi.fn() } as unknown as QueueClient,
      storage,
    });

    await expect(service.confirmUpload(identity, 'session-4')).resolves.toEqual({
      avatar: { kind: 'upload', value: 'https://storage.example.test/avatar?token=short-lived' },
      previousUploadedPath: undefined,
    });
    expect(storage.createSignedDownloadUrl).toHaveBeenCalledWith('avatars', objectPath);
  });
  it('does not enqueue cleanup for an idempotent confirmation of the current avatar', async () => {
    const objectPath = `${identity.schoolId}/avatar/${identity.userId}/session-2`;
    const storage = {
      assertUploadReady: vi.fn().mockResolvedValue({ id: 'session-2', objectPath }),
      createSignedDownloadUrl: vi.fn().mockResolvedValue('https://storage.example.test/avatar?token=short-lived'),
    } as unknown as StorageServiceType;
    const profiles: AvatarProfileStore = {
      setUploadedAvatar: vi.fn().mockResolvedValue({
        cleanupIntentId: undefined,
        previousUploadedPath: objectPath,
      }),
    };
    const queue = { enqueue: vi.fn().mockResolvedValue(undefined) } as unknown as QueueClient;
    const service = new AvatarService({
      limiter: { consume: vi.fn() },
      profiles,
      queue,
      storage,
    });

    await service.confirmUpload(identity, 'session-2');

    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('registers the avatar cleanup queue and delegates expired session cleanup to storage', async () => {
    expect(QUEUE_NAMES).toContain('avatar_cleanup');

    const storage = {
      cleanupExpiredPendingSessions: vi.fn().mockResolvedValue(0),
    } as unknown as StorageServiceType;
    const handler = createStorageCleanupHandler(storage);

    await handler({
      eventId: '33333333-3333-4333-8333-333333333333',
      eventType: 'storage.cleanup_expired_sessions',
      occurredAt: '2026-07-13T10:00:00.000Z',
      schoolId: identity.schoolId,
      schemaVersion: 1,
      payload: {},
    }, { providerIdempotencyKey: '33333333-3333-4333-8333-333333333333' });

    expect(storage.cleanupExpiredPendingSessions).toHaveBeenCalledWith(identity.schoolId);
  });
});
