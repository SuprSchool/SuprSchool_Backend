import type {
  AttendanceStudent,
  ClassAttendanceHistoryEntry,
  MarkBulkAttendanceInput,
  PersistedBulkAttendanceResult,
  StudentAttendanceSummary,
} from '../../types/attendance.js';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import type { Database } from '../client.js';
import { classes, classMembers, classSubjects, userProfiles, userRoles } from '../schema/core.js';
import { attendanceRecords, attendanceSessions } from '../schema/attendance.js';
import { AppError } from '../../lib/errors.js';

export interface AttendanceRepository {
  markBulk(
    teacherId: string,
    input: MarkBulkAttendanceInput,
  ): Promise<PersistedBulkAttendanceResult>;
  getStudentSummary(studentId: string, schoolId: string): Promise<StudentAttendanceSummary>;
  getClassRoster(teacherId: string, classId: string, attendanceDate: string): Promise<AttendanceStudent[]>;
  getClassHistory(teacherId: string, classId: string): Promise<ClassAttendanceHistoryEntry[]>;
  listQualifyingStreakAwards(sessionId: string): Promise<ReadonlyArray<{ occurredAt: Date; schoolId: string; sourceId: string; streakDays: number; studentId: string }>>;
}

export class DrizzleAttendanceRepository implements AttendanceRepository {
  public constructor(private readonly db: Database) {}

  public async markBulk(
    teacherId: string,
    input: MarkBulkAttendanceInput,
  ): Promise<PersistedBulkAttendanceResult> {
    return this.db.transaction(async (transaction) => {
      const [assignment] = await transaction
        .select({ schoolId: classSubjects.schoolId })
        .from(classSubjects)
        .innerJoin(
          userRoles,
          and(
            eq(userRoles.userId, teacherId),
            eq(userRoles.schoolId, classSubjects.schoolId),
            eq(userRoles.role, 'teacher'),
            eq(userRoles.isActive, true),
          ),
        )
        .where(
          and(
            eq(classSubjects.classId, input.classId),
            eq(classSubjects.teacherId, teacherId),
          ),
        )
        .limit(1);

      if (!assignment) {
        throw new AppError(
          'FORBIDDEN',
          403,
          'You are not assigned to mark attendance for this class',
        );
      }

      const studentIds = input.records.map((record) => record.studentId);
      const activeMembers = await transaction
        .select({ studentId: classMembers.studentId })
        .from(classMembers)
        .where(
          and(
            eq(classMembers.classId, input.classId),
            eq(classMembers.schoolId, assignment.schoolId),
            eq(classMembers.isActive, true),
            inArray(classMembers.studentId, studentIds),
          ),
        );

      if (activeMembers.length !== studentIds.length) {
        throw new AppError(
          'VALIDATION_ERROR',
          400,
          'Every student must be an active member of the selected class',
        );
      }

      const [session] = await transaction
        .insert(attendanceSessions)
        .values({
          attendanceDate: input.attendanceDate,
          classId: input.classId,
          markedByTeacherId: teacherId,
          schoolId: assignment.schoolId,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            attendanceSessions.classId,
            attendanceSessions.attendanceDate,
          ],
          set: { updatedAt: new Date() },
        })
        .returning({ id: attendanceSessions.id });

      if (!session) {
        throw new AppError('INTERNAL_ERROR', 500, 'Unable to create attendance session');
      }

      await transaction
        .insert(attendanceRecords)
        .values(
          input.records.map((record) => ({
            sessionId: session.id,
            status: record.status,
            studentId: record.studentId,
          })),
        )
        .onConflictDoUpdate({
          target: [attendanceRecords.sessionId, attendanceRecords.studentId],
          set: {
            markedAt: new Date(),
            status: sql`excluded.status`,
          },
        });

      return {
        attendanceDate: input.attendanceDate,
        classId: input.classId,
        sessionId: session.id,
        updatedRecords: input.records.length,
      };
    });
  }

  public async listQualifyingStreakAwards(sessionId: string): Promise<ReadonlyArray<{ occurredAt: Date; schoolId: string; sourceId: string; streakDays: number; studentId: string }>> {
    return this.db.execute(sql`
      with current_present_records as (
        select record.id as "sourceId", record.student_id as "studentId", record.marked_at as "occurredAt", session.school_id as "schoolId", session.attendance_date as attendance_date
        from public.attendance_records record
        join public.attendance_sessions session on session.id = record.session_id
        where record.session_id = ${sessionId}::uuid and record.status = 'present'
      ), present_days as (
        select current."sourceId", current."studentId", current."occurredAt", current."schoolId", current.attendance_date, historic_session.attendance_date as present_date,
          row_number() over (partition by current."sourceId" order by historic_session.attendance_date desc)::integer as sequence
        from current_present_records current
        join public.attendance_records historic_record on historic_record.student_id = current."studentId" and historic_record.status = 'present'
        join public.attendance_sessions historic_session on historic_session.id = historic_record.session_id and historic_session.school_id = current."schoolId"
        where historic_session.attendance_date <= current.attendance_date
      )
      select "sourceId", "studentId", "occurredAt", "schoolId", count(*)::integer as "streakDays"
      from present_days
      where present_date + sequence = attendance_date + 1
      group by "sourceId", "studentId", "occurredAt", "schoolId"
      having count(*) >= 5
    `) as unknown as ReadonlyArray<{ occurredAt: Date; schoolId: string; sourceId: string; streakDays: number; studentId: string }>
  }

  public async getStudentSummary(studentId: string, schoolId: string): Promise<StudentAttendanceSummary> {
    const [activeStudent] = await this.db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(
        and(
          eq(userRoles.userId, studentId),
          eq(userRoles.schoolId, schoolId),
          eq(userRoles.role, 'student'),
          eq(userRoles.isActive, true),
        ),
      )
      .limit(1);

    if (!activeStudent) {
      throw new AppError('FORBIDDEN', 403, 'Only active students can view attendance');
    }

    const records = await this.db
      .select({ status: attendanceRecords.status })
      .from(attendanceRecords)
      .innerJoin(
        attendanceSessions,
        eq(attendanceSessions.id, attendanceRecords.sessionId),
      )
      .innerJoin(
        userRoles,
        and(
          eq(userRoles.userId, attendanceRecords.studentId),
          eq(userRoles.schoolId, attendanceSessions.schoolId),
          eq(userRoles.role, 'student'),
          eq(userRoles.isActive, true),
        ),
      )
      .innerJoin(
        classMembers,
        and(
          eq(classMembers.classId, attendanceSessions.classId),
          eq(classMembers.schoolId, attendanceSessions.schoolId),
          eq(classMembers.studentId, attendanceRecords.studentId),
          eq(classMembers.isActive, true),
        ),
      )
      .where(and(
        eq(attendanceRecords.studentId, studentId),
        eq(attendanceSessions.schoolId, schoolId),
      ));

    const summary: StudentAttendanceSummary = {
      absent: 0,
      excused: 0,
      late: 0,
      present: 0,
      studentId,
      totalSessions: records.length,
    };

    for (const record of records) {
      summary[record.status] += 1;
    }

    return summary;
  }

  public async getClassRoster(
    teacherId: string,
    classId: string,
    attendanceDate: string,
  ): Promise<AttendanceStudent[]> {
    const assignment = await this.findTeacherClassAssignment(teacherId, classId);
    if (!assignment) {
      throw new AppError('FORBIDDEN', 403, 'You are not assigned to this class');
    }

    const rows = await this.db
      .select({
        name: userProfiles.displayName,
        rollNumber: classMembers.rollNumber,
        status: attendanceRecords.status,
        studentId: userProfiles.id,
      })
      .from(classMembers)
      .innerJoin(userProfiles, and(
        eq(userProfiles.id, classMembers.studentId),
        eq(userProfiles.schoolId, assignment.schoolId),
      ))
      .leftJoin(attendanceSessions, and(
        eq(attendanceSessions.classId, assignment.classId),
        eq(attendanceSessions.schoolId, assignment.schoolId),
        eq(attendanceSessions.attendanceDate, attendanceDate),
      ))
      .leftJoin(attendanceRecords, and(
        eq(attendanceRecords.sessionId, attendanceSessions.id),
        eq(attendanceRecords.studentId, classMembers.studentId),
      ))
      .where(and(
        eq(classMembers.classId, assignment.classId),
        eq(classMembers.schoolId, assignment.schoolId),
        eq(classMembers.isActive, true),
      ))
      .orderBy(asc(classMembers.rollNumber), asc(userProfiles.displayName));

    return rows.map((row) => ({
      id: row.studentId,
      isPresent: row.status === 'present' || row.status === 'late',
      name: row.name,
      rollNumber: Number(row.rollNumber ?? 0),
    }));
  }

  public async getClassHistory(
    teacherId: string,
    classId: string,
  ): Promise<ClassAttendanceHistoryEntry[]> {
    const assignment = await this.findTeacherClassAssignment(teacherId, classId);
    if (!assignment) {
      throw new AppError('FORBIDDEN', 403, 'You are not assigned to this class');
    }

    const rows = await this.db
      .select({
        absent: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'absent')`,
        attendanceDate: attendanceSessions.attendanceDate,
        id: attendanceSessions.id,
        present: sql<number>`count(*) filter (where ${attendanceRecords.status} in ('present', 'late'))`,
        totalStudents: sql<number>`count(*)`,
      })
      .from(attendanceSessions)
      .innerJoin(attendanceRecords, eq(attendanceRecords.sessionId, attendanceSessions.id))
      .where(and(
        eq(attendanceSessions.classId, assignment.classId),
        eq(attendanceSessions.schoolId, assignment.schoolId),
      ))
      .groupBy(attendanceSessions.id, attendanceSessions.attendanceDate)
      .orderBy(desc(attendanceSessions.attendanceDate), desc(attendanceSessions.id))
      .limit(100);

    return rows.map((row) => ({
      absent: Number(row.absent),
      attendanceDate: row.attendanceDate,
      id: row.id,
      present: Number(row.present),
      totalStudents: Number(row.totalStudents),
    }));
  }

  private async findTeacherClassAssignment(teacherId: string, classId: string) {
    const [assignment] = await this.db
      .select({ classId: classes.id, schoolId: classes.schoolId })
      .from(classSubjects)
      .innerJoin(classes, and(
        eq(classes.id, classSubjects.classId),
        eq(classes.schoolId, classSubjects.schoolId),
      ))
      .innerJoin(userRoles, and(
        eq(userRoles.userId, teacherId),
        eq(userRoles.schoolId, classSubjects.schoolId),
        eq(userRoles.role, 'teacher'),
        eq(userRoles.isActive, true),
      ))
      .where(and(eq(classSubjects.classId, classId), eq(classSubjects.teacherId, teacherId)))
      .limit(1);
    return assignment;
  }

}
