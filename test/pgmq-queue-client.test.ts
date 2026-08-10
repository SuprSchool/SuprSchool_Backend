import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

import { PgmqQueueClient } from '../src/platform/queue/pgmq-queue-client.js';

interface CapturedClient {
  client: PgmqQueueClient;
  rendered: () => { params: unknown[]; sql: string };
}

function captureClient(): CapturedClient {
  let captured: SQL | undefined;
  const database = {
    execute: async (query: SQL) => {
      captured = query;
      return [];
    },
  };

  return {
    client: new PgmqQueueClient(database as never),
    rendered: () => {
      const query = new PgDialect().sqlToQuery(captured as SQL);
      return { params: query.params, sql: query.sql };
    },
  };
}

describe('PgmqQueueClient', () => {
  it('casts all pgmq.send arguments to an unambiguous overload', async () => {
    const { client, rendered } = captureClient();

    await client.enqueue('notification_dispatch', {
      eventId: 'b10e929c-6b5b-453a-8ce1-a7b527a16288',
      eventType: 'announcement.published',
      occurredAt: '2026-07-17T00:00:00.000Z',
      payload: {},
      schoolId: 'b561135e-6087-44a0-8ccf-42f1afb12ac7',
      schemaVersion: 1,
    }, 0);

    expect(rendered().sql).toBe('select pgmq.send($1::text, $2::jsonb, $3::integer)');
    expect(rendered().params).toEqual([
      'notification_dispatch',
      expect.any(String),
      0,
    ]);
  });

  it('casts pgmq.archive arguments so the scalar bigint overload is chosen', async () => {
    // Regression: `select pgmq.archive($1, $2)` sent both parameters untyped.
    // pgmq declares archive(text, bigint) and archive(text, bigint[]), so
    // Postgres answered 42725 `function pgmq.archive(unknown, unknown) is not
    // unique` instead of picking one. QueueWorker.processMessage acknowledges
    // every message with archive(), so the worker died on the first message it
    // handled and left all nine queues undrained.
    const { client, rendered } = captureClient();

    await client.archive('notification_dispatch', 5);

    expect(rendered().sql).toBe('select pgmq.archive($1::text, $2::bigint)');
    expect(rendered().params).toEqual(['notification_dispatch', 5]);
  });

  it('casts pgmq.read arguments so a future sibling overload cannot make it ambiguous', async () => {
    const { client, rendered } = captureClient();

    await client.read('storage_cleanup', 30, 10);

    expect(rendered().sql).toContain('$1::text');
    expect(rendered().sql).toContain('$2::integer');
    expect(rendered().sql).toContain('$3::integer');
    expect(rendered().params).toEqual(['storage_cleanup', 30, 10]);
  });

  it('leaves no pgmq argument uncast', () => {
    // Guards the whole client, not just the calls that have already bitten us:
    // any bare `$n` reaching a pgmq function is an unresolved-overload risk,
    // and pgmq overloads on argument type rather than arity.
    const source = readFileSync(
      resolve(import.meta.dirname, '..', 'src', 'platform', 'queue', 'pgmq-queue-client.ts'),
      'utf8',
    );
    const pgmqArguments = [...source.matchAll(/pgmq\.\w+\(([\s\S]*?)\)\s*`/g)]
      .flatMap((match) => (match[1] ?? '').split(','))
      .map((argument) => argument.trim())
      .filter((argument) => argument.startsWith('${'));

    expect(pgmqArguments.length).toBeGreaterThan(0);
    expect(pgmqArguments.filter((argument) => !/}::\w+(\[])?$/.test(argument))).toEqual([]);
  });
});
