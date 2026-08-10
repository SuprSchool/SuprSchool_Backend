import { and, asc, desc, eq, gte, isNull, lt, lte, or, sql } from 'drizzle-orm';

import type { Database } from '../client.js';
import { AppError } from '../../lib/errors.js';
import { attendanceRecords, attendanceSessions } from '../schema/attendance.js';
import {
  academicYears,
  classes,
  classMembers,
  classSubjects,
  subjects,
  userProfiles,
  userRoles,
} from '../schema/core.js';
import { classScheduleSlots } from '../schema/student-home.js';
import type {
  PendingAttendanceSlot,
  StudentAttendanceDetailRecord,
  TeacherAttendanceHistoryEntry,
  TeacherAttendanceHistoryQuery,
  TeacherAttendanceHistoryResponse,
  StudentTimetableEntry,
  TeacherTimetableEntry,
} from '../../types/schedule.js';

interface StudentClassContext {
  classId: string;
  schoolId: string;
}

/**
 * Timetable slots are naive wall-clock times — `supabase/seed.sql` writes
 * 08:00–11:45, a school morning — while the database session runs in UTC.
 * Every other timetable read takes its date from the client, so the server has
 * never had to name the school's zone; resolving a period server-side does.
 * One school per deployment today; a `schools.time_zone` column is the real
 * fix and is filed in `docs/parity/SHARED-REQUESTS.md`.
 */
export const TIMETABLE_TIME_ZONE = 'Asia/Kolkata';

function ordinal(position: number): string {
  const mod100 = position % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${position}th`;
  switch (position % 10) {
    case 1:
      return `${position}st`;
    case 2:
      return `${position}nd`;
    case 3:
      return `${position}rd`;
    default:
      return `${position}th`;
  }
}

export interface ScheduleRepository {
  findClassPeriodLabel(
    teacherId: string,
    schoolId: string,
    classId: string,
  ): Promise<string | null>;
  findStudentTimetable(
    studentId: string,
    schoolId: string,
    date: string,
  ): Promise<StudentTimetableEntry[] | null>;
  findStudentAttendance(
    studentId: string,
    schoolId: string,
    startDate: string,
    endDate: string,
  ): Promise<StudentAttendanceDetailRecord[] | null>;
  findTeacherTimetable(
    teacherId: string,
    schoolId: string,
    date: string,
  ): Promise<TeacherTimetableEntry[] | null>;
  findTeacherPendingAttendance(
    teacherId: string,
    schoolId: string,
    date: string,
  ): Promise<PendingAttendanceSlot[] | null>;
  findTeacherAttendanceHistory(
    teacherId: string,
    schoolId: string,
    query: TeacherAttendanceHistoryQuery,
  ): Promise<TeacherAttendanceHistoryResponse | null>;
}

function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

export interface PendingAttendanceSlotRow {
  classId: string;
  className: string;
  endTime: string;
  room: string | null;
  slotId: string;
  startTime: string;
  subjectId: string;
  subjectName: string;
}

// Attendance is keyed by class and date. The earliest assigned timetable slot
// represents a class once, even when a teacher has multiple subjects that day.
export function toPendingAttendanceSlots(
  rows: PendingAttendanceSlotRow[],
): PendingAttendanceSlot[] {
  const earliestByClass = new Map<string, PendingAttendanceSlotRow>();

  for (const row of rows) {
    const key = row.classId;
    if (!earliestByClass.has(key)) {
      earliestByClass.set(key, row);
    }
  }

  return [...earliestByClass.values()].map((row) => ({
    ...(row.room ? { room: row.room } : {}),
    classId: row.classId,
    className: row.className,
    endTime: row.endTime,
    slotId: row.slotId,
    startTime: row.startTime,
    subjectId: row.subjectId,
    subjectName: row.subjectName,
  }));
}

export class DrizzleScheduleRepository implements ScheduleRepository {
  public constructor(private readonly db: Database) {}

  /**
   * "What period is it right now for this class?" — the slot covering the
   * current wall clock, named by its position in that class's day rather than
   * by any stored label, so the answer cannot drift from the timetable the
   * schedule screens render. Null when no slot covers the moment, when the
   * teacher does not own the slot's subject, or when the role is not live.
   */
  public async findClassPeriodLabel(
    teacherId: string,
    schoolId: string,
    classId: string,
  ): Promise<string | null> {
    const rows = await this.db.execute(sql`
      with local_now as (
        select (now() at time zone ${TIMETABLE_TIME_ZONE}::text) as at
      ), day_slots as (
        select slot.subject_id, slot.start_time, slot.end_time,
          row_number() over (order by slot.start_time, slot.id) as position
        from public.class_schedule_slots slot
        cross join local_now
        where slot.school_id = ${schoolId}::uuid
          and slot.class_id = ${classId}::uuid
          and slot.day_of_week = extract(dow from local_now.at)::int
      )
      select day_slots.position
      from day_slots
      cross join local_now
      join public.class_subjects cs on cs.school_id = ${schoolId}::uuid
        and cs.class_id = ${classId}::uuid
        and cs.subject_id = day_slots.subject_id
        and cs.teacher_id = ${teacherId}::uuid
      join public.user_roles role on role.user_id = ${teacherId}::uuid
        and role.school_id = ${schoolId}::uuid
        and role.role = 'teacher' and role.is_active
      where local_now.at::time >= day_slots.start_time
        and local_now.at::time < day_slots.end_time
      order by day_slots.position
      limit 1
    `) as readonly { position: number | string }[];

    const position = rows[0]?.position;
    return position === undefined ? null : `${ordinal(Number(position))} Period`;
  }

  public async findStudentTimetable(
    studentId: string,
    schoolId: string,
    date: string,
  ): Promise<StudentTimetableEntry[] | null> {
    const context = await this.findActiveStudentClass(studentId, schoolId);
    if (!context) {
      return null;
    }

    const slots = await this.db
      .select({
        endTime: classScheduleSlots.endTime,
        room: classScheduleSlots.room,
        slotId: classScheduleSlots.id,
        startTime: classScheduleSlots.startTime,
        subjectId: subjects.id,
        subjectName: subjects.name,
        teacherName: userProfiles.displayName,
      })
      .from(classScheduleSlots)
      .innerJoin(
        subjects,
        and(
          eq(subjects.id, classScheduleSlots.subjectId),
          eq(subjects.schoolId, classScheduleSlots.schoolId),
        ),
      )
      .leftJoin(
        classSubjects,
        and(
          eq(classSubjects.classId, classScheduleSlots.classId),
          eq(classSubjects.subjectId, classScheduleSlots.subjectId),
          eq(classSubjects.schoolId, classScheduleSlots.schoolId),
        ),
      )
      .leftJoin(
        userProfiles,
        and(
          eq(userProfiles.id, classSubjects.teacherId),
          eq(userProfiles.schoolId, classScheduleSlots.schoolId),
        ),
      )
      .where(
        and(
          eq(classScheduleSlots.schoolId, context.schoolId),
          eq(classScheduleSlots.classId, context.classId),
          eq(classScheduleSlots.dayOfWeek, dayOfWeek(date)),
        ),
      )
      .orderBy(asc(classScheduleSlots.startTime));

    return slots.map((slot) => ({
      ...(slot.room ? { room: slot.room } : {}),
      endTime: slot.endTime,
      slotId: slot.slotId,
      startTime: slot.startTime,
      subjectId: slot.subjectId,
      subjectName: slot.subjectName,
      teacherName: slot.teacherName ?? 'Unassigned',
    }));
  }

  public async findStudentAttendance(
    studentId: string,
    schoolId: string,
    startDate: string,
    endDate: string,
  ): Promise<StudentAttendanceDetailRecord[] | null> {
    const context = await this.findActiveStudentClass(studentId, schoolId);
    if (!context) {
      return null;
    }

    return this.db
      .select({
        attendanceDate: attendanceSessions.attendanceDate,
        classId: classes.id,
        className: classes.displayName,
        sessionId: attendanceSessions.id,
        status: attendanceRecords.status,
      })
      .from(attendanceRecords)
      .innerJoin(attendanceSessions, eq(attendanceSessions.id, attendanceRecords.sessionId))
      .innerJoin(
        classes,
        and(
          eq(classes.id, attendanceSessions.classId),
          eq(classes.schoolId, attendanceSessions.schoolId),
        ),
      )
      .innerJoin(
        classMembers,
        and(
          eq(classMembers.studentId, studentId),
          eq(classMembers.classId, attendanceSessions.classId),
          eq(classMembers.schoolId, attendanceSessions.schoolId),
          eq(classMembers.isActive, true),
        ),
      )
      .innerJoin(
        userRoles,
        and(
          eq(userRoles.userId, studentId),
          eq(userRoles.schoolId, schoolId),
          eq(userRoles.schoolId, attendanceSessions.schoolId),
          eq(userRoles.role, 'student'),
          eq(userRoles.isActive, true),
        ),
      )
      .where(
        and(
          eq(attendanceRecords.studentId, studentId),
          eq(attendanceSessions.schoolId, schoolId),
          eq(attendanceSessions.schoolId, context.schoolId),
          eq(attendanceSessions.classId, context.classId),
          gte(attendanceSessions.attendanceDate, startDate),
          lte(attendanceSessions.attendanceDate, endDate),
        ),
      )
      .orderBy(asc(attendanceSessions.attendanceDate));
  }

  public async findTeacherTimetable(
    teacherId: string,
    schoolId: string,
    date: string,
  ): Promise<TeacherTimetableEntry[] | null> {
    if (!await this.hasActiveTeacherRole(teacherId, schoolId)) {
      return null;
    }

    return this.findTeacherSlots(teacherId, schoolId, date);
  }

  public async findTeacherPendingAttendance(
    teacherId: string,
    schoolId: string,
    date: string,
  ): Promise<PendingAttendanceSlot[] | null> {
    if (!await this.hasActiveTeacherRole(teacherId, schoolId)) {
      return null;
    }

    const rows = await this.db
      .select({
        classId: classes.id,
        className: classes.displayName,
        endTime: classScheduleSlots.endTime,
        room: classScheduleSlots.room,
        slotId: classScheduleSlots.id,
        startTime: classScheduleSlots.startTime,
        subjectId: subjects.id,
        subjectName: subjects.name,
      })
      .from(classScheduleSlots)
      .innerJoin(
        classSubjects,
        and(
          eq(classSubjects.classId, classScheduleSlots.classId),
          eq(classSubjects.subjectId, classScheduleSlots.subjectId),
          eq(classSubjects.schoolId, classScheduleSlots.schoolId),
          eq(classSubjects.teacherId, teacherId),
        ),
      )
      .innerJoin(
        classes,
        and(
          eq(classes.id, classScheduleSlots.classId),
          eq(classes.schoolId, classScheduleSlots.schoolId),
        ),
      )
      .innerJoin(
        subjects,
        and(
          eq(subjects.id, classScheduleSlots.subjectId),
          eq(subjects.schoolId, classScheduleSlots.schoolId),
        ),
      )
      .leftJoin(
        attendanceSessions,
        and(
          eq(attendanceSessions.schoolId, classScheduleSlots.schoolId),
          eq(attendanceSessions.classId, classScheduleSlots.classId),
          eq(attendanceSessions.attendanceDate, date),
        ),
      )
      .where(
        and(
          eq(classScheduleSlots.schoolId, schoolId),
          eq(classScheduleSlots.dayOfWeek, dayOfWeek(date)),
          isNull(attendanceSessions.id),
        ),
      )
      .orderBy(asc(classScheduleSlots.startTime), asc(classes.displayName), asc(subjects.name), asc(classScheduleSlots.id));

    return toPendingAttendanceSlots(rows);
  }

  public async findTeacherAttendanceHistory(
    teacherId: string,
    schoolId: string,
    query: TeacherAttendanceHistoryQuery,
  ): Promise<TeacherAttendanceHistoryResponse | null> {
    if (!await this.hasTeacherClassAccess(teacherId, schoolId, query.classId)) {
      return null;
    }

    const cursor = parseAttendanceCursor(query.cursor);
    const rows = await this.db
      .select({
        absent: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'absent')`,
        attendanceDate: attendanceSessions.attendanceDate,
        excused: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'excused')`,
        late: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'late')`,
        present: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'present')`,
        sessionId: attendanceSessions.id,
        totalStudents: sql<number>`count(*)`,
      })
      .from(attendanceSessions)
      .innerJoin(attendanceRecords, eq(attendanceRecords.sessionId, attendanceSessions.id))
      .where(and(
        eq(attendanceSessions.schoolId, schoolId),
        eq(attendanceSessions.classId, query.classId),
        cursor ? or(
          lt(attendanceSessions.attendanceDate, cursor.attendanceDate),
          and(eq(attendanceSessions.attendanceDate, cursor.attendanceDate), lt(attendanceSessions.id, cursor.sessionId)),
        ) : undefined,
      ))
      .groupBy(attendanceSessions.id, attendanceSessions.attendanceDate)
      .orderBy(desc(attendanceSessions.attendanceDate), desc(attendanceSessions.id))
      .limit(query.limit + 1);

    const hasNextPage = rows.length > query.limit;
    const entries: TeacherAttendanceHistoryEntry[] = rows.slice(0, query.limit).map((row) => ({
      absent: Number(row.absent),
      attendanceDate: row.attendanceDate,
      excused: Number(row.excused),
      late: Number(row.late),
      present: Number(row.present),
      sessionId: row.sessionId,
      totalStudents: Number(row.totalStudents),
    }));
    const lastEntry = entries.at(-1);

    return {
      entries,
      ...(hasNextPage && lastEntry
        ? { nextCursor: `${lastEntry.attendanceDate}|${lastEntry.sessionId}` }
        : {}),
    };
  }

  private async findActiveStudentClass(
    studentId: string,
    schoolId: string,
  ): Promise<StudentClassContext | null> {
    const [context] = await this.db
      .select({ classId: classes.id, schoolId: classes.schoolId })
      .from(classMembers)
      .innerJoin(
        classes,
        and(
          eq(classes.id, classMembers.classId),
          eq(classes.schoolId, classMembers.schoolId),
          eq(classes.academicYearId, classMembers.academicYearId),
        ),
      )
      .innerJoin(
        academicYears,
        and(
          eq(academicYears.id, classMembers.academicYearId),
          eq(academicYears.schoolId, classMembers.schoolId),
          eq(academicYears.isCurrent, true),
        ),
      )
      .innerJoin(
        userRoles,
        and(
          eq(userRoles.userId, studentId),
          eq(userRoles.schoolId, schoolId),
          eq(userRoles.schoolId, classMembers.schoolId),
          eq(userRoles.role, 'student'),
          eq(userRoles.isActive, true),
        ),
      )
      .where(
        and(
          eq(classMembers.studentId, studentId),
          eq(classMembers.schoolId, schoolId),
          eq(classMembers.isActive, true),
        ),
      )
      .limit(1);

    return context ?? null;
  }

  private async hasTeacherClassAccess(
    teacherId: string,
    schoolId: string,
    classId: string,
  ): Promise<boolean> {
    const [assignment] = await this.db
      .select({ classId: classSubjects.classId })
      .from(classSubjects)
      .innerJoin(userRoles, and(
        eq(userRoles.userId, teacherId),
        eq(userRoles.schoolId, classSubjects.schoolId),
        eq(userRoles.role, 'teacher'),
        eq(userRoles.isActive, true),
      ))
      .where(and(
        eq(classSubjects.teacherId, teacherId),
        eq(classSubjects.schoolId, schoolId),
        eq(classSubjects.classId, classId),
      ))
      .limit(1);
    return assignment !== undefined;
  }

  private async hasActiveTeacherRole(teacherId: string, schoolId: string): Promise<boolean> {
    const [teacher] = await this.db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(
        and(
          eq(userRoles.userId, teacherId),
          eq(userRoles.schoolId, schoolId),
          eq(userRoles.role, 'teacher'),
          eq(userRoles.isActive, true),
        ),
      )
      .limit(1);

    return teacher !== undefined;
  }

  private async findTeacherSlots(
    teacherId: string,
    schoolId: string,
    date: string,
  ): Promise<TeacherTimetableEntry[]> {
    const rows = await this.db
      .select({
        classId: classes.id,
        className: classes.displayName,
        endTime: classScheduleSlots.endTime,
        room: classScheduleSlots.room,
        slotId: classScheduleSlots.id,
        startTime: classScheduleSlots.startTime,
        subjectId: subjects.id,
        subjectName: subjects.name,
      })
      .from(classScheduleSlots)
      .innerJoin(
        classSubjects,
        and(
          eq(classSubjects.classId, classScheduleSlots.classId),
          eq(classSubjects.subjectId, classScheduleSlots.subjectId),
          eq(classSubjects.schoolId, classScheduleSlots.schoolId),
          eq(classSubjects.teacherId, teacherId),
        ),
      )
      .innerJoin(
        classes,
        and(
          eq(classes.id, classScheduleSlots.classId),
          eq(classes.schoolId, classScheduleSlots.schoolId),
        ),
      )
      .innerJoin(
        subjects,
        and(
          eq(subjects.id, classScheduleSlots.subjectId),
          eq(subjects.schoolId, classScheduleSlots.schoolId),
        ),
      )
      .where(
        and(
          eq(classScheduleSlots.schoolId, schoolId),
          eq(classScheduleSlots.dayOfWeek, dayOfWeek(date)),
        ),
      )
      .orderBy(asc(classScheduleSlots.startTime), asc(classes.displayName));

    return rows.map((row) => ({
      ...(row.room ? { room: row.room } : {}),
      classId: row.classId,
      className: row.className,
      endTime: row.endTime,
      slotId: row.slotId,
      startTime: row.startTime,
      subjectId: row.subjectId,
      subjectName: row.subjectName,
    }));
  }
}

function parseAttendanceCursor(cursor: string | undefined): { attendanceDate: string; sessionId: string } | null {
  if (!cursor) {
    return null;
  }

  const separatorIndex = cursor.indexOf('|');
  if (separatorIndex <= 0 || separatorIndex === cursor.length - 1) {
    throw new AppError('VALIDATION_ERROR', 400, 'Invalid attendance history cursor');
  }

  return {
    attendanceDate: cursor.slice(0, separatorIndex),
    sessionId: cursor.slice(separatorIndex + 1),
  };
}
