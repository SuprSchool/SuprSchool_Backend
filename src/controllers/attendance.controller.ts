import type { Request, Response } from 'express';
import { z } from 'zod';

import { AppError } from '../lib/errors.js';
import type { AttendanceService } from '../services/attendance.service.js';
import {
  markBulkAttendanceSchema,
  type MarkBulkAttendanceRequest,
  type MarkBulkAttendanceResponse,
  type StudentAttendanceSummaryResponse,
  type AttendanceStudent,
  type ClassAttendanceHistoryEntry,
} from '../types/attendance.js';

export interface AttendanceController {
  markBulk(request: Request, response: Response): Promise<void>;
  getMySummary(request: Request, response: Response): Promise<void>;
  getClassRoster(request: Request, response: Response): Promise<void>;
  getClassHistory(request: Request, response: Response): Promise<void>;
}

const classParamsSchema = z.object({ classId: z.uuid() });
const rosterQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
});

function getAuthenticatedUserId(request: Request): string {
  if (!request.auth) {
    throw new AppError('UNAUTHORIZED', 401, 'A valid bearer token is required');
  }

  return request.auth.userId;
}

function requireTeacherId(request: Request): string {
  const teacherId = getAuthenticatedUserId(request);
  if (request.auth?.role !== 'teacher') {
    throw new AppError('FORBIDDEN', 403, 'Only teachers can manage class attendance');
  }
  return teacherId;
}

export function createAttendanceController(
  attendanceService: AttendanceService,
): AttendanceController {
  return {
    markBulk: async (request: Request, response: Response): Promise<void> => {
      const teacherId = requireTeacherId(request);
      const input: MarkBulkAttendanceRequest = markBulkAttendanceSchema.parse(request.body);
      const body: MarkBulkAttendanceResponse = await attendanceService.markBulk(teacherId, input);
      response.status(200).json(body);
    },
    getClassRoster: async (request: Request, response: Response): Promise<void> => {
      const teacherId = requireTeacherId(request);
      const { classId } = classParamsSchema.parse(request.params);
      const { date } = rosterQuerySchema.parse(request.query);
      const body: AttendanceStudent[] = await attendanceService.getClassRoster(
        teacherId,
        classId,
        date ?? new Date().toISOString().slice(0, 10),
      );
      response.status(200).json({ students: body });
    },
    getClassHistory: async (request: Request, response: Response): Promise<void> => {
      const teacherId = requireTeacherId(request);
      const { classId } = classParamsSchema.parse(request.params);
      const body: ClassAttendanceHistoryEntry[] = await attendanceService.getClassHistory(teacherId, classId);
      response.status(200).json({ entries: body });
    },
    getMySummary: async (request: Request, response: Response): Promise<void> => {
      const studentId = getAuthenticatedUserId(request);
      if (request.auth?.role !== 'student') {
        throw new AppError('FORBIDDEN', 403, 'Only students can view their attendance summary');
      }
      const body: StudentAttendanceSummaryResponse = await attendanceService.getMySummary(
        studentId,
        request.auth.schoolId,
      );
      response.status(200).json(body);
    },
  };
}
