import { relations } from 'drizzle-orm';
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { classes, schools, subjects, userProfiles } from './core.js';

export const classRecordings = pgTable(
  'class_recordings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id').notNull().references(() => schools.id, { onDelete: 'cascade' }),
    classId: uuid('class_id').notNull().references(() => classes.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id').notNull().references(() => subjects.id, { onDelete: 'restrict' }),
    createdByTeacherId: uuid('created_by_teacher_id').notNull().references(() => userProfiles.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    description: text('description'),
    // Resolved once from the timetable when the draft is created. Null for rows
    // predating the column and for recordings made outside any timetable slot.
    period: text('period'),
    status: text('status').$type<'draft' | 'published' | 'deleted'>().notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('class_recordings_student_feed_idx').on(table.schoolId, table.classId, table.subjectId, table.publishedAt, table.id),
    index('class_recordings_student_all_subjects_feed_idx').on(table.schoolId, table.classId, table.publishedAt, table.id),
    index('class_recordings_teacher_feed_idx').on(table.schoolId, table.classId, table.createdAt, table.id),
  ],
);

export const recordingAudioAssets = pgTable(
  'recording_audio_assets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    recordingId: uuid('recording_id').notNull().references(() => classRecordings.id, { onDelete: 'cascade' }),
    schoolId: uuid('school_id').notNull().references(() => schools.id, { onDelete: 'cascade' }),
    objectPath: text('object_path').notNull(),
    contentType: text('content_type').notNull(),
    codec: text('codec').notNull(),
    channels: integer('channels').notNull(),
    bitrateBps: bigint('bitrate_bps', { mode: 'number' }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    durationMs: bigint('duration_ms', { mode: 'number' }).notNull(),
    state: text('state').$type<'confirmed' | 'deleted'>().notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('recording_audio_assets_recording_unique').on(table.recordingId),
    uniqueIndex('recording_audio_assets_object_path_unique').on(table.objectPath),
  ],
);

export const recordingUploadSessions = pgTable(
  'recording_upload_sessions',
  {
    id: uuid('id').primaryKey(),
    schoolId: uuid('school_id').notNull().references(() => schools.id, { onDelete: 'cascade' }),
    recordingId: uuid('recording_id').notNull().references(() => classRecordings.id, { onDelete: 'cascade' }),
    teacherId: uuid('teacher_id').notNull().references(() => userProfiles.id, { onDelete: 'cascade' }),
    objectPath: text('object_path').notNull(),
    expectedContentType: text('expected_content_type').notNull(),
    expectedSizeBytes: bigint('expected_size_bytes', { mode: 'number' }).notNull(),
    expectedDurationMs: bigint('expected_duration_ms', { mode: 'number' }).notNull(),
    status: text('status').$type<'reserved' | 'pending' | 'confirmed' | 'superseded'>().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('recording_upload_sessions_object_path_unique').on(table.objectPath),
    index('recording_upload_sessions_teacher_pending_idx').on(table.schoolId, table.teacherId, table.expiresAt),
  ],
);

export const recordingPlaybackSessions = pgTable(
  'recording_playback_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sequence: bigint('sequence', { mode: 'number' }).notNull(),
    schoolId: uuid('school_id').notNull().references(() => schools.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id').notNull().references(() => userProfiles.id, { onDelete: 'cascade' }),
    recordingId: uuid('recording_id').notNull().references(() => classRecordings.id, { onDelete: 'cascade' }),
    issuedAt: timestamp('issued_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('recording_playback_sessions_sequence_unique').on(table.sequence),
    index('recording_playback_sessions_lookup_idx').on(table.schoolId, table.studentId, table.recordingId, table.expiresAt, table.sequence),
  ],
);

export const recordingProgress = pgTable(
  'recording_progress',
  {
    schoolId: uuid('school_id').notNull().references(() => schools.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id').notNull().references(() => userProfiles.id, { onDelete: 'cascade' }),
    recordingId: uuid('recording_id').notNull().references(() => classRecordings.id, { onDelete: 'cascade' }),
    positionMs: bigint('position_ms', { mode: 'number' }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    playbackSessionId: uuid('playback_session_id').notNull(),
    playbackSessionSequence: bigint('playback_session_sequence', { mode: 'number' }).notNull(),
    clientSequence: bigint('client_sequence', { mode: 'number' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('recording_progress_student_recording_unique').on(table.schoolId, table.studentId, table.recordingId),
    index('recording_progress_student_updated_idx').on(table.schoolId, table.studentId, table.updatedAt),
  ],
);

export const recordingResources = pgTable(
  'recording_resources',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id').notNull().references(() => schools.id, { onDelete: 'cascade' }),
    recordingId: uuid('recording_id').notNull().references(() => classRecordings.id, { onDelete: 'cascade' }),
    uploadSessionId: uuid('upload_session_id'),
    kind: text('kind').$type<'attachment' | 'banner'>().notNull(),
    displayName: text('display_name').notNull(),
    objectPath: text('object_path').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sortOrder: integer('sort_order').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('recording_resources_object_path_unique').on(table.objectPath),
    uniqueIndex('recording_resources_upload_session_unique').on(table.uploadSessionId),
    uniqueIndex('recording_resources_kind_sort_order_unique').on(table.recordingId, table.kind, table.sortOrder),
  ],
);

export const recordingCleanupIntents = pgTable(
  'recording_cleanup_intents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id').notNull().references(() => schools.id, { onDelete: 'cascade' }),
    recordingId: uuid('recording_id').notNull().references(() => classRecordings.id, { onDelete: 'cascade' }),
    objectPath: text('object_path').notNull(),
    reason: text('reason').$type<'confirmation_failed' | 'deleted' | 'expired' | 'provision_failed' | 'replaced' | 'superseded'>().notNull(),
    state: text('state').$type<'pending' | 'completed'>().notNull(),
    attemptCount: integer('attempt_count').notNull(),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('recording_cleanup_intents_object_path_unique').on(table.objectPath),
    index('recording_cleanup_intents_pending_idx').on(table.nextAttemptAt, table.id),
  ],
);

export const recordingOutboxEvents = pgTable(
  'recording_outbox_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id').notNull().references(() => schools.id, { onDelete: 'cascade' }),
    recordingId: uuid('recording_id').notNull().references(() => classRecordings.id, { onDelete: 'cascade' }),
    eventKey: text('event_key').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('recording_outbox_events_event_key_unique').on(table.schoolId, table.eventKey),
    index('recording_outbox_events_pending_idx').on(table.createdAt, table.id),
  ],
);

export const classRecordingsRelations = relations(classRecordings, ({ one, many }) => ({
  audio: one(recordingAudioAssets),
  class: one(classes, { fields: [classRecordings.classId], references: [classes.id] }),
  resources: many(recordingResources),
  school: one(schools, { fields: [classRecordings.schoolId], references: [schools.id] }),
  subject: one(subjects, { fields: [classRecordings.subjectId], references: [subjects.id] }),
}));

export const recordingsSchema = {
  classRecordings,
  recordingAudioAssets,
  recordingCleanupIntents,
  recordingOutboxEvents,
  recordingPlaybackSessions,
  recordingProgress,
  recordingResources,
  recordingUploadSessions,
};
