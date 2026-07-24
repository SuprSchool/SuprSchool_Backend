import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { classes, schools, subjects, userProfiles } from './core.js';
import { chatRoomKindValues } from '../../types/chat.js';

export const chatRoomKind = pgEnum('chat_room_kind', chatRoomKindValues);

export const chatRooms = pgTable(
  'chat_rooms',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id').references(() => subjects.id, {
      onDelete: 'cascade',
    }),
    kind: chatRoomKind('kind').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      'chat_rooms_kind_subject_check',
      sql`(${table.kind} = 'class' and ${table.subjectId} is null) or (${table.kind} = 'subject' and ${table.subjectId} is not null)`,
    ),
    uniqueIndex('chat_rooms_class_unique')
      .on(table.schoolId, table.classId)
      .where(sql`${table.kind} = 'class'`),
    uniqueIndex('chat_rooms_subject_unique')
      .on(table.schoolId, table.classId, table.subjectId)
      .where(sql`${table.kind} = 'subject'`),
  ],
);

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    roomId: uuid('room_id')
      .notNull()
      .references(() => chatRooms.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'restrict' }),
    clientMessageId: uuid('client_message_id').notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      'chat_messages_body_length_check',
      sql`char_length(${table.body}) between 1 and 2000`,
    ),
    unique('chat_messages_sender_client_message_unique').on(
      table.schoolId,
      table.roomId,
      table.senderId,
      table.clientMessageId,
    ),
    index('chat_messages_history_index').on(
      table.schoolId,
      table.roomId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
);

export const chatReadCursors = pgTable(
  'chat_read_cursors',
  {
    schoolId: uuid('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    roomId: uuid('room_id')
      .notNull()
      .references(() => chatRooms.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    lastReadMessageId: uuid('last_read_message_id').references(
      () => chatMessages.id,
      { onDelete: 'set null' },
    ),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: 'chat_read_cursors_pkey',
      columns: [table.schoolId, table.roomId, table.userId],
    }),
    index('chat_read_cursors_user_room_index').on(
      table.schoolId,
      table.userId,
      table.roomId,
    ),
  ],
);

export const chatSchema = {
  chatMessages,
  chatReadCursors,
  chatRoomKind,
  chatRooms,
};
