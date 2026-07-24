import { z } from 'zod';

export const attendanceStatusValues = ['present', 'absent', 'late', 'excused'] as const;

export type AttendanceStatus = (typeof attendanceStatusValues)[number];

export interface AttendanceRecordInput {
  studentId: string;
  status: AttendanceStatus;
}

export interface MarkBulkAttendanceInput {
  classId: string;
  attendanceDate: string;
  records: AttendanceRecordInput[];
}

export interface MarkBulkAttendanceResult {
  sessionId: string;
  classId: string;
  attendanceDate: string;
  updatedRecords: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
}

export type PersistedBulkAttendanceResult = Omit<
  MarkBulkAttendanceResult,
  'present' | 'absent' | 'late' | 'excused'
>;

export interface StudentAttendanceSummary {
  studentId: string;
  totalSessions: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
}


export interface AttendanceStudent {
  id: string;
  isPresent: boolean;
  name: string;
  rollNumber: number;
}

export interface ClassAttendanceHistoryEntry {
  absent: number;
  attendanceDate: string;
  id: string;
  present: number;
  totalStudents: number;
}

export const markBulkAttendanceSchema = z.object({
  attendanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  classId: z.uuid(),
  records: z
    .array(
      z.object({
        studentId: z.uuid(),
        status: z.enum(attendanceStatusValues),
      }),
    )
    .min(1),
});

export type MarkBulkAttendanceRequest = z.infer<typeof markBulkAttendanceSchema>;
export type MarkBulkAttendanceResponse = MarkBulkAttendanceResult;
export type StudentAttendanceSummaryResponse = StudentAttendanceSummary;
