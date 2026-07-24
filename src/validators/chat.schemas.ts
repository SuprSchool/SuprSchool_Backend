import { z } from 'zod';

import type { ChatHistoryCursor } from '../types/chat.js';

const cursorPayloadSchema = z.object({
  createdAt: z.string().datetime({ offset: true }),
  id: z.uuid(),
}).strict();

function decodeCursor(value: string): ChatHistoryCursor {
  const decoded = Buffer.from(value, 'base64url').toString('utf8');
  return cursorPayloadSchema.parse(JSON.parse(decoded));
}

const chatCursorSchema = z.string().min(1).transform((value, context) => {
  try {
    return decodeCursor(value);
  } catch {
    context.addIssue({ code: 'custom', message: 'Use a valid chat cursor' });
    return z.NEVER;
  }
});

export const chatRoomParamsSchema = z.object({ roomId: z.uuid() });

export const chatMessagesQuerySchema = z.object({
  after: chatCursorSchema.optional(),
  before: chatCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).superRefine((value, context) => {
  if (value.before !== undefined && value.after !== undefined) {
    context.addIssue({ code: 'custom', message: 'Use before or after, not both' });
  }
});

export const sendChatMessageSchema = z.object({
  body: z.string().trim().min(1).max(2000),
  clientMessageId: z.uuid(),
}).strict();

export const markChatReadSchema = z.object({ lastReadMessageId: z.uuid() }).strict();

export const chatTypingSchema = z.object({ isTyping: z.boolean() }).strict();

export const idempotencyKeySchema = z.uuid();

export function encodeChatCursor(cursor: ChatHistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export type ChatMessagesQuery = z.infer<typeof chatMessagesQuerySchema>;
export type SendChatMessage = z.infer<typeof sendChatMessageSchema>;
