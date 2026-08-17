import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import type { Database } from '../src/db/client.js';
import { DrizzleStudentHomeRepository } from '../src/db/repositories/student-home.repository.js';

/**
 * The birthday queries decide who has a birthday by comparing a literal
 * `MM-DD` (and, for the window, a literal `YYYY-MM-DD`) against the stored date
 * of birth. Which literal they bind is the whole behaviour, so the test binds a
 * fake query builder and reads the parameters back out of the condition the
 * repository hands to `.where()`.
 *
 * 2026-08-16T21:15Z is 2026-08-17 02:45 in IST — the window in which a UTC
 * server reads yesterday. On the live QA school that day, eighteen students had
 * a birthday under `08-17` and none under `08-16`, so the difference between
 * the two literals is the difference between a populated birthday band and an
 * empty one on both dashboards.
 */
const IST_EARLY_MORNING = new Date('2026-08-16T21:15:00.000Z');
const dialect = new PgDialect();

function captureWhereParams(): { db: Database; params: unknown[][] } {
  const params: unknown[][] = [];
  const builder: Record<string, unknown> = {};
  const chain = () => builder;

  Object.assign(builder, {
    from: chain,
    innerJoin: chain,
    limit: chain,
    orderBy: chain,
    select: chain,
    where: (condition: Parameters<PgDialect['sqlToQuery']>[0]) => {
      params.push(dialect.sqlToQuery(condition).params);
      return builder;
    },
    // `.then` makes the builder awaitable, so the repository's trailing
    // `.then(rows => rows.map(...))` resolves to an empty result set.
    then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
  });

  return { db: builder as unknown as Database, params };
}

describe('student home birthday queries', () => {
  it('asks for the school\'s calendar day, not the server\'s UTC day', async () => {
    const { db, params } = captureWhereParams();
    const repository = new DrizzleStudentHomeRepository(db);

    await repository.getBirthdaysForSchool('school-a', IST_EARLY_MORNING);

    expect(params).toHaveLength(1);
    expect(params[0]).toContain('08-17');
    expect(params[0]).not.toContain('08-16');
  });

  it('anchors the upcoming window on the school\'s calendar day too', async () => {
    const { db, params } = captureWhereParams();
    const repository = new DrizzleStudentHomeRepository(db);

    await repository.getUpcomingBirthdaysForSchool('school-a', IST_EARLY_MORNING, 30);

    expect(params).toHaveLength(1);
    // The next-occurrence expression binds today several times over; every one
    // of them has to be the same school-local day.
    const dates = params[0]?.filter(
      (value): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value),
    );
    expect(dates?.length).toBeGreaterThan(0);
    expect(new Set(dates)).toEqual(new Set(['2026-08-17']));
  });

  // Outside the offset window the two calendars agree, and nothing shifts.
  it('leaves the day alone when UTC and the school already agree', async () => {
    const { db, params } = captureWhereParams();
    const repository = new DrizzleStudentHomeRepository(db);

    await repository.getBirthdaysForSchool('school-a', new Date('2026-08-17T09:00:00.000Z'));

    expect(params[0]).toContain('08-17');
  });
});
