import { Router } from 'express';

import { createChatController } from '../controllers/chat.controller.js';
import type { AuthenticationMiddleware } from '../middleware/authenticate.js';
import type { ChatService } from '../services/chat.service.js';

export function createChatRouter(service: ChatService, authenticate: AuthenticationMiddleware): Router {
  const router = Router();
  const controller = createChatController(service);
  router.get('/rooms', authenticate, controller.listRooms);
  router.get('/rooms/:roomId/messages', authenticate, controller.listMessages);
  router.post('/rooms/:roomId/messages', authenticate, controller.sendMessage);
  // One upload path, shared by the student and teacher composers.
  router.post(
    '/rooms/:roomId/attachments/upload-sessions',
    authenticate,
    controller.createAttachmentUploadSession,
  );
  router.post('/rooms/:roomId/read', authenticate, controller.markRead);
  router.post('/rooms/:roomId/typing', authenticate, controller.publishTyping);
  return router;
}
