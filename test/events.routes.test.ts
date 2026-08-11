import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

import { errorHandler } from '../src/middleware/error-handler.js';
import { AppError } from '../src/lib/errors.js';
import type { AuthenticationMiddleware } from '../src/middleware/authenticate.js';
import {
  IdempotencyStore,
  type IdempotencyRecord,
  type IdempotencyRecordStore,
} from '../src/platform/idempotency/idempotency-store.js';
import { createStudentEventsRouter } from '../src/routes/student-events.routes.js';
import { createTeacherEventsRouter } from '../src/routes/teacher-events.routes.js';
import type { EventsService } from '../src/services/events.service.js';
import type { StudentEventParticipant } from '../src/types/events.js';

function createEventsService(): EventsService {
  return {
    archiveEvent: vi.fn(),
    createEvent: vi.fn(),
    createManagedTeam: vi.fn(),
    confirmResourceUpload: vi.fn(),
    deleteResource: vi.fn(),
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
    listClassOptions: vi.fn(),
    listMemberOptions: vi.fn(),
    listStudentEvents: vi.fn(),
    listTeacherEvents: vi.fn(),
    listTeams: vi.fn(),
    recoverCreatedStudentTeam: vi.fn(),
    recoverCreatedManagedTeam: vi.fn(),
    publishResults: vi.fn(),
    requestResourceUploadSession: vi.fn(),
    registerStudent: vi.fn(),
    recoverCreatedEvent: vi.fn(),
    recoverUpdatedEvent: vi.fn(),
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

function createIdempotencyHarness() {
  const records = new Map<string, IdempotencyRecord>();
  let completionFailures = 0;
  const recordId = (school: string, user: string, key: string) => `${school}:${user}:${key}`;
  const store = {
    complete: async (school, user, key, response) => {
      if (completionFailures > 0) {
        completionFailures -= 1;
        throw new Error('completion unavailable');
      }
      const id = recordId(school, user, key);
      const existing = records.get(id);
      if (existing) records.set(id, { ...existing, responseBody: response.body, responseStatus: response.status });
    },
    completeOwned: async (school, user, key, requestHash, leaseToken, response) => {
      if (completionFailures > 0) {
        completionFailures -= 1;
        throw new Error('completion unavailable');
      }
      const id = recordId(school, user, key);
      const existing = records.get(id);
      if (
        existing?.requestHash !== requestHash
        || existing.responseStatus !== null
        || existing.leaseExpiresAt !== leaseToken
      ) return false;
      records.set(id, { ...existing, responseBody: response.body, responseStatus: response.status });
      return true;
    },
    create: async (record) => {
      const id = recordId(record.schoolId, record.userId, record.key);
      if (records.has(id)) return false;
      records.set(id, record);
      return true;
    },
    find: async (school, user, key) => records.get(recordId(school, user, key)),
    reclaimExpired: async (school, user, key, requestHash) => {
      const id = recordId(school, user, key);
      const existing = records.get(id);
      if (
        existing?.requestHash !== requestHash
        || existing.responseStatus !== null
        || existing.leaseExpiresAt === null
        || existing.leaseExpiresAt === undefined
        || Date.parse(existing.leaseExpiresAt) > Date.now()
      ) return undefined;
      const leaseToken = new Date(Date.now() + 600_000).toISOString();
      records.set(id, { ...existing, leaseExpiresAt: leaseToken });
      return leaseToken;
    },
    deletePending: async (school, user, key, requestHash) => {
      const id = recordId(school, user, key);
      const existing = records.get(id);
      if (existing?.requestHash === requestHash && existing.responseStatus === null) {
        records.delete(id);
      }
    },
    releaseOwned: async (school, user, key, requestHash, leaseToken) => {
      const id = recordId(school, user, key);
      const existing = records.get(id);
      if (
        existing?.requestHash !== requestHash
        || existing.responseStatus !== null
        || existing.leaseExpiresAt !== leaseToken
      ) return false;
      records.delete(id);
      return true;
    },
  } as IdempotencyRecordStore & {
    reclaimExpired(school: string, user: string, key: string, requestHash: string): Promise<string | undefined>;
    releaseOwned(school: string, user: string, key: string, requestHash: string, leaseToken: string): Promise<boolean>;
  };
  return {
    expirePending() {
      for (const [id, record] of records) {
        if (record.responseStatus === null) {
          records.set(id, { ...record, leaseExpiresAt: new Date(Date.now() - 1_000).toISOString() });
        }
      }
    },
    failNextCompletions(count = 1) {
      completionFailures = count;
    },
    idempotency: new IdempotencyStore(store),
    reclaimExpired: vi.spyOn(store, 'reclaimExpired'),
    release: vi.spyOn(store, 'releaseOwned'),
  };
}

function createIdempotencyStore(): IdempotencyStore {
  return createIdempotencyHarness().idempotency;
}

function createTeacherApp(service: EventsService, idempotency = createIdempotencyStore()) {
  const app = express();
  app.use(express.json());
  app.use('/teacher', createTeacherEventsRouter(service, authenticateAs('teacher'), idempotency));
  app.use(errorHandler);
  return app;
}

function createStudentApp(service: EventsService, idempotency = createIdempotencyStore()) {
  const app = express();
  app.use(express.json());
  app.use('/student', createStudentEventsRouter(service, authenticateAs('student'), idempotency));
  app.use(errorHandler);
  return app;
}

describe('events routers', () => {
  it('rejects archive lifecycle changes through the generic update route', async () => {
    const service = createEventsService();
    const app = express();
    app.use(express.json());
    app.use('/teacher', createTeacherEventsRouter(service, authenticateAs('teacher'), createIdempotencyStore()));
    app.use(errorHandler);

    const response = await request(app)
      .patch('/teacher/events/cccccccc-cccc-4ccc-8ccc-cccccccccccc')
      .send({ lifecycle: 'archived' });

    expect(response.status).toBe(400);
    expect(service.updateEvent).not.toHaveBeenCalled();
  });
  it('rejects a teacher before student event browsing reaches the service', async () => {
    const service = createEventsService();
    const app = express();
    app.use('/student', createStudentEventsRouter(service, authenticateAs('teacher'), createIdempotencyStore()));
    app.use(errorHandler);

    const response = await request(app).get('/student/events');

    expect(response.status).toBe(403);
    expect(service.listStudentEvents).not.toHaveBeenCalled();
  });

  it('rejects a client-supplied school authority before registration persistence', async () => {
    const service = createEventsService();
    const app = express();
    app.use(express.json());
    app.use('/student', createStudentEventsRouter(service, authenticateAs('student'), createIdempotencyStore()));
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
    app.use('/teacher', createTeacherEventsRouter(service, authenticateAs('student'), createIdempotencyStore()));
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

describe('event metadata idempotency', () => {
  const eventId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const createBody = {
    activityKind: 'event',
    startsAt: '2026-07-20T10:00:00.000Z',
    registrationDeadlineAt: '2026-07-19T10:00:00.000Z',
    targetClassIds: ['11111111-1111-4111-8111-111111111111'],
    title: 'Science fair',
  };

  it('requires an idempotency key before creating event metadata', async () => {
    const service = createEventsService();
    const response = await request(createTeacherApp(service))
      .post('/teacher/events')
      .send(createBody);

    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe('Idempotency-Key is required for event metadata mutations');
    expect(service.createEvent).not.toHaveBeenCalled();
  });

  it('replays a completed create and rejects the same key with a different request', async () => {
    const service = createEventsService();
    vi.mocked(service.createEvent).mockResolvedValue({ id: eventId } as never);
    const app = createTeacherApp(service);

    const first = await request(app)
      .post('/teacher/events')
      .set('Idempotency-Key', 'event-create-1')
      .send(createBody);
    const replay = await request(app)
      .post('/teacher/events')
      .set('Idempotency-Key', 'event-create-1')
      .send(createBody);
    const conflict = await request(app)
      .post('/teacher/events')
      .set('Idempotency-Key', 'event-create-1')
      .send({ ...createBody, title: 'Different fair' });

    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual({ id: eventId });
    expect(conflict.status).toBe(409);
    expect(service.createEvent).toHaveBeenCalledTimes(1);
  });

  it('rejects an in-progress duplicate while the first create is pending', async () => {
    const service = createEventsService();
    let resolveCreate!: (value: { id: string }) => void;
    vi.mocked(service.createEvent).mockImplementation(() => new Promise((resolve) => {
      resolveCreate = resolve as (value: { id: string }) => void;
    }) as never);
    const app = createTeacherApp(service);

    const firstResponse = request(app)
      .post('/teacher/events')
      .set('Idempotency-Key', 'event-create-pending')
      .send(createBody);
    const firstPromise = firstResponse.then((response) => response);
    await vi.waitFor(() => expect(service.createEvent).toHaveBeenCalledTimes(1));

    const duplicate = await request(app)
      .post('/teacher/events')
      .set('Idempotency-Key', 'event-create-pending')
      .send(createBody);
    resolveCreate({ id: eventId });
    const first = await firstPromise;

    expect(duplicate.status).toBe(409);
    expect(first.status).toBe(201);
    expect(service.createEvent).toHaveBeenCalledTimes(1);
  });

  it('releases a retryable 503 and replays a completed event update', async () => {
    const service = createEventsService();
    vi.mocked(service.updateEvent)
      .mockRejectedValueOnce(new AppError('INTERNAL_ERROR', 503, 'Please retry'))
      .mockResolvedValue({ id: eventId, title: 'Updated fair' } as never);
    const app = createTeacherApp(service);

    await request(app)
      .patch(`/teacher/events/${eventId}`)
      .set('Idempotency-Key', 'event-update-1')
      .send({ title: 'Updated fair' })
      .expect(503);
    const retry = await request(app)
      .patch(`/teacher/events/${eventId}`)
      .set('Idempotency-Key', 'event-update-1')
      .send({ title: 'Updated fair' });
    const replay = await request(app)
      .patch(`/teacher/events/${eventId}`)
      .set('Idempotency-Key', 'event-update-1')
      .send({ title: 'Updated fair' });

    expect(retry.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual({ id: eventId, title: 'Updated fair' });
    expect(service.updateEvent).toHaveBeenCalledTimes(2);
  });

  it('keeps a non-retryable failure closed instead of releasing its claim', async () => {
    const service = createEventsService();
    vi.mocked(service.createEvent).mockRejectedValue(
      new AppError('INTERNAL_ERROR', 500, 'Creation failed'),
    );
    const app = createTeacherApp(service);

    await request(app)
      .post('/teacher/events')
      .set('Idempotency-Key', 'event-create-failed')
      .send(createBody)
      .expect(500);
    const duplicate = await request(app)
      .post('/teacher/events')
      .set('Idempotency-Key', 'event-create-failed')
      .send(createBody);

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.message).toBe(
      'A request with this Idempotency-Key is already in progress',
    );
    expect(service.createEvent).toHaveBeenCalledTimes(1);
  });

  it('recovers a committed create after completion persistence fails without creating twice', async () => {
    const service = createEventsService();
    const harness = createIdempotencyHarness();
    let committed: { id: string; title: string } | undefined;
    vi.mocked(service.createEvent).mockImplementation((...args: unknown[]) => {
      const deterministicId = typeof args[1] === 'string' ? args[1] : eventId;
      committed = { id: deterministicId, title: createBody.title };
      return Promise.resolve(committed) as never;
    });
    const recoverCreatedEvent = vi.fn(async (_identity, deterministicId: string) => (
      committed?.id === deterministicId ? committed : undefined
    ));
    Object.assign(service, { recoverCreatedEvent });
    harness.failNextCompletions(3);
    const app = createTeacherApp(service, harness.idempotency);

    await request(app)
      .post('/teacher/events')
      .set('Idempotency-Key', 'event-create-completion-crash')
      .send(createBody)
      .expect(503);
    harness.expirePending();
    harness.failNextCompletions(0);
    const recovered = await request(app)
      .post('/teacher/events')
      .set('Idempotency-Key', 'event-create-completion-crash')
      .send(createBody);

    expect(recovered.status).toBe(201);
    expect(service.createEvent).toHaveBeenCalledTimes(1);
    expect(recoverCreatedEvent).toHaveBeenCalledOnce();
    expect(harness.reclaimExpired).toHaveBeenCalledOnce();
  });

  it('atomically reclaims one expired lease while a concurrent retry remains in progress', async () => {
    const service = createEventsService();
    const harness = createIdempotencyHarness();
    let committed: { id: string; title: string } | undefined;
    let resolveRecovery!: (value: { id: string; title: string }) => void;
    vi.mocked(service.createEvent).mockImplementation((...args: unknown[]) => {
      const deterministicId = typeof args[1] === 'string' ? args[1] : eventId;
      committed = { id: deterministicId, title: createBody.title };
      return Promise.resolve(committed) as never;
    });
    const recoverCreatedEvent = vi.fn((_identity, deterministicId: string) => {
      if (committed?.id !== deterministicId) return Promise.resolve(undefined);
      return new Promise<{ id: string; title: string }>((resolve) => {
        resolveRecovery = resolve;
      });
    });
    Object.assign(service, { recoverCreatedEvent });
    harness.failNextCompletions(3);
    const app = createTeacherApp(service, harness.idempotency);

    await request(app)
      .post('/teacher/events')
      .set('Idempotency-Key', 'event-create-expired-race')
      .send(createBody)
      .expect(503);
    harness.expirePending();
    harness.failNextCompletions(0);
    const recoveryPromise = request(app)
      .post('/teacher/events')
      .set('Idempotency-Key', 'event-create-expired-race')
      .send(createBody)
      .then((response) => response);
    await vi.waitFor(() => expect(recoverCreatedEvent).toHaveBeenCalledOnce());

    const concurrent = await request(app)
      .post('/teacher/events')
      .set('Idempotency-Key', 'event-create-expired-race')
      .send(createBody);
    resolveRecovery(committed!);
    const recovered = await recoveryPromise;

    expect(concurrent.status).toBe(409);
    expect(recovered.status).toBe(201);
    expect(service.createEvent).toHaveBeenCalledTimes(1);
    expect(harness.reclaimExpired).toHaveBeenCalledOnce();
  });

  it('reconciles a post-update 503 receipt instead of releasing an ambiguous mutation', async () => {
    const service = createEventsService();
    const harness = createIdempotencyHarness();
    const updated = { id: eventId, title: 'Updated fair' };
    vi.mocked(service.updateEvent).mockRejectedValue(
      new AppError('INTERNAL_ERROR', 503, 'Hydration unavailable after commit'),
    );
    const recoverUpdatedEvent = vi.fn().mockResolvedValue(updated);
    Object.assign(service, { recoverUpdatedEvent });
    const app = createTeacherApp(service, harness.idempotency);

    const response = await request(app)
      .patch(`/teacher/events/${eventId}`)
      .set('Idempotency-Key', 'event-update-post-write-503')
      .send({ title: 'Updated fair' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(updated);
    expect(service.updateEvent).toHaveBeenCalledOnce();
    expect(recoverUpdatedEvent).toHaveBeenCalledOnce();
    expect(harness.release).not.toHaveBeenCalled();
  });

  it('returns the fenced winner response when a stale create worker resumes after lease takeover', async () => {
    const service = createEventsService();
    let resolveStale!: (value: { id: string; marker: string }) => void;
    vi.mocked(service.createEvent)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveStale = resolve; }) as never)
      .mockResolvedValueOnce({ id: eventId, marker: 'winner' } as never);
    const claims = [
      { leaseToken: 'stale-token', requestHash: 'a'.repeat(64), state: 'claimed' as const },
      { state: 'expired' as const },
    ];
    let completedResponse: { body: unknown; status: number } | undefined;
    const complete = vi.fn(async (_request, response) => { completedResponse = response; });
    const completeOwned = vi.fn(async (_request, leaseToken: string, response) => {
      if (leaseToken === 'winner-token') {
        completedResponse = response;
        return { response, state: 'completed' as const };
      }
      return completedResponse === undefined
        ? { state: 'ownership_lost' as const }
        : { response: completedResponse, state: 'completed' as const };
    });
    const idempotency = {
      claim: vi.fn(async () => claims.shift()!),
      complete,
      completeOwned,
      reclaimExpired: vi.fn().mockResolvedValue('winner-token'),
      release: vi.fn(),
      releaseOwned: vi.fn(),
    } as unknown as IdempotencyStore;
    const app = createTeacherApp(service, idempotency);

    const stalePromise = request(app)
      .post('/teacher/events')
      .set('Idempotency-Key', 'event-create-stale-worker')
      .send(createBody)
      .then((response) => response);
    await vi.waitFor(() => expect(service.createEvent).toHaveBeenCalledTimes(1));
    const winner = await request(app)
      .post('/teacher/events')
      .set('Idempotency-Key', 'event-create-stale-worker')
      .send(createBody);
    resolveStale({ id: eventId, marker: 'stale' });
    const stale = await stalePromise;

    expect(winner.status).toBe(201);
    expect(winner.body.marker).toBe('winner');
    expect(stale.status).toBe(201);
    expect(stale.body.marker).toBe('winner');
    expect(complete).not.toHaveBeenCalled();
    expect(completeOwned).toHaveBeenCalledTimes(2);
  });

  it('does not let a stale failed worker delete the newer owner lease', async () => {
    const service = createEventsService();
    let rejectStale!: (error: Error) => void;
    let resolveWinner!: (value: { id: string; marker: string }) => void;
    vi.mocked(service.createEvent)
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectStale = reject; }) as never)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveWinner = resolve; }) as never);
    const claims = [
      { leaseToken: 'stale-token', requestHash: 'b'.repeat(64), state: 'claimed' as const },
      { state: 'expired' as const },
    ];
    const release = vi.fn();
    const releaseOwned = vi.fn(async (_request, leaseToken: string) => (
      leaseToken === 'stale-token'
        ? { state: 'ownership_lost' as const }
        : { state: 'released' as const }
    ));
    const idempotency = {
      claim: vi.fn(async () => claims.shift()!),
      complete: vi.fn(),
      completeOwned: vi.fn(async (_request, _leaseToken, response) => ({ response, state: 'completed' as const })),
      reclaimExpired: vi.fn().mockResolvedValue('winner-token'),
      release,
      releaseOwned,
    } as unknown as IdempotencyStore;
    const app = createTeacherApp(service, idempotency);

    const stalePromise = request(app)
      .post('/teacher/events')
      .set('Idempotency-Key', 'event-create-stale-release')
      .send(createBody)
      .then((response) => response);
    await vi.waitFor(() => expect(service.createEvent).toHaveBeenCalledTimes(1));
    const winnerPromise = request(app)
      .post('/teacher/events')
      .set('Idempotency-Key', 'event-create-stale-release')
      .send(createBody)
      .then((response) => response);
    await vi.waitFor(() => expect(service.createEvent).toHaveBeenCalledTimes(2));

    rejectStale(new AppError('INTERNAL_ERROR', 503, 'Retryable pre-commit failure'));
    const stale = await stalePromise;
    resolveWinner({ id: eventId, marker: 'winner' });
    const winner = await winnerPromise;

    expect(stale.status).toBe(409);
    expect(winner.status).toBe(201);
    expect(release).not.toHaveBeenCalled();
    expect(releaseOwned).toHaveBeenCalledWith(expect.anything(), 'stale-token');
  });
});

describe('event participation tagging', () => {
  it('uses the authenticated teacher to tag a participant', async () => {
    const service = createEventsService();
    const tagParticipation = vi.fn().mockResolvedValue({ tag: 'attended' });
    Object.assign(service, { tagParticipation });
    const app = express();
    app.use(express.json());
    app.use('/teacher', createTeacherEventsRouter(service, authenticateAs('teacher'), createIdempotencyStore()));
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
    app.use('/student', createStudentEventsRouter(service, authenticateAs('student'), createIdempotencyStore()));
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
    const app = createStudentApp(service);

    const response = await request(app)
      .post(`/student/events/${eventId}/teams`)
      .set('Idempotency-Key', 'student-team-create-1')
      .send({ memberStudentIds: [studentId], name: 'Sparta' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ id: teamId, memberCount: 1, name: 'Sparta' });
    expect(createTeam).toHaveBeenCalledWith(
      { schoolId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      eventId,
      expect.stringMatching(/^[0-9a-f-]{36}$/),
      { memberStudentIds: [studentId], name: 'Sparta' },
    );
  });


  it('replays student team creation and rejects an idempotency key reused with another team', async () => {
    const service = createEventsService();
    const createTeam = vi.fn().mockResolvedValue({ id: teamId, memberCount: 1, name: 'Sparta' });
    Object.assign(service, { createTeam });
    const app = createStudentApp(service);

    const first = await request(app)
      .post(`/student/events/${eventId}/teams`)
      .set('Idempotency-Key', 'student-team-replay')
      .send({ memberStudentIds: [studentId], name: 'Sparta' });
    const replay = await request(app)
      .post(`/student/events/${eventId}/teams`)
      .set('Idempotency-Key', 'student-team-replay')
      .send({ memberStudentIds: [studentId], name: 'Sparta' });
    const conflict = await request(app)
      .post(`/student/events/${eventId}/teams`)
      .set('Idempotency-Key', 'student-team-replay')
      .send({ memberStudentIds: [studentId], name: 'Athena' });

    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.message).toBe(
      'Idempotency-Key cannot be reused with a different event team creation request',
    );
    expect(createTeam).toHaveBeenCalledOnce();
  });

  it('recovers a committed student team after completion persistence fails', async () => {
    const service = createEventsService();
    const harness = createIdempotencyHarness();
    let committed: { id: string; memberCount: number; name: string } | undefined;
    const createTeam = vi.fn(async (_identity, _eventId, deterministicId: string) => {
      committed = { id: deterministicId, memberCount: 1, name: 'Sparta' };
      return committed;
    });
    const recoverCreatedStudentTeam = vi.fn(async (_identity, _eventId, deterministicId: string) => (
      committed?.id === deterministicId ? committed : undefined
    ));
    Object.assign(service, { createTeam, recoverCreatedStudentTeam });
    harness.failNextCompletions(3);
    const app = createStudentApp(service, harness.idempotency);

    await request(app)
      .post(`/student/events/${eventId}/teams`)
      .set('Idempotency-Key', 'student-team-completion-crash')
      .send({ memberStudentIds: [studentId], name: 'Sparta' })
      .expect(503);
    harness.expirePending();
    harness.failNextCompletions(0);
    const recovered = await request(app)
      .post(`/student/events/${eventId}/teams`)
      .set('Idempotency-Key', 'student-team-completion-crash')
      .send({ memberStudentIds: [studentId], name: 'Sparta' });

    expect(recovered.status).toBe(201);
    expect(recovered.body).toEqual(committed);
    expect(createTeam).toHaveBeenCalledOnce();
    expect(recoverCreatedStudentTeam).toHaveBeenCalledOnce();
  });

  it('replays teacher-managed team creation without duplicating the team', async () => {
    const service = createEventsService();
    const createManagedTeam = vi.fn().mockResolvedValue({
      id: teamId,
      memberCount: 1,
      name: 'Sparta',
    });
    Object.assign(service, { createManagedTeam });
    const app = createTeacherApp(service);

    const first = await request(app)
      .post(`/teacher/events/${eventId}/teams`)
      .set('Idempotency-Key', 'teacher-team-replay')
      .send({ memberStudentIds: [studentId], name: 'Sparta' });
    const replay = await request(app)
      .post(`/teacher/events/${eventId}/teams`)
      .set('Idempotency-Key', 'teacher-team-replay')
      .send({ memberStudentIds: [studentId], name: 'Sparta' });

    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    expect(createManagedTeam).toHaveBeenCalledOnce();
    expect(createManagedTeam).toHaveBeenCalledWith(
      { schoolId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      eventId,
      expect.stringMatching(/^[0-9a-f-]{36}$/),
      { memberStudentIds: [studentId], name: 'Sparta' },
    );
  });
  it('replaces participant team members at the team contract path', async () => {
    const service = createEventsService();
    const replaceTeamMembers = vi.fn().mockResolvedValue({ id: teamId, memberCount: 1, name: 'Sparta' });
    Object.assign(service, { replaceTeamMembers });
    const app = express();
    app.use(express.json());
    app.use('/teacher', createTeacherEventsRouter(service, authenticateAs('teacher'), createIdempotencyStore()));
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
    app.use('/teacher', createTeacherEventsRouter(service, authenticateAs('teacher'), createIdempotencyStore()));
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
    app.use('/student', createStudentEventsRouter(service, authenticateAs('student'), createIdempotencyStore()));
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
    app.use('/teacher', createTeacherEventsRouter(service, authenticateAs('teacher'), createIdempotencyStore()));
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

describe('student event leaderboard participant data', () => {
  const eventId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  it('distinguishes points from score and ranks server-side', async () => {
    const service = createEventsService();
    const participants: StudentEventParticipant[] = [
      {
        avatarUrl: 'https://signed.example.test/asha.png',
        className: '10-A',
        participationTag: null,
        rank: 1,
        registeredAt: '2026-07-16T15:00:00.000000Z',
        registrationId: '77777777-7777-4777-8777-777777777771',
        score: 87,
        studentId: '88888888-8888-4888-8888-888888888881',
        studentName: 'Asha',
        teamId: null,
        teamName: null,
      },
      {
        avatarUrl: null,
        className: '10-A',
        participationTag: null,
        rank: 2,
        registeredAt: '2026-07-16T15:05:00.000000Z',
        registrationId: '77777777-7777-4777-8777-777777777772',
        score: 84,
        studentId: '88888888-8888-4888-8888-888888888882',
        studentName: 'Ravi',
        teamId: null,
        teamName: null,
      },
    ];
    const listStudentParticipants = vi.fn().mockResolvedValue(participants);
    Object.assign(service, { listStudentParticipants });

    const response = await request(createStudentApp(service)).get(`/student/events/${eventId}/participants`);

    expect(response.status).toBe(200);
    expect(response.body.items[0].rank).toBe(1);
    expect(response.body.items[0].score).toBe(87);
    expect(response.body.items[1].avatarUrl).toBeNull();
  });

  it('reports an unranked participant as null rather than a fabricated zero', async () => {
    const service = createEventsService();
    const participants: StudentEventParticipant[] = [
      {
        avatarUrl: null,
        className: '10-B',
        participationTag: null,
        rank: null,
        registeredAt: '2026-07-16T15:10:00.000000Z',
        registrationId: '77777777-7777-4777-8777-777777777773',
        score: null,
        studentId: '88888888-8888-4888-8888-888888888883',
        studentName: 'Meera',
        teamId: null,
        teamName: null,
      },
    ];
    Object.assign(service, { listStudentParticipants: vi.fn().mockResolvedValue(participants) });

    const response = await request(createStudentApp(service)).get(`/student/events/${eventId}/participants`);

    expect(response.status).toBe(200);
    expect(response.body.items[0]).toMatchObject({ avatarUrl: null, rank: null, score: null });
  });
});
