import type { DiaryRepository } from '../db/repositories/diary.repository.js';
import type { DiaryOutbox } from '../async/diary/diary-outbox.js';
import { AppError } from '../lib/errors.js';
import { IdempotencyConflictError } from '../platform/idempotency/idempotency-store.js';
import type { IdempotencyStore } from '../platform/idempotency/idempotency-store.js';
import type { QueueClient } from '../platform/queue/queue-client.js';
import { isOccurrenceLocked, todayIsoDate } from '../types/diary.js';
import type {
  CreateDiaryInput,
  CursorPage,
  CursorPageInput,
  DeletedDiaryDto,
  DiaryActor,
  DiaryEntryView,
  DiaryRecord,
  StudentDiaryDto,
  TeacherDiaryDto,
  TeacherDiaryListItem,
  TeacherDiaryPageInput,
  UpdateDiaryInput,
} from '../types/diary.js';

export interface DiaryServiceDependencies {
  idempotency: IdempotencyStore;
  outbox: Pick<DiaryOutbox, 'dispatchPending'>;
  queue: QueueClient;
  repository: DiaryRepository;
}

export interface DiaryService {
  deleteEntry(diaryId: string, actor: DiaryActor): Promise<DeletedDiaryDto>;
  listForStudent(
    userId: string,
    schoolId: string,
    subjectId: string,
    page: CursorPageInput,
  ): Promise<CursorPage<StudentDiaryDto>>;
  listForTeacher(
    teacherId: string,
    schoolId: string,
    classId: string,
    page: TeacherDiaryPageInput,
  ): Promise<CursorPage<TeacherDiaryListItem>>;
  create(
    teacherId: string,
    classId: string,
    input: CreateDiaryInput,
    idempotencyKey: string,
  ): Promise<DiaryEntryView>;
  update(
    teacherId: string,
    diaryId: string,
    input: UpdateDiaryInput,
    idempotencyKey: string,
  ): Promise<DiaryEntryView>;
}

function forbidden(message: string): AppError {
  return new AppError('FORBIDDEN', 403, message);
}

function completedDiary(body: unknown): TeacherDiaryDto {
  return body as TeacherDiaryDto;
}

/**
 * Derived per response rather than stored, so a replayed idempotent write
 * reports the lock as it stands now rather than as it stood when committed.
 */
function withLock(diary: TeacherDiaryDto): DiaryEntryView {
  return { ...diary, occurrenceLocked: isOccurrenceLocked(diary.occurredOn, todayIsoDate()) };
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

    async deleteEntry(diaryId: string, actor: DiaryActor): Promise<DeletedDiaryDto> {
      const deleted = await repository.softDelete(diaryId, actor);
      if (deleted === undefined) {
        // An entry in another school, or another teacher's entry, is not
        // disclosed as forbidden — it is simply not there for this teacher.
        throw new AppError('NOT_FOUND', 404, 'Diary entry not found');
      }

      return deleted;
    },

    async listForTeacher(
      teacherId: string,
      schoolId: string,
      classId: string,
      page: TeacherDiaryPageInput,
    ): Promise<CursorPage<TeacherDiaryListItem>> {
      if (await repository.findTeacherClassAccess(teacherId, classId) === undefined) {
        throw forbidden('You are not assigned to this class');
      }

      const today = todayIsoDate();
      const entries = await repository.listForTeacher(teacherId, schoolId, classId, page);
      const items: TeacherDiaryListItem[] = entries.items.map((entry) => ({
        ...entry,
        missing: false,
        occurrenceLocked: isOccurrenceLocked(entry.occurredOn, today),
      }));

      // Uncovered periods only make sense against a bounded window, and only on
      // the first page — a later page would re-emit markers the caller has seen.
      if (page.from === undefined || page.to === undefined || page.cursor !== undefined) {
        return { items, nextCursor: entries.nextCursor };
      }

      const uncovered = await repository.listUncoveredScheduledPeriods(
        teacherId,
        schoolId,
        classId,
        { from: page.from, to: page.to },
      );
      const merged: TeacherDiaryListItem[] = [
        ...items,
        ...uncovered.map((period) => ({ ...period, missing: true as const })),
      ];
      // Stable sort: entries keep their query order and precede the markers of
      // the same day, because they were pushed first.
      merged.sort((left, right) => right.occurredOn.localeCompare(left.occurredOn));

      return { items: merged, nextCursor: entries.nextCursor };
    },

    async create(
      teacherId: string,
      classId: string,
      input: CreateDiaryInput,
      idempotencyKey: string,
    ): Promise<DiaryEntryView> {
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
        return withLock(completedDiary(claim.response.body));
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
      return withLock(diary);
    },

    async update(
      teacherId: string,
      diaryId: string,
      input: UpdateDiaryInput,
      idempotencyKey: string,
    ): Promise<DiaryEntryView> {
      const access = await repository.findTeacherDiaryAccess(teacherId, diaryId);
      if (access === undefined) {
        throw forbidden('You are not assigned to this diary entry');
      }

      // The same window the read model reports as `occurrenceLocked`: once the
      // occurrence date has passed the entry may still be corrected, but it may
      // no longer be moved to another date or period.
      //
      // This turns on whether the values actually differ, not on whether the
      // fields were sent. A correction that echoes the stored date and period
      // back unchanged is exactly what an edit form submits, and refusing it
      // would make every past entry uneditable.
      const movesDate = input.occurredOn !== undefined && input.occurredOn !== access.occurredOn;
      const movesPeriod = input.periodLabel !== undefined
        && input.periodLabel !== access.periodLabel;
      if (isOccurrenceLocked(access.occurredOn, todayIsoDate()) && (movesDate || movesPeriod)) {
        throw new AppError(
          'CONFLICT',
          409,
          'A past diary entry cannot be moved to another date or period',
        );
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
        return withLock(completedDiary(claim.response.body));
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
      return withLock(diary);
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
