import type { ScheduleRepository } from '../db/repositories/schedule.repository.js';
import { AppError } from '../lib/errors.js';
import type {
  StudentAttendanceDetailRecord,
  StudentAttendanceDetailResponse,
  StudentAttendancePeriodSummary,
  StudentTimetableResponse,
  TeacherPendingAttendanceResponse,
  TeacherAttendanceHistoryQuery,
  TeacherAttendanceHistoryResponse,
  TeacherTimetableResponse,
} from '../types/schedule.js';
import type { StudentAttendanceQuery } from '../validators/schedule.schemas.js';

export interface ScheduleServiceDependencies {
  repository: ScheduleRepository;
}

export interface ScheduleService {
  getStudentTimetable(
    studentId: string,
    schoolId: string,
    date: string,
  ): Promise<StudentTimetableResponse>;
  getStudentAttendance(
    studentId: string,
    schoolId: string,
    query: StudentAttendanceQuery,
  ): Promise<StudentAttendanceDetailResponse>;
  getTeacherTimetable(
    teacherId: string,
    schoolId: string,
    date: string,
  ): Promise<TeacherTimetableResponse>;
  getTeacherPendingAttendance(
    teacherId: string,
    schoolId: string,
    date: string,
  ): Promise<TeacherPendingAttendanceResponse>;
  getTeacherAttendanceHistory(
    teacherId: string,
    schoolId: string,
    query: TeacherAttendanceHistoryQuery,
  ): Promise<TeacherAttendanceHistoryResponse>;
}

interface AttendanceRange {
  endDate: string;
  startDate: string;
}

function attendanceRange(query: StudentAttendanceQuery): AttendanceRange {
  if (query.period === 'daily') {
    return { endDate: query.date, startDate: query.date };
  }

  if (query.period === 'monthly') {
    const segments = query.month.split('-');
    const year = Number(segments[0]);
    const month = Number(segments[1]);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return {
      endDate: `${query.month}-${String(lastDay).padStart(2, '0')}`,
      startDate: `${query.month}-01`,
    };
  }

  return {
    endDate: `${query.year}-12-31`,
    startDate: `${query.year}-01-01`,
  };
}

function summarize(records: StudentAttendanceDetailRecord[]): StudentAttendancePeriodSummary {
  const summary: StudentAttendancePeriodSummary = {
    absent: 0,
    excused: 0,
    late: 0,
    present: 0,
    totalSessions: records.length,
  };

  for (const record of records) {
    summary[record.status] += 1;
  }

  return summary;
}

function assertStudentResult<T>(result: T | null): T {
  if (result === null) {
    throw new AppError('FORBIDDEN', 403, 'Only active students can view this resource');
  }

  return result;
}

function assertTeacherResult<T>(result: T | null): T {
  if (result === null) {
    throw new AppError('FORBIDDEN', 403, 'Only active teachers can view this resource');
  }

  return result;
}

export function createScheduleService({ repository }: ScheduleServiceDependencies): ScheduleService {
  return {
    async getStudentTimetable(
      studentId: string,
      schoolId: string,
      date: string,
    ): Promise<StudentTimetableResponse> {
      const entries = assertStudentResult(
        await repository.findStudentTimetable(studentId, schoolId, date),
      );
      return { date, entries };
    },
    async getStudentAttendance(
      studentId: string,
      schoolId: string,
      query: StudentAttendanceQuery,
    ): Promise<StudentAttendanceDetailResponse> {
      const range = attendanceRange(query);
      const records = assertStudentResult(await repository.findStudentAttendance(
        studentId,
        schoolId,
        range.startDate,
        range.endDate,
      ));

      return {
        period: query.period,
        periodEndDate: range.endDate,
        periodStartDate: range.startDate,
        records,
        summary: summarize(records),
      };
    },
    async getTeacherTimetable(
      teacherId: string,
      schoolId: string,
      date: string,
    ): Promise<TeacherTimetableResponse> {
      const entries = assertTeacherResult(
        await repository.findTeacherTimetable(teacherId, schoolId, date),
      );
      return { date, entries };
    },
    async getTeacherPendingAttendance(
      teacherId: string,
      schoolId: string,
      date: string,
    ): Promise<TeacherPendingAttendanceResponse> {
      const slots = assertTeacherResult(
        await repository.findTeacherPendingAttendance(teacherId, schoolId, date),
      );
      return { date, slots };
    },
    async getTeacherAttendanceHistory(
      teacherId: string,
      schoolId: string,
      query: TeacherAttendanceHistoryQuery,
    ): Promise<TeacherAttendanceHistoryResponse> {
      return assertTeacherResult(
        await repository.findTeacherAttendanceHistory(teacherId, schoolId, query),
      );
    },
  };
}
