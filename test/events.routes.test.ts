import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

import { errorHandler } from '../src/middleware/error-handler.js';
import type { AuthenticationMiddleware } from '../src/middleware/authenticate.js';
import { createStudentEventsRouter } from '../src/routes/student-events.routes.js';
import { createTeacherEventsRouter } from '../src/routes/teacher-events.routes.js';
import type { EventsService } from '../src/services/events.service.js';

function createEventsService(): EventsService {
  return {
    archiveEvent: vi.fn(),
    createEvent: vi.fn(),
    createManagedTeam: vi.fn(),
    deleteTeam: vi.fn(),
    createTeam: vi.fn(),
    getStudentEvent: vi.fn(),
    getStudentResults: vi.fn(),
    getStudentTeam: vi.fn(),
    getTeacherEvent: vi.fn(),
    getTeacherResults: vi.fn(),
    listStudentParticipants: vi.fn(),
    listStudentTeams: vi.fn(),
    listParticipants: vi.fn(),
    listStudentEvents: vi.fn(),
    listTeacherEvents: vi.fn(),
    listTeams: vi.fn(),
    publishResults: vi.fn(),
    registerStudent: vi.fn(),
    tagParticipation: vi.fn(),
    replaceManagingTeam: vi.fn(),
    replaceTeams: vi.fn(),
    replaceTeamMembers: vi.fn(),
    updateEvent: vi.fn(),
    writeScores: vi.fn(),
  };
}

function authenticateAs(role: 'student' | 'teacher'): AuthenticationMiddleware {
  return async (
    requestValue: Request,
    _response: Response,
    next: NextFunction,
  ): Promise<void> => {
    requestValue.auth = { role, schoolId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
    next();
  };
}

describe('events routers', () => {
  it('rejects a teacher before student event browsing reaches the service', async () => {
    const service = createEventsService();
    const app = express();
    app.use('/student', createStudentEventsRouter(service, authenticateAs('teacher')));
    app.use(errorHandler);

    const response = await request(app).get('/student/events');

    expect(response.status).toBe(403);
    expect(service.listStudentEvents).not.toHaveBeenCalled();
  });

  it('rejects a client-supplied school authority before registration persistence', async () => {
    const service = createEventsService();
    const app = express();
    app.use(express.json());
    app.use('/student', createStudentEventsRouter(service, authenticateAs('student')));
    app.use(errorHandler);

    const response = await request(app)
      .post('/student/events/cccccccc-cccc-4ccc-8ccc-cccccccccccc/registrations')
      .send({ schoolId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' });

    expect(response.status).toBe(400);
    expect(service.registerStudent).not.toHaveBeenCalled();
  });

  it('rejects a student before teacher event creation reaches persistence', async () => {
    const service = createEventsService();
    const app = express();
    app.use(express.json());
    app.use('/teacher', createTeacherEventsRouter(service, authenticateAs('student')));
    app.use(errorHandler);

    const response = await request(app).post('/teacher/events').send({
      activityKind: 'event',
      startsAt: '2026-07-20T10:00:00.000Z',
      targetClassIds: ['11111111-1111-4111-8111-111111111111'],
      title: 'Science fair',
    });

    expect(response.status).toBe(403);
    expect(service.createEvent).not.toHaveBeenCalled();
  });
});

describe('event participation tagging', () => {
  it('uses the authenticated teacher to tag a participant', async () => {
    const service = createEventsService();
    const tagParticipation = vi.fn().mockResolvedValue({ tag: 'attended' });
    Object.assign(service, { tagParticipation });
    const app = express();
    app.use(express.json());
    app.use('/teacher', createTeacherEventsRouter(service, authenticateAs('teacher')));
    app.use(errorHandler);

    const response = await request(app)
      .put('/teacher/events/cccccccc-cccc-4ccc-8ccc-cccccccccccc/participants/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/tag')
      .send({ tag: 'attended' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ tag: 'attended' });
    expect(tagParticipation).toHaveBeenCalledWith(
      { schoolId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'attended',
    );
  });
});

describe('event action contracts', () => {
  const eventId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const studentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const teamId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

  it('returns the durable registration and preserves an existing registration', async () => {
    const service = createEventsService();
    const registerStudent = vi.fn().mockResolvedValue({
      created: false,
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      registeredAt: '2026-07-20T10:00:00.000000Z',
      teamId: null,
      teamName: null,
    });
    Object.assign(service, { registerStudent });
    const app = express();
    app.use(express.json());
    app.use('/student', createStudentEventsRouter(service, authenticateAs('student')));
    app.use(errorHandler);

    const response = await request(app)
      .post(`/student/events/${eventId}/registrations`)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({ created: false, teamId: null }));
    expect(registerStudent).toHaveBeenCalledWith(
      { schoolId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      eventId,
    );
  });

  it('creates a student team from durable student ids', async () => {
    const service = createEventsService();
    const createTeam = vi.fn().mockResolvedValue({ id: teamId, memberCount: 1, name: 'Sparta' });
    Object.assign(service, { createTeam });
    const app = express();
    app.use(express.json());
    app.use('/student', createStudentEventsRouter(service, authenticateAs('student')));
    app.use(errorHandler);

    const response = await request(app)
      .post(`/student/events/${eventId}/teams`)
      .send({ memberStudentIds: [studentId], name: 'Sparta' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ id: teamId, memberCount: 1, name: 'Sparta' });
    expect(createTeam).toHaveBeenCalledWith(
      { schoolId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      eventId,
      { memberStudentIds: [studentId], name: 'Sparta' },
    );
  });

  it('replaces participant team members at the team contract path', async () => {
    const service = createEventsService();
    const replaceTeamMembers = vi.fn().mockResolvedValue({ id: teamId, memberCount: 1, name: 'Sparta' });
    Object.assign(service, { replaceTeamMembers });
    const app = express();
    app.use(express.json());
    app.use('/teacher', createTeacherEventsRouter(service, authenticateAs('teacher')));
    app.use(errorHandler);

    const response = await request(app)
      .put(`/teacher/events/${eventId}/teams/${teamId}/members`)
      .send({ memberStudentIds: [studentId] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: teamId, memberCount: 1, name: 'Sparta' });
    expect(replaceTeamMembers).toHaveBeenCalledWith(
      { schoolId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      eventId,
      teamId,
      [studentId],
    );
    expect(service.replaceManagingTeam).not.toHaveBeenCalled();
  });

  it('returns current teacher result state before or after publication', async () => {
    const service = createEventsService();
    const getTeacherResults = vi.fn().mockResolvedValue({
      entries: [{ rank: 1, score: 10, targetId: teamId, targetName: 'Sparta', targetType: 'team' }],
      publishedAt: null,
      revision: 2,
    });
    Object.assign(service, { getTeacherResults });
    const app = express();
    app.use(express.json());
    app.use('/teacher', createTeacherEventsRouter(service, authenticateAs('teacher')));
    app.use(errorHandler);

    const response = await request(app).get(`/teacher/events/${eventId}/results`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({ publishedAt: null, revision: 2 }));
    expect(getTeacherResults).toHaveBeenCalledWith(
      { schoolId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      eventId,
    );
  });

  it('returns an empty student result state before publication without failing event reads', async () => {
    const service = createEventsService();
    const getStudentResults = vi.fn().mockResolvedValue({ entries: [], publishedAt: null, revision: 4 });
    Object.assign(service, { getStudentResults });
    const app = express();
    app.use('/student', createStudentEventsRouter(service, authenticateAs('student')));
    app.use(errorHandler);

    const response = await request(app).get(`/student/events/${eventId}/results`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ entries: [], publishedAt: null, revision: 4 });
  });

  it('replaces every participant team in one authenticated request', async () => {
    const service = createEventsService();
    const replaceTeams = vi.fn().mockResolvedValue([
      { id: teamId, memberCount: 1, name: 'Sparta' },
    ]);
    Object.assign(service, { replaceTeams });
    const app = express();
    app.use(express.json());
    app.use('/teacher', createTeacherEventsRouter(service, authenticateAs('teacher')));
    app.use(errorHandler);

    const response = await request(app)
      .put(`/teacher/events/${eventId}/teams`)
      .send({ teams: [{ id: teamId, memberStudentIds: [studentId], name: 'Sparta' }] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: teamId, memberCount: 1, name: 'Sparta' }]);
    expect(replaceTeams).toHaveBeenCalledWith(
      { schoolId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      eventId,
      [{ id: teamId, memberStudentIds: [studentId], name: 'Sparta' }],
    );
  });
});
