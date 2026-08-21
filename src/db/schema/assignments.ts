import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { classes, schools, subjects, userProfiles } from './core.js';

export const assignments = pgTable(
  'assignments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id').notNull().references(() => schools.id, { onDelete: 'cascade' }),
    classId: uuid('class_id').notNull().references(() => classes.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id').notNull().references(() => subjects.id, { onDelete: 'restrict' }),
    teacherId: uuid('teacher_id').notNull().references(() => userProfiles.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    instructions: text('instructions').notNull(),
    // Human-readable code (ASG-<year>-<seq>) printed on the success screen.
    // Null for rows written before the column existed; those keep showing their UUID.
    displayCode: text('display_code'),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    isGraded: boolean('is_graded').notNull(),
    gradingType: text('grading_type').$type<'Numeric' | 'Alphabetic'>().notNull(),
    maxMarks: doublePrecision('max_marks'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      'assignments_grading_shape_check',
      sql`(${table.gradingType} = 'Numeric' and ${table.maxMarks} is not null and ${table.maxMarks} > 0)
        or (${table.gradingType} = 'Alphabetic' and ${table.maxMarks} is null)`,
    ),
    index('assignments_student_cursor_idx').on(
      table.schoolId,
      table.classId,
      table.dueAt.desc(),
      table.id.desc(),
    ).where(sql`${table.deletedAt} is null`),
    index('assignments_teacher_cursor_idx').on(
      table.schoolId,
      table.teacherId,
      table.createdAt.desc(),
      table.id.desc(),
    ).where(sql`${table.deletedAt} is null`),
    uniqueIndex('assignments_display_code_per_school').on(table.schoolId, table.displayCode),
  ],
);

export const assignmentRubrics = pgTable(
  'assignment_rubrics',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    assignmentId: uuid('assignment_id').notNull().references(() => assignments.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    topic: text('topic').notNull(),
    marks: doublePrecision('marks').notNull(),
    moreInfo: text('more_info'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('assignment_rubrics_position_check', sql`${table.position} between 1 and 100`),
    check('assignment_rubrics_marks_check', sql`${table.marks} >= 0`),
    unique('assignment_rubrics_assignment_position_unique').on(table.assignmentId, table.position),
  ],
);

export const assignmentResources = pgTable(
  'assignment_resources',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id').notNull().references(() => schools.id, { onDelete: 'cascade' }),
    assignmentId: uuid('assignment_id').notNull().references(() => assignments.id, { onDelete: 'cascade' }),
    uploadSessionId: uuid('upload_session_id').notNull(),
    objectPath: text('object_path').notNull(),
    displayName: text('display_name').notNull(),
    // `banner` is the assignment header image: it is surfaced as
    // `AssignmentDetail.bannerUrl` and excluded from the resources list, so the
    // detail screens draw it as a header rather than as one more file tile.
    // Every row written before this column existed reads `resource`.
    role: text('role').$type<'banner' | 'resource'>().notNull().default('resource'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('assignment_resources_role_check', sql`${table.role} in ('banner', 'resource')`),
    uniqueIndex('assignment_resources_upload_session_unique').on(table.uploadSessionId),
    uniqueIndex('assignment_resources_object_path_unique').on(table.objectPath),
    // At most one banner per assignment. In the database rather than only in the
    // service: two confirms can race, and a read-then-insert check lets both win.
    uniqueIndex('assignment_resources_one_banner_per_assignment')
      .on(table.assignmentId)
      .where(sql`${table.role} = 'banner'`),
    index('assignment_resources_parent_idx').on(
      table.schoolId,
      table.assignmentId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
);

export const assignmentSubmissions = pgTable(
  'assignment_submissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id').notNull().references(() => schools.id, { onDelete: 'cascade' }),
    assignmentId: uuid('assignment_id').notNull().references(() => assignments.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id').notNull().references(() => userProfiles.id, { onDelete: 'cascade' }),
    uploadSessionId: uuid('upload_session_id'),
    objectPath: text('object_path'),
    displayName: text('display_name'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    marks: doublePrecision('marks'),
    // The letter awarded on an assignment whose `grading_type` is `Alphabetic`.
    // Mutually exclusive with `marks` — see the grade shape check below. Without
    // it an alphabetic assignment was gradable in name only: the submission had
    // nowhere to put the letter, so the grading screen fell back to "0/0".
    letterGrade: text('letter_grade').$type<
      'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D' | 'E' | 'F'
    >(),
    feedback: text('feedback'),
    gradedAt: timestamp('graded_at', { withTimezone: true }),
    gradedByTeacherId: uuid('graded_by_teacher_id').references(() => userProfiles.id, { onDelete: 'restrict' }),
    // Set by Mark as Complete, cleared by Mark as Incomplete. Independent of
    // grading, so it is deliberately outside assignment_submissions_grade_shape_check.
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('assignment_submissions_assignment_student_unique').on(table.assignmentId, table.studentId),
    uniqueIndex('assignment_submissions_upload_session_unique').on(table.uploadSessionId),
    uniqueIndex('assignment_submissions_object_path_unique').on(table.objectPath),
    // A submission carries a complete file triple or no file at all; a PARTIAL
    // triple is the corruption this check exists for. `submitted_at` is
    // deliberately independent of the file: uploading work is optional, so a
    // student may submit with nothing attached. The previous shape coupled the
    // two and made a fileless submission unrepresentable.
    check(
      'assignment_submissions_file_shape_check',
      sql`num_nonnulls(${table.uploadSessionId}, ${table.objectPath}, ${table.displayName}) = 0
        or (num_nonnulls(${table.uploadSessionId}, ${table.objectPath}, ${table.displayName}) = 3 and ${table.submittedAt} is not null)`,
    ),
    check(
      'assignment_submissions_letter_grade_check',
      sql`${table.letterGrade} is null
        or ${table.letterGrade} in ('A+', 'A', 'B+', 'B', 'C+', 'C', 'D', 'E', 'F')`,
    ),
    // A graded row carries exactly one of marks / letter_grade, never both and
    // never neither. The previous shape required `marks`, which made an
    // alphabetic grade — a grader and a graded instant but no marks —
    // unrepresentable.
    check(
      'assignment_submissions_grade_shape_check',
      sql`(${table.marks} is null and ${table.letterGrade} is null and ${table.gradedAt} is null and ${table.gradedByTeacherId} is null)
        or (num_nonnulls(${table.marks}, ${table.letterGrade}) = 1 and ${table.gradedAt} is not null and ${table.gradedByTeacherId} is not null)`,
    ),
    index('assignment_submissions_teacher_cursor_idx').on(
      table.schoolId,
      table.assignmentId,
      table.submittedAt.desc().nullsLast(),
      table.id.desc(),
    ),
    index('assignment_submissions_student_idx').on(
      table.schoolId,
      table.studentId,
      table.assignmentId,
    ),
  ],
);
