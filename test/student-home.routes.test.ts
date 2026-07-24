import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createStudentHomeRouter } from '../src/routes/student-home.routes.js';
import type { StudentHomeService } from '../src/services/student-home.service.js';

function createStudentHomeService(): StudentHomeService {
  return {
    getBirthdays: vi.fn(),
    getCalendar: vi.fn(),
    getCalendarDay: vi.fn(),
    getHome: vi.fn(),
  };
}

describe('GET /v1/student/home', () => {
  it('returns a read-only home payload for an authenticated student', async () => {
    const studentHomeService = createStudentHomeService();
    vi.mocked(studentHomeService.getHome).mockResolvedValue({
      announcements: [],
      birthdays: [],
      class: { displayName: '9 - A', id: 'class-1' },
      exams: [],
      schedule: { today: [], upcoming: [] },
    });
    const app = express();
    app.use(
      '/v1/student/home',
      createStudentHomeRouter(studentHomeService, async (request, _response, next) => {
        request.auth = { role: 'student', schoolId: 'school-1', userId: 'student-1' };
        next();
      }),
    );

    const response = await request(app).get('/v1/student/home');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      announcements: [],
      birthdays: [],
      class: { displayName: '9 - A', id: 'class-1' },
      exams: [],
      schedule: { today: [], upcoming: [] },
    });
    expect(studentHomeService.getHome).toHaveBeenCalledWith('student-1');
  });
});
