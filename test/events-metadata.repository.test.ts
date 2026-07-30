import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import type { Database } from '../src/db/client.js';
import { DrizzleEventsRepository } from '../src/db/repositories/drizzle-events.repository.js';

const schoolId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const teacherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const eventId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const dialect = new PgDialect();

type RecordedQuery = { params: unknown[]; sql: string };

class RecordingDatabase {
  public readonly queries: RecordedQuery[] = [];

  public constructor(private readonly respond: (query: RecordedQuery) => unknown[]) {}

  public readonly execute = async (query: unknown): Promise<unknown[]> => {
    const rendered = dialect.sqlToQuery(query as SQL);
    const recorded = { params: [...rendered.params], sql: rendered.sql };
    this.queries.push(recorded);
    return this.respond(recorded);
  };

  public readonly transaction = async <T>(
    callback: (transaction: { execute(query: unknown): Promise<unknown[]> }) => Promise<T>,
  ): Promise<T> => callback({ execute: this.execute });

  public asDatabase(): Database {
    return this as unknown as Database;
  }
}

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    activityKind: 'event',
    audienceType: 'school',
    category: 'Workshop',
    createdAt: '2026-08-01T10:00:00.000000Z',
    createdByTeacherId: teacherId,
    description: 'Description',
    eligibilityCriteria: null,
    endsAt: null,
    genderEligibility: 'female',
    id: eventId,
    lifecycle: 'draft',
    participationMode: null,
    registrationDeadlineAt: '2026-08-19T10:00:00.000000Z',
    resultsPublishedAt: null,
    resultsRevision: 0,
    rulesAndRegulations: 'Bring school identification.',
    startsAt: '2026-08-20T10:00:00.000000Z',
    targetClassIds: [],
    title: 'Science fair',
    venue: 'Main Hall',
    ...overrides,
  };
}

describe('DrizzleEventsRepository event metadata', () => {
  it('round-trips gender, rules, and the required deadline when creating an event', async () => {
    const database = new RecordingDatabase((query) => {
      if (query.sql.includes('insert into public.events')) return [{ id: eventId }];
      if (query.sql.includes('select') && query.sql.includes('from public.events e join public.user_roles role')) {
        return [eventRow()];
      }
      return [];
    });
    const repository = new DrizzleEventsRepository(database.asDatabase());

    const created = await repository.createEvent({ schoolId, userId: teacherId }, eventId, {
      activityKind: 'event',
      audienceType: 'school',
      genderEligibility: 'female',
      registrationDeadlineAt: '2026-08-19T10:00:00.000Z',
      rulesAndRegulations: 'Bring school identification.',
      startsAt: '2026-08-20T10:00:00.000Z',
      targetClassIds: [],
      title: 'Science fair',
    });

    expect(created).toMatchObject({
      genderEligibility: 'female',
      registrationDeadlineAt: '2026-08-19T10:00:00.000000Z',
      rulesAndRegulations: 'Bring school identification.',
    });
    expect(database.queries.find((query) => query.sql.includes('insert into public.events'))?.sql)
      .toContain('gender_eligibility');
    expect(database.queries.find((query) => query.sql.includes('insert into public.events'))?.sql)
      .toContain('rules_and_regulations');
  });

  it('updates gender, rules, and a non-null deadline in the same event transaction', async () => {
    const database = new RecordingDatabase((query) => {
      if (query.sql.includes('for update of e, role')) return [{ id: eventId }];
      if (query.sql.includes('select') && query.sql.includes('from public.events e join public.user_roles role')) {
        return [eventRow({
          genderEligibility: 'male',
          registrationDeadlineAt: '2026-08-18T10:00:00.000000Z',
          rulesAndRegulations: null,
        })];
      }
      return [];
    });
    const repository = new DrizzleEventsRepository(database.asDatabase());

    const updated = await repository.updateEvent({ schoolId, userId: teacherId }, eventId, {
      genderEligibility: 'male',
      registrationDeadlineAt: '2026-08-18T10:00:00.000Z',
      rulesAndRegulations: null,
    }, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd');

    expect(updated).toMatchObject({
      genderEligibility: 'male',
      registrationDeadlineAt: '2026-08-18T10:00:00.000000Z',
      rulesAndRegulations: null,
    });
    const update = database.queries.find((query) => query.sql.includes('update public.events set'));
    expect(update?.sql).toContain('gender_eligibility');
    expect(update?.sql).toContain('rules_and_regulations');
  });
});
