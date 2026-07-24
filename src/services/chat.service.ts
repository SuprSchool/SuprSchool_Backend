import {
  type ChatRepository,
  type ChatTypingPublisher,
} from '../db/repositories/chat.repository.js';
import { AppError } from '../lib/errors.js';
import type { CacheStore } from '../platform/cache/cache-store.js';
import { tenantCacheKey } from '../platform/cache/cache-store.js';
import {
  IdempotencyConflictError,
  type IdempotencyStore,
} from '../platform/idempotency/idempotency-store.js';
import type {
  ChatCursorPage,
  ChatIdentity,
  ChatMessageDto,
  ChatMessagePage,
  ChatRoomSummary,
  CreateChatMessageInput,
} from '../types/chat.js';

export type { ChatRepository } from '../db/repositories/chat.repository.js';

export interface ChatService {
  listRooms(identity: ChatIdentity): Promise<readonly ChatRoomSummary[]>;
  listMessages(identity: ChatIdentity, roomId: string, page: ChatCursorPage): Promise<ChatMessagePage>;
  sendMessage(identity: ChatIdentity, roomId: string, key: string, input: CreateChatMessageInput): Promise<ChatMessageDto>;
  markRead(identity: ChatIdentity, roomId: string, lastReadMessageId: string): Promise<void>;
  publishTyping(identity: ChatIdentity, roomId: string, isTyping: boolean): Promise<void>;
}

export interface CreateChatServiceDependencies {
  cache: CacheStore;
  idempotency: IdempotencyStore;
  repository: ChatRepository;
  typingPublisher: ChatTypingPublisher;
}

const messageLimit = { maximum: 10, windowSeconds: 60 };
const typingLimit = { maximum: 5, windowSeconds: 5 };

export function createChatService({
  cache,
  idempotency,
  repository,
  typingPublisher,
}: CreateChatServiceDependencies): ChatService {
  return {
    listRooms: (identity) => repository.listRooms(identity),

    async listMessages(identity, roomId, page) {
      const access = await repository.assertAccess(identity, roomId);
      return repository.listMessages(access, page);
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
        const existing = await repository.findMessageByClientId(access, input.clientMessageId);
        if (existing) {
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
        );
      } catch (error) {
        await idempotency.release(request);
        throw error;
      }
      const existing = await repository.findMessageByClientId(access, input.clientMessageId);
      const message = existing ?? await repository.insertMessage(access, input);
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
): Promise<void> {
  const accepted = await cache.withLock(`${key}:lock`, limit.windowSeconds, async () => {
    const current = Number.parseInt(await cache.get(key) ?? '0', 10);
    const count = Number.isSafeInteger(current) && current > 0 ? current : 0;
    if (count >= limit.maximum) return false;
    await cache.set(key, String(count + 1), limit.windowSeconds);
    return true;
  });
  if (accepted !== true) {
    throw new AppError('RATE_LIMITED', 429, message);
  }
}
