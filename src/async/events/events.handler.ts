import type { QueueMessage } from '../../platform/queue/queue-message.js';
import type { QueueExecutionContext, QueueMessageHandler } from '../../platform/queue/queue-worker.js';

export const eventsDomainEventTypes = [
  'events.created',
  'events.updated',
  'events.archived',
  'events.registration.created',
  'events.team.created',
  'events.teams.replaced',
  'events.managers.replaced',
  'events.scores.updated',
  'events.participation.tagged',
  'events.results.published',
] as const;

export type EventsDomainEventType = (typeof eventsDomainEventTypes)[number];

export interface EventsDomainQueuePayload {
  eventId: string;
  [key: string]: unknown;
}

export interface EventsDomainEventConsumer {
  handle(
    message: QueueMessage<EventsDomainQueuePayload>,
    context: QueueExecutionContext,
  ): Promise<void>;
}

function isEventsDomainEventType(value: string): value is EventsDomainEventType {
  return (eventsDomainEventTypes as readonly string[]).includes(value);
}

/**
 * The generic QueueWorker owns duplicate-delivery claims. This handler only
 * accepts the Events outbox contract and delegates a successfully claimed
 * message, leaving notification/cache/score side effects to future consumers.
 */
export function createEventsHandler(
  consumer: EventsDomainEventConsumer,
): QueueMessageHandler<EventsDomainQueuePayload> {
  return async (
    message: QueueMessage<EventsDomainQueuePayload>,
    context: QueueExecutionContext,
  ): Promise<void> => {
    if (!isEventsDomainEventType(message.eventType)) {
      throw new Error(`Unsupported Events domain event type: ${message.eventType}`);
    }
    if (typeof message.payload.eventId !== 'string' || message.payload.eventId.length === 0) {
      throw new Error('Events domain queue messages require an event id');
    }
    await consumer.handle(message, context);
  };
}
