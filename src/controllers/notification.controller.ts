import type { Request, Response } from 'express';

import { AppError } from '../lib/errors.js';
import type { NotificationService } from '../services/notification.service.js';
import { notificationInboxQuerySchema, registerDeviceTokenSchema } from '../types/notification.js';

function identity(request: Request): { schoolId: string; userId: string } {
  if (!request.auth) throw new AppError('UNAUTHORIZED', 401, 'A valid bearer token is required');
  return { schoolId: request.auth.schoolId, userId: request.auth.userId };
}

export function createNotificationController(service: NotificationService) {
  return {
    registerDevice: async (request: Request, response: Response): Promise<void> => {
      const result = await service.registerDeviceToken(identity(request), registerDeviceTokenSchema.parse(request.body));
      response.status(201).json(result);
    },
    listInbox: async (request: Request, response: Response): Promise<void> => {
      const options = notificationInboxQuerySchema.parse(request.query);
      response.status(200).json(await service.listInbox(identity(request), options));
    },
    markRead: async (request: Request, response: Response): Promise<void> => {
      const notificationId = typeof request.params.notificationId === 'string' ? request.params.notificationId : '';
      if (!notificationId) throw new AppError('VALIDATION_ERROR', 400, 'Notification id is required');
      response.status(200).json(await service.markRead(identity(request), notificationId));
    },
  };
}
