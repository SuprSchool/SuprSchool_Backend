import { sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import type { QueueClient } from '../../platform/queue/queue-client.js';
import type { QueueMessage } from '../../platform/queue/queue-message.js';
import { diaryNotificationQueue } from './diary-published.message.js';
import type { DiaryPublishedPayload } from './diary-published.message.js';

type DiaryTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface DiaryOutboxWriter {
  writeInTransaction(
    transaction: DiaryTransaction,
    message: QueueMessage<DiaryPublishedPayload>,
  ): Promise<void>;
}

interface DiaryOutboxRow {
  dispatch_attempts: number;
  event_type: 'diary.published';
  id: string;
  occurred_at: Date | string;
  payload: DiaryPublishedPayload;
  school_id: string;
}

export class DiaryOutbox implements DiaryOutboxWriter {
  public constructor(private readonly database: Database) {}

  public async writeInTransaction(
    transaction: DiaryTransaction,
    message: QueueMessage<DiaryPublishedPayload>,
  ): Promise<void> {
    await transaction.execute(sql`
      insert into public.diary_outbox_events (
        id,
        school_id,
        event_type,
        payload,
        occurred_at
      )
      values (
        ${message.eventId}::uuid,
        ${message.schoolId}::uuid,
        ${message.eventType},
        ${JSON.stringify(message.payload)}::jsonb,
        ${message.occurredAt}::timestamptz
      )
      on conflict (id) do nothing
    `);
  }

  public async dispatchPending(queue: QueueClient, limit = 25): Promise<void> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new RangeError('Diary outbox dispatch limit must be between 1 and 50');
    }

    for (const event of await this.claimPending(limit)) {
      try {
        await queue.enqueue(diaryNotificationQueue, toQueueMessage(event));
        await this.markDispatched(event.id);
      } catch {
        await this.markEnqueueFailed(event.id);
      }
    }
  }

  private async claimPending(limit: number): Promise<ReadonlyArray<DiaryOutboxRow>> {
    const rows = await this.database.execute(sql<DiaryOutboxRow>`
      with pending as (
        select id
        from public.diary_outbox_events
        where dispatched_at is null
          and (locked_until is null or locked_until <= now())
        order by occurred_at, id
        limit ${limit}
        for update skip locked
      )
      update public.diary_outbox_events event
      set locked_until = now() + interval '60 seconds'
      from pending
      where event.id = pending.id
      returning
        event.id,
        event.school_id,
        event.event_type,
        event.payload,
        event.occurred_at,
        event.dispatch_attempts
    `);

    return rows as unknown as ReadonlyArray<DiaryOutboxRow>;
  }

  private async markDispatched(eventId: string): Promise<void> {
    await this.database.execute(sql`
      update public.diary_outbox_events
      set dispatched_at = now(),
          locked_until = null
      where id = ${eventId}::uuid
        and dispatched_at is null
    `);
  }

  private async markEnqueueFailed(eventId: string): Promise<void> {
    await this.database.execute(sql`
      update public.diary_outbox_events
      set dispatch_attempts = dispatch_attempts + 1,
          locked_until = null
      where id = ${eventId}::uuid
        and dispatched_at is null
    `);
  }
}

function toQueueMessage(event: DiaryOutboxRow): QueueMessage<DiaryPublishedPayload> {
  return {
    eventId: event.id,
    eventType: event.event_type,
    occurredAt: event.occurred_at instanceof Date
      ? event.occurred_at.toISOString()
      : event.occurred_at,
    payload: event.payload,
    schoolId: event.school_id,
    schemaVersion: 1,
  };
}
