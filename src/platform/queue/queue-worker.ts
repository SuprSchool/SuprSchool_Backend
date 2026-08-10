import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { logger, safeErrorCause, safeErrorMessage } from '../../lib/logger.js';
import type { QueueClient, QueuedMessage } from './queue-client.js';
import type { QueueMessage } from './queue-message.js';
import { QUEUE_RETRY_POLICIES, type QueueName } from './queue-policy.js';

export type QueueEventOutcome = 'processing' | 'succeeded' | 'failed';

export type ProcessedQueueEventClaim =
  | { status: 'claimed'; attemptToken: string }
  | { status: 'unavailable' };

export interface ProcessedQueueEventStore {
  claim(
    message: QueueMessage<unknown>,
    visibilityTimeoutSeconds: number,
  ): Promise<ProcessedQueueEventClaim>;
  getOutcome(eventId: string): Promise<QueueEventOutcome | undefined>;
  markFailed(eventId: string, attemptToken: string): Promise<boolean>;
  markSucceeded(eventId: string, attemptToken: string): Promise<boolean>;
}

export class DatabaseProcessedQueueEventStore implements ProcessedQueueEventStore {
  constructor(private readonly db: Database) {}

  async claim(
    message: QueueMessage<unknown>,
    visibilityTimeoutSeconds: number,
  ): Promise<ProcessedQueueEventClaim> {
    const attemptToken = randomUUID();
    const rows = await this.db.execute(sql<{ attempt_token: string }>`
      insert into public.processed_queue_events (
        event_id,
        event_type,
        school_id,
        outcome,
        attempt_token,
        lease_expires_at
      )
      values (
        ${message.eventId}::uuid,
        ${message.eventType},
        ${message.schoolId}::uuid,
        'processing',
        ${attemptToken}::uuid,
        now() + (${visibilityTimeoutSeconds} * interval '1 second')
      )
      on conflict (event_id) do update
        set event_type = excluded.event_type,
            school_id = excluded.school_id,
            outcome = 'processing',
            attempt_token = excluded.attempt_token,
            lease_expires_at = excluded.lease_expires_at,
            processed_at = now()
      where public.processed_queue_events.outcome = 'failed'
        or (
          public.processed_queue_events.outcome = 'processing'
          and public.processed_queue_events.lease_expires_at <= now()
        )
      returning attempt_token
    `);
    const row = (rows as unknown as ReadonlyArray<{ attempt_token: string }>)[0];

    return row === undefined
      ? { status: 'unavailable' }
      : { status: 'claimed', attemptToken: row.attempt_token };
  }

  async getOutcome(eventId: string): Promise<QueueEventOutcome | undefined> {
    const rows = await this.db.execute(sql<{ outcome: QueueEventOutcome }>`
      select outcome
      from public.processed_queue_events
      where event_id = ${eventId}::uuid
    `);
    const row = (rows as unknown as ReadonlyArray<{ outcome: QueueEventOutcome }>)[0];

    return row?.outcome;
  }

  async markFailed(eventId: string, attemptToken: string): Promise<boolean> {
    const rows = await this.db.execute(sql<{ event_id: string }>`
      update public.processed_queue_events
      set outcome = 'failed',
          attempt_token = null,
          lease_expires_at = null,
          processed_at = now()
      where event_id = ${eventId}::uuid
        and outcome = 'processing'
        and attempt_token = ${attemptToken}::uuid
      returning event_id
    `);
    return (rows as unknown as ReadonlyArray<{ event_id: string }>).length > 0;
  }

  async markSucceeded(eventId: string, attemptToken: string): Promise<boolean> {
    const rows = await this.db.execute(sql<{ event_id: string }>`
      update public.processed_queue_events
      set outcome = 'succeeded',
          attempt_token = null,
          lease_expires_at = null,
          processed_at = now()
      where event_id = ${eventId}::uuid
        and outcome = 'processing'
        and attempt_token = ${attemptToken}::uuid
      returning event_id
    `);
    return (rows as unknown as ReadonlyArray<{ event_id: string }>).length > 0;
  }
}

export interface QueueExecutionContext {
  readonly providerIdempotencyKey: string;
}

export interface DeadLetterQueueRecord {
  queueName: string;
  messageId: number;
  eventId: string;
  schoolId: string;
  envelope: QueueMessage<unknown>;
  errorCategory: string;
  errorDetail: string;
}

export interface DeadLetterQueueStore {
  record(record: DeadLetterQueueRecord): Promise<void>;
}

export type QueueMessageHandler<TPayload> = (
  message: QueueMessage<TPayload>,
  context: QueueExecutionContext,
) => Promise<void>;

export class QueueWorker {
  constructor(
    private readonly queue: QueueClient,
    private readonly processedEvents: ProcessedQueueEventStore,
    private readonly deadLetters?: DeadLetterQueueStore,
  ) {}

  async drainOnce<TPayload>(
    queueName: string,
    visibilityTimeoutSeconds: number,
    limit: number,
    handler: QueueMessageHandler<TPayload>,
  ): Promise<void> {
    const messages = await this.queue.read<TPayload>(queueName, visibilityTimeoutSeconds, limit);

    for (const queuedMessage of messages) {
      await this.processMessage(queueName, visibilityTimeoutSeconds, queuedMessage, handler);
    }
  }

  private async processMessage<TPayload>(
    queueName: string,
    visibilityTimeoutSeconds: number,
    queuedMessage: QueuedMessage<TPayload>,
    handler: QueueMessageHandler<TPayload>,
  ): Promise<void> {
    const { message, messageId } = queuedMessage;
    const policy = QUEUE_RETRY_POLICIES[queueName as QueueName];
    if (policy === undefined) {
      throw new Error(`No retry policy configured for queue: ${queueName}`);
    }
    if (queuedMessage.readCount > policy.maxAttempts) {
      if (this.deadLetters === undefined) {
        throw new Error('A durable dead-letter store is required for exhausted queue messages');
      }
      await this.deadLetters.record({
        queueName,
        messageId,
        eventId: message.eventId,
        schoolId: message.schoolId,
        envelope: message,
        errorCategory: 'retry_limit_exceeded',
        errorDetail: `Message exceeded ${policy.maxAttempts} attempts (read count: ${queuedMessage.readCount})`,
      });
      await this.queue.archive(queueName, messageId);
      return;
    }
    const claim = await this.processedEvents.claim(message, visibilityTimeoutSeconds);
    if (claim.status === 'unavailable') {
      if ((await this.processedEvents.getOutcome(message.eventId)) === 'succeeded') {
        await this.queue.archive(queueName, messageId);
      }
      return;
    }

    try {
      await handler(message, Object.freeze({ providerIdempotencyKey: message.eventId }));
    } catch (error) {
      // A bare `catch {}` here made every handler defect invisible: the queue
      // grew, nothing was archived, and the worker's output stayed clean. The
      // retry path below is unchanged — only the diagnosis is new.
      logger.error({
        errorCause: safeErrorCause(error),
        errorMessage: safeErrorMessage(error),
        errorName: error instanceof Error ? error.name : typeof error,
        eventId: message.eventId,
        eventType: message.eventType,
        messageId,
        queueName,
        readCount: queuedMessage.readCount,
        schoolId: message.schoolId,
      }, 'queue handler failed');
      await this.processedEvents.markFailed(message.eventId, claim.attemptToken);
      return;
    }

    if (await this.processedEvents.markSucceeded(message.eventId, claim.attemptToken)) {
      await this.queue.archive(queueName, messageId);
    }
  }
}
