import type { Request, Response } from 'express';
import { z } from 'zod';

import { AppError } from '../lib/errors.js';
import type { StudentHomeService } from '../services/student-home.service.js';
import type {
  StudentHomeBirthdaysResponse,
  StudentHomeCalendarDayResponse,
  StudentHomeCalendarResponse,
  StudentHomeResponse,
} from '../types/student-home.js';

const calendarMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const calendarDateSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
  .refine((value) => {
    const parts = value.split('-');
    const year = Number(parts[0] ?? Number.NaN);
    const month = Number(parts[1] ?? Number.NaN);
    const day = Number(parts[2] ?? Number.NaN);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year
      && date.getUTCMonth() === month - 1
      && date.getUTCDate() === day;
  }, 'Use a real calendar date');

export interface StudentHomeController {
  getHome(request: Request, response: Response): Promise<void>;
  getCalendar(request: Request, response: Response): Promise<void>;
  getCalendarDay(request: Request, response: Response): Promise<void>;
  getBirthdays(request: Request, response: Response): Promise<void>;
}

function requireIdentity(request: Request) {
  if (!request.auth) {
    throw new AppError('UNAUTHORIZED', 401, 'A valid bearer token is required');
  }
  return request.auth;
}

export function createStudentHomeController(
  studentHomeService: StudentHomeService,
): StudentHomeController {
  return {
    async getHome(request: Request, response: Response): Promise<void> {
      const body: StudentHomeResponse = await studentHomeService.getHome(
        requireIdentity(request).userId,
      );
      response.status(200).json(body);
    },
    async getCalendar(request: Request, response: Response): Promise<void> {
      const month = calendarMonthSchema.parse(request.query.month);
      const identity = requireIdentity(request);
      const body: StudentHomeCalendarResponse = await studentHomeService.getCalendar(
        { schoolId: identity.schoolId, userId: identity.userId },
        month,
      );
      response.status(200).json(body);
    },
    async getCalendarDay(request: Request, response: Response): Promise<void> {
      const date = calendarDateSchema.parse(request.params.date);
      const identity = requireIdentity(request);
      const body: StudentHomeCalendarDayResponse = await studentHomeService.getCalendarDay(
        { schoolId: identity.schoolId, userId: identity.userId },
        date,
      );
      response.status(200).json(body);
    },
    async getBirthdays(request: Request, response: Response): Promise<void> {
      const body: StudentHomeBirthdaysResponse = await studentHomeService.getBirthdays(
        requireIdentity(request).schoolId,
      );
      response.status(200).json(body);
    },
  };
}
