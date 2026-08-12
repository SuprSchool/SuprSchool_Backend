import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { errorHandler } from '../src/middleware/error-handler.js';
import { createStudentHomeRouter } from '../src/routes/student-home.routes.js';
import type { StudentHomeService } from '../src/services/student-home.service.js';

function createService(): StudentHomeService {
  return {
    getBirthdays: vi.fn(),
    getCalendar: vi.fn(),
    getCalendarDay: vi.fn(),
    getHome: vi.fn(),
  };
}

function createApp(service: StudentHomeService) {
  const app = express();
  app.use(
    '/v1/student/home',
    createStudentHomeRouter(service, async (req, _res, next) => {
      req.auth = { role: 'student', schoolId: 'school-1', userId: 'student-1' };
      next();
    }),
  );
  app.use(errorHandler);
  return app;
}

describe('student home read-model routes', () => {
  it('returns school-scoped calendar slots for the authenticated student', async () => {
    const service = createService();
    vi.mocked(service.getCalendar).mockResolvedValue({
      events: [{ date: '2026-07-20', id: 'slot-1:2026-07-20', title: 'Math', type: 'event' }],
    });

    const response = await request(createApp(service))
      .get('/v1/student/home/calendar?month=2026-07');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      events: [{ date: '2026-07-20', id: 'slot-1:2026-07-20', title: 'Math', type: 'event' }],
    });
    expect(service.getCalendar).toHaveBeenCalledWith({ schoolId: 'school-1', userId: 'student-1' }, '2026-07');
  });

  it('returns the selected day items for the authenticated student', async () => {
    const service = createService();
    vi.mocked(service.getCalendarDay).mockResolvedValue({
      items: [{
        id: 'slot-1:2026-07-20',
        location: 'Room 4',
        subject: 'Math',
        time: '09:00 - 10:00',
        title: 'Math',
        type: 'event',
      }],
    });

    const response = await request(createApp(service))
      .get('/v1/student/home/calendar/2026-07-20');

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(service.getCalendarDay).toHaveBeenCalledWith({ schoolId: 'school-1', userId: 'student-1' }, '2026-07-20');
  });

  it('rejects impossible calendar dates instead of normalizing them into another day', async () => {
    const service = createService();

    const response = await request(createApp(service))
      .get('/v1/student/home/calendar/2026-02-31');

    expect(response.status).toBe(400);
    expect(service.getCalendarDay).not.toHaveBeenCalled();
  });

  it('scopes birthdays with the authenticated school instead of caller input', async () => {
    const service = createService();
    vi.mocked(service.getBirthdays).mockResolvedValue({
      birthdays: [{ avatar: null, classLabel: '9 - A', id: 'student-2', name: 'Asha' }],
      upcoming: [],
      windowDays: 30,
    });

    const response = await request(createApp(service))
      .get('/v1/student/home/birthdays?schoolId=other-school');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      birthdays: [{ avatar: null, classLabel: '9 - A', id: 'student-2', name: 'Asha' }],
      upcoming: [],
      windowDays: 30,
    });
    expect(service.getBirthdays).toHaveBeenCalledWith('school-1', undefined);
  });

  it('carries the upcoming list and its horizon back to the caller', async () => {
    const service = createService();
    vi.mocked(service.getBirthdays).mockResolvedValue({
      birthdays: [],
      upcoming: [{
        avatar: null,
        classLabel: '9 - B',
        date: '2026-08-19',
        id: 'student-3',
        inDays: 7,
        name: 'Ravi',
      }],
      windowDays: 7,
    });

    const response = await request(createApp(service))
      .get('/v1/student/home/birthdays?window=7');

    expect(response.status).toBe(200);
    expect(response.body.upcoming).toEqual([{
      avatar: null,
      classLabel: '9 - B',
      date: '2026-08-19',
      id: 'student-3',
      inDays: 7,
      name: 'Ravi',
    }]);
    expect(service.getBirthdays).toHaveBeenCalledWith('school-1', 7);
  });

  // The horizon is the one thing a caller may set here, so it is the one thing
  // that has to be validated rather than passed through into a date interval.
  it.each(['0', '366', 'soon', '-5', '7.5'])('rejects window=%s', async (window) => {
    const service = createService();

    const response = await request(createApp(service))
      .get(`/v1/student/home/birthdays?window=${window}`);

    expect(response.status).toBe(400);
    expect(service.getBirthdays).not.toHaveBeenCalled();
  });
});
