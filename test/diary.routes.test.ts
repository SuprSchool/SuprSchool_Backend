import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

import { createDiaryRouter } from '../src/routes/diary.routes.js';
import { AppError } from '../src/lib/errors.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { createDiaryService as createDiaryApplicationService } from '../src/services/diary.service.js';
import type { DiaryService } from '../src/services/diary.service.js';
import { DrizzleDiaryRepository } from '../src/db/repositories/diary.repository.js';
import type { DiaryRepository } from '../src/db/repositories/diary.repository.js';
import type { Database } from '../src/db/client.js';
import type { DiaryOutboxWriter } from '../src/async/diary/diary-outbox.js';
import type { DiaryEntryView, DiaryRecord } from '../src/types/diary.js';
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
    deleteEntry: vi.fn(),
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

/** What the service returns: the stored entry plus the freshly derived lock. */
function createDiaryView(overrides: Partial<DiaryEntryView> = {}): DiaryEntryView {
  return { ...createTeacherDiary(), occurrenceLocked: true, ...overrides };
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
    listUncoveredScheduledPeriods: vi.fn(),
    softDelete: vi.fn(),
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
    }, key)).resolves.toEqual({ ...responseBody, occurrenceLocked: true });

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
    vi.mocked(service.create).mockResolvedValue(createDiaryView());
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
    expect(response.body).toEqual(createDiaryView());
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
    vi.mocked(service.update).mockResolvedValue(createDiaryView({
      title: 'Equivalent Fractions',
      updatedAt: '2026-07-13T11:00:00.000Z',
    }));
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

  it('deletes a diary entry for the authenticated teacher and school', async () => {
    const service = createDiaryService();
    vi.mocked(service.deleteEntry).mockResolvedValue({
      deletedAt: '2026-08-10T00:00:00.000Z',
      id: diaryId,
    });
    const app = express();
    app.use(express.json());
    app.use('/teacher', createDiaryRouter(service, authenticateAs('teacher')));
    app.use(errorHandler);

    const response = await request(app).delete(`/teacher/diary/${diaryId}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ deletedAt: '2026-08-10T00:00:00.000Z', id: diaryId });
    expect(service.deleteEntry).toHaveBeenCalledWith(
      diaryId,
      { schoolId: 'school-1', teacherId: 'teacher-1' },
    );
  });

  it('reports another school diary entry as not found rather than forbidden', async () => {
    const service = createDiaryService();
    vi.mocked(service.deleteEntry).mockRejectedValue(
      new AppError('NOT_FOUND', 404, 'Diary entry not found'),
    );
    const app = express();
    app.use(express.json());
    app.use('/teacher', createDiaryRouter(service, authenticateAs('teacher')));
    app.use(errorHandler);

    const response = await request(app).delete(`/teacher/diary/${diaryId}`);

    expect(response.status).toBe(404);
  });

  it('refuses a diary delete from a student session', async () => {
    const service = createDiaryService();
    const app = express();
    app.use(express.json());
    app.use('/student', createDiaryRouter(service, authenticateAs('student')));
    app.use(errorHandler);

    const response = await request(app).delete(`/student/diary/${diaryId}`);

    expect(response.status).toBe(403);
    expect(service.deleteEntry).not.toHaveBeenCalled();
  });

  it('passes the authenticated school and requested window to the teacher diary list', async () => {
    const service = createDiaryService();
    vi.mocked(service.listForTeacher).mockResolvedValue({ items: [], nextCursor: null });
    const app = express();
    app.use('/teacher', createDiaryRouter(service, authenticateAs('teacher')));
    app.use(errorHandler);

    const response = await request(app)
      .get(`/teacher/classes/${classId}/diary?from=2026-08-07&to=2026-08-08`);

    expect(response.status).toBe(200);
    expect(service.listForTeacher).toHaveBeenCalledWith('teacher-1', 'school-1', classId, {
      from: '2026-08-07',
      limit: 25,
      to: '2026-08-08',
    });
  });

  it('rejects a diary window whose bounds are not both supplied', async () => {
    const service = createDiaryService();
    const app = express();
    app.use('/teacher', createDiaryRouter(service, authenticateAs('teacher')));
    app.use(errorHandler);

    const response = await request(app)
      .get(`/teacher/classes/${classId}/diary?from=2026-08-07`);

    expect(response.status).toBe(400);
    expect(service.listForTeacher).not.toHaveBeenCalled();
  });

  it('serves locked entries and not-added scheduled periods in one teacher list', async () => {
    const service = createDiaryService();
    vi.mocked(service.listForTeacher).mockResolvedValue({
      items: [
        { ...createTeacherDiary(), missing: false, occurrenceLocked: true },
        {
          classId,
          classSubjectId,
          missing: true,
          occurredOn: '2026-08-08',
          periodLabel: '2nd Period',
        },
      ],
      nextCursor: null,
    });
    const app = express();
    app.use('/teacher', createDiaryRouter(service, authenticateAs('teacher')));
    app.use(errorHandler);

    const response = await request(app)
      .get(`/teacher/classes/${classId}/diary?from=2026-08-07&to=2026-08-08`);

    expect(response.status).toBe(200);
    expect(response.body.items[0].occurrenceLocked).toBe(true);
    expect(response.body.items[0].missing).toBe(false);
    expect(response.body.items[1]).toEqual({
      classId,
      classSubjectId,
      missing: true,
      occurredOn: '2026-08-08',
      periodLabel: '2nd Period',
    });
  });
});

describe('diary repository', () => {
  /**
   * Drives the real `create` through a recording transaction. The unique
   * constraint on (class subject, date, period) is not partial, so re-adding a
   * deleted entry takes the conflict branch — what that branch writes is the
   * whole behaviour under test.
   */
  function createRecordingDatabase(capture: (conflict: { set: Record<string, unknown> }) => void) {
    const committedRow = {
      classId,
      classSubjectId,
      description: 'Added unlike fractions',
      id: diaryId,
      keyPoints: ['LCD'],
      occurredOn: '2026-07-13',
      periodLabel: '1st Period',
      revision: 2,
      schoolId: 'school-1',
      teacherId: 'teacher-1',
      title: 'Fractions',
      updatedAt: new Date('2026-07-13T10:00:00.000Z'),
    };
    const transaction = {
      execute: () => Promise.resolve([{ id: 'idempotency-1' }]),
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: (conflict: { set: Record<string, unknown> }) => {
            capture(conflict);
            return { returning: () => Promise.resolve([committedRow]) };
          },
        }),
      }),
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => ({ limit: () => Promise.resolve([{ schoolId: 'school-1' }]) }),
          }),
        }),
      }),
    };

    return {
      transaction: (work: (tx: unknown) => Promise<unknown>) => work(transaction),
    };
  }

  it('undeletes the row when a deleted day and period is written again', async () => {
    let conflict: { set: Record<string, unknown> } | undefined;
    const database = createRecordingDatabase((captured) => { conflict = captured; });
    const repository = new DrizzleDiaryRepository(
      database as unknown as Database,
      { writeInTransaction: vi.fn().mockResolvedValue(undefined) } as unknown as DiaryOutboxWriter,
    );

    await repository.create('teacher-1', classId, {
      classSubjectId,
      description: 'Added unlike fractions',
      keyPoints: ['LCD'],
      occurredOn: '2026-07-13',
      periodLabel: '1st Period',
      title: 'Fractions',
    }, { key, requestHash: 'hash', status: 201, userId: 'teacher-1' });

    expect(conflict).toBeDefined();
    // Without this the write lands on a row every read filters out: a 201 and a
    // push notification for an entry the teacher can never see again.
    expect(conflict?.set).toHaveProperty('deletedAt', null);
  });
});

describe('diary service', () => {
  const actor = { schoolId: 'school-1', teacherId: 'teacher-1' };

  function createService(repository: DiaryRepository): DiaryService {
    return createDiaryApplicationService({
      idempotency: { claim: vi.fn() } as unknown as IdempotencyStore,
      outbox: { dispatchPending: vi.fn().mockResolvedValue(undefined) },
      queue: {} as QueueClient,
      repository,
    });
  }

  it('scopes a diary delete to the acting teacher and school', async () => {
    const softDelete = vi.fn().mockResolvedValue({
      deletedAt: '2026-08-10T00:00:00.000Z',
      id: diaryId,
    });
    const service = createService(createRepository({ softDelete }));

    await expect(service.deleteEntry(diaryId, actor)).resolves.toEqual({
      deletedAt: '2026-08-10T00:00:00.000Z',
      id: diaryId,
    });
    expect(softDelete).toHaveBeenCalledWith(diaryId, actor);
  });

  it('reports a diary entry outside the acting school as not found', async () => {
    const service = createService(
      createRepository({ softDelete: vi.fn().mockResolvedValue(undefined) }),
    );

    await expect(service.deleteEntry(diaryId, actor)).rejects.toMatchObject({ status: 404 });
  });

  it('locks entries whose occurrence date has passed and merges uncovered periods', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T06:00:00.000Z'));
    try {
      const service = createService(createRepository({
        findTeacherClassAccess: vi.fn().mockResolvedValue({ schoolId: 'school-1' }),
        listForTeacher: vi.fn().mockResolvedValue({
          items: [
            { ...createTeacherDiary(), occurredOn: '2026-08-09' },
            { ...createTeacherDiary(), id: 'older', occurredOn: '2026-08-07' },
          ],
          nextCursor: null,
        }),
        listUncoveredScheduledPeriods: vi.fn().mockResolvedValue([
          { classId, classSubjectId, occurredOn: '2026-08-08', periodLabel: '2nd Period' },
        ]),
      }));

      const page = await service.listForTeacher('teacher-1', 'school-1', classId, {
        from: '2026-08-07',
        limit: 25,
        to: '2026-08-09',
      });

      expect(page.items.map((item) => [item.occurredOn, item.missing])).toEqual([
        ['2026-08-09', false],
        ['2026-08-08', true],
        ['2026-08-07', false],
      ]);
      expect(page.items[0]).toMatchObject({ occurrenceLocked: false });
      expect(page.items[2]).toMatchObject({ occurrenceLocked: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not invent uncovered periods when no window was requested', async () => {
    const listUncoveredScheduledPeriods = vi.fn();
    const service = createService(createRepository({
      findTeacherClassAccess: vi.fn().mockResolvedValue({ schoolId: 'school-1' }),
      listForTeacher: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      listUncoveredScheduledPeriods,
    }));

    await service.listForTeacher('teacher-1', 'school-1', classId, { limit: 25 });

    expect(listUncoveredScheduledPeriods).not.toHaveBeenCalled();
  });

  it('refuses to move a locked diary entry to another date or period', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T06:00:00.000Z'));
    try {
      const claim = vi.fn();
      const service = createDiaryApplicationService({
        idempotency: { claim } as unknown as IdempotencyStore,
        outbox: { dispatchPending: vi.fn().mockResolvedValue(undefined) },
        queue: {} as QueueClient,
        repository: createRepository({
          findTeacherDiaryAccess: vi.fn().mockResolvedValue({
            occurredOn: '2026-08-07',
            periodLabel: '1st Period',
            schoolId: 'school-1',
          }),
        }),
      });

      await expect(
        service.update('teacher-1', diaryId, { occurredOn: '2026-08-09' }, 'diary-update-2'),
      ).rejects.toMatchObject({ status: 409 });
      expect(claim).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts a locked entry whose date and period are echoed back unchanged', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T06:00:00.000Z'));
    try {
      const committedDiary = { ...createCommittedDiary(), occurredOn: '2026-08-07' };
      const update = vi.fn().mockResolvedValue(committedDiary);
      const service = createDiaryApplicationService({
        idempotency: {
          claim: vi.fn().mockResolvedValue({ requestHash: 'hash', state: 'claimed' }),
        } as unknown as IdempotencyStore,
        outbox: { dispatchPending: vi.fn().mockResolvedValue(undefined) },
        queue: {} as QueueClient,
        repository: createRepository({
          findTeacherDiaryAccess: vi.fn().mockResolvedValue({
            occurredOn: '2026-08-07',
            periodLabel: '1st Period',
            schoolId: 'school-1',
          }),
          update,
        }),
      });

      // What the edit form actually submits: every field, with the occurrence
      // fields carrying the values already stored. Refusing this would make
      // every past entry — the whole Past Entries tab — uneditable.
      await expect(service.update('teacher-1', diaryId, {
        description: 'Corrected the worked example',
        occurredOn: '2026-08-07',
        periodLabel: '1st Period',
        title: 'Fractions',
      }, 'diary-update-4')).resolves.toMatchObject({ occurrenceLocked: true });
      expect(update).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a locked entry whose period is moved even when the date is unchanged', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T06:00:00.000Z'));
    try {
      const update = vi.fn();
      const service = createDiaryApplicationService({
        idempotency: { claim: vi.fn() } as unknown as IdempotencyStore,
        outbox: { dispatchPending: vi.fn().mockResolvedValue(undefined) },
        queue: {} as QueueClient,
        repository: createRepository({
          findTeacherDiaryAccess: vi.fn().mockResolvedValue({
            occurredOn: '2026-08-07',
            periodLabel: '1st Period',
            schoolId: 'school-1',
          }),
          update,
        }),
      });

      await expect(service.update('teacher-1', diaryId, {
        occurredOn: '2026-08-07',
        periodLabel: '4th Period',
      }, 'diary-update-5')).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
      expect(update).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('still allows the narrative of a locked diary entry to be corrected', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T06:00:00.000Z'));
    try {
      const committedDiary = { ...createCommittedDiary(), occurredOn: '2026-08-07' };
      const service = createDiaryApplicationService({
        idempotency: {
          claim: vi.fn().mockResolvedValue({ requestHash: 'hash', state: 'claimed' }),
        } as unknown as IdempotencyStore,
        outbox: { dispatchPending: vi.fn().mockResolvedValue(undefined) },
        queue: {} as QueueClient,
        repository: createRepository({
          findTeacherDiaryAccess: vi.fn().mockResolvedValue({
            occurredOn: '2026-08-07',
            periodLabel: '1st Period',
            schoolId: 'school-1',
          }),
          update: vi.fn().mockResolvedValue(committedDiary),
        }),
      });

      await expect(
        service.update('teacher-1', diaryId, { title: 'Equivalent Fractions' }, 'diary-update-3'),
      ).resolves.toMatchObject({ occurrenceLocked: true });
    } finally {
      vi.useRealTimers();
    }
  });
});
