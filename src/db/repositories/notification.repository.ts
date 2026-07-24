import { sql } from 'drizzle-orm';

import type { Database } from '../client.js';
import {
  encodeNotificationInboxCursor,
} from '../../types/notification.js';
import type {
  NotificationInboxItem,
  NotificationInboxPage,
  NotificationInboxCursor,
  RegisterDeviceTokenInput,
} from '../../types/notification.js';

export interface NotificationRepository {
  registerDeviceToken(schoolId: string, userId: string, input: RegisterDeviceTokenInput): Promise<{ id: string }>;
  listInbox(schoolId: string, userId: string, options: { cursor?: NotificationInboxCursor | undefined; limit: number; unreadOnly: boolean }): Promise<NotificationInboxPage>;
  markRead(schoolId: string, userId: string, notificationId: string): Promise<boolean>;
}

export interface NotificationDispatchRepository {
  listActiveExpoTokens(schoolId: string, userId: string): Promise<ReadonlyArray<string>>;
}

export class DrizzleNotificationRepository implements NotificationRepository, NotificationDispatchRepository {
  public constructor(private readonly db: Database) {}

  async registerDeviceToken(schoolId: string, userId: string, input: RegisterDeviceTokenInput): Promise<{ id: string }> {
    const rows = await this.db.execute(sql<{ id: string }>`
      insert into public.device_tokens (school_id, user_id, expo_push_token, platform, last_seen_at)
      values (${schoolId}::uuid, ${userId}::uuid, ${input.expoPushToken}, ${input.platform}, now())
      on conflict (expo_push_token) do update
        set school_id = excluded.school_id, user_id = excluded.user_id,
            platform = excluded.platform, disabled_at = null, last_seen_at = now()
      returning id
    `);
    const row = (rows as unknown as ReadonlyArray<{ id: string }>)[0];
    if (!row) throw new Error('Unable to register device token');
    return row;
  }

  async listInbox(schoolId: string, userId: string, options: { cursor?: NotificationInboxCursor | undefined; limit: number; unreadOnly: boolean }): Promise<NotificationInboxPage> {
    const rows = await this.db.execute(sql<NotificationInboxItem>`
      select id, notification_type as "notificationType", title, body, data,
             read_at as "readAt", to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "createdAt"
      from public.notification_inbox
      where school_id = ${schoolId}::uuid and user_id = ${userId}::uuid
        and stale_at is null
        and (${options.unreadOnly} = false or read_at is null)
        and (
          ${options.cursor?.createdAt ?? null}::timestamptz is null
          or (created_at, id) < (
            ${options.cursor?.createdAt ?? null}::timestamptz,
            ${options.cursor?.id ?? null}::uuid
          )
        )
      order by created_at desc, id desc
      limit ${options.limit + 1}
    `);
    const values = rows as unknown as NotificationInboxItem[];
    const hasMore = values.length > options.limit;
    const items = hasMore ? values.slice(0, options.limit) : values;
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last
        ? encodeNotificationInboxCursor({ createdAt: last.createdAt, id: last.id })
        : null,
    };
  }

  async markRead(schoolId: string, userId: string, notificationId: string): Promise<boolean> {
    const rows = await this.db.execute(sql<{ id: string }>`
      update public.notification_inbox set read_at = coalesce(read_at, now())
      where id = ${notificationId}::uuid and school_id = ${schoolId}::uuid and user_id = ${userId}::uuid
      returning id
    `);
    return (rows as unknown as ReadonlyArray<{ id: string }>).length === 1;
  }

  async listActiveExpoTokens(schoolId: string, userId: string): Promise<ReadonlyArray<string>> {
    const rows = await this.db.execute(sql<{ expo_push_token: string }>`
      select expo_push_token from public.device_tokens
      where school_id = ${schoolId}::uuid and user_id = ${userId}::uuid and disabled_at is null
      order by last_seen_at desc
    `);
    return (rows as unknown as ReadonlyArray<{ expo_push_token: string }>).map((row) => row.expo_push_token);
  }
}
