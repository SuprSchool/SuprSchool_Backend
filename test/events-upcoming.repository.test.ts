import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import type { Database } from '../src/db/client.js';
import { DrizzleEventsRepository } from '../src/db/repositories/drizzle-events.repository.js';

const schoolId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const studentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const dialect = new PgDialect();

interface RecordedQuery {
  params: unknown[];
  sql: string;
}

class RecordingDatabase {
  public readonly queries: RecordedQuery[] = [];

  public readonly execute = async (query: unknown): Promise<unknown[]> => {
    const rendered = dialect.sqlToQuery(query as SQL);
    this.queries.push({ params: [...rendered.params], sql: rendered.sql });
    return [];
  };

  public asDatabase(): Database {
    return this as unknown as Database;
  }
}

describe('student upcoming events query', () => {
  it('excludes completed and past events for the student home feed', async () => {
    const database = new RecordingDatabase();
    const repository = new DrizzleEventsRepository(database.asDatabase());

    await repository.listStudentEvents(
      { schoolId, userId: studentId },
      { cursor: undefined, filter: 'upcoming' as never, limit: 10 },
    );

    const query = database.queries[0]?.sql ?? '';
    expect(query).toContain("e.lifecycle = 'published'");
    expect(query).toContain('coalesce(e.ends_at, e.starts_at) >= now()');
  });
});
