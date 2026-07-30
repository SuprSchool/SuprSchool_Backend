import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import type { Database } from '../src/db/client.js';
import { DrizzleEventsRepository } from '../src/db/repositories/drizzle-events.repository.js';
import { decodeEventMemberCursor } from '../src/validators/events.schemas.js';

const schoolId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const teacherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const dialect = new PgDialect();

type RecordedQuery = { params: unknown[]; sql: string };

function compile(query: unknown): RecordedQuery {
  const rendered = dialect.sqlToQuery(query as SQL);
  return { params: [...rendered.params], sql: rendered.sql };
}

class RecordingDatabase {
  public readonly queries: RecordedQuery[] = [];

  public constructor(private readonly result: unknown[]) {}

  public readonly execute = async (query: unknown): Promise<unknown[]> => {
    this.queries.push(compile(query));
    return this.result;
  };

  public asDatabase(): Database {
    return this as unknown as Database;
  }
}

function member(index: number) {
  return {
    displayName: index % 2 === 0 ? 'Alex Singh' : 'alex singh',
    displayNameKey: 'alex singh',
    role: 'student' as const,
    userId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  };
}

describe('event member option repository pagination', () => {
  it('uses a stable lower-name and UUID keyset, limit plus one, and an opaque next cursor', async () => {
    const database = new RecordingDatabase(Array.from({ length: 101 }, (_, index) => member(index)));
    const repository = new DrizzleEventsRepository(database.asDatabase());

    const result = await repository.listMemberOptions(
      { schoolId, userId: teacherId },
      {
        cursor: {
          displayNameKey: 'aaron',
          userId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        },
        limit: 100,
        role: 'student',
      },
    );

    expect(result.items).toHaveLength(100);
    expect(result.items[0]).not.toHaveProperty('displayNameKey');
    expect(result.nextCursor).not.toBeNull();
    expect(decodeEventMemberCursor(result.nextCursor!)).toEqual({
      displayNameKey: 'alex singh',
      userId: member(99).userId,
    });

    const query = database.queries[0]!;
    expect(query.sql).toContain('lower(profile.display_name) as "displayNameKey"');
    expect(query.sql).toContain('("displayNameKey", "userId") >');
    expect(query.sql).toContain('order by "displayNameKey", "userId"');
    expect(query.params).toEqual(expect.arrayContaining([
      schoolId,
      teacherId,
      'aaron',
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      101,
    ]));
  });
});
