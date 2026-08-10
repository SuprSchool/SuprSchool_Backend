import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import { createDiaryPublishedMessage } from '../src/async/diary/diary-published.message.js';
import {
  createAcademicNotificationHandlers,
  DrizzleAcademicNotificationDeliveryStore,
} from '../src/platform/academic/academic-notification-delivery.js';
import type { QueueMessage } from '../src/platform/queue/queue-message.js';
import type { DiaryRecord } from '../src/types/diary.js';

const schoolId = '11111111-1111-4111-8111-111111111111';
const classId = '22222222-2222-4222-8222-222222222222';
const classSubjectId = '33333333-3333-4333-8333-333333333333';
const diaryId = '44444444-4444-4444-8444-444444444444';
const teacherId = '55555555-5555-4555-8555-555555555555';
const studentId = '66666666-6666-4666-8666-666666666666';
const expoPushToken = 'ExponentPushToken[diary-regression]';

const pgDialect = new PgDialect();

const diary: DiaryRecord = {
  classId,
  classSubjectId,
  description: 'We finished the chapter on photosynthesis.',
  id: diaryId,
  keyPoints: ['Chlorophyll', 'Light reaction'],
  occurredOn: '2026-08-10',
  periodLabel: 'Period 3',
  revision: 1,
  schoolId,
  teacherId,
  title: 'Photosynthesis recap',
  updatedAt: '2026-08-10T09:30:00.000Z',
};

interface RenderedQuery {
  params: readonly unknown[];
  sql: string;
}

function createDeliveryDatabase(): {
  database: unknown;
  executed: readonly RenderedQuery[];
} {
  const executed: RenderedQuery[] = [];
  const execute = async (query: unknown): Promise<unknown[]> => {
    const rendered = pgDialect.sqlToQuery(query as SQL);
    executed.push({ params: rendered.params, sql: rendered.sql });

    if (rendered.sql.includes('select distinct user_id')) {
      return [{ user_id: studentId }];
    }
    if (rendered.sql.includes('from public.notification_push_deliveries delivery')) {
      return [{ expo_push_tokens: [expoPushToken], user_id: studentId }];
    }
    return [];
  };

  return { database: { execute }, executed };
}

function findQuery(executed: readonly RenderedQuery[], fragment: string): RenderedQuery {
  const match = executed.find((query) => query.sql.includes(fragment));
  if (match === undefined) throw new Error(`No executed query contained: ${fragment}`);
  return match;
}

async function deliver(message: QueueMessage<unknown>): Promise<{
  executed: readonly RenderedQuery[];
  send: ReturnType<typeof vi.fn>;
}> {
  const { database, executed } = createDeliveryDatabase();
  const send = vi.fn(async () => undefined);
  const handlers = createAcademicNotificationHandlers(
    new DrizzleAcademicNotificationDeliveryStore(database as never),
    { send },
  );

  await handlers.notification(message, { providerIdempotencyKey: message.eventId });
  return { executed, send };
}

describe('diary.published notification delivery', () => {
  it('delivers the message that createDiaryPublishedMessage produces', async () => {
    const message = createDiaryPublishedMessage(diary);

    // Regression: notificationCopy only covered AcademicEventType, so it fell
    // through and returned undefined for diary.published, and the inbox insert
    // died on `copy.title` before any SQL reached the database.
    await expect(deliver(message)).resolves.toBeDefined();
  });

  it('writes diary copy into the inbox insert', async () => {
    const { executed } = await deliver(createDiaryPublishedMessage(diary));
    const insert = findQuery(executed, 'insert into public.notification_inbox');
    const bound = insert.params.filter((param): param is string => typeof param === 'string');

    expect(bound).toContain('diary.published');
    const copy = bound.filter((param) => /\s/.test(param) && !param.startsWith('{'));
    expect(copy.length).toBeGreaterThanOrEqual(2);
    for (const line of copy) expect(line.trim().length).toBeGreaterThan(0);
  });

  it('resolves recipients from the diary class and stays school scoped', async () => {
    const { executed, send } = await deliver(createDiaryPublishedMessage(diary));
    const recipients = findQuery(executed, 'select distinct user_id');

    expect(recipients.sql).toContain('public.class_diary_entries');
    expect(recipients.sql).toContain('public.class_members');
    expect(recipients.params).toContain(diaryId);
    expect(recipients.params).toContain(schoolId);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      expoPushTokens: [expoPushToken],
      userId: studentId,
    }));
  });

  it('rejects an event type it has no copy for instead of reading title off undefined', async () => {
    const message = {
      ...createDiaryPublishedMessage(diary),
      eventType: 'diary.unsupported',
    } as unknown as QueueMessage<unknown>;

    await expect(deliver(message)).rejects.toThrow(/diary\.unsupported/);
  });
});
