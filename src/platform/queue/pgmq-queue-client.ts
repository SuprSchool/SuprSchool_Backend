import { sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import type { QueueClient, QueuedMessage } from './queue-client.js';
import type { QueueMessage } from './queue-message.js';

interface PgmqReadRow<TPayload> {
  msg_id: number;
  read_ct: number;
  message: QueueMessage<TPayload>;
}

/**
 * Every pgmq argument is cast explicitly. pgmq overloads on argument type, not
 * just arity — `archive` and `delete` each take `(text, bigint)` and
 * `(text, bigint[])`, and `send` takes six shapes — so an untyped bind
 * parameter arrives as `unknown` at parse time and Postgres answers 42725
 * "function ... is not unique" rather than picking an overload.
 *
 * `read` is the exception: pgmq declares only
 * `read(text, integer, integer, jsonb)`, and the three-argument call below
 * resolves through the default on `conditional`. It is cast anyway, so that a
 * pgmq release adding a sibling overload cannot silently make it ambiguous.
 */
export class PgmqQueueClient implements QueueClient {
  constructor(private readonly db: Database) {}

  async enqueue<TPayload>(
    queueName: string,
    message: QueueMessage<TPayload>,
    delaySeconds = 0,
  ): Promise<void> {
    await this.db.execute(
      sql`select pgmq.send(${queueName}::text, ${JSON.stringify(message)}::jsonb, ${delaySeconds}::integer)`,
    );
  }

  async read<TPayload>(
    queueName: string,
    visibilityTimeoutSeconds: number,
    limit: number,
  ): Promise<ReadonlyArray<QueuedMessage<TPayload>>> {
    const rows = await this.db.execute(
      sql<PgmqReadRow<TPayload>>`select msg_id, read_ct, message from pgmq.read(
        ${queueName}::text,
        ${visibilityTimeoutSeconds}::integer,
        ${limit}::integer
      )`,
    );

    return (rows as unknown as ReadonlyArray<PgmqReadRow<TPayload>>).map((row) => ({
      messageId: row.msg_id,
      readCount: row.read_ct,
      message: row.message,
    }));
  }

  async archive(queueName: string, messageId: number): Promise<void> {
    await this.db.execute(
      sql`select pgmq.archive(${queueName}::text, ${messageId}::bigint)`,
    );
  }
}
