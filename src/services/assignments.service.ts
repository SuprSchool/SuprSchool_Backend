import { createHash, randomUUID } from 'node:crypto';

import type {
  AssignmentsRepository,
  StoredAssignmentDetail,
  StoredAssignmentResource,
  StoredSubmission,
} from '../db/repositories/assignments.repository.js';
import type { Database } from '../db/client.js';
import { tenantCacheKey } from '../platform/cache/cache-store.js';
import { AppError } from '../lib/errors.js';
import { pointAwardRuleCodes, type PointAwardPort } from './point-award.service.js';
import type {
  AssignmentDetail,
  AssignmentIdentity,
  AssignmentResource,
  AssignmentSubmission,
  CreateAssignmentInput,
  CreateAssignmentResourceUploadInput,
  CreateSubmissionUploadInput,
  CursorPage,
  GradeSubmissionInput,
  StudentAssignmentItem,
  StudentAssignmentListQuery,
  SubmissionCompletion,
  SubmissionCompletionAction,
  SubmissionListQuery,
  SubmissionUploadSession,
  TeacherAssignmentItem,
  TeacherAssignmentListQuery,
  UpdateAssignmentInput,
} from '../types/assignments.js';

export type AcademicFileParent =
  | { parentId: string; parentType: 'assignment-resource' }
  | { parentId: string; parentType: 'assignment-submission' };

export interface AcademicFilePort {
  deleteObject(bucket: 'academic-files', objectPath: string): Promise<void>;
  finalizeUpload(identity: AssignmentIdentity, uploadSessionId: string): Promise<void>;
  prepareUpload(identity: AssignmentIdentity, input: AcademicFileParent & {
    uploadSessionId: string;
  }): Promise<{
    contentType: string;
    displayName: string;
    id: string;
    objectPath: string;
  }>;
  createReadUrl(bucket: 'academic-files', objectPath: string, expiresInSeconds: 900): Promise<string>;
  createUpload(identity: AssignmentIdentity, input: AcademicFileParent & {
    bucket: 'academic-files';
    contentType: string;
    displayName: string;
    sizeBytes: number;
  }): Promise<{
    expiresAt: string;
    id: string;
    objectPath: string;
    signedUploadUrl: string;
  }>;
}

export interface AcademicMutationPort {
  execute<T>(identity: AssignmentIdentity, input: {
    idempotencyKey: string;
    requestBody: unknown;
    successStatus: number;
    recover?: () => Promise<T | undefined>;
    work: () => Promise<T>;
  }): Promise<{ body: T; replayed: boolean; status: number }>;
}

export interface AssignmentOutboxPort {
  write(identity: AssignmentIdentity, event: {
    aggregateId: string;
    aggregateType: 'assignment' | 'assignment-submission';
    eventType: 'assignment.submitted' | 'assignment.graded' | 'assignment.reminder.requested';
    payload: Record<string, string>;
  }): Promise<void>;
  writeInTransaction(transaction: Database, identity: AssignmentIdentity, event: {
    aggregateId: string;
    aggregateType: 'assignment' | 'assignment-submission';
    eventType: 'assignment.submitted' | 'assignment.graded' | 'assignment.reminder.requested';
    payload: Record<string, string>;
  }): Promise<void>;
}

export interface AssignmentCachePort {
  get?(key: string): Promise<string | null>;
  set?(key: string, value: string, ttlSeconds: number): Promise<void>;
  invalidateStudentAssignments(input: {
    assignmentId: string;
    schoolId: string;
    studentId: string;
  }): Promise<void>;
}

export interface AssignmentsService {
  confirmResource(
    identity: AssignmentIdentity,
    assignmentId: string,
    uploadSessionId: string,
    idempotencyKey: string,
  ): Promise<AssignmentResource>;
  confirmSubmission(
    identity: AssignmentIdentity,
    assignmentId: string,
    uploadSessionId: string,
    idempotencyKey: string,
  ): Promise<AssignmentSubmission>;
  create(
    identity: AssignmentIdentity,
    classId: string,
    input: CreateAssignmentInput,
    idempotencyKey: string,
  ): Promise<AssignmentDetail>;
  createResourceUploadSession(
    identity: AssignmentIdentity,
    assignmentId: string,
    input: CreateAssignmentResourceUploadInput,
    idempotencyKey: string,
  ): Promise<SubmissionUploadSession>;
  createSubmissionUploadSession(
    identity: AssignmentIdentity,
    assignmentId: string,
    input: CreateSubmissionUploadInput,
    idempotencyKey: string,
  ): Promise<SubmissionUploadSession>;
  delete(
    identity: AssignmentIdentity,
    assignmentId: string,
    idempotencyKey: string,
  ): Promise<void>;
  deleteResource(
    identity: AssignmentIdentity,
    assignmentId: string,
    resourceId: string,
    idempotencyKey: string,
  ): Promise<void>;
  getForStudent(identity: AssignmentIdentity, assignmentId: string): Promise<AssignmentDetail>;
  getForTeacher(identity: AssignmentIdentity, assignmentId: string): Promise<AssignmentDetail>;
  grade(
    identity: AssignmentIdentity,
    submissionId: string,
    input: GradeSubmissionInput,
    idempotencyKey: string,
  ): Promise<AssignmentSubmission>;
  listForStudent(
    identity: AssignmentIdentity,
    query: StudentAssignmentListQuery,
  ): Promise<CursorPage<StudentAssignmentItem>>;
  listForTeacher(
    identity: AssignmentIdentity,
    classId: string,
    query: TeacherAssignmentListQuery,
  ): Promise<CursorPage<TeacherAssignmentItem>>;
  listSubmissions(
    identity: AssignmentIdentity,
    assignmentId: string,
    query: SubmissionListQuery,
  ): Promise<CursorPage<AssignmentSubmission>>;
  setCompletion(
    identity: AssignmentIdentity,
    submissionId: string,
    action: SubmissionCompletionAction,
  ): Promise<SubmissionCompletion>;
  remindAll(
    identity: AssignmentIdentity,
    assignmentId: string,
    idempotencyKey: string,
  ): Promise<{ requested: number }>;
  remindStudent(
    identity: AssignmentIdentity,
    assignmentId: string,
    studentId: string,
    idempotencyKey: string,
  ): Promise<{ studentId: string }>;
  update(
    identity: AssignmentIdentity,
    assignmentId: string,
    input: UpdateAssignmentInput,
    idempotencyKey: string,
  ): Promise<AssignmentDetail>;
}

export interface AssignmentsServiceDependencies {
  cache: AssignmentCachePort;
  clock?: () => Date;
  files: AcademicFilePort;
  mutations: AcademicMutationPort;
  outbox: AssignmentOutboxPort;
  pointAwards?: PointAwardPort;
  repository: AssignmentsRepository;
}

function notFound(): AppError {
  return new AppError('NOT_FOUND', 404, 'Assignment not found');
}

function cannotManage(): AppError {
  return new AppError('FORBIDDEN', 403, 'You do not have access to this resource');
}

function uploadConflict(): AppError {
  return new AppError('CONFLICT' as never, 409, 'A different upload has already been submitted');
}

function invalidGrade(): AppError {
  return new AppError('VALIDATION_ERROR', 400, 'Marks are invalid for this assignment');
}

const STUDENT_ASSIGNMENT_CACHE_TTL_SECONDS = 30;
const STUDENT_ASSIGNMENT_CACHE_VERSION_TTL_SECONDS = 300;

function studentAssignmentListVersionKey(schoolId: string, studentId: string): string {
  return tenantCacheKey(schoolId, 'assignments', 'student-list-version', studentId);
}

function studentAssignmentListCacheKey(
  identity: AssignmentIdentity,
  version: string,
  query: StudentAssignmentListQuery,
): string {
  const fingerprint = createHash('sha256').update(JSON.stringify({
    cursor: query.cursor ?? null,
    limit: query.limit,
    status: query.status ?? null,
    subjectId: query.subjectId ?? null,
  })).digest('base64url');
  return tenantCacheKey(
    identity.schoolId,
    'assignments',
    'student-list',
    identity.userId + ":" + version + ":" + fingerprint,
  );
}

interface CachedStudentAssignmentPage {
  audienceClassIds: ReadonlyArray<string>;
  page: CursorPage<StudentAssignmentItem>;
  /**
   * Bumped to 2 when `assignedAt` joined `StudentAssignmentItem`. Entries
   * written by the previous shape are rejected rather than served without a
   * field the contract declares as always present.
   */
  version: 2;
}

function parseCachedJson<T>(value: string): T | undefined {
  try { return JSON.parse(value) as T; } catch { return undefined; }
}

function readCachedStudentAssignmentPage(
  value: string,
  currentAudienceClassIds: ReadonlyArray<string>,
): CursorPage<StudentAssignmentItem> | undefined {
  try {
    const parsed: unknown = parseCachedJson(value);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const cached = parsed as Partial<CachedStudentAssignmentPage>;
    if (
      cached.version !== 2
      || !Array.isArray(cached.audienceClassIds)
      || !cached.audienceClassIds.every((classId) => typeof classId === 'string')
      || typeof cached.page !== 'object'
      || cached.page === null
      || !Array.isArray(cached.page.items)
    ) {
      return undefined;
    }
    const currentAudience = new Set(currentAudienceClassIds);
    if (
      cached.audienceClassIds.length !== currentAudienceClassIds.length
      || !cached.audienceClassIds.every((classId) => currentAudience.has(classId))
    ) {
      return undefined;
    }
    return cached.page;
  } catch {
    return undefined;
  }
}

function toSubmission(stored: StoredSubmission): AssignmentSubmission {
  return {
    completedAt: stored.completedAt,
    ...(stored.feedback === undefined ? {} : { feedback: stored.feedback }),
    ...(stored.gradedAt === undefined ? {} : { gradedAt: stored.gradedAt }),
    id: stored.id,
    ...(stored.marks === undefined ? {} : { marks: stored.marks }),
    studentId: stored.studentId,
    ...(stored.submittedAt === undefined ? {} : { submittedAt: stored.submittedAt }),
  };
}

export function createAssignmentsService({
  cache,
  clock = () => new Date(),
  files,
  mutations,
  outbox,
  pointAwards,
  repository,
}: AssignmentsServiceDependencies): AssignmentsService {
  async function toResource(stored: StoredAssignmentResource): Promise<AssignmentResource> {
    return {
      id: stored.id,
      name: stored.name,
      signedUrl: await files.createReadUrl('academic-files', stored.objectPath, 900),
    };
  }

  async function toDetail(stored: StoredAssignmentDetail): Promise<AssignmentDetail> {
    return {
      assignedAt: stored.assignedAt,
      classId: stored.classId,
      displayCode: stored.displayCode,
      dueAt: stored.dueAt,
      gradingType: stored.gradingType,
      id: stored.id,
      instructions: stored.instructions,
      isGradedAssignment: stored.isGradedAssignment,
      ...(stored.maxMarks === undefined ? {} : { maxMarks: stored.maxMarks }),
      resources: await Promise.all(stored.resources.map(toResource)),
      rubrics: stored.rubrics,
      subjectId: stored.subjectId,
      title: stored.title,
    };
  }

  async function cacheGet(key: string): Promise<string | null> {
    try { return await cache.get?.(key) ?? null; } catch { return null; }
  }

  async function cacheSet(key: string, value: string, ttlSeconds: number): Promise<void> {
    try { await cache.set?.(key, value, ttlSeconds); } catch { // Cache availability never changes the database response.
    }
  }

  async function invalidateStudentCache(assignmentId: string, studentId: string, schoolId: string): Promise<void> {
    try {
      await cache.invalidateStudentAssignments({ assignmentId, schoolId, studentId });
    } catch {
      // Cache is an optimization: the next scoped database read remains authoritative.
    }
  }

  async function invalidateAudienceCache(assignmentId: string, identity: AssignmentIdentity): Promise<void> {
    try {
      const studentIds = await repository.listStudentIdsForAssignment(identity, assignmentId);
      if (studentIds === undefined) return;
      await Promise.all(studentIds.map(async (studentId) => (
        invalidateStudentCache(assignmentId, studentId, identity.schoolId)
      )));
    } catch {
      // Cache invalidation is best-effort; scoped database reads stay authoritative.
    }
  }

  return {
    async listForStudent(identity, query) {
      // The database membership read is deliberately before every cache operation: it is the
      // current authorization snapshot, while cache contents are only an optimization.
      const audienceClassIds = await repository.listActiveClassIdsForStudent(identity);
      if (audienceClassIds.length === 0 || cache.get === undefined || cache.set === undefined) {
        return repository.listForStudent(identity, query, clock());
      }

      const versionKey = studentAssignmentListVersionKey(identity.schoolId, identity.userId);
      let version = await cacheGet(versionKey);
      if (version === null || version.length === 0) {
        version = randomUUID();
        await cacheSet(versionKey, version, STUDENT_ASSIGNMENT_CACHE_VERSION_TTL_SECONDS);
      }
      const key = studentAssignmentListCacheKey(identity, version, query);
      const cached = await cacheGet(key);
      if (cached !== null) {
        const page = readCachedStudentAssignmentPage(cached, audienceClassIds);
        if (page !== undefined) return page;
      }

      const page = await repository.listForStudent(identity, query, clock());
      // Do not resurrect an invalidated cache namespace if a mutation committed during this read.
      if (await cacheGet(versionKey) === version) {
        const value: CachedStudentAssignmentPage = { audienceClassIds, page, version: 2 };
        await cacheSet(key, JSON.stringify(value), STUDENT_ASSIGNMENT_CACHE_TTL_SECONDS);
      }
      return page;
    },

    async getForStudent(identity, assignmentId) {
      const assignment = await repository.findForStudent(identity, assignmentId);
      if (assignment === undefined) throw notFound();
      const key = tenantCacheKey(identity.schoolId, "assignments", "detail", assignmentId);
      const cached = await cacheGet(key);
      const cachedDetail = cached === null ? undefined : parseCachedJson<AssignmentDetail>(cached);
      // An entry written before `assignedAt` existed is a miss, not a hit: the
      // field is declared always-present, so serving it absent would break the
      // contract for the 30 seconds such an entry can survive a deploy.
      if (cachedDetail !== undefined && typeof cachedDetail.assignedAt === 'string') {
        return cachedDetail;
      }
      const detail = await toDetail(assignment);
      await cacheSet(key, JSON.stringify(detail), 30);
      return detail;
    },

    async getForTeacher(identity, assignmentId) {
      const assignment = await repository.findForTeacher(identity, assignmentId);
      if (assignment === undefined) throw notFound();
      return toDetail(assignment);
    },

    async listForTeacher(identity, classId, query) {
      return repository.listForTeacher(identity, classId, query);
    },

    async create(identity, classId, input, idempotencyKey) {
      const result = await mutations.execute(identity, {
        idempotencyKey,
        requestBody: { classId, ...input },
        successStatus: 201,
        work: async () => {
          const assignment = await repository.create(identity, classId, input);
          if (assignment === undefined) throw cannotManage();
          return toDetail(assignment);
        },
      });
      await invalidateAudienceCache(result.body.id, identity);
      return result.body;
    },

    async update(identity, assignmentId, input, idempotencyKey) {
      const result = await mutations.execute(identity, {
        idempotencyKey,
        requestBody: input,
        successStatus: 200,
        work: async () => {
          const assignment = await repository.update(identity, assignmentId, input);
          if (assignment === undefined) throw notFound();
          return toDetail(assignment);
        },
      });
      await invalidateAudienceCache(result.body.id, identity);
      return result.body;
    },

    async delete(identity, assignmentId, idempotencyKey) {
      const audience = await repository.listStudentIdsForAssignment(identity, assignmentId);
      await mutations.execute(identity, {
        idempotencyKey,
        requestBody: {},
        successStatus: 204,
        work: async () => {
          if (!await repository.delete(identity, assignmentId, clock())) throw notFound();
          return {};
        },
      });
      if (audience !== undefined) {
        await Promise.all(audience.map(async (studentId) => (
          invalidateStudentCache(assignmentId, studentId, identity.schoolId)
        )));
      }
    },

    async createSubmissionUploadSession(identity, assignmentId, input, idempotencyKey) {
      const result = await mutations.execute(identity, {
        idempotencyKey,
        requestBody: input,
        successStatus: 201,
        work: async () => {
          const draft = await repository.upsertSubmissionDraft(identity, assignmentId);
          if (draft === undefined) throw notFound();
          const session = await files.createUpload(identity, {
            bucket: 'academic-files',
            contentType: input.contentType,
            displayName: input.displayName,
            parentId: draft.id,
            parentType: 'assignment-submission',
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

    async confirmSubmission(identity, assignmentId, uploadSessionId, idempotencyKey) {
      const result = await mutations.execute(identity, {
        idempotencyKey,
        requestBody: { uploadSessionId },
        successStatus: 201,
        recover: async () => {
          const submission = await repository.findSubmissionForUpload(identity, assignmentId, uploadSessionId);
          if (submission === undefined) return undefined;
          await files.finalizeUpload(identity, uploadSessionId);
          await invalidateStudentCache(assignmentId, submission.studentId, identity.schoolId);
          return toSubmission(submission);
        },
        work: async () => {
          const submission = await repository.withTransaction(async (transactionRepository, transaction) => {
            const draft = await transactionRepository.upsertSubmissionDraft(identity, assignmentId);
            if (draft === undefined) throw notFound();
            const session = await files.prepareUpload(identity, {
              parentId: draft.id,
              parentType: 'assignment-submission',
              uploadSessionId,
            });
            const confirmed = await transactionRepository.confirmSubmission({
              assignmentId,
              displayName: session.displayName,
              identity,
              objectPath: session.objectPath,
              submittedAt: clock(),
              uploadSessionId,
            });
            if (confirmed === undefined) throw notFound();
            if (confirmed.kind === "conflict") throw uploadConflict();
            if (confirmed.kind === "attached") {
              await outbox.writeInTransaction(transaction, identity, {
                aggregateId: confirmed.submission.id,
                aggregateType: "assignment-submission",
                eventType: "assignment.submitted",
                payload: { assignmentId, studentId: confirmed.submission.studentId },
              });
            }
            return confirmed.submission;
          });
          await files.finalizeUpload(identity, uploadSessionId);
          await invalidateStudentCache(assignmentId, submission.studentId, identity.schoolId);
          return toSubmission(submission);
        },
      });
      await pointAwards?.awardIfAbsent({
        metadata: { assignmentId },
        occurredAt: result.body.submittedAt === undefined ? clock() : new Date(result.body.submittedAt),
        recipientUserId: result.body.studentId,
        ruleCode: pointAwardRuleCodes.assignmentSubmitted,
        schoolId: identity.schoolId,
        sourceId: result.body.id,
        sourceType: 'assignment_submission',
      });
      return result.body;
    },

    async deleteResource(identity, assignmentId, resourceId, idempotencyKey) {
      await mutations.execute(identity, {
        idempotencyKey,
        requestBody: { resourceId },
        successStatus: 204,
        work: async () => {
          const resource = await repository.findResourceForDeletion(identity, assignmentId, resourceId);
          if (resource === undefined) {
            if (!await repository.canManage(identity, assignmentId)) throw notFound();
            return;
          }
          await files.deleteObject('academic-files', resource.objectPath);
          await repository.deleteResource(identity, assignmentId, resourceId);
        },
      });
      await invalidateAudienceCache(assignmentId, identity);
    },

    async listSubmissions(identity, assignmentId, query) {
      const page = await repository.listSubmissions(identity, assignmentId, query);
      if (page === undefined) throw notFound();
      return { ...page, items: page.items.map(toSubmission) };
    },

    async grade(identity, submissionId, input, idempotencyKey) {
      const result = await mutations.execute(identity, {
        idempotencyKey,
        requestBody: input,
        successStatus: 200,
        work: async () => {
          const { gradeable, submission } = await repository.withTransaction(
            async (transactionRepository, transaction) => {
              const gradeable = await transactionRepository.findGradeableSubmission(identity, submissionId);
              if (gradeable === undefined) throw notFound();
              if (
                gradeable.gradingType !== 'Numeric'
                || gradeable.maxMarks === undefined
                || input.marks > gradeable.maxMarks
              ) {
                throw invalidGrade();
              }
              const submission = await transactionRepository.grade(identity, submissionId, input, clock());
              if (submission === undefined) throw notFound();
              await outbox.writeInTransaction(transaction, identity, {
                aggregateId: submission.id,
                aggregateType: 'assignment-submission',
                eventType: 'assignment.graded',
                payload: { assignmentId: gradeable.assignmentId, studentId: gradeable.studentId },
              });
              return { gradeable, submission };
            },
          );
          await invalidateStudentCache(gradeable.assignmentId, gradeable.studentId, identity.schoolId);
          return toSubmission(submission);
        },
      });
      return result.body;
    },

    // No idempotency-store wrapper: both directions are naturally idempotent, so a
    // replay is indistinguishable from the first call. Completion carries no
    // outbox event either — it is a teacher-side bookkeeping flag, not something
    // the student is notified about, and it is independent of grading.
    // A submission that is missing, in another school, or on an assignment this
    // teacher no longer owns is one 404 — the guard must not confirm which.
    async setCompletion(identity, submissionId, action) {
      const completion = await repository.setSubmissionCompletion(
        identity, submissionId, action, clock(),
      );
      if (completion === undefined) throw notFound();
      return completion;
    },

    async remindStudent(identity, assignmentId, studentId, idempotencyKey) {
      const result = await mutations.execute(identity, {
        idempotencyKey,
        requestBody: { studentId },
        successStatus: 202,
        work: async () => {
          await repository.withTransaction(async (transactionRepository, transaction) => {
            if (!await transactionRepository.studentCanBeReminded(identity, assignmentId, studentId)) {
              throw cannotManage();
            }
            await outbox.writeInTransaction(transaction, identity, {
              aggregateId: assignmentId,
              aggregateType: 'assignment',
              eventType: 'assignment.reminder.requested',
              payload: { assignmentId, studentId },
            });
          });
          return { studentId };
        },
      });
      return result.body;
    },

    async remindAll(identity, assignmentId, idempotencyKey) {
      const result = await mutations.execute(identity, {
        idempotencyKey,
        requestBody: {},
        successStatus: 202,
        work: async () => {
          const students = await repository.withTransaction(async (transactionRepository, transaction) => {
            const students = await transactionRepository.listReminderStudents(identity, assignmentId);
            if (students === undefined) throw cannotManage();
            for (const studentId of students) {
              await outbox.writeInTransaction(transaction, identity, {
                aggregateId: assignmentId,
                aggregateType: 'assignment',
                eventType: 'assignment.reminder.requested',
                payload: { assignmentId, studentId },
              });
            }
            return students;
          });
          return { requested: students.length };
        },
      });
      return result.body;
    },

    async createResourceUploadSession(identity, assignmentId, input, idempotencyKey) {
      const result = await mutations.execute(identity, {
        idempotencyKey,
        requestBody: input,
        successStatus: 201,
        work: async () => {
          if (!await repository.canManage(identity, assignmentId)) throw cannotManage();
          const session = await files.createUpload(identity, {
            bucket: 'academic-files',
            contentType: input.contentType,
            displayName: input.displayName,
            parentId: assignmentId,
            parentType: 'assignment-resource',
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

    async confirmResource(identity, assignmentId, uploadSessionId, idempotencyKey) {
      const result = await mutations.execute(identity, {
        idempotencyKey,
        requestBody: { uploadSessionId },
        successStatus: 201,
        recover: async () => {
          const resource = await repository.findResourceForUpload(identity, assignmentId, uploadSessionId);
          if (resource === undefined) return undefined;
          await files.finalizeUpload(identity, uploadSessionId);
          return toResource(resource);
        },
        work: async () => {
          if (!await repository.canManage(identity, assignmentId)) throw cannotManage();
          const session = await files.prepareUpload(identity, {
            parentId: assignmentId,
            parentType: 'assignment-resource',
            uploadSessionId,
          });
          const resource = await repository.insertResource({
            assignmentId,
            displayName: session.displayName,
            identity,
            objectPath: session.objectPath,
            uploadSessionId,
          });
          if (resource === undefined) throw notFound();
          await files.finalizeUpload(identity, uploadSessionId);
          return toResource(resource);
        },
      });
      await invalidateAudienceCache(assignmentId, identity);
      return result.body;
    },
  };
}
