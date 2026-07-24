import type { AttendanceStatus } from './attendance.js';

export interface StudentTimetableEntry {
  endTime: string;
  room?: string;
  slotId: string;
  startTime: string;
  subjectId: string;
  subjectName: string;
  teacherName: string;
}

export interface StudentTimetableResponse {
  date: string;
  entries: StudentTimetableEntry[];
}

export interface TeacherTimetableEntry {
  classId: string;
  className: string;
  endTime: string;
  room?: string;
  slotId: string;
  startTime: string;
  subjectId: string;
  subjectName: string;
}

export interface TeacherTimetableResponse {
  date: string;
  entries: TeacherTimetableEntry[];
}

export interface PendingAttendanceSlot {
  classId: string;
  className: string;
  endTime: string;
  room?: string;
  slotId: string;
  startTime: string;
  subjectId: string;
  subjectName: string;
}

export interface TeacherPendingAttendanceResponse {
  date: string;
  slots: PendingAttendanceSlot[];
}

export interface TeacherAttendanceHistoryQuery {
  classId: string;
  cursor?: string | undefined;
  limit: number;
}

export interface TeacherAttendanceHistoryEntry {
  absent: number;
  attendanceDate: string;
  excused: number;
  late: number;
  present: number;
  sessionId: string;
  totalStudents: number;
}

export interface TeacherAttendanceHistoryResponse {
  entries: TeacherAttendanceHistoryEntry[];
  nextCursor?: string;
}

export interface StudentAttendanceDetailRecord {
  attendanceDate: string;
  classId: string;
  className: string;
  sessionId: string;
  status: AttendanceStatus;
}

export interface StudentAttendancePeriodSummary {
  absent: number;
  excused: number;
  late: number;
  present: number;
  totalSessions: number;
}

export type StudentAttendancePeriod = 'daily' | 'monthly' | 'yearly';

export interface StudentAttendanceDetailResponse {
  period: StudentAttendancePeriod;
  periodEndDate: string;
  periodStartDate: string;
  records: StudentAttendanceDetailRecord[];
  summary: StudentAttendancePeriodSummary;
}
