import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { classes, schools, subjects, userProfiles } from './core.js';
import { studentAnnouncementCategory } from './student-home.js';

export const classAnnouncements = pgTable(
  'class_announcements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id').notNull().references(() => schools.id, { onDelete: 'cascade' }),
    audienceType: text('audience_type').$type<'class' | 'school'>().default('class').notNull(),
    classId: uuid('class_id').references(() => classes.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id').references(() => subjects.id, { onDelete: 'restrict' }),
    teacherId: uuid('teacher_id').notNull().references(() => userProfiles.id, { onDelete: 'restrict' }),
    category: studentAnnouncementCategory('category').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** Optional venue row on the announcement card (594:15213 card 4). */
    location: text('location'),
    /** Optional event date/time. Distinct from publishedAt, which is the publication instant. */
    eventAt: timestamp('event_at', { withTimezone: true }),
    isPublished: boolean('is_published').default(false).notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      'class_announcements_published_at_check',
      sql`(${table.isPublished} and ${table.publishedAt} is not null) or not ${table.isPublished}`,
    ),
    check(
      'class_announcements_audience_check',
      sql`(
        ${table.audienceType} = 'school' and ${table.classId} is null and ${table.subjectId} is null
      ) or (
        ${table.audienceType} = 'class' and ${table.classId} is not null and ${table.subjectId} is not null
      )`,
    ),
    index('class_announcements_student_cursor_idx').on(
      table.schoolId,
      table.classId,
      table.publishedAt.desc(),
      table.id.desc(),
    ).where(sql`${table.isPublished}`),
    index('class_announcements_teacher_cursor_idx').on(
      table.schoolId,
      table.teacherId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
);

export const announcementResources = pgTable(
  'announcement_resources',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id').notNull().references(() => schools.id, { onDelete: 'cascade' }),
    announcementId: uuid('announcement_id').notNull().references(() => classAnnouncements.id, { onDelete: 'cascade' }),
    uploadSessionId: uuid('upload_session_id').notNull(),
    objectPath: text('object_path').notNull(),
    displayName: text('display_name').notNull(),
    resourceType: text('resource_type').$type<'pdf' | 'image' | 'document'>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('announcement_resources_type_check', sql`${table.resourceType} in ('pdf', 'image', 'document')`),
    uniqueIndex('announcement_resources_upload_session_unique').on(table.uploadSessionId),
    uniqueIndex('announcement_resources_object_path_unique').on(table.objectPath),
    index('announcement_resources_parent_idx').on(
      table.schoolId,
      table.announcementId,
      table.createdAt,
      table.id,
    ),
  ],
);
