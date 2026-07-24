import { sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import type { DeadLetterQueueRecord, DeadLetterQueueStore } from './queue-worker.js';

export class DatabaseDeadLetterQueueStore implements DeadLetterQueueStore {
  public constructor(private readonly db: Database) {}

  public async record(record: DeadLetterQueueRecord): Promise<void> {
    await this.db.execute(sql`
      insert into public.queue_dead_letters (
        queue_name,
        original_message_id,
        event_id,
        school_id,
        envelope,
        error_category,
        error_detail
      )
      values (
        ${record.queueName},
        ${record.messageId},
        ${record.eventId}::uuid,
        ${record.schoolId}::uuid,
        ${JSON.stringify(record.envelope)}::jsonb,
        ${record.errorCategory},
        ${record.errorDetail}
      )
    `);
  }
}
