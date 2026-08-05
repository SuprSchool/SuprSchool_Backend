import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

import { createAttendanceRouter } from '../src/routes/attendance.routes.js';
import { createAttendanceService as createAttendanceApplicationService } from '../src/services/attendance.service.js';
import type { AttendanceService } from '../src/services/attendance.service.js';
import type { AttendanceRepository } from '../src/db/repositories/attendance.repository.js';

const classId = '11111111-1111-4111-8111-111111111111';
const studentId = '33333333-3333-4333-8333-333333333333';

function createAttendanceService(): AttendanceService {
  return {
    getClassHistory: vi.fn(),
    getClassRoster: vi.fn(),
    getMySummary: vi.fn(),
    markBulk: vi.fn(),
  };
}

function createAuthenticatedRequest(userId: string, role: 'student' | 'teacher') {
  return async (
    requestValue: Request,
    _response: Response,
    next: NextFunction,
  ): Promise<void> => {
    requestValue.auth = { role, schoolId: 'school-1', userId };
    next();
  };
}

describe('attendance router', () => {
  it('returns server-computed status totals after marking the daily roster', async () => {
    const repository = {
      listQualifyingStreakAwards: vi.fn().mockResolvedValue([]),
      markBulk: vi.fn().mockResolvedValue({
        attendanceDate: '2026-07-11',
        classId,
        sessionId: '44444444-4444-4444-8444-444444444444',
        updatedRecords: 4,
      }),
    } as unknown as AttendanceRepository;
    const attendanceService = createAttendanceApplicationService({ repository });

    await expect(attendanceService.markBulk('teacher-1', {
      attendanceDate: '2026-07-11',
      classId,
      records: [
        { status: 'present', studentId: '33333333-3333-4333-8333-333333333331' },
        { status: 'present', studentId: '33333333-3333-4333-8333-333333333332' },
        { status: 'late', studentId: '33333333-3333-4333-8333-333333333333' },
        { status: 'absent', studentId: '33333333-3333-4333-8333-333333333334' },
      ],
    })).resolves.toMatchObject({ absent: 1, excused: 0, late: 1, present: 2 });
  });

  it('uses the authenticated teacher when marking bulk attendance', async () => {
    const attendanceService = createAttendanceService();
    vi.mocked(attendanceService.markBulk).mockResolvedValue({
      attendanceDate: '2026-07-11',
      classId,
      absent: 0,
      excused: 0,
      late: 0,
      present: 1,
      sessionId: '44444444-4444-4444-8444-444444444444',
      updatedRecords: 1,
    });
    const app = express();
    app.use(express.json());
    app.use(
      '/attendance',
      createAttendanceRouter(
        attendanceService,
        createAuthenticatedRequest('teacher-1', 'teacher'),
      ),
    );

    const response = await request(app).post('/attendance/mark-bulk').send({
      attendanceDate: '2026-07-11',
      classId,
      records: [{ status: 'present', studentId }],
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ updatedRecords: 1 });
    expect(attendanceService.markBulk).toHaveBeenCalledWith('teacher-1', {
      attendanceDate: '2026-07-11',
      classId,
      records: [{ status: 'present', studentId }],
    });
  });

  it('marks one class attendance record per date without requiring a subject', async () => {
    const attendanceService = createAttendanceService();
    vi.mocked(attendanceService.markBulk).mockResolvedValue({
      attendanceDate: '2026-07-11',
      classId,
      absent: 0,
      excused: 0,
      late: 0,
      present: 1,
      sessionId: '44444444-4444-4444-8444-444444444444',
      updatedRecords: 1,
    });
    const app = express();
    app.use(express.json());
    app.use(
      '/attendance',
      createAttendanceRouter(
        attendanceService,
        createAuthenticatedRequest('teacher-1', 'teacher'),
      ),
    );

    const response = await request(app).post('/attendance/mark-bulk').send({
      attendanceDate: '2026-07-11',
      classId,
      records: [{ status: 'present', studentId }],
    });

    expect(response.status).toBe(200);
    expect(attendanceService.markBulk).toHaveBeenCalledWith('teacher-1', {
      attendanceDate: '2026-07-11',
      classId,
      records: [{ status: 'present', studentId }],
    });
  });

  it('returns a class roster for an assigned teacher without a subject parameter', async () => {
    const attendanceService = createAttendanceService();
    vi.mocked(attendanceService.getClassRoster).mockResolvedValue([
      { id: studentId, isPresent: true, name: 'Student One', rollNumber: 1, status: 'present' },
    ]);
    const app = express();
    app.use('/attendance', createAttendanceRouter(
      attendanceService,
      createAuthenticatedRequest('teacher-1', 'teacher'),
    ));

    const response = await request(app).get(
      `/attendance/classes/${classId}/students?date=2026-07-11`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      students: [{ id: studentId, isPresent: true, name: 'Student One', rollNumber: 1, status: 'present' }],
    });
    expect(attendanceService.getClassRoster).toHaveBeenCalledWith(
      'teacher-1',
      classId,
      '2026-07-11',
    );
  });

  it('returns daily class history for an assigned teacher without a subject parameter', async () => {
    const attendanceService = createAttendanceService();
    vi.mocked(attendanceService.getClassHistory).mockResolvedValue([
      { absent: 1, attendanceDate: '2026-07-11', id: 'session-1', present: 24, totalStudents: 25 },
    ]);
    const app = express();
    app.use('/attendance', createAttendanceRouter(
      attendanceService,
      createAuthenticatedRequest('teacher-1', 'teacher'),
    ));

    const response = await request(app).get(`/attendance/classes/${classId}/history`);

    expect(response.status).toBe(200);
    expect(response.body.entries).toHaveLength(1);
    expect(attendanceService.getClassHistory).toHaveBeenCalledWith('teacher-1', classId);
  });

  it('uses the authenticated student school when loading a summary', async () => {
    const attendanceService = createAttendanceService();
    vi.mocked(attendanceService.getMySummary).mockResolvedValue({
      absent: 1,
      excused: 0,
      late: 1,
      present: 8,
      studentId: 'student-1',
      totalSessions: 10,
    });
    const app = express();
    app.use(
      '/attendance',
      createAttendanceRouter(
        attendanceService,
        createAuthenticatedRequest('student-1', 'student'),
      ),
    );

    const response = await request(app).get('/attendance/me/summary');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ totalSessions: 10, present: 8 });
    expect(attendanceService.getMySummary).toHaveBeenCalledWith('student-1', 'school-1');
  });

  it('does not expose student attendance summaries to teachers', async () => {
    const attendanceService = createAttendanceService();
    const app = express();
    app.use(
      '/attendance',
      createAttendanceRouter(
        attendanceService,
        createAuthenticatedRequest('teacher-1', 'teacher'),
      ),
    );

    const response = await request(app).get('/attendance/me/summary');

    expect(response.status).toBe(403);
    expect(attendanceService.getMySummary).not.toHaveBeenCalled();
  });

  it('does not allow a student token to mark class attendance', async () => {
    const attendanceService = createAttendanceService();
    const app = express();
    app.use(express.json());
    app.use(
      '/attendance',
      createAttendanceRouter(
        attendanceService,
        createAuthenticatedRequest('student-1', 'student'),
      ),
    );

    const response = await request(app).post('/attendance/mark-bulk').send({
      attendanceDate: '2026-07-11',
      classId,
      records: [{ status: 'present', studentId }],
    });

    expect(response.status).toBe(403);
    expect(attendanceService.markBulk).not.toHaveBeenCalled();
  });
});
