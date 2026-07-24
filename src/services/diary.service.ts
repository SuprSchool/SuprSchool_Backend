import type { DiaryRepository } from '../db/repositories/diary.repository.js';
import type { DiaryOutbox } from '../async/diary/diary-outbox.js';
import { AppError } from '../lib/errors.js';
import { IdempotencyConflictError } from '../platform/idempotency/idempotency-store.js';
import type { IdempotencyStore } from '../platform/idempotency/idempotency-store.js';
import type { QueueClient } from '../platform/queue/queue-client.js';
import type {
  CreateDiaryInput,
  CursorPage,
  CursorPageInput,
  DiaryRecord,
  StudentDiaryDto,
  TeacherDiaryDto,
  UpdateDiaryInput,
} from '../types/diary.js';

export interface DiaryServiceDependencies {
  idempotency: IdempotencyStore;
  outbox: Pick<DiaryOutbox, 'dispatchPending'>;
  queue: QueueClient;
  repository: DiaryRepository;
}

export interface DiaryService {
  listForStudent(
    userId: string,
    schoolId: string,
    subjectId: string,
    page: CursorPageInput,
  ): Promise<CursorPage<StudentDiaryDto>>;
  listForTeacher(
    teacherId: string,
    classId: string,
    page: CursorPageInput,
  ): Promise<CursorPage<TeacherDiaryDto>>;
  create(
    teacherId: string,
    classId: string,
    input: CreateDiaryInput,
    idempotencyKey: string,
  ): Promise<TeacherDiaryDto>;
  update(
    teacherId: string,
    diaryId: string,
    input: UpdateDiaryInput,
    idempotencyKey: string,
  ): Promise<TeacherDiaryDto>;
}

function forbidden(message: string): AppError {
  return new AppError('FORBIDDEN', 403, message);
}

function completedDiary(body: unknown): TeacherDiaryDto {
  return body as TeacherDiaryDto;
}

function toTeacherDiaryDto(record: DiaryRecord): TeacherDiaryDto {
  return {
    classId: record.classId,
    classSubjectId: record.classSubjectId,
    description: record.description,
    id: record.id,
    keyPoints: record.keyPoints,
    occurredOn: record.occurredOn,
    periodLabel: record.periodLabel,
    teacherId: record.teacherId,
    title: record.title,
    updatedAt: record.updatedAt,
  };
}

export function createDiaryService({
  idempotency,
  outbox,
  queue,
  repository,
}: DiaryServiceDependencies): DiaryService {
  return {
    async listForStudent(
      userId: string,
      schoolId: string,
      subjectId: string,
      page: CursorPageInput,
    ): Promise<CursorPage<StudentDiaryDto>> {
      if (!await repository.findStudentSubjectAccess(userId, schoolId, subjectId)) {
        throw forbidden('You are not an active member of this subject class');
      }

      return repository.listForStudent(userId, schoolId, subjectId, page);
    },

    async listForTeacher(
      teacherId: string,
      classId: string,
      page: CursorPageInput,
    ): Promise<CursorPage<TeacherDiaryDto>> {
      if (await repository.findTeacherClassAccess(teacherId, classId) === undefined) {
        throw forbidden('You are not assigned to this class');
      }

      return repository.listForTeacher(teacherId, classId, page);
    },

    async create(
      teacherId: string,
      classId: string,
      input: CreateDiaryInput,
      idempotencyKey: string,
    ): Promise<TeacherDiaryDto> {
      const access = await repository.findTeacherClassSubjectAccess(
        teacherId,
        classId,
        input.classSubjectId,
      );
      if (access === undefined) {
        throw forbidden('You are not assigned to this class subject');
      }

      const request = {
        key: idempotencyKey,
        requestBody: { classId, input, operation: 'create-diary' },
        schoolId: access.schoolId,
        userId: teacherId,
      };
      const claim = await claimIdempotency(idempotency, request);
      if (claim.state === 'completed') {
        await outbox.dispatchPending(queue);
        return completedDiary(claim.response.body);
      }
      if (claim.state === 'in_progress') {
        throw new AppError('VALIDATION_ERROR', 409, 'An identical diary request is still in progress');
      }
      if (claim.state === 'expired') {
        throw new AppError('VALIDATION_ERROR', 409, 'The diary request expired; retry it with a new idempotency key');
      }

      const committedDiary = await repository.create(teacherId, classId, input, {
        key: idempotencyKey,
        requestHash: claim.requestHash,
        status: 201,
        userId: teacherId,
      });
      const diary = toTeacherDiaryDto(committedDiary);
      await outbox.dispatchPending(queue);
      return diary;
    },

    async update(
      teacherId: string,
      diaryId: string,
      input: UpdateDiaryInput,
      idempotencyKey: string,
    ): Promise<TeacherDiaryDto> {
      const access = await repository.findTeacherDiaryAccess(teacherId, diaryId);
      if (access === undefined) {
        throw forbidden('You are not assigned to this diary entry');
      }

      const request = {
        key: idempotencyKey,
        requestBody: { diaryId, input, operation: 'update-diary' },
        schoolId: access.schoolId,
        userId: teacherId,
      };
      const claim = await claimIdempotency(idempotency, request);
      if (claim.state === 'completed') {
        await outbox.dispatchPending(queue);
        return completedDiary(claim.response.body);
      }
      if (claim.state === 'in_progress') {
        throw new AppError('VALIDATION_ERROR', 409, 'An identical diary request is still in progress');
      }
      if (claim.state === 'expired') {
        throw new AppError('VALIDATION_ERROR', 409, 'The diary request expired; retry it with a new idempotency key');
      }

      const committedDiary = await repository.update(teacherId, diaryId, input, {
        key: idempotencyKey,
        requestHash: claim.requestHash,
        status: 200,
        userId: teacherId,
      });
      const diary = toTeacherDiaryDto(committedDiary);
      await outbox.dispatchPending(queue);
      return diary;
    },
  };
}

async function claimIdempotency(
  idempotency: IdempotencyStore,
  request: {
    key: string;
    requestBody: unknown;
    schoolId: string;
    userId: string;
  },
) {
  try {
    return await idempotency.claim(request);
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      throw new AppError('VALIDATION_ERROR', 409, error.message);
    }
    throw error;
  }
}
