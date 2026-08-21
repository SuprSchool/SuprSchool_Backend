// The client fix wave: assignment banners, bulk mark-as-done, per-student
// status on the student list, and alphabetic grading.
//
// A separate file from `assignments.routes.test.ts` on purpose — that file is
// already 1800 lines and four client agents are building against these
// contracts in parallel, so the fields they depend on are pinned here where
// they can be read as one contract rather than hunted for.
import express, { type Request, type Response } from 'express';
import { drizzle, type RemoteCallback } from 'drizzle-orm/pg-proxy';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../src/db/client.js';
import {
  DrizzleAssignmentsRepository,
  type AssignmentsRepository,
} from '../src/db/repositories/assignments.repository.js';
import type { AuthenticationMiddleware } from '../src/middleware/authenticate.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { createAssignmentsRouter } from '../src/routes/assignments.routes.js';
import {
  createAssignmentsService,
  type AcademicFilePort,
  type AcademicMutationPort,
  type AssignmentsService,
} from '../src/services/assignments.service.js';
import type { AssignmentIdentity } from '../src/types/assignments.js';

const schoolId = '11111111-1111-4111-8111-111111111111';
const studentId = '22222222-2222-4222-8222-222222222222';
const teacherId = '44444444-4444-4444-8444-444444444444';
const uploadSessionId = '55555555-5555-4555-8555-555555555555';
const assignmentRouteId = '88888888-8888-4888-8888-888888888888';
const submissionRouteId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const bannerResourceId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const identity: AssignmentIdentity = { schoolId, userId: teacherId };

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

function createTestApp(
  service: AssignmentsService,
  who: { role: 'student' | 'teacher'; userId: string },
) {
  const authenticate: AuthenticationMiddleware = async (
    requestValue: Request,
    _response: Response,
    next,
  ): Promise<void> => {
    requestValue.auth = { schoolId, ...who };
    next();
  };
  const app = express();
  app.use(express.json());
  app.use('/', createAssignmentsRouter(service, authenticate));
  app.use(errorHandler);
  return app;
}

function passthroughMutations(): AcademicMutationPort {
  return {
    async execute<T>(
      _identity: AssignmentIdentity,
      input: { successStatus: number; work: () => Promise<T> },
    ) {
      return { body: await input.work(), replayed: false, status: input.successStatus };
    },
  } as AcademicMutationPort;
}

function databaseWithTransaction(callback: RemoteCallback): Database {
  const database = drizzle(callback) as unknown as Database;
  Object.assign(database, {
    transaction: async <T>(work: (transaction: Database) => Promise<T>): Promise<T> => (
      work(database)
    ),
  });
  return database;
}

// ─────────────────────────────────────────────────────────── banner attachment

describe('assignment banner attachment', () => {
  it('defaults an attachment with no stated role to an ordinary resource', async () => {
    const service = createService();
    const app = createTestApp(service, { role: 'teacher', userId: teacherId });

    await request(app).post(`/teacher/assignments/${assignmentRouteId}/resources/upload-sessions`)
      .set('Idempotency-Key', 'banner-default-1')
      .send({ contentType: 'application/pdf', displayName: 'worksheet.pdf', sizeBytes: 512 })
      .expect(201);

    expect(vi.mocked(service.createResourceUploadSession).mock.calls[0]?.[2])
      .toMatchObject({ role: 'resource' });
  });

  it('accepts role: banner on the upload-session body', async () => {
    const service = createService();
    const app = createTestApp(service, { role: 'teacher', userId: teacherId });

    await request(app).post(`/teacher/assignments/${assignmentRouteId}/resources/upload-sessions`)
      .set('Idempotency-Key', 'banner-role-1')
      .send({ contentType: 'image/png', displayName: 'header.png', role: 'banner', sizeBytes: 2048 })
      .expect(201);

    expect(vi.mocked(service.createResourceUploadSession).mock.calls[0]?.[2])
      .toMatchObject({ role: 'banner' });
  });

  // House style elsewhere spells the same idea `kind`, and clients arrive with
  // either — so both are accepted and `role` is the one that wins.
  it('accepts kind as an alias for role, and lets role win when both are sent', async () => {
    const service = createService();
    const app = createTestApp(service, { role: 'teacher', userId: teacherId });

    await request(app).post(`/teacher/assignments/${assignmentRouteId}/resources/upload-sessions`)
      .set('Idempotency-Key', 'banner-kind-1')
      .send({ contentType: 'image/webp', displayName: 'header.webp', kind: 'banner', sizeBytes: 2048 })
      .expect(201);
    await request(app).post(`/teacher/assignments/${assignmentRouteId}/resources/upload-sessions`)
      .set('Idempotency-Key', 'banner-kind-2')
      .send({
        contentType: 'application/pdf',
        displayName: 'worksheet.pdf',
        kind: 'banner',
        role: 'resource',
        sizeBytes: 512,
      })
      .expect(201);

    expect(vi.mocked(service.createResourceUploadSession).mock.calls[0]?.[2])
      .toMatchObject({ role: 'banner' });
    expect(vi.mocked(service.createResourceUploadSession).mock.calls[1]?.[2])
      .toMatchObject({ role: 'resource' });
  });

  it('rejects a banner that is not an image', async () => {
    const service = createService();
    const app = createTestApp(service, { role: 'teacher', userId: teacherId });

    await request(app).post(`/teacher/assignments/${assignmentRouteId}/resources/upload-sessions`)
      .set('Idempotency-Key', 'banner-pdf-1')
      .send({ contentType: 'application/pdf', displayName: 'header.pdf', role: 'banner', sizeBytes: 512 })
      .expect(400);

    expect(service.createResourceUploadSession).not.toHaveBeenCalled();
  });

  it('carries the role through the resource confirm, kind included', async () => {
    const service = createService();
    const app = createTestApp(service, { role: 'teacher', userId: teacherId });

    await request(app).post(`/teacher/assignments/${assignmentRouteId}/resources/confirm`)
      .set('Idempotency-Key', 'banner-confirm-1')
      .send({ kind: 'banner', uploadSessionId })
      .expect(201);

    expect(service.confirmResource).toHaveBeenCalledWith(
      identity, assignmentRouteId, uploadSessionId, 'banner-confirm-1', 'banner',
    );
  });

  it('publishes bannerUrl and a sibling banner object, and keeps the banner out of resources', async () => {
    const createReadUrl = vi.fn(async (_bucket: string, objectPath: string) => (
      `https://signed.example/${objectPath}`
    ));
    const service = createAssignmentsService({
      cache: { invalidateStudentAssignments: vi.fn() },
      files: { createReadUrl } as unknown as AcademicFilePort,
      mutations: passthroughMutations(),
      outbox: { write: vi.fn(), writeInTransaction: vi.fn() },
      repository: {
        findForTeacher: vi.fn().mockResolvedValue({
          assignedAt: '2026-08-01T08:00:00.000Z',
          banner: { id: bannerResourceId, name: 'header.png', objectPath: 'banner-object' },
          classId: 'class-1',
          displayCode: 'ASG-2026-001',
          dueAt: '2026-08-20T12:00:00.000Z',
          gradingType: 'Numeric',
          id: assignmentRouteId,
          instructions: 'Do the thing',
          isGradedAssignment: true,
          maxMarks: 10,
          resources: [{ id: 'r1', name: 'worksheet.pdf', objectPath: 'worksheet-object' }],
          rubrics: [],
          subjectId: 'subject-1',
          title: 'Homework',
        }),
      } as unknown as AssignmentsRepository,
    });

    const detail = await service.getForTeacher(identity, assignmentRouteId);

    expect(detail.bannerUrl).toBe('https://signed.example/banner-object');
    expect(detail.banner).toEqual({
      id: bannerResourceId,
      name: 'header.png',
      signedUrl: 'https://signed.example/banner-object',
    });
    // The whole point: the header image is not also a file tile.
    expect(detail.resources.map((resource) => resource.id)).toEqual(['r1']);
  });

  // The student side is the one that regressed in the field: the chips open
  // `signedUrl` via Linking, so a resource without one is an inert chip.
  it('signs every resource on the student detail, not only on the teacher detail', async () => {
    const createReadUrl = vi.fn(async (_bucket: string, objectPath: string) => (
      `https://signed.example/${objectPath}`
    ));
    const service = createAssignmentsService({
      cache: { invalidateStudentAssignments: vi.fn() },
      files: { createReadUrl } as unknown as AcademicFilePort,
      mutations: passthroughMutations(),
      outbox: { write: vi.fn(), writeInTransaction: vi.fn() },
      repository: {
        findForStudent: vi.fn().mockResolvedValue({
          assignedAt: '2026-08-01T08:00:00.000Z',
          banner: { id: bannerResourceId, name: 'header.png', objectPath: 'banner-object' },
          classId: 'class-1',
          displayCode: 'ASG-2026-002',
          dueAt: '2026-08-20T12:00:00.000Z',
          gradingType: 'Numeric',
          id: assignmentRouteId,
          instructions: 'Do the thing',
          isGradedAssignment: true,
          resources: [
            { id: 'r1', name: 'worksheet.pdf', objectPath: 'worksheet-object' },
            { id: 'r2', name: 'notes.pdf', objectPath: 'notes-object' },
          ],
          rubrics: [],
          studentStatus: 'pending',
          subjectId: 'subject-1',
          title: 'Homework',
        }),
      } as unknown as AssignmentsRepository,
    });

    const detail = await service.getForStudent({ schoolId, userId: studentId }, assignmentRouteId);

    expect(detail.resources).toEqual([
      { id: 'r1', name: 'worksheet.pdf', signedUrl: 'https://signed.example/worksheet-object' },
      { id: 'r2', name: 'notes.pdf', signedUrl: 'https://signed.example/notes-object' },
    ]);
    expect(detail.bannerUrl).toBe('https://signed.example/banner-object');
    // A 900-second read lifetime, the same one every academic file gets.
    expect(createReadUrl).toHaveBeenCalledWith('academic-files', 'worksheet-object', 900);
  });

  it('reports a second banner as a conflict rather than a 500', async () => {
    const service = createAssignmentsService({
      cache: { invalidateStudentAssignments: vi.fn() },
      files: {
        createReadUrl: vi.fn().mockResolvedValue('https://signed.example/x'),
        finalizeUpload: vi.fn(),
        prepareUpload: vi.fn().mockResolvedValue({
          contentType: 'image/png',
          displayName: 'header.png',
          id: uploadSessionId,
          objectPath: 'banner-object',
        }),
      } as unknown as AcademicFilePort,
      mutations: passthroughMutations(),
      outbox: { write: vi.fn(), writeInTransaction: vi.fn() },
      repository: {
        canManage: vi.fn().mockResolvedValue(true),
        insertResource: vi.fn().mockResolvedValue('banner_taken'),
        listStudentIdsForAssignment: vi.fn().mockResolvedValue([]),
      } as unknown as AssignmentsRepository,
    });

    await expect(service.confirmResource(
      identity, assignmentRouteId, uploadSessionId, 'banner-conflict-1', 'banner',
    )).rejects.toMatchObject({ status: 409 });
  });

  it('refuses a banner whose stored upload is not an image, whatever the request claimed', async () => {
    const insertResource = vi.fn();
    const service = createAssignmentsService({
      cache: { invalidateStudentAssignments: vi.fn() },
      files: {
        finalizeUpload: vi.fn(),
        // The session is what the storage layer actually signed — a PDF.
        prepareUpload: vi.fn().mockResolvedValue({
          contentType: 'application/pdf',
          displayName: 'header.pdf',
          id: uploadSessionId,
          objectPath: 'banner-object',
        }),
      } as unknown as AcademicFilePort,
      mutations: passthroughMutations(),
      outbox: { write: vi.fn(), writeInTransaction: vi.fn() },
      repository: {
        canManage: vi.fn().mockResolvedValue(true),
        insertResource,
        listStudentIdsForAssignment: vi.fn().mockResolvedValue([]),
      } as unknown as AssignmentsRepository,
    });

    await expect(service.confirmResource(
      identity, assignmentRouteId, uploadSessionId, 'banner-mismatch-1', 'banner',
    )).rejects.toMatchObject({ status: 400 });
    expect(insertResource).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────── bulk and per-student completion

describe('bulk mark-as-done', () => {
  it('accepts the shipped route and the teacher-prefixed alias', async () => {
    const service = createService();
    vi.mocked(service.bulkSetCompletion).mockResolvedValue({ completed: 3, scope: 'all' });
    const app = createTestApp(service, { role: 'teacher', userId: teacherId });

    const shipped = await request(app)
      .post(`/assignments/${assignmentRouteId}/completions/bulk`)
      .send({ scope: 'all' }).expect(200);
    await request(app)
      .post(`/teacher/assignments/${assignmentRouteId}/completions/bulk`)
      .send({ scope: 'submitted' }).expect(200);

    expect(shipped.body).toEqual({ completed: 3, scope: 'all' });
    expect(service.bulkSetCompletion).toHaveBeenNthCalledWith(1, identity, assignmentRouteId, 'all');
    expect(service.bulkSetCompletion).toHaveBeenNthCalledWith(2, identity, assignmentRouteId, 'submitted');
  });

  it('rejects an unknown scope and a missing one', async () => {
    const service = createService();
    const app = createTestApp(service, { role: 'teacher', userId: teacherId });

    await request(app).post(`/assignments/${assignmentRouteId}/completions/bulk`)
      .send({ scope: 'everyone' }).expect(400);
    await request(app).post(`/assignments/${assignmentRouteId}/completions/bulk`)
      .send({}).expect(400);

    expect(service.bulkSetCompletion).not.toHaveBeenCalled();
  });

  it('forbids a student from marking a class done', async () => {
    const service = createService();
    const app = createTestApp(service, { role: 'student', userId: studentId });

    await request(app).post(`/assignments/${assignmentRouteId}/completions/bulk`)
      .send({ scope: 'all' }).expect(403);

    expect(service.bulkSetCompletion).not.toHaveBeenCalled();
  });

  it('restricts scope=submitted to students who actually submitted, and guards the student role', async () => {
    const queries: string[] = [];
    let queryCount = 0;
    const callback: RemoteCallback = async (query) => {
      queries.push(query);
      queryCount += 1;
      // First query is findManaged; second is the upsert.
      return queryCount === 1
        ? { rows: [[
          'class-1', new Date(), null, 'ASG-2026-003', new Date(), 'Numeric',
          assignmentRouteId, 'Do the thing', true, 10, schoolId, 'subject-1', teacherId,
          'Homework', new Date(),
        ]] }
        : { rows: [{ studentId }] };
    };
    const repository = new DrizzleAssignmentsRepository(
      databaseWithTransaction(callback),
    );

    const outcome = await repository.bulkSetCompletion(
      identity, assignmentRouteId, 'submitted', new Date('2026-08-21T09:00:00.000Z'),
    );

    expect(outcome).toEqual({ studentIds: [studentId] });
    const upsert = queries.at(-1) ?? '';
    expect(upsert).toContain('insert into public.assignment_submissions');
    // Only students with a durable submission are in scope.
    expect(upsert).toContain('submitted.submitted_at is not null');
    // The class teacher holds an active class_members row of their own.
    expect(upsert).toContain("student_role.role = 'student'");
    expect(upsert).toContain('student_role.is_active');
    // Duplicated roster rows must not present the same pair twice.
    expect(upsert).toContain('select distinct');
    // Replaying a completion preserves the first instant.
    expect(upsert).toContain('coalesce');
  });

  it('is a 404 when the assignment is not this teacher\'s to manage', async () => {
    const repository = new DrizzleAssignmentsRepository(
      databaseWithTransaction(async () => ({ rows: [] })),
    );

    await expect(repository.bulkSetCompletion(
      identity, assignmentRouteId, 'all', new Date(),
    )).resolves.toBeUndefined();
  });
});

describe('per-student completion accepts both spellings', () => {
  it('reads completed: false as an un-complete', async () => {
    const service = createService();
    vi.mocked(service.setStudentCompletion).mockResolvedValue({
      completedAt: null, id: submissionRouteId,
    });
    const app = createTestApp(service, { role: 'teacher', userId: teacherId });

    await request(app)
      .put(`/teacher/assignments/${assignmentRouteId}/students/${studentId}/completion`)
      .send({ completed: false }).expect(200);

    expect(service.setStudentCompletion).toHaveBeenCalledWith(
      identity, assignmentRouteId, studentId, 'incomplete',
    );
  });

  it('reads completed: true as a complete, and still reads the original action form', async () => {
    const service = createService();
    vi.mocked(service.setStudentCompletion).mockResolvedValue({
      completedAt: '2026-08-21T09:00:00.000Z', id: submissionRouteId,
    });
    const app = createTestApp(service, { role: 'teacher', userId: teacherId });

    await request(app)
      .put(`/teacher/assignments/${assignmentRouteId}/students/${studentId}/completion`)
      .send({ completed: true }).expect(200);
    await request(app)
      .put(`/teacher/assignments/${assignmentRouteId}/students/${studentId}/completion`)
      .send({ action: 'incomplete' }).expect(200);

    expect(vi.mocked(service.setStudentCompletion).mock.calls[0]?.[3]).toBe('complete');
    expect(vi.mocked(service.setStudentCompletion).mock.calls[1]?.[3]).toBe('incomplete');
  });

  it('rejects a body that states neither form, or smuggles its own completedAt', async () => {
    const service = createService();
    const app = createTestApp(service, { role: 'teacher', userId: teacherId });

    await request(app)
      .put(`/teacher/assignments/${assignmentRouteId}/students/${studentId}/completion`)
      .send({}).expect(400);
    await request(app)
      .put(`/teacher/assignments/${assignmentRouteId}/students/${studentId}/completion`)
      .send({ completed: true, completedAt: '1999-01-01T00:00:00.000Z' }).expect(400);

    expect(service.setStudentCompletion).not.toHaveBeenCalled();
  });

  // The staleness this wave was reported for: the student kept reading their
  // old status after the teacher ticked them off.
  it('invalidates the marked student\'s cached assignment list on every completion write', async () => {
    const invalidateStudentAssignments = vi.fn();
    const service = createAssignmentsService({
      cache: { invalidateStudentAssignments },
      files: {} as unknown as AcademicFilePort,
      mutations: passthroughMutations(),
      outbox: { write: vi.fn(), writeInTransaction: vi.fn() },
      repository: {
        bulkSetCompletion: vi.fn().mockResolvedValue({ studentIds: [studentId, 'student-2'] }),
        setStudentCompletion: vi.fn().mockResolvedValue({
          assignmentId: assignmentRouteId,
          completedAt: '2026-08-21T09:00:00.000Z',
          id: submissionRouteId,
          studentId,
        }),
        setSubmissionCompletion: vi.fn().mockResolvedValue({
          assignmentId: assignmentRouteId,
          completedAt: null,
          id: submissionRouteId,
          studentId,
        }),
      } as unknown as AssignmentsRepository,
    });

    await service.setStudentCompletion(identity, assignmentRouteId, studentId, 'complete');
    await service.setCompletion(identity, submissionRouteId, 'incomplete');
    await service.bulkSetCompletion(identity, assignmentRouteId, 'all');

    expect(invalidateStudentAssignments).toHaveBeenCalledTimes(4);
    expect(invalidateStudentAssignments).toHaveBeenCalledWith({
      assignmentId: assignmentRouteId, schoolId, studentId,
    });
    expect(invalidateStudentAssignments).toHaveBeenCalledWith({
      assignmentId: assignmentRouteId, schoolId, studentId: 'student-2',
    });
  });

  it('reports the number of roster rows a bulk write landed on', async () => {
    const service = createAssignmentsService({
      cache: { invalidateStudentAssignments: vi.fn() },
      files: {} as unknown as AcademicFilePort,
      mutations: passthroughMutations(),
      outbox: { write: vi.fn(), writeInTransaction: vi.fn() },
      repository: {
        bulkSetCompletion: vi.fn().mockResolvedValue({ studentIds: [studentId, 'b', 'c'] }),
      } as unknown as AssignmentsRepository,
    });

    await expect(service.bulkSetCompletion(identity, assignmentRouteId, 'submitted'))
      .resolves.toEqual({ completed: 3, scope: 'submitted' });
  });
});

// ───────────────────────────────────────────────── submitting with no file

describe('attachment-free submission', () => {
  it('routes POST /student/assignments/:id/submission and returns 201', async () => {
    const service = createService();
    const submission = {
      completedAt: null,
      id: submissionRouteId,
      studentId,
      studentName: 'Asha Patel',
      submittedAt: '2026-08-21T09:00:00.000Z',
    };
    vi.mocked(service.submitWithoutFile).mockResolvedValue(submission);
    const app = createTestApp(service, { role: 'student', userId: studentId });

    const response = await request(app)
      .post(`/student/assignments/${assignmentRouteId}/submission`)
      .set('Idempotency-Key', 'fileless-1')
      .send({})
      .expect(201);

    expect(response.body).toEqual(submission);
    expect(service.submitWithoutFile).toHaveBeenCalledWith(
      { schoolId, userId: studentId }, assignmentRouteId, 'fileless-1',
    );
  });

  it('does not shadow the upload-session and confirm routes', async () => {
    const service = createService();
    const app = createTestApp(service, { role: 'student', userId: studentId });

    await request(app)
      .post(`/student/assignments/${assignmentRouteId}/submission/upload-sessions`)
      .set('Idempotency-Key', 'still-routed-1')
      .send({ contentType: 'application/pdf', displayName: 'work.pdf', sizeBytes: 512 })
      .expect(201);
    await request(app)
      .post(`/student/assignments/${assignmentRouteId}/submission/confirm`)
      .set('Idempotency-Key', 'still-routed-2')
      .send({ uploadSessionId })
      .expect(201);

    expect(service.createSubmissionUploadSession).toHaveBeenCalledOnce();
    expect(service.confirmSubmission).toHaveBeenCalledOnce();
    expect(service.submitWithoutFile).not.toHaveBeenCalled();
  });

  it('requires an Idempotency-Key, and forbids a teacher', async () => {
    const service = createService();
    const studentApp = createTestApp(service, { role: 'student', userId: studentId });
    const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });

    await request(studentApp)
      .post(`/student/assignments/${assignmentRouteId}/submission`).send({}).expect(400);
    await request(teacherApp)
      .post(`/student/assignments/${assignmentRouteId}/submission`)
      .set('Idempotency-Key', 'fileless-teacher').send({}).expect(403);

    expect(service.submitWithoutFile).not.toHaveBeenCalled();
  });

  // A device cannot be redeployed as fast as this server, so an extra key is
  // stripped rather than rejected — and a smuggled instant never reaches the
  // service, which is the only reason strictness was wanted in the first place.
  it('tolerates a missing body and an unknown key, without trusting a client clock', async () => {
    const service = createService();
    vi.mocked(service.submitWithoutFile).mockResolvedValue({
      completedAt: null, id: submissionRouteId, studentId, studentName: 'Asha Patel',
      submittedAt: '2026-08-21T09:00:00.000Z',
    });
    const app = createTestApp(service, { role: 'student', userId: studentId });

    await request(app).post(`/student/assignments/${assignmentRouteId}/submission`)
      .set('Idempotency-Key', 'fileless-nobody').expect(201);
    await request(app).post(`/student/assignments/${assignmentRouteId}/submission`)
      .set('Idempotency-Key', 'fileless-extra')
      .send({ submittedAt: '1999-01-01T00:00:00.000Z', note: 'hi' }).expect(201);

    // Three arguments only — nothing from the body reaches the service.
    expect(vi.mocked(service.submitWithoutFile).mock.calls[1]).toEqual([
      { schoolId, userId: studentId }, assignmentRouteId, 'fileless-extra',
    ]);
  });

  it('coalesces a re-submit instead of moving the first instant, and keeps any file', async () => {
    const queries: string[] = [];
    const repository = new DrizzleAssignmentsRepository(
      drizzle(async (query) => {
        queries.push(query);
        return {
          rows: [{
            assignmentId: assignmentRouteId,
            completedAt: null,
            feedback: null,
            gradedAt: null,
            id: submissionRouteId,
            justSubmitted: false,
            letterGrade: null,
            marks: null,
            objectPath: 'existing-object',
            studentId,
            studentName: 'Asha Patel',
            submittedAt: '2026-08-20 09:00:00+00',
          }],
        };
      }) as unknown as Database,
    );

    const outcome = await repository.submitWithoutFile(
      { schoolId, userId: studentId },
      assignmentRouteId,
      new Date('2026-08-21T09:00:00.000Z'),
    );

    // The stored instant wins over the one this call offered.
    expect(outcome?.submission.submittedAt).toBe('2026-08-20T09:00:00.000Z');
    expect(outcome?.justSubmitted).toBe(false);
    // A student who had already uploaded keeps the file.
    expect(outcome?.submission.objectPath).toBe('existing-object');

    const upsert = queries[0] ?? '';
    expect(upsert).toContain('insert into public.assignment_submissions');
    expect(upsert).toContain('coalesce');
    // The class-membership guard the upload path uses, applied here too.
    expect(upsert).toContain('class_members');
    expect(upsert).toContain('member.is_active');
    expect(upsert).toContain('assignment.deleted_at is null');
    // Nothing in this statement clears the file triple.
    expect(upsert).not.toContain('object_path = null');
  });

  it('announces a genuinely new submission and stays quiet on a replay', async () => {
    async function submitWith(justSubmitted: boolean) {
      const writeInTransaction = vi.fn();
      const invalidateStudentAssignments = vi.fn();
      const service = createAssignmentsService({
        cache: { invalidateStudentAssignments },
        files: {} as unknown as AcademicFilePort,
        mutations: passthroughMutations(),
        outbox: { write: vi.fn(), writeInTransaction },
        repository: {
          submitWithoutFile: vi.fn().mockResolvedValue({
            justSubmitted,
            submission: {
              assignmentId: assignmentRouteId,
              completedAt: null,
              id: submissionRouteId,
              studentId,
              studentName: 'Asha Patel',
              submittedAt: '2026-08-21T09:00:00.000Z',
            },
          }),
          withTransaction: async (
            work: (repo: unknown, transaction: unknown) => Promise<unknown>,
          ) => work({
            submitWithoutFile: vi.fn().mockResolvedValue({
              justSubmitted,
              submission: {
                assignmentId: assignmentRouteId,
                completedAt: null,
                id: submissionRouteId,
                studentId,
                studentName: 'Asha Patel',
                submittedAt: '2026-08-21T09:00:00.000Z',
              },
            }),
          }, {}),
        } as unknown as AssignmentsRepository,
      });

      const body = await service.submitWithoutFile(
        { schoolId, userId: studentId }, assignmentRouteId, 'fileless-outbox',
      );
      return { body, invalidateStudentAssignments, writeInTransaction };
    }

    const fresh = await submitWith(true);
    const replay = await submitWith(false);

    expect(fresh.writeInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      { schoolId, userId: studentId },
      expect.objectContaining({ eventType: 'assignment.submitted' }),
    );
    expect(replay.writeInTransaction).not.toHaveBeenCalled();
    // Either way the student's cached list is dropped — the row changed state
    // the first time, and re-reading is harmless the second.
    expect(fresh.invalidateStudentAssignments).toHaveBeenCalledWith({
      assignmentId: assignmentRouteId, schoolId, studentId,
    });
    expect(replay.invalidateStudentAssignments).toHaveBeenCalledOnce();
    // The same shape the confirm path returns.
    expect(fresh.body).toMatchObject({
      completedAt: null,
      id: submissionRouteId,
      studentId,
      studentName: 'Asha Patel',
      submittedAt: '2026-08-21T09:00:00.000Z',
    });
  });

  it('is a 404 for an assignment the student is not an active member of', async () => {
    const service = createAssignmentsService({
      cache: { invalidateStudentAssignments: vi.fn() },
      files: {} as unknown as AcademicFilePort,
      mutations: passthroughMutations(),
      outbox: { write: vi.fn(), writeInTransaction: vi.fn() },
      repository: {
        withTransaction: async (
          work: (repo: unknown, transaction: unknown) => Promise<unknown>,
        ) => work({ submitWithoutFile: vi.fn().mockResolvedValue(undefined) }, {}),
      } as unknown as AssignmentsRepository,
    });

    await expect(service.submitWithoutFile(
      { schoolId, userId: studentId }, assignmentRouteId, 'fileless-404',
    )).rejects.toMatchObject({ status: 404 });
  });
});

// ─────────────────────────────────────────── per-student status on the list

describe('studentStatus on the student assignment list', () => {
  function listRow(overrides: {
    completedAt: Date | null;
    submittedAt: Date | null;
  }) {
    return [
      new Date('2026-08-01T08:00:00.000Z'), // assignedAt
      overrides.completedAt,                // completedAt
      new Date('2026-08-20T12:00:00.000Z'), // dueAt
      null,                                 // gradedAt
      'Numeric',                            // gradingType
      assignmentRouteId,                    // id
      true,                                 // isGraded
      null,                                 // letterGrade
      null,                                 // marks
      schoolId,                             // schoolId
      'subject-1',                          // subjectId
      'Mathematics',                        // subjectName
      overrides.submittedAt,                // submittedAt
      'Homework',                           // title
    ];
  }

  async function statusFor(overrides: {
    completedAt: Date | null;
    submittedAt: Date | null;
  }) {
    const repository = new DrizzleAssignmentsRepository(
      drizzle(async () => ({ rows: [listRow(overrides)] })) as unknown as Database,
    );
    const page = await repository.listForStudent(
      { schoolId, userId: studentId }, { limit: 20 }, new Date('2026-08-01T00:00:00.000Z'),
    );
    return page.items[0]?.studentStatus;
  }

  it('is pending with no submission and no completion', async () => {
    await expect(statusFor({ completedAt: null, submittedAt: null })).resolves.toBe('pending');
  });

  it('is submitted once the student has handed something in', async () => {
    await expect(statusFor({
      completedAt: null,
      submittedAt: new Date('2026-08-10T09:00:00.000Z'),
    })).resolves.toBe('submitted');
  });

  // The client stopped sending `status`, so one page has to span every state.
  it('applies no submission-state filter when status is omitted', async () => {
    const queries: string[] = [];
    const repository = new DrizzleAssignmentsRepository(
      drizzle(async (query) => {
        queries.push(query);
        return { rows: [] };
      }) as unknown as Database,
    );

    await repository.listForStudent(
      { schoolId, userId: studentId }, { limit: 50 }, new Date('2026-08-01T00:00:00.000Z'),
    );
    const unfiltered = queries[0] ?? '';

    await repository.listForStudent(
      { schoolId, userId: studentId },
      { limit: 50, status: 'submitted' },
      new Date('2026-08-01T00:00:00.000Z'),
    );
    const filtered = queries[1] ?? '';

    // The filtered read constrains submitted_at/graded_at; the unfiltered one
    // must not, or a submitted assignment would vanish from the single page the
    // client now asks for.
    expect(filtered).toContain('"submitted_at" is not null');
    expect(unfiltered).not.toContain('"submitted_at" is not null');
    expect(unfiltered).not.toContain('"graded_at" is not null');
    expect(unfiltered).not.toContain('"submitted_at" is null');
    // The audience and tenancy guards are still there.
    expect(unfiltered).toContain('class_members');
    expect(unfiltered).toContain('"deleted_at" is null');
  });

  it('carries completedAt beside studentStatus, for a client that reads the timestamp', async () => {
    const repository = new DrizzleAssignmentsRepository(
      drizzle(async () => ({
        rows: [listRow({
          completedAt: new Date('2026-08-11T09:00:00.000Z'),
          submittedAt: new Date('2026-08-10T09:00:00.000Z'),
        })],
      })) as unknown as Database,
    );

    const page = await repository.listForStudent(
      { schoolId, userId: studentId }, { limit: 20 }, new Date('2026-08-01T00:00:00.000Z'),
    );

    expect(page.items[0]?.completedAt).toBe('2026-08-11T09:00:00.000Z');
    expect(page.items[0]?.studentStatus).toBe('completed');
  });

  it('omits completedAt when the teacher has not marked the student done', async () => {
    const repository = new DrizzleAssignmentsRepository(
      drizzle(async () => ({
        rows: [listRow({ completedAt: null, submittedAt: null })],
      })) as unknown as Database,
    );

    const page = await repository.listForStudent(
      { schoolId, userId: studentId }, { limit: 20 }, new Date('2026-08-01T00:00:00.000Z'),
    );

    expect(page.items[0]).not.toHaveProperty('completedAt');
  });

  it('is completed once the teacher marks the student done, submission or not', async () => {
    await expect(statusFor({
      completedAt: new Date('2026-08-11T09:00:00.000Z'),
      submittedAt: new Date('2026-08-10T09:00:00.000Z'),
    })).resolves.toBe('completed');
    // Completion is reachable without any upload at all.
    await expect(statusFor({
      completedAt: new Date('2026-08-11T09:00:00.000Z'),
      submittedAt: null,
    })).resolves.toBe('completed');
  });
});

// ──────────────────────────────────────────────────── alphabetic grading

describe('alphabetic grading', () => {
  it('carries the grading scheme and the letter options on every submission row', async () => {
    let queryCount = 0;
    const callback: RemoteCallback = async () => {
      queryCount += 1;
      return queryCount === 1
        ? { rows: [[
          'class-1', new Date(), null, 'ASG-2026-004', new Date(), 'Alphabetic',
          assignmentRouteId, 'Do the thing', true, null, schoolId, 'subject-1', teacherId,
          'Essay', new Date(),
        ]] }
        : { rows: [[
          assignmentRouteId,                    // assignmentId
          null,                                 // completedAt
          null,                                 // feedback
          null,                                 // fileName
          new Date('2026-08-12T09:00:00.000Z'), // gradedAt
          submissionRouteId,                    // id
          'B+',                                 // letterGrade
          null,                                 // marks
          null,                                 // objectPath
          studentId,                            // studentId
          'Asha Patel',                         // studentName
          new Date('2026-08-10T09:00:00.000Z'), // submittedAt
        ]] };
    };
    const repository = new DrizzleAssignmentsRepository(
      drizzle(callback) as unknown as Database,
    );

    const page = await repository.listSubmissions(identity, assignmentRouteId, { limit: 20 });

    const row = page?.items[0];
    expect(row?.gradingType).toBe('Alphabetic');
    expect(row?.letterGrade).toBe('B+');
    expect(row?.letterGradeOptions).toEqual(['A+', 'A', 'B+', 'B', 'C+', 'C', 'D', 'E', 'F']);
    // An alphabetic assignment has no maximum — the client must read
    // gradingType rather than divide by a maxMarks that was never there.
    expect(row?.maxMarks).toBeUndefined();
    // Timestamps survive whichever shape the driver produced.
    expect(row?.submittedAt).toBe('2026-08-10T09:00:00.000Z');
    expect(row?.gradedAt).toBe('2026-08-12T09:00:00.000Z');
  });

  it('tolerates raw-SQL string timestamps on a submission row', async () => {
    let queryCount = 0;
    const callback: RemoteCallback = async () => {
      queryCount += 1;
      return queryCount === 1
        ? { rows: [[
          'class-1', new Date(), null, 'ASG-2026-005', new Date(), 'Numeric',
          assignmentRouteId, 'Do the thing', true, 35, schoolId, 'subject-1', teacherId,
          'Homework', new Date(),
        ]] }
        : { rows: [[
          assignmentRouteId, null, null, null,
          '2026-08-12 09:00:00+00',           // gradedAt as a driver string
          submissionRouteId, null, 30, null, studentId, 'Asha Patel',
          '2026-08-10 09:00:00+00',           // submittedAt as a driver string
        ]] };
    };
    const repository = new DrizzleAssignmentsRepository(
      drizzle(callback) as unknown as Database,
    );

    const page = await repository.listSubmissions(identity, assignmentRouteId, { limit: 20 });

    expect(page?.items[0]?.submittedAt).toBe('2026-08-10T09:00:00.000Z');
    expect(page?.items[0]?.gradedAt).toBe('2026-08-12T09:00:00.000Z');
    expect(page?.items[0]?.maxMarks).toBe(35);
    expect(page?.items[0]?.gradingType).toBe('Numeric');
  });

  it('accepts a letter grade on an alphabetic assignment', async () => {
    const grade = vi.fn().mockResolvedValue({
      assignmentId: assignmentRouteId,
      completedAt: null,
      gradedAt: '2026-08-12T09:00:00.000Z',
      id: submissionRouteId,
      letterGrade: 'A',
      studentId,
      studentName: 'Asha Patel',
      submittedAt: '2026-08-10T09:00:00.000Z',
    });
    const service = createAssignmentsService({
      cache: { invalidateStudentAssignments: vi.fn() },
      files: {} as unknown as AcademicFilePort,
      mutations: passthroughMutations(),
      outbox: { write: vi.fn(), writeInTransaction: vi.fn() },
      repository: {
        findGradeableSubmission: vi.fn().mockResolvedValue({
          assignmentId: assignmentRouteId, gradingType: 'Alphabetic', studentId,
        }),
        grade,
        withTransaction: async (
          work: (repo: unknown, transaction: unknown) => Promise<unknown>,
        ) => work({
          findGradeableSubmission: vi.fn().mockResolvedValue({
            assignmentId: assignmentRouteId, gradingType: 'Alphabetic', studentId,
          }),
          grade,
        }, {}),
      } as unknown as AssignmentsRepository,
    });

    const graded = await service.grade(
      identity, submissionRouteId, { letterGrade: 'A' }, 'grade-alpha-1',
    );

    expect(graded.letterGrade).toBe('A');
    expect(grade).toHaveBeenCalledWith(
      identity, submissionRouteId, { letterGrade: 'A' }, expect.any(Date),
    );
  });

  it('refuses numeric marks on an alphabetic assignment and a letter on a numeric one', async () => {
    function serviceFor(gradingType: 'Alphabetic' | 'Numeric', maxMarks?: number) {
      const gradeable = {
        assignmentId: assignmentRouteId,
        gradingType,
        ...(maxMarks === undefined ? {} : { maxMarks }),
        studentId,
      };
      return createAssignmentsService({
        cache: { invalidateStudentAssignments: vi.fn() },
        files: {} as unknown as AcademicFilePort,
        mutations: passthroughMutations(),
        outbox: { write: vi.fn(), writeInTransaction: vi.fn() },
        repository: {
          withTransaction: async (
            work: (repo: unknown, transaction: unknown) => Promise<unknown>,
          ) => work({
            findGradeableSubmission: vi.fn().mockResolvedValue(gradeable),
            grade: vi.fn(),
          }, {}),
        } as unknown as AssignmentsRepository,
      });
    }

    await expect(serviceFor('Alphabetic').grade(
      identity, submissionRouteId, { marks: 8 }, 'grade-mismatch-1',
    )).rejects.toMatchObject({ status: 400 });
    await expect(serviceFor('Numeric', 10).grade(
      identity, submissionRouteId, { letterGrade: 'A' }, 'grade-mismatch-2',
    )).rejects.toMatchObject({ status: 400 });
  });

  it('rejects a grade body that states both a mark and a letter, or neither', async () => {
    const service = createService();
    const app = createTestApp(service, { role: 'teacher', userId: teacherId });

    await request(app).put(`/teacher/submissions/${submissionRouteId}/grade`)
      .set('Idempotency-Key', 'grade-both-1').send({ letterGrade: 'A', marks: 8 }).expect(400);
    await request(app).put(`/teacher/submissions/${submissionRouteId}/grade`)
      .set('Idempotency-Key', 'grade-neither-1').send({}).expect(400);
    await request(app).put(`/teacher/submissions/${submissionRouteId}/grade`)
      .set('Idempotency-Key', 'grade-bogus-1').send({ letterGrade: 'Z' }).expect(400);

    expect(service.grade).not.toHaveBeenCalled();
  });

  it('writes exactly one of the two grade columns, so a re-grade cannot set both', async () => {
    async function updateFor(input: { letterGrade?: 'B'; marks?: number }) {
      const queries: string[] = [];
      const repository = new DrizzleAssignmentsRepository(
        drizzle(async (query) => {
          queries.push(query);
          return { rows: [] };
        }) as unknown as Database,
      );
      await repository.grade(
        identity, submissionRouteId, input, new Date('2026-08-12T09:00:00.000Z'),
      );
      return queries[0] ?? '';
    }

    const alphabetic = await updateFor({ letterGrade: 'B' });
    const numeric = await updateFor({ marks: 8 });

    // Both columns are always assigned — one to the value, one explicitly to
    // null — so re-grading across schemes cannot leave both set and trip the
    // grade shape check.
    for (const update of [alphabetic, numeric]) {
      expect(update).toContain('"marks" = ');
      expect(update).toContain('"letter_grade" = ');
      expect(update).toContain('"grading_type" = ');
    }
    // The authorization predicate branches on the scheme: only the numeric
    // branch bounds the value by the assignment's maximum, and an alphabetic
    // assignment has no maximum to bound it by.
    expect(numeric).toContain('max_marks');
    expect(alphabetic).not.toContain('max_marks');
  });
});
