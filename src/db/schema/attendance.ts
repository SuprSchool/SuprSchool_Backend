import { relations } from 'drizzle-orm';
import {
  date,
  index,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { classes, schools, userProfiles } from './core.js';
import { attendanceStatusValues } from '../../types/attendance.js';

export const attendanceStatus = pgEnum('attendance_status', attendanceStatusValues);

export const attendanceSessions = pgTable(
  'attendance_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    attendanceDate: date('attendance_date').notNull(),
    markedByTeacherId: uuid('marked_by_teacher_id')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('attendance_sessions_class_date_unique').on(
      table.classId,
      table.attendanceDate,
    ),
    index('attendance_sessions_school_date_index').on(
      table.schoolId,
      table.attendanceDate,
    ),
  ],
);

export const attendanceRecords = pgTable(
  'attendance_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => attendanceSessions.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    status: attendanceStatus('status').notNull(),
    markedAt: timestamp('marked_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('attendance_records_session_student_unique').on(
      table.sessionId,
      table.studentId,
    ),
    index('attendance_records_student_index').on(table.studentId),
  ],
);

export const attendanceSessionsRelations = relations(
  attendanceSessions,
  ({ many, one }) => ({
    class: one(classes, {
      fields: [attendanceSessions.classId],
      references: [classes.id],
    }),
    records: many(attendanceRecords),
    school: one(schools, {
      fields: [attendanceSessions.schoolId],
      references: [schools.id],
    }),
  }),
);

export const attendanceRecordsRelations = relations(attendanceRecords, ({ one }) => ({
  session: one(attendanceSessions, {
    fields: [attendanceRecords.sessionId],
    references: [attendanceSessions.id],
  }),
  student: one(userProfiles, {
    fields: [attendanceRecords.studentId],
    references: [userProfiles.id],
  }),
}));

export const attendanceSchema = {
  attendanceRecords,
  attendanceSessions,
  attendanceStatus,
};
