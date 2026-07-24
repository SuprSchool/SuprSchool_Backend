import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';

import type { Database } from '../client.js';
import type { DiaryOutboxWriter } from '../../async/diary/diary-outbox.js';
import { createDiaryPublishedMessage } from '../../async/diary/diary-published.message.js';
import { classDiaryEntries } from '../schema/diary.js';
import { classMembers, classSubjects, userProfiles, userRoles } from '../schema/core.js';
import { AppError } from '../../lib/errors.js';
import { encodeDiaryCursor } from '../../types/diary.js';
import type {
  CreateDiaryInput,
  CursorPage,
  CursorPageInput,
  DiaryRecord,
  StudentDiaryDto,
  TeacherDiaryDto,
  UpdateDiaryInput,
} from '../../types/diary.js';

interface TeacherClassAccess {
  schoolId: string;
}

export interface DiaryIdempotencyCompletion {
  key: string;
  requestHash: string;
  status: 200 | 201;
  userId: string;
}

interface DiaryRow {
  classId: string;
  classSubjectId: string;
  description: string;
  id: string;
  keyPoints: string[];
  occurredOn: string;
  periodLabel: string;
  revision: number;
  schoolId: string;
  teacherId: string;
  title: string;
  updatedAt: Date;
}

export interface DiaryRepository {
  findStudentSubjectAccess(
    userId: string,
    schoolId: string,
    subjectId: string,
  ): Promise<boolean>;
  findTeacherClassAccess(teacherId: string, classId: string): Promise<TeacherClassAccess | undefined>;
  findTeacherClassSubjectAccess(
    teacherId: string,
    classId: string,
    classSubjectId: string,
  ): Promise<TeacherClassAccess | undefined>;
  findTeacherDiaryAccess(teacherId: string, diaryId: string): Promise<TeacherClassAccess | undefined>;
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
    idempotency: DiaryIdempotencyCompletion,
  ): Promise<DiaryRecord>;
  update(
    teacherId: string,
    diaryId: string,
    input: UpdateDiaryInput,
    idempotency: DiaryIdempotencyCompletion,
  ): Promise<DiaryRecord>;
}

function toDiaryRecord(row: DiaryRow): DiaryRecord {
  return {
    classId: row.classId,
    classSubjectId: row.classSubjectId,
    description: row.description,
    id: row.id,
    keyPoints: row.keyPoints,
    occurredOn: row.occurredOn,
    periodLabel: row.periodLabel,
    revision: row.revision,
    schoolId: row.schoolId,
    teacherId: row.teacherId,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toTeacherDiaryDto(row: DiaryRow | DiaryRecord): TeacherDiaryDto {
  return {
    classId: row.classId,
    classSubjectId: row.classSubjectId,
    description: row.description,
    id: row.id,
    keyPoints: row.keyPoints,
    occurredOn: row.occurredOn,
    periodLabel: row.periodLabel,
    teacherId: row.teacherId,
    title: row.title,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
  };
}

function toCursorPage<T extends { id: string; occurredOn: string }>(
  rows: T[],
  limit: number,
): CursorPage<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);

  return {
    items,
    nextCursor: rows.length > limit && last !== undefined
      ? encodeDiaryCursor({ id: last.id, occurredOn: last.occurredOn })
      : null,
  };
}

type DiaryTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function completeDiaryIdempotency(
  transaction: DiaryTransaction,
  diary: DiaryRecord,
  idempotency: DiaryIdempotencyCompletion,
): Promise<void> {
  const response = toTeacherDiaryDto(diary);
  const rows = await transaction.execute(sql<{ id: string }>`
    update public.api_idempotency_keys
    set response_status = ${idempotency.status},
        response_body = ${JSON.stringify(response)}::jsonb,
        completed_at = now()
    where school_id = ${diary.schoolId}::uuid
      and user_id = ${idempotency.userId}::uuid
      and idempotency_key = ${idempotency.key}
      and request_hash = ${idempotency.requestHash}
      and response_status is null
    returning id
  `);
  const completed = rows as unknown as ReadonlyArray<{ id: string }>;
  if (completed.length !== 1) {
    throw new AppError("INTERNAL_ERROR", 500, "Unable to complete diary idempotency record");
  }
}

export class DrizzleDiaryRepository implements DiaryRepository {
  public constructor(
    private readonly db: Database,
    private readonly outbox: DiaryOutboxWriter,
  ) {}

  public async findStudentSubjectAccess(
    userId: string,
    schoolId: string,
    subjectId: string,
  ): Promise<boolean> {
    const [access] = await this.db
      .select({ classId: classMembers.classId })
      .from(classMembers)
      .innerJoin(
        classSubjects,
        and(
          eq(classSubjects.classId, classMembers.classId),
          eq(classSubjects.schoolId, classMembers.schoolId),
          eq(classSubjects.subjectId, subjectId),
        ),
      )
      .innerJoin(
        userRoles,
        and(
          eq(userRoles.userId, userId),
          eq(userRoles.schoolId, classMembers.schoolId),
          eq(userRoles.role, 'student'),
          eq(userRoles.isActive, true),
        ),
      )
      .where(and(
        eq(classMembers.studentId, userId),
        eq(classMembers.schoolId, schoolId),
        eq(classMembers.isActive, true),
      ))
      .limit(1);

    return access !== undefined;
  }

  public async findTeacherClassAccess(
    teacherId: string,
    classId: string,
  ): Promise<TeacherClassAccess | undefined> {
    const [access] = await this.db
      .select({ schoolId: classSubjects.schoolId })
      .from(classSubjects)
      .innerJoin(
        userRoles,
        and(
          eq(userRoles.userId, teacherId),
          eq(userRoles.schoolId, classSubjects.schoolId),
          eq(userRoles.role, 'teacher'),
          eq(userRoles.isActive, true),
        ),
      )
      .where(and(
        eq(classSubjects.classId, classId),
        eq(classSubjects.teacherId, teacherId),
      ))
      .limit(1);

    return access;
  }

  public async findTeacherClassSubjectAccess(
    teacherId: string,
    classId: string,
    classSubjectId: string,
  ): Promise<TeacherClassAccess | undefined> {
    const [access] = await this.db
      .select({ schoolId: classSubjects.schoolId })
      .from(classSubjects)
      .innerJoin(
        userRoles,
        and(
          eq(userRoles.userId, teacherId),
          eq(userRoles.schoolId, classSubjects.schoolId),
          eq(userRoles.role, 'teacher'),
          eq(userRoles.isActive, true),
        ),
      )
      .where(and(
        eq(classSubjects.id, classSubjectId),
        eq(classSubjects.classId, classId),
        eq(classSubjects.teacherId, teacherId),
      ))
      .limit(1);

    return access;
  }

  public async findTeacherDiaryAccess(
    teacherId: string,
    diaryId: string,
  ): Promise<TeacherClassAccess | undefined> {
    const [access] = await this.db
      .select({ schoolId: classDiaryEntries.schoolId })
      .from(classDiaryEntries)
      .innerJoin(
        classSubjects,
        and(
          eq(classSubjects.id, classDiaryEntries.classSubjectId),
          eq(classSubjects.schoolId, classDiaryEntries.schoolId),
        ),
      )
      .innerJoin(
        userRoles,
        and(
          eq(userRoles.userId, teacherId),
          eq(userRoles.schoolId, classDiaryEntries.schoolId),
          eq(userRoles.role, 'teacher'),
          eq(userRoles.isActive, true),
        ),
      )
      .where(and(
        eq(classDiaryEntries.id, diaryId),
        isNull(classDiaryEntries.deletedAt),
        eq(classSubjects.teacherId, teacherId),
      ))
      .limit(1);

    return access;
  }

  public async listForStudent(
    userId: string,
    schoolId: string,
    subjectId: string,
    page: CursorPageInput,
  ): Promise<CursorPage<StudentDiaryDto>> {
    const rows = await this.db
      .select({
        classId: classDiaryEntries.classId,
        classSubjectId: classDiaryEntries.classSubjectId,
        description: classDiaryEntries.description,
        id: classDiaryEntries.id,
        keyPoints: classDiaryEntries.keyPoints,
        occurredOn: classDiaryEntries.occurredOn,
        periodLabel: classDiaryEntries.periodLabel,
        revision: classDiaryEntries.revision,
        schoolId: classDiaryEntries.schoolId,
        teacherId: classDiaryEntries.teacherId,
        teacherName: userProfiles.displayName,
        title: classDiaryEntries.title,
        updatedAt: classDiaryEntries.updatedAt,
      })
      .from(classDiaryEntries)
      .innerJoin(
        classSubjects,
        and(
          eq(classSubjects.id, classDiaryEntries.classSubjectId),
          eq(classSubjects.schoolId, classDiaryEntries.schoolId),
          eq(classSubjects.subjectId, subjectId),
        ),
      )
      .innerJoin(
        classMembers,
        and(
          eq(classMembers.classId, classDiaryEntries.classId),
          eq(classMembers.schoolId, classDiaryEntries.schoolId),
          eq(classMembers.studentId, userId),
          eq(classMembers.isActive, true),
        ),
      )
      .innerJoin(
        userRoles,
        and(
          eq(userRoles.userId, userId),
          eq(userRoles.schoolId, classDiaryEntries.schoolId),
          eq(userRoles.role, 'student'),
          eq(userRoles.isActive, true),
        ),
      )
      .innerJoin(
        userProfiles,
        and(
          eq(userProfiles.id, classDiaryEntries.teacherId),
          eq(userProfiles.schoolId, classDiaryEntries.schoolId),
        ),
      )
      .where(and(
        eq(classDiaryEntries.schoolId, schoolId),
        isNull(classDiaryEntries.deletedAt),
        page.cursor === undefined ? undefined : or(
          lt(classDiaryEntries.occurredOn, page.cursor.occurredOn),
          and(
            eq(classDiaryEntries.occurredOn, page.cursor.occurredOn),
            lt(classDiaryEntries.id, page.cursor.id),
          ),
        ),
      ))
      .orderBy(desc(classDiaryEntries.occurredOn), desc(classDiaryEntries.id))
      .limit(page.limit + 1);

    return toCursorPage(rows.map((row) => ({
      ...toTeacherDiaryDto(row),
      teacherName: row.teacherName,
    })), page.limit);
  }

  public async listForTeacher(
    teacherId: string,
    classId: string,
    page: CursorPageInput,
  ): Promise<CursorPage<TeacherDiaryDto>> {
    const rows = await this.db
      .select({
        classId: classDiaryEntries.classId,
        classSubjectId: classDiaryEntries.classSubjectId,
        description: classDiaryEntries.description,
        id: classDiaryEntries.id,
        keyPoints: classDiaryEntries.keyPoints,
        occurredOn: classDiaryEntries.occurredOn,
        periodLabel: classDiaryEntries.periodLabel,
        revision: classDiaryEntries.revision,
        schoolId: classDiaryEntries.schoolId,
        teacherId: classDiaryEntries.teacherId,
        title: classDiaryEntries.title,
        updatedAt: classDiaryEntries.updatedAt,
      })
      .from(classDiaryEntries)
      .innerJoin(
        classSubjects,
        and(
          eq(classSubjects.id, classDiaryEntries.classSubjectId),
          eq(classSubjects.schoolId, classDiaryEntries.schoolId),
          eq(classSubjects.teacherId, teacherId),
        ),
      )
      .innerJoin(
        userRoles,
        and(
          eq(userRoles.userId, teacherId),
          eq(userRoles.schoolId, classDiaryEntries.schoolId),
          eq(userRoles.role, 'teacher'),
          eq(userRoles.isActive, true),
        ),
      )
      .where(and(
        eq(classDiaryEntries.classId, classId),
        isNull(classDiaryEntries.deletedAt),
        page.cursor === undefined ? undefined : or(
          lt(classDiaryEntries.occurredOn, page.cursor.occurredOn),
          and(
            eq(classDiaryEntries.occurredOn, page.cursor.occurredOn),
            lt(classDiaryEntries.id, page.cursor.id),
          ),
        ),
      ))
      .orderBy(desc(classDiaryEntries.occurredOn), desc(classDiaryEntries.id))
      .limit(page.limit + 1);

    return toCursorPage(rows.map(toTeacherDiaryDto), page.limit);
  }

  public async create(
    teacherId: string,
    classId: string,
    input: CreateDiaryInput,
    idempotency: DiaryIdempotencyCompletion,
  ): Promise<DiaryRecord> {
    return this.db.transaction(async (transaction) => {
      const [assignment] = await transaction
        .select({ schoolId: classSubjects.schoolId })
        .from(classSubjects)
        .innerJoin(
          userRoles,
          and(
            eq(userRoles.userId, teacherId),
            eq(userRoles.schoolId, classSubjects.schoolId),
            eq(userRoles.role, 'teacher'),
            eq(userRoles.isActive, true),
          ),
        )
        .where(and(
          eq(classSubjects.id, input.classSubjectId),
          eq(classSubjects.classId, classId),
          eq(classSubjects.teacherId, teacherId),
        ))
        .limit(1);

      if (assignment === undefined) {
        throw new AppError('FORBIDDEN', 403, 'You are not assigned to this class subject');
      }

      const now = new Date();
      const [entry] = await transaction
        .insert(classDiaryEntries)
        .values({
          classId,
          classSubjectId: input.classSubjectId,
          description: input.description,
          keyPoints: input.keyPoints,
          occurredOn: input.occurredOn,
          periodLabel: input.periodLabel,
          schoolId: assignment.schoolId,
          teacherId,
          title: input.title,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          set: {
            classId,
            description: input.description,
            keyPoints: input.keyPoints,
            revision: sql`${classDiaryEntries.revision} + 1`,
            schoolId: assignment.schoolId,
            teacherId,
            title: input.title,
            updatedAt: now,
          },
          target: [
            classDiaryEntries.classSubjectId,
            classDiaryEntries.occurredOn,
            classDiaryEntries.periodLabel,
          ],
        })
        .returning({
          classId: classDiaryEntries.classId,
          classSubjectId: classDiaryEntries.classSubjectId,
          description: classDiaryEntries.description,
          id: classDiaryEntries.id,
          keyPoints: classDiaryEntries.keyPoints,
          occurredOn: classDiaryEntries.occurredOn,
          periodLabel: classDiaryEntries.periodLabel,
          revision: classDiaryEntries.revision,
          schoolId: classDiaryEntries.schoolId,
          teacherId: classDiaryEntries.teacherId,
          title: classDiaryEntries.title,
          updatedAt: classDiaryEntries.updatedAt,
        });

      if (entry === undefined) {
        throw new AppError('INTERNAL_ERROR', 500, 'Unable to create diary entry');
      }

      const diary = toDiaryRecord(entry);
      await this.outbox.writeInTransaction(transaction, createDiaryPublishedMessage(diary));
      await completeDiaryIdempotency(transaction, diary, idempotency);
      return diary;
    });
  }

  public async update(
    teacherId: string,
    diaryId: string,
    input: UpdateDiaryInput,
    idempotency: DiaryIdempotencyCompletion,
  ): Promise<DiaryRecord> {
    return this.db.transaction(async (transaction) => {
      const [assignment] = await transaction
        .select({ id: classDiaryEntries.id })
        .from(classDiaryEntries)
        .innerJoin(
          classSubjects,
          and(
            eq(classSubjects.id, classDiaryEntries.classSubjectId),
            eq(classSubjects.schoolId, classDiaryEntries.schoolId),
            eq(classSubjects.teacherId, teacherId),
          ),
        )
        .innerJoin(
          userRoles,
          and(
            eq(userRoles.userId, teacherId),
            eq(userRoles.schoolId, classDiaryEntries.schoolId),
            eq(userRoles.role, 'teacher'),
            eq(userRoles.isActive, true),
          ),
        )
        .where(and(eq(classDiaryEntries.id, diaryId), isNull(classDiaryEntries.deletedAt)))
        .limit(1);

      if (assignment === undefined) {
        throw new AppError('FORBIDDEN', 403, 'You are not assigned to this diary entry');
      }

      const [entry] = await transaction
        .update(classDiaryEntries)
        .set({
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.keyPoints === undefined ? {} : { keyPoints: input.keyPoints }),
          revision: sql`${classDiaryEntries.revision} + 1`,
          ...(input.occurredOn === undefined ? {} : { occurredOn: input.occurredOn }),
          ...(input.periodLabel === undefined ? {} : { periodLabel: input.periodLabel }),
          ...(input.title === undefined ? {} : { title: input.title }),
          updatedAt: new Date(),
        })
        .where(eq(classDiaryEntries.id, diaryId))
        .returning({
          classId: classDiaryEntries.classId,
          classSubjectId: classDiaryEntries.classSubjectId,
          description: classDiaryEntries.description,
          id: classDiaryEntries.id,
          keyPoints: classDiaryEntries.keyPoints,
          occurredOn: classDiaryEntries.occurredOn,
          periodLabel: classDiaryEntries.periodLabel,
          revision: classDiaryEntries.revision,
          schoolId: classDiaryEntries.schoolId,
          teacherId: classDiaryEntries.teacherId,
          title: classDiaryEntries.title,
          updatedAt: classDiaryEntries.updatedAt,
        });

      if (entry === undefined) {
        throw new AppError('INTERNAL_ERROR', 500, 'Unable to update diary entry');
      }

      const diary = toDiaryRecord(entry);
      await this.outbox.writeInTransaction(transaction, createDiaryPublishedMessage(diary));
      await completeDiaryIdempotency(transaction, diary, idempotency);
      return diary;
    });
  }
}
