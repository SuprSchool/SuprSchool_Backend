import { z } from 'zod';

export const assignmentGradingTypeValues = ['Numeric', 'Alphabetic'] as const;
export const studentAssignmentStatusValues = ['active', 'submitted', 'graded'] as const;
export const teacherAssignmentStatusValues = ['active', 'graded'] as const;

/**
 * Where an attachment belongs on the detail screens. `banner` is the header
 * image — it is surfaced as `AssignmentDetail.bannerUrl` and is deliberately
 * *absent* from `AssignmentDetail.resources`, so a client that renders the
 * resources array as file tiles never draws the header twice.
 */
export const assignmentResourceRoleValues = ['banner', 'resource'] as const;

/**
 * The banner is a header image, so only the image members of the academic
 * content-type allowlist may claim the role. A PDF banner would render as a
 * broken header on every detail screen.
 */
export const assignmentBannerContentTypes = ['image/jpeg', 'image/png', 'image/webp'] as const;

/**
 * The letter scale for `gradingType: 'Alphabetic'`. Pinned here rather than
 * left free text so the teacher grading screen can render a fixed picker and
 * the database check constraint has something to agree with.
 */
export const assignmentLetterGradeValues = [
  'A+', 'A', 'B+', 'B', 'C+', 'C', 'D', 'E', 'F',
] as const;

/**
 * The reading student's own progress on one assignment, resolved per student
 * rather than per assignment:
 *   `completed` — the teacher marked *this* student complete, whatever the rest
 *                 of the class did;
 *   `submitted` — this student has a durable submission but no completion;
 *   `pending`   — neither.
 * Completion outranks submission because it is the teacher's explicit closing
 * of the row, and it is reachable without any upload at all.
 */
export const studentAssignmentProgressValues = ['pending', 'submitted', 'completed'] as const;

/** The population a bulk completion addresses. */
export const bulkCompletionScopeValues = ['submitted', 'all'] as const;

export type AssignmentGradingType = (typeof assignmentGradingTypeValues)[number];
export type StudentAssignmentStatus = (typeof studentAssignmentStatusValues)[number];
export type TeacherAssignmentStatus = (typeof teacherAssignmentStatusValues)[number];
export type AssignmentResourceRole = (typeof assignmentResourceRoleValues)[number];
export type AssignmentBannerContentType = (typeof assignmentBannerContentTypes)[number];
export type AssignmentLetterGrade = (typeof assignmentLetterGradeValues)[number];
export type StudentAssignmentProgress = (typeof studentAssignmentProgressValues)[number];
export type BulkCompletionScope = (typeof bulkCompletionScopeValues)[number];

export interface AssignmentIdentity {
  schoolId: string;
  userId: string;
}

export interface CursorPage<T> {
  items: ReadonlyArray<T>;
  nextCursor?: string | undefined;
}

export interface AssignmentDueCursor {
  dueAt: string;
  id: string;
}

export interface AssignmentCreatedCursor {
  createdAt: string;
  id: string;
}

export interface SubmissionCursor {
  id: string;
  submittedAt: string | null;
}

export interface AssignmentRubric {
  marks: number;
  moreInfo?: string | undefined;
  position: number;
  topic: string;
}

export interface AssignmentResource {
  id: string;
  name: string;
  signedUrl: string;
}

export interface AssignmentDetail {
  /**
   * The instant the assignment was created (`assignments.created_at`), to the
   * millisecond. Frames 253:9834 / 253:9952 pair the assigned date with a
   * relative age ("2m ago"), which a day-granularity display string cannot
   * produce — so the stored timestamp rides the read model beside the date.
   */
  assignedAt: string;
  /**
   * The banner as a full resource — the same `{ id, name, signedUrl }` shape
   * every other attachment has, so a client that already renders resources can
   * reuse its mapper, and so the banner can be addressed by id for deletion.
   * Emitted beside `bannerUrl`, not instead of it: clients read `bannerUrl`
   * first and fall back to this, and the two are always derived from the same
   * row, so they cannot disagree.
   */
  banner: AssignmentResource | null;
  /**
   * A resolvable read URL for the teacher-uploaded banner image, on BOTH the
   * teacher and the student detail. Required-but-nullable rather than optional:
   * "this assignment has no banner" is a state every caller must render, not a
   * field a payload may omit. The banner is excluded from `resources`, so a
   * client can render the array as file tiles without drawing the header twice.
   */
  bannerUrl: string | null;
  classId: string;
  /**
   * Human-readable code (ASG-<year>-<seq>), unique per school per year, printed
   * on the assignment-created success screen (833:9534). Null for assignments
   * written before the column existed — callers fall back to the id.
   */
  displayCode: string | null;
  dueAt: string;
  gradingType: AssignmentGradingType;
  id: string;
  instructions: string;
  isGradedAssignment: boolean;
  maxMarks?: number | undefined;
  resources: ReadonlyArray<AssignmentResource>;
  rubrics: ReadonlyArray<AssignmentRubric>;
  subjectId: string;
  title: string;
  /**
   * The reading student's own submission, mirroring `StudentAssignmentItem`.
   * Present only on the student detail — clients derive submitted/graded from
   * these, so a detail without them always reads as "Not Submitted", including
   * on the confirmation screen shown straight after a successful submit.
   */
  /** See `StudentAssignmentItem.completedAt` — the same field, student detail only. */
  completedAt?: string | undefined;
  gradedAt?: string | undefined;
  /** The letter awarded to the reading student on an alphabetic assignment. */
  letterGrade?: AssignmentLetterGrade | undefined;
  marks?: number | undefined;
  /**
   * The same per-student verdict the list carries, so the detail screen and the
   * card it was opened from cannot disagree. Student detail only — a teacher is
   * not "a student" on their own assignment, so the field is absent there.
   */
  studentStatus?: StudentAssignmentProgress | undefined;
  submittedAt?: string | undefined;
}

export interface StudentAssignmentItem {
  /** See `AssignmentDetail.assignedAt` — the stored creation instant, not the due date. */
  assignedAt: string;
  /**
   * When the teacher marked THIS student complete, if they did. Redundant
   * beside `studentStatus` and published anyway: it costs nothing (the column
   * is already in the query `studentStatus` is derived from) and it is what an
   * older client reads to reach the same conclusion.
   */
  completedAt?: string | undefined;
  dueAt: string;
  gradedAt?: string | undefined;
  gradingType: AssignmentGradingType;
  id: string;
  isGradedAssignment: boolean;
  /** The letter awarded to this student on an alphabetic assignment. */
  letterGrade?: AssignmentLetterGrade | undefined;
  marks?: number | undefined;
  /**
   * This student's own progress — see `studentAssignmentProgressValues`.
   * Required, not optional: every card renders a state, and an absent field
   * would be indistinguishable from "pending" while actually meaning "the
   * server did not say".
   */
  studentStatus: StudentAssignmentProgress;
  subjectId: string;
  subjectName: string;
  submittedAt?: string | undefined;
  title: string;
}

export interface TeacherAssignmentItem {
  createdAt: string;
  displayCode: string | null;
  dueAt: string;
  gradingType: AssignmentGradingType;
  id: string;
  isGradedAssignment: boolean;
  maxMarks?: number | undefined;
  subjectId: string;
  /**
   * Students who have durably submitted, aggregated over the assignment's own
   * class in the listing query rather than over the returned page. 596:16571
   * draws it as the numerator of the card's `submitted/total` and its progress
   * bar; Pending is the client's remainder. Both figures are restricted to
   * students still actively enrolled, so the remainder cannot go negative.
   */
  submissionCount: number;
  title: string;
  totalStudents: number;
}

export const submissionCompletionActions = ['complete', 'incomplete'] as const;

export type SubmissionCompletionAction = (typeof submissionCompletionActions)[number];

export interface AssignmentSubmission {
  // Required-but-nullable rather than optional: an uncompleted submission is a
  // known absence every caller must state, not a field it may omit. The client
  // renders it (668:4935 / 668:4886); no Figma frame specifies a completed-row
  // treatment yet, so how it is drawn is the client's problem, not this
  // contract's.
  completedAt: string | null;
  feedback?: string | undefined;
  /**
   * `assignment_submissions.display_name` — the file the student uploaded.
   * 526:12658 / 667:3274 / 667:3533 / 543:13354 all draw an `Assignment.pdf`
   * tile on every submitted row, and 408:10557 draws it again on the grading
   * screen; without this the tile could never render. Absent on a roster row
   * that has no upload.
   */
  fileName?: string | undefined;
  /**
   * A short-lived signed read URL for that file, so the teacher can actually
   * open what the student handed in. Absent when there is no upload. The bucket
   * is private, so the path alone is not openable.
   */
  fileUrl?: string | undefined;
  gradedAt?: string | undefined;
  /**
   * `assignments.grading_type`, denormalised onto every row beside `maxMarks`.
   * Without it the grading screen had no way to tell a numeric assignment from
   * an alphabetic one and drew every alphabetic assignment as numeric — and
   * since an alphabetic assignment has no `maxMarks`, as "0/0".
   */
  gradingType?: AssignmentGradingType | undefined;
  /**
   * The submission row id when the student has one, and the STUDENT id when the
   * roster read below produced a row for a student who never opened an upload
   * session. Callers that need to address a real submission (grading) must gate
   * on `submittedAt`; callers addressing the student (completion, reminders)
   * must use `studentId`, which is always the student.
   */
  id: string;
  /** `assignments.is_graded` — the assignment's own mode, denormalised so the
   * submissions screen can pick its second tab (Graded vs Completed) without a
   * second fetch. */
  isGradedAssignment?: boolean | undefined;
  /**
   * The letter this student was awarded. Present only on a graded submission of
   * an alphabetic assignment — the numeric counterpart of `marks`, and mutually
   * exclusive with it.
   */
  letterGrade?: AssignmentLetterGrade | undefined;
  /**
   * The letters the teacher may choose from, carried on every row of an
   * ALPHABETIC assignment for the same reason `maxMarks` is carried on a
   * numeric one: the grading control has to be populated without a second
   * fetch. Absent on a numeric assignment.
   */
  letterGradeOptions?: ReadonlyArray<AssignmentLetterGrade> | undefined;
  marks?: number | undefined;
  /**
   * `assignments.max_marks`, denormalised onto every row. 408:10557 draws
   * `0/35`, and with no total on the contract the client had nothing to divide
   * by and pinned it to 0, which disabled marks entry entirely. Absent on an
   * alphabetic assignment, which has no maximum — read `gradingType` first.
   */
  maxMarks?: number | undefined;
  studentId: string;
  /**
   * `user_profiles.display_name` of the submitting student, joined school-scoped
   * beside the submission in every read that produces this DTO. Required, not
   * optional: 668:4935 / 668:4886 name the student in the roster row, in the
   * search box and in the footer, and with only `studentId` on the contract all
   * three printed a raw UUID.
   */
  studentName: string;
  submittedAt?: string | undefined;
}

export interface SubmissionCompletion {
  completedAt: string | null;
  id: string;
}

/**
 * The outcome of a bulk mark-as-done. `completed` is the number of roster rows
 * the write actually landed on, so a client can report "12 students marked"
 * without re-reading the list.
 */
export interface BulkCompletionResult {
  completed: number;
  scope: BulkCompletionScope;
}

export interface StudentAssignmentListQuery {
  cursor?: AssignmentDueCursor | undefined;
  limit: number;
  status?: StudentAssignmentStatus | undefined;
  subjectId?: string | undefined;
}

export interface TeacherAssignmentListQuery {
  cursor?: AssignmentCreatedCursor | undefined;
  limit: number;
  status?: TeacherAssignmentStatus | undefined;
}

export interface SubmissionListQuery {
  cursor?: SubmissionCursor | undefined;
  limit: number;
}

export interface CreateAssignmentInput {
  dueAt: string;
  gradingType: AssignmentGradingType;
  instructions: string;
  isGradedAssignment: boolean;
  maxMarks?: number | undefined;
  /**
   * Absent means "no rubric breakdown". On an update that is deliberately
   * distinct from `[]`: absent leaves whatever breakdown is already stored
   * alone, `[]` clears it. A PATCH that simply omits the key must not silently
   * destroy rubrics the teacher never touched.
   */
  rubrics?: ReadonlyArray<AssignmentRubric> | undefined;
  subjectId: string;
  title: string;
}

export type UpdateAssignmentInput = CreateAssignmentInput;

export interface CreateSubmissionUploadInput {
  contentType: string;
  displayName: string;
  sizeBytes: number;
}

export interface CreateAssignmentResourceUploadInput extends CreateSubmissionUploadInput {
  /**
   * Which slot the attachment claims. Defaulted by the validator, so the
   * service always receives a concrete role and a client that never heard of
   * banners keeps producing ordinary resources.
   */
  role: AssignmentResourceRole;
}

/** The confirm half of the same upload — the role is restated so the durable
 * write knows the slot without the storage layer having to carry it. */
export interface ConfirmAssignmentResourceInput {
  role: AssignmentResourceRole;
  uploadSessionId: string;
}

export interface SubmissionUploadSession {
  expiresAt: string;
  id: string;
  signedUploadUrl: string;
}

/**
 * Exactly one of `marks` / `letterGrade`, matching the assignment's own
 * `gradingType` — enforced by the validator and again by the repository's
 * authorization predicate, so a numeric grade can never be written onto an
 * alphabetic assignment or the reverse.
 */
export interface GradeSubmissionInput {
  feedback?: string | undefined;
  letterGrade?: AssignmentLetterGrade | undefined;
  marks?: number | undefined;
}

const assignmentDueCursorSchema = z.object({
  dueAt: z.string().datetime({ offset: true }),
  id: z.uuid(),
  v: z.literal(1),
});

const assignmentCreatedCursorSchema = z.object({
  createdAt: z.string().datetime({ offset: true }),
  id: z.uuid(),
  v: z.literal(1),
});

const submissionCursorSchema = z.object({
  id: z.uuid(),
  submittedAt: z.string().datetime({ offset: true }).nullable(),
  v: z.literal(1),
});

function decodeCursor<T>(value: string, schema: z.ZodType<T>): T {
  try {
    return schema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  } catch {
    throw new Error('Invalid assignment cursor');
  }
}

function encodeCursor(value: object): string {
  return Buffer.from(JSON.stringify({ ...value, v: 1 }), 'utf8').toString('base64url');
}

export function decodeAssignmentDueCursor(value: string): AssignmentDueCursor {
  const parsed = decodeCursor(value, assignmentDueCursorSchema);
  return { dueAt: parsed.dueAt, id: parsed.id };
}

export function encodeAssignmentDueCursor(cursor: AssignmentDueCursor): string {
  return encodeCursor(cursor);
}

export function decodeAssignmentCreatedCursor(value: string): AssignmentCreatedCursor {
  const parsed = decodeCursor(value, assignmentCreatedCursorSchema);
  return { createdAt: parsed.createdAt, id: parsed.id };
}

export function encodeAssignmentCreatedCursor(cursor: AssignmentCreatedCursor): string {
  return encodeCursor(cursor);
}

export function decodeSubmissionCursor(value: string): SubmissionCursor {
  const parsed = decodeCursor(value, submissionCursorSchema);
  return { submittedAt: parsed.submittedAt, id: parsed.id };
}

export function encodeSubmissionCursor(cursor: SubmissionCursor): string {
  return encodeCursor(cursor);
}
