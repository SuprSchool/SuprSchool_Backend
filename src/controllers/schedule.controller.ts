import type { Request, Response } from 'express';

import { AppError } from '../lib/errors.js';
import type { ScheduleService } from '../services/schedule.service.js';
import type {
  StudentAttendanceDetailResponse,
  StudentTimetableResponse,
  TeacherPendingAttendanceResponse,
  TeacherTimetableResponse,
  TeacherAttendanceHistoryResponse,
} from '../types/schedule.js';
import {
  studentAttendanceQuerySchema,
  timetableQuerySchema,
  type StudentAttendanceQuery,
  type TimetableQuery,
  teacherAttendanceHistoryQuerySchema,
  type TeacherAttendanceHistoryQuery,
} from '../validators/schedule.schemas.js';

export interface ScheduleController {
  getStudentTimetable(request: Request, response: Response): Promise<void>;
  getStudentAttendance(request: Request, response: Response): Promise<void>;
  getTeacherTimetable(request: Request, response: Response): Promise<void>;
  getTeacherPendingAttendance(request: Request, response: Response): Promise<void>;
  getTeacherAttendanceHistory(request: Request, response: Response): Promise<void>;
}

function authenticatedIdentity(request: Request, role: 'student' | 'teacher') {
  if (!request.auth) {
    throw new AppError('UNAUTHORIZED', 401, 'A valid bearer token is required');
  }
  if (request.auth.role !== role) {
    throw new AppError('FORBIDDEN', 403, 'You do not have access to this resource');
  }

  return request.auth;
}

export function createScheduleController(service: ScheduleService): ScheduleController {
  return {
    async getStudentTimetable(request: Request, response: Response): Promise<void> {
      const query: TimetableQuery = timetableQuerySchema.parse(request.query);
      const identity = authenticatedIdentity(request, 'student');
      const body: StudentTimetableResponse = await service.getStudentTimetable(
        identity.userId,
        identity.schoolId,
        query.date,
      );
      response.status(200).json(body);
    },
    async getStudentAttendance(request: Request, response: Response): Promise<void> {
      const query: StudentAttendanceQuery = studentAttendanceQuerySchema.parse(request.query);
      const identity = authenticatedIdentity(request, 'student');
      const body: StudentAttendanceDetailResponse = await service.getStudentAttendance(
        identity.userId,
        identity.schoolId,
        query,
      );
      response.status(200).json(body);
    },
    async getTeacherTimetable(request: Request, response: Response): Promise<void> {
      const query: TimetableQuery = timetableQuerySchema.parse(request.query);
      const identity = authenticatedIdentity(request, 'teacher');
      const body: TeacherTimetableResponse = await service.getTeacherTimetable(
        identity.userId,
        identity.schoolId,
        query.date,
      );
      response.status(200).json(body);
    },
    async getTeacherPendingAttendance(request: Request, response: Response): Promise<void> {
      const query: TimetableQuery = timetableQuerySchema.parse(request.query);
      const identity = authenticatedIdentity(request, 'teacher');
      const body: TeacherPendingAttendanceResponse = await service.getTeacherPendingAttendance(
        identity.userId,
        identity.schoolId,
        query.date,
      );
      response.status(200).json(body);
    },
    async getTeacherAttendanceHistory(request: Request, response: Response): Promise<void> {
      const query: TeacherAttendanceHistoryQuery = teacherAttendanceHistoryQuerySchema.parse(request.query);
      const identity = authenticatedIdentity(request, 'teacher');
      const body: TeacherAttendanceHistoryResponse = await service.getTeacherAttendanceHistory(
        identity.userId,
        identity.schoolId,
        query,
      );
      response.status(200).json(body);
    },
  };
}
