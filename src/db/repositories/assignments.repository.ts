import {
  and,
  desc,
  eq,
  exists,
  gte,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from 'drizzle-orm';

import type { Database } from '../client.js';
import { classMembers, classSubjects } from '../schema/core.js';
import {
  assignmentResources,
  assignmentRubrics,
  assignments,
  assignmentSubmissions,
} from '../schema/assignments.js';
import type {
  AssignmentGradingType,
  AssignmentIdentity,
  AssignmentRubric,
  AssignmentSubmission,
  CreateAssignmentInput,
  CursorPage,
  GradeSubmissionInput,
  StudentAssignmentItem,
  StudentAssignmentListQuery,
  SubmissionCursor,
  SubmissionListQuery,
  TeacherAssignmentItem,
  TeacherAssignmentListQuery,
  UpdateAssignmentInput,
} from '../../types/assignments.js';
import {
  encodeAssignmentCreatedCursor,
  encodeAssignmentDueCursor,
  encodeSubmissionCursor,
} from '../../types/assignments.js';

export interface StoredAssignmentResource {
  id: string;
  name: string;
  objectPath: string;
}

export interface StoredAssignmentDetail {
  classId: string;
  dueAt: string;
  gradingType: AssignmentGradingType;
  id: string;
  instructions: string;
  isGradedAssignment: boolean;
  maxMarks?: number | undefined;
  resources: ReadonlyArray<StoredAssignmentResource>;
  rubrics: ReadonlyArray<AssignmentRubric>;
  subjectId: string;
  title: string;
}

export interface SubmissionDraft {
  assignmentId: string;
  id: string;
}

export interface StoredSubmission extends AssignmentSubmission {
  assignmentId: string;
  objectPath?: string | undefined;
}


export type SubmissionConfirmation =
  | { kind: "already_attached"; submission: StoredSubmission }
  | { kind: "attached"; submission: StoredSubmission }
  | { kind: "conflict" };


export interface GradeableSubmission {
  assignmentId: string;
  gradingType: AssignmentGradingType;
  maxMarks?: number | undefined;
  studentId: string;
}

export interface AssignmentsRepository {
  canAccessSubmission(identity: AssignmentIdentity, submissionId: string): Promise<boolean>;
  canManage(identity: AssignmentIdentity, assignmentId: string): Promise<boolean>;
  confirmSubmission(input: {
    assignmentId: string;
    displayName: string;
    identity: AssignmentIdentity;
    objectPath: string;
    submittedAt: Date;
    uploadSessionId: string;
  }): Promise<SubmissionConfirmation | undefined>;
  create(
    identity: AssignmentIdentity,
    classId: string,
    input: CreateAssignmentInput,
  ): Promise<StoredAssignmentDetail | undefined>;
  delete(identity: AssignmentIdentity, assignmentId: string, deletedAt: Date): Promise<boolean>;
  deleteResource(
    identity: AssignmentIdentity,
    assignmentId: string,
    resourceId: string,
  ): Promise<StoredAssignmentResource | undefined>;
  findForStudent(
    identity: AssignmentIdentity,
    assignmentId: string,
  ): Promise<StoredAssignmentDetail | undefined>;
  findForTeacher(
    identity: AssignmentIdentity,
    assignmentId: string,
  ): Promise<StoredAssignmentDetail | undefined>;
  findResourceForDeletion(
    identity: AssignmentIdentity,
    assignmentId: string,
    resourceId: string,
  ): Promise<StoredAssignmentResource | undefined>;
  findGradeableSubmission(
    identity: AssignmentIdentity,
    submissionId: string,
  ): Promise<GradeableSubmission | undefined>;
  grade(
    identity: AssignmentIdentity,
    submissionId: string,
    input: GradeSubmissionInput,
    gradedAt: Date,
  ): Promise<StoredSubmission | undefined>;
  findResourceForUpload(identity: AssignmentIdentity, assignmentId: string, uploadSessionId: string): Promise<StoredAssignmentResource | undefined>;
  findSubmissionForUpload(identity: AssignmentIdentity, assignmentId: string, uploadSessionId: string): Promise<StoredSubmission | undefined>;
  insertResource(input: {
    assignmentId: string;
    displayName: string;
    identity: AssignmentIdentity;
    objectPath: string;
    uploadSessionId: string;
  }): Promise<StoredAssignmentResource | undefined>;
  listActiveClassIdsForStudent(identity: AssignmentIdentity): Promise<ReadonlyArray<string>>;
  listForStudent(
    identity: AssignmentIdentity,
    query: StudentAssignmentListQuery,
    now: Date,
  ): Promise<CursorPage<StudentAssignmentItem>>;
  listForTeacher(
    identity: AssignmentIdentity,
    classId: string,
    query: TeacherAssignmentListQuery,
  ): Promise<CursorPage<TeacherAssignmentItem>>;
  listStudentIdsForAssignment(
    identity: AssignmentIdentity,
    assignmentId: string,
  ): Promise<ReadonlyArray<string> | undefined>;
  listReminderStudents(
    identity: AssignmentIdentity,
    assignmentId: string,
  ): Promise<ReadonlyArray<string> | undefined>;
  listSubmissions(
    identity: AssignmentIdentity,
    assignmentId: string,
    query: SubmissionListQuery,
  ): Promise<CursorPage<StoredSubmission> | undefined>;
  studentCanBeReminded(
    identity: AssignmentIdentity,
    assignmentId: string,
    studentId: string,
  ): Promise<boolean>;
  update(
    identity: AssignmentIdentity,
    assignmentId: string,
    input: UpdateAssignmentInput,
  ): Promise<StoredAssignmentDetail | undefined>;
  upsertSubmissionDraft(
    identity: AssignmentIdentity,
    assignmentId: string,
  ): Promise<SubmissionDraft | undefined>;
  withTransaction<T>(
    callback: (repository: AssignmentsRepository, transaction: Database) => Promise<T>,
  ): Promise<T>;
}

type AssignmentRow = {
  classId: string;
  createdAt: Date;
  deletedAt: Date | null;
  dueAt: Date;
  gradingType: AssignmentGradingType;
  id: string;
  instructions: string;
  isGraded: boolean;
  maxMarks: number | null;
  schoolId: string;
  subjectId: string;
  teacherId: string;
  title: string;
  updatedAt: Date;
};

type SubmissionRow = {
  assignmentId: string;
  feedback: string | null;
  gradedAt: Date | null;
  id: string;
  marks: number | null;
  objectPath: string | null;
  studentId: string;
  submittedAt: Date | null;
};

function toIso(value: Date | null): string | undefined {
  return value === null ? undefined : value.toISOString();
}

function toStoredSubmission(row: SubmissionRow): StoredSubmission {
  return {
    assignmentId: row.assignmentId,
    ...(row.feedback === null ? {} : { feedback: row.feedback }),
    ...(row.gradedAt === null ? {} : { gradedAt: row.gradedAt.toISOString() }),
    id: row.id,
    ...(row.marks === null ? {} : { marks: row.marks }),
    ...(row.objectPath === null ? {} : { objectPath: row.objectPath }),
    studentId: row.studentId,
    ...(row.submittedAt === null ? {} : { submittedAt: row.submittedAt.toISOString() }),
  };
}

export class DrizzleAssignmentsRepository implements AssignmentsRepository {
  public constructor(private readonly db: Database) {}

  public async withTransaction<T>(
    callback: (repository: AssignmentsRepository, transaction: Database) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (transaction) => {
      const database = transaction as unknown as Database;
      return callback(new DrizzleAssignmentsRepository(database), database);
    });
  }

  public async listActiveClassIdsForStudent(
    identity: AssignmentIdentity,
  ): Promise<ReadonlyArray<string>> {
    const memberships = await this.db
      .select({ classId: classMembers.classId })
      .from(classMembers)
      .where(and(
        eq(classMembers.schoolId, identity.schoolId),
        eq(classMembers.studentId, identity.userId),
        eq(classMembers.isActive, true),
      ))
      .orderBy(classMembers.classId);
    return memberships.map((membership) => membership.classId);
  }

  public async listForStudent(
    identity: AssignmentIdentity,
    query: StudentAssignmentListQuery,
    now: Date,
  ): Promise<CursorPage<StudentAssignmentItem>> {
    const cursor = query.cursor;
    const rows = await this.db
      .select({
        dueAt: assignments.dueAt,
        gradedAt: assignmentSubmissions.gradedAt,
        gradingType: assignments.gradingType,
        id: assignments.id,
        isGraded: assignments.isGraded,
        marks: assignmentSubmissions.marks,
        schoolId: assignments.schoolId,
        subjectId: assignments.subjectId,
        submittedAt: assignmentSubmissions.submittedAt,
        title: assignments.title,
      })
      .from(assignments)
      .leftJoin(assignmentSubmissions, and(
        eq(assignmentSubmissions.assignmentId, assignments.id),
        eq(assignmentSubmissions.schoolId, identity.schoolId),
        eq(assignmentSubmissions.studentId, identity.userId),
      ))
      .where(and(
        eq(assignments.schoolId, identity.schoolId),
        isNull(assignments.deletedAt),
        this.studentAudience(identity),
        query.subjectId === undefined ? undefined : eq(assignments.subjectId, query.subjectId),
        query.status === 'active' ? and(
          isNull(assignmentSubmissions.submittedAt),
          gte(assignments.dueAt, now),
        ) : undefined,
        query.status === 'submitted' ? and(
          isNotNull(assignmentSubmissions.submittedAt),
          isNull(assignmentSubmissions.gradedAt),
        ) : undefined,
        query.status === 'graded' ? isNotNull(assignmentSubmissions.gradedAt) : undefined,
        cursor === undefined ? undefined : or(
          lt(assignments.dueAt, new Date(cursor.dueAt)),
          and(
            eq(assignments.dueAt, new Date(cursor.dueAt)),
            lt(assignments.id, cursor.id),
          ),
        ),
      ))
      .orderBy(desc(assignments.dueAt), desc(assignments.id))
      .limit(query.limit + 1);

    const pageRows = rows.slice(0, query.limit);
    const items = pageRows.map((row) => ({
      dueAt: row.dueAt.toISOString(),
      ...(row.gradedAt === null ? {} : { gradedAt: row.gradedAt.toISOString() }),
      gradingType: row.gradingType,
      id: row.id,
      isGradedAssignment: row.isGraded,
      ...(row.marks === null ? {} : { marks: row.marks }),
      subjectId: row.subjectId,
      ...(row.submittedAt === null ? {} : { submittedAt: row.submittedAt.toISOString() }),
      title: row.title,
    }));
    const last = items.at(-1);
    return {
      items,
      ...(rows.length > query.limit && last !== undefined ? {
        nextCursor: encodeAssignmentDueCursor({ dueAt: last.dueAt, id: last.id }),
      } : {}),
    };
  }

  public async findForStudent(
    identity: AssignmentIdentity,
    assignmentId: string,
  ): Promise<StoredAssignmentDetail | undefined> {
    const record = await this.findOne(and(
      eq(assignments.id, assignmentId),
      eq(assignments.schoolId, identity.schoolId),
      isNull(assignments.deletedAt),
      this.studentAudience(identity),
    ));
    return record === undefined ? undefined : this.withDetails(record);
  }

  public async findForTeacher(
    identity: AssignmentIdentity,
    assignmentId: string,
  ): Promise<StoredAssignmentDetail | undefined> {
    const record = await this.findManaged(identity, assignmentId);
    return record === undefined ? undefined : this.withDetails(record);
  }

  public async listForTeacher(
    identity: AssignmentIdentity,
    classId: string,
    query: TeacherAssignmentListQuery,
  ): Promise<CursorPage<TeacherAssignmentItem>> {
    const cursor = query.cursor;
    const rows = await this.db
      .select({
        createdAt: assignments.createdAt,
        dueAt: assignments.dueAt,
        gradingType: assignments.gradingType,
        id: assignments.id,
        isGraded: assignments.isGraded,
        maxMarks: assignments.maxMarks,
        schoolId: assignments.schoolId,
        subjectId: assignments.subjectId,
        title: assignments.title,
      })
      .from(assignments)
      .where(and(
        eq(assignments.schoolId, identity.schoolId),
        eq(assignments.classId, classId),
        eq(assignments.teacherId, identity.userId),
        isNull(assignments.deletedAt),
        this.teacherAssignment(identity, assignments.classId, assignments.subjectId),
        query.status === 'active' ? eq(assignments.isGraded, false) : undefined,
        query.status === 'graded' ? eq(assignments.isGraded, true) : undefined,
        cursor === undefined ? undefined : or(
          lt(assignments.createdAt, new Date(cursor.createdAt)),
          and(
            eq(assignments.createdAt, new Date(cursor.createdAt)),
            lt(assignments.id, cursor.id),
          ),
        ),
      ))
      .orderBy(desc(assignments.createdAt), desc(assignments.id))
      .limit(query.limit + 1);

    const pageRows = rows.slice(0, query.limit);
    const items = pageRows.map((row) => ({
      createdAt: row.createdAt.toISOString(),
      dueAt: row.dueAt.toISOString(),
      gradingType: row.gradingType,
      id: row.id,
      isGradedAssignment: row.isGraded,
      ...(row.maxMarks === null ? {} : { maxMarks: row.maxMarks }),
      subjectId: row.subjectId,
      title: row.title,
    }));
    const last = items.at(-1);
    return {
      items,
      ...(rows.length > query.limit && last !== undefined ? {
        nextCursor: encodeAssignmentCreatedCursor({ createdAt: last.createdAt, id: last.id }),
      } : {}),
    };
  }

  public async create(
    identity: AssignmentIdentity,
    classId: string,
    input: CreateAssignmentInput,
  ): Promise<StoredAssignmentDetail | undefined> {
    const created = await this.db.transaction(async (transaction) => {
      const createdRows = await transaction.execute(sql<{ id: string }>`
        insert into public.assignments (
          school_id,
          class_id,
          subject_id,
          teacher_id,
          title,
          instructions,
          due_at,
          is_graded,
          grading_type,
          max_marks
        )
        select
          ${identity.schoolId}::uuid,
          ${classId}::uuid,
          ${input.subjectId}::uuid,
          ${identity.userId}::uuid,
          ${input.title},
          ${input.instructions},
          ${new Date(input.dueAt)}::timestamptz,
          ${input.isGradedAssignment},
          ${input.gradingType},
          ${input.maxMarks ?? null}
        from public.class_subjects
        where school_id = ${identity.schoolId}::uuid
          and class_id = ${classId}::uuid
          and subject_id = ${input.subjectId}::uuid
          and teacher_id = ${identity.userId}::uuid
        returning id
      `);
      const assignment = (createdRows as unknown as ReadonlyArray<{ id: string }>)[0];
      if (assignment === undefined) return undefined;
      await transaction.insert(assignmentRubrics).values(input.rubrics.map((rubric) => ({
        assignmentId: assignment.id,
        marks: rubric.marks,
        ...(rubric.moreInfo === undefined ? {} : { moreInfo: rubric.moreInfo }),
        position: rubric.position,
        topic: rubric.topic,
      })));
      return assignment.id;
    });
    if (created === undefined) return undefined;
    const record = await this.findOne(and(
      eq(assignments.id, created),
      eq(assignments.schoolId, identity.schoolId),
      eq(assignments.teacherId, identity.userId),
    ));
    return record === undefined ? undefined : this.withDetails(record);
  }

  public async update(
    identity: AssignmentIdentity,
    assignmentId: string,
    input: UpdateAssignmentInput,
  ): Promise<StoredAssignmentDetail | undefined> {
    const updated = await this.db.transaction(async (transaction) => {
      const [assignment] = await transaction
        .update(assignments)
        .set({
          dueAt: new Date(input.dueAt),
          gradingType: input.gradingType,
          instructions: input.instructions,
          isGraded: input.isGradedAssignment,
          maxMarks: input.maxMarks ?? null,
          subjectId: input.subjectId,
          title: input.title,
          updatedAt: new Date(),
        })
        .where(and(
          eq(assignments.id, assignmentId),
          eq(assignments.schoolId, identity.schoolId),
          eq(assignments.teacherId, identity.userId),
          isNull(assignments.deletedAt),
          this.teacherAssignment(identity, assignments.classId, assignments.subjectId),
          this.teacherCanTeachSubject(identity, assignments.classId, input.subjectId),
        ))
        .returning();
      if (assignment === undefined) return undefined;
      await transaction.delete(assignmentRubrics).where(eq(assignmentRubrics.assignmentId, assignment.id));
      await transaction.insert(assignmentRubrics).values(input.rubrics.map((rubric) => ({
        assignmentId: assignment.id,
        marks: rubric.marks,
        ...(rubric.moreInfo === undefined ? {} : { moreInfo: rubric.moreInfo }),
        position: rubric.position,
        topic: rubric.topic,
      })));
      return assignment;
    });
    return updated === undefined ? undefined : this.withDetails(updated);
  }

  public async delete(identity: AssignmentIdentity, assignmentId: string, deletedAt: Date): Promise<boolean> {
    const [deleted] = await this.db
      .update(assignments)
      .set({ deletedAt, updatedAt: deletedAt })
      .where(and(
        eq(assignments.id, assignmentId),
        eq(assignments.schoolId, identity.schoolId),
        eq(assignments.teacherId, identity.userId),
        isNull(assignments.deletedAt),
        this.teacherAssignment(identity, assignments.classId, assignments.subjectId),
      ))
      .returning({ id: assignments.id });
    return deleted !== undefined;
  }

  public async canManage(identity: AssignmentIdentity, assignmentId: string): Promise<boolean> {
    return (await this.findManaged(identity, assignmentId)) !== undefined;
  }

  public async canAccessSubmission(
    identity: AssignmentIdentity,
    submissionId: string,
  ): Promise<boolean> {
    const [submission] = await this.db
      .select({ id: assignmentSubmissions.id })
      .from(assignmentSubmissions)
      .innerJoin(assignments, and(
        eq(assignments.id, assignmentSubmissions.assignmentId),
        eq(assignments.schoolId, assignmentSubmissions.schoolId),
      ))
      .innerJoin(classMembers, and(
        eq(classMembers.schoolId, assignments.schoolId),
        eq(classMembers.classId, assignments.classId),
        eq(classMembers.studentId, identity.userId),
        eq(classMembers.isActive, true),
      ))
      .where(and(
        eq(assignmentSubmissions.id, submissionId),
        eq(assignmentSubmissions.schoolId, identity.schoolId),
        eq(assignmentSubmissions.studentId, identity.userId),
        isNull(assignments.deletedAt),
      ))
      .limit(1);
    return submission !== undefined;
  }

  public async upsertSubmissionDraft(
    identity: AssignmentIdentity,
    assignmentId: string,
  ): Promise<SubmissionDraft | undefined> {
    const rows = await this.db.execute(sql<SubmissionDraft>`
      with allowed as (
        select assignment.id as assignment_id
        from public.assignments assignment
        join public.class_members member
          on member.school_id = assignment.school_id
          and member.class_id = assignment.class_id
          and member.student_id = ${identity.userId}::uuid
          and member.is_active
        where assignment.id = ${assignmentId}::uuid
          and assignment.school_id = ${identity.schoolId}::uuid
          and assignment.deleted_at is null
      ), upserted as (
        insert into public.assignment_submissions (school_id, assignment_id, student_id)
        select
          ${identity.schoolId}::uuid,
          allowed.assignment_id,
          ${identity.userId}::uuid
        from allowed
        on conflict (assignment_id, student_id) do update
          set assignment_id = assignment_submissions.assignment_id
          where assignment_submissions.school_id = ${identity.schoolId}::uuid
            and assignment_submissions.student_id = ${identity.userId}::uuid
            and exists (
              select 1
              from public.assignments assignment
              join public.class_members member
                on member.school_id = assignment.school_id
                and member.class_id = assignment.class_id
                and member.student_id = ${identity.userId}::uuid
                and member.is_active
              where assignment.id = assignment_submissions.assignment_id
                and assignment.school_id = assignment_submissions.school_id
                and assignment.deleted_at is null
            )
        returning id, assignment_id as "assignmentId"
      )
      select id, "assignmentId" from upserted
      limit 1
    `) as unknown as ReadonlyArray<SubmissionDraft>;
    return rows[0];
  }

  public async confirmSubmission(input: {
    assignmentId: string;
    displayName: string;
    identity: AssignmentIdentity;
    objectPath: string;
    submittedAt: Date;
    uploadSessionId: string;
  }): Promise<SubmissionConfirmation | undefined> {
    return this.db.transaction(async (transaction) => {
      const lockedRows = await transaction.execute(sql<{
        assignment_id: string;
        feedback: string | null;
        graded_at: Date | null;
        id: string;
        marks: number | null;
        object_path: string | null;
        student_id: string;
        submitted_at: Date | null;
        upload_session_id: string | null;
      }>`
        select
          id,
          assignment_id,
          student_id,
          upload_session_id,
          object_path,
          submitted_at,
          marks,
          feedback,
          graded_at
        from public.assignment_submissions
        where school_id = ${input.identity.schoolId}::uuid
          and assignment_id = ${input.assignmentId}::uuid
          and student_id = ${input.identity.userId}::uuid
        for update
      `);
      const locked = (lockedRows as unknown as ReadonlyArray<{
        assignment_id: string;
        feedback: string | null;
        graded_at: Date | null;
        id: string;
        marks: number | null;
        object_path: string | null;
        student_id: string;
        submitted_at: Date | null;
        upload_session_id: string | null;
      }>)[0];
      if (locked === undefined) return undefined;
      if (locked.upload_session_id !== null) {
        const submission = toStoredSubmission({
          assignmentId: locked.assignment_id,
          feedback: locked.feedback,
          gradedAt: locked.graded_at,
          id: locked.id,
          marks: locked.marks,
          objectPath: locked.object_path,
          studentId: locked.student_id,
          submittedAt: locked.submitted_at,
        });
        return locked.upload_session_id === input.uploadSessionId
          ? { kind: "already_attached", submission }
          : { kind: "conflict" };
      }

      const updatedRows = await transaction.execute(sql<{
        assignment_id: string;
        feedback: string | null;
        graded_at: Date | null;
        id: string;
        marks: number | null;
        object_path: string | null;
        student_id: string;
        submitted_at: Date | null;
      }>`
        update public.assignment_submissions
        set upload_session_id = ${input.uploadSessionId}::uuid,
            object_path = ${input.objectPath},
            display_name = ${input.displayName},
            submitted_at = ${input.submittedAt}::timestamptz,
            updated_at = ${input.submittedAt}::timestamptz
        where id = ${locked.id}::uuid
          and upload_session_id is null
          and school_id = ${input.identity.schoolId}::uuid
          and student_id = ${input.identity.userId}::uuid
          and exists (
            select 1
            from public.assignments assignment
            join public.class_members member
              on member.school_id = assignment.school_id
              and member.class_id = assignment.class_id
              and member.student_id = ${input.identity.userId}::uuid
              and member.is_active
            where assignment.id = assignment_submissions.assignment_id
              and assignment.school_id = assignment_submissions.school_id
              and assignment.deleted_at is null
          )
        returning
          id,
          assignment_id,
          student_id,
          object_path,
          submitted_at,
          marks,
          feedback,
          graded_at
      `);
      const updated = (updatedRows as unknown as ReadonlyArray<{
        assignment_id: string;
        feedback: string | null;
        graded_at: Date | null;
        id: string;
        marks: number | null;
        object_path: string | null;
        student_id: string;
        submitted_at: Date | null;
      }>)[0];
      return updated === undefined ? undefined : { kind: 'attached' as const, submission: toStoredSubmission({
        assignmentId: updated.assignment_id,
        feedback: updated.feedback,
        gradedAt: updated.graded_at,
        id: updated.id,
        marks: updated.marks,
        objectPath: updated.object_path,
        studentId: updated.student_id,
        submittedAt: updated.submitted_at,
      }) };
    });
  }

  public async listSubmissions(
    identity: AssignmentIdentity,
    assignmentId: string,
    query: SubmissionListQuery,
  ): Promise<CursorPage<StoredSubmission> | undefined> {
    if (!await this.canManage(identity, assignmentId)) return undefined;
    const cursor = query.cursor;
    const rows = await this.db
      .select({
        assignmentId: assignmentSubmissions.assignmentId,
        feedback: assignmentSubmissions.feedback,
        gradedAt: assignmentSubmissions.gradedAt,
        id: assignmentSubmissions.id,
        marks: assignmentSubmissions.marks,
        objectPath: assignmentSubmissions.objectPath,
        schoolId: assignmentSubmissions.schoolId,
        studentId: assignmentSubmissions.studentId,
        submittedAt: assignmentSubmissions.submittedAt,
      })
      .from(assignmentSubmissions)
      .innerJoin(assignments, and(
        eq(assignments.id, assignmentSubmissions.assignmentId),
        eq(assignments.schoolId, assignmentSubmissions.schoolId),
      ))
      .where(and(
        eq(assignmentSubmissions.schoolId, identity.schoolId),
        eq(assignmentSubmissions.assignmentId, assignmentId),
        eq(assignments.schoolId, identity.schoolId),
        eq(assignments.teacherId, identity.userId),
        isNull(assignments.deletedAt),
        this.teacherAssignment(identity, assignments.classId, assignments.subjectId),
        cursor === undefined ? undefined : this.submissionCursorCondition(cursor),
      ))
      .orderBy(sql`${assignmentSubmissions.submittedAt} desc nulls last`, desc(assignmentSubmissions.id))
      .limit(query.limit + 1);
    const pageRows = rows.slice(0, query.limit);
    const items = pageRows.map(toStoredSubmission);
    const last = pageRows.at(-1);
    return {
      items,
      ...(rows.length > query.limit && last !== undefined ? {
        nextCursor: encodeSubmissionCursor({
          id: last.id,
          submittedAt: toIso(last.submittedAt) ?? null,
        }),
      } : {}),
    };
  }

  public async findGradeableSubmission(
    identity: AssignmentIdentity,
    submissionId: string,
  ): Promise<GradeableSubmission | undefined> {
    const [submission] = await this.db
      .select({
        assignmentId: assignmentSubmissions.assignmentId,
        gradingType: assignments.gradingType,
        maxMarks: assignments.maxMarks,
        studentId: assignmentSubmissions.studentId,
      })
      .from(assignmentSubmissions)
      .innerJoin(assignments, and(
        eq(assignments.id, assignmentSubmissions.assignmentId),
        eq(assignments.schoolId, assignmentSubmissions.schoolId),
      ))
      .where(and(
        eq(assignmentSubmissions.id, submissionId),
        eq(assignmentSubmissions.schoolId, identity.schoolId),
        eq(assignments.schoolId, identity.schoolId),
        eq(assignments.teacherId, identity.userId),
        isNull(assignments.deletedAt),
        isNotNull(assignmentSubmissions.submittedAt),
        this.teacherAssignment(identity, assignments.classId, assignments.subjectId),
      ))
      .limit(1);
    return submission === undefined ? undefined : {
      assignmentId: submission.assignmentId,
      gradingType: submission.gradingType,
      ...(submission.maxMarks === null ? {} : { maxMarks: submission.maxMarks }),
      studentId: submission.studentId,
    };
  }

  public async grade(
    identity: AssignmentIdentity,
    submissionId: string,
    input: GradeSubmissionInput,
    gradedAt: Date,
  ): Promise<StoredSubmission | undefined> {
    const [updated] = await this.db
      .update(assignmentSubmissions)
      .set({
        ...(input.feedback === undefined ? {} : { feedback: input.feedback }),
        gradedAt,
        gradedByTeacherId: identity.userId,
        marks: input.marks,
        updatedAt: gradedAt,
      })
      .where(and(
        eq(assignmentSubmissions.id, submissionId),
        eq(assignmentSubmissions.schoolId, identity.schoolId),
        isNotNull(assignmentSubmissions.submittedAt),
        this.gradeAuthorization(identity, input.marks),
      ))
      .returning({
        assignmentId: assignmentSubmissions.assignmentId,
        feedback: assignmentSubmissions.feedback,
        gradedAt: assignmentSubmissions.gradedAt,
        id: assignmentSubmissions.id,
        marks: assignmentSubmissions.marks,
        objectPath: assignmentSubmissions.objectPath,
        studentId: assignmentSubmissions.studentId,
        submittedAt: assignmentSubmissions.submittedAt,
      });
    return updated === undefined ? undefined : toStoredSubmission(updated);
  }

  public async listStudentIdsForAssignment(
    identity: AssignmentIdentity,
    assignmentId: string,
  ): Promise<ReadonlyArray<string> | undefined> {
    const assignment = await this.findManaged(identity, assignmentId);
    if (assignment === undefined) return undefined;
    const students = await this.db
      .select({ studentId: classMembers.studentId })
      .from(classMembers)
      .where(and(
        eq(classMembers.schoolId, identity.schoolId),
        eq(classMembers.classId, assignment.classId),
        eq(classMembers.isActive, true),
      ));
    return students.map((student) => student.studentId);
  }

  public async listReminderStudents(
    identity: AssignmentIdentity,
    assignmentId: string,
  ): Promise<ReadonlyArray<string> | undefined> {
    return this.listStudentIdsForAssignment(identity, assignmentId);
  }

  public async studentCanBeReminded(
    identity: AssignmentIdentity,
    assignmentId: string,
    studentId: string,
  ): Promise<boolean> {
    const assignment = await this.findManaged(identity, assignmentId);
    if (assignment === undefined) return false;
    const [membership] = await this.db
      .select({ id: classMembers.id })
      .from(classMembers)
      .where(and(
        eq(classMembers.schoolId, identity.schoolId),
        eq(classMembers.classId, assignment.classId),
        eq(classMembers.studentId, studentId),
        eq(classMembers.isActive, true),
      ))
      .limit(1);
    return membership !== undefined;
  }

  public async deleteResource(
    identity: AssignmentIdentity,
    assignmentId: string,
    resourceId: string,
  ): Promise<StoredAssignmentResource | undefined> {
    const rows = await this.db.execute(sql<StoredAssignmentResource>`
      delete from public.assignment_resources resource
      using public.assignments assignment, public.class_subjects subject
      where resource.id = ${resourceId}::uuid
        and resource.school_id = ${identity.schoolId}::uuid
        and resource.assignment_id = ${assignmentId}::uuid
        and assignment.id = resource.assignment_id
        and assignment.school_id = resource.school_id
        and assignment.teacher_id = ${identity.userId}::uuid
        and assignment.deleted_at is null
        and subject.school_id = assignment.school_id
        and subject.class_id = assignment.class_id
        and subject.subject_id = assignment.subject_id
        and subject.teacher_id = ${identity.userId}::uuid
      returning resource.id, resource.display_name as name, resource.object_path as "objectPath"
    `) as unknown as ReadonlyArray<StoredAssignmentResource>;
    return rows[0];
  }

  public async findResourceForDeletion(
    identity: AssignmentIdentity,
    assignmentId: string,
    resourceId: string,
  ): Promise<StoredAssignmentResource | undefined> {
    const [resource] = await this.db
      .select({
        id: assignmentResources.id,
        name: assignmentResources.displayName,
        objectPath: assignmentResources.objectPath,
      })
      .from(assignmentResources)
      .innerJoin(assignments, and(
        eq(assignments.id, assignmentResources.assignmentId),
        eq(assignments.schoolId, assignmentResources.schoolId),
      ))
      .where(and(
        eq(assignmentResources.id, resourceId),
        eq(assignmentResources.schoolId, identity.schoolId),
        eq(assignmentResources.assignmentId, assignmentId),
        eq(assignments.teacherId, identity.userId),
        isNull(assignments.deletedAt),
        this.teacherAssignment(identity, assignments.classId, assignments.subjectId),
      ))
      .limit(1);
    return resource;
  }

  public async findResourceForUpload(
    identity: AssignmentIdentity,
    assignmentId: string,
    uploadSessionId: string,
  ): Promise<StoredAssignmentResource | undefined> {
    const rows = await this.db.execute(sql<StoredAssignmentResource>`
      select resource.id, resource.display_name as name, resource.object_path as "objectPath"
      from public.assignment_resources resource
      join public.assignments assignment
        on assignment.id = resource.assignment_id
        and assignment.school_id = resource.school_id
      join public.class_subjects subject
        on subject.school_id = assignment.school_id
        and subject.class_id = assignment.class_id
        and subject.subject_id = assignment.subject_id
        and subject.teacher_id = ${identity.userId}::uuid
      where resource.school_id = ${identity.schoolId}::uuid
        and resource.assignment_id = ${assignmentId}::uuid
        and resource.upload_session_id = ${uploadSessionId}::uuid
        and assignment.teacher_id = ${identity.userId}::uuid
        and assignment.deleted_at is null
      limit 1
    `) as unknown as ReadonlyArray<StoredAssignmentResource>;
    return rows[0];
  }

  public async findSubmissionForUpload(
    identity: AssignmentIdentity,
    assignmentId: string,
    uploadSessionId: string,
  ): Promise<StoredSubmission | undefined> {
    const rows = await this.db.execute(sql<SubmissionRow>`
      select submission.id, submission.assignment_id, submission.student_id, submission.object_path,
        submission.submitted_at, submission.marks, submission.feedback, submission.graded_at
      from public.assignment_submissions submission
      join public.assignments assignment
        on assignment.id = submission.assignment_id
        and assignment.school_id = submission.school_id
      join public.class_members member
        on member.school_id = assignment.school_id
        and member.class_id = assignment.class_id
        and member.student_id = submission.student_id
        and member.is_active
      where submission.school_id = ${identity.schoolId}::uuid
        and submission.assignment_id = ${assignmentId}::uuid
        and submission.student_id = ${identity.userId}::uuid
        and submission.upload_session_id = ${uploadSessionId}::uuid
        and assignment.deleted_at is null
      limit 1
    `) as unknown as ReadonlyArray<SubmissionRow>;
    const submission = rows[0];
    return submission === undefined ? undefined : toStoredSubmission(submission);
  }

  public async insertResource(input: {
    assignmentId: string;
    displayName: string;
    identity: AssignmentIdentity;
    objectPath: string;
    uploadSessionId: string;
  }): Promise<StoredAssignmentResource | undefined> {
    return this.db.transaction(async (transaction) => {
      const createdRows = await transaction.execute(sql<{ id: string; name: string; objectPath: string }>`
        insert into public.assignment_resources (
          school_id,
          assignment_id,
          upload_session_id,
          object_path,
          display_name
        )
        select
          ${input.identity.schoolId}::uuid,
          ${input.assignmentId}::uuid,
          ${input.uploadSessionId}::uuid,
          ${input.objectPath},
          ${input.displayName}
        from public.assignments
        inner join public.class_subjects
          on class_subjects.school_id = assignments.school_id
          and class_subjects.class_id = assignments.class_id
          and class_subjects.subject_id = assignments.subject_id
          and class_subjects.teacher_id = ${input.identity.userId}::uuid
        where assignments.id = ${input.assignmentId}::uuid
          and assignments.school_id = ${input.identity.schoolId}::uuid
          and assignments.teacher_id = ${input.identity.userId}::uuid
          and assignments.deleted_at is null
        on conflict (upload_session_id) do nothing
        returning id, display_name as name, object_path as "objectPath"
      `);
      const created = (createdRows as unknown as ReadonlyArray<StoredAssignmentResource>)[0];
      if (created !== undefined) return created;

      const existingRows = await transaction.execute(sql<{ id: string; name: string; objectPath: string }>`
        select
          assignment_resources.id,
          assignment_resources.display_name as name,
          assignment_resources.object_path as "objectPath"
        from public.assignment_resources
        inner join public.assignments
          on assignments.id = assignment_resources.assignment_id
          and assignments.school_id = assignment_resources.school_id
        inner join public.class_subjects
          on class_subjects.school_id = assignments.school_id
          and class_subjects.class_id = assignments.class_id
          and class_subjects.subject_id = assignments.subject_id
          and class_subjects.teacher_id = ${input.identity.userId}::uuid
        where assignment_resources.school_id = ${input.identity.schoolId}::uuid
          and assignment_resources.assignment_id = ${input.assignmentId}::uuid
          and assignment_resources.upload_session_id = ${input.uploadSessionId}::uuid
          and assignments.teacher_id = ${input.identity.userId}::uuid
          and assignments.deleted_at is null
        limit 1
      `);
      return (existingRows as unknown as ReadonlyArray<StoredAssignmentResource>)[0];
    });
  }

  private studentAudience(identity: AssignmentIdentity) {
    return exists(this.db
      .select({ id: classMembers.id })
      .from(classMembers)
      .where(and(
        eq(classMembers.schoolId, identity.schoolId),
        eq(classMembers.classId, assignments.classId),
        eq(classMembers.studentId, identity.userId),
        eq(classMembers.isActive, true),
      )));
  }

  private teacherAssignment(
    identity: AssignmentIdentity,
    classId: typeof assignments.classId,
    subjectId: typeof assignments.subjectId,
  ) {
    return exists(this.db
      .select({ id: classSubjects.id })
      .from(classSubjects)
      .where(and(
        eq(classSubjects.schoolId, identity.schoolId),
        eq(classSubjects.classId, classId),
        eq(classSubjects.subjectId, subjectId),
        eq(classSubjects.teacherId, identity.userId),
      )));
  }

  private teacherCanTeachSubject(
    identity: AssignmentIdentity,
    classId: typeof assignments.classId,
    subjectId: string,
  ) {
    return exists(this.db
      .select({ id: classSubjects.id })
      .from(classSubjects)
      .where(and(
        eq(classSubjects.schoolId, identity.schoolId),
        eq(classSubjects.classId, classId),
        eq(classSubjects.subjectId, subjectId),
        eq(classSubjects.teacherId, identity.userId),
      )));
  }

  private gradeAuthorization(identity: AssignmentIdentity, marks: number) {
    return exists(this.db
      .select({ id: assignments.id })
      .from(assignments)
      .innerJoin(classSubjects, and(
        eq(classSubjects.schoolId, assignments.schoolId),
        eq(classSubjects.classId, assignments.classId),
        eq(classSubjects.subjectId, assignments.subjectId),
        eq(classSubjects.teacherId, identity.userId),
      ))
      .where(and(
        eq(assignments.id, assignmentSubmissions.assignmentId),
        eq(assignments.schoolId, identity.schoolId),
        eq(assignments.teacherId, identity.userId),
        isNull(assignments.deletedAt),
        eq(assignments.gradingType, 'Numeric'),
        gte(assignments.maxMarks, marks),
      )));
  }

  private async findManaged(
    identity: AssignmentIdentity,
    assignmentId: string,
  ): Promise<AssignmentRow | undefined> {
    return this.findOne(and(
      eq(assignments.id, assignmentId),
      eq(assignments.schoolId, identity.schoolId),
      eq(assignments.teacherId, identity.userId),
      isNull(assignments.deletedAt),
      this.teacherAssignment(identity, assignments.classId, assignments.subjectId),
    ));
  }

  private async findOne(condition: ReturnType<typeof and>): Promise<AssignmentRow | undefined> {
    const [record] = await this.db
      .select({
        classId: assignments.classId,
        createdAt: assignments.createdAt,
        deletedAt: assignments.deletedAt,
        dueAt: assignments.dueAt,
        gradingType: assignments.gradingType,
        id: assignments.id,
        instructions: assignments.instructions,
        isGraded: assignments.isGraded,
        maxMarks: assignments.maxMarks,
        schoolId: assignments.schoolId,
        subjectId: assignments.subjectId,
        teacherId: assignments.teacherId,
        title: assignments.title,
        updatedAt: assignments.updatedAt,
      })
      .from(assignments)
      .where(condition)
      .limit(1);
    return record;
  }

  private async withDetails(record: AssignmentRow): Promise<StoredAssignmentDetail> {
    const [rubrics, resources] = await Promise.all([
      this.db
        .select({
          marks: assignmentRubrics.marks,
          moreInfo: assignmentRubrics.moreInfo,
          position: assignmentRubrics.position,
          topic: assignmentRubrics.topic,
        })
        .from(assignmentRubrics)
        .where(eq(assignmentRubrics.assignmentId, record.id))
        .orderBy(assignmentRubrics.position),
      this.db
        .select({
          id: assignmentResources.id,
          schoolId: assignmentResources.schoolId,
          name: assignmentResources.displayName,
          objectPath: assignmentResources.objectPath,
        })
        .from(assignmentResources)
        .where(and(
          eq(assignmentResources.schoolId, record.schoolId),
          eq(assignmentResources.assignmentId, record.id),
        ))
        .orderBy(desc(assignmentResources.createdAt), desc(assignmentResources.id)),
    ]);
    return {
      classId: record.classId,
      dueAt: record.dueAt.toISOString(),
      gradingType: record.gradingType,
      id: record.id,
      instructions: record.instructions,
      isGradedAssignment: record.isGraded,
      ...(record.maxMarks === null ? {} : { maxMarks: record.maxMarks }),
      resources,
      rubrics: rubrics.map((rubric) => ({
        marks: rubric.marks,
        ...(rubric.moreInfo === null ? {} : { moreInfo: rubric.moreInfo }),
        position: rubric.position,
        topic: rubric.topic,
      })),
      subjectId: record.subjectId,
      title: record.title,
    };
  }

  private submissionCursorCondition(cursor: SubmissionCursor) {
    if (cursor.submittedAt === null) {
      return and(
        isNull(assignmentSubmissions.submittedAt),
        lt(assignmentSubmissions.id, cursor.id),
      );
    }
    return or(
      lt(assignmentSubmissions.submittedAt, new Date(cursor.submittedAt)),
      and(
        eq(assignmentSubmissions.submittedAt, new Date(cursor.submittedAt)),
        lt(assignmentSubmissions.id, cursor.id),
      ),
      isNull(assignmentSubmissions.submittedAt),
    );
  }
}
