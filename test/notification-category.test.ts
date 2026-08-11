import { readFileSync } from 'node:fs';

import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import { DrizzleNotificationRepository } from '../src/db/repositories/notification.repository.js';
import {
  DrizzleAcademicNotificationDeliveryStore,
  NOTIFICATION_EVENT_TYPES,
  createAcademicNotificationHandlers,
  notificationCategory,
} from '../src/platform/academic/academic-notification-delivery.js';
import type { QueueMessage } from '../src/platform/queue/queue-message.js';
import { defaultNotificationCategory, notificationCategoryValues } from '../src/types/notification.js';

const schoolId = '11111111-1111-4111-8111-111111111111';
const eventId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const assignmentId = '44444444-4444-4444-8444-444444444444';

const pgDialect = new PgDialect();

interface RenderedQuery {
  params: readonly unknown[];
  sql: string;
}

function createRecordingDatabase(): {
  database: unknown;
  executed: readonly RenderedQuery[];
} {
  const executed: RenderedQuery[] = [];
  const execute = async (query: unknown): Promise<unknown[]> => {
    const rendered = pgDialect.sqlToQuery(query as SQL);
    executed.push({ params: rendered.params, sql: rendered.sql });
    if (rendered.sql.includes('select distinct user_id')) return [{ user_id: userId }];
    return [];
  };
  return { database: { execute }, executed };
}

function findQuery(executed: readonly RenderedQuery[], fragment: string): RenderedQuery {
  const match = executed.find((query) => query.sql.includes(fragment));
  if (match === undefined) throw new Error(`No executed query contained: ${fragment}`);
  return match;
}

function message(eventType: string): QueueMessage<unknown> {
  return {
    eventId,
    eventType,
    payload: { assignmentId, studentId: userId },
    schoolId,
  } as unknown as QueueMessage<unknown>;
}

async function deliver(eventType: string): Promise<readonly RenderedQuery[]> {
  const { database, executed } = createRecordingDatabase();
  const handlers = createAcademicNotificationHandlers(
    new DrizzleAcademicNotificationDeliveryStore(database as never),
    { send: vi.fn(async () => undefined) },
  );
  await handlers.notification(message(eventType), { providerIdempotencyKey: eventId });
  return executed;
}

describe('notification categories', () => {
  it('resolves a declared category for every notification event type', () => {
    // The category is what picks the card glyph on 268:9469. A type the
    // switch does not cover would throw at dispatch, so totality is the
    // contract, not a nicety.
    for (const eventType of NOTIFICATION_EVENT_TYPES) {
      expect(notificationCategoryValues).toContain(notificationCategory(eventType));
    }
  });

  it('writes the category beside the notification type in the inbox insert', async () => {
    const insert = findQuery(await deliver('assignment.submitted'), 'insert into public.notification_inbox');

    expect(insert.sql).toContain('category');
    expect(insert.params).toContain('assignment');
    expect(insert.params).toContain('assignment.submitted');
  });

  it('reads the category back on the inbox query', async () => {
    const { database, executed } = createRecordingDatabase();
    await new DrizzleNotificationRepository(database as never)
      .listInbox(schoolId, userId, { limit: 30, unreadOnly: false });

    // A column the producer writes and the read never selects is a column
    // the client cannot see.
    expect(findQuery(executed, 'from public.notification_inbox').sql).toContain('category');
  });

  it('lands both grading events on the frame\'s medal card', () => {
    // 268:9469 draws `vuesax/bulk/medal` on "Grade Updated / Your Chemistry
    // Lab Report has been graded". Two event types produce that card.
    expect(notificationCategory('assignment.graded')).toBe('grade-update');
    expect(notificationCategory('exam.results_published')).toBe('grade-update');
  });

  it('keeps the frame\'s six glyphs distinguishable', () => {
    // book / calendar / bell / medal, each from a different category. Folding
    // any pair together would silently collapse two cards into one glyph.
    expect(new Set([
      notificationCategory('assignment.submitted'),
      notificationCategory('exam.published'),
      notificationCategory('announcement.published'),
      notificationCategory('assignment.graded'),
    ]).size).toBe(4);
  });

  it('declares the categories the cake and people cards need', () => {
    // "Birthday Reminder" and "Event Registration Open" have no producer yet.
    // Declaring them is what makes those two glyphs reachable the moment one
    // exists; without the values the client map cannot name them.
    expect(notificationCategoryValues).toContain('birthday');
    expect(notificationCategoryValues).toContain('event-registration');
  });

  it('rejects an event type it has no category for', async () => {
    await expect(deliver('assignment.archived')).rejects.toThrow(/assignment\.archived/);
  });

  it('keeps the declared default and the column default in step', () => {
    // Every pre-S8 row takes the column default without a backfill, so the two
    // defaults drifting apart would silently mis-glyph the entire history.
    const migration = readFileSync('supabase/migrations/20260810140000_notification_category.sql', 'utf8');

    expect(notificationCategoryValues).toContain(defaultNotificationCategory);
    expect(migration).toContain(`default '${defaultNotificationCategory}'`);
    expect(migration).toContain('public.notification_inbox');
  });
});
