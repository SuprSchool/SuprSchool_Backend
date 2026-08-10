import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../src/db/client.js';
import type { AssignmentsRepository } from '../src/db/repositories/assignments.repository.js';
import type { AttendanceRepository } from '../src/db/repositories/attendance.repository.js';
import type { EventsRepository } from '../src/db/repositories/events.repository.js';
import type { ExamsRepository } from '../src/db/repositories/exams.repository.js';
import { createAssignmentsService, type AcademicFilePort, type AcademicMutationPort } from '../src/services/assignments.service.js';
import { createAttendanceService } from '../src/services/attendance.service.js';
import { createEventsService } from '../src/services/events.service.js';
import { createExamsService, type ExamMutationPort } from '../src/services/exams.service.js';
import { PointAwardGateway } from '../src/services/point-award.service.js';

const schoolId = '11111111-1111-4111-8111-111111111111';
const studentId = '22222222-2222-4222-8222-222222222222';
const teacherId = '33333333-3333-4333-8333-333333333333';
const assignmentId = '44444444-4444-4444-8444-444444444444';
const submissionId = '55555555-5555-4555-8555-555555555555';
const uploadSessionId = '66666666-6666-4666-8666-666666666666';
const assessmentId = '77777777-7777-4777-8777-777777777777';
const resultId = '88888888-8888-4888-8888-888888888888';
const eventId = '99999999-9999-4999-8999-999999999999';
const registrationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function passthroughAssignmentMutations(): AcademicMutationPort {
  return {
    async execute(_identity, input) {
      return { body: await input.work(), replayed: false, status: input.successStatus };
    },
  };
}

function passthroughExamMutations(): ExamMutationPort {
  return {
    async execute(_identity, input) {
      return { body: await input.work(), replayed: false, status: input.successStatus };
    },
  };
}

describe('production point awards', () => {
  it('awards an assignment only after its submission is durably attached', async () => {
    const order: string[] = [];
    const awardIfAbsent = vi.fn(async () => {
      order.push('award');
      return { awarded: true, entryId: 'entry-1' };
    });
    const transactionRepository = {
      confirmSubmission: vi.fn(async () => {
        order.push('submission');
        return { kind: 'attached' as const, submission: { id: submissionId, studentId } };
      }),
      upsertSubmissionDraft: vi.fn(async () => ({ id: submissionId })),
    };
    const service = createAssignmentsService({
      cache: { invalidateStudentAssignments: vi.fn() },
      clock: () => new Date('2026-07-17T10:00:00.000Z'),
      files: {
        finalizeUpload: vi.fn(),
        prepareUpload: vi.fn(async () => ({
          contentType: 'application/pdf', displayName: 'work.pdf', id: uploadSessionId, objectPath: 'work.pdf',
        })),
      } as unknown as AcademicFilePort,
      mutations: passthroughAssignmentMutations(),
      outbox: { write: vi.fn(), writeInTransaction: vi.fn() },
      pointAwards: { awardIfAbsent },
      repository: {
        ...transactionRepository,
        withTransaction: async (work: (repository: typeof transactionRepository, transaction: Database) => Promise<unknown>) => (
          work(transactionRepository, {} as Database)
        ),
      } as unknown as AssignmentsRepository,
    } as never);

    await service.confirmSubmission({ schoolId, userId: studentId }, assignmentId, uploadSessionId, 'submission-award-1');

    expect(order).toEqual(['submission', 'award']);
    expect(awardIfAbsent).toHaveBeenCalledWith(expect.objectContaining({
      recipientUserId: studentId,
      ruleCode: 'assignment-submitted',
      schoolId,
      sourceId: submissionId,
      sourceType: 'assignment_submission',
    }));
  });

  it('keeps a durable assignment submission successful when its school has no point rules yet', async () => {
    const confirmSubmission = vi.fn(async () => ({
      kind: 'attached' as const,
      submission: { assignmentId, completedAt: null, id: submissionId, studentId },
    }));
    const insertAwardIfAbsent = vi.fn();
    const pointAwards = new PointAwardGateway({
      repository: {
        findActiveEarningRule: vi.fn(async () => undefined),
        insertAwardIfAbsent,
      } as never,
    });
    const service = createAssignmentsService({
      cache: { invalidateStudentAssignments: vi.fn() },
      files: {
        finalizeUpload: vi.fn(),
        prepareUpload: vi.fn(async () => ({
          contentType: 'application/pdf', displayName: 'work.pdf', id: uploadSessionId, objectPath: 'work.pdf',
        })),
      } as unknown as AcademicFilePort,
      mutations: passthroughAssignmentMutations(),
      outbox: { write: vi.fn(), writeInTransaction: vi.fn() },
      pointAwards,
      repository: {
        confirmSubmission,
        upsertSubmissionDraft: vi.fn(async () => ({ assignmentId, id: submissionId })),
        withTransaction: async (work: (repository: Pick<AssignmentsRepository, 'confirmSubmission' | 'upsertSubmissionDraft'>, transaction: Database) => Promise<unknown>) => (
          work({ confirmSubmission, upsertSubmissionDraft: vi.fn(async () => ({ assignmentId, id: submissionId })) }, {} as Database)
        ),
      } as unknown as AssignmentsRepository,
    });

    await expect(service.confirmSubmission(
      { schoolId, userId: studentId }, assignmentId, uploadSessionId, 'submission-without-rules',
    )).resolves.toMatchObject({ id: submissionId });
    expect(confirmSubmission).toHaveBeenCalledOnce();
    expect(insertAwardIfAbsent).not.toHaveBeenCalled();
  });

  it('awards published assessment results from their durable result records', async () => {
    const order: string[] = [];
    const awardIfAbsent = vi.fn(async () => {
      order.push('award');
      return { awarded: true, entryId: 'entry-2' };
    });
    const transactionRepository = {
      findAssessmentForResultEntry: vi.fn(async () => ({ groupId: 'group-1', maxMarks: 100 })),
      publishResults: vi.fn(async () => {
        order.push('publish');
        return true;
      }),
    };
    const service = createExamsService({
      files: {} as never,
      mutations: passthroughExamMutations(),
      outbox: { write: vi.fn(), writeInTransaction: vi.fn() },
      pointAwards: { awardIfAbsent },
      repository: {
        ...transactionRepository,
        listPublishedAwardRecipients: vi.fn(async () => [{ id: resultId, studentId }]),
        withTransaction: async (work: (repository: typeof transactionRepository, transaction: Database) => Promise<unknown>) => (
          work(transactionRepository, {} as Database)
        ),
      } as unknown as ExamsRepository,
    } as never);

    await service.publishResults({ schoolId, userId: teacherId }, assessmentId, 'result-award-1', {});

    expect(order).toEqual(['publish', 'award']);
    expect(awardIfAbsent).toHaveBeenCalledWith(expect.objectContaining({
      recipientUserId: studentId,
      ruleCode: 'assessment-result-published',
      schoolId,
      sourceId: resultId,
      sourceType: 'assessment_result',
    }));
  });

  it('awards a replayed event registration from the same durable registration without duplicating the source', async () => {
    const awardIfAbsent = vi.fn(async () => ({ awarded: false }));
    const repository = {
      registerStudent: vi.fn(async () => ({
        created: false,
        id: registrationId,
        registeredAt: '2026-07-17T10:00:00.000Z',
        teamId: null,
        teamName: null,
      })),
    } as unknown as EventsRepository;
    const files = {
      createReadUrl: vi.fn(),
      createUpload: vi.fn(),
      deleteObject: vi.fn(),
      finalizeUpload: vi.fn(),
      prepareUpload: vi.fn(),
    };
    const service = createEventsService({
      files,
      repository,
      pointAwards: { awardIfAbsent },
    });

    await service.registerStudent({ schoolId, userId: studentId }, eventId);

    expect(awardIfAbsent).toHaveBeenCalledWith(expect.objectContaining({
      recipientUserId: studentId,
      ruleCode: 'event-registered',
      schoolId,
      sourceId: registrationId,
      sourceType: 'event_registration',
    }));
  });

  it('awards only attendance records that the durable streak evaluator qualifies', async () => {
    const order: string[] = [];
    const awardIfAbsent = vi.fn(async () => {
      order.push('award');
      return { awarded: true, entryId: 'entry-3' };
    });
    const repository = {
      markBulk: vi.fn(async () => {
        order.push('attendance');
        return { attendanceDate: '2026-07-17', classId: assignmentId, sessionId: 'session-1', updatedRecords: 1 };
      }),
      listQualifyingStreakAwards: vi.fn(async () => [{
        occurredAt: new Date('2026-07-17T10:00:00.000Z'),
        sourceId: 'record-1',
        streakDays: 5,
        studentId,
      }]),
    } as unknown as AttendanceRepository;
    const service = createAttendanceService({ repository, pointAwards: { awardIfAbsent } } as never);

    await service.markBulk(teacherId, {
      attendanceDate: '2026-07-17', classId: assignmentId, records: [{ status: 'present', studentId }],
    });

    expect(order).toEqual(['attendance', 'award']);
    expect(awardIfAbsent).toHaveBeenCalledWith(expect.objectContaining({
      metadata: { streakDays: 5 },
      recipientUserId: studentId,
      ruleCode: 'attendance-streak',
      sourceId: 'record-1',
      sourceType: 'attendance_streak',
    }));
  });
});
