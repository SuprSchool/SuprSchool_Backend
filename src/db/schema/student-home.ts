import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { classes, schools, subjects, userProfiles } from './core.js';

export const studentAnnouncementCategoryValues = [
  'School',
  'Class',
  'Sports',
  'Parents',
] as const;

export const studentAnnouncementCategory = pgEnum(
  'student_announcement_category',
  studentAnnouncementCategoryValues,
);

export const studentProfiles = pgTable(
  'student_profiles',
  {
    studentId: uuid('student_id')
      .primaryKey()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    dateOfBirth: date('date_of_birth').notNull(),
  },
);

export const classAnnouncements = pgTable(
  'class_announcements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    category: studentAnnouncementCategory('category').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    isPublished: boolean('is_published').default(false).notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      'class_announcements_published_at_check',
      sql`(${table.isPublished} and ${table.publishedAt} is not null) or not ${table.isPublished}`,
    ),
    index('class_announcements_home_lookup').on(
      table.schoolId,
      table.classId,
      table.isPublished,
      table.publishedAt,
    ),
  ],
);
export const classExams = pgTable(
  'class_exams',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    scheduledOn: date('scheduled_on').notNull(),
    isPublished: boolean('is_published').default(false).notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'class_exams_published_at_check',
      sql`(${table.isPublished} and ${table.publishedAt} is not null) or not ${table.isPublished}`,
    ),
    index('class_exams_home_lookup').on(
      table.schoolId,
      table.classId,
      table.isPublished,
      table.scheduledOn,
    ),
  ],
);

export const classScheduleSlots = pgTable(
  'class_schedule_slots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    dayOfWeek: integer('day_of_week').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    room: text('room'),
  },
  (table) => [
    check('class_schedule_slots_day_of_week_check', sql`${table.dayOfWeek} between 0 and 6`),
    check('class_schedule_slots_time_order_check', sql`${table.endTime} > ${table.startTime}`),
    uniqueIndex('class_schedule_slots_unique').on(
      table.classId,
      table.dayOfWeek,
      table.startTime,
    ),
    index('class_schedule_slots_home_lookup').on(
      table.schoolId,
      table.classId,
      table.dayOfWeek,
      table.startTime,
    ),
  ],
);
