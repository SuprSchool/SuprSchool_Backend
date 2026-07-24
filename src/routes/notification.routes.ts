import { Router } from 'express';

import { createNotificationController } from '../controllers/notification.controller.js';
import type { AuthenticationMiddleware } from '../middleware/authenticate.js';
import type { NotificationService } from '../services/notification.service.js';

export function createNotificationRouter(service: NotificationService, authenticate: AuthenticationMiddleware): Router {
  const router = Router();
  const controller = createNotificationController(service);
  router.post('/devices', authenticate, controller.registerDevice);
  router.get('/inbox', authenticate, controller.listInbox);
  router.post('/inbox/:notificationId/read', authenticate, controller.markRead);
  return router;
}
