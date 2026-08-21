import { readFileSync } from 'node:fs';
import { drizzle, type RemoteCallback } from 'drizzle-orm/pg-proxy';
import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import type { Database } from '../src/db/client.js';
import type { AssignmentIdentity } from '../src/types/assignments.js';
import { DrizzleAssignmentsRepository, type AssignmentsRepository } from '../src/db/repositories/assignments.repository.js';
import type { AuthenticationMiddleware } from '../src/middleware/authenticate.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { createAssignmentsRouter } from '../src/routes/assignments.routes.js';
import {
  createAssignmentsService,
  type AcademicFilePort,
  type AcademicMutationPort,
  type AssignmentsService,
} from '../src/services/assignments.service.js';

const schoolId = '11111111-1111-4111-8111-111111111111';
const studentId = '22222222-2222-4222-8222-222222222222';
const attackerId = '33333333-3333-4333-8333-333333333333';
const teacherId = '44444444-4444-4444-8444-444444444444';
const uploadSessionId = '55555555-5555-4555-8555-555555555555';
const draftSubmissionId = '77777777-7777-4777-8777-777777777777';
const assignmentRouteId = '88888888-8888-4888-8888-888888888888';
const classRouteId = '99999999-9999-4999-8999-999999999999';
const assignmentResourceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const validAssignment = {
  subjectId: '66666666-6666-4666-8666-666666666666',
  title: 'Algebra practice',
  instructions: 'Complete questions 1 through 10.',
  dueAt: '2026-07-20T12:00:00.000Z',
  isGradedAssignment: true,
  gradingType: 'Numeric',
  maxMarks: 10,
  rubrics: [{ position: 1, topic: 'Solutions', marks: 10 }],
};

/** The same fixture with no `rubrics` key at all — a "no breakdown" body. */
const assignmentWithoutRubrics: Omit<typeof validAssignment, 'rubrics'> = (() => {
  const copy: Record<string, unknown> = { ...validAssignment };
  delete copy.rubrics;
  return copy as Omit<typeof validAssignment, 'rubrics'>;
})();

function createService(): AssignmentsService {
  return {
    bulkSetCompletion: vi.fn(),
    confirmResource: vi.fn(),
    confirmSubmission: vi.fn(),
    create: vi.fn(),
    createResourceUploadSession: vi.fn(),
    createSubmissionUploadSession: vi.fn(),
    delete: vi.fn(),
    deleteResource: vi.fn(),
    getForStudent: vi.fn(),
    getForTeacher: vi.fn(),
    grade: vi.fn(),
    listForStudent: vi.fn(),
    listForTeacher: vi.fn(),
    listSubmissions: vi.fn(),
    remindAll: vi.fn(),
    remindStudent: vi.fn(),
    setCompletion: vi.fn(),
    setStudentCompletion: vi.fn(),
    submitWithoutFile: vi.fn(),
    update: vi.fn(),
  };
}

function createAuthenticatedRequest(
  identity: { role: 'student' | 'teacher'; userId: string },
): AuthenticationMiddleware {
  return async (requestValue: Request, _response: Response, next): Promise<void> => {
    requestValue.auth = { schoolId, ...identity };
    next();
  };
}

function createTestApp(
  service: AssignmentsService,
  identity: { role: 'student' | 'teacher'; userId: string },
) {
  const app = express();
  app.use(express.json());
  app.use('/', createAssignmentsRouter(service, createAuthenticatedRequest(identity)));
  app.use(errorHandler);
  return app;
}

describe('assignments router', () => {
  it('uses token student for confirmation and ignores body studentId', async () => {
    const service = createService();
    const studentApp = createTestApp(service, { role: 'student', userId: studentId });

    await request(studentApp).post('/student/assignments/' + assignmentRouteId + '/submission/confirm')
      .set('Idempotency-Key', 'submission-confirm-1')
      .send({ uploadSessionId, studentId: attackerId }).expect(201);

    expect(service.confirmSubmission).toHaveBeenCalledWith(
      { schoolId, userId: studentId }, assignmentRouteId, uploadSessionId, 'submission-confirm-1',
    );
  });

  it('forbids student grading', async () => {
    const service = createService();
    const studentApp = createTestApp(service, { role: 'student', userId: studentId });

    await request(studentApp).put('/teacher/submissions/s1/grade')
      .set('Idempotency-Key', 'forbidden-grade-1').send({ marks: 8 }).expect(403);

    expect(service.grade).not.toHaveBeenCalled();
  });

  it('passes path class and token teacher to create', async () => {
    const service = createService();
    const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });

    await request(teacherApp).post('/teacher/classes/' + classRouteId + '/assignments')
      .set('Idempotency-Key', 'assignment-create-1').send(validAssignment).expect(201);

    expect(service.create).toHaveBeenCalledWith(
      { schoolId, userId: teacherId }, classRouteId, validAssignment, 'assignment-create-1',
    );
  });

  it('accepts an assignment created without any rubric breakdown', async () => {
    const service = createService();
    const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });

    await request(teacherApp).post('/teacher/classes/' + classRouteId + '/assignments')
      .set('Idempotency-Key', 'assignment-create-no-rubrics')
      .send(assignmentWithoutRubrics).expect(201);

    expect(service.create).toHaveBeenCalledWith(
      { schoolId, userId: teacherId }, classRouteId, assignmentWithoutRubrics, 'assignment-create-no-rubrics',
    );
    // Absent must reach the service as absent, so the repository can tell it
    // apart from an explicit `[]`.
    expect(vi.mocked(service.create).mock.calls[0]?.[2]).not.toHaveProperty('rubrics');
  });

  it('accepts an alphabetic assignment created without any rubric breakdown', async () => {
    const service = createService();
    const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });

    await request(teacherApp).post('/teacher/classes/' + classRouteId + '/assignments')
      .set('Idempotency-Key', 'assignment-create-alphabetic-no-rubrics')
      .send({
        dueAt: validAssignment.dueAt,
        gradingType: 'Alphabetic',
        instructions: validAssignment.instructions,
        isGradedAssignment: true,
        subjectId: validAssignment.subjectId,
        title: validAssignment.title,
      }).expect(201);

    expect(service.create).toHaveBeenCalled();
  });

  it('still rejects a rubric breakdown whose marks do not total maxMarks', async () => {
    const service = createService();
    const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });

    await request(teacherApp).post('/teacher/classes/' + classRouteId + '/assignments')
      .set('Idempotency-Key', 'assignment-create-bad-total')
      .send({ ...validAssignment, rubrics: [{ position: 1, topic: 'Solutions', marks: 3 }] })
      .expect(400);

    expect(service.create).not.toHaveBeenCalled();
  });

  it('hydrates a teacher assignment detail through the authenticated tenant identity', async () => {
    const service = createService();
    vi.mocked(service.getForTeacher).mockResolvedValue({ id: assignmentRouteId } as never);
    const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });

    await request(teacherApp).get('/teacher/assignments/' + assignmentRouteId).expect(200);

    expect(service.getForTeacher).toHaveBeenCalledWith(
      { schoolId, userId: teacherId }, assignmentRouteId,
    );
  });
  it('rejects malformed assignment resource IDs before a database-backed service can receive them', async () => {
    const service = createService();
    const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });

    await request(teacherApp).post('/teacher/assignments/not-a-uuid/resources/upload-sessions')
      .set('Idempotency-Key', 'invalid-resource-parent')
      .send({ contentType: 'application/pdf', displayName: 'worksheet.pdf', sizeBytes: 256 })
      .expect(400);

    expect(service.createResourceUploadSession).not.toHaveBeenCalled();
  });

  it('forwards immutable metadata and independent keys for resource and submission upload sessions', async () => {
    const service = createService();
    const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });
    const studentApp = createTestApp(service, { role: 'student', userId: studentId });
    const metadata = { contentType: 'application/pdf', displayName: 'worksheet.pdf', sizeBytes: 256 };

    await request(teacherApp).post(`/teacher/assignments/${assignmentRouteId}/resources/upload-sessions`)
      .set('Idempotency-Key', 'assignment-resource-create')
      .send(metadata)
      .expect(201);
    await request(teacherApp).post(`/teacher/assignments/${assignmentRouteId}/resources/confirm`)
      .set('Idempotency-Key', 'assignment-resource-confirm')
      .send({ uploadSessionId })
      .expect(201);
    await request(studentApp).post(`/student/assignments/${assignmentRouteId}/submission/upload-sessions`)
      .set('Idempotency-Key', 'assignment-submission-create')
      .send(metadata)
      .expect(201);

    // A body that never mentions a role still produces an ordinary resource:
    // the validator defaults it, so the banner slot is opt-in and no existing
    // caller changes behaviour.
    expect(service.createResourceUploadSession).toHaveBeenCalledWith(
      { schoolId, userId: teacherId }, assignmentRouteId,
      { ...metadata, role: 'resource' }, 'assignment-resource-create',
    );
    expect(service.confirmResource).toHaveBeenCalledWith(
      { schoolId, userId: teacherId }, assignmentRouteId, uploadSessionId,
      'assignment-resource-confirm', 'resource',
    );
    expect(service.createSubmissionUploadSession).toHaveBeenCalledWith(
      { schoolId, userId: studentId }, assignmentRouteId, metadata, 'assignment-submission-create',
    );
  });

  it('deletes a confirmed assignment resource through the authenticated parent scope', async () => {
    const service = createService();
    const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });

    await request(teacherApp).delete(
      `/teacher/assignments/${assignmentRouteId}/resources/${assignmentResourceId}`,
    ).set('Idempotency-Key', 'assignment-resource-delete-1').expect(204);

    expect(service.deleteResource).toHaveBeenCalledWith(
      { schoolId, userId: teacherId }, assignmentRouteId, assignmentResourceId,
      'assignment-resource-delete-1',
    );
  });

});

function passthroughMutations(): AcademicMutationPort {
  return {
    async execute<T>(
      _identity: AssignmentIdentity,
      input: {
        idempotencyKey: string;
        requestBody: unknown;
        successStatus: number;
        work: () => Promise<T>;
      },
    ) {
      return {
        body: await input.work(),
        replayed: false,
        status: input.successStatus,
      };
    },
  };
}

function databaseWithTransaction(callback: RemoteCallback): Database {
  const database = drizzle(callback) as unknown as Database;
  Object.assign(database, {
    transaction: async <T>(work: (transaction: Database) => Promise<T>): Promise<T> => work(database),
  });
  return database;
}

describe('assignment review regressions', () => {
  it('returns the authoritative subject name with each student assignment list item', async () => {
    const callback: RemoteCallback = async () => ({
      rows: [[
        new Date('2026-07-01T08:00:00.000Z'), // assignedAt (assignments.created_at)
        null, // completedAt
        new Date('2026-07-20T12:00:00.000Z'), // dueAt
        null, // gradedAt
        'Numeric', // gradingType
        assignmentRouteId, // id
        true, // isGraded
        null, // letterGrade
        null, // marks
        schoolId,
        validAssignment.subjectId,
        'Mathematics', // subjectName
        null, // submittedAt
        validAssignment.title,
      ]],
    });
    const repository = new DrizzleAssignmentsRepository(
      drizzle(callback) as unknown as Database,
    );

    const page = await repository.listForStudent(
      { schoolId, userId: studentId },
      { limit: 20 },
      new Date('2026-07-01T00:00:00.000Z'),
    );

    expect(page.items[0]).toMatchObject({ subjectName: 'Mathematics' });
  });

  it('authorizes a persisted submission only for its active student owner', async () => {
    const queries: string[] = [];
    const callback: RemoteCallback = async (query) => {
      queries.push(query);
      return { rows: [{ id: draftSubmissionId }] };
    };
    const repository = new DrizzleAssignmentsRepository(
      drizzle(callback) as unknown as Database,
    );

    await expect(repository.canAccessSubmission(
      { schoolId, userId: studentId },
      draftSubmissionId,
    )).resolves.toBe(true);

    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('assignment_submissions');
    expect(queries[0]).toContain('class_members');
    expect(queries[0]).toContain('is_active');
    expect(queries[0]).toContain('deleted_at');
  });
  it('treats malformed opaque cursors as a client validation error', async () => {
    const service = createService();
    const studentApp = createTestApp(service, { role: 'student', userId: studentId });

    await request(studentApp).get('/student/assignments?cursor=not-a-cursor').expect(400);

    expect(service.listForStudent).not.toHaveBeenCalled();
  });

  it('rejects UUID-shaped assignment inputs and decoded cursor IDs before the service is called', async () => {
    const service = createService();
    const studentApp = createTestApp(service, { role: 'student', userId: studentId });
    const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });
    const malformedCursor = Buffer.from(JSON.stringify({
      dueAt: '2026-07-20T12:00:00.000Z', id: 'not-a-uuid', v: 1,
    })).toString('base64url');

    await request(studentApp).get('/student/assignments?cursor=' + malformedCursor).expect(400);
    await request(teacherApp).post('/teacher/classes/not-a-uuid/assignments')
      .set('Idempotency-Key', 'invalid-assignment-class')
      .send(validAssignment).expect(400);
    await request(teacherApp).post('/teacher/classes/' + classRouteId + '/assignments')
      .set('Idempotency-Key', 'invalid-assignment-subject')
      .send({ ...validAssignment, subjectId: 'not-a-uuid' }).expect(400);
    await request(teacherApp).put('/teacher/submissions/not-a-uuid/grade')
      .set('Idempotency-Key', 'invalid-submission')
      .send({ marks: 8 }).expect(400);
    await request(teacherApp).post('/teacher/assignments/' + assignmentRouteId + '/reminder/student/not-a-uuid')
      .set('Idempotency-Key', 'invalid-student')
      .send({}).expect(400);

    expect(service.listForStudent).not.toHaveBeenCalled();
    expect(service.create).not.toHaveBeenCalled();
    expect(service.grade).not.toHaveBeenCalled();
    expect(service.remindStudent).not.toHaveBeenCalled();
  });
  it('creates a submission session under its persisted draft ID', async () => {
    const identity = { schoolId, userId: studentId };
    const createUpload = vi.fn().mockResolvedValue({
      expiresAt: '2026-07-14T00:00:00.000Z',
      id: uploadSessionId,
      objectPath: 'submission-object-path',
      signedUploadUrl: 'https://upload.example/submission',
    });
    const upsertSubmissionDraft = vi.fn().mockResolvedValue({
      assignmentId: 'a1',
      id: draftSubmissionId,
    });
    const service = createAssignmentsService({
      cache: { invalidateStudentAssignments: vi.fn() },
      files: { createUpload } as unknown as AcademicFilePort,
      mutations: passthroughMutations(),
      outbox: { write: vi.fn(), writeInTransaction: vi.fn() },
      repository: { upsertSubmissionDraft } as unknown as AssignmentsRepository,
    });

    await service.createSubmissionUploadSession(identity, 'a1', {
      contentType: 'application/pdf',
      displayName: 'homework.pdf',
      sizeBytes: 256,
    }, 'submission-create-parent-1');

    expect(createUpload).toHaveBeenCalledWith(identity, {
      bucket: 'academic-files',
      contentType: 'application/pdf',
      displayName: 'homework.pdf',
      parentId: draftSubmissionId,
      parentType: 'assignment-submission',
      sizeBytes: 256,
    });
  });

  it('binds submission confirmation to its persisted draft before linking it', async () => {
    const identity = { schoolId, userId: studentId };
    const prepareUpload = vi.fn().mockResolvedValue({
      contentType: 'application/pdf',
      displayName: 'homework.pdf',
      id: uploadSessionId,
      objectPath: 'assigned-object-path',
    });
    const finalizeUpload = vi.fn();
    const confirmSubmission = vi.fn().mockResolvedValue({
      kind: 'attached',
      submission: { assignmentId: 'a1', id: draftSubmissionId, studentId },
    });
    const upsertSubmissionDraft = vi.fn().mockResolvedValue({
      assignmentId: 'a1',
      id: draftSubmissionId,
    });
    const service = createAssignmentsService({
      cache: { invalidateStudentAssignments: vi.fn() },
      files: { finalizeUpload, prepareUpload } as unknown as AcademicFilePort,
      mutations: passthroughMutations(),
      outbox: { write: vi.fn(), writeInTransaction: vi.fn() },
      repository: {
        confirmSubmission,
        upsertSubmissionDraft,
        withTransaction: async (
          work: (repository: AssignmentsRepository, transaction: Database) => Promise<unknown>,
        ) => work(
          { confirmSubmission, upsertSubmissionDraft } as unknown as AssignmentsRepository,
          {} as Database,
        ),
      } as unknown as AssignmentsRepository,
    });

    await service.confirmSubmission(identity, 'a1', uploadSessionId, 'bound-parent-confirm-1');

    expect(upsertSubmissionDraft).toHaveBeenCalledWith(identity, 'a1');
    expect(prepareUpload).toHaveBeenCalledWith(identity, {
      parentId: draftSubmissionId,
      parentType: 'assignment-submission',
      uploadSessionId,
    });
    expect(confirmSubmission).toHaveBeenCalledTimes(1);
    expect(finalizeUpload).toHaveBeenCalledWith(identity, uploadSessionId);
  });

  it('rolls back submission confirmation when its transactional outbox write fails', async () => {
    const identity = { schoolId, userId: studentId };
    let submitted = false;
    const finalizeUpload = vi.fn();
    const transactionRepository = {
      confirmSubmission: vi.fn().mockImplementation(async () => {
        submitted = true;
        return { kind: 'attached', submission: { assignmentId: 'a1', id: draftSubmissionId, studentId } };
      }),
      upsertSubmissionDraft: vi.fn().mockResolvedValue({
        assignmentId: 'a1',
        id: draftSubmissionId,
      }),
    };
    const withTransaction = vi.fn(async (
      work: (repository: typeof transactionRepository, transaction: Database) => Promise<unknown>,
    ) => {
      const previous = submitted;
      try {
        return await work(transactionRepository, {} as Database);
      } catch (error) {
        submitted = previous;
        throw error;
      }
    });
    const service = createAssignmentsService({
      cache: { invalidateStudentAssignments: vi.fn() },
      files: {
        finalizeUpload,
        prepareUpload: vi.fn().mockResolvedValue({
          contentType: 'application/pdf',
          displayName: 'homework.pdf',
          id: uploadSessionId,
          objectPath: 'assigned-object-path',
        }),
      } as unknown as AcademicFilePort,
      mutations: passthroughMutations(),
      outbox: {
        write: vi.fn(),
        writeInTransaction: vi.fn().mockRejectedValue(new Error('outbox unavailable')),
      },
      repository: {
        ...transactionRepository,
        withTransaction,
      } as unknown as AssignmentsRepository,
    });

    await expect(service.confirmSubmission(identity, 'a1', uploadSessionId, 'outbox-rollback-1'))
      .rejects.toThrow('outbox unavailable');

    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(submitted).toBe(false);
    expect(finalizeUpload).not.toHaveBeenCalled();
  });

  it("retries finalization for the same attached upload without another outbox event and rejects a different upload", async () => {
    const identity = { schoolId, userId: studentId };
    const original = { id: draftSubmissionId, studentId };
    const confirmSubmission = vi.fn()
      .mockResolvedValueOnce({ kind: "attached", submission: original })
      .mockResolvedValueOnce({ kind: "already_attached", submission: original })
      .mockResolvedValueOnce({ kind: "conflict" });
    const prepareUpload = vi.fn().mockImplementation(async (_identity, input) => ({
      contentType: "application/pdf", displayName: "homework.pdf", id: input.uploadSessionId,
      objectPath: `object/${input.uploadSessionId}`,
    }));
    const finalizeUpload = vi.fn().mockRejectedValueOnce(new Error("finalize unavailable"))
      .mockResolvedValue(undefined);
    const outbox = { write: vi.fn(), writeInTransaction: vi.fn() };
    const transactionRepository = {
      confirmSubmission,
      upsertSubmissionDraft: vi.fn().mockResolvedValue({ assignmentId: "a1", id: draftSubmissionId }),
    };
    const service = createAssignmentsService({
      cache: { invalidateStudentAssignments: vi.fn() },
      files: { finalizeUpload, prepareUpload } as unknown as AcademicFilePort,
      mutations: passthroughMutations(),
      outbox,
      repository: {
        ...transactionRepository,
        withTransaction: async <T>(
          work: (repository: AssignmentsRepository, transaction: Database) => Promise<T>,
        ): Promise<T> => work(transactionRepository as unknown as AssignmentsRepository, {} as Database),
      } as unknown as AssignmentsRepository,
    });

    await expect(service.confirmSubmission(identity, "a1", uploadSessionId, "retry-same"))
      .rejects.toThrow("finalize unavailable");
    await expect(service.confirmSubmission(identity, "a1", uploadSessionId, "retry-same"))
      .resolves.toEqual(original);
    await expect(service.confirmSubmission(identity, "a1", "different-upload", "retry-different"))
      .rejects.toMatchObject({ status: 409 });

    expect(outbox.writeInTransaction).toHaveBeenCalledTimes(1);
    expect(finalizeUpload).toHaveBeenCalledTimes(2);
  });


  it('retains the assignment resource row and retries Storage deletion after a transient failure', async () => {
    const resource = {
      id: assignmentResourceId,
      name: 'banner.png',
      objectPath: 'assignments/banner.png',
    };
    let storedResource: typeof resource | undefined = resource;
    const deleteObject = vi.fn()
      .mockRejectedValueOnce(new Error('Storage unavailable'))
      .mockResolvedValueOnce(undefined);
    const findResourceForDeletion = vi.fn(async () => storedResource);
    const deleteResource = vi.fn(async () => {
      const deleted = storedResource;
      storedResource = undefined;
      return deleted;
    });
    const invalidateStudentAssignments = vi.fn();
    const service = createAssignmentsService({
      cache: { invalidateStudentAssignments },
      files: { deleteObject } as unknown as AcademicFilePort,
      mutations: passthroughMutations(),
      outbox: { write: vi.fn(), writeInTransaction: vi.fn() },
      repository: {
        canManage: vi.fn().mockResolvedValue(true),
        deleteResource,
        findResourceForDeletion,
        listStudentIdsForAssignment: vi.fn().mockResolvedValue([studentId]),
      } as unknown as AssignmentsRepository,
    });

    await expect(service.deleteResource(
      { schoolId, userId: teacherId }, assignmentRouteId, assignmentResourceId,
      'assignment-resource-delete-storage-1',
    )).rejects.toThrow('Storage unavailable');

    expect(storedResource).toEqual(resource);
    expect(deleteResource).not.toHaveBeenCalled();
    expect(invalidateStudentAssignments).not.toHaveBeenCalled();

    await service.deleteResource(
      { schoolId, userId: teacherId }, assignmentRouteId, assignmentResourceId,
      'assignment-resource-delete-storage-1',
    );

    expect(findResourceForDeletion).toHaveBeenCalledTimes(2);
    expect(deleteResource).toHaveBeenCalledWith(
      { schoolId, userId: teacherId }, assignmentRouteId, assignmentResourceId,
    );
    expect(deleteObject).toHaveBeenCalledTimes(2);
    expect(storedResource).toBeUndefined();
    expect(invalidateStudentAssignments).toHaveBeenCalledWith({
      assignmentId: assignmentRouteId, schoolId, studentId,
    });
  });

  it('uses the assignment resource parent type and assignment ID for create and confirmation', async () => {
    const identity = { schoolId, userId: teacherId };
    const createUpload = vi.fn().mockResolvedValue({
      expiresAt: '2026-07-14T00:00:00.000Z',
      id: uploadSessionId,
      objectPath: 'resource-object-path',
      signedUploadUrl: 'https://upload.example/resource',
    });
    const prepareUpload = vi.fn().mockResolvedValue({
      contentType: 'application/pdf',
      displayName: 'worksheet.pdf',
      id: uploadSessionId,
      objectPath: 'resource-object-path',
    });
    const canManage = vi.fn().mockResolvedValue(true);
    const insertResource = vi.fn().mockResolvedValue({
      id: 'r1',
      name: 'worksheet.pdf',
      objectPath: 'resource-object-path',
    });
    const service = createAssignmentsService({
      cache: { invalidateStudentAssignments: vi.fn() },
      files: {
        finalizeUpload: vi.fn(),
        prepareUpload,
        createReadUrl: vi.fn().mockResolvedValue('https://read.example/resource'),
        createUpload,
      } as unknown as AcademicFilePort,
      mutations: passthroughMutations(),
      outbox: { write: vi.fn(), writeInTransaction: vi.fn() },
      repository: { canManage, insertResource } as unknown as AssignmentsRepository,
    });

    await service.createResourceUploadSession(identity, 'a1', {
      contentType: 'application/pdf',
      displayName: 'worksheet.pdf',
      role: 'resource',
      sizeBytes: 512,
    }, 'resource-create-parent-1');
    await service.confirmResource(identity, 'a1', uploadSessionId, 'resource-confirm-parent-1');

    expect(createUpload).toHaveBeenCalledWith(identity, {
      bucket: 'academic-files',
      contentType: 'application/pdf',
      displayName: 'worksheet.pdf',
      parentId: 'a1',
      parentType: 'assignment-resource',
      sizeBytes: 512,
    });
    expect(prepareUpload).toHaveBeenCalledWith(identity, {
      parentId: 'a1',
      parentType: 'assignment-resource',
      uploadSessionId,
    });
  });

  it('requires a live class-subject assignment inside the create mutation', async () => {
    const queries: string[] = [];
    const callback: RemoteCallback = async (query) => {
      queries.push(query);
      return { rows: [] };
    };
    const repository = new DrizzleAssignmentsRepository(
      databaseWithTransaction(callback),
    );

    await repository.create(
      { schoolId, userId: teacherId },
      'c1',
      validAssignment as Parameters<AssignmentsRepository['create']>[2],
    );

    expect(queries.some((query) => query.includes('insert into') && query.includes('class_subjects'))).toBe(true);
  });

  it('binds an ISO timestamp, not a Date object, when creating an assignment', async () => {
    const parameters: unknown[][] = [];
    const callback: RemoteCallback = async (_query, params) => {
      parameters.push(params);
      return { rows: [] };
    };
    const repository = new DrizzleAssignmentsRepository(
      databaseWithTransaction(callback),
    );

    await repository.create(
      { schoolId, userId: teacherId },
      'c1',
      validAssignment as Parameters<AssignmentsRepository['create']>[2],
    );

    expect(parameters.flat().some((value) => value instanceof Date)).toBe(false);
  });

  it('requires a live class-subject assignment inside the resource insert mutation', async () => {
    const queries: string[] = [];
    const callback: RemoteCallback = async (query) => {
      queries.push(query);
      return { rows: [] };
    };
    const repository = new DrizzleAssignmentsRepository(
      databaseWithTransaction(callback),
    );

    await repository.insertResource({
      assignmentId: 'a1',
      displayName: 'worksheet.pdf',
      identity: { schoolId, userId: teacherId },
      objectPath: 'resource-object-path',
      role: 'resource',
      uploadSessionId,
    });

    expect(queries.some((query) => query.includes('insert into') && query.includes('class_subjects'))).toBe(true);
  });

  // The submission list is now roster-driven, so the class_subjects guard moved
  // out of the listing query and into the ownership probe that gates it — the
  // roster query itself selects from class_members. The invariant is unchanged
  // and is asserted where it now lives, in both halves.
  it('gates the teacher submission-list on a current class-subject before reading the roster', async () => {
    const queries: string[] = [];
    let queryCount = 0;
    const callback: RemoteCallback = async (query) => {
      queries.push(query);
      queryCount += 1;
      return { rows: queryCount === 1 ? [{ id: 'a1' }] : [] };
    };
    const repository = new DrizzleAssignmentsRepository(
      databaseWithTransaction(callback),
    );

    await repository.listSubmissions(
      { schoolId, userId: teacherId },
      'a1',
      { limit: 20 },
    );

    expect(queries).toHaveLength(2);
    const [authorization, roster] = queries as [string, string];
    expect(authorization).toContain('class_subjects');
    expect(authorization).toContain('"teacher_id"');
    expect(authorization).toContain('"deleted_at" is null');
    expect(roster).toContain('class_members');
    expect(roster).toContain('assignment_submissions');
    expect(roster).toContain('"school_id"');
  });

  it('never reads the roster when the ownership probe finds no managed assignment', async () => {
    const queries: string[] = [];
    const callback: RemoteCallback = async (query) => {
      queries.push(query);
      return { rows: [] };
    };
    const repository = new DrizzleAssignmentsRepository(
      databaseWithTransaction(callback),
    );

    const page = await repository.listSubmissions(
      { schoolId, userId: teacherId },
      'a1',
      { limit: 20 },
    );

    expect(page).toBeUndefined();
    expect(queries).toHaveLength(1);
    expect(queries[0]).not.toContain('class_members');
  });

  // 667:3274 draws "Remind All Non-Submitted (3)" and 543:13354 a "Not Graded"
  // group; both need students who have NO submission row, which only a LEFT JOIN
  // out of the roster can produce.
  it('left-joins submissions onto the roster so non-submitters are listed', async () => {
    const queries: string[] = [];
    let queryCount = 0;
    const callback: RemoteCallback = async (query) => {
      queries.push(query);
      queryCount += 1;
      return { rows: queryCount === 1 ? [{ id: 'a1' }] : [] };
    };
    const repository = new DrizzleAssignmentsRepository(
      databaseWithTransaction(callback),
    );

    await repository.listSubmissions(
      { schoolId, userId: teacherId },
      'a1',
      { limit: 20 },
    );

    const roster = queries[1] ?? '';
    expect(roster).toContain('from "class_members"');
    expect(roster).toContain('left join "assignment_submissions"');
    expect(roster).toContain('"is_active"');
    // A roster row with no submission still needs a stable key.
    expect(roster).toContain('coalesce');
  });

  it('requires a current teacher assignment inside the grade mutation predicate', async () => {
    let updateQuery = '';
    const callback: RemoteCallback = async (sql) => {
      updateQuery = sql;
      return { rows: [] };
    };
    const repository = new DrizzleAssignmentsRepository(
      databaseWithTransaction(callback),
    );

    await repository.grade(
      { schoolId, userId: teacherId },
      's1',
      { marks: 8 },
      new Date('2026-07-13T00:00:00.000Z'),
    );

    expect(updateQuery).toContain('class_subjects');
    expect(updateQuery).toContain('assignments');
  });
});

describe('assignment app mount', () => {
  it('mounts the authenticated assignment router at /v1', async () => {
    const service = createService();
    vi.mocked(service.listForStudent).mockResolvedValue({ items: [], nextCursor: undefined });

    await request(createApp({
      assignmentService: service,
      authenticate: createAuthenticatedRequest({ role: 'student', userId: studentId }),
    })).get('/v1/student/assignments').expect(200);
  });
});


describe("submission final enrollment authorization", () => {
  it("keeps current enrollment and a live assignment parent inside draft and attachment writes", () => {
    const source = readFileSync(
      new URL("../src/db/repositories/assignments.repository.ts", import.meta.url),
      "utf8",
    );
    const draftMethod = source.slice(source.indexOf("public async upsertSubmissionDraft"), source.indexOf("public async confirmSubmission"));
    const confirmMethod = source.slice(source.indexOf("public async confirmSubmission"), source.indexOf("public async listSubmissions"));

    expect(draftMethod).toContain("insert into public.assignment_submissions");
    expect(draftMethod).toContain("join public.class_members member");
    expect(draftMethod).toContain("assignment.deleted_at is null");
    expect(confirmMethod).toContain("update public.assignment_submissions");
    expect(confirmMethod).toContain("from public.assignments assignment");
    expect(confirmMethod).toContain("join public.class_members member");
    expect(confirmMethod).toContain("assignment.deleted_at is null");
  });

  it("does not create an upload or attach a submission after enrollment is revoked", async () => {
    const identity = { schoolId, userId: studentId };
    const createUpload = vi.fn();
    const finalAttachment = vi.fn().mockResolvedValue(undefined);
    const finalizeUpload = vi.fn();
    const outbox = { write: vi.fn(), writeInTransaction: vi.fn() };
    const transactionRepository = {
      confirmSubmission: finalAttachment,
      upsertSubmissionDraft: vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce({
        assignmentId: "a1", id: draftSubmissionId,
      }),
    };
    const service = createAssignmentsService({
      cache: { invalidateStudentAssignments: vi.fn() },
      files: {
        createUpload,
        finalizeUpload,
        prepareUpload: vi.fn().mockResolvedValue({
          contentType: "application/pdf", displayName: "homework.pdf", id: uploadSessionId,
          objectPath: "submission-object-path",
        }),
      } as unknown as AcademicFilePort,
      mutations: passthroughMutations(),
      outbox,
      repository: {
        ...transactionRepository,
        withTransaction: async <T>(
          work: (repository: AssignmentsRepository, transaction: Database) => Promise<T>,
        ): Promise<T> => work(transactionRepository as unknown as AssignmentsRepository, {} as Database),
      } as unknown as AssignmentsRepository,
    });

    await expect(service.createSubmissionUploadSession(identity, "a1", {
      contentType: "application/pdf", displayName: "homework.pdf", sizeBytes: 256,
    }, "revoked-draft")).rejects.toMatchObject({ status: 404 });
    await expect(service.confirmSubmission(identity, "a1", uploadSessionId, "revoked-confirm"))
      .rejects.toMatchObject({ status: 404 });

    expect(createUpload).not.toHaveBeenCalled();
    expect(finalAttachment).toHaveBeenCalledTimes(1);
    expect(outbox.writeInTransaction).not.toHaveBeenCalled();
    expect(finalizeUpload).not.toHaveBeenCalled();
  });
});


describe("submission draft concurrency", () => {
  it("returns an authorized draft committed by a concurrent transaction instead of a false missing result", async () => {
    let statement = "";
    const concurrentDraft = { assignmentId: assignmentRouteId, id: draftSubmissionId };
    const callback: RemoteCallback = async (query) => {
      statement = query;
      return query.includes("on conflict (assignment_id, student_id) do update")
        ? { rows: [concurrentDraft] }
        : { rows: [] };
    };
    const repository = new DrizzleAssignmentsRepository(drizzle(callback) as unknown as Database);

    await expect(repository.upsertSubmissionDraft(
      { schoolId, userId: studentId }, assignmentRouteId,
    )).resolves.toEqual(concurrentDraft);

    expect(statement).toContain("on conflict (assignment_id, student_id) do update");
    expect(statement).toContain("assignment_submissions.assignment_id");
    expect(statement).toContain("member.is_active");
    expect(statement).toContain("assignment.deleted_at is null");
    expect(statement).not.toContain("upload_session_id =");
  });
});

describe('assignment display codes and due timestamps', () => {
  const displayCodePrefix = `ASG-${new Date().getUTCFullYear()}-`;

  it('returns the human-readable display code on the created-assignment response', async () => {
    const service = createService();
    vi.mocked(service.create).mockResolvedValue({
      assignedAt: '2026-07-01T08:00:00.000Z',
      banner: null,
      bannerUrl: null,
      classId: classRouteId,
      displayCode: `${displayCodePrefix}001`,
      dueAt: validAssignment.dueAt,
      gradingType: 'Numeric',
      id: assignmentRouteId,
      instructions: validAssignment.instructions,
      isGradedAssignment: true,
      maxMarks: 10,
      resources: [],
      rubrics: [],
      subjectId: validAssignment.subjectId,
      title: validAssignment.title,
    });
    const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });

    const response = await request(teacherApp)
      .post('/teacher/classes/' + classRouteId + '/assignments')
      .set('Idempotency-Key', 'assignment-create-display-code')
      .send(validAssignment)
      .expect(201);

    expect(response.body.displayCode).toMatch(/^ASG-\d{4}-\d{3,}$/);
  });

  it('stamps a per-school yearly display code inside the create insert', async () => {
    const queries: string[] = [];
    const parameters: unknown[][] = [];
    const callback: RemoteCallback = async (query, params) => {
      queries.push(query);
      parameters.push(params);
      return { rows: [] };
    };
    const repository = new DrizzleAssignmentsRepository(
      databaseWithTransaction(callback),
    );

    await repository.create(
      { schoolId, userId: teacherId },
      classRouteId,
      validAssignment as Parameters<AssignmentsRepository['create']>[2],
    );

    const insert = queries.find((query) => query.includes('insert into public.assignments'));
    expect(insert).toBeDefined();
    expect(insert).toContain('display_code');
    // The sequence is derived in the statement itself, so concurrent creates cannot
    // read the same count and both win.
    expect(insert).toContain('lpad');
    expect(insert).toContain('count(*) + 1');
    expect(parameters.flat()).toContain(displayCodePrefix);
  });

  it('pads the sequence to three digits without truncating a wider one', async () => {
    const queries: string[] = [];
    const callback: RemoteCallback = async (query) => {
      queries.push(query);
      return { rows: [] };
    };
    const repository = new DrizzleAssignmentsRepository(
      databaseWithTransaction(callback),
    );

    await repository.create(
      { schoolId, userId: teacherId },
      classRouteId,
      validAssignment as Parameters<AssignmentsRepository['create']>[2],
    );

    const insert = queries.find((query) => query.includes('insert into public.assignments'));
    // `lpad` truncates on the right when the input is longer than the width, so a
    // literal 3 renders the 1000th code as 'ASG-<year>-100' — already issued to the
    // 100th assignment. Every retry recomputes the same value, so creates in that
    // school stay broken until the year rolls over. The width must be computed.
    expect(insert).toContain('greatest(3, length(');
    expect(insert).not.toMatch(/lpad\(\s*[^,]*,\s*3\s*,\s*'0'\s*\)/);
  });

  it('renders a four-digit sequence in full and still matches the published code shape', () => {
    // Mirrors the statement's `lpad(n::text, greatest(3, length(n::text)), '0')`.
    // The statement's own expression is asserted structurally above; this pins the
    // shape the contract promises callers, including past 999.
    const render = (sequence: number): string => {
      const digits = String(sequence);
      return `${displayCodePrefix}${digits.padStart(Math.max(3, digits.length), '0')}`;
    };

    expect(render(1)).toBe(`${displayCodePrefix}001`);
    expect(render(999)).toBe(`${displayCodePrefix}999`);
    expect(render(1000)).toBe(`${displayCodePrefix}1000`);
    expect(render(1000)).not.toBe(render(100));
    for (const sequence of [1, 999, 1000, 12345]) {
      expect(render(sequence)).toMatch(/^ASG-\d{4}-\d{3,}$/);
    }
  });

  it('retries the create insert when a concurrent assignment claims the same display code', async () => {
    let attempts = 0;
    const callback: RemoteCallback = async (query) => {
      if (query.includes('insert into public.assignments')) {
        attempts += 1;
        if (attempts === 1) {
          throw Object.assign(new Error('duplicate key value violates unique constraint'), {
            code: '23505',
            constraint_name: 'assignments_display_code_per_school',
          });
        }
      }
      return { rows: [] };
    };
    const repository = new DrizzleAssignmentsRepository(
      databaseWithTransaction(callback),
    );

    await repository.create(
      { schoolId, userId: teacherId },
      classRouteId,
      validAssignment as Parameters<AssignmentsRepository['create']>[2],
    );

    expect(attempts).toBe(2);
  });

  it('rethrows once the display-code retries are exhausted instead of looping forever', async () => {
    let attempts = 0;
    const callback: RemoteCallback = async (query) => {
      if (query.includes('insert into public.assignments')) {
        attempts += 1;
        throw Object.assign(new Error('duplicate key value violates unique constraint'), {
          code: '23505',
          constraint_name: 'assignments_display_code_per_school',
        });
      }
      return { rows: [] };
    };
    const repository = new DrizzleAssignmentsRepository(
      databaseWithTransaction(callback),
    );

    // A conflict that never clears must surface, not spin. Retrying is only
    // correct while a competing create is committing a code between attempts.
    await expect(repository.create(
      { schoolId, userId: teacherId },
      classRouteId,
      validAssignment as Parameters<AssignmentsRepository['create']>[2],
    )).rejects.toThrow();
    expect(attempts).toBe(5);
  });

  it('does not retry a create insert that failed for an unrelated reason', async () => {
    let attempts = 0;
    const callback: RemoteCallback = async (query) => {
      if (query.includes('insert into public.assignments')) {
        attempts += 1;
        throw Object.assign(new Error('null value in column violates not-null constraint'), {
          code: '23502',
        });
      }
      return { rows: [] };
    };
    const repository = new DrizzleAssignmentsRepository(
      databaseWithTransaction(callback),
    );

    // The driver wraps the original error, so the behaviour under test is the
    // attempt count: a non-conflict failure must surface on the first try.
    await expect(repository.create(
      { schoolId, userId: teacherId },
      classRouteId,
      validAssignment as Parameters<AssignmentsRepository['create']>[2],
    )).rejects.toThrow();
    expect(attempts).toBe(1);
  });

  it('reads the stored display code and full due timestamp back onto the detail read model', async () => {
    const callback: RemoteCallback = async (query) => {
      if (query.includes('assignment_rubrics') || query.includes('assignment_resources')) {
        return { rows: [] };
      }
      return {
        rows: [[
          classRouteId,                                  // classId
          new Date('2026-03-01T09:00:00.000Z'),          // createdAt
          null,                                          // deletedAt
          `${displayCodePrefix}007`,                     // displayCode
          new Date('2026-04-05T22:00:00.000Z'),          // dueAt
          'Numeric',                                     // gradingType
          assignmentRouteId,                             // id
          validAssignment.instructions,                  // instructions
          true,                                          // isGraded
          10,                                            // maxMarks
          schoolId,                                      // schoolId
          validAssignment.subjectId,                     // subjectId
          teacherId,                                     // teacherId
          validAssignment.title,                         // title
          new Date('2026-03-01T09:00:00.000Z'),          // updatedAt
        ]],
      };
    };
    const repository = new DrizzleAssignmentsRepository(
      drizzle(callback) as unknown as Database,
    );

    const detail = await repository.findForTeacher(
      { schoolId, userId: teacherId },
      assignmentRouteId,
    );

    expect(detail?.displayCode).toBe(`${displayCodePrefix}007`);
    expect(detail?.dueAt).toBe('2026-04-05T22:00:00.000Z');
  });

  it('leaves the display code null for rows written before the column existed', async () => {
    const callback: RemoteCallback = async (query) => {
      if (query.includes('assignment_rubrics') || query.includes('assignment_resources')) {
        return { rows: [] };
      }
      return {
        rows: [[
          classRouteId, new Date('2026-03-01T09:00:00.000Z'), null,
          null,                                          // displayCode — pre-existing row
          new Date('2026-04-05T22:00:00.000Z'), 'Numeric', assignmentRouteId,
          validAssignment.instructions, true, 10, schoolId,
          validAssignment.subjectId, teacherId, validAssignment.title,
          new Date('2026-03-01T09:00:00.000Z'),
        ]],
      };
    };
    const repository = new DrizzleAssignmentsRepository(
      drizzle(callback) as unknown as Database,
    );

    const detail = await repository.findForTeacher(
      { schoolId, userId: teacherId },
      assignmentRouteId,
    );

    expect(detail?.displayCode).toBeNull();
  });

  it('carries the time of day, not just the date, onto teacher assignment list items', async () => {
    const callback: RemoteCallback = async () => ({
      rows: [[
        new Date('2026-03-01T09:00:00.000Z'),  // createdAt
        `${displayCodePrefix}012`,             // displayCode
        new Date('2026-04-05T22:00:00.000Z'),  // dueAt
        'Numeric',                             // gradingType
        assignmentRouteId,                     // id
        true,                                  // isGraded
        10,                                    // maxMarks
        schoolId,                              // schoolId
        validAssignment.subjectId,             // subjectId
        '0',                                   // submissionCount
        validAssignment.title,                 // title
        '0',                                   // totalStudents
      ]],
    });
    const repository = new DrizzleAssignmentsRepository(
      drizzle(callback) as unknown as Database,
    );

    const page = await repository.listForTeacher(
      { schoolId, userId: teacherId },
      classRouteId,
      { limit: 20 },
    );

    expect(page.items[0]?.dueAt).toBe('2026-04-05T22:00:00.000Z');
  });

  describe('optional rubric breakdowns', () => {
    // `update ... returning` hands back every column in schema order; the
    // repository only reads `id` off it, but it has to be a real row or the
    // update short-circuits before it ever reaches the rubric handling.
    const updatedAssignmentRow = [
      assignmentRouteId,                     // id
      schoolId,                              // schoolId
      classRouteId,                          // classId
      validAssignment.subjectId,             // subjectId
      teacherId,                             // teacherId
      validAssignment.title,                 // title
      validAssignment.instructions,          // instructions
      `${displayCodePrefix}013`,             // displayCode
      new Date('2026-04-05T22:00:00.000Z'),  // dueAt
      true,                                  // isGraded
      'Numeric',                             // gradingType
      10,                                    // maxMarks
      null,                                  // deletedAt
      new Date('2026-03-01T09:00:00.000Z'),  // createdAt
      new Date('2026-03-01T09:00:00.000Z'),  // updatedAt
    ];

    /** Every statement the repository issues, in order. */
    function recordingDatabase(statements: string[]): Database {
      return databaseWithTransaction(async (query) => {
        statements.push(query);
        if (query.includes('insert into public.assignments')) return { rows: [[assignmentRouteId]] };
        if (query.includes('update "assignments"')) return { rows: [updatedAssignmentRow] };
        return { rows: [] };
      });
    }

    it('writes an assignment with no rubric rows rather than throwing on an empty insert', async () => {
      const statements: string[] = [];
      const repository = new DrizzleAssignmentsRepository(recordingDatabase(statements));

      await repository.create(
        { schoolId, userId: teacherId },
        classRouteId,
        assignmentWithoutRubrics as Parameters<AssignmentsRepository['create']>[2],
      );

      expect(statements.some((statement) => statement.includes('insert into public.assignments'))).toBe(true);
      expect(statements.some((statement) => statement.includes('insert into "assignment_rubrics"'))).toBe(false);
    });

    it('leaves stored rubrics untouched when an update omits them', async () => {
      const statements: string[] = [];
      const repository = new DrizzleAssignmentsRepository(recordingDatabase(statements));

      await repository.update(
        { schoolId, userId: teacherId },
        assignmentRouteId,
        assignmentWithoutRubrics as Parameters<AssignmentsRepository['update']>[2],
      );

      // The destructive half of delete-then-reinsert must not run.
      expect(statements.some((statement) => statement.includes('delete from "assignment_rubrics"'))).toBe(false);
      expect(statements.some((statement) => statement.includes('insert into "assignment_rubrics"'))).toBe(false);
    });

    it('clears stored rubrics when an update states an empty breakdown', async () => {
      const statements: string[] = [];
      const repository = new DrizzleAssignmentsRepository(recordingDatabase(statements));

      await repository.update(
        { schoolId, userId: teacherId },
        assignmentRouteId,
        { ...validAssignment, rubrics: [] } as Parameters<AssignmentsRepository['update']>[2],
      );

      expect(statements.some((statement) => statement.includes('delete from "assignment_rubrics"'))).toBe(true);
      expect(statements.some((statement) => statement.includes('insert into "assignment_rubrics"'))).toBe(false);
    });
  });

  /**
   * The authoring form ships the "Graded Assignment" toggle switched on, so
   * `is_graded` is true on nearly everything a teacher creates. Deriving the
   * Active/Graded tabs from that column filed each new assignment under Graded
   * the moment it was written — and the Graded tab prunes to a single due date,
   * so a teacher who had just created one saw it in neither tab. The tabs are
   * grading progress; `graded_at` on a submission is what states it.
   */
  describe('teacher Active/Graded derivation', () => {
    async function captureListSql(status: 'active' | 'graded'): Promise<string> {
      let captured = '';
      const callback: RemoteCallback = async (query) => {
        captured = query;
        return { rows: [] };
      };
      const repository = new DrizzleAssignmentsRepository(
        drizzle(callback) as unknown as Database,
      );
      await repository.listForTeacher(
        { schoolId, userId: teacherId },
        classRouteId,
        { limit: 20, status },
      );
      return captured;
    }

    it('files an assignment under Active until one of its submissions is graded', async () => {
      const sql = await captureListSql('active');

      expect(sql).toContain('graded_at');
      expect(sql).toContain('assignment_submissions');
      expect(sql).toContain('not exists');
      // The creation-time toggle must not decide the tab.
      expect(sql).not.toMatch(/"is_graded"\s*=\s*\$/);
    });

    it('files an assignment under Graded once one of its submissions is graded', async () => {
      const sql = await captureListSql('graded');

      expect(sql).toContain('graded_at');
      expect(sql).toContain('assignment_submissions');
      expect(sql).not.toContain('not exists');
      expect(sql).not.toMatch(/"is_graded"\s*=\s*\$/);
    });

    it('leaves both tabs unfiltered when no status is requested', async () => {
      let captured = '';
      const callback: RemoteCallback = async (query) => {
        captured = query;
        return { rows: [] };
      };
      const repository = new DrizzleAssignmentsRepository(
        drizzle(callback) as unknown as Database,
      );

      await repository.listForTeacher(
        { schoolId, userId: teacherId },
        classRouteId,
        { limit: 20 },
      );

      expect(captured).not.toContain('graded_at');
    });
  });
});

/**
 * Frames 253:9834 / 253:9952 pair the assigned date with a relative age ("2m ago").
 * A day-granularity display string cannot produce that, so the stored creation
 * instant rides the student read models as `assignedAt`.
 */
describe('student assignment assignedAt timestamps', () => {
  const assignedAt = '2026-08-10T04:58:00.000Z';
  const dueAt = '2026-08-20T12:00:00.000Z';

  it('returns assignedAt as a real timestamp on the student assignment list', async () => {
    const service = createService();
    vi.mocked(service.listForStudent).mockResolvedValue({
      items: [{
        assignedAt,
        dueAt,
        gradingType: 'Numeric',
        id: assignmentRouteId,
        isGradedAssignment: true,
        studentStatus: 'pending',
        subjectId: validAssignment.subjectId,
        subjectName: 'Mathematics',
        title: validAssignment.title,
      }],
      nextCursor: undefined,
    });
    const studentApp = createTestApp(service, { role: 'student', userId: studentId });

    const response = await request(studentApp).get('/student/assignments').expect(200);

    expect(response.body.items[0].assignedAt).toBe(assignedAt);
    // The display date stays exactly as it was; assignedAt sits beside it.
    expect(response.body.items[0].dueAt).toBe(dueAt);
  });

  it('returns assignedAt on the student assignment detail response', async () => {
    const service = createService();
    vi.mocked(service.getForStudent).mockResolvedValue({
      assignedAt,
      banner: null,
      bannerUrl: null,
      classId: classRouteId,
      displayCode: `ASG-${new Date().getUTCFullYear()}-004`,
      dueAt,
      gradingType: 'Numeric',
      id: assignmentRouteId,
      instructions: validAssignment.instructions,
      isGradedAssignment: true,
      maxMarks: 10,
      resources: [],
      rubrics: [],
      subjectId: validAssignment.subjectId,
      title: validAssignment.title,
    });
    const studentApp = createTestApp(service, { role: 'student', userId: studentId });

    const response = await request(studentApp)
      .get('/student/assignments/' + assignmentRouteId)
      .expect(200);

    expect(response.body.assignedAt).toBe(assignedAt);
  });

  it('maps the stored creation instant onto student list items, not the due date', async () => {
    const callback: RemoteCallback = async () => ({
      rows: [[
        new Date(assignedAt),          // assignedAt (assignments.created_at)
        null,                          // completedAt
        new Date(dueAt),               // dueAt
        null,                          // gradedAt
        'Numeric',                     // gradingType
        assignmentRouteId,             // id
        true,                          // isGraded
        null,                          // letterGrade
        null,                          // marks
        schoolId,                      // schoolId
        validAssignment.subjectId,     // subjectId
        'Mathematics',                 // subjectName
        null,                          // submittedAt
        validAssignment.title,         // title
      ]],
    });
    const repository = new DrizzleAssignmentsRepository(
      drizzle(callback) as unknown as Database,
    );

    const page = await repository.listForStudent(
      { schoolId, userId: studentId },
      { limit: 20 },
      new Date('2026-08-01T00:00:00.000Z'),
    );

    expect(page.items[0]?.assignedAt).toBe(assignedAt);
    // The whole point of the field: it is the creation instant, never the due date.
    // The client previously fell back to dueAt and dated assignments wrongly.
    expect(page.items[0]?.assignedAt).not.toBe(page.items[0]?.dueAt);
  });

  it('carries minute-level precision, so an age finer than a day is derivable', async () => {
    const callback: RemoteCallback = async () => ({
      rows: [[
        new Date('2026-08-10T04:58:30.000Z'), // assignedAt
        null,                                 // completedAt
        new Date(dueAt), null, 'Numeric', assignmentRouteId, true,
        null,                                 // letterGrade
        null,                                 // marks
        schoolId, validAssignment.subjectId, 'Mathematics', null, validAssignment.title,
      ]],
    });
    const repository = new DrizzleAssignmentsRepository(
      drizzle(callback) as unknown as Database,
    );

    const page = await repository.listForStudent(
      { schoolId, userId: studentId },
      { limit: 20 },
      new Date('2026-08-01T00:00:00.000Z'),
    );

    // A date-only string would have discarded the clock; "2m ago" needs it.
    expect(page.items[0]?.assignedAt).toBe('2026-08-10T04:58:30.000Z');
  });

  it('reads the stored creation instant back onto the student detail read model', async () => {
    const callback: RemoteCallback = async (query) => {
      if (query.includes('assignment_rubrics') || query.includes('assignment_resources')) {
        return { rows: [] };
      }
      return {
        rows: [[
          classRouteId,                                  // classId
          new Date(assignedAt),                          // createdAt
          null,                                          // deletedAt
          `ASG-${new Date().getUTCFullYear()}-007`,      // displayCode
          new Date(dueAt),                               // dueAt
          'Numeric',                                     // gradingType
          assignmentRouteId,                             // id
          validAssignment.instructions,                  // instructions
          true,                                          // isGraded
          10,                                            // maxMarks
          schoolId,                                      // schoolId
          validAssignment.subjectId,                     // subjectId
          teacherId,                                     // teacherId
          validAssignment.title,                         // title
          new Date(assignedAt),                          // updatedAt
        ]],
      };
    };
    const repository = new DrizzleAssignmentsRepository(
      drizzle(callback) as unknown as Database,
    );

    const detail = await repository.findForStudent(
      { schoolId, userId: studentId },
      assignmentRouteId,
    );

    expect(detail?.assignedAt).toBe(assignedAt);
    expect(detail?.dueAt).toBe(dueAt);
  });

  it('keeps the student list query school-scoped while selecting the creation instant', async () => {
    const queries: string[] = [];
    const callback: RemoteCallback = async (query) => {
      queries.push(query);
      return { rows: [] };
    };
    const repository = new DrizzleAssignmentsRepository(
      drizzle(callback) as unknown as Database,
    );

    await repository.listForStudent(
      { schoolId, userId: studentId },
      { limit: 20 },
      new Date('2026-08-01T00:00:00.000Z'),
    );

    const listQuery = queries[0] ?? '';
    const whereIndex = listQuery.indexOf(' where ');
    expect(whereIndex).toBeGreaterThan(-1);

    expect(listQuery).toContain('"assignments"."created_at"');
    // Asserting the bare token `school_id` would prove nothing: the projection
    // selects `"assignments"."school_id"`, and the joins compare the subjects
    // and submissions columns, so the token survives even with the tenancy
    // predicate deleted. Only the where clause binds this table's school_id to
    // a parameter, so that is what has to be asserted.
    expect(listQuery.slice(whereIndex)).toContain('"assignments"."school_id" = $');
  });
});

/**
 * 596:16571 draws each assignment card as `submitted/total` with a progress bar
 * and a Pending remainder. The teacher list contract carried neither figure, so
 * the client hardcoded `0/0` on every card. Both are correlated subqueries in
 * the listing query — computed over the assignment's own class, never over the
 * returned page — mirroring the exam assessment list.
 */
describe('teacher assignment roster counts', () => {
  const listDisplayCode = `ASG-${new Date().getUTCFullYear()}-012`;
  const listRow = (submitted: string, total: string) => [
    new Date('2026-03-01T09:00:00.000Z'), // createdAt
    listDisplayCode,                      // displayCode
    new Date('2026-04-05T22:00:00.000Z'), // dueAt
    'Numeric',                            // gradingType
    assignmentRouteId,                    // id
    false,                                // isGraded
    10,                                   // maxMarks
    schoolId,                             // schoolId
    validAssignment.subjectId,            // subjectId
    submitted,                            // submissionCount
    validAssignment.title,                // title
    total,                                // totalStudents
  ];

  it('counts submitted students and the live class roster inside the listing query', async () => {
    const queries: string[] = [];
    const callback: RemoteCallback = async (query) => {
      queries.push(query);
      return { rows: [listRow('20', '33')] };
    };
    const repository = new DrizzleAssignmentsRepository(
      drizzle(callback) as unknown as Database,
    );

    const page = await repository.listForTeacher(
      { schoolId, userId: teacherId },
      classRouteId,
      { limit: 20 },
    );

    expect(page.items[0]).toMatchObject({ submissionCount: 20, totalStudents: 33 });

    const listQuery = queries[0] ?? '';
    expect(listQuery).toContain('assignment_submissions');
    expect(listQuery).toContain('class_members');
    // A draft row exists from the moment a student opens the upload sheet, so
    // only a durable submitted_at counts as a submission.
    expect(listQuery).toContain('submitted_at is not null');
    // Both counts are restricted to students still enrolled, so Pending cannot
    // go negative when a graded student has since left the class.
    expect(listQuery).toContain('is_active');
  });

  it('serves both counts on the teacher assignment list route', async () => {
    const service = createService();
    vi.mocked(service.listForTeacher).mockResolvedValue({
      items: [{
        createdAt: '2026-03-01T09:00:00.000Z',
        displayCode: listDisplayCode,
        dueAt: '2026-04-05T22:00:00.000Z',
        gradingType: 'Numeric',
        id: assignmentRouteId,
        isGradedAssignment: false,
        maxMarks: 10,
        subjectId: validAssignment.subjectId,
        submissionCount: 20,
        title: validAssignment.title,
        totalStudents: 33,
      }],
      nextCursor: undefined,
    });
    const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });

    const response = await request(teacherApp)
      .get('/teacher/classes/' + classRouteId + '/assignments')
      .expect(200);

    expect(response.body.items[0]).toMatchObject({ submissionCount: 20, totalStudents: 33 });
  });
});

/**
 * 668:4935 / 668:4886 name the submitting student in the roster row, in the
 * search box and in the footer. The submission contract carried only
 * `studentId`, so every one of those printed a raw UUID. The name is joined
 * beside the submission in each read that produces the DTO, school-scoped like
 * every other query in this repository.
 */
describe('submission student names', () => {
  it('returns the joined student name on the teacher submission list', async () => {
    const service = createService();
    vi.mocked(service.listSubmissions).mockResolvedValue({
      items: [{
        completedAt: null,
        id: draftSubmissionId,
        studentId,
        studentName: 'Asha Patel',
        submittedAt: '2026-07-15T09:00:00.000Z',
      }],
      nextCursor: undefined,
    });
    const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });

    const response = await request(teacherApp)
      .get('/teacher/assignments/' + assignmentRouteId + '/submissions')
      .expect(200);

    expect(response.body.items[0]).toMatchObject({ studentId, studentName: 'Asha Patel' });
  });

  it('returns the joined student name from the grade response', async () => {
    const service = createService();
    vi.mocked(service.grade).mockResolvedValue({
      completedAt: null,
      gradedAt: '2026-07-16T09:00:00.000Z',
      id: draftSubmissionId,
      marks: 8,
      studentId,
      studentName: 'Asha Patel',
      submittedAt: '2026-07-15T09:00:00.000Z',
    });
    const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });

    const response = await request(teacherApp)
      .put('/teacher/submissions/' + draftSubmissionId + '/grade')
      .set('Idempotency-Key', 'grade-name-1')
      .send({ marks: 8 })
      .expect(200);

    expect(response.body).toMatchObject({ studentName: 'Asha Patel' });
  });

  it('joins user_profiles school-scoped inside the teacher submission-list query', async () => {
    const queries: string[] = [];
    let queryCount = 0;
    const callback: RemoteCallback = async (query) => {
      queries.push(query);
      queryCount += 1;
      return {
        // Positional, in the exact order `listSubmissions` selects: the
        // pg-proxy driver maps by index, so a column added to the select has to
        // be added here too or every later field reads its neighbour's value.
        rows: queryCount === 1 ? [{ id: 'a1' }] : [[
          assignmentRouteId,                    // assignmentId
          null,                                 // completedAt
          null,                                 // feedback
          null,                                 // fileName
          null,                                 // gradedAt
          draftSubmissionId,                    // id
          null,                                 // letterGrade
          null,                                 // marks
          null,                                 // objectPath
          studentId,                            // studentId
          'Asha Patel',                         // studentName
          new Date('2026-07-15T09:00:00.000Z'), // submittedAt
        ]],
      };
    };
    const repository = new DrizzleAssignmentsRepository(
      drizzle(callback) as unknown as Database,
    );

    const page = await repository.listSubmissions(
      { schoolId, userId: teacherId },
      assignmentRouteId,
      { limit: 20 },
    );

    expect(page?.items[0]?.studentName).toBe('Asha Patel');
    const listQuery = queries.at(-1) ?? '';
    expect(listQuery).toContain('user_profiles');
    expect(listQuery).toContain('display_name');
    // The join carries the tenant, not only the student key: a profile row from
    // another school can never name a submission in this one.
    expect(listQuery).toContain('"user_profiles"."school_id"');
  });

  it('returns the student name from the grade mutation', async () => {
    const callback: RemoteCallback = async () => ({
      rows: [[
        assignmentRouteId,                    // assignmentId
        null,                                 // completedAt
        null,                                 // feedback
        new Date('2026-07-16T09:00:00.000Z'), // gradedAt
        draftSubmissionId,                    // id
        null,                                 // letterGrade
        8,                                    // marks
        null,                                 // objectPath
        studentId,                            // studentId
        'Asha Patel',                         // studentName
        new Date('2026-07-15T09:00:00.000Z'), // submittedAt
      ]],
    });
    const repository = new DrizzleAssignmentsRepository(
      drizzle(callback) as unknown as Database,
    );

    const graded = await repository.grade(
      { schoolId, userId: teacherId },
      draftSubmissionId,
      { marks: 8 },
      new Date('2026-07-16T09:00:00.000Z'),
    );

    expect(graded?.studentName).toBe('Asha Patel');
  });

  /**
   * The confirm recover path reads its row through raw SQL. `db.execute` returns
   * the driver's own column labels, so every unaliased column arrived
   * snake_case and `toStoredSubmission` read `undefined` off it — the mapper
   * then threw on `row.gradedAt.toISOString()`, and the executor turned that
   * into "completion unavailable". The recovery could never succeed. The
   * aliases are what make this row mappable at all; the name rides with them.
   */
  it('maps every column of the confirm recover row, including the student name', async () => {
    let recoverQuery = '';
    const callback: RemoteCallback = async (query) => ({
      rows: [(recoverQuery = query, {
        assignmentId: assignmentRouteId,
        completedAt: null,
        feedback: null,
        gradedAt: null,
        id: draftSubmissionId,
        marks: null,
        objectPath: 'submissions/object-path',
        studentId,
        studentName: 'Asha Patel',
        submittedAt: new Date('2026-07-15T09:00:00.000Z'),
      }) as never],
    });
    const repository = new DrizzleAssignmentsRepository(
      drizzle(callback) as unknown as Database,
    );

    const submission = await repository.findSubmissionForUpload(
      { schoolId, userId: studentId },
      assignmentRouteId,
      uploadSessionId,
    );

    expect(submission).toMatchObject({
      assignmentId: assignmentRouteId,
      id: draftSubmissionId,
      studentId,
      studentName: 'Asha Patel',
      submittedAt: '2026-07-15T09:00:00.000Z',
    });
    // The mapper reads camelCase; only an explicit alias makes the driver emit
    // it. This is what the fixture above is entitled to assume.
    for (const alias of ['"assignmentId"', '"studentId"', '"studentName"', '"submittedAt"', '"gradedAt"', '"objectPath"', '"completedAt"']) {
      expect(recoverQuery).toContain(alias);
    }
  });

  it('carries the student name through the submission confirm mutation', async () => {
    const rows: ReadonlyArray<ReadonlyArray<Record<string, unknown>>> = [
      // The locked pre-image: no upload session attached yet.
      [{
        assignment_id: assignmentRouteId,
        completed_at: null,
        feedback: null,
        graded_at: null,
        id: draftSubmissionId,
        marks: null,
        object_path: null,
        studentName: 'Asha Patel',
        student_id: studentId,
        submitted_at: null,
        upload_session_id: null,
      }],
      // The attached post-image.
      [{
        assignment_id: assignmentRouteId,
        completed_at: null,
        feedback: null,
        graded_at: null,
        id: draftSubmissionId,
        marks: null,
        object_path: 'submissions/object-path',
        studentName: 'Asha Patel',
        student_id: studentId,
        submitted_at: new Date('2026-07-15T09:00:00.000Z'),
      }],
    ];
    let call = 0;
    const callback: RemoteCallback = async () => {
      const next = rows[call] ?? [];
      call += 1;
      return { rows: next as never };
    };
    const repository = new DrizzleAssignmentsRepository(
      databaseWithTransaction(callback),
    );

    const confirmed = await repository.confirmSubmission({
      assignmentId: assignmentRouteId,
      displayName: 'essay.pdf',
      identity: { schoolId, userId: studentId },
      objectPath: 'submissions/object-path',
      submittedAt: new Date('2026-07-15T09:00:00.000Z'),
      uploadSessionId,
    });

    expect(confirmed).toMatchObject({
      kind: 'attached',
      submission: { studentId, studentName: 'Asha Patel' },
    });
  });
});
