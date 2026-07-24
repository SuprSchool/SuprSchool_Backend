import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

import { createDiaryRouter } from '../src/routes/diary.routes.js';
import { AppError } from '../src/lib/errors.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { createDiaryService as createDiaryApplicationService } from '../src/services/diary.service.js';
import type { DiaryService } from '../src/services/diary.service.js';
import type { DiaryRepository } from '../src/db/repositories/diary.repository.js';
import type { DiaryRecord } from '../src/types/diary.js';
import type { IdempotencyStore } from '../src/platform/idempotency/idempotency-store.js';
import type { QueueClient } from '../src/platform/queue/queue-client.js';
import { createDiaryPublishedMessage } from '../src/async/diary/diary-published.message.js';

const classId = '11111111-1111-4111-8111-111111111111';
const classSubjectId = '22222222-2222-4222-8222-222222222222';
const subjectId = '33333333-3333-4333-8333-333333333333';
const diaryId = '44444444-4444-4444-8444-444444444444';
const key = 'diary-create-1';

function createDiaryService(): DiaryService {
  return {
    create: vi.fn(),
    listForStudent: vi.fn(),
    listForTeacher: vi.fn(),
    update: vi.fn(),
  };
}

function authenticateAs(role: 'student' | 'teacher') {
  return async (
    requestValue: Request,
    _response: Response,
    next: NextFunction,
  ): Promise<void> => {
    requestValue.auth = { role, schoolId: 'school-1', userId: `${role}-1` };
    next();
  };
}

function createTeacherDiary() {
  return {
    classId,
    classSubjectId,
    description: 'Added unlike fractions',
    id: diaryId,
    keyPoints: ['LCD'],
    occurredOn: '2026-07-13',
    periodLabel: '1st Period',
    teacherId: 'teacher-1',
    title: 'Fractions',
    updatedAt: '2026-07-13T10:00:00.000Z',
  };
}

function createCommittedDiary(): DiaryRecord {
  return { ...createTeacherDiary(), revision: 1, schoolId: 'school-1' };
}

function createRepository(overrides: Partial<DiaryRepository> = {}): DiaryRepository {
  return {
    create: vi.fn(),
    findStudentSubjectAccess: vi.fn(),
    findTeacherClassAccess: vi.fn(),
    findTeacherClassSubjectAccess: vi.fn(),
    findTeacherDiaryAccess: vi.fn(),
    listForStudent: vi.fn(),
    listForTeacher: vi.fn(),
    update: vi.fn(),
    ...overrides,
  };
}

describe('diary router', () => {
  it('creates a deterministic UUID publication event while retaining its readable source key', () => {
    const diary = createTeacherDiary();

    expect(createDiaryPublishedMessage({ ...diary, revision: 1, schoolId: 'school-1' })).toMatchObject({
      eventId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      payload: {
        sourceEventKey: 'diary:44444444-4444-4444-8444-444444444444:published:1',
      },
    });
    const firstPublication = createDiaryPublishedMessage({ ...diary, revision: 1, schoolId: 'school-1' });
    const secondPublication = createDiaryPublishedMessage({ ...diary, revision: 2, schoolId: 'school-1' });

    expect(firstPublication.eventId).toEqual(
      createDiaryPublishedMessage({ ...diary, revision: 1, schoolId: 'school-1' }).eventId,
    );
    expect(secondPublication.payload.sourceEventKey).toBe(
      'diary:44444444-4444-4444-8444-444444444444:published:2',
    );
    expect(secondPublication.eventId).not.toEqual(firstPublication.eventId);
  });

  it("rejects an oversized diary cursor before calling the service", async () => {
    const service = createDiaryService();
    const app = express();
    app.use(express.json());
    app.use("/student", createDiaryRouter(service, authenticateAs("student")));
    app.use(errorHandler);

    const response = await request(app)
      .get(`/student/subjects/${subjectId}/diary?cursor=${"a".repeat(513)}`);

    expect(response.status).toBe(400);
    expect(service.listForStudent).not.toHaveBeenCalled();
  });

  it("re-dispatches durable outbox work before replaying a completed create", async () => {
    const responseBody = createTeacherDiary();
    const idempotency = {
      claim: vi.fn().mockResolvedValue({
        response: { body: responseBody, status: 201 },
        state: "completed",
      }),
    } as unknown as IdempotencyStore;
    const outbox = { dispatchPending: vi.fn().mockResolvedValue(undefined) };
    const repository = createRepository({
      findTeacherClassSubjectAccess: vi.fn().mockResolvedValue({ schoolId: "school-1" }),
    });
    const queue = {} as QueueClient;
    const service = createDiaryApplicationService({ idempotency, outbox, queue, repository });

    await expect(service.create("teacher-1", classId, {
      classSubjectId,
      description: "Added unlike fractions",
      keyPoints: ["LCD"],
      occurredOn: "2026-07-13",
      periodLabel: "1st Period",
      title: "Fractions",
    }, key)).resolves.toEqual(responseBody);

    expect(outbox.dispatchPending).toHaveBeenCalledWith(queue);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("stores only the public diary response after a committed create", async () => {
    const committedDiary = createCommittedDiary();
    const idempotency = {
      claim: vi.fn().mockResolvedValue({ requestHash: "hash", state: "claimed" }),
      complete: vi.fn().mockResolvedValue(undefined),
    } as unknown as IdempotencyStore;
    const repository = createRepository({
      create: vi.fn().mockResolvedValue(committedDiary),
      findTeacherClassSubjectAccess: vi.fn().mockResolvedValue({ schoolId: "school-1" }),
    });
    const outbox = { dispatchPending: vi.fn().mockResolvedValue(undefined) };
    const queue = {} as QueueClient;
    const service = createDiaryApplicationService({ idempotency, outbox, queue, repository });

    await service.create("teacher-1", classId, {
      classSubjectId,
      description: "Added unlike fractions",
      keyPoints: ["LCD"],
      occurredOn: "2026-07-13",
      periodLabel: "1st Period",
      title: "Fractions",
    }, key);

    expect(idempotency.complete).not.toHaveBeenCalled();
    expect(repository.create).toHaveBeenCalledWith("teacher-1", classId, {
      classSubjectId,
      description: "Added unlike fractions",
      keyPoints: ["LCD"],
      occurredOn: "2026-07-13",
      periodLabel: "1st Period",
      title: "Fractions",
    }, {
      key,
      requestHash: "hash",
      status: 201,
      userId: "teacher-1",
    });
    expect(outbox.dispatchPending).toHaveBeenCalledWith(queue);
  });

  it('creates a diary using the authenticated teacher and idempotency key', async () => {
    const service = createDiaryService();
    vi.mocked(service.create).mockResolvedValue(createTeacherDiary());
    const app = express();
    app.use(express.json());
    app.use('/teacher', createDiaryRouter(service, authenticateAs('teacher')));
    app.use(errorHandler);

    const response = await request(app)
      .post(`/teacher/classes/${classId}/diary`)
      .set('Idempotency-Key', key)
      .send({
        classSubjectId,
        occurredOn: '2026-07-13',
        periodLabel: '1st Period',
        title: 'Fractions',
        description: 'Added unlike fractions',
        keyPoints: ['LCD'],
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(createTeacherDiary());
    expect(service.create).toHaveBeenCalledWith('teacher-1', classId, {
      classSubjectId,
      occurredOn: '2026-07-13',
      periodLabel: '1st Period',
      title: 'Fractions',
      description: 'Added unlike fractions',
      keyPoints: ['LCD'],
    }, key);
  });

  it('rejects a teacher diary create without an idempotency key', async () => {
    const service = createDiaryService();
    const app = express();
    app.use(express.json());
    app.use('/teacher', createDiaryRouter(service, authenticateAs('teacher')));
    app.use(errorHandler);

    const response = await request(app)
      .post(`/teacher/classes/${classId}/diary`)
      .send({
        classSubjectId,
        occurredOn: '2026-07-13',
        periodLabel: '1st Period',
        title: 'Fractions',
        description: 'Added unlike fractions',
        keyPoints: ['LCD'],
      });

    expect(response.status).toBe(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('rejects student diary access outside the active class', async () => {
    const service = createDiaryService();
    vi.mocked(service.listForStudent).mockRejectedValue(
      new AppError('FORBIDDEN', 403, 'You are not an active member of this subject class'),
    );
    const app = express();
    app.use('/student', createDiaryRouter(service, authenticateAs('student')));
    app.use(errorHandler);

    const response = await request(app).get(`/student/subjects/${subjectId}/diary`);

    expect(response.status).toBe(403);
    expect(service.listForStudent).toHaveBeenCalledWith('student-1', 'school-1', subjectId, {
      limit: 25,
    });
  });

  it('updates a teacher diary using the authenticated teacher and idempotency key', async () => {
    const service = createDiaryService();
    vi.mocked(service.update).mockResolvedValue({
      ...createTeacherDiary(),
      title: 'Equivalent Fractions',
      updatedAt: '2026-07-13T11:00:00.000Z',
    });
    const app = express();
    app.use(express.json());
    app.use('/teacher', createDiaryRouter(service, authenticateAs('teacher')));
    app.use(errorHandler);

    const response = await request(app)
      .patch(`/teacher/diary/${diaryId}`)
      .set('Idempotency-Key', 'diary-update-1')
      .send({ title: 'Equivalent Fractions' });

    expect(response.status).toBe(200);
    expect(response.body.title).toBe('Equivalent Fractions');
    expect(service.update).toHaveBeenCalledWith(
      'teacher-1',
      diaryId,
      { title: 'Equivalent Fractions' },
      'diary-update-1',
    );
  });

  it('rejects a teacher diary update without an idempotency key', async () => {
    const service = createDiaryService();
    const app = express();
    app.use(express.json());
    app.use('/teacher', createDiaryRouter(service, authenticateAs('teacher')));
    app.use(errorHandler);

    const response = await request(app)
      .patch(`/teacher/diary/${diaryId}`)
      .send({ title: 'Equivalent Fractions' });

    expect(response.status).toBe(400);
    expect(service.update).not.toHaveBeenCalled();
  });
});
