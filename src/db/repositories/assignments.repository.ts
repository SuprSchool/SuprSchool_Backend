import {
  and,
  desc,
  eq,
  exists,
  gte,
  isNotNull,
  isNull,
  lt,
  not,
  or,
  sql,
} from 'drizzle-orm';

import type { Database } from '../client.js';
import { classMembers, classSubjects, subjects, userProfiles } from '../schema/core.js';
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
  SubmissionCompletion,
  SubmissionCompletionAction,
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
  assignedAt: string;
  classId: string;
  displayCode: string | null;
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
  /**
   * The reading student's *own* submission, populated by `findForStudent`
   * only. The list read model already carries these, and clients derive
   * submitted/graded from them — without them a detail always reads as
   * pending. Never set for a teacher, and never cached: the detail cache is
   * school-scoped, so per-student fields must be merged outside it.
   */
  gradedAt?: string | undefined;
  marks?: number | undefined;
  submittedAt?: string | undefined;
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
  setSubmissionCompletion(
    identity: AssignmentIdentity,
    submissionId: string,
    action: SubmissionCompletionAction,
    completedAt: Date,
  ): Promise<SubmissionCompletion | undefined>;
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
  displayCode: string | null;
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

/**
 * Timestamps arrive as Dates from the query builders and as strings from the
 * raw `sql` paths, which are cast rather than parsed — so the compiler cannot
 * tell the two apart here. Accept both rather than trusting the cast.
 */
type SubmissionTimestamp = Date | string | null;

type SubmissionRow = {
  assignmentId: string;
  completedAt: SubmissionTimestamp;
  feedback: string | null;
  gradedAt: SubmissionTimestamp;
  id: string;
  marks: number | null;
  objectPath: string | null;
  studentId: string;
  studentName: string;
  submittedAt: SubmissionTimestamp;
};

function submissionTimestampIso(value: SubmissionTimestamp): string | null {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toIso(value: Date | null): string | undefined {
  return value === null ? undefined : value.toISOString();
}

const DISPLAY_CODE_UNIQUE_INDEX = 'assignments_display_code_per_school';
const DISPLAY_CODE_MAX_ATTEMPTS = 5;
const UNIQUE_VIOLATION = '23505';

/**
 * The sequence is read inside the insert, so two concurrent creates in the same
 * school and year can compute the same code and race for the unique index. The
 * loser is retried rather than failed: by then the winner is committed, so the
 * recomputed count yields the next code. The driver wraps its errors, so the
 * cause chain is walked rather than only the outermost error.
 */
function isDisplayCodeConflict(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== 'object' || current === null) return false;
    const candidate = current as { cause?: unknown; code?: unknown; constraint_name?: unknown };
    if (candidate.code === UNIQUE_VIOLATION && candidate.constraint_name === DISPLAY_CODE_UNIQUE_INDEX) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

function toStoredSubmission(row: SubmissionRow): StoredSubmission {
  return {
    assignmentId: row.assignmentId,
    completedAt: submissionTimestampIso(row.completedAt),
    ...(row.feedback === null ? {} : { feedback: row.feedback }),
    ...(submissionTimestampIso(row.gradedAt) === null
      ? {}
      : { gradedAt: submissionTimestampIso(row.gradedAt) as string }),
    id: row.id,
    ...(row.marks === null ? {} : { marks: row.marks }),
    ...(row.objectPath === null ? {} : { objectPath: row.objectPath }),
    studentId: row.studentId,
    studentName: row.studentName,
    ...(submissionTimestampIso(row.submittedAt) === null
      ? {}
      : { submittedAt: submissionTimestampIso(row.submittedAt) as string }),
  };
}

/**
 * The submitting student's display name, read beside the submission row.
 *
 * A correlated subquery rather than a join, for the mutations whose shape has no
 * room for one — an `update … returning` and two statements inside the confirm
 * transaction. `assignment_submissions.student_id` is a foreign key to
 * `user_profiles.id` and `display_name` is not null, so the only way this reads
 * null is a profile filed under a different school than the submission, which is
 * cross-tenant corruption rather than a state to render.
 */
const submissionStudentName = sql<string>`(
  select profile.display_name
  from public.user_profiles profile
  where profile.id = "assignment_submissions"."student_id"
    and profile.school_id = "assignment_submissions"."school_id"
)`;

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
        assignedAt: assignments.createdAt,
        dueAt: assignments.dueAt,
        gradedAt: assignmentSubmissions.gradedAt,
        gradingType: assignments.gradingType,
        id: assignments.id,
        isGraded: assignments.isGraded,
        marks: assignmentSubmissions.marks,
        schoolId: assignments.schoolId,
        subjectId: assignments.subjectId,
        subjectName: subjects.name,
        submittedAt: assignmentSubmissions.submittedAt,
        title: assignments.title,
      })
      .from(assignments)
      .innerJoin(subjects, and(
        eq(subjects.id, assignments.subjectId),
        eq(subjects.schoolId, assignments.schoolId),
      ))
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
      assignedAt: row.assignedAt.toISOString(),
      dueAt: row.dueAt.toISOString(),
      ...(row.gradedAt === null ? {} : { gradedAt: row.gradedAt.toISOString() }),
      gradingType: row.gradingType,
      id: row.id,
      isGradedAssignment: row.isGraded,
      ...(row.marks === null ? {} : { marks: row.marks }),
      subjectId: row.subjectId,
      subjectName: row.subjectName,
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
    if (record === undefined) return undefined;
    const [detail, [own]] = await Promise.all([
      this.withDetails(record),
      this.db
        .select({
          gradedAt: assignmentSubmissions.gradedAt,
          marks: assignmentSubmissions.marks,
          submittedAt: assignmentSubmissions.submittedAt,
        })
        .from(assignmentSubmissions)
        .where(and(
          eq(assignmentSubmissions.assignmentId, assignmentId),
          eq(assignmentSubmissions.schoolId, identity.schoolId),
          eq(assignmentSubmissions.studentId, identity.userId),
        ))
        .limit(1),
    ]);
    // Tolerant conversion: a malformed or absent submission timestamp must
    // degrade to "no submission", never throw a RangeError and turn the whole
    // detail into a 500.
    const gradedAtIso = submissionTimestampIso(own?.gradedAt ?? null);
    const submittedAtIso = submissionTimestampIso(own?.submittedAt ?? null);
    return {
      ...detail,
      ...(gradedAtIso === null ? {} : { gradedAt: gradedAtIso }),
      ...(typeof own?.marks === 'number' ? { marks: own.marks } : {}),
      ...(submittedAtIso === null ? {} : { submittedAt: submittedAtIso }),
    };
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
        displayCode: assignments.displayCode,
        dueAt: assignments.dueAt,
        gradingType: assignments.gradingType,
        id: assignments.id,
        isGraded: assignments.isGraded,
        maxMarks: assignments.maxMarks,
        schoolId: assignments.schoolId,
        subjectId: assignments.subjectId,
        // Students who have durably submitted, aggregated over the whole class.
        // A draft row exists from the moment a student opens the upload sheet,
        // so `submitted_at is not null` is what separates a submission from an
        // intention. Joining the roster keeps the count from ever exceeding
        // totalStudents when a submitter has since left the class, so the
        // card's Pending remainder cannot go negative.
        submissionCount: sql<string>`(
          select count(*)
          from public.assignment_submissions submitted
          join public.class_members roster
            on roster.school_id = submitted.school_id
            and roster.class_id = "assignments"."class_id"
            and roster.student_id = submitted.student_id
            and roster.is_active
          where submitted.school_id = ${identity.schoolId}::uuid
            and submitted.assignment_id = "assignments"."id"
            and submitted.submitted_at is not null
        )`,
        title: assignments.title,
        // Enrolled students of the assignment's own class, not of the page.
        totalStudents: sql<string>`(
          select count(*)
          from public.class_members roster
          where roster.school_id = ${identity.schoolId}::uuid
            and roster.class_id = "assignments"."class_id"
            and roster.is_active
        )`,
      })
      .from(assignments)
      .where(and(
        eq(assignments.schoolId, identity.schoolId),
        eq(assignments.classId, classId),
        eq(assignments.teacherId, identity.userId),
        isNull(assignments.deletedAt),
        this.teacherAssignment(identity, assignments.classId, assignments.subjectId),
        // Active vs Graded is grading PROGRESS, not the creation-time
        // "Graded Assignment" toggle stored in `is_graded`. Reading the toggle
        // filed every assignment the authoring form created with grading on
        // (its default) under Graded the instant it was written, so a teacher
        // who had just created one found it in neither tab — Active excluded it
        // by the toggle, and the Graded tab's own due-date filter excluded it
        // again unless it happened to be due that very day.
        query.status === 'active' ? not(this.hasGradedSubmission(identity)) : undefined,
        query.status === 'graded' ? this.hasGradedSubmission(identity) : undefined,
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
      displayCode: row.displayCode,
      dueAt: row.dueAt.toISOString(),
      gradingType: row.gradingType,
      id: row.id,
      isGradedAssignment: row.isGraded,
      ...(row.maxMarks === null ? {} : { maxMarks: row.maxMarks }),
      subjectId: row.subjectId,
      submissionCount: Number(row.submissionCount),
      title: row.title,
      totalStudents: Number(row.totalStudents),
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
    const displayCodePrefix = `ASG-${new Date().getUTCFullYear()}-`;
    let created: string | undefined;
    for (let attempt = 1; attempt <= DISPLAY_CODE_MAX_ATTEMPTS; attempt += 1) {
      try {
        created = await this.insertAssignment(identity, classId, input, displayCodePrefix);
        break;
      } catch (error) {
        if (attempt === DISPLAY_CODE_MAX_ATTEMPTS || !isDisplayCodeConflict(error)) throw error;
      }
    }
    if (created === undefined) return undefined;
    const record = await this.findOne(and(
      eq(assignments.id, created),
      eq(assignments.schoolId, identity.schoolId),
      eq(assignments.teacherId, identity.userId),
    ));
    return record === undefined ? undefined : this.withDetails(record);
  }

  /**
   * One statement writes the row and derives its display code, so the sequence is
   * read under the same snapshot that inserts. `count(*) + 1` counts only codes
   * already issued to this school for this year; rows predating the column carry a
   * null code and are skipped, which keeps the first new code at 001.
   *
   * The pad width is `greatest(3, length(n))`, not a bare 3: `lpad` truncates on
   * the right when its input is longer than the width, so a fixed 3 would render
   * the 1000th code as 'ASG-<year>-100' — a code already issued to the 100th
   * assignment. That collides on every attempt, and because nothing new commits
   * between retries the recomputed value is identical, so the retry loop would
   * exhaust and every later create in that school would fail until the year rolled
   * over. Widening past three digits is what keeps the sequence collision-free.
   */
  private async insertAssignment(
    identity: AssignmentIdentity,
    classId: string,
    input: CreateAssignmentInput,
    displayCodePrefix: string,
  ): Promise<string | undefined> {
    return this.db.transaction(async (transaction) => {
      const createdRows = await transaction.execute(sql<{ id: string }>`
        with issued_sequence as (
          select count(*) + 1 as value
          from public.assignments issued
          where issued.school_id = ${identity.schoolId}::uuid
            and issued.display_code like ${displayCodePrefix}::text || '%'
        )
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
          max_marks,
          display_code
        )
        select
          ${identity.schoolId}::uuid,
          ${classId}::uuid,
          ${input.subjectId}::uuid,
          ${identity.userId}::uuid,
          ${input.title},
          ${input.instructions},
          ${input.dueAt}::timestamptz,
          ${input.isGradedAssignment},
          ${input.gradingType},
          ${input.maxMarks ?? null},
          ${displayCodePrefix}::text || lpad(
            issued_sequence.value::text,
            greatest(3, length(issued_sequence.value::text)),
            '0'
          )
        from public.class_subjects
        cross join issued_sequence
        where class_subjects.school_id = ${identity.schoolId}::uuid
          and class_subjects.class_id = ${classId}::uuid
          and class_subjects.subject_id = ${input.subjectId}::uuid
          and class_subjects.teacher_id = ${identity.userId}::uuid
        returning id
      `);
      const assignment = (createdRows as unknown as ReadonlyArray<{ id: string }>)[0];
      if (assignment === undefined) return undefined;
      // Rubrics are optional, and Drizzle throws on an empty `values([])`
      // rather than writing nothing — so the absence has to be handled here
      // instead of being pushed into the driver.
      const rubrics = input.rubrics ?? [];
      if (rubrics.length > 0) {
        await transaction.insert(assignmentRubrics).values(rubrics.map((rubric) => ({
          assignmentId: assignment.id,
          marks: rubric.marks,
          ...(rubric.moreInfo === undefined ? {} : { moreInfo: rubric.moreInfo }),
          position: rubric.position,
          topic: rubric.topic,
        })));
      }
      return assignment.id;
    });
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
      // An omitted `rubrics` key is "leave the breakdown as it is", not "wipe
      // it": the delete-then-reinsert below is destructive, so it only runs
      // when the caller actually stated a breakdown. An explicit `[]` still
      // clears, which is how a teacher removes one.
      if (input.rubrics !== undefined) {
        await transaction.delete(assignmentRubrics).where(eq(assignmentRubrics.assignmentId, assignment.id));
        if (input.rubrics.length > 0) {
          await transaction.insert(assignmentRubrics).values(input.rubrics.map((rubric) => ({
            assignmentId: assignment.id,
            marks: rubric.marks,
            ...(rubric.moreInfo === undefined ? {} : { moreInfo: rubric.moreInfo }),
            position: rubric.position,
            topic: rubric.topic,
          })));
        }
      }
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
        completed_at: Date | null;
        feedback: string | null;
        graded_at: Date | null;
        id: string;
        marks: number | null;
        object_path: string | null;
        studentName: string;
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
          graded_at,
          completed_at,
          ${submissionStudentName} as "studentName"
        from public.assignment_submissions
        where school_id = ${input.identity.schoolId}::uuid
          and assignment_id = ${input.assignmentId}::uuid
          and student_id = ${input.identity.userId}::uuid
        for update
      `);
      const locked = (lockedRows as unknown as ReadonlyArray<{
        assignment_id: string;
        completed_at: Date | null;
        feedback: string | null;
        graded_at: Date | null;
        id: string;
        marks: number | null;
        object_path: string | null;
        studentName: string;
        student_id: string;
        submitted_at: Date | null;
        upload_session_id: string | null;
      }>)[0];
      if (locked === undefined) return undefined;
      if (locked.upload_session_id !== null) {
        const submission = toStoredSubmission({
          assignmentId: locked.assignment_id,
          completedAt: locked.completed_at,
          feedback: locked.feedback,
          gradedAt: locked.graded_at,
          id: locked.id,
          marks: locked.marks,
          objectPath: locked.object_path,
          studentId: locked.student_id,
          studentName: locked.studentName,
          submittedAt: locked.submitted_at,
        });
        return locked.upload_session_id === input.uploadSessionId
          ? { kind: "already_attached", submission }
          : { kind: "conflict" };
      }

      // `submittedAt` is a Date, and a raw `sql` parameter reaches the driver
      // untouched — unlike a Drizzle query builder, nothing converts it. Passing
      // the Date itself throws "The 'string' argument must be of type string ...
      // Received an instance of Date" and fails every submission with a 500, so
      // it is serialised here. Every other `::timestamptz` in the repositories
      // is already a string.
      const submittedAtIso = input.submittedAt.toISOString();
      const updatedRows = await transaction.execute(sql<{
        assignment_id: string;
        completed_at: Date | null;
        feedback: string | null;
        graded_at: Date | null;
        id: string;
        marks: number | null;
        object_path: string | null;
        studentName: string;
        student_id: string;
        submitted_at: Date | null;
      }>`
        update public.assignment_submissions
        set upload_session_id = ${input.uploadSessionId}::uuid,
            object_path = ${input.objectPath},
            display_name = ${input.displayName},
            submitted_at = ${submittedAtIso}::timestamptz,
            updated_at = ${submittedAtIso}::timestamptz
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
          graded_at,
          completed_at,
          ${submissionStudentName} as "studentName"
      `);
      const updated = (updatedRows as unknown as ReadonlyArray<{
        assignment_id: string;
        completed_at: Date | null;
        feedback: string | null;
        graded_at: Date | null;
        id: string;
        marks: number | null;
        object_path: string | null;
        studentName: string;
        student_id: string;
        submitted_at: Date | null;
      }>)[0];
      return updated === undefined ? undefined : { kind: 'attached' as const, submission: toStoredSubmission({
        assignmentId: updated.assignment_id,
        completedAt: updated.completed_at,
        feedback: updated.feedback,
        gradedAt: updated.graded_at,
        id: updated.id,
        marks: updated.marks,
        objectPath: updated.object_path,
        studentId: updated.student_id,
        studentName: updated.studentName,
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
        completedAt: assignmentSubmissions.completedAt,
        feedback: assignmentSubmissions.feedback,
        gradedAt: assignmentSubmissions.gradedAt,
        id: assignmentSubmissions.id,
        marks: assignmentSubmissions.marks,
        objectPath: assignmentSubmissions.objectPath,
        schoolId: assignmentSubmissions.schoolId,
        studentId: assignmentSubmissions.studentId,
        studentName: userProfiles.displayName,
        submittedAt: assignmentSubmissions.submittedAt,
      })
      .from(assignmentSubmissions)
      .innerJoin(assignments, and(
        eq(assignments.id, assignmentSubmissions.assignmentId),
        eq(assignments.schoolId, assignmentSubmissions.schoolId),
      ))
      // The name the roster row, the search box and the footer print. Joined on
      // the tenant as well as the student key, so a profile from another school
      // can never name a submission in this one.
      .innerJoin(userProfiles, and(
        eq(userProfiles.id, assignmentSubmissions.studentId),
        eq(userProfiles.schoolId, assignmentSubmissions.schoolId),
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
        completedAt: assignmentSubmissions.completedAt,
        feedback: assignmentSubmissions.feedback,
        gradedAt: assignmentSubmissions.gradedAt,
        id: assignmentSubmissions.id,
        marks: assignmentSubmissions.marks,
        objectPath: assignmentSubmissions.objectPath,
        studentId: assignmentSubmissions.studentId,
        studentName: submissionStudentName,
        submittedAt: assignmentSubmissions.submittedAt,
      });
    return updated === undefined ? undefined : toStoredSubmission(updated);
  }

  // Completion is a timestamp on the submission, independent of grading, so this
  // reuses the ownership half of the grade guard — school, owning teacher, live
  // assignment, live class_subjects assignment — and deliberately drops the
  // grading-only predicates (`gradingType = 'Numeric'`, `maxMarks >= marks`) and
  // the `submitted_at is not null` requirement: a teacher can close out work that
  // was never uploaded. Both directions are idempotent — `complete` coalesces onto
  // any existing instant so a replay preserves the first one, `incomplete` nulls it.
  public async setSubmissionCompletion(
    identity: AssignmentIdentity,
    submissionId: string,
    action: SubmissionCompletionAction,
    completedAt: Date,
  ): Promise<SubmissionCompletion | undefined> {
    const [updated] = await this.db
      .update(assignmentSubmissions)
      .set({
        completedAt: action === 'complete'
          ? sql`coalesce(${assignmentSubmissions.completedAt}, ${completedAt})`
          : null,
        updatedAt: completedAt,
      })
      .where(and(
        eq(assignmentSubmissions.id, submissionId),
        eq(assignmentSubmissions.schoolId, identity.schoolId),
        this.completionAuthorization(identity),
      ))
      .returning({
        completedAt: assignmentSubmissions.completedAt,
        id: assignmentSubmissions.id,
      });
    return updated === undefined ? undefined : {
      completedAt: updated.completedAt === null ? null : updated.completedAt.toISOString(),
      id: updated.id,
    };
  }

  private completionAuthorization(identity: AssignmentIdentity) {
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
      )));
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
    // Every column is aliased, because `toStoredSubmission` reads camelCase and
    // `execute` returns the driver's own labels: unaliased columns arrived as
    // `assignment_id`/`graded_at`/… and read `undefined`, so the mapper threw on
    // `row.gradedAt.toISOString()` for every row it found and this recovery
    // could never succeed. Only `completed_at` had been aliased.
    const rows = await this.db.execute(sql<SubmissionRow>`
      select submission.id, submission.assignment_id as "assignmentId",
        submission.student_id as "studentId", profile.display_name as "studentName",
        submission.object_path as "objectPath", submission.submitted_at as "submittedAt",
        submission.marks, submission.feedback, submission.graded_at as "gradedAt",
        submission.completed_at as "completedAt"
      from public.assignment_submissions submission
      join public.assignments assignment
        on assignment.id = submission.assignment_id
        and assignment.school_id = submission.school_id
      join public.class_members member
        on member.school_id = assignment.school_id
        and member.class_id = assignment.class_id
        and member.student_id = submission.student_id
        and member.is_active
      join public.user_profiles profile
        on profile.id = submission.student_id
        and profile.school_id = submission.school_id
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

  /**
   * Whether the teacher has graded anyone on this assignment yet. `graded_at`
   * is written only by the grading endpoint, and the table's own check
   * constraint keeps it in step with `marks`, so a single graded submission is
   * an unambiguous "grading has started here". A freshly created assignment has
   * no submissions at all, so it is Active by construction — which is the whole
   * point of deriving the tab from this rather than from `is_graded`.
   */
  private hasGradedSubmission(identity: AssignmentIdentity) {
    return exists(this.db
      .select({ id: assignmentSubmissions.id })
      .from(assignmentSubmissions)
      .where(and(
        eq(assignmentSubmissions.schoolId, identity.schoolId),
        eq(assignmentSubmissions.assignmentId, assignments.id),
        isNotNull(assignmentSubmissions.gradedAt),
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
        displayCode: assignments.displayCode,
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
      assignedAt: record.createdAt.toISOString(),
      classId: record.classId,
      displayCode: record.displayCode,
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
