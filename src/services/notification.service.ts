import { AppError } from '../lib/errors.js';
import type { NotificationRepository } from '../db/repositories/notification.repository.js';
import type { NotificationInboxCursor, NotificationInboxPage, RegisterDeviceTokenInput } from '../types/notification.js';

export type { NotificationRepository } from '../db/repositories/notification.repository.js';

export interface NotificationIdentity { schoolId: string; userId: string }
export interface NotificationService {
  registerDeviceToken(identity: NotificationIdentity, input: RegisterDeviceTokenInput): Promise<{ id: string }>;
  listInbox(identity: NotificationIdentity, options: { cursor?: NotificationInboxCursor | undefined; limit: number; unreadOnly: boolean }): Promise<NotificationInboxPage>;
  markRead(identity: NotificationIdentity, notificationId: string): Promise<{ read: true }>;
}

export function createNotificationService({ repository }: { repository: NotificationRepository }): NotificationService {
  return {
    registerDeviceToken: (identity, input) => repository.registerDeviceToken(identity.schoolId, identity.userId, input),
    listInbox: (identity, options) => repository.listInbox(identity.schoolId, identity.userId, options),
    async markRead(identity, notificationId) {
      if (!await repository.markRead(identity.schoolId, identity.userId, notificationId)) {
        throw new AppError('NOT_FOUND', 404, 'Notification not found');
      }
      return { read: true };
    },
  };
}
