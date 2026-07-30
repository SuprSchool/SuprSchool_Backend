import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import type { AuthenticationMiddleware } from '../src/middleware/authenticate.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import type { IdempotencyStore } from '../src/platform/idempotency/idempotency-store.js';
import { createStudentEventsRouter } from '../src/routes/student-events.routes.js';
import { createTeacherEventsRouter } from '../src/routes/teacher-events.routes.js';
import type { EventsService } from '../src/services/events.service.js';

const eventId = '11111111-1111-4111-8111-111111111111';
const schoolId = '22222222-2222-4222-8222-222222222222';
const studentId = '33333333-3333-4333-8333-333333333333';
const teacherId = '44444444-4444-4444-8444-444444444444';
const teamId = '55555555-5555-4555-8555-555555555555';
const unusedIdempotency = {} as IdempotencyStore;

function authenticateAs(role: 'student' | 'teacher'): AuthenticationMiddleware {
  return async (requestValue: Request, _response: Response, next: NextFunction): Promise<void> => {
    requestValue.auth = {
      role,
      schoolId,
      userId: role === 'student' ? studentId : teacherId,
    };
    next();
  };
}

function createService() {
  const service = {
    archiveEvent: vi.fn(),
    createEvent: vi.fn(),
    createTeam: vi.fn(),
    getStudentEvent: vi.fn(),
    getStudentResults: vi.fn(),
    getStudentTeam: vi.fn(),
    getTeacherEvent: vi.fn(),
    listParticipants: vi.fn().mockResolvedValue([]),
    listStudentEvents: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    listStudentParticipants: vi.fn().mockResolvedValue([]),
    listStudentTeams: vi.fn().mockResolvedValue([]),
    listTeacherEvents: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    listTeams: vi.fn().mockResolvedValue([]),
    publishResults: vi.fn().mockResolvedValue({ entries: [], publishedAt: '2026-07-16T12:00:00.000Z', revision: 1 }),
    registerStudent: vi.fn(),
    tagParticipation: vi.fn(),
    replaceManagingTeam: vi.fn().mockResolvedValue([]),
    updateEvent: vi.fn(),
    writeScores: vi.fn().mockResolvedValue({ revision: 1 }),
  };
  return { service: service as unknown as EventsService, spies: service };
}

describe('frozen Events route compatibility', () => {
  it('maps the documented student status query and public participant/team routes through student-scoped operations', async () => {
    const { service, spies } = createService();
    spies.getStudentTeam.mockResolvedValue({ id: teamId, memberCount: 2, name: 'Orbit' });
    const app = express();
    app.use('/student', createStudentEventsRouter(service, authenticateAs('student'), unusedIdempotency));
    app.use(errorHandler);

    await request(app).get('/student/events?status=registered').expect(200, { items: [], nextCursor: null });
    await request(app).get('/student/events?status=trending').expect(200, { items: [], nextCursor: null });
    await request(app).get('/student/events?status=completed').expect(200, { items: [], nextCursor: null });
    await request(app).get(`/student/events/${eventId}/participants`).expect(200, { items: [], nextCursor: null });
    await request(app).get(`/student/events/${eventId}/teams`).expect(200, { items: [], nextCursor: null });
    await request(app).get(`/student/events/${eventId}/teams/${teamId}`).expect(200, { id: teamId, memberCount: 2, name: 'Orbit' });

    expect(spies.listStudentEvents).toHaveBeenNthCalledWith(
      1,
      { schoolId, userId: studentId },
      { cursor: undefined, filter: 'registered', limit: 25 },
    );
    expect(spies.listStudentEvents).toHaveBeenNthCalledWith(
      2,
      { schoolId, userId: studentId },
      { cursor: undefined, filter: 'trending', limit: 25 },
    );
    expect(spies.listStudentEvents).toHaveBeenNthCalledWith(
      3,
      { schoolId, userId: studentId },
      { cursor: undefined, filter: 'completed', limit: 25 },
    );
    expect(spies.listStudentParticipants).toHaveBeenCalledWith({ schoolId, userId: studentId }, eventId);
    expect(spies.listStudentTeams).toHaveBeenCalledWith({ schoolId, userId: studentId }, eventId);
    expect(spies.getStudentTeam).toHaveBeenCalledWith({ schoolId, userId: studentId }, eventId, teamId);
  });

  it('maps documented teacher status, member-management, score, and publication paths without removing existing routes', async () => {
    const { service, spies } = createService();
    const app = express();
    app.use(express.json());
    app.use('/teacher', createTeacherEventsRouter(service, authenticateAs('teacher'), unusedIdempotency));
    app.use(errorHandler);
    const members = [{ memberType: 'student', role: 'Captain', userId: studentId }];

    await request(app).get('/teacher/events?scope=my&status=completed').expect(200, { items: [], nextCursor: null });
    await request(app).put(`/teacher/events/${eventId}/teams/${teamId}/members`).send({ members }).expect(200, []);
    await request(app).put(`/teacher/events/${eventId}/results`).send({ entries: [{ score: 12, targetId: teamId, targetType: 'team' }] }).expect(200, { revision: 1 });
    await request(app).post(`/teacher/events/${eventId}/publish-results`).send({}).expect(200, {
      entries: [], publishedAt: '2026-07-16T12:00:00.000Z', revision: 1,
    });

    expect(spies.listTeacherEvents).toHaveBeenCalledWith(
      { schoolId, userId: teacherId },
      { cursor: undefined, limit: 25, scope: 'my', status: 'completed' },
    );
    expect(spies.replaceManagingTeam).toHaveBeenCalledWith({ schoolId, userId: teacherId }, eventId, members);
    expect(spies.writeScores).toHaveBeenCalledWith({ schoolId, userId: teacherId }, eventId, [
      { score: 12, targetId: teamId, targetType: 'team' },
    ]);
    expect(spies.publishResults).toHaveBeenCalledWith({ schoolId, userId: teacherId }, eventId);
  });
});
