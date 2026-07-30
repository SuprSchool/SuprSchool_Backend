import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import type { Database } from '../src/db/client.js';
import { DrizzleEventsRepository } from '../src/db/repositories/drizzle-events.repository.js';
import type { AppError } from '../src/lib/errors.js';

const schoolId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const teacherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const eventId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const sessionId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const resourceId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
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

describe('event directory repository queries', () => {
  it('lists current-school classes for an active teacher in deterministic bounded order', async () => {
    const database = new RecordingDatabase(() => [{ classId: 'class-1', label: 'Grade 9 - A' }]);
    const repository = new DrizzleEventsRepository(database.asDatabase());

    await expect(repository.listClassOptions({ schoolId, userId: teacherId }))
      .resolves.toEqual([{ classId: 'class-1', label: 'Grade 9 - A' }]);

    const query = database.queries[0];
    expect(query?.sql).toContain('academic_year.is_current');
    expect(query?.sql).toContain("actor.role = 'teacher' and actor.is_active");
    expect(query?.sql).toContain('order by lower(class_section.display_name), class_section.id');
    expect(query?.sql).toContain('limit 500');
    expect(query?.params).toEqual(expect.arrayContaining([teacherId, schoolId]));
  });

  it('lists only active student or teacher profiles without selecting phone data', async () => {
    const database = new RecordingDatabase(() => [{ displayName: 'A Student', role: 'student', userId: 'user-1' }]);
    const repository = new DrizzleEventsRepository(database.asDatabase());

    await repository.listMemberOptions(
      { schoolId, userId: teacherId },
      { limit: 25, role: 'student', search: 'A' },
    );

    const query = database.queries[0];
    expect(query?.sql).toContain("member_role.role in ('student', 'teacher')");
    expect(query?.sql).toContain('member_role.is_active');
    expect(query?.sql).toContain("like lower(");
    expect(query?.sql).toContain('limit $');
    expect(query?.sql).not.toContain('phone_e164');
    expect(query?.params).toEqual(expect.arrayContaining([schoolId, teacherId, 'student', 'A', 26]));
  });

  it('maps the visible event managing team in deterministic display-name and user order', async () => {
    const managingTeam = [{
      displayName: 'A Student',
      memberType: 'student',
      role: 'Coordinator',
      userId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    }];
    const database = new RecordingDatabase(() => managingTeam);
    const repository = new DrizzleEventsRepository(database.asDatabase());

    await expect(repository.listManagingTeam({ schoolId, userId: teacherId }, eventId))
      .resolves.toEqual(managingTeam);

    const query = database.queries[0];
    expect(query?.sql).toContain('from public.event_managers manager');
    expect(query?.sql).toContain('join public.user_profiles profile');
    expect(query?.sql).toContain('manager.school_id =');
    expect(query?.sql).toContain("actor.role = 'teacher' and actor.is_active");
    expect(query?.sql).toContain('event.deleted_at is null and event.archived_at is null');
    expect(query?.sql).toContain('event.created_by_teacher_id =');
    expect(query?.sql).toContain("event.lifecycle <> 'draft'");
    expect(query?.sql).toContain('order by lower(profile.display_name), manager.user_id');
    expect(query?.params).toEqual(expect.arrayContaining([schoolId, teacherId, eventId]));
  });
});

describe('event resource repository guarantees', () => {
  const stored = {
    confirmedAt: '2026-07-29T12:00:00.000Z',
    contentType: 'application/pdf',
    id: resourceId,
    kind: 'attachment',
    name: 'rules.pdf',
    objectPath: `${schoolId}/event-resource/${eventId}/${sessionId}`,
    sizeBytes: 2048,
    sortOrder: 1,
  };

  it('creates a pending row only from an exact owner-authorized upload session', async () => {
    const database = new RecordingDatabase(() => [{ id: resourceId }]);
    const repository = new DrizzleEventsRepository(database.asDatabase());

    await expect(repository.createPendingResource({
      contentType: 'application/pdf', displayName: 'rules.pdf', eventId,
      identity: { schoolId, userId: teacherId }, kind: 'attachment',
      objectPath: stored.objectPath, sizeBytes: 2048, sortOrder: 1, uploadSessionId: sessionId,
    })).resolves.toBe(true);

    const query = database.queries[0];
    expect(query?.sql).toContain("upload.bucket = 'academic-files'");
    expect(query?.sql).toContain("upload.parent_type = 'event-resource'");
    expect(query?.sql).toContain('upload.parent_id = event.id::text');
    expect(query?.sql).toContain('event.created_by_teacher_id');
    expect(query?.sql).toContain('on conflict (upload_session_id) do nothing');
  });

  it('replays an already-confirmed upload without updating or duplicating it', async () => {
    const database = new RecordingDatabase((query) => {
      if (query.sql.includes('for update of event, actor')) return [{ id: eventId }];
      if (query.sql.includes('from public.event_resources') && query.sql.includes('for update')) return [stored];
      return [];
    });
    const repository = new DrizzleEventsRepository(database.asDatabase());

    await expect(repository.confirmResourceUpload({ schoolId, userId: teacherId }, eventId, sessionId))
      .resolves.toMatchObject({ id: resourceId, objectPath: stored.objectPath });
    expect(database.queries.some((query) => query.sql.includes('update public.event_resources'))).toBe(false);
  });

  it('rejects a second current banner while keeping the pending upload recoverable', async () => {
    const pendingBanner = { ...stored, confirmedAt: null, kind: 'banner' };
    const database = new RecordingDatabase((query) => {
      if (query.sql.includes('for update of event, actor')) return [{ id: eventId }];
      if (query.sql.includes('from public.event_resources') && query.sql.includes('for update')) return [pendingBanner];
      if (query.sql.includes("resource_kind = 'banner'")) return [{ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }];
      return [];
    });
    const repository = new DrizzleEventsRepository(database.asDatabase());

    await expect(repository.confirmResourceUpload({ schoolId, userId: teacherId }, eventId, sessionId))
      .rejects.toMatchObject({ code: 'EVENT_BANNER_EXISTS' as never, status: 409 } satisfies Partial<AppError>);
    expect(database.queries.some((query) => query.sql.includes('update public.event_resources'))).toBe(false);
  });

  it('reads only confirmed resources through the student audience authorization path', async () => {
    const database = new RecordingDatabase(() => [stored]);
    const repository = new DrizzleEventsRepository(database.asDatabase());

    await repository.listStudentResources({ schoolId, userId: teacherId }, eventId);

    const query = database.queries[0];
    expect(query?.sql).toContain('resource.confirmed_at is not null');
    expect(query?.sql).toContain("actor.role = 'student' and actor.is_active");
    expect(query?.sql).toContain('membership.is_active');
    expect(query?.sql).toContain('limit 101');
  });
});
describe('archived event resource cleanup authorization', () => {
  it('blocks new upload management after archival while retaining owner resource deletion', async () => {
    const resource = {
      contentType: 'application/pdf',
      id: resourceId,
      kind: 'attachment',
      name: 'rules.pdf',
      objectPath: `${schoolId}/event-resource/${eventId}/${sessionId}`,
      sizeBytes: 2048,
      sortOrder: 1,
    };
    const database = new RecordingDatabase(() => [resource]);
    const repository = new DrizzleEventsRepository(database.asDatabase());

    await expect(repository.canManage({ schoolId, userId: teacherId }, eventId)).resolves.toBe(true);
    await expect(repository.findResourceForDeletion({ schoolId, userId: teacherId }, eventId, resourceId))
      .resolves.toMatchObject({ id: resourceId });

    expect(database.queries[0]?.sql).toContain('event.archived_at is null');
    expect(database.queries[0]?.sql).toContain('event.created_by_teacher_id');
    expect(database.queries[1]?.sql).not.toContain('archived_at is null');
    expect(database.queries[1]?.sql).not.toContain('deleted_at is null');
  });

  it('rejects archived and deleted events from teacher detail and signed-resource reads', async () => {
    const database = new RecordingDatabase(() => []);
    const repository = new DrizzleEventsRepository(database.asDatabase());

    await repository.getTeacherEvent({ schoolId, userId: teacherId }, eventId);
    await repository.listTeacherResources({ schoolId, userId: teacherId }, eventId);
    await repository.listTeacherEvents({ schoolId, userId: teacherId }, { limit: 25, scope: 'all' });

    expect(database.queries[0]?.sql).toContain('e.deleted_at is null');
    expect(database.queries[0]?.sql).toContain('e.archived_at is null');
    expect(database.queries[1]?.sql).toContain('event.deleted_at is null');
    expect(database.queries[1]?.sql).toContain('event.archived_at is null');
    expect(database.queries[2]?.sql).toContain('e.deleted_at is null');
    expect(database.queries[2]?.sql).toContain('e.archived_at is null');
  });
});