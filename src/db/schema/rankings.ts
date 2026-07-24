import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { classes, schools, subjects, userProfiles } from './core.js';

export const rankingScopeKind = pgEnum('ranking_scope_kind', ['class', 'subject']);

export const rankingRefreshScopes = pgTable(
  'ranking_refresh_scopes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id').notNull().references(() => schools.id, { onDelete: 'cascade' }),
    classId: uuid('class_id').notNull().references(() => classes.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id').references(() => subjects.id, { onDelete: 'cascade' }),
    scopeKind: rankingScopeKind('scope_kind').notNull(),
    dirtyVersion: bigint('dirty_version', { mode: 'number' }).notNull().default(1),
    refreshedVersion: bigint('refreshed_version', { mode: 'number' }).notNull().default(0),
    dirtyAt: timestamp('dirty_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('ranking_refresh_scopes_id_school_unique').on(table.id, table.schoolId),
    index('ranking_refresh_scopes_dirty_index').on(table.schoolId, table.dirtyAt)
      .where(sql`${table.dirtyVersion} > ${table.refreshedVersion}`),
  ],
);

export const rankingRefreshOutbox = pgTable(
  'ranking_refresh_outbox',
  {
    eventId: uuid('event_id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id').notNull().references(() => schools.id, { onDelete: 'cascade' }),
    scopeId: uuid('scope_id').notNull().references(() => rankingRefreshScopes.id, { onDelete: 'cascade' }),
    targetVersion: bigint('target_version', { mode: 'number' }).notNull(),
    dispatchAttempts: integer('dispatch_attempts').notNull().default(0),
    lastEnqueuedAt: timestamp('last_enqueued_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('ranking_refresh_outbox_scope_version_unique').on(table.scopeId, table.targetVersion)],
);

export const rankingSnapshots = pgTable(
  'ranking_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id').notNull().references(() => schools.id, { onDelete: 'cascade' }),
    classId: uuid('class_id').notNull().references(() => classes.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id').references(() => subjects.id, { onDelete: 'cascade' }),
    scopeId: uuid('scope_id').notNull().references(() => rankingRefreshScopes.id, { onDelete: 'cascade' }),
    sourceVersion: bigint('source_version', { mode: 'number' }).notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('ranking_snapshots_scope_version_unique').on(table.scopeId, table.sourceVersion),
    unique('ranking_snapshots_id_school_unique').on(table.id, table.schoolId),
  ],
);

export const rankingEntries = pgTable(
  'ranking_entries',
  {
    snapshotId: uuid('snapshot_id').notNull().references(() => rankingSnapshots.id, { onDelete: 'cascade' }),
    schoolId: uuid('school_id').notNull().references(() => schools.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => userProfiles.id, { onDelete: 'cascade' }),
    rank: integer('rank').notNull(),
    points: integer('points').notNull(),
    marks: numeric('marks', { precision: 7, scale: 2 }).notNull().default('0'),
    streakCount: integer('streak_count').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.snapshotId, table.userId] }),
    unique('ranking_entries_snapshot_rank_unique').on(table.snapshotId, table.rank),
    index('ranking_entries_user_index').on(table.schoolId, table.userId, table.snapshotId),
  ],
);

export const rankingsSchema = {
  rankingEntries,
  rankingRefreshOutbox,
  rankingRefreshScopes,
  rankingScopeKind,
  rankingSnapshots,
};
