import type { Request, Response } from 'express';

import { AppError } from '../lib/errors.js';
import type { ChatService } from '../services/chat.service.js';
import {
  chatMessagesQuerySchema,
  chatRoomParamsSchema,
  chatTypingSchema,
  encodeChatCursor,
  idempotencyKeySchema,
  markChatReadSchema,
  sendChatMessageSchema,
} from '../validators/chat.schemas.js';

function identity(request: Request) {
  if (!request.auth) throw new AppError('UNAUTHORIZED', 401, 'A valid bearer token is required');
  return request.auth;
}

function roomId(request: Request): string {
  return chatRoomParamsSchema.parse(request.params).roomId;
}

export function createChatController(service: ChatService) {
  return {
    listRooms: async (request: Request, response: Response): Promise<void> => {
      response.status(200).json({ rooms: await service.listRooms(identity(request)) });
    },

    listMessages: async (request: Request, response: Response): Promise<void> => {
      const query = chatMessagesQuerySchema.parse(request.query);
      const page = await service.listMessages(
        identity(request),
        roomId(request),
        {
          limit: query.limit,
          ...(query.after === undefined ? {} : { after: query.after }),
          ...(query.before === undefined ? {} : { before: query.before }),
        },
      );
      response.status(200).json({
        items: page.items,
        ...(page.nextCursor ? { nextCursor: encodeChatCursor(page.nextCursor) } : {}),
      });
    },

    sendMessage: async (request: Request, response: Response): Promise<void> => {
      const key = idempotencyKeySchema.parse(request.header('Idempotency-Key'));
      const message = await service.sendMessage(
        identity(request),
        roomId(request),
        key,
        sendChatMessageSchema.parse(request.body),
      );
      response.status(201).json(message);
    },

    markRead: async (request: Request, response: Response): Promise<void> => {
      await service.markRead(
        identity(request),
        roomId(request),
        markChatReadSchema.parse(request.body).lastReadMessageId,
      );
      response.status(204).send();
    },

    publishTyping: async (request: Request, response: Response): Promise<void> => {
      await service.publishTyping(
        identity(request),
        roomId(request),
        chatTypingSchema.parse(request.body).isTyping,
      );
      response.status(204).send();
    },
  };
}
