import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { DrizzleAssignmentsRepository } from '../src/db/repositories/assignments.repository.js';
import type { Database } from '../src/db/client.js';

const schoolId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const studentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const assignmentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const submissionId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const uploadSessionId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const dialect = new PgDialect();

interface RecordedQuery { params: unknown[]; sql: string }

function compile(query: unknown): RecordedQuery {
  const rendered = dialect.sqlToQuery(query as SQL);
  return { params: [...rendered.params], sql: rendered.sql };
}

/**
 * postgres.js receives raw `sql` parameters untouched — nothing converts a Date
 * on the way through, unlike a Drizzle query builder. Confirming a submission
 * with a Date parameter throws
 *   The "string" argument must be of type string ... Received an instance of Date
 * and answers 500, which blocks every student submission in the app.
 */
describe('assignment submission confirm', () => {
  it('never hands the driver a Date parameter', async () => {
    const queries: RecordedQuery[] = [];
    const submittedAt = new Date('2026-08-11T12:52:44.000Z');

    const respond = (query: RecordedQuery): unknown[] => {
      // The repository locks the row first, then runs the update. Answer the
      // lock with an unattached draft so the update is reached.
      if (query.sql.includes('for update')) {
        return [{
          assignment_id: assignmentId,
          completed_at: null,
          feedback: null,
          graded_at: null,
          id: submissionId,
          marks: null,
          object_path: null,
          studentName: 'Aditya',
          student_id: studentId,
          submitted_at: null,
          upload_session_id: null,
        }];
      }
      // The raw `sql` path is cast, not parsed: postgres.js answers a
      // timestamptz as a string here, so the shared row mapper must not assume
      // a Date. It did, and `row.submittedAt.toISOString is not a function`
      // turned the confirm into a second 500 once the Date parameter was fixed.
      return [{
        assignment_id: assignmentId,
        completed_at: null,
        feedback: null,
        graded_at: null,
        id: submissionId,
        marks: null,
        object_path: 'path/to/object',
        studentName: 'Aditya',
        student_id: studentId,
        submitted_at: submittedAt.toISOString(),
      }];
    };

    const database = {
      execute: async (query: unknown): Promise<unknown[]> => {
        const recorded = compile(query);
        queries.push(recorded);
        return respond(recorded);
      },
      transaction: async <T>(
        callback: (transaction: { execute(query: unknown): Promise<unknown[]> }) => Promise<T>,
      ): Promise<T> => callback({
        execute: async (query: unknown): Promise<unknown[]> => {
          const recorded = compile(query);
          queries.push(recorded);
          return respond(recorded);
        },
      }),
    } as unknown as Database;

    const repository = new DrizzleAssignmentsRepository(database);
    const confirmed = await repository.confirmSubmission({
      assignmentId,
      displayName: 't0-resource-15kb.pdf',
      identity: { schoolId, userId: studentId },
      objectPath: 'path/to/object',
      submittedAt,
      uploadSessionId,
    });

    // A string timestamp off the raw path must still map, not throw.
    expect(confirmed?.kind).toBe('attached');
    if (confirmed === undefined || confirmed.kind === 'conflict') {
      throw new Error(`expected an attached submission, got ${String(confirmed?.kind)}`);
    }
    expect(confirmed.submission.submittedAt).toBe(submittedAt.toISOString());

    const update = queries.find((query) => query.sql.includes('update public.assignment_submissions'));
    expect(update, 'the confirm path must reach its update').toBeDefined();

    const dateParams = (update?.params ?? []).filter((param) => param instanceof Date);
    expect(dateParams, 'a raw sql timestamptz parameter must be serialised, not a Date').toEqual([]);
    expect(update?.params).toContain(submittedAt.toISOString());
  });
});
