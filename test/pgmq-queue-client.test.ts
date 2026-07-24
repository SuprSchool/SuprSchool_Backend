import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

import { PgmqQueueClient } from '../src/platform/queue/pgmq-queue-client.js';

describe('PgmqQueueClient', () => {
  it('casts all pgmq.send arguments to an unambiguous overload', async () => {
    let captured: SQL | undefined;
    const database = {
      execute: async (query: SQL) => {
        captured = query;
        return [];
      },
    };
    const client = new PgmqQueueClient(database as never);

    await client.enqueue('notification_dispatch', {
      eventId: 'b10e929c-6b5b-453a-8ce1-a7b527a16288',
      eventType: 'announcement.published',
      occurredAt: '2026-07-17T00:00:00.000Z',
      payload: {},
      schoolId: 'b561135e-6087-44a0-8ccf-42f1afb12ac7',
      schemaVersion: 1,
    }, 0);

    const rendered = new PgDialect().sqlToQuery(captured!);
    expect(rendered.sql).toBe('select pgmq.send($1::text, $2::jsonb, $3::integer)');
    expect(rendered.params).toEqual([
      'notification_dispatch',
      expect.any(String),
      0,
    ]);
  });
});
