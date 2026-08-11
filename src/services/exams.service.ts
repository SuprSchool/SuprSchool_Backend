import { randomUUID } from 'node:crypto';

import type { Database } from '../db/client.js';
import { examGroupLeaderboardVersionKey } from '../platform/academic/academic-cache.js';
import { tenantCacheKey } from '../platform/cache/cache-store.js';
import type {
  ExamsRepository,
  StoredExamAssessment,
  StoredExamResource,
} from '../db/repositories/exams.repository.js';
import { AppError } from '../lib/errors.js';
import { pointAwardRuleCodes, type PointAwardPort } from './point-award.service.js';
import type {
  CreateExamAssessmentInput,
  CreateExamGroupInput,
  CursorPage,
  ExamAssessmentDetail,
  ExamAssessmentListQuery,
  ExamGroup,
  ExamGroupDetail,
  ExamGroupListQuery,
  ExamIdentity,
  ExamResource,
  ExamResourceUploadInput,
  ExamResult,
  ExamResultListQuery,
  ExamSubmission,
  ExamSubmissionRoster,
  ExamUploadSession,
  LeaderboardEntry,
  LeaderboardQuery,
  TeacherExamAssessment,
  UpdateExamAssessmentInput,
  UpdateExamGroupInput,
  UpsertExamResultInput,
} from '../types/exams.js';

export interface ExamFilePort {
  finalizeUpload(identity: ExamIdentity, uploadSessionId: string): Promise<void>;
  prepareUpload(identity: ExamIdentity, input: {
    parentId: string;
    parentType: 'exam-resource';
    uploadSessionId: string;
  }): Promise<{
    contentType: string;
    displayName: string;
    id: string;
    objectPath: string;
  }>;
  createReadUrl(bucket: 'academic-files', objectPath: string, expiresInSeconds: 900): Promise<string>;
  createUpload(identity: ExamIdentity, input: {
    bucket: 'academic-files';
    contentType: string;
    displayName: string;
    parentId: string;
    parentType: 'exam-resource';
    sizeBytes: number;
  }): Promise<{
    expiresAt: string;
    id: string;
    objectPath: string;
    signedUploadUrl: string;
  }>;
}

export interface ExamMutationPort {
  execute<T>(identity: ExamIdentity, input: {
    idempotencyKey: string;
    requestBody: unknown;
    successStatus: number;
    recover?: () => Promise<T | undefined>;
    work: () => Promise<T>;
  }): Promise<{ body: T; replayed: boolean; status: number }>;
}

export interface ExamOutboxPort {
  write(identity: ExamIdentity, event: {
    aggregateId: string;
    aggregateType: 'exam-assessment' | 'exam-result';
    eventType: 'exam.published' | 'exam.reminder.requested' | 'exam.results_published';
    payload: Record<string, string>;
  }): Promise<void>;
  writeInTransaction(transaction: Database, identity: ExamIdentity, event: {
    aggregateId: string;
    aggregateType: 'exam-assessment' | 'exam-result';
    eventType: 'exam.published' | 'exam.reminder.requested' | 'exam.results_published';
    payload: Record<string, string>;
  }): Promise<void>;
}

export interface ExamsService {
  confirmResource(identity: ExamIdentity, assessmentId: string, uploadSessionId: string, idempotencyKey: string): Promise<ExamResource>;
  createAssessment(identity: ExamIdentity, groupId: string, input: CreateExamAssessmentInput, idempotencyKey: string): Promise<ExamAssessmentDetail>;
  createGroup(identity: ExamIdentity, classId: string, input: CreateExamGroupInput, idempotencyKey: string): Promise<ExamGroup>;
  createResourceUploadSession(identity: ExamIdentity, assessmentId: string, input: ExamResourceUploadInput, idempotencyKey: string): Promise<ExamUploadSession>;
  deleteAssessment(identity: ExamIdentity, assessmentId: string, idempotencyKey: string): Promise<void>;
  getAssessmentForTeacher(identity: ExamIdentity, assessmentId: string): Promise<ExamAssessmentDetail>;
  deleteGroup(identity: ExamIdentity, groupId: string, idempotencyKey: string): Promise<void>;
  getAssessmentForStudent(identity: ExamIdentity, assessmentId: string): Promise<ExamAssessmentDetail>;
  getGroupForStudent(identity: ExamIdentity, groupId: string): Promise<ExamGroupDetail>;
  getLeaderboard(identity: ExamIdentity, groupId: string, query: LeaderboardQuery): Promise<CursorPage<LeaderboardEntry>>;
  listAssessmentsForTeacher(identity: ExamIdentity, groupId: string, query: ExamAssessmentListQuery): Promise<CursorPage<TeacherExamAssessment>>;
  listGroupsForStudent(identity: ExamIdentity, query: ExamGroupListQuery): Promise<CursorPage<ExamGroup>>;
  listGroupsForTeacher(identity: ExamIdentity, classId: string, query: ExamGroupListQuery): Promise<CursorPage<ExamGroup>>;
  listResults(identity: ExamIdentity, assessmentId: string, query: ExamResultListQuery): Promise<CursorPage<ExamResult>>;
  listSubmissions(identity: ExamIdentity, assessmentId: string): Promise<ExamSubmissionRoster>;
  markSubmission(identity: ExamIdentity, assessmentId: string, studentId: string, idempotencyKey: string, requestBody: Record<string, never>): Promise<ExamSubmission>;
  remindAll(identity: ExamIdentity, assessmentId: string, idempotencyKey: string): Promise<{ requested: number }>;
  remindStudent(identity: ExamIdentity, assessmentId: string, studentId: string, idempotencyKey: string): Promise<{ studentId: string }>;
  publishAssessment(identity: ExamIdentity, assessmentId: string, idempotencyKey: string, requestBody: Record<string, never>): Promise<ExamAssessmentDetail>;
  publishResults(identity: ExamIdentity, assessmentId: string, idempotencyKey: string, requestBody: Record<string, never>): Promise<{ assessmentId: string }>;
  updateAssessment(identity: ExamIdentity, assessmentId: string, input: UpdateExamAssessmentInput, idempotencyKey: string): Promise<ExamAssessmentDetail>;
  updateGroup(identity: ExamIdentity, groupId: string, input: UpdateExamGroupInput, idempotencyKey: string): Promise<ExamGroup>;
  upsertResult(identity: ExamIdentity, assessmentId: string, studentId: string, input: UpsertExamResultInput, idempotencyKey: string): Promise<ExamResult>;
}

export interface ExamCachePort {
  get?(key: string): Promise<string | null>;
  set?(key: string, value: string, ttlSeconds: number): Promise<void>;
  invalidateExamGroup(input: { groupId: string; schoolId: string }): Promise<void>;
}

export interface ExamsServiceDependencies {
  cache?: ExamCachePort;
  clock?: () => Date;
  files: ExamFilePort;
  mutations: ExamMutationPort;
  outbox: ExamOutboxPort;
  pointAwards?: PointAwardPort;
  repository: ExamsRepository;
}

function notFound(): AppError {
  return new AppError('NOT_FOUND', 404, 'Exam resource not found');
}

function cannotManage(): AppError {
  return new AppError('FORBIDDEN', 403, 'You do not have access to this resource');
}

function invalidMarks(): AppError {
  return new AppError('VALIDATION_ERROR', 400, 'Marks exceed the assessment maximum');
}

function parseCachedJson<T>(value: string): T | undefined {
  try { return JSON.parse(value) as T; } catch { return undefined; }
}

export function createExamsService({
  cache,
  clock = () => new Date(),
  files,
  mutations,
  outbox,
  pointAwards,
  repository,
}: ExamsServiceDependencies): ExamsService {
  async function invalidate(groupId: string, schoolId: string): Promise<void> {
    try { await cache?.invalidateExamGroup({ groupId, schoolId }); } catch { return; }
  }

  async function cacheGet(key: string): Promise<string | null> {
    try { return await cache?.get?.(key) ?? null; } catch { return null; }
  }

  async function cacheSet(key: string, value: string, ttlSeconds: number): Promise<void> {
    try { await cache?.set?.(key, value, ttlSeconds); } catch { // Cache availability never changes the database response.
    }
  }

  async function toResource(stored: StoredExamResource): Promise<ExamResource> {
    return {
      id: stored.id,
      name: stored.name,
      signedUrl: await files.createReadUrl('academic-files', stored.objectPath, 900),
    };
  }

  /**
   * `classId` stays internal. `groupId` does not: View Leaderboard on 253:8647
   * routes through the exam group, so it reaches the wire as `examGroupId`.
   */
  async function toAssessment(stored: StoredExamAssessment): Promise<ExamAssessmentDetail> {
    const { classId: _classId, groupId, resources, ...assessment } = stored;
    void _classId;
    return {
      ...assessment,
      examGroupId: groupId,
      resources: await Promise.all(resources.map(toResource)),
    };
  }

  return {
    async listGroupsForStudent(identity, query) {
      return repository.listGroupsForStudent(identity, query);
    },

    async getGroupForStudent(identity, groupId) {
      const group = await repository.findGroupForStudent(identity, groupId);
      if (group === undefined) throw notFound();
      const key = tenantCacheKey(identity.schoolId, "exams", "group", groupId);
      const cached = await cacheGet(key);
      const cachedGroup = cached === null || cached === undefined ? undefined : parseCachedJson<ExamGroupDetail>(cached);
      if (cachedGroup !== undefined) return cachedGroup;
      await cacheSet(key, JSON.stringify(group), 60);
      return group;
    },

    async getAssessmentForStudent(identity, assessmentId) {
      const assessment = await repository.findAssessmentForStudent(identity, assessmentId);
      if (assessment === undefined) throw notFound();
      return toAssessment(assessment);
    },

    async getAssessmentForTeacher(identity, assessmentId) {
      const assessment = await repository.findAssessmentForTeacher(identity, assessmentId);
      if (assessment === undefined) throw notFound();
      return toAssessment(assessment);
    },

    async getLeaderboard(identity, groupId, query) {
      const audience = await repository.findGroupForStudent(identity, groupId);
      if (audience === undefined) throw notFound();
      const versionKey = examGroupLeaderboardVersionKey(identity.schoolId, groupId);
      let version = await cacheGet(versionKey);
      if (version === null) {
        version = randomUUID();
        await cacheSet(versionKey, version, 300);
      }
      const key = tenantCacheKey(identity.schoolId, 'exams', 'leaderboard', groupId + ':version:' + version + ':limit:' + query.limit);
      const cached = query.cursor === undefined ? await cacheGet(key) : undefined;
      const cachedLeaderboard = cached === null || cached === undefined ? undefined : parseCachedJson<CursorPage<LeaderboardEntry>>(cached);
      if (cachedLeaderboard !== undefined) return cachedLeaderboard;
      const leaderboard = await repository.getLeaderboard(identity, groupId, query);
      if (leaderboard === undefined) throw notFound();
      if (query.cursor === undefined) await cacheSet(key, JSON.stringify(leaderboard), 30);
      return leaderboard;
    },

    async listGroupsForTeacher(identity, classId, query) {
      return repository.listGroupsForTeacher(identity, classId, query);
    },

    async createGroup(identity, classId, input, idempotencyKey) {
      const result = await mutations.execute(identity, {
        idempotencyKey,
        requestBody: { classId, ...input },
        successStatus: 201,
        work: async () => {
          const group = await repository.createGroup(identity, classId, input);
          if (group === undefined) throw cannotManage();
          return group;
        },
      });
      await invalidate(result.body.id, identity.schoolId);
      return result.body;
    },

    async updateGroup(identity, groupId, input, idempotencyKey) {
      const result = await mutations.execute(identity, {
        idempotencyKey,
        requestBody: input,
        successStatus: 200,
        work: async () => {
          const group = await repository.updateGroup(identity, groupId, input);
          if (group === undefined) throw notFound();
          return group;
        },
      });
      await invalidate(result.body.id, identity.schoolId);
      return result.body;
    },

    async deleteGroup(identity, groupId, idempotencyKey) {
      const result = await mutations.execute(identity, {
        idempotencyKey,
        requestBody: {},
        successStatus: 204,
        work: async () => {
          if (!await repository.deleteGroup(identity, groupId, clock())) throw notFound();
          return { groupId };
        },
      });
      await invalidate(result.body.groupId, identity.schoolId);
    },

    async listAssessmentsForTeacher(identity, groupId, query) {
      return repository.listAssessmentsForTeacher(identity, groupId, query);
    },

    async createAssessment(identity, groupId, input, idempotencyKey) {
      const result = await mutations.execute(identity, {
        idempotencyKey,
        requestBody: { groupId, ...input },
        successStatus: 201,
        work: async () => {
          const assessment = await repository.createAssessment(identity, groupId, input);
          if (assessment === undefined) throw cannotManage();
          return { assessment: await toAssessment(assessment), groupId: assessment.groupId };
        },
      });
      await invalidate(result.body.groupId, identity.schoolId);
      return result.body.assessment;
    },

    async updateAssessment(identity, assessmentId, input, idempotencyKey) {
      const result = await mutations.execute(identity, {
        idempotencyKey,
        requestBody: input,
        successStatus: 200,
        work: async () => {
          const assessment = await repository.updateAssessment(identity, assessmentId, input);
          if (assessment === undefined) throw notFound();
          return { assessment: await toAssessment(assessment), groupId: assessment.groupId };
        },
      });
      await invalidate(result.body.groupId, identity.schoolId);
      return result.body.assessment;
    },

    async deleteAssessment(identity, assessmentId, idempotencyKey) {
      const result = await mutations.execute(identity, {
        idempotencyKey,
        requestBody: {},
        successStatus: 204,
        work: async () => {
          const assessment = await repository.findAssessmentForResultEntry(identity, assessmentId);
          if (assessment === undefined) throw notFound();
          if (!await repository.deleteAssessment(identity, assessmentId, clock())) throw notFound();
          return { groupId: assessment.groupId };
        },
      });
      await invalidate(result.body.groupId, identity.schoolId);
    },

    async listResults(identity, assessmentId, query) {
      const results = await repository.listResults(identity, assessmentId, query);
      if (results === undefined) throw notFound();
      return results;
    },

    async listSubmissions(identity, assessmentId) {
      const roster = await repository.listSubmissionRoster(identity, assessmentId);
      if (roster === undefined) throw notFound();
      return roster;
    },

    async markSubmission(identity, assessmentId, studentId, idempotencyKey, requestBody) {
      const result = await mutations.execute(identity, {
        idempotencyKey,
        requestBody: { ...requestBody, studentId },
        successStatus: 200,
        work: async () => {
          const submission = await repository.recordSubmission(identity, assessmentId, studentId, clock());
          if (submission === undefined) throw cannotManage();
          return submission;
        },
      });
      return result.body;
    },

    async remindStudent(identity, assessmentId, studentId, idempotencyKey) {
      const result = await mutations.execute(identity, {
        idempotencyKey,
        requestBody: { studentId },
        successStatus: 202,
        work: async () => {
          await repository.withTransaction(async (transactionRepository, transaction) => {
            if (!await transactionRepository.studentCanBeReminded(identity, assessmentId, studentId)) {
              throw cannotManage();
            }
            await outbox.writeInTransaction(transaction, identity, {
              aggregateId: assessmentId,
              aggregateType: 'exam-assessment',
              eventType: 'exam.reminder.requested',
              payload: { assessmentId, studentId },
            });
          });
          return { studentId };
        },
      });
      return result.body;
    },

    async remindAll(identity, assessmentId, idempotencyKey) {
      const result = await mutations.execute(identity, {
        idempotencyKey,
        requestBody: {},
        successStatus: 202,
        work: async () => {
          const students = await repository.withTransaction(async (transactionRepository, transaction) => {
            const pendingStudents = await transactionRepository.listReminderStudents(identity, assessmentId);
            if (pendingStudents === undefined) throw cannotManage();
            for (const studentId of pendingStudents) {
              await outbox.writeInTransaction(transaction, identity, {
                aggregateId: assessmentId,
                aggregateType: 'exam-assessment',
                eventType: 'exam.reminder.requested',
                payload: { assessmentId, studentId },
              });
            }
            return pendingStudents;
          });
          return { requested: students.length };
        },
      });
      return result.body;
    },
    async upsertResult(identity, assessmentId, studentId, input, idempotencyKey) {
      const result = await mutations.execute(identity, {
        idempotencyKey,
        requestBody: { studentId, ...input },
        successStatus: 200,
        work: async () => {
          const assessment = await repository.findAssessmentForResultEntry(identity, assessmentId);
          if (assessment === undefined) throw cannotManage();
          if (input.marks > assessment.maxMarks) throw invalidMarks();
          const saved = await repository.upsertResult(identity, assessmentId, studentId, input, clock());
          if (saved === undefined) throw cannotManage();
          return { groupId: assessment.groupId, result: saved };
        },
      });
      await invalidate(result.body.groupId, identity.schoolId);
      return result.body.result;
    },

    async publishAssessment(identity, assessmentId, idempotencyKey, requestBody) {
      const result = await mutations.execute(identity, {
        idempotencyKey,
        requestBody,
        successStatus: 200,
        work: async () => {
          const assessment = await repository.withTransaction(async (transactionRepository, transaction) => {
            const assessment = await transactionRepository.publishAssessment(identity, assessmentId, clock());
            if (assessment === undefined) throw notFound();
            await outbox.writeInTransaction(transaction, identity, {
              aggregateId: assessment.id,
              aggregateType: 'exam-assessment',
              eventType: 'exam.published',
              payload: { assessmentId: assessment.id, groupId: assessment.groupId },
            });
            return assessment;
          });
          await invalidate(assessment.groupId, identity.schoolId);
          return toAssessment(assessment);
        },
      });
      return result.body;
    },

    async publishResults(identity, assessmentId, idempotencyKey, requestBody) {
      const result = await mutations.execute(identity, {
        idempotencyKey,
        requestBody,
        successStatus: 200,
        work: async () => {
          const groupId = await repository.withTransaction(async (transactionRepository, transaction) => {
            const assessment = await transactionRepository.findAssessmentForResultEntry(identity, assessmentId);
            if (assessment === undefined) throw notFound();
            if (!await transactionRepository.publishResults(identity, assessmentId, clock())) throw notFound();
            await outbox.writeInTransaction(transaction, identity, {
              aggregateId: assessmentId,
              aggregateType: 'exam-result',
              eventType: 'exam.results_published',
              payload: { assessmentId, groupId: assessment.groupId },
            });
            return assessment.groupId;
          });
          await invalidate(groupId, identity.schoolId);
          return { assessmentId };
        },
      });
      if (pointAwards === undefined) return result.body;
      for (const recipient of await repository.listPublishedAwardRecipients(identity, assessmentId)) {
        await pointAwards?.awardIfAbsent({
          metadata: { assessmentId },
          occurredAt: recipient.publishedAt,
          recipientUserId: recipient.studentId,
          ruleCode: pointAwardRuleCodes.assessmentResultPublished,
          schoolId: identity.schoolId,
          sourceId: recipient.id,
          sourceType: 'assessment_result',
        });
      }
      return result.body;
    },

    async createResourceUploadSession(identity, assessmentId, input, idempotencyKey) {
      const result = await mutations.execute(identity, {
        idempotencyKey,
        requestBody: input,
        successStatus: 201,
        work: async () => {
          if (!await repository.canManageAssessment(identity, assessmentId)) throw cannotManage();
          const session = await files.createUpload(identity, {
            bucket: 'academic-files',
            contentType: input.contentType,
            displayName: input.displayName,
            parentId: assessmentId,
            parentType: 'exam-resource',
            sizeBytes: input.sizeBytes,
          });
          return {
            expiresAt: session.expiresAt,
            id: session.id,
            signedUploadUrl: session.signedUploadUrl,
          };
        },
      });
      return result.body;
    },

    async confirmResource(identity, assessmentId, uploadSessionId, idempotencyKey) {
      const result = await mutations.execute(identity, {
        idempotencyKey,
        requestBody: { uploadSessionId },
        successStatus: 201,
        recover: async () => {
          const resource = await repository.findResourceForUpload({ assessmentId, identity, uploadSessionId });
          if (resource === undefined) return undefined;
          await files.finalizeUpload(identity, uploadSessionId);
          return toResource(resource);
        },
        work: async () => {
          if (!await repository.canManageAssessment(identity, assessmentId)) throw cannotManage();
          const upload = await files.prepareUpload(identity, {
            parentId: assessmentId,
            parentType: 'exam-resource',
            uploadSessionId,
          });
          const resource = await repository.insertResource({
            assessmentId,
            displayName: upload.displayName,
            identity,

            objectPath: upload.objectPath,
            schoolId: identity.schoolId,
            uploadSessionId,
          });
          if (resource === undefined) throw notFound();
          await files.finalizeUpload(identity, uploadSessionId);
          return toResource(resource);
        },
      });
      return result.body;
    },
  };
}
