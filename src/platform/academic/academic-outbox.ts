import { sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import type { QueueClient } from '../queue/queue-client.js';
import type { QueueMessage } from '../queue/queue-message.js';

export const ACADEMIC_EVENT_TYPES = [
  'announcement.published',
  'assignment.submitted',
  'assignment.graded',
  'assignment.reminder.requested',
  'exam.published',
  'exam.reminder.requested',
  'exam.results_published',
] as const;

export type AcademicEventType = (typeof ACADEMIC_EVENT_TYPES)[number];

export interface AcademicOutboxEvent {
  aggregateId: string;
  aggregateType: string;
  dispatchAttempts: number;
  dispatchedAt: string | null;
  eventType: AcademicEventType;
  id: string;
  lockedUntil: string | null;
  occurredAt: string;
  payload: Record<string, string>;
  schoolId: string;
}

export interface AcademicOutboxWrite {
  aggregateId: string;
  aggregateType: string;
  eventType: AcademicEventType;
  payload: Record<string, string>;
}

interface AcademicOutboxRow {
  aggregate_id: string;
  aggregate_type: string;
  dispatch_attempts: number;
  dispatched_at: Date | string | null;
  event_type: AcademicEventType;
  id: string;
  locked_until: Date | string | null;
  occurred_at: Date | string;
  payload: Record<string, string>;
  school_id: string;
}

export class AcademicOutbox {
  public constructor(private readonly database: Database) {}

  public async write(
    identity: { schoolId: string },
    event: AcademicOutboxWrite,
  ): Promise<void> {
    await this.writeInTransaction(this.database, identity, event);
  }

  public async writeInTransaction(
    transaction: Database,
    identity: { schoolId: string },
    event: AcademicOutboxWrite,
  ): Promise<void> {
    await transaction.execute(sql`
      insert into public.academic_outbox_events (
        school_id,
        event_type,
        aggregate_type,
        aggregate_id,
        payload
      )
      values (
        ${identity.schoolId}::uuid,
        ${event.eventType},
        ${event.aggregateType},
        ${event.aggregateId}::uuid,
        ${JSON.stringify(event.payload)}::jsonb
      )
    `);
  }

  public async claimPending(limit = 50): Promise<ReadonlyArray<AcademicOutboxEvent>> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new RangeError('Academic outbox claim limit must be between 1 and 50');
    }
    const rows = await this.database.execute(sql<AcademicOutboxRow>`
      with pending as (
        select id
        from public.academic_outbox_events
        where dispatched_at is null
          and (locked_until is null or locked_until <= now())
        order by occurred_at, id
        limit ${limit}
        for update skip locked
      )
      update public.academic_outbox_events event
      set locked_until = now() + interval '60 seconds'
      from pending
      where event.id = pending.id
      returning
        event.id,
        event.school_id,
        event.event_type,
        event.aggregate_type,
        event.aggregate_id,
        event.payload,
        event.occurred_at,
        event.dispatched_at,
        event.dispatch_attempts,
        event.locked_until
    `);
    return (rows as unknown as ReadonlyArray<AcademicOutboxRow>).map(toEvent);
  }

  public async markDispatched(eventId: string): Promise<void> {
    await this.database.execute(sql`
      update public.academic_outbox_events
      set dispatched_at = now(),
          locked_until = null
      where id = ${eventId}::uuid
        and dispatched_at is null
    `);
  }

  public async markEnqueueFailed(eventId: string): Promise<void> {
    await this.database.execute(sql`
      update public.academic_outbox_events
      set dispatch_attempts = dispatch_attempts + 1
      where id = ${eventId}::uuid
        and dispatched_at is null
    `);
  }

  public async dispatchPending(queue: QueueClient): Promise<void> {
    const pending = await this.claimPending(50);
    for (const event of pending) {
      try {
        await queue.enqueue(academicQueueName(event.eventType), toQueueMessage(event));
        await this.markDispatched(event.id);
      } catch {
        await this.markEnqueueFailed(event.id);
      }
    }
  }
}

export function academicQueueName(eventType: AcademicEventType): 'notification_dispatch' | 'reminder_dispatch' {
  return eventType === 'assignment.reminder.requested' || eventType === 'exam.reminder.requested'
    ? 'reminder_dispatch'
    : 'notification_dispatch';
}

export function toQueueMessage(event: AcademicOutboxEvent): QueueMessage<Record<string, string>> {
  return {
    eventId: event.id,
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    payload: event.payload,
    schoolId: event.schoolId,
    schemaVersion: 1,
  };
}

function toEvent(row: AcademicOutboxRow): AcademicOutboxEvent {
  return {
    aggregateId: row.aggregate_id,
    aggregateType: row.aggregate_type,
    dispatchAttempts: row.dispatch_attempts,
    dispatchedAt: toIso(row.dispatched_at),
    eventType: row.event_type,
    id: row.id,
    lockedUntil: toIso(row.locked_until),
    occurredAt: toIso(row.occurred_at) ?? new Date(0).toISOString(),
    payload: row.payload,
    schoolId: row.school_id,
  };
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}
