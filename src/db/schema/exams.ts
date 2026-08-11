import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { classes, schools, subjects, userProfiles } from './core.js';

export const examGroups = pgTable(
  'exam_groups',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id').notNull().references(() => schools.id, { onDelete: 'cascade' }),
    classId: uuid('class_id').notNull().references(() => classes.id, { onDelete: 'cascade' }),
    creatorTeacherId: uuid('creator_teacher_id').notNull().references(() => userProfiles.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    state: text('state').$type<'draft' | 'published' | 'archived'>().default('draft').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    check('exam_groups_date_range_check', sql`${table.endsOn} >= ${table.startsOn}`),
    check('exam_groups_state_check', sql`${table.state} in ('draft', 'published', 'archived')`),
    index('exam_groups_student_cursor_idx').on(
      table.schoolId,
      table.classId,
      table.startsOn.desc(),
      table.id.desc(),
    ).where(sql`${table.deletedAt} is null`),
  ],
);

// class_exams predates this feature and remains the subject-assessment table used by student home.
export const classExams = pgTable(
  'class_exams',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id').notNull().references(() => schools.id, { onDelete: 'cascade' }),
    classId: uuid('class_id').notNull().references(() => classes.id, { onDelete: 'cascade' }),
    examGroupId: uuid('exam_group_id').references(() => examGroups.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id').notNull().references(() => subjects.id, { onDelete: 'cascade' }),
    teacherId: uuid('teacher_id').references(() => userProfiles.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    scheduledOn: date('scheduled_on').notNull(),
    startsAt: time('starts_at'),
    endsAt: time('ends_at'),
    maxMarks: doublePrecision('max_marks'),
    syllabus: text('syllabus'),
    isPublished: boolean('is_published').default(false).notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'class_exams_time_order_check',
      sql`(${table.startsAt} is null and ${table.endsAt} is null)
        or (${table.startsAt} is not null and ${table.endsAt} is not null and ${table.endsAt} > ${table.startsAt})`,
    ),
    check('class_exams_max_marks_check', sql`${table.maxMarks} is null or ${table.maxMarks} > 0`),
    check(
      'class_exams_published_at_check',
      sql`(${table.isPublished} and ${table.publishedAt} is not null) or not ${table.isPublished}`,
    ),
    index('class_exams_group_subject_cursor_idx').on(
      table.schoolId,
      table.examGroupId,
      table.scheduledOn.desc(),
      table.id.desc(),
    ).where(sql`${table.isPublished} and ${table.deletedAt} is null`),
    index('class_exams_teacher_cursor_idx').on(
      table.schoolId,
      table.teacherId,
      table.scheduledOn.desc(),
      table.id.desc(),
    ).where(sql`${table.deletedAt} is null`),
  ],
);

export const examRubrics = pgTable(
  'exam_rubrics',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    assessmentId: uuid('assessment_id').notNull().references(() => classExams.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    sectionTitle: text('section_title').notNull(),
    marks: doublePrecision('marks').notNull(),
    description: text('description').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('exam_rubrics_position_check', sql`${table.position} between 1 and 100`),
    check('exam_rubrics_marks_check', sql`${table.marks} >= 0`),
    unique('exam_rubrics_assessment_position_unique').on(table.assessmentId, table.position),
  ],
);

export const examSubmissions = pgTable(
  'exam_submissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id').notNull().references(() => schools.id, { onDelete: 'cascade' }),
    assessmentId: uuid('assessment_id').notNull().references(() => classExams.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id').notNull().references(() => userProfiles.id, { onDelete: 'cascade' }),
    recordedByTeacherId: uuid('recorded_by_teacher_id').notNull().references(() => userProfiles.id, { onDelete: 'restrict' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('exam_submissions_assessment_student_unique').on(table.assessmentId, table.studentId),
    index('exam_submissions_assessment_submitted_idx').on(
      table.schoolId,
      table.assessmentId,
      table.submittedAt.desc(),
      table.studentId,
    ),
  ],
);

export const examResults = pgTable(
  'exam_results',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id').notNull().references(() => schools.id, { onDelete: 'cascade' }),
    assessmentId: uuid('assessment_id').notNull().references(() => classExams.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id').notNull().references(() => userProfiles.id, { onDelete: 'cascade' }),
    enteredByTeacherId: uuid('entered_by_teacher_id').notNull().references(() => userProfiles.id, { onDelete: 'restrict' }),
    marks: doublePrecision('marks').notNull(),
    feedback: text('feedback'),
    /**
     * Per-section secured marks keyed by `exam_rubrics.position` (253:8504
     * prints "20/25 Marks"). Null until evaluation records it — the grading
     * write path stores a single total mark and has no per-section input yet.
     */
    rubricSecuredMarks: jsonb('rubric_secured_marks').$type<Record<string, number>>(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('exam_results_marks_check', sql`${table.marks} >= 0`),
    check(
      'exam_results_rubric_secured_marks_check',
      sql`${table.rubricSecuredMarks} is null or jsonb_typeof(${table.rubricSecuredMarks}) = 'object'`,
    ),
    unique('exam_results_assessment_student_unique').on(table.assessmentId, table.studentId),
    index('exam_results_assessment_cursor_idx').on(
      table.assessmentId,
      table.updatedAt.desc(),
      table.id.desc(),
    ),
    index('exam_results_group_leaderboard_idx').on(
      table.schoolId,
      table.assessmentId,
      table.studentId,
      table.marks,
    ),
  ],
);

export const examResultRevisions = pgTable(
  'exam_result_revisions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    resultId: uuid('result_id').notNull().references(() => examResults.id, { onDelete: 'cascade' }),
    schoolId: uuid('school_id').notNull().references(() => schools.id, { onDelete: 'cascade' }),
    assessmentId: uuid('assessment_id').notNull().references(() => classExams.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id').notNull().references(() => userProfiles.id, { onDelete: 'cascade' }),
    enteredByTeacherId: uuid('entered_by_teacher_id').notNull().references(() => userProfiles.id, { onDelete: 'restrict' }),
    marks: doublePrecision('marks').notNull(),
    feedback: text('feedback'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('exam_result_revisions_marks_check', sql`${table.marks} >= 0`),
    index('exam_result_revisions_result_created_idx').on(table.resultId, table.createdAt.desc(), table.id.desc()),
  ],
);

export const examResources = pgTable(

  'exam_resources',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id').notNull().references(() => schools.id, { onDelete: 'cascade' }),
    assessmentId: uuid('assessment_id').notNull().references(() => classExams.id, { onDelete: 'cascade' }),
    uploadSessionId: uuid('upload_session_id').notNull(),
    objectPath: text('object_path').notNull(),
    displayName: text('display_name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('exam_resources_upload_session_unique').on(table.uploadSessionId),
    uniqueIndex('exam_resources_object_path_unique').on(table.objectPath),
    index('exam_resources_assessment_created_idx').on(
      table.schoolId,
      table.assessmentId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
);
