import { relations } from 'drizzle-orm';
import {
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { classes, classSubjects, schools, userProfiles } from './core.js';

export const classDiaryEntries = pgTable(
  'class_diary_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    classSubjectId: uuid('class_subject_id')
      .notNull()
      .references(() => classSubjects.id, { onDelete: 'cascade' }),
    teacherId: uuid('teacher_id')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'restrict' }),
    occurredOn: date('occurred_on').notNull(),
    periodLabel: text('period_label').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    keyPoints: jsonb('key_points').$type<string[]>().default([]).notNull(),
    revision: integer('revision').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('class_diary_entries_class_subject_date_period_unique').on(
      table.classSubjectId,
      table.occurredOn,
      table.periodLabel,
    ),
    index('class_diary_entries_school_subject_occurred_id_index').on(
      table.schoolId,
      table.classSubjectId,
      table.occurredOn,
      table.id,
    ),
    index('class_diary_entries_school_class_occurred_id_index').on(
      table.schoolId,
      table.classId,
      table.occurredOn,
      table.id,
    ),
  ],
);

export const classDiaryEntriesRelations = relations(classDiaryEntries, ({ one }) => ({
  class: one(classes, {
    fields: [classDiaryEntries.classId],
    references: [classes.id],
  }),
  classSubject: one(classSubjects, {
    fields: [classDiaryEntries.classSubjectId],
    references: [classSubjects.id],
  }),
  school: one(schools, {
    fields: [classDiaryEntries.schoolId],
    references: [schools.id],
  }),
  teacher: one(userProfiles, {
    fields: [classDiaryEntries.teacherId],
    references: [userProfiles.id],
  }),
}));

export const diarySchema = { classDiaryEntries };
