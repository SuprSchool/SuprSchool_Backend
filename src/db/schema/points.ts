import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import type { PointMetadata, PointSourceType } from '../../types/points.js';
import { schools, userProfiles } from './core.js';

export const pointLevelRules = pgTable(
  'point_level_rules',
  {
    schoolId: uuid('school_id').notNull().references(() => schools.id, { onDelete: 'cascade' }),
    level: integer('level').notNull(),
    minimumPoints: integer('minimum_points').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.schoolId, table.level] }),
    unique('point_level_rules_school_minimum_points_unique').on(table.schoolId, table.minimumPoints),
  ],
);

export const pointEarningRules = pgTable(
  'point_earning_rules',
  {
    schoolId: uuid('school_id').notNull().references(() => schools.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    label: text('label').notNull(),
    icon: text('icon').notNull().$type<'document' | 'star' | 'fire' | 'medal' | 'calendar'>(),
    points: integer('points').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull(),
  },
  (table) => [primaryKey({ columns: [table.schoolId, table.code] })],
);

export const pointLedgerEntries = pgTable(
  'point_ledger_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id').notNull().references(() => schools.id, { onDelete: 'cascade' }),
    recipientUserId: uuid('recipient_user_id').notNull().references(() => userProfiles.id, { onDelete: 'cascade' }),
    sourceType: text('source_type').notNull().$type<PointSourceType>(),
    sourceId: text('source_id').notNull(),
    ruleCode: text('rule_code').notNull(),
    awardKey: text('award_key').notNull(),
    points: integer('points').notNull(),
    metadata: jsonb('metadata').notNull().$type<PointMetadata>().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('point_ledger_entries_school_award_key_unique').on(table.schoolId, table.awardKey),
    index('point_ledger_activity_index').on(
      table.schoolId,
      table.recipientUserId,
      table.occurredAt,
      table.id,
    ),
  ],
);

export const pointAccountBalances = pgTable(
  'point_account_balances',
  {
    schoolId: uuid('school_id').notNull().references(() => schools.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => userProfiles.id, { onDelete: 'cascade' }),
    currentPoints: integer('current_points').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.schoolId, table.userId] })],
);

export const rankingRefreshRequests = pgTable(
  'ranking_refresh_requests',
  {
    schoolId: uuid('school_id').notNull().references(() => schools.id, { onDelete: 'cascade' }),
    recipientUserId: uuid('recipient_user_id').notNull().references(() => userProfiles.id, { onDelete: 'cascade' }),
    isDirty: boolean('is_dirty').notNull().default(true),
    dirtyAt: timestamp('dirty_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.schoolId, table.recipientUserId] })],
);

export const pointsSchema = {
  pointAccountBalances,
  pointEarningRules,
  pointLedgerEntries,
  pointLevelRules,
  rankingRefreshRequests,
};
