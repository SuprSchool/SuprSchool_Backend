// T4 — assignment submission completion (Mark as Complete / Mark as Incomplete).
//
// Deliberately a separate file rather than an extension of
// `test/assignments.routes.test.ts`: Task 3 owns that file on its own branch, so
// keeping this slice self-contained keeps the merge surface to the few
// production files both slices touch.
//
// Frames 668:4935 (Mark as Complete) / 668:4886 (Mark as Incomplete) and
// 667:3525 (the Mark as Done footer) all sit on `classes/submission.tsx`, the
// assignment submissions screen — so completion lives on
// `public.assignment_submissions`, beside grading and independent of it.
import { readFileSync } from 'node:fs';
import { drizzle, type RemoteCallback } from 'drizzle-orm/pg-proxy';
import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../src/db/client.js';
import { DrizzleAssignmentsRepository } from '../src/db/repositories/assignments.repository.js';
import type { AuthenticationMiddleware } from '../src/middleware/authenticate.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { createAssignmentsRouter } from '../src/routes/assignments.routes.js';
import type { AssignmentsService } from '../src/services/assignments.service.js';
import type { AssignmentIdentity } from '../src/types/assignments.js';

const schoolId = '11111111-1111-4111-8111-111111111111';
const studentId = '22222222-2222-4222-8222-222222222222';
const teacherId = '44444444-4444-4444-8444-444444444444';
const submissionRouteId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const completedAt = '2026-08-10T05:00:00.000Z';
const identity: AssignmentIdentity = { schoolId, userId: teacherId };

function createService(): AssignmentsService {
  return {
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
    update: vi.fn(),
  };
}

function createAuthenticatedRequest(
  who: { role: 'student' | 'teacher'; userId: string },
): AuthenticationMiddleware {
  return async (requestValue: Request, _response: Response, next): Promise<void> => {
    requestValue.auth = { schoolId, ...who };
    next();
  };
}

function createTestApp(
  service: AssignmentsService,
  who: { role: 'student' | 'teacher'; userId: string },
) {
  const app = express();
  app.use(express.json());
  app.use('/', createAssignmentsRouter(service, createAuthenticatedRequest(who)));
  app.use(errorHandler);
  return app;
}

function createQueryRecordingRepository() {
  const queries: string[] = [];
  const callback: RemoteCallback = async (query) => {
    queries.push(query);
    return { rows: [] };
  };
  const database = drizzle(callback) as unknown as Database;
  return { queries, repository: new DrizzleAssignmentsRepository(database) };
}

describe('assignment submission completion', () => {
  it('marks a submission complete', async () => {
    const service = createService();
    vi.mocked(service.setCompletion).mockResolvedValue({ id: submissionRouteId, completedAt });
    const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });

    const res = await request(teacherApp)
      .patch(`/teacher/submissions/${submissionRouteId}`)
      .send({ action: 'complete' });

    expect(res.status).toBe(200);
    expect(res.body.completedAt).not.toBeNull();
    expect(service.setCompletion).toHaveBeenCalledWith(identity, submissionRouteId, 'complete');
  });

  it('rejects an unknown action', async () => {
    const service = createService();
    const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });

    const res = await request(teacherApp)
      .patch(`/teacher/submissions/${submissionRouteId}`)
      .send({ action: 'archive' });

    expect(res.status).toBe(400);
    expect(service.setCompletion).not.toHaveBeenCalled();
  });

  it('clears completion and returns a null timestamp rather than omitting the field', async () => {
    const service = createService();
    vi.mocked(service.setCompletion).mockResolvedValue({ id: submissionRouteId, completedAt: null });
    const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });

    const res = await request(teacherApp)
      .patch(`/teacher/submissions/${submissionRouteId}`)
      .send({ action: 'incomplete' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: submissionRouteId, completedAt: null });
    expect(service.setCompletion).toHaveBeenCalledWith(identity, submissionRouteId, 'incomplete');
  });

  it('rejects a malformed submission ID and an unknown body key before the service is called', async () => {
    const service = createService();
    const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });

    await request(teacherApp).patch('/teacher/submissions/not-a-uuid')
      .send({ action: 'complete' }).expect(400);
    await request(teacherApp).patch(`/teacher/submissions/${submissionRouteId}`)
      .send({ action: 'complete', completedAt }).expect(400);

    expect(service.setCompletion).not.toHaveBeenCalled();
  });

  it('refuses completion to a student token', async () => {
    const service = createService();
    const studentApp = createTestApp(service, { role: 'student', userId: studentId });

    await request(studentApp).patch(`/teacher/submissions/${submissionRouteId}`)
      .send({ action: 'complete' }).expect(403);

    expect(service.setCompletion).not.toHaveBeenCalled();
  });

  it('does not require an idempotency key, because both directions are idempotent', async () => {
    const service = createService();
    vi.mocked(service.setCompletion).mockResolvedValue({ id: submissionRouteId, completedAt });
    const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });

    await request(teacherApp).patch(`/teacher/submissions/${submissionRouteId}`)
      .send({ action: 'complete' }).expect(200);
    await request(teacherApp).patch(`/teacher/submissions/${submissionRouteId}`)
      .send({ action: 'complete' }).expect(200);

    expect(service.setCompletion).toHaveBeenCalledTimes(2);
  });

  it('scopes the completion write to the school and the live teacher assignment', async () => {
    const { queries, repository } = createQueryRecordingRepository();

    await repository.setSubmissionCompletion(
      identity, submissionRouteId, 'complete', new Date(completedAt),
    );

    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('update "assignment_submissions"');
    expect(queries[0]).toContain('completed_at');
    expect(queries[0]).toContain('class_subjects');
    expect(queries[0]).toContain('assignments');
    expect(queries[0]).toContain('"deleted_at" is null');
  });

  it('keeps the first completion instant on replay and clears it on incomplete', async () => {
    const complete = createQueryRecordingRepository();
    await complete.repository.setSubmissionCompletion(
      identity, submissionRouteId, 'complete', new Date(completedAt),
    );
    const incomplete = createQueryRecordingRepository();
    await incomplete.repository.setSubmissionCompletion(
      identity, submissionRouteId, 'incomplete', new Date(completedAt),
    );

    expect(complete.queries[0]).toContain('coalesce');
    expect(incomplete.queries[0]).not.toContain('coalesce');
    expect(incomplete.queries[0]).toContain('completed_at');
  });

  it('does not make completion depend on grading', async () => {
    const { queries, repository } = createQueryRecordingRepository();

    await repository.setSubmissionCompletion(
      identity, submissionRouteId, 'complete', new Date(completedAt),
    );

    expect(queries[0]).not.toContain('graded_at');
    expect(queries[0]).not.toContain('marks');
    expect(queries[0]).not.toContain('grading_type');
  });

  // The teacher must be able to close out a student who never submitted, and
  // such a student has no `assignment_submissions` row to address — so the route
  // is keyed on the student and the row is created on demand.
  describe('completion addressed by student', () => {
    const assignmentRouteId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const path = `/teacher/assignments/${assignmentRouteId}/students/${studentId}/completion`;

    it('marks a student complete without requiring a submission', async () => {
      const service = createService();
      vi.mocked(service.setStudentCompletion)
        .mockResolvedValue({ id: submissionRouteId, completedAt });
      const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });

      const res = await request(teacherApp).put(path).send({ action: 'complete' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: submissionRouteId, completedAt });
      expect(service.setStudentCompletion)
        .toHaveBeenCalledWith(identity, assignmentRouteId, studentId, 'complete');
    });

    it('reopens a student and returns a null timestamp rather than omitting it', async () => {
      const service = createService();
      vi.mocked(service.setStudentCompletion)
        .mockResolvedValue({ id: submissionRouteId, completedAt: null });
      const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });

      const res = await request(teacherApp).put(path).send({ action: 'incomplete' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: submissionRouteId, completedAt: null });
    });

    it('rejects a bad action, a malformed student id and an unknown body key', async () => {
      const service = createService();
      const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });

      await request(teacherApp).put(path).send({ action: 'archive' }).expect(400);
      await request(teacherApp)
        .put(`/teacher/assignments/${assignmentRouteId}/students/not-a-uuid/completion`)
        .send({ action: 'complete' }).expect(400);
      await request(teacherApp).put(path).send({ action: 'complete', completedAt }).expect(400);

      expect(service.setStudentCompletion).not.toHaveBeenCalled();
    });

    it('refuses a student token', async () => {
      const service = createService();
      const studentApp = createTestApp(service, { role: 'student', userId: studentId });

      await request(studentApp).put(path).send({ action: 'complete' }).expect(403);

      expect(service.setStudentCompletion).not.toHaveBeenCalled();
    });

    it('upserts the row, scoped to the school, the owning teacher and an active roster seat', async () => {
      const { queries, repository } = createQueryRecordingRepository();

      await repository.setStudentCompletion(
        identity, assignmentRouteId, studentId, 'complete', new Date(completedAt),
      );

      expect(queries).toHaveLength(1);
      const [query] = queries as [string];
      expect(query).toContain('insert into public.assignment_submissions');
      expect(query).toContain('on conflict (assignment_id, student_id) do update');
      expect(query).toContain('class_members');
      expect(query).toContain('member.is_active');
      expect(query).toContain('class_subjects');
      expect(query).toContain('assignment.deleted_at is null');
    });

    it('never writes a mark or a fake upload while completing', async () => {
      const { queries, repository } = createQueryRecordingRepository();

      await repository.setStudentCompletion(
        identity, assignmentRouteId, studentId, 'complete', new Date(completedAt),
      );

      const [query] = queries as [string];
      expect(query).not.toContain('marks');
      expect(query).not.toContain('graded_at');
      expect(query).not.toContain('object_path');
      expect(query).not.toContain('submitted_at');
    });

    it('keeps the first instant on replay and clears it on incomplete', async () => {
      const complete = createQueryRecordingRepository();
      await complete.repository.setStudentCompletion(
        identity, assignmentRouteId, studentId, 'complete', new Date(completedAt),
      );
      const incomplete = createQueryRecordingRepository();
      await incomplete.repository.setStudentCompletion(
        identity, assignmentRouteId, studentId, 'incomplete', new Date(completedAt),
      );

      expect(complete.queries[0]).toContain('coalesce');
      expect(incomplete.queries[0]).not.toContain('coalesce');
      expect(incomplete.queries[0]).toContain('completed_at');
    });
  });

  it('migrates the completion column without disturbing the submission grant surface', () => {
    const source = readFileSync(
      new URL('../supabase/migrations/20260810040000_submission_completion.sql', import.meta.url),
      'utf8',
    );

    expect(source).toContain('alter table public.assignment_submissions');
    expect(source).toContain('add column if not exists completed_at timestamptz');
    expect(source).toContain('comment on column public.assignment_submissions.completed_at');
    expect(source).not.toContain('grant ');
    expect(source).not.toContain('policy');
  });
});
