import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { errorHandler } from '../src/middleware/error-handler.js';
import type { Database } from '../src/db/client.js';
import {
  DrizzleScheduleRepository,
  TIMETABLE_TIME_ZONE,
} from '../src/db/repositories/schedule.repository.js';
import type { ScheduleRepository } from '../src/db/repositories/schedule.repository.js';
import type { AuthenticationMiddleware } from '../src/middleware/authenticate.js';
import { createStudentScheduleRouter } from '../src/routes/student-schedule.routes.js';
import { createTeacherScheduleRouter } from '../src/routes/teacher-schedule.routes.js';
import { createScheduleService as createScheduleApplicationService } from '../src/services/schedule.service.js';
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
      yearComparison: [],
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

  // `253:13058` draws one bar per academic year, oldest first.
  it('returns one bar per academic year with data', async () => {
    const service = createScheduleService();
    vi.mocked(service.getStudentAttendance).mockResolvedValue({
      period: 'yearly',
      periodEndDate: '2025-12-31',
      periodStartDate: '2025-01-01',
      records: [],
      summary: { absent: 0, excused: 0, late: 0, present: 0, totalSessions: 0 },
      yearComparison: [
        { percentage: 92.1, year: '2024' },
        { percentage: 94.6, year: '2025' },
      ],
    });
    const app = express();
    app.use('/student', createStudentScheduleRouter(service, authenticateAs('student')));
    app.use(errorHandler);

    const response = await request(app).get('/student/attendance?period=yearly&year=2025');

    expect(response.status).toBe(200);
    expect(response.body.yearComparison).toHaveLength(2);
    expect(response.body.yearComparison[1].year).toBe('2025');
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

const periodSchoolId = '55555555-5555-4555-8555-555555555555';
const periodTeacherId = '66666666-6666-4666-8666-666666666666';
const periodClassId = '11111111-1111-4111-8111-111111111111';
const englishSubjectId = '22222222-2222-4222-8222-222222222222';
const mathsSubjectId = '33333333-3333-4333-8333-333333333333';

function databaseReturning(
  rows: (query: unknown) => unknown,
): { database: Database; execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn(async (query: unknown) => rows(query));
  return { database: { execute } as unknown as Database, execute };
}

function renderedQuery(query: unknown): { params: unknown[]; sql: string } {
  return new PgDialect().sqlToQuery(query as SQL);
}

describe('timetable period labels', () => {
  it('names the period by the slot position in the class day, not by subject order', async () => {
    const { database, execute } = databaseReturning(() => [{ position: 2 }]);
    const schedule = new DrizzleScheduleRepository(database);

    await expect(
      schedule.findClassPeriodLabel(periodTeacherId, periodSchoolId, periodClassId, englishSubjectId),
    ).resolves.toBe('2nd Period');

    const query = JSON.stringify(execute.mock.calls[0]![0]);
    expect(query).toContain('class_schedule_slots');
    expect(query).toContain('row_number');
    // The teacher must own the slot's subject, and the school must scope it.
    expect(query).toContain('class_subjects');
    expect(query).toContain('user_roles');
  });

  it('returns null when the creation time falls outside the class timetable', async () => {
    const { database } = databaseReturning(() => []);
    const schedule = new DrizzleScheduleRepository(database);

    await expect(
      schedule.findClassPeriodLabel(periodTeacherId, periodSchoolId, periodClassId, englishSubjectId),
    ).resolves.toBeNull();
  });

  it('carries the ordinal suffix through the teen positions', async () => {
    const labels = await Promise.all([1, 2, 3, 4, 11, 12, 13, 21].map(async (position) => {
      const { database } = databaseReturning(() => [{ position }]);
      return new DrizzleScheduleRepository(database)
        .findClassPeriodLabel(periodTeacherId, periodSchoolId, periodClassId, englishSubjectId);
    }));

    expect(labels).toEqual([
      '1st Period', '2nd Period', '3rd Period', '4th Period',
      '11th Period', '12th Period', '13th Period', '21st Period',
    ]);
  });

  it('reads the wall clock in the timetable zone rather than the UTC session zone', async () => {
    const { database, execute } = databaseReturning(() => [{ position: 1 }]);

    await new DrizzleScheduleRepository(database)
      .findClassPeriodLabel(periodTeacherId, periodSchoolId, periodClassId, englishSubjectId);

    const query = JSON.stringify(execute.mock.calls[0]![0]);
    expect(query).toContain('at time zone');
    expect(query).toContain(TIMETABLE_TIME_ZONE);
  });

  // A teacher who takes two subjects for one class is inside the timetable all
  // period, so teacher-and-time alone would stamp the Maths ordinal on an
  // English recording. The label answers "which period was THIS subject
  // scheduled in", so the recording's own subject has to gate the slot.
  it('does not label a recording with a slot belonging to a different subject', async () => {
    // The class is in its 3rd period, and that period is Maths.
    const { database } = databaseReturning((query) => {
      const { params } = renderedQuery(query);
      const asksForASubject = params.includes(englishSubjectId) || params.includes(mathsSubjectId);
      return !asksForASubject || params.includes(mathsSubjectId) ? [{ position: 3 }] : [];
    });
    const schedule = new DrizzleScheduleRepository(database);

    await expect(
      schedule.findClassPeriodLabel(periodTeacherId, periodSchoolId, periodClassId, mathsSubjectId),
    ).resolves.toBe('3rd Period');
    await expect(
      schedule.findClassPeriodLabel(periodTeacherId, periodSchoolId, periodClassId, englishSubjectId),
    ).resolves.toBeNull();
  });

  it('gates on the subject only after the ordinal is counted over the whole class day', async () => {
    const { database, execute } = databaseReturning(() => [{ position: 3 }]);

    await new DrizzleScheduleRepository(database)
      .findClassPeriodLabel(periodTeacherId, periodSchoolId, periodClassId, englishSubjectId);

    const { params, sql } = renderedQuery(execute.mock.calls[0]![0]);
    expect(params).toContain(englishSubjectId);
    // Filtering inside the CTE would renumber the day around one subject and
    // turn the day's 3rd period into that subject's 1st.
    expect(sql.indexOf('row_number')).toBeLessThan(sql.indexOf('day_slots.subject_id ='));
  });
});

const yearStudentId = '77777777-7777-4777-8777-777777777777';

function createScheduleRepository(
  overrides: Partial<ScheduleRepository> = {},
): ScheduleRepository {
  return {
    findClassPeriodLabel: vi.fn(),
    findStudentAttendance: vi.fn().mockResolvedValue([]),
    findStudentAttendanceYearComparison: vi.fn().mockResolvedValue([]),
    findStudentTimetable: vi.fn(),
    findTeacherAttendanceHistory: vi.fn(),
    findTeacherPendingAttendance: vi.fn(),
    findTeacherTimetable: vi.fn(),
    ...overrides,
  };
}

describe('year-over-year attendance', () => {
  it('carries the per-year series on the student attendance response, oldest first', async () => {
    const repository = createScheduleRepository({
      findStudentAttendanceYearComparison: vi.fn().mockResolvedValue([
        { percentage: 92.1, year: '2024' },
        { percentage: 94.6, year: '2025' },
      ]),
    });
    const service = createScheduleApplicationService({ repository });

    const body = await service.getStudentAttendance(yearStudentId, periodSchoolId, {
      period: 'yearly',
      year: '2025',
    });

    expect(body.yearComparison).toEqual([
      { percentage: 92.1, year: '2024' },
      { percentage: 94.6, year: '2025' },
    ]);
    // Tenancy: the aggregate is scoped by the authenticated student's school.
    expect(repository.findStudentAttendanceYearComparison).toHaveBeenCalledWith(
      yearStudentId,
      periodSchoolId,
    );
  });

  it('returns only the years that have attendance, never a zero-filled year', async () => {
    const repository = createScheduleRepository({
      findStudentAttendanceYearComparison: vi.fn().mockResolvedValue([
        { percentage: 94.6, year: '2025' },
      ]),
    });
    const service = createScheduleApplicationService({ repository });

    const body = await service.getStudentAttendance(yearStudentId, periodSchoolId, {
      date: '2026-07-13',
      period: 'daily',
    });

    expect(body.yearComparison).toEqual([{ percentage: 94.6, year: '2025' }]);
  });

  it('groups by academic year over the classes the student belonged to, school-scoped', async () => {
    const { database, execute } = databaseReturning(() => []);

    await new DrizzleScheduleRepository(database)
      .findStudentAttendanceYearComparison(yearStudentId, periodSchoolId);

    const { params, sql } = renderedQuery(execute.mock.calls[0]![0]);
    expect(params).toContain(yearStudentId);
    expect(params).toContain(periodSchoolId);
    expect(sql).toContain('academic_years');
    // The student changes class between years, so the enrolment row for each
    // year — not the current class — decides which sessions count.
    expect(sql).toContain('class_members');
    // Matching the enrolment's own class as well would drop the earlier half of
    // a mid-year transfer, whose sessions belong to a class the surviving
    // membership row no longer names.
    expect(sql).not.toContain('membership.class_id');
    expect(sql).toContain('group by');
    // Oldest first is the frame's left-to-right order.
    expect(sql.indexOf('order by')).toBeLessThan(sql.indexOf('starts_on asc'));
    // A left join would manufacture a zero bar for a year with no attendance.
    expect(sql).not.toContain('left join');
  });

  it('reads the aggregate as a number even when the driver hands back numeric text', async () => {
    const { database } = databaseReturning(() => [
      { percentage: '92.1', year: '2023-2024' },
      { percentage: '94.6', year: '2024-2025' },
    ]);

    await expect(
      new DrizzleScheduleRepository(database)
        .findStudentAttendanceYearComparison(yearStudentId, periodSchoolId),
    ).resolves.toEqual([
      { percentage: 92.1, year: '2023-2024' },
      { percentage: 94.6, year: '2024-2025' },
    ]);
  });
});
