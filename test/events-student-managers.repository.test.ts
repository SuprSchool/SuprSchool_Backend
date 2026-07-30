import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import type { Database } from '../src/db/client.js';
import { DrizzleEventsRepository } from '../src/db/repositories/drizzle-events.repository.js';

const schoolId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const studentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const eventId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const managerId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const dialect = new PgDialect();

type RecordedQuery = { params: unknown[]; sql: string };

class RecordingDatabase {
  public recorded: RecordedQuery | undefined;

  public readonly execute = async (query: unknown): Promise<unknown[]> => {
    const rendered = dialect.sqlToQuery(query as SQL);
    this.recorded = { params: [...rendered.params], sql: rendered.sql };
    return [{
      contact: 'teacher@school.example',
      displayName: 'Event Teacher',
      memberType: 'teacher',
      role: 'Coordinator',
      userId: managerId,
    }];
  };

  public asDatabase(): Database {
    return this as unknown as Database;
  }
}

describe('student event managing-team authorization', () => {
  it('returns contact only through the active same-school published audience path', async () => {
    const database = new RecordingDatabase();
    const repository = new DrizzleEventsRepository(database.asDatabase());

    await expect(repository.listStudentManagingTeam(
      { schoolId, userId: studentId },
      eventId,
    )).resolves.toEqual([{
      contact: 'teacher@school.example',
      displayName: 'Event Teacher',
      memberType: 'teacher',
      role: 'Coordinator',
      userId: managerId,
    }]);

    const query = database.recorded!;
    expect(query.sql).toContain('profile.school_id = manager.school_id');
    expect(query.sql).toContain('manager.school_id =');
    expect(query.sql).toContain("actor.role = 'student' and actor.is_active");
    expect(query.sql).toContain("event.lifecycle in ('published', 'completed')");
    expect(query.sql).toContain("event.audience_type = 'school' or exists");
    expect(query.sql).toContain('membership.school_id = audience.school_id');
    expect(query.sql).toContain('membership.student_id =');
    expect(query.params).toEqual(expect.arrayContaining([schoolId, studentId, eventId]));
  });
});
