import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { createRankingRefreshHandler } from '../src/async/rankings/ranking-refresh.handler.js';
import { createRankingRefreshMessage } from '../src/async/rankings/ranking-refresh.message.js';
import { DrizzleRankingRepository } from '../src/db/repositories/ranking.repository.js';
import { RankingRefreshService } from '../src/services/ranking-refresh.service.js';

const schoolId = '11111111-1111-4111-8111-111111111111';
const scopeId = '22222222-2222-4222-8222-222222222222';
const classId = '33333333-3333-4333-8333-333333333333';
const subjectId = '44444444-4444-4444-8444-444444444444';
const snapshotId = '55555555-5555-4555-8555-555555555555';
const firstStudentId = '66666666-6666-4666-8666-666666666666';
const secondStudentId = '77777777-7777-4777-8777-777777777777';
const eventId = '88888888-8888-4888-8888-888888888888';

const pgDialect = new PgDialect();

interface RenderedQuery {
  params: readonly unknown[];
  sql: string;
}

/**
 * Postgres folds an unquoted identifier to lower case, and `jsonb_to_recordset`
 * then matches JSON keys against the resulting column names case-sensitively.
 * This returns the column names as the server sees them.
 */
function declaredRecordsetColumns(query: string): readonly string[] {
  const match = /as candidate\(([\s\S]*)\)/.exec(query);
  if (match?.[1] === undefined) {
    throw new Error('The ranking_entries insert no longer declares a candidate recordset');
  }
  return match[1].split(',').map((column) => {
    const identifier = column.trim().split(/\s+/)[0] ?? '';
    return identifier.startsWith('"')
      ? identifier.slice(1, -1)
      : identifier.toLowerCase();
  });
}

function referencedRecordsetColumns(query: string): readonly string[] {
  return [...query.matchAll(/candidate\.(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/g)]
    .map((match) => match[1] ?? (match[2] ?? '').toLowerCase());
}

function candidatePayload(query: RenderedQuery): ReadonlyArray<Record<string, unknown>> {
  for (const param of query.params) {
    if (typeof param !== 'string' || !param.startsWith('[')) continue;
    const parsed: unknown = JSON.parse(param);
    if (Array.isArray(parsed)) return parsed as ReadonlyArray<Record<string, unknown>>;
  }
  throw new Error('The ranking_entries insert no longer binds a JSON candidate payload');
}

function createRankingDatabase(): {
  database: unknown;
  executed: readonly RenderedQuery[];
} {
  const executed: RenderedQuery[] = [];
  const execute = async (query: unknown): Promise<unknown[]> => {
    const rendered = pgDialect.sqlToQuery(query as SQL);
    executed.push({ params: rendered.params, sql: rendered.sql });

    if (
      rendered.sql.includes('from public.ranking_refresh_scopes')
      && rendered.sql.includes('for update')
    ) {
      return [{
        classId,
        dirtyVersion: '56',
        id: scopeId,
        refreshedVersion: '0',
        schoolId,
        subjectId,
      }];
    }
    if (rendered.sql.includes('with active_members as')) {
      return [
        { marks: '91.50', points: 120, rank: 1, streakCount: 4, userId: firstStudentId },
        { marks: '84.25', points: 96, rank: 2, streakCount: 0, userId: secondStudentId },
      ];
    }
    if (rendered.sql.includes('insert into public.ranking_snapshots')) {
      return [{ generatedAt: '2026-08-10T00:00:00.000Z', id: snapshotId }];
    }
    return [];
  };

  return {
    database: {
      execute,
      transaction: async (run: (tx: unknown) => Promise<void>): Promise<void> => {
        await run({ execute });
      },
    },
    executed,
  };
}

async function runHandler(): Promise<readonly RenderedQuery[]> {
  const { database, executed } = createRankingDatabase();
  const handler = createRankingRefreshHandler(
    new RankingRefreshService({ repository: new DrizzleRankingRepository(database as never) }),
  );
  const message = createRankingRefreshMessage({
    eventId,
    schoolId,
    scopeId,
    targetVersion: '56',
  });

  await handler(message, { providerIdempotencyKey: eventId });
  return executed;
}

function rankingEntriesInsert(executed: readonly RenderedQuery[]): RenderedQuery {
  const insert = executed.find((query) => query.sql.includes('insert into public.ranking_entries'));
  if (insert === undefined) throw new Error('The handler never inserted ranking entries');
  return insert;
}

describe('ranking_refresh queue handler', () => {
  it('reads back every key the candidate payload writes', async () => {
    const insert = rankingEntriesInsert(await runHandler());
    const payload = candidatePayload(insert);

    expect(payload).toHaveLength(2);
    // jsonb_to_recordset yields NULL for a declared column absent from the JSON
    // object, and ranking_entries.user_id is NOT NULL, so any drift between the
    // two sides fails every message in the queue.
    expect([...declaredRecordsetColumns(insert.sql)].sort())
      .toEqual(Object.keys(payload[0] ?? {}).sort());
  });

  it('only selects candidate columns the recordset declares', async () => {
    const insert = rankingEntriesInsert(await runHandler());
    const declared = new Set(declaredRecordsetColumns(insert.sql));
    const referenced = referencedRecordsetColumns(insert.sql);

    expect(referenced.length).toBeGreaterThan(0);
    for (const column of referenced) {
      expect(declared).toContain(column);
    }
  });

  it('carries a realistic payload through to the entries insert', async () => {
    const insert = rankingEntriesInsert(await runHandler());
    const payload = candidatePayload(insert);

    expect(payload[0]).toEqual({
      marks: 91.5,
      points: 120,
      rank: 1,
      streakCount: 4,
      userId: firstStudentId,
    });
  });

  it('names what it rejected when the payload is not a refresh request', async () => {
    const { database } = createRankingDatabase();
    const handler = createRankingRefreshHandler(
      new RankingRefreshService({ repository: new DrizzleRankingRepository(database as never) }),
    );
    const message = {
      ...createRankingRefreshMessage({ eventId, schoolId, scopeId, targetVersion: '56' }),
      eventType: 'ranking.something.else',
      payload: { scopeId },
    };

    // The rejection is what the worker logs, so an empty message leaves the
    // operator with nothing to act on.
    await expect(handler(message, { providerIdempotencyKey: eventId }))
      .rejects.toThrow(/ranking\.something\.else/);
  });

  it('advances the scope and clears its outbox once the entries land', async () => {
    const executed = await runHandler();

    expect(executed.some((query) => query.sql.includes('update public.ranking_refresh_scopes')))
      .toBe(true);
    expect(executed.some((query) => query.sql.includes('delete from public.ranking_refresh_outbox')))
      .toBe(true);
  });
});
