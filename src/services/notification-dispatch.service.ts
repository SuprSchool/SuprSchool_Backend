import type { QueueExecutionContext, QueueMessageHandler } from '../platform/queue/queue-worker.js';
import type { NotificationDispatchRepository } from '../db/repositories/notification.repository.js';
import type { NotificationDispatchPayload } from '../types/notification.js';
import type { ExpoPushGateway } from './expo-push.gateway.js';

const expoBatchSize = 100;

export function createNotificationDispatchHandler({ repository, gateway }: { repository: NotificationDispatchRepository; gateway: ExpoPushGateway }): QueueMessageHandler<NotificationDispatchPayload> {
  return async (message, context: QueueExecutionContext): Promise<void> => {
    const tokens = await repository.listActiveExpoTokens(message.schoolId, message.payload.recipientId);
    for (let offset = 0; offset < tokens.length; offset += expoBatchSize) {
      await gateway.send(tokens.slice(offset, offset + expoBatchSize), message.payload, {
        idempotencyKey: `${context.providerIdempotencyKey}:${offset / expoBatchSize}`,
      });
    }
  };
}
