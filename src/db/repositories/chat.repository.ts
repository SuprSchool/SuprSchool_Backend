import { sql } from 'drizzle-orm';

import type { Database } from '../client.js';
import { AppError } from '../../lib/errors.js';
import type {
  ChatCursorPage,
  ChatIdentity,
  ChatMessageDto,
  ChatMessagePage,
  ChatRoomAccess,
  ChatRoomSummary,
  CreateChatMessageInput,
} from '../../types/chat.js';

export interface ChatRepository {
  assertAccess(identity: ChatIdentity, roomId: string): Promise<ChatRoomAccess>;
  listRooms(identity: ChatIdentity): Promise<readonly ChatRoomSummary[]>;
  listMessages(access: ChatRoomAccess, page: ChatCursorPage): Promise<ChatMessagePage>;
  findMessageByClientId(access: ChatRoomAccess, clientMessageId: string): Promise<ChatMessageDto | undefined>;
  insertMessage(access: ChatRoomAccess, input: CreateChatMessageInput): Promise<ChatMessageDto>;
  advanceReadCursor(access: ChatRoomAccess, messageId: string): Promise<void>;
}

export interface ChatTypingPublisher {
  publishTyping(access: ChatRoomAccess, isTyping: boolean, expiresAt: string): Promise<void>;
}

interface ChatMessageRow {
  body: string;
  clientMessageId: string;
  createdAt: string;
  id: string;
  roomId: string;
  senderDisplayName: string;
  senderId: string;
  senderRole: 'student' | 'teacher';
}

interface ChatRoomRow {
  classId: string;
  id: string;
  kind: 'class' | 'subject';
  lastBody: string | null;
  lastClientMessageId: string | null;
  lastCreatedAt: string | null;
  lastId: string | null;
  lastSenderDisplayName: string | null;
  lastSenderId: string | null;
  lastSenderRole: 'student' | 'teacher' | null;
  name: string;
  subjectId: string | null;
  unreadCount: number | string;
}

interface ChatAccessRow {
  classId: string;
  hasAccess: boolean;
  id: string;
  kind: 'class' | 'subject';
  schoolId: string;
  subjectId: string | null;
}

export class DrizzleChatRepository implements ChatRepository, ChatTypingPublisher {
  public constructor(private readonly db: Database) {}

  public async assertAccess(identity: ChatIdentity, roomId: string): Promise<ChatRoomAccess> {
    const rows = await this.db.execute(sql<ChatAccessRow>`
      select
        room.id,
        room.school_id as "schoolId",
        room.class_id as "classId",
        room.subject_id as "subjectId",
        room.kind,
        (
          (${identity.role} = 'student' and exists (
            select 1
            from public.class_members membership
            join public.user_roles active_role
              on active_role.user_id = membership.student_id
             and active_role.school_id = membership.school_id
             and active_role.role = 'student'
             and active_role.is_active = true
            where membership.school_id = room.school_id
              and membership.class_id = room.class_id
              and membership.student_id = ${identity.userId}::uuid
              and membership.is_active = true
          ))
          or
          (${identity.role} = 'teacher' and exists (
            select 1
            from public.class_subjects assignment
            join public.user_roles active_role
              on active_role.user_id = assignment.teacher_id
             and active_role.school_id = assignment.school_id
             and active_role.role = 'teacher'
             and active_role.is_active = true
            where assignment.school_id = room.school_id
              and assignment.class_id = room.class_id
              and assignment.teacher_id = ${identity.userId}::uuid
              and (room.kind = 'class' or assignment.subject_id = room.subject_id)
          ))
        ) as "hasAccess"
      from public.chat_rooms room
      where room.id = ${roomId}::uuid and room.school_id = ${identity.schoolId}::uuid
      limit 1
    `);
    const room = first<ChatAccessRow>(rows);
    if (!room) throw new AppError('NOT_FOUND', 404, 'Chat room not found');
    if (!room.hasAccess) throw new AppError('FORBIDDEN', 403, 'You cannot access this chat room');
    return { ...room, userId: identity.userId };
  }

  public async listRooms(identity: ChatIdentity): Promise<readonly ChatRoomSummary[]> {
    const rows = await this.db.execute(sql<ChatRoomRow>`
      select
        room.id,
        room.class_id as "classId",
        room.subject_id as "subjectId",
        room.kind,
        case when room.kind = 'class' then class.display_name else subject.name end as name,
        latest.id as "lastId",
        latest.client_message_id as "lastClientMessageId",
        latest.body as "lastBody",
        to_char(latest.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "lastCreatedAt",
        latest.sender_id as "lastSenderId",
        latest.sender_display_name as "lastSenderDisplayName",
        latest.sender_role as "lastSenderRole",
        unread.count as "unreadCount"
      from public.chat_rooms room
      join public.classes class on class.id = room.class_id and class.school_id = room.school_id
      left join public.subjects subject on subject.id = room.subject_id and subject.school_id = room.school_id
      left join public.chat_read_cursors cursor
        on cursor.school_id = room.school_id and cursor.room_id = room.id and cursor.user_id = ${identity.userId}::uuid
      left join public.chat_messages last_read
        on last_read.id = cursor.last_read_message_id and last_read.school_id = room.school_id and last_read.room_id = room.id
      left join lateral (
        select
          message.id,
          message.client_message_id,
          message.body,
          message.created_at,
          message.sender_id,
          profile.display_name as sender_display_name,
          sender_role.role as sender_role
        from public.chat_messages message
        join public.user_profiles profile on profile.id = message.sender_id and profile.school_id = message.school_id
        join public.user_roles sender_role
          on sender_role.user_id = message.sender_id
         and sender_role.school_id = message.school_id
         and sender_role.is_active = true
         and sender_role.role in ('student', 'teacher')
        where message.school_id = room.school_id and message.room_id = room.id
        order by message.created_at desc, message.id desc
        limit 1
      ) latest on true
      left join lateral (
        select count(*)::int as count
        from public.chat_messages message
        where message.school_id = room.school_id
          and message.room_id = room.id
          and message.sender_id <> ${identity.userId}::uuid
          and (
            last_read.id is null
            or (message.created_at, message.id) > (last_read.created_at, last_read.id)
          )
      ) unread on true
      where room.school_id = ${identity.schoolId}::uuid
        and (
          (${identity.role} = 'student' and exists (
            select 1 from public.class_members membership
            join public.user_roles active_role
              on active_role.user_id = membership.student_id
             and active_role.school_id = membership.school_id
             and active_role.role = 'student'
             and active_role.is_active = true
            where membership.school_id = room.school_id and membership.class_id = room.class_id
              and membership.student_id = ${identity.userId}::uuid and membership.is_active = true
          ))
          or
          (${identity.role} = 'teacher' and exists (
            select 1 from public.class_subjects assignment
            join public.user_roles active_role
              on active_role.user_id = assignment.teacher_id
             and active_role.school_id = assignment.school_id
             and active_role.role = 'teacher'
             and active_role.is_active = true
            where assignment.school_id = room.school_id and assignment.class_id = room.class_id
              and assignment.teacher_id = ${identity.userId}::uuid
              and (room.kind = 'class' or assignment.subject_id = room.subject_id)
          ))
        )
      order by latest.created_at desc nulls last, latest.id desc nulls last, room.id
    `);
    return (rows as unknown as ChatRoomRow[]).map((row) => ({
      classId: row.classId,
      id: row.id,
      kind: row.kind,
      lastMessage: row.lastId === null ? null : messageFromRow({
        body: row.lastBody!, clientMessageId: row.lastClientMessageId!, createdAt: row.lastCreatedAt!, id: row.lastId,
        roomId: row.id, senderDisplayName: row.lastSenderDisplayName!, senderId: row.lastSenderId!, senderRole: row.lastSenderRole!,
      }),
      name: row.name,
      subjectId: row.subjectId,
      unreadCount: Number(row.unreadCount),
    }));
  }

  public async listMessages(access: ChatRoomAccess, page: ChatCursorPage): Promise<ChatMessagePage> {
    const isAfter = page.after !== undefined;
    const rows = await this.db.execute(sql<ChatMessageRow>`
      select * from (
        select
          message.id,
          message.room_id as "roomId",
          message.client_message_id as "clientMessageId",
          message.body,
          to_char(message.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",
          message.sender_id as "senderId",
          profile.display_name as "senderDisplayName",
          sender_role.role as "senderRole",
          message.created_at as raw_created_at
        from public.chat_messages message
        join public.user_profiles profile on profile.id = message.sender_id and profile.school_id = message.school_id
        join public.user_roles sender_role
          on sender_role.user_id = message.sender_id and sender_role.school_id = message.school_id
         and sender_role.is_active = true and sender_role.role in ('student', 'teacher')
        where message.school_id = ${access.schoolId}::uuid and message.room_id = ${access.id}::uuid
          and (${page.after?.createdAt ?? null}::timestamptz is null or (message.created_at, message.id) > (${page.after?.createdAt ?? null}::timestamptz, ${page.after?.id ?? null}::uuid))
          and (${page.before?.createdAt ?? null}::timestamptz is null or (message.created_at, message.id) < (${page.before?.createdAt ?? null}::timestamptz, ${page.before?.id ?? null}::uuid))
        order by
          case when ${isAfter} then message.created_at end asc,
          case when ${isAfter} then message.id end asc,
          case when ${!isAfter} then message.created_at end desc,
          case when ${!isAfter} then message.id end desc
        limit ${page.limit + 1}
      ) selected
      order by
        case when ${isAfter} then raw_created_at end asc,
        case when ${isAfter} then id end asc,
        case when ${!isAfter} then raw_created_at end desc,
        case when ${!isAfter} then id end desc
    `);
    const selected = rows as unknown as ChatMessageRow[];
    const hasMore = selected.length > page.limit;
    const items = selected
      .slice(0, page.limit)
      .map(messageFromRow)
      .sort((left, right) => (
        left.createdAt === right.createdAt
          ? left.id.localeCompare(right.id)
          : left.createdAt.localeCompare(right.createdAt)
      ));
    const edge = isAfter ? items.at(-1) : items.at(0);
    return { items, ...(hasMore && edge ? { nextCursor: { createdAt: edge.createdAt, id: edge.id } } : {}) };
  }

  public async findMessageByClientId(access: ChatRoomAccess, clientMessageId: string): Promise<ChatMessageDto | undefined> {
    const rows = await this.messageRows(sql<ChatMessageRow>`
      select message.id, message.room_id as "roomId", message.client_message_id as "clientMessageId", message.body,
        to_char(message.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",
        message.sender_id as "senderId", profile.display_name as "senderDisplayName", sender_role.role as "senderRole"
      from public.chat_messages message
      join public.user_profiles profile on profile.id = message.sender_id and profile.school_id = message.school_id
      join public.user_roles sender_role on sender_role.user_id = message.sender_id and sender_role.school_id = message.school_id
        and sender_role.is_active = true and sender_role.role in ('student', 'teacher')
      where message.school_id = ${access.schoolId}::uuid and message.room_id = ${access.id}::uuid
        and message.sender_id = ${access.userId}::uuid and message.client_message_id = ${clientMessageId}::uuid
      order by sender_role.role
      limit 1
    `);
    return rows[0] ? messageFromRow(rows[0]) : undefined;
  }

  public async insertMessage(access: ChatRoomAccess, input: CreateChatMessageInput): Promise<ChatMessageDto> {
    const rows = await this.messageRows(sql<ChatMessageRow>`
      with inserted as (
        insert into public.chat_messages (school_id, room_id, sender_id, client_message_id, body)
        values (${access.schoolId}::uuid, ${access.id}::uuid, ${access.userId}::uuid, ${input.clientMessageId}::uuid, ${input.body})
        on conflict (school_id, room_id, sender_id, client_message_id) do nothing
        returning id, school_id, room_id, sender_id, client_message_id, body, created_at
      )
      select inserted.id, inserted.room_id as "roomId", inserted.client_message_id as "clientMessageId", inserted.body,
        to_char(inserted.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",
        inserted.sender_id as "senderId", profile.display_name as "senderDisplayName", sender_role.role as "senderRole"
      from inserted
      join public.user_profiles profile on profile.id = inserted.sender_id and profile.school_id = inserted.school_id
      join public.user_roles sender_role on sender_role.user_id = inserted.sender_id and sender_role.school_id = inserted.school_id
        and sender_role.is_active = true and sender_role.role in ('student', 'teacher')
      order by sender_role.role
      limit 1
    `);
    if (rows[0]) return messageFromRow(rows[0]);
    const existing = await this.findMessageByClientId(access, input.clientMessageId);
    if (existing) return existing;
    throw new Error('Unable to persist chat message');
  }

  public async advanceReadCursor(access: ChatRoomAccess, messageId: string): Promise<void> {
    const rows = await this.db.execute(sql<{ targetFound: boolean }>`
      with target as (
        select id, created_at from public.chat_messages
        where school_id = ${access.schoolId}::uuid and room_id = ${access.id}::uuid and id = ${messageId}::uuid
      ), upserted as (
        insert into public.chat_read_cursors as cursor (school_id, room_id, user_id, last_read_message_id, last_read_at)
        select ${access.schoolId}::uuid, ${access.id}::uuid, ${access.userId}::uuid, target.id, now() from target
        on conflict (school_id, room_id, user_id) do update
          set last_read_message_id = excluded.last_read_message_id, last_read_at = now(), updated_at = now()
          where cursor.last_read_message_id is null or exists (
            select 1 from target
            join public.chat_messages previous on previous.id = cursor.last_read_message_id
              and previous.school_id = cursor.school_id and previous.room_id = cursor.room_id
            where (target.created_at, target.id) > (previous.created_at, previous.id)
          )
        returning 1
      )
      select exists(select 1 from target) as "targetFound"
    `);
    if (!first<{ targetFound: boolean }>(rows)?.targetFound) throw new AppError('NOT_FOUND', 404, 'Chat message not found');
  }

  public async publishTyping(access: ChatRoomAccess, isTyping: boolean, expiresAt: string): Promise<void> {
    await this.db.execute(sql`
      select realtime.send(
        jsonb_build_object('userId', ${access.userId}::uuid, 'isTyping', ${isTyping}, 'expiresAt', ${expiresAt}::timestamptz),
        'typing.changed',
        format('chat:%s:%s', ${access.schoolId}::uuid, ${access.id}::uuid),
        true
      )
    `);
  }

  private async messageRows(query: ReturnType<typeof sql<ChatMessageRow>>): Promise<ChatMessageRow[]> {
    const rows = await this.db.execute(query);
    return rows as unknown as ChatMessageRow[];
  }
}

function first<T>(rows: unknown): T | undefined {
  return (rows as T[])[0];
}

function messageFromRow(row: ChatMessageRow): ChatMessageDto {
  return {
    body: row.body,
    clientMessageId: row.clientMessageId,
    createdAt: row.createdAt,
    id: row.id,
    roomId: row.roomId,
    sender: { displayName: row.senderDisplayName, id: row.senderId, role: row.senderRole },
  };
}
