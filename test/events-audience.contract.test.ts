import { readFile } from 'node:fs/promises';

import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import type { Database } from '../src/db/client.js';
import { DrizzleEventsRepository } from '../src/db/repositories/drizzle-events.repository.js';
import { createEventSchema, updateEventSchema } from '../src/validators/events.schemas.js';

const schoolId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const teacherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const studentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const eventId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const classId = '11111111-1111-4111-8111-111111111111';
const dialect = new PgDialect();

type RecordedQuery = { params: unknown[]; sql: string };

function compile(query: unknown): RecordedQuery {
  const rendered = dialect.sqlToQuery(query as SQL);
  return { params: [...rendered.params], sql: rendered.sql };
}

class RecordingDatabase {
  public readonly queries: RecordedQuery[] = [];

  public constructor(private readonly respond: (query: RecordedQuery) => unknown[]) {}

  public readonly execute = async (query: unknown): Promise<unknown[]> => {
    const recorded = compile(query);
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

function teacherEventRow() {
  return {
    activityKind: 'event',
    audienceType: 'school',
    category: null,
    createdAt: '2026-07-29T10:00:00.000000Z',
    createdByTeacherId: teacherId,
    description: null,
    eligibilityCriteria: null,
    endsAt: null,
    id: eventId,
    lifecycle: 'draft',
    participationMode: null,
    registrationDeadlineAt: null,
    resultsPublishedAt: null,
    resultsRevision: 0,
    startsAt: '2026-07-30T10:00:00.000000Z',
    targetClassIds: [],
    title: 'Whole school day',
    venue: null,
  };
}

describe('first-class event audiences', () => {
  it('validates explicit whole-school audiences without client class enumeration', () => {
    const common = {
      activityKind: 'event' as const,
      startsAt: '2026-07-30T10:00:00.000Z',
      registrationDeadlineAt: '2026-07-29T10:00:00.000Z',
      title: 'Whole school day',
    };

    expect(createEventSchema.parse({ ...common, audienceType: 'school' }))
      .toMatchObject({ audienceType: 'school', targetClassIds: [] });
    expect(createEventSchema.safeParse({ ...common, audienceType: 'school', targetClassIds: [classId] }).success)
      .toBe(false);
    expect(createEventSchema.safeParse({ ...common, audienceType: 'classes' }).success)
      .toBe(false);
    expect(createEventSchema.parse({ ...common, targetClassIds: [classId] }))
      .toMatchObject({ audienceType: 'classes', targetClassIds: [classId] });
    expect(updateEventSchema.safeParse({ audienceType: 'school', targetClassIds: [classId] }).success)
      .toBe(false);
    expect(updateEventSchema.safeParse({ audienceType: 'classes' }).success)
      .toBe(false);
  });

  it('persists a whole-school event atomically without inserting partial class audiences', async () => {
    const database = new RecordingDatabase((query) => {
      if (query.sql.includes('insert into public.events')) return [{ id: eventId }];
      if (query.sql.includes('select') && query.sql.includes('from public.events e join public.user_roles role')) {
        return [teacherEventRow()];
      }
      return [];
    });
    const repository = new DrizzleEventsRepository(database.asDatabase());

    const created = await repository.createEvent({ schoolId, userId: teacherId }, eventId, {
      activityKind: 'event',
      audienceType: 'school',
      startsAt: '2026-07-30T10:00:00.000Z',
      registrationDeadlineAt: '2026-07-29T10:00:00.000Z',
      targetClassIds: [],
      title: 'Whole school day',
    });

    expect(created).toMatchObject({ audienceType: 'school', targetClassIds: [] });
    expect(database.queries.some((query) => query.sql.includes('select id from public.classes'))).toBe(false);
    expect(database.queries.some((query) => query.sql.includes('insert into public.event_audiences'))).toBe(false);
    const insert = database.queries.find((query) => query.sql.includes('insert into public.events'));
    expect(insert?.sql).toContain('audience_type');
    expect(insert?.sql).toContain('on conflict (id) do nothing');
    expect(insert?.params).toContain(eventId);
    expect(insert?.params).toContain('school');
  });

  it('rereads a deterministic create conflict only through its same-owner transaction receipt', async () => {
    const database = new RecordingDatabase((query) => {
      if (query.sql.includes('insert into public.events')) return [];
      if (query.sql.includes('join public.event_domain_outbox receipt')) return [{ id: eventId }];
      if (query.sql.includes('from public.events e join public.user_roles role')) return [teacherEventRow()];
      return [];
    });
    const repository = new DrizzleEventsRepository(database.asDatabase());

    await expect(repository.createEvent({ schoolId, userId: teacherId }, eventId, {
      activityKind: 'event',
      audienceType: 'school',
      startsAt: '2026-07-30T10:00:00.000Z',
      registrationDeadlineAt: '2026-07-29T10:00:00.000Z',
      targetClassIds: [],
      title: 'Whole school day',
    })).resolves.toMatchObject({ id: eventId, title: 'Whole school day' });

    const receiptRead = database.queries.find((query) => query.sql.includes('join public.event_domain_outbox receipt'));
    expect(receiptRead?.params).toEqual(expect.arrayContaining([eventId, schoolId, teacherId]));
    expect(database.queries.some((query) => query.sql.includes('insert into public.event_domain_outbox'))).toBe(false);
    expect(database.queries.some((query) => query.sql.includes('insert into public.event_audiences'))).toBe(false);
  });

  it('rejects a deterministic identifier collision without the same-owner create receipt', async () => {
    const database = new RecordingDatabase((query) => {
      if (query.sql.includes('insert into public.events')) return [];
      if (query.sql.includes('select role.user_id as "userId"')) return [{ userId: teacherId }];
      return [];
    });
    const repository = new DrizzleEventsRepository(database.asDatabase());

    await expect(repository.createEvent({ schoolId, userId: teacherId }, eventId, {
      activityKind: 'event',
      audienceType: 'school',
      startsAt: '2026-07-30T10:00:00.000Z',
      registrationDeadlineAt: '2026-07-29T10:00:00.000Z',
      targetClassIds: [],
      title: 'Whole school day',
    })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });

    const receiptRead = database.queries.find((query) => query.sql.includes('join public.event_domain_outbox receipt'));
    expect(receiptRead?.sql).toContain('event.created_by_teacher_id');
    expect(receiptRead?.sql).toContain("role.role = 'teacher'");
    expect(database.queries.some((query) => query.sql.includes('insert into public.event_domain_outbox'))).toBe(false);
  });

  it('authorizes same-school active students for school events without weakening class audiences', async () => {
    const database = new RecordingDatabase(() => []);
    const repository = new DrizzleEventsRepository(database.asDatabase());

    await repository.listStudentEvents({ schoolId, userId: studentId }, { filter: 'upcoming', limit: 25 });
    await repository.registerStudent({ schoolId, userId: studentId }, eventId).catch(() => undefined);

    for (const query of database.queries) {
      expect(query.sql).toContain("audience_type = 'school'");
      expect(query.sql).toContain('public.event_audiences');
      expect(query.sql).toContain('public.class_members');
      expect(query.sql).toContain("role.role = 'student'");
      expect(query.params).toContain(schoolId);
      expect(query.params).toContain(studentId);
    }
  });

  it('does not let a historical update receipt acknowledge a later same-payload mutation', async () => {
    const database = new RecordingDatabase(() => []);
    const repository = new DrizzleEventsRepository(database.asDatabase());
    const input = { title: 'Same requested title' };
    const historicalMutationId = '22222222-2222-4222-8222-222222222222';
    const currentMutationId = '33333333-3333-4333-8333-333333333333';

    await repository.recoverUpdatedEvent(
      { schoolId, userId: teacherId }, eventId, input, historicalMutationId,
    );
    await repository.recoverUpdatedEvent(
      { schoolId, userId: teacherId }, eventId, input, currentMutationId,
    );

    const receiptReads = database.queries.filter((query) =>
      query.sql.includes('from public.event_domain_outbox receipt'));
    expect(receiptReads).toHaveLength(2);
    const historicalSourceKey = receiptReads[0]?.params.find((parameter) =>
      typeof parameter === 'string' && parameter.includes(':updated:'));
    const currentSourceKey = receiptReads[1]?.params.find((parameter) =>
      typeof parameter === 'string' && parameter.includes(':updated:'));
    expect(historicalSourceKey).toContain(historicalMutationId);
    expect(currentSourceKey).toContain(currentMutationId);
    expect(currentSourceKey).not.toBe(historicalSourceKey);
  });
});

describe('event audience migration', () => {
  it('is additive, backward compatible, indexed, and defers cross-table audience cardinality checks', async () => {
    const migration = await readFile(
      new URL('../supabase/migrations/20260729170000_event_audience_archive_cleanup.sql', import.meta.url),
      'utf8',
    );

    expect(migration).toContain("add column audience_type text not null default 'classes'");
    expect(migration).toContain("check (audience_type in ('classes', 'school'))");
    expect(migration).toContain('create constraint trigger events_validate_audience');
    expect(migration).toContain('deferrable initially deferred');
    expect(migration).toContain(
      "if tg_table_name = 'event_audiences' and tg_op = 'UPDATE' then",
    );
    expect(migration).toContain(
      'if old.event_id is distinct from new.event_id then',
    );
    expect(migration).toContain(
      "raise exception 'event audience rows cannot move between events'",
    );
    expect(migration).toContain('audience_count between 1 and 100');
    expect(migration).toContain("audience_type = 'school' and audience_count = 0");
    expect(migration).toContain(
      'classes_school_academic_year_lower_name_id_idx',
    );
    expect(migration).toContain('events_school_deleted_id_idx');
    expect(migration).toContain('from public.event_resources resource');
    expect(migration).toContain('event.deleted_at is not null');
    expect(migration).toContain("pgmq.send('storage_cleanup'");
    expect(migration).toContain("jsonb_build_object('kind', 'legacy'");
    expect(migration).toContain('from public.recording_upload_sessions');
    expect(migration).toContain('from public.recording_cleanup_intents');
    expect(migration).toContain('from public.class_recordings');
    expect(migration).toContain("jsonb_build_object('kind', 'recordings'");
  });

  it('upgrades the shared trigger so events rows never read an event_audiences-only field', async () => {
    const migration = await readFile(
      new URL('../supabase/migrations/20260731020000_event_audience_trigger_record_safe.sql', import.meta.url),
      'utf8',
    );

    expect(migration).toContain("tg_table_name = 'events'");
    expect(migration).toContain('new_row jsonb := to_jsonb(new)');
    expect(migration).toContain('old_row jsonb := to_jsonb(old)');
    expect(migration).toContain("(new_row ->> 'event_id')::uuid");
    expect(migration).toContain("(old_row ->> 'event_id')::uuid");
  });
});
