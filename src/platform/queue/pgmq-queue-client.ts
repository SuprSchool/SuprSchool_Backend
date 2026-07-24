import { sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import type { QueueClient, QueuedMessage } from './queue-client.js';
import type { QueueMessage } from './queue-message.js';

interface PgmqReadRow<TPayload> {
  msg_id: number;
  read_ct: number;
  message: QueueMessage<TPayload>;
}

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
        ${queueName},
        ${visibilityTimeoutSeconds},
        ${limit}
      )`,
    );

    return (rows as unknown as ReadonlyArray<PgmqReadRow<TPayload>>).map((row) => ({
      messageId: row.msg_id,
      readCount: row.read_ct,
      message: row.message,
    }));
  }

  async archive(queueName: string, messageId: number): Promise<void> {
    await this.db.execute(sql`select pgmq.archive(${queueName}, ${messageId})`);
  }
}
