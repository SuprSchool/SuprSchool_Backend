import { sql } from 'drizzle-orm';

import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { classes, schools, userProfiles } from './core.js';

export const events = pgTable(
  'events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id').notNull().references(() => schools.id),
    createdByTeacherId: uuid('created_by_teacher_id').notNull().references(() => userProfiles.id),
    activityKind: text('activity_kind').notNull(),
    category: text('category'),
    participationMode: text('participation_mode'),
    title: text('title').notNull(),
    description: text('description'),
    venue: text('venue'),
    eligibilityCriteria: text('eligibility_criteria'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    registrationDeadlineAt: timestamp('registration_deadline_at', { withTimezone: true }),
    lifecycle: text('lifecycle').notNull().default('draft'),
    resultsPublishedAt: timestamp('results_published_at', { withTimezone: true }),
    resultsRevision: integer('results_revision').notNull().default(0),
    managerRevision: integer('manager_revision').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('events_school_lifecycle_starts_id_idx').on(
      table.schoolId,
      table.lifecycle,
      table.startsAt,
      table.id,
    ),
    index('events_school_created_id_idx').on(table.schoolId, table.createdAt, table.id),
  ],
);

export const eventAudiences = pgTable(
  'event_audiences',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id').notNull().references(() => schools.id),
    eventId: uuid('event_id').notNull().references(() => events.id),
    classId: uuid('class_id').notNull().references(() => classes.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('event_audiences_event_class_unique').on(table.eventId, table.classId),
    index('event_audiences_school_class_event_idx').on(table.schoolId, table.classId, table.eventId),
  ],
);

export const eventManagers = pgTable(
  'event_managers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id').notNull().references(() => schools.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => userProfiles.id, { onDelete: 'cascade' }),
    memberType: text('member_type').notNull(),
    managerRole: text('manager_role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('event_managers_member_type_check', sql`${table.memberType} in ('teacher', 'student')`),
    check('event_managers_manager_role_check', sql`char_length(btrim(${table.managerRole})) between 1 and 120`),
    uniqueIndex('event_managers_event_user_unique').on(table.eventId, table.userId),
    index('event_managers_school_user_event_idx').on(table.schoolId, table.userId, table.eventId),
  ],
);

export const eventRegistrations = pgTable(
  'event_registrations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id').notNull().references(() => schools.id),
    eventId: uuid('event_id').notNull().references(() => events.id),
    studentId: uuid('student_id').notNull().references(() => userProfiles.id),
    participationTag: text('participation_tag'),
    participationRevision: integer('participation_revision').notNull().default(0),
    registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('event_registrations_event_student_unique').on(table.eventId, table.studentId),
    index('event_registrations_school_student_event_idx').on(table.schoolId, table.studentId, table.eventId),
  ],
);

export const eventTeams = pgTable(
  'event_teams',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id').notNull().references(() => schools.id),
    eventId: uuid('event_id').notNull().references(() => events.id),
    name: text('name').notNull(),
    createdByStudentId: uuid('created_by_student_id').references(() => userProfiles.id),
    createdByTeacherId: uuid('created_by_teacher_id').references(() => userProfiles.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('event_teams_school_event_idx').on(table.schoolId, table.eventId)],
);

export const eventTeamMembers = pgTable(
  'event_team_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id').notNull().references(() => schools.id),
    eventId: uuid('event_id').notNull().references(() => events.id),
    teamId: uuid('team_id').notNull().references(() => eventTeams.id),
    studentId: uuid('student_id').notNull().references(() => userProfiles.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('event_team_members_team_student_unique').on(table.teamId, table.studentId),
    uniqueIndex('event_team_members_event_student_unique').on(table.eventId, table.studentId),
  ],
);

export const eventResultEntries = pgTable(
  'event_result_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id').notNull().references(() => schools.id),
    eventId: uuid('event_id').notNull().references(() => events.id),
    targetType: text('target_type').notNull(),
    registrationId: uuid('registration_id').references(() => eventRegistrations.id),
    teamId: uuid('team_id').references(() => eventTeams.id),
    score: numeric('score'),
    denseRank: integer('dense_rank'),
    revision: integer('revision').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('event_result_entries_target_type_check', sql`${table.targetType} in ('registration', 'team')`),
    check('event_result_entries_dense_rank_check', sql`${table.denseRank} is null or ${table.denseRank} > 0`),
    check('event_result_entries_revision_check', sql`${table.revision} >= 0`),
    check('event_result_entries_target_check', sql`(${table.targetType} = 'registration' and ${table.registrationId} is not null and ${table.teamId} is null) or (${table.targetType} = 'team' and ${table.teamId} is not null and ${table.registrationId} is null)`),
    uniqueIndex('event_results_registration_target_unique').on(table.eventId, table.registrationId).where(sql`${table.targetType} = 'registration'`),
    uniqueIndex('event_results_team_target_unique').on(table.eventId, table.teamId).where(sql`${table.targetType} = 'team'`),
    index('event_results_school_event_rank_idx').on(table.schoolId, table.eventId, table.denseRank, table.id),
  ],
);

export const eventDomainOutbox = pgTable(
  'event_domain_outbox',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id').notNull(),
    schoolId: uuid('school_id').notNull().references(() => schools.id),
    eventType: text('event_type').notNull(),
    sourceKey: text('source_key').notNull(),
    payload: jsonb('payload').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('event_domain_outbox_event_id_unique').on(table.eventId),
    uniqueIndex('event_domain_outbox_source_key_unique').on(table.sourceKey),
  ],
);

export const eventsSchema = {
  eventAudiences,
  eventDomainOutbox,
  eventManagers,
  eventRegistrations,
  eventResultEntries,
  eventTeamMembers,
  eventTeams,
  events,
};
