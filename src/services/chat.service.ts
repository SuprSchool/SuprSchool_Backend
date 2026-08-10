import {
  type ChatRepository,
  type ChatTypingPublisher,
} from '../db/repositories/chat.repository.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import type { CacheStore } from '../platform/cache/cache-store.js';
import { tenantCacheKey } from '../platform/cache/cache-store.js';
import {
  IdempotencyConflictError,
  type IdempotencyStore,
} from '../platform/idempotency/idempotency-store.js';
import type {
  ChatAttachmentUploadSession,
  ChatCursorPage,
  ChatIdentity,
  ChatMessageDto,
  ChatMessagePage,
  ChatRoomSummary,
  ConfirmedChatAttachment,
  CreateChatAttachmentUploadInput,
  SendChatMessageInput,
  SignedChatAttachmentRead,
  StoredChatMessage,
} from '../types/chat.js';

export type { ChatRepository } from '../db/repositories/chat.repository.js';

/**
 * The one upload path chat attachments use. Both composers — student
 * `253:11089` and teacher `517:6941` — reach storage through this port, so
 * there is a single place where a session is confirmed before it is committed.
 */
export interface ChatAttachmentFilePort {
  createUpload(
    identity: ChatIdentity,
    roomId: string,
    input: CreateChatAttachmentUploadInput,
  ): Promise<ChatAttachmentUploadSession>;
  confirmUpload(
    identity: ChatIdentity,
    roomId: string,
    uploadSessionId: string,
  ): Promise<ConfirmedChatAttachment>;
  createReadUrl(objectPath: string): Promise<SignedChatAttachmentRead>;
}

export interface ChatService {
  listRooms(identity: ChatIdentity): Promise<readonly ChatRoomSummary[]>;
  listMessages(identity: ChatIdentity, roomId: string, page: ChatCursorPage): Promise<ChatMessagePage>;
  sendMessage(identity: ChatIdentity, roomId: string, key: string, input: SendChatMessageInput): Promise<ChatMessageDto>;
  createAttachmentUploadSession(
    identity: ChatIdentity,
    roomId: string,
    input: CreateChatAttachmentUploadInput,
  ): Promise<ChatAttachmentUploadSession>;
  markRead(identity: ChatIdentity, roomId: string, lastReadMessageId: string): Promise<void>;
  publishTyping(identity: ChatIdentity, roomId: string, isTyping: boolean): Promise<void>;
}

export interface CreateChatServiceDependencies {
  cache: CacheStore;
  files: ChatAttachmentFilePort;
  idempotency: IdempotencyStore;
  repository: ChatRepository;
  typingPublisher: ChatTypingPublisher;
}

const messageLimit = { maximum: 10, windowSeconds: 60 };
const typingLimit = { maximum: 5, windowSeconds: 5 };

export function createChatService({
  cache,
  files,
  idempotency,
  repository,
  typingPublisher,
}: CreateChatServiceDependencies): ChatService {
  /**
   * Object paths stay server-side; a client only ever sees a short-lived
   * signed URL for an attachment it is already allowed to read.
   */
  async function toMessage(stored: StoredChatMessage): Promise<ChatMessageDto> {
    return {
      ...stored,
      attachments: await Promise.all(stored.attachments.map(async (attachment) => {
        const read = await files.createReadUrl(attachment.objectPath);
        return {
          contentType: attachment.contentType,
          expiresAt: read.expiresAt,
          id: attachment.id,
          name: attachment.name,
          signedUrl: read.signedUrl,
          sizeBytes: attachment.sizeBytes,
        };
      })),
    };
  }

  let cacheFailureLogged = false;
  const onCacheUnavailable = (error: unknown): void => {
    if (cacheFailureLogged) return;
    cacheFailureLogged = true;
    logger.warn({
      cacheErrorName: error instanceof Error ? error.name : typeof error,
    }, 'chat rate-limit cache unavailable; allowing the request');
  };

  return {
    async listRooms(identity) {
      const rooms = await repository.listRooms(identity);
      return Promise.all(rooms.map(async (room) => ({
        ...room,
        lastMessage: room.lastMessage === null ? null : await toMessage(room.lastMessage),
      })));
    },

    async listMessages(identity, roomId, page) {
      const access = await repository.assertAccess(identity, roomId);
      const stored = await repository.listMessages(access, page);
      return {
        items: await Promise.all(stored.items.map(toMessage)),
        ...(stored.nextCursor === undefined ? {} : { nextCursor: stored.nextCursor }),
      };
    },

    async createAttachmentUploadSession(identity, roomId, input) {
      // Access is asserted with the caller's role before storage is touched;
      // the upload-session authorizer re-checks it role-free on confirm.
      await repository.assertAccess(identity, roomId);
      return files.createUpload(identity, roomId, input);
    },

    async sendMessage(identity, roomId, key, input) {
      const access = await repository.assertAccess(identity, roomId);
      const request = {
        key: `${roomId}:${key}`,
        requestBody: input,
        schoolId: identity.schoolId,
        userId: identity.userId,
      };
      let claim;
      try {
        claim = await idempotency.claim(request);
      } catch (error) {
        if (error instanceof IdempotencyConflictError) {
          throw new AppError('IDEMPOTENCY_CONFLICT', 409, error.message);
        }
        throw error;
      }
      if (claim.state === 'completed') return claim.response.body as ChatMessageDto;
      if (claim.state === 'in_progress') {
        throw new AppError('IDEMPOTENCY_IN_PROGRESS', 409, 'This message is still being processed');
      }
      if (claim.state === 'expired') {
        const recovered = await repository.findMessageByClientId(access, input.clientMessageId);
        if (recovered) {
          const existing = await toMessage(recovered);
          await idempotency.complete(request, { body: existing, status: 201 });
          return existing;
        }
        try {
          await idempotency.failClosed(request);
        } catch {
          // A later retry with the same key will preserve fail-closed semantics.
        }
        throw new AppError(
          'IDEMPOTENCY_IN_PROGRESS',
          409,
          'This message request expired; retry with a new idempotency key',
        );
      }
      try {
        await enforceLimit(
          cache,
          tenantCacheKey(identity.schoolId, 'chat', 'message', `${identity.userId}:${roomId}`),
          messageLimit,
          'Too many messages. Please try again shortly.',
          onCacheUnavailable,
        );
      } catch (error) {
        await idempotency.release(request);
        throw error;
      }
      const existing = await repository.findMessageByClientId(access, input.clientMessageId);
      let stored = existing;
      if (stored === undefined) {
        // Confirm before commit. A rejected session releases the idempotency
        // claim so the caller can correct the upload and retry with the same
        // key, rather than being told the request is still in progress.
        let attachment: ConfirmedChatAttachment | undefined;
        if (input.attachmentSessionId !== undefined) {
          try {
            attachment = await files.confirmUpload(identity, roomId, input.attachmentSessionId);
          } catch (error) {
            await idempotency.release(request);
            throw error;
          }
        }
        stored = await repository.insertMessage(access, {
          body: input.body,
          clientMessageId: input.clientMessageId,
          ...(attachment === undefined ? {} : { attachment }),
        });
      }
      const message = await toMessage(stored);
      await idempotency.complete(request, { body: message, status: 201 });
      return message;
    },

    async markRead(identity, roomId, lastReadMessageId) {
      const access = await repository.assertAccess(identity, roomId);
      await repository.advanceReadCursor(access, lastReadMessageId);
    },

    async publishTyping(identity, roomId, isTyping) {
      const access = await repository.assertAccess(identity, roomId);
      await enforceLimit(
        cache,
        tenantCacheKey(identity.schoolId, 'chat', 'typing', `${identity.userId}:${roomId}`),
        typingLimit,
        'Too many typing updates. Please try again shortly.',
        onCacheUnavailable,
      );
      await typingPublisher.publishTyping(
        access,
        isTyping,
        new Date(Date.now() + (typingLimit.windowSeconds * 1000)).toISOString(),
      );
    },
  };
}

async function enforceLimit(
  cache: CacheStore,
  key: string,
  limit: { maximum: number; windowSeconds: number },
  message: string,
  onUnavailable: (error: unknown) => void,
): Promise<void> {
  let accepted: boolean | null;
  try {
    accepted = await cache.withLock(`${key}:lock`, limit.windowSeconds, async () => {
      const current = Number.parseInt(await cache.get(key) ?? '0', 10);
      const count = Number.isSafeInteger(current) && current > 0 ? current : 0;
      if (count >= limit.maximum) return false;
      await cache.set(key, String(count + 1), limit.windowSeconds);
      return true;
    });
  } catch (error) {
    // Redis improves distributed limiting, but an outage must not turn every
    // otherwise durable message into a 500. Normal limiting resumes on recovery.
    onUnavailable(error);
    return;
  }
  if (accepted !== true) {
    throw new AppError('RATE_LIMITED', 429, message);
  }
}
