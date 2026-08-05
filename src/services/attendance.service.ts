import type { AttendanceRepository } from '../db/repositories/attendance.repository.js';
import { AppError } from '../lib/errors.js';
import { pointAwardRuleCodes, type PointAwardPort } from './point-award.service.js';
import type {
  AttendanceStudent,
  ClassAttendanceHistoryEntry,
  MarkBulkAttendanceInput,
  MarkBulkAttendanceResult,
  StudentAttendanceSummary,
} from '../types/attendance.js';

export interface AttendanceServiceDependencies {
  pointAwards?: PointAwardPort;
  repository: AttendanceRepository;
}

export interface AttendanceService {
  markBulk(
    teacherId: string,
    input: MarkBulkAttendanceInput,
  ): Promise<MarkBulkAttendanceResult>;
  getMySummary(studentId: string, schoolId: string): Promise<StudentAttendanceSummary>;
  getClassRoster(teacherId: string, classId: string, attendanceDate: string): Promise<AttendanceStudent[]>;
  getClassHistory(teacherId: string, classId: string): Promise<ClassAttendanceHistoryEntry[]>;
}

function assertUniqueStudentRecords(records: MarkBulkAttendanceInput['records']): void {
  const studentIds = new Set(records.map((record) => record.studentId));

  if (studentIds.size !== records.length) {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      'Each student can have only one attendance status per session',
    );
  }
}

export function createAttendanceService({ pointAwards, repository }: AttendanceServiceDependencies): AttendanceService {
  return {
    async markBulk(
      teacherId: string,
      input: MarkBulkAttendanceInput,
    ): Promise<MarkBulkAttendanceResult> {
      assertUniqueStudentRecords(input.records);
      const result = await repository.markBulk(teacherId, input);
      if (pointAwards !== undefined) {
        for (const streak of await repository.listQualifyingStreakAwards(result.sessionId)) {
          await pointAwards.awardIfAbsent({
            metadata: { streakDays: streak.streakDays },
            occurredAt: streak.occurredAt,
            recipientUserId: streak.studentId,
            ruleCode: pointAwardRuleCodes.attendanceStreak,
            schoolId: streak.schoolId,
            sourceId: streak.sourceId,
            sourceType: 'attendance_streak',
          });
        }
      }
      const totals = { absent: 0, excused: 0, late: 0, present: 0 };
      for (const record of input.records) totals[record.status] += 1;
      return { ...result, ...totals };
    },
    async getMySummary(studentId: string, schoolId: string): Promise<StudentAttendanceSummary> {
      return repository.getStudentSummary(studentId, schoolId);
    },
    async getClassRoster(teacherId: string, classId: string, attendanceDate: string): Promise<AttendanceStudent[]> {
      const roster = await repository.getClassRoster(teacherId, classId, attendanceDate);
      return roster.filter((student) => student.id !== teacherId);
    },
    async getClassHistory(teacherId: string, classId: string): Promise<ClassAttendanceHistoryEntry[]> {
      return repository.getClassHistory(teacherId, classId);
    },
  };
}
