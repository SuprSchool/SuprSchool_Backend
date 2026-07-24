import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

import { errorHandler } from '../src/middleware/error-handler.js';
import type { AuthenticationMiddleware } from '../src/middleware/authenticate.js';
import { createStudentScheduleRouter } from '../src/routes/student-schedule.routes.js';
import { createTeacherScheduleRouter } from '../src/routes/teacher-schedule.routes.js';
import type { ScheduleService } from '../src/services/schedule.service.js';

function createScheduleService(): ScheduleService {
  return {
    getStudentAttendance: vi.fn(),
    getStudentTimetable: vi.fn(),
    getTeacherPendingAttendance: vi.fn(),
    getTeacherAttendanceHistory: vi.fn(),
    getTeacherTimetable: vi.fn(),
  };
}

function authenticateAs(role: 'student' | 'teacher'): AuthenticationMiddleware {
  return async (
    requestValue: Request,
    _response: Response,
    next: NextFunction,
  ): Promise<void> => {
    requestValue.auth = { role, schoolId: 'school-1', userId: `${role}-1` };
    next();
  };
}

describe('schedule routers', () => {
  it('loads a student timetable for the requested ISO date', async () => {
    const service = createScheduleService();
    vi.mocked(service.getStudentTimetable).mockResolvedValue({
      date: '2026-07-13',
      entries: [],
    });
    const app = express();
    app.use('/student', createStudentScheduleRouter(service, authenticateAs('student')));
    app.use(errorHandler);

    const response = await request(app)
      .get('/student/schedule/timetable?date=2026-07-13');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ date: '2026-07-13', entries: [] });
    expect(service.getStudentTimetable).toHaveBeenCalledWith(
      'student-1',
      'school-1',
      '2026-07-13',
    );
  });

  it('loads each requested attendance grain for the authenticated student', async () => {
    const service = createScheduleService();
    vi.mocked(service.getStudentAttendance).mockResolvedValue({
      period: 'monthly',
      periodEndDate: '2026-07-31',
      periodStartDate: '2026-07-01',
      records: [],
      summary: { absent: 0, excused: 0, late: 0, present: 0, totalSessions: 0 },
    });
    const app = express();
    app.use('/student', createStudentScheduleRouter(service, authenticateAs('student')));
    app.use(errorHandler);

    const response = await request(app)
      .get('/student/attendance?period=monthly&month=2026-07');

    expect(response.status).toBe(200);
    expect(response.body.period).toBe('monthly');
    expect(service.getStudentAttendance).toHaveBeenCalledWith(
      'student-1',
      'school-1',
      { month: '2026-07', period: 'monthly' },
    );
  });

  it('rejects a missing period-specific attendance filter', async () => {
    const service = createScheduleService();
    const app = express();
    app.use('/student', createStudentScheduleRouter(service, authenticateAs('student')));
    app.use(errorHandler);

    const [missingDate, zeroMonth, zeroYear] = await Promise.all([
      request(app).get('/student/attendance?period=daily'),
      request(app).get('/student/attendance?period=monthly&month=0000-01'),
      request(app).get('/student/attendance?period=yearly&year=0000'),
    ]);

    expect(missingDate.status).toBe(400);
    expect(zeroMonth.status).toBe(400);
    expect(zeroYear.status).toBe(400);
    expect(service.getStudentAttendance).not.toHaveBeenCalled();
  });

  it('loads teacher timetable and unmarked assigned slots for a date', async () => {
    const service = createScheduleService();
    vi.mocked(service.getTeacherTimetable).mockResolvedValue({
      date: '2026-07-13',
      entries: [],
    });
    vi.mocked(service.getTeacherPendingAttendance).mockResolvedValue({
      date: '2026-07-13',
      slots: [],
    });
    const app = express();
    app.use('/teacher', createTeacherScheduleRouter(service, authenticateAs('teacher')));
    app.use(errorHandler);

    const [timetable, pending] = await Promise.all([
      request(app).get('/teacher/schedule/timetable?date=2026-07-13'),
      request(app).get('/teacher/attendance/pending?date=2026-07-13'),
    ]);

    expect(timetable.status).toBe(200);
    expect(pending.status).toBe(200);
    expect(service.getTeacherTimetable).toHaveBeenCalledWith(
      'teacher-1',
      'school-1',
      '2026-07-13',
    );
    expect(service.getTeacherPendingAttendance).toHaveBeenCalledWith(
      'teacher-1',
      'school-1',
      '2026-07-13',
    );
  });

  it('loads a bounded cursor page of a teacher class attendance history', async () => {
    const service = createScheduleService();
    vi.mocked(service.getTeacherAttendanceHistory).mockResolvedValue({ entries: [] });
    const app = express();
    app.use('/teacher', createTeacherScheduleRouter(service, authenticateAs('teacher')));
    app.use(errorHandler);

    const response = await request(app).get(
      '/teacher/attendance/history?classId=11111111-1111-4111-8111-111111111111&limit=25',
    );

    expect(response.status).toBe(200);
    expect(service.getTeacherAttendanceHistory).toHaveBeenCalledWith(
      'teacher-1',
      'school-1',
      { classId: '11111111-1111-4111-8111-111111111111', limit: 25 },
    );
  });

  it('rejects a malformed teacher attendance history cursor before database access', async () => {
    const service = createScheduleService();
    const app = express();
    app.use('/teacher', createTeacherScheduleRouter(service, authenticateAs('teacher')));
    app.use(errorHandler);

    const response = await request(app).get(
      '/teacher/attendance/history?classId=11111111-1111-4111-8111-111111111111&cursor=2026-99-99%7Cnot-a-uuid',
    );

    expect(response.status).toBe(400);
    expect(service.getTeacherAttendanceHistory).not.toHaveBeenCalled();
  });
});
