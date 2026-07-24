import {
  and,
  desc,
  eq,
  exists,
  isNotNull,
  isNull,
  lt,
  notExists,
  or,
  sql,
} from 'drizzle-orm';

import type { Database } from '../client.js';
import { classMembers, classSubjects } from '../schema/core.js';
import {
  classExams,
  examGroups,
  examResources,
  examResults,
  examResultRevisions,
  examRubrics,
} from '../schema/exams.js';
import type {
  CreateExamAssessmentInput,
  CreateExamGroupInput,
  CursorPage,
  ExamAssessment,
  ExamAssessmentDetail,
  ExamAssessmentListQuery,
  ExamGroup,
  ExamGroupDetail,
  ExamGroupListQuery,
  ExamIdentity,
  ExamResource,
  ExamResult,
  ExamResultListQuery,
  ExamSubmission,
  ExamSubmissionRoster,
  ExamSubmissionRosterEntry,
  ExamRubric,
  LeaderboardEntry,
  LeaderboardQuery,
  UpdateExamAssessmentInput,
  UpdateExamGroupInput,
  UpsertExamResultInput,
} from '../../types/exams.js';
import {
  encodeAssessmentCursor,
  encodeExamGroupCursor,
  encodeLeaderboardCursor,
  encodeResultCursor,
} from '../../types/exams.js';

export interface StoredExamResource extends Omit<ExamResource, 'signedUrl'> {
  objectPath: string;
}

export interface StoredExamAssessment extends Omit<ExamAssessmentDetail, 'resources'> {
  classId: string;
  groupId: string;
  resources: ReadonlyArray<StoredExamResource>;
}

export interface ManageableAssessment {
  classId: string;
  groupId: string;
  maxMarks: number;
}

export interface ExamsRepository {
  canManageAssessment(identity: ExamIdentity, assessmentId: string): Promise<boolean>;
  createAssessment(identity: ExamIdentity, groupId: string, input: CreateExamAssessmentInput): Promise<StoredExamAssessment | undefined>;
  createGroup(identity: ExamIdentity, classId: string, input: CreateExamGroupInput): Promise<ExamGroup | undefined>;
  deleteAssessment(identity: ExamIdentity, assessmentId: string, deletedAt: Date): Promise<boolean>;
  deleteGroup(identity: ExamIdentity, groupId: string, deletedAt: Date): Promise<boolean>;
  findAssessmentForResultEntry(identity: ExamIdentity, assessmentId: string): Promise<ManageableAssessment | undefined>;
  findAssessmentForTeacher(identity: ExamIdentity, assessmentId: string): Promise<StoredExamAssessment | undefined>;
  findAssessmentForStudent(identity: ExamIdentity, assessmentId: string): Promise<StoredExamAssessment | undefined>;
  findGroupForStudent(identity: ExamIdentity, groupId: string): Promise<ExamGroupDetail | undefined>;
  getLeaderboard(identity: ExamIdentity, groupId: string, query: LeaderboardQuery): Promise<CursorPage<LeaderboardEntry> | undefined>;
  findResourceForUpload(input: { assessmentId: string; identity: ExamIdentity; uploadSessionId: string }): Promise<StoredExamResource | undefined>;
  insertResource(input: {
    assessmentId: string;
    displayName: string;
    identity: ExamIdentity;
    objectPath: string;
    schoolId: string;

    uploadSessionId: string;
  }): Promise<StoredExamResource | undefined>;
  listReminderStudents(identity: ExamIdentity, assessmentId: string): Promise<ReadonlyArray<string> | undefined>;
  listSubmissionRoster(identity: ExamIdentity, assessmentId: string): Promise<ExamSubmissionRoster | undefined>;
  listAssessmentsForTeacher(identity: ExamIdentity, groupId: string, query: ExamAssessmentListQuery): Promise<CursorPage<ExamAssessment>>;
  listGroupsForStudent(identity: ExamIdentity, query: ExamGroupListQuery): Promise<CursorPage<ExamGroup>>;
  listGroupsForTeacher(identity: ExamIdentity, classId: string, query: ExamGroupListQuery): Promise<CursorPage<ExamGroup>>;
  listResults(identity: ExamIdentity, assessmentId: string, query: ExamResultListQuery): Promise<CursorPage<ExamResult> | undefined>;
  listPublishedAwardRecipients(identity: ExamIdentity, assessmentId: string): Promise<ReadonlyArray<{ id: string; publishedAt: Date; studentId: string }>>;
  publishAssessment(identity: ExamIdentity, assessmentId: string, publishedAt: Date): Promise<StoredExamAssessment | undefined>;
  publishResults(identity: ExamIdentity, assessmentId: string, publishedAt: Date): Promise<boolean>;
  recordSubmission(identity: ExamIdentity, assessmentId: string, studentId: string, submittedAt: Date): Promise<ExamSubmission | undefined>;
  studentCanBeReminded(identity: ExamIdentity, assessmentId: string, studentId: string): Promise<boolean>;
  updateAssessment(identity: ExamIdentity, assessmentId: string, input: UpdateExamAssessmentInput): Promise<StoredExamAssessment | undefined>;
  updateGroup(identity: ExamIdentity, groupId: string, input: UpdateExamGroupInput): Promise<ExamGroup | undefined>;
  upsertResult(identity: ExamIdentity, assessmentId: string, studentId: string, input: UpsertExamResultInput, updatedAt: Date): Promise<ExamResult | undefined>;
  withTransaction<T>(
    callback: (repository: ExamsRepository, transaction: Database) => Promise<T>,
  ): Promise<T>;
}

type GroupRow = {
  classId: string;
  endsOn: string;
  id: string;
  startsOn: string;
  state: ExamGroup['state'];
  title: string;
};

type AssessmentRow = {
  classId?: string;
  endsAt: string | null;
  examGroupId: string | null;
  id: string;
  maxMarks: number | null;
  scheduledOn: string;
  startsAt: string | null;
  subjectId: string;
  syllabus: string | null;
  title: string;
};

type ResultRow = {
  feedback: string | null;
  id: string;
  marks: number;
  publishedAt: Date | null;
  studentId: string;
  updatedAt: Date;
};

function toGroup(row: GroupRow): ExamGroup {
  return {
    classId: row.classId,
    endsOn: row.endsOn,
    id: row.id,
    startsOn: row.startsOn,
    state: row.state,
    title: row.title,
  };
}

function toAssessment(row: AssessmentRow): ExamAssessment | undefined {
  if (row.endsAt === null || row.maxMarks === null || row.startsAt === null) return undefined;
  return {
    endsAt: row.endsAt,
    id: row.id,
    maxMarks: row.maxMarks,
    scheduledOn: row.scheduledOn,
    startsAt: row.startsAt,
    subjectId: row.subjectId,
    ...(row.syllabus === null ? {} : { syllabus: row.syllabus }),
    title: row.title,
  };
}

function toResult(row: ResultRow): ExamResult {
  return {
    ...(row.feedback === null ? {} : { feedback: row.feedback }),
    id: row.id,
    marks: row.marks,
    ...(row.publishedAt === null ? {} : { publishedAt: row.publishedAt.toISOString() }),
    studentId: row.studentId,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class DrizzleExamsRepository implements ExamsRepository {
  public constructor(private readonly db: Database) {}

  public async withTransaction<T>(
    callback: (repository: ExamsRepository, transaction: Database) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (transaction) => {
      const database = transaction as unknown as Database;
      return callback(new DrizzleExamsRepository(database), database);
    });
  }
  public async listGroupsForStudent(
    identity: ExamIdentity,
    query: ExamGroupListQuery,
  ): Promise<CursorPage<ExamGroup>> {
    const cursor = query.cursor;
    const rows = await this.db.select({
      classId: examGroups.classId,
      endsOn: examGroups.endsOn,
      id: examGroups.id,
      startsOn: examGroups.startsOn,
      state: examGroups.state,
      title: examGroups.title,
    }).from(examGroups).where(and(
      eq(examGroups.schoolId, identity.schoolId),
      isNull(examGroups.deletedAt),
      this.studentAudienceForGroup(identity),
      this.groupHasPublishedAssessment(),
      cursor === undefined ? undefined : or(
        lt(examGroups.startsOn, cursor.startsOn),
        and(eq(examGroups.startsOn, cursor.startsOn), lt(examGroups.id, cursor.id)),
      ),
    )).orderBy(desc(examGroups.startsOn), desc(examGroups.id)).limit(query.limit + 1);
    const items = rows.slice(0, query.limit).map(toGroup);
    const last = items.at(-1);
    return {
      items,
      ...(rows.length > query.limit && last !== undefined ? {
        nextCursor: encodeExamGroupCursor({ id: last.id, startsOn: last.startsOn }),
      } : {}),
    };
  }

  public async findGroupForStudent(identity: ExamIdentity, groupId: string): Promise<ExamGroupDetail | undefined> {
    const [group] = await this.db.select({
      classId: examGroups.classId,
      endsOn: examGroups.endsOn,
      id: examGroups.id,
      startsOn: examGroups.startsOn,
      state: examGroups.state,
      title: examGroups.title,
    }).from(examGroups).where(and(
      eq(examGroups.id, groupId),
      eq(examGroups.schoolId, identity.schoolId),
      isNull(examGroups.deletedAt),
      this.studentAudienceForGroup(identity),
      this.groupHasPublishedAssessment(),
    )).limit(1);
    if (group === undefined) return undefined;
    const assessments = await this.listPublishedAssessments(identity, group.id);
    return { ...toGroup(group), assessments };
  }

  public async findAssessmentForStudent(
    identity: ExamIdentity,
    assessmentId: string,
  ): Promise<StoredExamAssessment | undefined> {
    const [assessment] = await this.db.select({
      classId: classExams.classId,
      endsAt: classExams.endsAt,
      examGroupId: classExams.examGroupId,
      id: classExams.id,
      maxMarks: classExams.maxMarks,
      scheduledOn: classExams.scheduledOn,
      startsAt: classExams.startsAt,
      subjectId: classExams.subjectId,
      syllabus: classExams.syllabus,
      title: classExams.title,
    }).from(classExams).where(and(
      eq(classExams.id, assessmentId),
      eq(classExams.schoolId, identity.schoolId),
      eq(classExams.isPublished, true),
      isNull(classExams.deletedAt),
      isNotNull(classExams.examGroupId),
      this.studentAudienceForAssessment(identity),
      this.activeGroupForAssessment(identity),
    )).limit(1);
    return assessment === undefined ? undefined : this.withDetails(assessment, identity.userId);
  }

  public async findAssessmentForTeacher(
    identity: ExamIdentity,
    assessmentId: string,
  ): Promise<StoredExamAssessment | undefined> {
    return this.findManagedAssessment(identity, assessmentId);
  }

  public async listGroupsForTeacher(
    identity: ExamIdentity,
    classId: string,
    query: ExamGroupListQuery,
  ): Promise<CursorPage<ExamGroup>> {
    const cursor = query.cursor;
    const rows = await this.db.select({
      classId: examGroups.classId,
      endsOn: examGroups.endsOn,
      id: examGroups.id,
      startsOn: examGroups.startsOn,
      state: examGroups.state,
      title: examGroups.title,
    }).from(examGroups).where(and(
      eq(examGroups.schoolId, identity.schoolId),
      eq(examGroups.classId, classId),
      isNull(examGroups.deletedAt),
      this.teacherAssignmentForGroup(identity),
      cursor === undefined ? undefined : or(
        lt(examGroups.startsOn, cursor.startsOn),
        and(eq(examGroups.startsOn, cursor.startsOn), lt(examGroups.id, cursor.id)),
      ),
    )).orderBy(desc(examGroups.startsOn), desc(examGroups.id)).limit(query.limit + 1);
    const items = rows.slice(0, query.limit).map(toGroup);
    const last = items.at(-1);
    return {
      items,
      ...(rows.length > query.limit && last !== undefined ? {
        nextCursor: encodeExamGroupCursor({ id: last.id, startsOn: last.startsOn }),
      } : {}),
    };
  }

  public async createGroup(
    identity: ExamIdentity,
    classId: string,
    input: CreateExamGroupInput,
  ): Promise<ExamGroup | undefined> {
    const rows = await this.db.execute(sql`
      insert into public.exam_groups (
        school_id, class_id, creator_teacher_id, title, starts_on, ends_on, state
      )
      select
        ${identity.schoolId}::uuid,
        ${classId}::uuid,
        ${identity.userId}::uuid,
        ${input.title},
        ${input.startsOn}::date,
        ${input.endsOn}::date,
        ${input.state ?? 'draft'}
      where exists (
        select 1 from public.class_subjects cs
        where cs.school_id = ${identity.schoolId}::uuid
          and cs.class_id = ${classId}::uuid
          and cs.teacher_id = ${identity.userId}::uuid
      )
      returning
        id,
        class_id as "classId",
        ends_on as "endsOn",
        starts_on as "startsOn",
        state,
        title
    `) as unknown as ReadonlyArray<GroupRow>;
    const created = rows[0];
    return created === undefined ? undefined : toGroup(created);
  }

  public async updateGroup(

    identity: ExamIdentity,
    groupId: string,
    input: UpdateExamGroupInput,
  ): Promise<ExamGroup | undefined> {
    const [updated] = await this.db.update(examGroups).set({
      endsOn: input.endsOn,
      startsOn: input.startsOn,
      ...(input.state === undefined ? {} : { state: input.state }),
      title: input.title,
      updatedAt: new Date(),
    }).where(and(
      eq(examGroups.id, groupId),
      eq(examGroups.schoolId, identity.schoolId),
      eq(examGroups.creatorTeacherId, identity.userId),
      isNull(examGroups.deletedAt),
      this.teacherAssignmentForGroup(identity),
      notExists(this.db.select({ id: classExams.id }).from(classExams).where(and(
        eq(classExams.examGroupId, groupId),
        isNull(classExams.deletedAt),
        or(lt(classExams.scheduledOn, input.startsOn), sql`${classExams.scheduledOn} > ${input.endsOn}`),
      ))),
    )).returning({
      classId: examGroups.classId,
      endsOn: examGroups.endsOn,
      id: examGroups.id,
      startsOn: examGroups.startsOn,
      state: examGroups.state,
      title: examGroups.title,
    });
    return updated === undefined ? undefined : toGroup(updated);
  }

  public async deleteGroup(identity: ExamIdentity, groupId: string, deletedAt: Date): Promise<boolean> {
    const [deleted] = await this.db.update(examGroups).set({ deletedAt, updatedAt: deletedAt }).where(and(
      eq(examGroups.id, groupId),
      eq(examGroups.schoolId, identity.schoolId),
      eq(examGroups.creatorTeacherId, identity.userId),
      isNull(examGroups.deletedAt),
      this.teacherAssignmentForGroup(identity),
    )).returning({ id: examGroups.id });
    return deleted !== undefined;
  }

  public async listAssessmentsForTeacher(
    identity: ExamIdentity,
    groupId: string,
    query: ExamAssessmentListQuery,
  ): Promise<CursorPage<ExamAssessment>> {
    const cursor = query.cursor;
    const rows = await this.db.select({
      endsAt: classExams.endsAt,
      examGroupId: classExams.examGroupId,
      id: classExams.id,
      maxMarks: classExams.maxMarks,
      scheduledOn: classExams.scheduledOn,
      startsAt: classExams.startsAt,
      subjectId: classExams.subjectId,
      syllabus: classExams.syllabus,
      isPublished: classExams.isPublished,
      resultsPublished: sql<boolean>`exists (
        select 1 from public.exam_results result_status
        where result_status.assessment_id = "class_exams"."id"
          and result_status.published_at is not null
      )`,
      title: classExams.title,
    }).from(classExams).where(and(
      eq(classExams.schoolId, identity.schoolId),
      eq(classExams.examGroupId, groupId),
      eq(classExams.teacherId, identity.userId),
      isNull(classExams.deletedAt),
      this.teacherAssignmentForAssessment(identity),
      this.activeGroupForAssessment(identity),
      cursor === undefined ? undefined : or(
        lt(classExams.scheduledOn, cursor.scheduledOn),
        and(eq(classExams.scheduledOn, cursor.scheduledOn), lt(classExams.id, cursor.id)),
      ),
    )).orderBy(desc(classExams.scheduledOn), desc(classExams.id)).limit(query.limit + 1);
    const items = rows.slice(0, query.limit).flatMap((row) => {
      const assessment = toAssessment(row);
      return assessment === undefined ? [] : [{
        ...assessment,
        isPublished: row.isPublished,
        resultsPublished: row.resultsPublished,
      }];
    });
    const last = items.at(-1);
    return {
      items,
      ...(rows.length > query.limit && last !== undefined ? {
        nextCursor: encodeAssessmentCursor({ id: last.id, scheduledOn: last.scheduledOn }),
      } : {}),
    };
  }

  public async createAssessment(
    identity: ExamIdentity,
    groupId: string,
    input: CreateExamAssessmentInput,
  ): Promise<StoredExamAssessment | undefined> {
    const assessmentId = await this.db.transaction(async (transaction) => {
      const rows = await transaction.execute(sql`
      insert into public.class_exams (
        school_id, class_id, exam_group_id, subject_id, teacher_id, title,
        scheduled_on, starts_at, ends_at, max_marks, syllabus
      )
      select
        ${identity.schoolId}::uuid,
        eg.class_id,
        eg.id,
        ${input.subjectId}::uuid,
        ${identity.userId}::uuid,
        ${input.title},
        ${input.scheduledOn}::date,
        ${input.startsAt}::time,
        ${input.endsAt}::time,
        ${input.maxMarks},
        ${input.syllabus ?? null}
      from public.exam_groups eg
      where eg.id = ${groupId}::uuid
        and eg.school_id = ${identity.schoolId}::uuid
        and eg.deleted_at is null
        and eg.starts_on <= ${input.scheduledOn}::date
        and eg.ends_on >= ${input.scheduledOn}::date
        and exists (
          select 1 from public.class_subjects cs
          where cs.school_id = ${identity.schoolId}::uuid
            and cs.class_id = eg.class_id
            and cs.subject_id = ${input.subjectId}::uuid
            and cs.teacher_id = ${identity.userId}::uuid
        )
      returning id
    `) as unknown as ReadonlyArray<{ id: string }>;
    const created = rows[0];
    if (created === undefined) return undefined;
    await transaction.insert(examRubrics).values(input.rubrics.map((rubric) => ({
      assessmentId: created.id,
      description: rubric.description,
      marks: rubric.marks,
      position: rubric.position,
      sectionTitle: rubric.sectionTitle,
    })));
    return created.id;
    });
    return assessmentId === undefined ? undefined : this.findManagedAssessment(identity, assessmentId);
  }

  public async updateAssessment(

    identity: ExamIdentity,
    assessmentId: string,
    input: UpdateExamAssessmentInput,
  ): Promise<StoredExamAssessment | undefined> {
    const updated = await this.db.transaction(async (transaction) => {
      const rows = await transaction.execute(sql`
        update public.class_exams assessment
        set
          ends_at = ${input.endsAt}::time,
          max_marks = ${input.maxMarks},
          scheduled_on = ${input.scheduledOn}::date,
          starts_at = ${input.startsAt}::time,
          subject_id = ${input.subjectId}::uuid,
          syllabus = ${input.syllabus ?? null},
          title = ${input.title},
          updated_at = now()
        where assessment.id = ${assessmentId}::uuid
          and assessment.school_id = ${identity.schoolId}::uuid
          and assessment.teacher_id = ${identity.userId}::uuid
          and assessment.deleted_at is null
          and exists (
            select 1 from public.class_subjects old_subject_assignment
            where old_subject_assignment.school_id = ${identity.schoolId}::uuid
              and old_subject_assignment.class_id = assessment.class_id
              and old_subject_assignment.subject_id = assessment.subject_id
              and old_subject_assignment.teacher_id = ${identity.userId}::uuid
          )
          and exists (
            select 1 from public.class_subjects new_subject_assignment
            where new_subject_assignment.school_id = ${identity.schoolId}::uuid
              and new_subject_assignment.class_id = assessment.class_id
              and new_subject_assignment.subject_id = ${input.subjectId}::uuid
              and new_subject_assignment.teacher_id = ${identity.userId}::uuid
          )
          and exists (
            select 1 from public.exam_groups group_range
            where group_range.id = assessment.exam_group_id
              and group_range.school_id = ${identity.schoolId}::uuid
              and group_range.deleted_at is null
              and group_range.starts_on <= ${input.scheduledOn}::date
              and group_range.ends_on >= ${input.scheduledOn}::date
          )
        returning assessment.id
      `) as unknown as ReadonlyArray<{ id: string }>;
      const assessment = rows[0];
      if (assessment === undefined) return undefined;
      await transaction.delete(examRubrics).where(eq(examRubrics.assessmentId, assessment.id));
      await transaction.insert(examRubrics).values(input.rubrics.map((rubric) => ({
        assessmentId: assessment.id,
        description: rubric.description,
        marks: rubric.marks,
        position: rubric.position,
        sectionTitle: rubric.sectionTitle,
      })));
      return assessment.id;
    });
    return updated === undefined ? undefined : this.findManagedAssessment(identity, updated);
  }

  public async deleteAssessment(identity: ExamIdentity, assessmentId: string, deletedAt: Date): Promise<boolean> {
    const [deleted] = await this.db.update(classExams).set({ deletedAt, updatedAt: deletedAt }).where(and(
      eq(classExams.id, assessmentId),
      eq(classExams.schoolId, identity.schoolId),
      eq(classExams.teacherId, identity.userId),
      isNull(classExams.deletedAt),
      this.teacherAssignmentForAssessment(identity),
    )).returning({ id: classExams.id });
    return deleted !== undefined;
  }

  public async canManageAssessment(identity: ExamIdentity, assessmentId: string): Promise<boolean> {
    return (await this.findManagedAssessment(identity, assessmentId)) !== undefined;
  }

  public async listSubmissionRoster(
    identity: ExamIdentity,
    assessmentId: string,
  ): Promise<ExamSubmissionRoster | undefined> {
    const rows = await this.db.execute(sql`
      with allowed as (
        select assessment.id as assessment_id, assessment.class_id
        from public.class_exams assessment
        join public.exam_groups exam_group
          on exam_group.id = assessment.exam_group_id
          and exam_group.school_id = assessment.school_id
          and exam_group.deleted_at is null
        where assessment.id = ${assessmentId}::uuid
          and assessment.school_id = ${identity.schoolId}::uuid
          and assessment.teacher_id = ${identity.userId}::uuid
          and assessment.deleted_at is null
          and exists (
            select 1 from public.class_subjects subject
            where subject.school_id = assessment.school_id
              and subject.class_id = assessment.class_id
              and subject.subject_id = assessment.subject_id
              and subject.teacher_id = ${identity.userId}::uuid
          )
      )
      select
        allowed.assessment_id as "assessmentId",
        member.student_id as "studentId",
        profile.display_name as "studentName",
        member.roll_number as "rollNumber",
        submission.id as "submissionId",
        submission.submitted_at as "submittedAt",
        result.id as "resultId",
        result.marks,
        result.feedback,
        result.published_at as "publishedAt",
        result.updated_at as "resultUpdatedAt"
      from allowed
      left join public.class_members member
        on member.school_id = ${identity.schoolId}::uuid
        and member.class_id = allowed.class_id
        and member.is_active
      left join public.user_profiles profile on profile.id = member.student_id
      left join public.exam_submissions submission
        on submission.school_id = ${identity.schoolId}::uuid
        and submission.assessment_id = allowed.assessment_id
        and submission.student_id = member.student_id
      left join public.exam_results result
        on result.school_id = ${identity.schoolId}::uuid
        and result.assessment_id = allowed.assessment_id
        and result.student_id = member.student_id
      order by member.roll_number nulls last, profile.display_name, member.student_id
    `) as unknown as ReadonlyArray<{
      assessmentId: string;
      feedback: string | null;
      marks: number | null;
      publishedAt: Date | null;
      resultId: string | null;
      resultUpdatedAt: Date | null;
      rollNumber: string | null;
      studentId: string | null;
      studentName: string | null;
      submissionId: string | null;
      submittedAt: Date | null;
    }>;
    if (rows.length === 0) return undefined;
    const items = rows.flatMap((row): ReadonlyArray<ExamSubmissionRosterEntry> => {
      if (row.studentId === null || row.studentName === null) return [];
      const submission = row.submissionId === null || row.submittedAt === null
        ? undefined
        : {
            id: row.submissionId,
            studentId: row.studentId,
            submittedAt: row.submittedAt.toISOString(),
          };
      const result = row.resultId === null || row.marks === null || row.resultUpdatedAt === null
        ? undefined
        : {
            ...(row.feedback === null ? {} : { feedback: row.feedback }),
            id: row.resultId,
            marks: Number(row.marks),
            ...(row.publishedAt === null ? {} : { publishedAt: row.publishedAt.toISOString() }),
            studentId: row.studentId,
            updatedAt: row.resultUpdatedAt.toISOString(),
          };
      return [{
        ...(result === undefined ? {} : { result }),
        rollNumber: Number(row.rollNumber ?? 0),
        studentId: row.studentId,
        studentName: row.studentName,
        ...(submission === undefined ? {} : { submission }),
      }];
    });
    return {
      items,
      submissionCount: items.filter((item) => item.submission !== undefined).length,
      totalStudents: items.length,
    };
  }

  public async recordSubmission(
    identity: ExamIdentity,
    assessmentId: string,
    studentId: string,
    submittedAt: Date,
  ): Promise<ExamSubmission | undefined> {
    const rows = await this.db.execute(sql`
      with allowed as (
        select assessment.id as assessment_id
        from public.class_exams assessment
        join public.exam_groups exam_group
          on exam_group.id = assessment.exam_group_id
          and exam_group.school_id = assessment.school_id
          and exam_group.deleted_at is null
        join public.class_members member
          on member.school_id = assessment.school_id
          and member.class_id = assessment.class_id
          and member.student_id = ${studentId}::uuid
          and member.is_active
        where assessment.id = ${assessmentId}::uuid
          and assessment.school_id = ${identity.schoolId}::uuid
          and assessment.teacher_id = ${identity.userId}::uuid
          and assessment.deleted_at is null
          and assessment.is_published
          and exists (
            select 1 from public.class_subjects subject
            where subject.school_id = assessment.school_id
              and subject.class_id = assessment.class_id
              and subject.subject_id = assessment.subject_id
              and subject.teacher_id = ${identity.userId}::uuid
          )
      ), inserted as (
        insert into public.exam_submissions (
          school_id, assessment_id, student_id, recorded_by_teacher_id, submitted_at
        )
        select
          ${identity.schoolId}::uuid,
          allowed.assessment_id,
          ${studentId}::uuid,
          ${identity.userId}::uuid,
          ${submittedAt}
        from allowed
        on conflict (assessment_id, student_id) do nothing
        returning id, student_id as "studentId", submitted_at as "submittedAt"
      )
      select * from inserted
      union all
      select existing.id, existing.student_id as "studentId", existing.submitted_at as "submittedAt"
      from public.exam_submissions existing
      join allowed on allowed.assessment_id = existing.assessment_id
      where existing.school_id = ${identity.schoolId}::uuid
        and existing.student_id = ${studentId}::uuid
        and not exists (select 1 from inserted)
      limit 1
    `) as unknown as ReadonlyArray<{ id: string; studentId: string; submittedAt: Date }>;
    const submission = rows[0];
    return submission === undefined ? undefined : {
      id: submission.id,
      studentId: submission.studentId,
      submittedAt: submission.submittedAt.toISOString(),
    };
  }

  public async studentCanBeReminded(
    identity: ExamIdentity,
    assessmentId: string,
    studentId: string,
  ): Promise<boolean> {
    const rows = await this.db.execute(sql`
      select member.student_id
      from public.class_exams assessment
      join public.class_members member
        on member.school_id = assessment.school_id
        and member.class_id = assessment.class_id
        and member.student_id = ${studentId}::uuid
        and member.is_active
      where assessment.id = ${assessmentId}::uuid
        and assessment.school_id = ${identity.schoolId}::uuid
        and assessment.teacher_id = ${identity.userId}::uuid
        and assessment.deleted_at is null
        and assessment.is_published
        and exists (
          select 1 from public.exam_groups exam_group
          where exam_group.id = assessment.exam_group_id
            and exam_group.school_id = assessment.school_id
            and exam_group.deleted_at is null
        )
        and exists (
          select 1 from public.class_subjects subject
          where subject.school_id = assessment.school_id
            and subject.class_id = assessment.class_id
            and subject.subject_id = assessment.subject_id
            and subject.teacher_id = ${identity.userId}::uuid
        )
        and not exists (
          select 1 from public.exam_submissions submission
          where submission.school_id = assessment.school_id
            and submission.assessment_id = assessment.id
            and submission.student_id = member.student_id
        )
      limit 1
    `) as unknown as ReadonlyArray<{ student_id: string }>;
    return rows[0] !== undefined;
  }

  public async listReminderStudents(
    identity: ExamIdentity,
    assessmentId: string,
  ): Promise<ReadonlyArray<string> | undefined> {
    const rows = await this.db.execute(sql`
      select member.student_id
      from public.class_exams assessment
      left join public.class_members member
        on member.school_id = assessment.school_id
        and member.class_id = assessment.class_id
        and member.is_active
        and not exists (
          select 1 from public.exam_submissions submission
          where submission.school_id = assessment.school_id
            and submission.assessment_id = assessment.id
            and submission.student_id = member.student_id
        )
      where assessment.id = ${assessmentId}::uuid
        and assessment.school_id = ${identity.schoolId}::uuid
        and assessment.teacher_id = ${identity.userId}::uuid
        and assessment.deleted_at is null
        and assessment.is_published
        and exists (
          select 1 from public.exam_groups exam_group
          where exam_group.id = assessment.exam_group_id
            and exam_group.school_id = assessment.school_id
            and exam_group.deleted_at is null
        )
        and exists (
          select 1 from public.class_subjects subject
          where subject.school_id = assessment.school_id
            and subject.class_id = assessment.class_id
            and subject.subject_id = assessment.subject_id
            and subject.teacher_id = ${identity.userId}::uuid
        )
      order by member.student_id
    `) as unknown as ReadonlyArray<{ student_id: string | null }>;
    return rows.length === 0
      ? undefined
      : rows.flatMap((row) => row.student_id === null ? [] : [row.student_id]);
  }

  public async findAssessmentForResultEntry(
    identity: ExamIdentity,
    assessmentId: string,
  ): Promise<ManageableAssessment | undefined> {
    const [assessment] = await this.db.select({
      classId: classExams.classId,
      groupId: classExams.examGroupId,
      maxMarks: classExams.maxMarks,
    }).from(classExams).where(and(
      eq(classExams.id, assessmentId),
      eq(classExams.schoolId, identity.schoolId),
      eq(classExams.teacherId, identity.userId),
      isNull(classExams.deletedAt),
      this.teacherAssignmentForAssessment(identity),
      this.activeGroupForAssessment(identity),
    )).limit(1);
    if (assessment === undefined || assessment.groupId === null || assessment.maxMarks === null) {
      return undefined;
    }
    return { classId: assessment.classId, groupId: assessment.groupId, maxMarks: assessment.maxMarks };
  }

  public async listResults(
    identity: ExamIdentity,
    assessmentId: string,
    query: ExamResultListQuery,
  ): Promise<CursorPage<ExamResult> | undefined> {
    const cursor = query.cursor;
    const rows = await this.db.select({
      feedback: examResults.feedback,
      id: examResults.id,
      marks: examResults.marks,
      publishedAt: examResults.publishedAt,
      studentId: examResults.studentId,
      updatedAt: examResults.updatedAt,
    }).from(examResults).innerJoin(classExams, eq(classExams.id, examResults.assessmentId)).where(and(
      eq(examResults.schoolId, identity.schoolId),
      eq(examResults.assessmentId, assessmentId),
      eq(classExams.schoolId, identity.schoolId),
      eq(classExams.teacherId, identity.userId),
      isNull(classExams.deletedAt),
      this.teacherAssignmentForAssessment(identity),
      this.activeGroupForAssessment(identity),
      cursor === undefined ? undefined : or(
        lt(examResults.updatedAt, new Date(cursor.updatedAt)),
        and(eq(examResults.updatedAt, new Date(cursor.updatedAt)), lt(examResults.id, cursor.id)),
      ),
    )).orderBy(desc(examResults.updatedAt), desc(examResults.id)).limit(query.limit + 1);
    const items = rows.slice(0, query.limit).map(toResult);
    const last = items.at(-1);
    return {
      items,
      ...(rows.length > query.limit && last !== undefined ? {
        nextCursor: encodeResultCursor({ id: last.id, updatedAt: last.updatedAt }),
      } : {}),
    };
  }

  public async upsertResult(
    identity: ExamIdentity,
    assessmentId: string,
    studentId: string,
    input: UpsertExamResultInput,
    updatedAt: Date,
  ): Promise<ExamResult | undefined> {
    const rows = await this.db.execute(sql`
      with allowed as (
        select ce.id as assessment_id
        from public.class_exams ce
        join public.exam_groups eg
          on eg.id = ce.exam_group_id
          and eg.school_id = ce.school_id
          and eg.deleted_at is null
        where ce.id = ${assessmentId}::uuid
          and ce.school_id = ${identity.schoolId}::uuid
          and ce.teacher_id = ${identity.userId}::uuid
          and ce.deleted_at is null
          and ce.max_marks >= ${input.marks}
          and exists (
            select 1 from public.class_subjects cs
            where cs.school_id = ${identity.schoolId}::uuid
              and cs.class_id = ce.class_id
              and cs.subject_id = ce.subject_id
              and cs.teacher_id = ${identity.userId}::uuid
          )
          and exists (
            select 1 from public.class_members cm
            where cm.school_id = ${identity.schoolId}::uuid
              and cm.class_id = ce.class_id
              and cm.student_id = ${studentId}::uuid
              and cm.is_active
          )
      ), submission as (
        insert into public.exam_submissions (
          school_id, assessment_id, student_id, recorded_by_teacher_id, submitted_at
        )
        select
          ${identity.schoolId}::uuid,
          allowed.assessment_id,
          ${studentId}::uuid,
          ${identity.userId}::uuid,
          ${updatedAt}
        from allowed
        on conflict (assessment_id, student_id) do nothing
        returning id
      ), base_upsert as (
        insert into public.exam_results (
          school_id, assessment_id, student_id, entered_by_teacher_id, marks, feedback, updated_at
        )
        select
          ${identity.schoolId}::uuid,
          allowed.assessment_id,
          ${studentId}::uuid,
          ${identity.userId}::uuid,
          ${input.marks},
          ${input.feedback ?? null},
          ${updatedAt}
        from allowed
        on conflict (assessment_id, student_id) do update
          set entered_by_teacher_id = excluded.entered_by_teacher_id,
              marks = excluded.marks,
              feedback = excluded.feedback,
              updated_at = excluded.updated_at
          where public.exam_results.published_at is null
        returning
          id,
          student_id as "studentId",
          marks,
          feedback,
          published_at as "publishedAt",
          updated_at as "updatedAt"
      ), revision as (
        insert into public.exam_result_revisions (
          result_id, school_id, assessment_id, student_id, entered_by_teacher_id, marks, feedback
        )
        select
          current_result.id,
          current_result.school_id,
          current_result.assessment_id,
          current_result.student_id,
          ${identity.userId}::uuid,
          ${input.marks},
          ${input.feedback ?? null}
        from public.exam_results current_result
        join allowed on allowed.assessment_id = current_result.assessment_id
        where current_result.student_id = ${studentId}::uuid
          and current_result.published_at is not null
          and not exists (select 1 from base_upsert)
        returning
          id,
          student_id as "studentId",
          marks,
          feedback,
          null::timestamptz as "publishedAt",
          created_at as "updatedAt"
      )
      select * from base_upsert
      union all
      select * from revision
    `) as unknown as ReadonlyArray<ResultRow>;
    const result = rows[0];
    return result === undefined ? undefined : toResult(result);
  }

  public async listPublishedAwardRecipients(identity: ExamIdentity, assessmentId: string): Promise<ReadonlyArray<{ id: string; publishedAt: Date; studentId: string }>> {
    return this.db.execute(sql`
      select result.id, result.published_at as "publishedAt", result.student_id as "studentId"
      from public.exam_results result
      join public.class_exams assessment on assessment.id = result.assessment_id and assessment.school_id = result.school_id
      join public.exam_groups group_record on group_record.id = assessment.exam_group_id and group_record.school_id = assessment.school_id and group_record.deleted_at is null
      where result.assessment_id = ${assessmentId}::uuid
        and result.school_id = ${identity.schoolId}::uuid
        and result.published_at is not null
        and assessment.teacher_id = ${identity.userId}::uuid
        and assessment.deleted_at is null
        and exists (
          select 1 from public.class_subjects subject
          where subject.school_id = assessment.school_id
            and subject.class_id = assessment.class_id
            and subject.subject_id = assessment.subject_id
            and subject.teacher_id = ${identity.userId}::uuid
        )
      order by result.id
    `) as unknown as ReadonlyArray<{ id: string; publishedAt: Date; studentId: string }>
  }

  public async publishAssessment(

    identity: ExamIdentity,
    assessmentId: string,
    publishedAt: Date,
  ): Promise<StoredExamAssessment | undefined> {
    const [published] = await this.db.update(classExams).set({
      isPublished: true,
      publishedAt,
      updatedAt: publishedAt,
    }).where(and(
      eq(classExams.id, assessmentId),
      eq(classExams.schoolId, identity.schoolId),
      eq(classExams.teacherId, identity.userId),
      eq(classExams.isPublished, false),
      isNull(classExams.deletedAt),
      this.teacherAssignmentForAssessment(identity),
    )).returning({ id: classExams.id });
    return published === undefined ? undefined : this.findManagedAssessment(identity, published.id);
  }

  public async publishResults(
    identity: ExamIdentity,
    assessmentId: string,
    publishedAt: Date,
  ): Promise<boolean> {
    const rows = await this.db.execute(sql`
      with allowed as (
        select ce.id as assessment_id
        from public.class_exams ce
        join public.exam_groups eg
          on eg.id = ce.exam_group_id
          and eg.school_id = ce.school_id
          and eg.deleted_at is null
        where ce.id = ${assessmentId}::uuid
          and ce.school_id = ${identity.schoolId}::uuid
          and ce.teacher_id = ${identity.userId}::uuid
          and ce.deleted_at is null
          and exists (
            select 1 from public.class_subjects cs
            where cs.school_id = ${identity.schoolId}::uuid
              and cs.class_id = ce.class_id
              and cs.subject_id = ce.subject_id
              and cs.teacher_id = ${identity.userId}::uuid
          )
      ), published_results as (
        update public.exam_results result
        set published_at = ${publishedAt}, updated_at = ${publishedAt}
        from allowed
        where result.school_id = ${identity.schoolId}::uuid
          and result.assessment_id = allowed.assessment_id
          and result.published_at is null
        returning result.id
      ), published_revisions as (
        update public.exam_result_revisions revision
        set published_at = ${publishedAt}
        from allowed
        where revision.school_id = ${identity.schoolId}::uuid
          and revision.assessment_id = allowed.assessment_id
          and revision.published_at is null
        returning revision.id
      )
      select exists (select 1 from allowed) as allowed
    `) as unknown as ReadonlyArray<{ allowed: boolean }>;
    return rows[0]?.allowed === true;
  }

  public async findResourceForUpload(input: {
    assessmentId: string;
    identity: ExamIdentity;
    uploadSessionId: string;
  }): Promise<StoredExamResource | undefined> {
    const rows = await this.db.execute(sql<StoredExamResource>`
      select resource.id, resource.display_name as name, resource.object_path as "objectPath"
      from public.exam_resources resource
      join public.class_exams assessment
        on assessment.id = resource.assessment_id
        and assessment.school_id = resource.school_id
      join public.class_subjects subject
        on subject.school_id = assessment.school_id
        and subject.class_id = assessment.class_id
        and subject.subject_id = assessment.subject_id
        and subject.teacher_id = ${input.identity.userId}::uuid
      where resource.school_id = ${input.identity.schoolId}::uuid
        and resource.assessment_id = ${input.assessmentId}::uuid
        and resource.upload_session_id = ${input.uploadSessionId}::uuid
        and assessment.teacher_id = ${input.identity.userId}::uuid
        and assessment.deleted_at is null
      limit 1
    `) as unknown as ReadonlyArray<StoredExamResource>;
    return rows[0];
  }

  public async insertResource(input: {
    assessmentId: string;
    displayName: string;
    identity: ExamIdentity;
    objectPath: string;
    schoolId: string;
    uploadSessionId: string;
  }): Promise<StoredExamResource | undefined> {
    const rows = await this.db.execute(sql`
      with allowed as (
        select ce.id as assessment_id
        from public.class_exams ce
        where ce.id = ${input.assessmentId}::uuid
          and ce.school_id = ${input.schoolId}::uuid
          and ce.teacher_id = ${input.identity.userId}::uuid
          and ce.deleted_at is null
          and exists (
            select 1 from public.class_subjects cs
            where cs.school_id = ${input.schoolId}::uuid
              and cs.class_id = ce.class_id
              and cs.subject_id = ce.subject_id
              and cs.teacher_id = ${input.identity.userId}::uuid
          )
      ), inserted as (
        insert into public.exam_resources (
          school_id, assessment_id, upload_session_id, object_path, display_name
        )
        select
          ${input.schoolId}::uuid,
          allowed.assessment_id,
          ${input.uploadSessionId}::uuid,
          ${input.objectPath},
          ${input.displayName}
        from allowed
        on conflict (upload_session_id) do nothing
        returning id, display_name as name, object_path as "objectPath"
      )
      select * from inserted
      union all
      select resource.id, resource.display_name as name, resource.object_path as "objectPath"
      from public.exam_resources resource
      join allowed on allowed.assessment_id = resource.assessment_id
      where resource.school_id = ${input.schoolId}::uuid
        and resource.upload_session_id = ${input.uploadSessionId}::uuid
        and not exists (select 1 from inserted)
      limit 1
    `) as unknown as ReadonlyArray<StoredExamResource>;
    return rows[0];
  }

  public async getLeaderboard(
    identity: ExamIdentity,
    groupId: string,
    query: LeaderboardQuery,
  ): Promise<CursorPage<LeaderboardEntry> | undefined> {
    const cursor = query.cursor;
    const cursorClause = cursor === undefined ? sql`` : sql`
      where (marks < ${cursor.marks})
        or (marks = ${cursor.marks} and (name > ${cursor.name}
          or (name = ${cursor.name} and student_id > ${cursor.studentId})))
    `;
    const result = await this.db.execute(sql`
      with requester_membership as (
        select eg.id, eg.class_id
        from public.exam_groups eg
        join public.class_members cm on cm.school_id = eg.school_id
          and cm.class_id = eg.class_id
          and cm.student_id = ${identity.userId}::uuid
          and cm.is_active
        where eg.id = ${groupId}::uuid
          and eg.school_id = ${identity.schoolId}::uuid
          and eg.deleted_at is null
          and exists (
            select 1 from public.class_exams published_assessment
            where published_assessment.exam_group_id = eg.id
              and published_assessment.is_published
              and published_assessment.deleted_at is null
          )
      ), group_members as (
        select cm.student_id, cm.roll_number, up.display_name
        from requester_membership requester
        join public.class_members cm on cm.class_id = requester.class_id
          and cm.school_id = ${identity.schoolId}::uuid
          and cm.is_active
        join public.user_profiles up on up.id = cm.student_id
      ), scores as (
        select er.student_id, sum(coalesce(revision.marks, er.marks))::double precision as marks
        from public.exam_results er
        join public.class_exams ce on ce.id = er.assessment_id
        left join lateral (
          select revision.marks
          from public.exam_result_revisions revision
          where revision.result_id = er.id and revision.published_at is not null
          order by revision.published_at desc, revision.created_at desc, revision.id desc
          limit 1
        ) revision on true
        where er.school_id = ${identity.schoolId}::uuid
          and ce.exam_group_id = ${groupId}::uuid
          and ce.is_published and ce.deleted_at is null
          and er.published_at is not null
        group by er.student_id
      ), ranked as (
        select gm.student_id, gm.roll_number, gm.display_name as name,
          coalesce(scores.marks, 0)::double precision as marks,
          dense_rank() over (
            order by coalesce(scores.marks, 0) desc, gm.display_name asc, gm.student_id asc
          )::int as rank
        from group_members gm
        left join scores on scores.student_id = gm.student_id
      )
      select rank, name, roll_number, marks, student_id
      from ranked
      ${cursorClause}
      order by marks desc, name asc, student_id asc
      limit ${query.limit + 1}
    `);
    const rows = result as unknown as ReadonlyArray<{
      marks: number | string;
      name: string;
      rank: number | string;
      roll_number: string | null;
      student_id: string;
    }>;
    if (rows.length === 0) return undefined;
    const pageRows = rows.slice(0, query.limit);
    const items = pageRows.map((row) => ({
      isCurrentUser: row.student_id === identity.userId,
      marks: Number(row.marks),
      name: row.name,
      points: 0 as const,
      rank: Number(row.rank),
      ...(row.roll_number === null ? {} : { rollNo: row.roll_number }),
      streakCount: 0 as const,
      studentId: row.student_id,
    }));
    const last = items.at(-1);
    return {
      items,
      ...(rows.length > query.limit && last !== undefined ? {
        nextCursor: encodeLeaderboardCursor({
          marks: last.marks,
          name: last.name,
          studentId: last.studentId,
        }),
      } : {}),
    };
  }

  private async listPublishedAssessments
(identity: ExamIdentity, groupId: string): Promise<ReadonlyArray<ExamAssessment>> {
    const rows = await this.db.select({
      endsAt: classExams.endsAt,
      examGroupId: classExams.examGroupId,
      id: classExams.id,
      maxMarks: classExams.maxMarks,
      scheduledOn: classExams.scheduledOn,
      startsAt: classExams.startsAt,
      subjectId: classExams.subjectId,
      syllabus: classExams.syllabus,
      title: classExams.title,
    }).from(classExams).where(and(
      eq(classExams.schoolId, identity.schoolId),
      eq(classExams.examGroupId, groupId),
      eq(classExams.isPublished, true),
      isNull(classExams.deletedAt),
      this.studentAudienceForAssessment(identity),
    )).orderBy(desc(classExams.scheduledOn), desc(classExams.id));
    return rows.flatMap((row) => {
      const assessment = toAssessment(row);
      return assessment === undefined ? [] : [assessment];
    });
  }

  private async withDetails(row: AssessmentRow, studentId?: string): Promise<StoredExamAssessment | undefined> {
    const assessment = toAssessment(row);
    if (assessment === undefined || row.classId === undefined || row.examGroupId === null) return undefined;
    const [rubrics, resources, result] = await Promise.all([
      this.db.select({
        description: examRubrics.description,
        marks: examRubrics.marks,
        position: examRubrics.position,
        sectionTitle: examRubrics.sectionTitle,
      }).from(examRubrics).where(eq(examRubrics.assessmentId, assessment.id)).orderBy(examRubrics.position),
      this.db.select({
        id: examResources.id,
        name: examResources.displayName,
        objectPath: examResources.objectPath,
      }).from(examResources).where(eq(examResources.assessmentId, assessment.id)).orderBy(desc(examResources.createdAt), desc(examResources.id)),
      studentId === undefined ? Promise.resolve([]) : this.findPublishedResult(assessment.id, studentId),
    ]);
    return {
      ...assessment,
      classId: row.classId,
      groupId: row.examGroupId,
      resources,
      ...(result[0] === undefined ? {} : { result: toResult(result[0]) }),
      rubrics: rubrics satisfies ReadonlyArray<ExamRubric>,
    };
  }

  private async findPublishedResult(assessmentId: string, studentId: string): Promise<ReadonlyArray<ResultRow>> {
    const [base] = await this.db.select({
      feedback: examResults.feedback,
      id: examResults.id,
      marks: examResults.marks,
      publishedAt: examResults.publishedAt,
      studentId: examResults.studentId,
      updatedAt: examResults.updatedAt,
    }).from(examResults).where(and(
      eq(examResults.assessmentId, assessmentId),
      eq(examResults.studentId, studentId),
      isNotNull(examResults.publishedAt),
    )).limit(1);
    if (base === undefined) return [];
    const [revision] = await this.db.select({
      feedback: examResultRevisions.feedback,
      id: examResultRevisions.id,
      marks: examResultRevisions.marks,
      publishedAt: examResultRevisions.publishedAt,
      studentId: examResultRevisions.studentId,
      updatedAt: examResultRevisions.createdAt,
    }).from(examResultRevisions).where(and(
      eq(examResultRevisions.resultId, base.id),
      isNotNull(examResultRevisions.publishedAt),
    )).orderBy(
      desc(examResultRevisions.publishedAt),
      desc(examResultRevisions.createdAt),
      desc(examResultRevisions.id),
    ).limit(1);
    return revision === undefined ? [base] : [revision];
  }

  private async findManagedAssessment(identity: ExamIdentity, assessmentId: string): Promise<StoredExamAssessment | undefined> {
    const [assessment] = await this.db.select({
      classId: classExams.classId,
      endsAt: classExams.endsAt,
      examGroupId: classExams.examGroupId,
      id: classExams.id,
      maxMarks: classExams.maxMarks,
      scheduledOn: classExams.scheduledOn,
      startsAt: classExams.startsAt,
      subjectId: classExams.subjectId,
      syllabus: classExams.syllabus,
      title: classExams.title,
    }).from(classExams).where(and(
      eq(classExams.id, assessmentId),
      eq(classExams.schoolId, identity.schoolId),
      eq(classExams.teacherId, identity.userId),
      isNull(classExams.deletedAt),
      this.teacherAssignmentForAssessment(identity),
      this.activeGroupForAssessment(identity),
    )).limit(1);
    return assessment === undefined ? undefined : this.withDetails(assessment);
  }

  private async findAssignableGroup(
    identity: ExamIdentity,
    groupId: string,
    subjectId: string,
    scheduledOn: string,
  ): Promise<{ classId: string } | undefined> {
    const [group] = await this.db.select({ classId: examGroups.classId }).from(examGroups).where(and(
      eq(examGroups.id, groupId),
      eq(examGroups.schoolId, identity.schoolId),
      isNull(examGroups.deletedAt),
      sql`${examGroups.startsOn} <= ${scheduledOn}`,
      sql`${examGroups.endsOn} >= ${scheduledOn}`,
    )).limit(1);
    if (group === undefined || !await this.isTeacherAssigned(identity, group.classId, subjectId)) return undefined;
    return group;
  }

  private async findGroupRange(schoolId: string, groupId: string): Promise<{ endsOn: string; startsOn: string } | undefined> {
    const [group] = await this.db.select({ endsOn: examGroups.endsOn, startsOn: examGroups.startsOn })
      .from(examGroups)
      .where(and(eq(examGroups.id, groupId), eq(examGroups.schoolId, schoolId), isNull(examGroups.deletedAt)))
      .limit(1);
    return group;
  }

  private studentAudienceForGroup(identity: ExamIdentity) {
    return exists(this.db.select({ id: classMembers.id }).from(classMembers).where(and(
      eq(classMembers.schoolId, identity.schoolId),
      eq(classMembers.classId, examGroups.classId),
      eq(classMembers.studentId, identity.userId),
      eq(classMembers.isActive, true),
    )));
  }

  private studentAudienceForAssessment(identity: ExamIdentity) {
    return exists(this.db.select({ id: classMembers.id }).from(classMembers).where(and(
      eq(classMembers.schoolId, identity.schoolId),
      eq(classMembers.classId, classExams.classId),
      eq(classMembers.studentId, identity.userId),
      eq(classMembers.isActive, true),
    )));
  }

  private activeGroupForAssessment(identity: ExamIdentity) {
    return exists(this.db.select({ id: examGroups.id }).from(examGroups).where(and(
      eq(examGroups.id, classExams.examGroupId),
      eq(examGroups.schoolId, identity.schoolId),
      isNull(examGroups.deletedAt),
    )));
  }

  private groupHasPublishedAssessment() {
    return exists(this.db.select({ id: classExams.id }).from(classExams).where(and(
      eq(classExams.examGroupId, examGroups.id),
      eq(classExams.isPublished, true),
      isNull(classExams.deletedAt),
    )));
  }

  private teacherAssignmentForAssessment(identity: ExamIdentity) {
    return exists(this.db.select({ id: classSubjects.id }).from(classSubjects).where(and(
      eq(classSubjects.schoolId, identity.schoolId),
      eq(classSubjects.classId, classExams.classId),
      eq(classSubjects.subjectId, classExams.subjectId),
      eq(classSubjects.teacherId, identity.userId),
    )));
  }

  private teacherAssignmentForGroup(identity: ExamIdentity) {
    return exists(this.db.select({ id: classSubjects.id }).from(classSubjects).where(and(
      eq(classSubjects.schoolId, identity.schoolId),
      eq(classSubjects.classId, examGroups.classId),
      eq(classSubjects.teacherId, identity.userId),
    )));
  }

  private async isTeacherAssignedToClass(identity: ExamIdentity, classId: string): Promise<boolean> {
    const [assignment] = await this.db.select({ id: classSubjects.id }).from(classSubjects).where(and(
      eq(classSubjects.schoolId, identity.schoolId),
      eq(classSubjects.classId, classId),
      eq(classSubjects.teacherId, identity.userId),
    )).limit(1);
    return assignment !== undefined;
  }

  private async isTeacherAssigned(identity: ExamIdentity, classId: string, subjectId: string): Promise<boolean> {
    const [assignment] = await this.db.select({ id: classSubjects.id }).from(classSubjects).where(and(
      eq(classSubjects.schoolId, identity.schoolId),
      eq(classSubjects.classId, classId),
      eq(classSubjects.subjectId, subjectId),
      eq(classSubjects.teacherId, identity.userId),
    )).limit(1);
    return assignment !== undefined;
  }

  private async studentCanAccessGroup(identity: ExamIdentity, groupId: string): Promise<boolean> {
    const [group] = await this.db.select({ id: examGroups.id }).from(examGroups).where(and(
      eq(examGroups.id, groupId),
      eq(examGroups.schoolId, identity.schoolId),
      isNull(examGroups.deletedAt),
      this.studentAudienceForGroup(identity),
      this.groupHasPublishedAssessment(),
    )).limit(1);
    return group !== undefined;
  }
}
