import { readFileSync } from 'node:fs';
import { drizzle, type RemoteCallback } from 'drizzle-orm/pg-proxy';
import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { AcademicCache } from '../src/platform/academic/academic-cache.js';
import type { Database } from '../src/db/client.js';
import { DrizzleExamsRepository, type ExamsRepository } from '../src/db/repositories/exams.repository.js';
import type { AuthenticationMiddleware } from '../src/middleware/authenticate.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { createExamsRouter } from '../src/routes/exams.routes.js';
import { createExamsService, type ExamMutationPort, type ExamsService } from '../src/services/exams.service.js';
import type { ExamIdentity } from '../src/types/exams.js';

const schoolId = '11111111-1111-4111-8111-111111111111';
const studentId = '22222222-2222-4222-8222-222222222222';
const teacherId = '33333333-3333-4333-8333-333333333333';
const assessmentRouteId = '44444444-4444-4444-8444-444444444444';
const groupRouteId = '55555555-5555-4555-8555-555555555555';
const subjectRouteId = '77777777-7777-4777-8777-777777777777';

function createService(): ExamsService {
  return {
    confirmResource: vi.fn(),
    createAssessment: vi.fn(),
    createGroup: vi.fn(),
    createResourceUploadSession: vi.fn(),
    deleteAssessment: vi.fn(),
    deleteGroup: vi.fn(),
    getAssessmentForStudent: vi.fn(),
    getAssessmentForTeacher: vi.fn(),
    getGroupForStudent: vi.fn(),
    getLeaderboard: vi.fn(),
    listAssessmentsForTeacher: vi.fn(),
    listGroupsForStudent: vi.fn(),
    listGroupsForTeacher: vi.fn(),
    listSubmissions: vi.fn(),
    markSubmission: vi.fn(),
    listResults: vi.fn(),
    remindAll: vi.fn(),
    remindStudent: vi.fn(),
    publishAssessment: vi.fn(),
    publishResults: vi.fn(),
    updateAssessment: vi.fn(),
    updateGroup: vi.fn(),
    upsertResult: vi.fn(),
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
  service: ExamsService,
  identity: { role: 'student' | 'teacher'; userId: string },
) {
  const app = express();
  app.use(express.json());
  app.use('/', createExamsRouter(service, createAuthenticatedRequest(identity)));
  app.use(errorHandler);
  return app;
}

describe('exams router', () => {
  it('uses token student for leaderboard and ignores query classId', async () => {
    const service = createService();
    const studentApp = createTestApp(service, { role: 'student', userId: studentId });

    await request(studentApp).get('/student/exams/groups/' + groupRouteId + '/leaderboard?classId=attacker&limit=20')
      .expect(200);

    expect(service.getLeaderboard).toHaveBeenCalledWith(
      { schoolId, userId: studentId }, groupRouteId, { cursor: undefined, limit: 20 },
    );
  });

  it('passes authenticated teacher to result upsert', async () => {
    const service = createService();
    const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });

    await request(teacherApp).put('/teacher/exam-assessments/' + assessmentRouteId + '/results/' + studentId)
      .set('Idempotency-Key', 'exam-result-1').send({ marks: 72, feedback: 'Well done' })
      .expect(200);

    expect(service.upsertResult).toHaveBeenCalledWith(
      { schoolId, userId: teacherId }, assessmentRouteId, studentId,
      { marks: 72, feedback: 'Well done' }, 'exam-result-1',
    );
  });

  it('routes durable exam submission roster reads and teacher submission recording', async () => {
    const service = createService();
    const submittedAt = '2026-08-12T10:00:00.000Z';
    const submission = {
      id: '66666666-6666-4666-8666-666666666666', studentId, submittedAt,
    };
    vi.mocked(service.listSubmissions).mockResolvedValue({
      items: [{ rollNumber: 1, studentId, studentName: 'Submitted Student', submission }],
      submissionCount: 1,
      totalStudents: 1,
    });
    vi.mocked(service.markSubmission).mockResolvedValue(submission);
    const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });

    await request(teacherApp)
      .get(`/teacher/exam-assessments/${assessmentRouteId}/submissions`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items[0].submission.submittedAt).toBe(submittedAt);
        expect(body.items[0].result).toBeUndefined();
      });
    await request(teacherApp)
      .put(`/teacher/exam-assessments/${assessmentRouteId}/submissions/${studentId}`)
      .set('Idempotency-Key', 'exam-submission-record-1')
      .send({})
      .expect(200, submission);

    expect(service.listSubmissions).toHaveBeenCalledWith(
      { schoolId, userId: teacherId }, assessmentRouteId,
    );
    expect(service.markSubmission).toHaveBeenCalledWith(
      { schoolId, userId: teacherId }, assessmentRouteId, studentId,
      'exam-submission-record-1', {},
    );
  });

  it('hydrates a manageable assessment for the teacher edit screen', async () => {
    const service = createService();
    const detail = {
      endsAt: '10:00',
      id: assessmentRouteId,
      maxMarks: 100,
      resources: [],
      rubrics: [{ description: 'Complete working', marks: 100, position: 1, sectionTitle: 'Working' }],
      scheduledOn: '2026-08-12',
      startsAt: '09:00',
      subjectId: subjectRouteId,
      syllabus: 'Algebra and geometry',
      title: 'Mathematics Test',
    };
    vi.mocked(service.getAssessmentForTeacher).mockResolvedValue(detail);
    const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });

    await request(teacherApp).get(`/teacher/exam-assessments/${assessmentRouteId}`)
      .expect(200, detail);

    expect(service.getAssessmentForTeacher).toHaveBeenCalledWith(
      { schoolId, userId: teacherId }, assessmentRouteId,
    );
  });

  it('routes the complete teacher exam draft, edit, delete, and publish lifecycle', async () => {
    const service = createService();
    const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });

    await request(teacherApp).post(`/teacher/classes/${schoolId}/exam-groups`)
      .set('Idempotency-Key', 'exam-group-create')
      .send(groupInput)
      .expect(201);
    await request(teacherApp).patch(`/teacher/exam-groups/${groupRouteId}`)
      .set('Idempotency-Key', 'exam-group-update')
      .send(groupInput)
      .expect(200);
    await request(teacherApp).post(`/teacher/exam-groups/${groupRouteId}/assessments`)
      .set('Idempotency-Key', 'exam-assessment-create')
      .send(assessmentInput)
      .expect(201);
    await request(teacherApp).patch(`/teacher/exam-assessments/${assessmentRouteId}`)
      .set('Idempotency-Key', 'exam-assessment-update')
      .send(assessmentInput)
      .expect(200);
    await request(teacherApp).post(`/teacher/exam-assessments/${assessmentRouteId}/publish`)
      .set('Idempotency-Key', 'exam-assessment-publish')
      .send({})
      .expect(200);
    await request(teacherApp).post(`/teacher/exam-assessments/${assessmentRouteId}/results/publish`)
      .set('Idempotency-Key', 'exam-results-publish')
      .send({})
      .expect(200);
    await request(teacherApp).delete(`/teacher/exam-assessments/${assessmentRouteId}`)
      .set('Idempotency-Key', 'exam-assessment-delete')
      .expect(204);

    expect(service.createGroup).toHaveBeenCalledWith(
      { schoolId, userId: teacherId }, schoolId, groupInput, 'exam-group-create',
    );
    expect(service.updateGroup).toHaveBeenCalledWith(
      { schoolId, userId: teacherId }, groupRouteId, groupInput, 'exam-group-update',
    );
    expect(service.createAssessment).toHaveBeenCalledWith(
      { schoolId, userId: teacherId }, groupRouteId, assessmentInput, 'exam-assessment-create',
    );
    expect(service.updateAssessment).toHaveBeenCalledWith(
      { schoolId, userId: teacherId }, assessmentRouteId, assessmentInput, 'exam-assessment-update',
    );
    expect(service.publishAssessment).toHaveBeenCalledWith(
      { schoolId, userId: teacherId }, assessmentRouteId, 'exam-assessment-publish', {},
    );
    expect(service.publishResults).toHaveBeenCalledWith(
      { schoolId, userId: teacherId }, assessmentRouteId, 'exam-results-publish', {},
    );
    expect(service.deleteAssessment).toHaveBeenCalledWith(
      { schoolId, userId: teacherId }, assessmentRouteId, 'exam-assessment-delete',
    );
  });

  it('routes individual and all non-submitted exam reminders', async () => {
    const service = createService();
    vi.mocked(service.remindStudent).mockResolvedValue({ studentId });
    vi.mocked(service.remindAll).mockResolvedValue({ requested: 1 });
    const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });

    await request(teacherApp)
      .post(`/teacher/exam-assessments/${assessmentRouteId}/reminder/student/${studentId}`)
      .set('Idempotency-Key', 'exam-remind-student')
      .send({})
      .expect(202, { studentId });
    await request(teacherApp)
      .post(`/teacher/exam-assessments/${assessmentRouteId}/reminder/all`)
      .set('Idempotency-Key', 'exam-remind-all')
      .send({})
      .expect(202, { requested: 1 });

    expect(service.remindStudent).toHaveBeenCalledWith(
      { schoolId, userId: teacherId }, assessmentRouteId, studentId, 'exam-remind-student',
    );
    expect(service.remindAll).toHaveBeenCalledWith(
      { schoolId, userId: teacherId }, assessmentRouteId, 'exam-remind-all',
    );
  });

  it('forbids student publication', async () => {
    const service = createService();
    const studentApp = createTestApp(service, { role: 'student', userId: studentId });

    await request(studentApp).post('/teacher/exam-assessments/' + assessmentRouteId + '/publish')
      .set('Idempotency-Key', 'forbidden-publish-1').send({}).expect(403);
  });
  it('rejects malformed assessment resource IDs before a database-backed service can receive them', async () => {
    const service = createService();
    const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });

    await request(teacherApp).post('/teacher/exam-assessments/not-a-uuid/resources/upload-sessions')
      .set('Idempotency-Key', 'invalid-resource-parent')
      .send({ contentType: 'application/pdf', displayName: 'syllabus.pdf', sizeBytes: 256 })
      .expect(400);

    expect(service.createResourceUploadSession).not.toHaveBeenCalled();
  });

  it('rejects UUID fields and decoded cursors before the exam service is called', async () => {
    const service = createService();
    const studentApp = createTestApp(service, { role: 'student', userId: studentId });
    const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });
    const groupCursor = Buffer.from(JSON.stringify({ id: 'not-a-uuid', startsOn: '2026-07-01', v: 1 })).toString('base64url');
    const assessmentCursor = Buffer.from(JSON.stringify({ id: 'not-a-uuid', scheduledOn: '2026-07-20', v: 1 })).toString('base64url');
    const resultCursor = Buffer.from(JSON.stringify({ id: 'not-a-uuid', updatedAt: '2026-07-20T12:00:00.000Z', v: 1 })).toString('base64url');
    const leaderboardCursor = Buffer.from(JSON.stringify({ marks: 1, name: 'Student', studentId: 'not-a-uuid', v: 1 })).toString('base64url');

    await request(studentApp).get('/student/exams/groups?cursor=' + groupCursor).expect(400);
    await request(studentApp).get('/student/exams/groups/' + groupRouteId + '/leaderboard?cursor=' + leaderboardCursor).expect(400);
    await request(teacherApp).get('/teacher/classes/not-a-uuid/exam-groups').expect(400);
    await request(teacherApp).post('/teacher/exam-groups/' + groupRouteId + '/assessments')
      .set('Idempotency-Key', 'invalid-exam-subject')
      .send({ ...assessmentInput, subjectId: 'not-a-uuid' }).expect(400);
    await request(teacherApp).get('/teacher/exam-groups/' + groupRouteId + '/assessments?cursor=' + assessmentCursor).expect(400);
    await request(teacherApp).get('/teacher/exam-assessments/' + assessmentRouteId + '/results?cursor=' + resultCursor).expect(400);
    await request(teacherApp).put('/teacher/exam-assessments/' + assessmentRouteId + '/results/not-a-uuid')
      .set('Idempotency-Key', 'invalid-result-student')
      .send({ marks: 72 }).expect(400);

    expect(service.listGroupsForStudent).not.toHaveBeenCalled();
    expect(service.getLeaderboard).not.toHaveBeenCalled();
    expect(service.listGroupsForTeacher).not.toHaveBeenCalled();
    expect(service.createAssessment).not.toHaveBeenCalled();
    expect(service.listAssessmentsForTeacher).not.toHaveBeenCalled();
    expect(service.listResults).not.toHaveBeenCalled();
    expect(service.upsertResult).not.toHaveBeenCalled();
  });

  it('forwards immutable assessment resource metadata and a separate confirmation key', async () => {
    const service = createService();
    const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });
    const metadata = { contentType: 'application/pdf', displayName: 'syllabus.pdf', sizeBytes: 256 };

    await request(teacherApp).post(`/teacher/exam-assessments/${assessmentRouteId}/resources/upload-sessions`)
      .set('Idempotency-Key', 'exam-resource-create')
      .send(metadata)
      .expect(201);
    await request(teacherApp).post(`/teacher/exam-assessments/${assessmentRouteId}/resources/confirm`)
      .set('Idempotency-Key', 'exam-resource-confirm')
      .send({ uploadSessionId: '88888888-8888-4888-8888-888888888888' })
      .expect(201);

    expect(service.createResourceUploadSession).toHaveBeenCalledWith(
      { schoolId, userId: teacherId }, assessmentRouteId, metadata, 'exam-resource-create',
    );
    expect(service.confirmResource).toHaveBeenCalledWith(
      { schoolId, userId: teacherId }, assessmentRouteId,
      '88888888-8888-4888-8888-888888888888', 'exam-resource-confirm',
    );
  });
});

const examIdentity: ExamIdentity = { schoolId, userId: teacherId };
const groupInput = {
  endsOn: '2026-07-31',
  startsOn: '2026-07-01',
  title: 'Term one',
};
const assessmentInput = {
  endsAt: '10:00',
  maxMarks: 100,
  rubrics: [{ description: 'Working', marks: 100, position: 1, sectionTitle: 'Solutions' }],
  scheduledOn: '2026-07-20',
  startsAt: '09:00',
  subjectId: subjectRouteId,
  title: 'Mathematics',
};

function createQueryRecordingRepository() {
  const queries: string[] = [];
  const callback: RemoteCallback = async (query) => {
    queries.push(query);
    return { rows: [] };
  };
  const database = drizzle(callback) as unknown as Database;
  Object.assign(database, {
    transaction: async (work: (transaction: never) => Promise<unknown>) => work(database as never),
  });
  return {
    queries,
    repository: new DrizzleExamsRepository(database),
  };
}

function passthroughMutations(): ExamMutationPort {
  return {
    async execute<T>(_identity: ExamIdentity, input: { idempotencyKey: string; requestBody: unknown; successStatus: number; work: () => Promise<T> }) {
      return { body: await input.work(), replayed: false, status: input.successStatus };
    },
  };
}

describe('exam persistence hardening regressions', () => {
  it('puts live teacher assignment predicates in every decisive write', async () => {
    const group = createQueryRecordingRepository();
    await group.repository.createGroup(examIdentity, 'class-1', groupInput);
    expect(group.queries).toHaveLength(1);
    expect(group.queries[0]).toContain('insert into public.exam_groups');
    expect(group.queries[0]).toContain('class_subjects');

    const assessment = createQueryRecordingRepository();
    await assessment.repository.createAssessment(examIdentity, 'group-1', assessmentInput);
    expect(assessment.queries).toHaveLength(1);
    expect(assessment.queries[0]).toContain('insert into public.class_exams');
    expect(assessment.queries[0]).toContain('class_subjects');

    const result = createQueryRecordingRepository();
    await result.repository.upsertResult(
      examIdentity, 'assessment-1', studentId, { marks: 85 }, new Date('2026-07-13T00:00:00.000Z'),
    );
    expect(result.queries).toHaveLength(1);
    expect(result.queries[0]).toContain('insert into public.exam_results');
    expect(result.queries[0]).toContain('class_subjects');
    expect(result.queries[0]).toContain('class_members');
    expect(result.queries[0]).toContain('join public.exam_groups eg');
    expect(result.queries[0]).toContain('eg.deleted_at is null');

    const publication = createQueryRecordingRepository();
    await publication.repository.publishResults(
      examIdentity, 'assessment-1', new Date('2026-07-13T00:00:00.000Z'),
    );
    expect(publication.queries).toHaveLength(1);
    expect(publication.queries[0]).toContain('update public.exam_results');
    expect(publication.queries[0]).toContain('class_subjects');
    expect(publication.queries[0]).toContain('join public.exam_groups eg');
    expect(publication.queries[0]).toContain('eg.deleted_at is null');
  });

  it('creates an immutable revision instead of clearing a published result', async () => {
    const { queries, repository } = createQueryRecordingRepository();

    await repository.upsertResult(
      examIdentity, 'assessment-1', studentId, { feedback: 'Revised', marks: 90 },
      new Date('2026-07-13T00:00:00.000Z'),
    );

    expect(queries[0]).toContain('exam_result_revisions');
    expect(queries[0]).toContain('published_at is null');
    expect(queries[0]).not.toContain('published_at = null');
  });

  it('passes authenticated teacher identity into the atomic resource insert', async () => {
    const insertResource = vi.fn().mockResolvedValue({
      id: 'resource-1',
      name: 'syllabus.pdf',
      objectPath: 'exam/syllabus.pdf',
    });
    const service = createExamsService({
      files: {
        finalizeUpload: vi.fn(),
        prepareUpload: vi.fn().mockResolvedValue({
          contentType: 'application/pdf',
          displayName: 'syllabus.pdf',
          id: 'upload-1',
          objectPath: 'exam/syllabus.pdf',
        }),
        createReadUrl: vi.fn().mockResolvedValue('https://read.example/syllabus'),
        createUpload: vi.fn(),
      },
      mutations: passthroughMutations(),
      outbox: { write: vi.fn(), writeInTransaction: vi.fn() },
      repository: {
        canManageAssessment: vi.fn().mockResolvedValue(true),
        insertResource,
      } as unknown as ExamsRepository,
    });

    await service.confirmResource(examIdentity, 'assessment-1', 'upload-1', 'resource-confirm-1');

    expect(insertResource).toHaveBeenCalledWith(expect.objectContaining({ identity: examIdentity }));
  });

  it("leaves an exam upload cleanup-eligible when atomic resource insertion fails", async () => {
    const prepareUpload = vi.fn().mockResolvedValue({
      contentType: "application/pdf", displayName: "syllabus.pdf", id: "upload-1", objectPath: "exam/syllabus.pdf",
    });
    const finalizeUpload = vi.fn();
    const confirmUpload = vi.fn().mockResolvedValue({
      contentType: "application/pdf", displayName: "syllabus.pdf", id: "upload-1", objectPath: "exam/syllabus.pdf",
    });
    const service = createExamsService({
      files: { confirmUpload, createReadUrl: vi.fn(), createUpload: vi.fn(), finalizeUpload, prepareUpload } as never,
      mutations: passthroughMutations(),
      outbox: { write: vi.fn(), writeInTransaction: vi.fn() },
      repository: {
        canManageAssessment: vi.fn().mockResolvedValue(true),
        insertResource: vi.fn().mockResolvedValue(undefined),
      } as unknown as ExamsRepository,
    });

    await expect(service.confirmResource(examIdentity, "assessment-1", "upload-1", "resource-failure-1"))
      .rejects.toMatchObject({ status: 404 });

    expect(prepareUpload).toHaveBeenCalledWith(examIdentity, {
      parentId: "assessment-1", parentType: "exam-resource", uploadSessionId: "upload-1",
    });
    expect(confirmUpload).not.toHaveBeenCalled();
    expect(finalizeUpload).not.toHaveBeenCalled();
  });


  it('rolls back assessment publication when its transactional outbox write fails', async () => {
    let published = false;
    const transactionRepository = {
      publishAssessment: vi.fn().mockImplementation(async () => {
        published = true;
        return {
          classId: 'class-1',
          endsAt: '10:00',
          groupId: 'group-1',
          id: 'assessment-1',
          maxMarks: 100,
          resources: [],
          scheduledOn: '2026-07-20',
          startsAt: '09:00',
          subjectId: 'subject-1',
          title: 'Midterm',
        };
      }),
    };
    const withTransaction = vi.fn(async (
      work: (repository: typeof transactionRepository, transaction: Database) => Promise<unknown>,
    ) => {
      const previous = published;
      try {
        return await work(transactionRepository, {} as Database);
      } catch (error) {
        published = previous;
        throw error;
      }
    });
    const service = createExamsService({
      files: {} as never,
      mutations: passthroughMutations(),
      outbox: {
        write: vi.fn(),
        writeInTransaction: vi.fn().mockRejectedValue(new Error('outbox unavailable')),
      } as never,
      repository: {
        ...transactionRepository,
        withTransaction,
      } as unknown as ExamsRepository,
    });

    await expect(service.publishAssessment(
      examIdentity, 'assessment-1', 'publish-outbox-rollback-1', {},
    )).rejects.toThrow('outbox unavailable');

    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(published).toBe(false);
  });

  it('writes authorized exam reminders transactionally for one or all pending students', async () => {
    const writeInTransaction = vi.fn().mockResolvedValue(undefined);
    const transactionRepository = {
      listReminderStudents: vi.fn().mockResolvedValue([studentId]),
      studentCanBeReminded: vi.fn().mockResolvedValue(true),
    };
    const repository = {
      ...transactionRepository,
      withTransaction: async (work: (
        repositoryValue: typeof transactionRepository,
        transaction: Database,
      ) => Promise<unknown>) => work(transactionRepository, {} as Database),
    } as unknown as ExamsRepository;
    const service = createExamsService({
      files: {} as never,
      mutations: passthroughMutations(),
      outbox: { write: vi.fn(), writeInTransaction },
      repository,
    });

    await service.remindStudent(examIdentity, assessmentRouteId, studentId, 'remind-one');
    await service.remindAll(examIdentity, assessmentRouteId, 'remind-all');

    expect(writeInTransaction).toHaveBeenCalledTimes(2);
    expect(writeInTransaction).toHaveBeenNthCalledWith(1, expect.anything(), examIdentity, {
      aggregateId: assessmentRouteId,
      aggregateType: 'exam-assessment',
      eventType: 'exam.reminder.requested',
      payload: { assessmentId: assessmentRouteId, studentId },
    });
    expect(writeInTransaction).toHaveBeenNthCalledWith(2, expect.anything(), examIdentity, {
      aggregateId: assessmentRouteId,
      aggregateType: 'exam-assessment',
      eventType: 'exam.reminder.requested',
      payload: { assessmentId: assessmentRouteId, studentId },
    });
  });

  it('selects reminders only for active class members without durable submissions', async () => {
    const { queries, repository } = createQueryRecordingRepository();

    await repository.studentCanBeReminded(examIdentity, assessmentRouteId, studentId);
    await repository.listReminderStudents(examIdentity, assessmentRouteId);

    expect(queries.length).toBeGreaterThanOrEqual(2);
    for (const query of queries.slice(0, 2)) {
      expect(query).toContain('class_members');
      expect(query).toContain('exam_submissions');
      expect(query).not.toContain('exam_results');
      expect(query).toContain('class_subjects');
      expect(query).toContain('is_published');
    }
    expect(queries[1]).toContain('left join public.class_members');
    expect(queries[1]!.indexOf('exam_submissions')).toBeLessThan(queries[1]!.indexOf('where assessment.id'));
  });

  it('records submission evidence before result upsert and lists submitted-but-ungraded students', async () => {
    const resultWrite = createQueryRecordingRepository();
    await resultWrite.repository.upsertResult(
      examIdentity,
      assessmentRouteId,
      studentId,
      { marks: 85 },
      new Date('2026-08-12T10:00:00.000Z'),
    );
    expect(resultWrite.queries[0]).toContain('insert into public.exam_submissions');
    expect(resultWrite.queries[0]).toContain('insert into public.exam_results');

    const rosterRead = createQueryRecordingRepository();
    await rosterRead.repository.listSubmissionRoster(examIdentity, assessmentRouteId);
    expect(rosterRead.queries).toHaveLength(1);
    expect(rosterRead.queries[0]).toContain('left join public.exam_submissions submission');
    expect(rosterRead.queries[0]).toContain('left join public.exam_results result');
    expect(rosterRead.queries[0]).toContain('submission.submitted_at');
  });

  it('migrates durable exam submissions and backfills existing graded students', () => {
    const source = readFileSync(
      new URL('../supabase/migrations/20260722200000_exam_submissions.sql', import.meta.url),
      'utf8',
    );

    expect(source).toContain('create table if not exists public.exam_submissions');
    expect(source).toContain('constraint exam_submissions_assessment_student_unique');
    expect(source).toContain('from public.exam_results result');
    expect(source).toContain('result.created_at');
    expect(source).toContain('alter table public.exam_submissions enable row level security');
    expect(source).toContain('revoke all on table public.exam_submissions from anon, authenticated');
  });

  it('places requester membership inside the leaderboard data query', async () => {
    const { queries, repository } = createQueryRecordingRepository();

    await repository.getLeaderboard(
      { schoolId, userId: studentId }, 'group-1', { limit: 20 },
    );

    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('requester_membership');
    expect(queries[0]).toContain('cm.student_id =');
  });

  it('scopes the teacher result-list query through the live assessment assignment', async () => {
    const queries: string[] = [];
    const callback: RemoteCallback = async (query) => {
      queries.push(query);
      if (query.includes('from "class_exams"') && query.includes('"ends_at"')) {
        return {
          rows: [{
            classId: 'class-1',
            endsAt: '10:00',
            examGroupId: 'group-1',
            id: 'assessment-1',
            maxMarks: 100,
            scheduledOn: '2026-07-20',
            startsAt: '09:00',
            subjectId: 'subject-1',
            syllabus: null,
            title: 'Mathematics',
          }],
        };
      }
      return { rows: [] };
    };
    const repository = new DrizzleExamsRepository(drizzle(callback) as unknown as Database);

    await repository.listResults(examIdentity, 'assessment-1', { limit: 20 });

    const resultQuery = queries.findLast((query) => query.includes('from "exam_results"'));
    expect(resultQuery).toContain('inner join "class_exams"');
    expect(resultQuery).toContain('class_subjects');
  });
});

describe('exam re-review hardening regressions', () => {
  it('invalidates the affected group cache after every group, assessment, and result write', async () => {
    const group = {
      classId: 'class-1', endsOn: '2026-07-31', id: 'group-1', startsOn: '2026-07-01', state: 'draft' as const,
      title: 'Term one',
    };
    const assessment = {
      classId: 'class-1', endsAt: '10:00', groupId: group.id, id: 'assessment-1', maxMarks: 100,
      resources: [], scheduledOn: '2026-07-20', startsAt: '09:00', subjectId: 'subject-1', title: 'Mathematics',
    };
    const cache = { invalidateExamGroup: vi.fn().mockResolvedValue(undefined) };
    const repository = {
      createAssessment: vi.fn().mockResolvedValue(assessment),
      createGroup: vi.fn().mockResolvedValue(group),
      deleteAssessment: vi.fn().mockResolvedValue(true),
      deleteGroup: vi.fn().mockResolvedValue(true),
      findAssessmentForResultEntry: vi.fn().mockResolvedValue({
        classId: 'class-1', groupId: group.id, maxMarks: 100,
      }),
      updateAssessment: vi.fn().mockResolvedValue(assessment),
      updateGroup: vi.fn().mockResolvedValue(group),
      upsertResult: vi.fn().mockResolvedValue({
        id: 'result-1', marks: 80, studentId, updatedAt: '2026-07-13T00:00:00.000Z',
      }),
    } as unknown as ExamsRepository;
    const service = createExamsService({
      cache,
      files: {} as never,
      mutations: passthroughMutations(),
      outbox: { write: vi.fn(), writeInTransaction: vi.fn() },
      repository,
    });

    await service.createGroup(examIdentity, 'class-1', groupInput, 'create-group');
    await service.updateGroup(examIdentity, group.id, groupInput, 'update-group');
    await service.deleteGroup(examIdentity, group.id, 'delete-group');
    await service.createAssessment(examIdentity, group.id, assessmentInput, 'create-assessment');
    await service.updateAssessment(examIdentity, assessment.id, assessmentInput, 'update-assessment');
    await service.deleteAssessment(examIdentity, assessment.id, 'delete-assessment');
    await service.upsertResult(examIdentity, assessment.id, studentId, { marks: 80 }, 'upsert-result');

    expect(cache.invalidateExamGroup).toHaveBeenCalledTimes(7);
    expect(cache.invalidateExamGroup).toHaveBeenCalledWith({ groupId: group.id, schoolId });
  });

  it("keeps first-page leaderboard caches isolated by the requested limit in both directions", async () => {
    const cacheValues = new Map<string, string>();
    const cache = {
      get: vi.fn(async (key: string) => cacheValues.get(key) ?? null),
      invalidateExamGroup: vi.fn(),
      set: vi.fn(async (key: string, value: string) => { cacheValues.set(key, value); }),
    };
    const getLeaderboard = vi.fn(async (_identity, _groupId, query) => ({
      items: Array.from({ length: query.limit }, (_, index) => ({ id: `student-${index}` })),
    }));
    const service = createExamsService({
      cache,
      files: {} as never,
      mutations: passthroughMutations(),
      outbox: { write: vi.fn(), writeInTransaction: vi.fn() },
      repository: {
        findGroupForStudent: vi.fn().mockResolvedValue({ id: "group-1" }),
        getLeaderboard,
      } as unknown as ExamsRepository,
    });
    const student = { schoolId, userId: studentId };

    await service.getLeaderboard(student, "group-1", { limit: 10 });
    await service.getLeaderboard(student, "group-1", { limit: 20 });
    cacheValues.clear();
    await service.getLeaderboard(student, "group-1", { limit: 20 });
    await service.getLeaderboard(student, "group-1", { limit: 10 });

    expect(getLeaderboard).toHaveBeenCalledTimes(4);
  });


  it('keeps a live class assignment predicate in group list, update, and delete queries', async () => {
    const { queries, repository } = createQueryRecordingRepository();

    await repository.listGroupsForTeacher(examIdentity, 'class-1', { limit: 20 });
    await repository.updateGroup(examIdentity, 'group-1', groupInput);
    await repository.deleteGroup(examIdentity, 'group-1', new Date('2026-07-13T00:00:00.000Z'));

    expect(queries).toHaveLength(3);
    expect(queries[0]).not.toContain('creator_teacher_id');
    for (const query of queries) {
      expect(query).toContain('class_subjects');
    }
    for (const query of queries.slice(1)) {
      expect(query).toContain('creator_teacher_id');
    }
  });

  it('requires an undeleted parent group for direct student and teacher child reads', async () => {
    const { queries, repository } = createQueryRecordingRepository();

    await repository.findAssessmentForStudent({ schoolId, userId: studentId }, 'assessment-1');
    await repository.listAssessmentsForTeacher(examIdentity, 'group-1', { limit: 20 });
    await repository.findAssessmentForResultEntry(examIdentity, 'assessment-1');
    await repository.listResults(examIdentity, 'assessment-1', { limit: 20 });
    await repository.canManageAssessment(examIdentity, 'assessment-1');

    expect(queries).toHaveLength(5);
    for (const query of queries) {
      expect(query).toContain('from "exam_groups"');
      expect(query).toContain('"exam_groups"."deleted_at" is null');
    }
    expect(queries[1]).toContain('from public.exam_results result_status');
    expect(queries[1]).toContain('result_status.assessment_id = "class_exams"."id"');
    expect(queries[1]).toContain('result_status.published_at is not null');
  });

  it('performs assessment update ownership checks for both stored and requested subjects in the mutation', () => {
    const source = readFileSync(
      new URL('../src/db/repositories/exams.repository.ts', import.meta.url),
      'utf8',
    );
    const method = source.slice(
      source.indexOf('public async updateAssessment'),
      source.indexOf('public async deleteAssessment'),
    );

    expect(method).toContain('old_subject_assignment');
    expect(method).toContain('new_subject_assignment');
    expect(method).toContain('transaction.execute');
  });

  it('rolls back assessment creation when duplicate rubric positions fail', async () => {
    const writes: string[] = [];
    let rolledBack = false;
    const repository = new DrizzleExamsRepository({
      execute: async () => {
        writes.push('outside');
        return [{ id: 'assessment-1' }];
      },
      transaction: async (work: (transaction: never) => Promise<unknown>) => {
        const transaction = {
          execute: async () => {
            writes.push('transaction');
            return [{ id: 'assessment-1' }];
          },
          insert: () => ({
            values: async () => {
              throw new Error('duplicate rubric position');
            },
          }),
        };
        try {
          return await work(transaction as never);
        } catch (error) {
          rolledBack = true;
          throw error;
        }
      },
    } as unknown as Database);

    await expect(repository.createAssessment(examIdentity, 'group-1', assessmentInput))
      .rejects.toThrow('duplicate rubric position');

    expect(writes).toEqual(['transaction']);
    expect(rolledBack).toBe(true);
  });

  it('returns the latest published result revision to the student assessment detail', async () => {
    const queries: string[] = [];
    const callback: RemoteCallback = async (query) => {
      queries.push(query);
      if (query.includes('from "class_exams"')) {
        return {
          rows: [[
            'class-1', '10:00', 'group-1', 'assessment-1', 100,
            '2026-07-20', '09:00', 'subject-1', null, 'Mathematics',
          ]],
        };
      }
      if (query.includes('exam_result_revisions')) {
        return {
          rows: [[
            'Improved work', 'revision-1', 91, new Date('2026-07-13T00:00:00.000Z'),
            studentId, new Date('2026-07-13T00:00:00.000Z'),
          ]],
        };
      }
      if (query.includes('exam_results')) {
        return {
          rows: [[
            'Original work', 'result-1', 70, new Date('2026-07-12T00:00:00.000Z'),
            studentId, new Date('2026-07-12T00:00:00.000Z'),
          ]],
        };
      }
      return { rows: [] };
    };
    const repository = new DrizzleExamsRepository(drizzle(callback) as unknown as Database);

    const detail = await repository.findAssessmentForStudent(
      { schoolId, userId: studentId }, 'assessment-1',
    );

    expect(detail?.result).toMatchObject({ feedback: 'Improved work', marks: 91 });
    expect(queries.some((query) => query.includes('exam_result_revisions'))).toBe(true);
  });
});

describe('exam app mount', () => {
  it('mounts the authenticated exam router at /v1', async () => {
    const service = createService();
    vi.mocked(service.listGroupsForStudent).mockResolvedValue({ items: [], nextCursor: undefined });

    await request(createApp({
      authenticate: createAuthenticatedRequest({ role: 'student', userId: studentId }),
      examService: service,
    })).get('/v1/student/exams/groups').expect(200);
  });
});


describe("leaderboard cache mutation invalidation", () => {
  it("invalidates cached 10- and 20-row leaderboard pages after a result mutation", async () => {
    const cacheValues = new Map<string, string>();
    const cache = new AcademicCache({
      delete: async (key: string) => { cacheValues.delete(key); },
      get: async (key: string) => cacheValues.get(key) ?? null,
      set: async (key: string, value: string) => { cacheValues.set(key, value); },
      withLock: async <T>() => null as T | null,
    });
    const getLeaderboard = vi.fn(async (_identity, _groupId, query) => ({
      items: Array.from({ length: query.limit }, (_, index) => ({ id: "student-" + index })),
    }));
    const service = createExamsService({
      cache,
      files: {} as never,
      mutations: passthroughMutations(),
      outbox: { write: vi.fn(), writeInTransaction: vi.fn() },
      repository: {
        findAssessmentForResultEntry: vi.fn().mockResolvedValue({ classId: "class-1", groupId: "group-1", maxMarks: 100 }),
        findGroupForStudent: vi.fn().mockResolvedValue({ id: "group-1" }),
        getLeaderboard,
        upsertResult: vi.fn().mockResolvedValue({
          id: "result-1", marks: 80, studentId, updatedAt: "2026-07-13T00:00:00.000Z",
        }),
      } as unknown as ExamsRepository,
    });
    const student = { schoolId, userId: studentId };

    await service.getLeaderboard(student, "group-1", { limit: 10 });
    await service.getLeaderboard(student, "group-1", { limit: 20 });
    expect(getLeaderboard).toHaveBeenCalledTimes(2);

    await service.upsertResult(examIdentity, assessmentRouteId, studentId, { marks: 80 }, "invalidate-pages");

    await service.getLeaderboard(student, "group-1", { limit: 10 });
    await service.getLeaderboard(student, "group-1", { limit: 20 });
    expect(getLeaderboard).toHaveBeenCalledTimes(4);
  });
});


describe("result write revocation race", () => {
  it("does not report a result write as successful when the group is deleted after the service precheck", async () => {
    const upsertResult = vi.fn().mockResolvedValue(undefined);
    const service = createExamsService({
      files: {} as never,
      mutations: passthroughMutations(),
      outbox: { write: vi.fn(), writeInTransaction: vi.fn() },
      repository: {
        findAssessmentForResultEntry: vi.fn().mockResolvedValue({ classId: "class-1", groupId: "group-1", maxMarks: 100 }),
        upsertResult,
      } as unknown as ExamsRepository,
    });

    await expect(service.upsertResult(examIdentity, assessmentRouteId, studentId, { marks: 80 }, "group-deleted"))
      .rejects.toMatchObject({ status: 403 });
    expect(upsertResult).toHaveBeenCalledTimes(1);
  });

  it("does not publish results when the group is deleted after the transactional precheck", async () => {
    const publishResults = vi.fn().mockResolvedValue(false);
    const transactionRepository = {
      findAssessmentForResultEntry: vi.fn().mockResolvedValue({ classId: "class-1", groupId: "group-1", maxMarks: 100 }),
      publishResults,
    };
    const service = createExamsService({
      files: {} as never,
      mutations: passthroughMutations(),
      outbox: { write: vi.fn(), writeInTransaction: vi.fn() },
      repository: {
        ...transactionRepository,
        withTransaction: async (work: (repository: typeof transactionRepository, transaction: Database) => Promise<unknown>) => work(transactionRepository, {} as Database),
      } as unknown as ExamsRepository,
    });

    await expect(service.publishResults(examIdentity, assessmentRouteId, "group-deleted-publish", {}))
      .rejects.toMatchObject({ status: 404 });
    expect(publishResults).toHaveBeenCalledTimes(1);
  });
});
