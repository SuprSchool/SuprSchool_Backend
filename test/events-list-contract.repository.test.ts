import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import type { Database } from '../src/db/client.js';
import { DrizzleEventsRepository } from '../src/db/repositories/drizzle-events.repository.js';
import type { EventPage, EventSummary } from '../src/types/events.js';

const schoolId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const teacherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const otherTeacherId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const studentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const eventId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const classId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const dialect = new PgDialect();

type RecordedQuery = { params: unknown[]; sql: string };

class RecordingDatabase {
  public readonly queries: RecordedQuery[] = [];

  public constructor(private readonly result: unknown[] = []) {}

  public readonly execute = async (query: unknown): Promise<unknown[]> => {
    const rendered = dialect.sqlToQuery(query as SQL);
    this.queries.push({ params: [...rendered.params], sql: rendered.sql });
    return this.result;
  };

  public asDatabase(): Database {
    return this as unknown as Database;
  }
}

function eventRow() {
  return {
    activityKind: 'event',
    audienceType: 'classes',
    category: 'Workshop',
    createdAt: '2026-08-01T10:00:00.000000Z',
    createdByTeacherId: otherTeacherId,
    description: null,
    eligibilityCriteria: null,
    endsAt: null,
    genderEligibility: 'mixed',
    id: eventId,
    lifecycle: 'published',
    participationMode: null,
    registrationDeadlineAt: '2026-08-19T10:00:00.000000Z',
    resultsPublishedAt: null,
    resultsRevision: 0,
    rulesAndRegulations: null,
    startsAt: '2026-08-20T10:00:00.000000Z',
    targetClassIds: [classId],
    title: 'Science fair',
    venue: 'Main Hall',
  };
}

describe('event list contract', () => {
  it('uses mutually exclusive open-unregistered, open-registered, and completed student predicates', async () => {
    const database = new RecordingDatabase();
    const repository = new DrizzleEventsRepository(database.asDatabase());

    for (const filter of ['trending', 'registered', 'completed'] as const) {
      await repository.listStudentEvents(
        { schoolId, userId: studentId },
        { cursor: undefined, filter, limit: 25 },
      );
    }

    for (const query of database.queries) {
      const normalizedSql = query.sql.replace(/\s+/g, ' ');
      expect(normalizedSql).toContain(
        "e.lifecycle = 'published' and coalesce(e.ends_at, e.starts_at) >= now() and registration.id is null",
      );
      expect(normalizedSql).toContain(
        "e.lifecycle = 'published' and coalesce(e.ends_at, e.starts_at) >= now() and registration.id is not null",
      );
      expect(normalizedSql).toContain(
        "e.lifecycle = 'completed' or coalesce(e.ends_at, e.starts_at) < now()",
      );
    }
  });

  it('returns authoritative ownership and target classes in teacher list summaries', async () => {
    const database = new RecordingDatabase([eventRow()]);
    const repository = new DrizzleEventsRepository(database.asDatabase());

    const page = await repository.listTeacherEvents(
      { schoolId, userId: teacherId },
      { cursor: undefined, limit: 25, scope: 'all', status: undefined },
    ) as EventPage<EventSummary>;

    const normalizedQuery = database.queries[0]?.sql.replace(/\s+/g, ' ');
    expect(normalizedQuery).not.toContain("or ( = 'upcoming'");
    expect(database.queries[0]?.params).not.toContain(undefined);
    expect(page.items).toEqual([
      expect.objectContaining({
        isOwned: false,
        targetClassIds: [classId],
      }),
    ]);
  });
});
