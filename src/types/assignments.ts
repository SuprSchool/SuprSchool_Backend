import { z } from 'zod';

export const assignmentGradingTypeValues = ['Numeric', 'Alphabetic'] as const;
export const studentAssignmentStatusValues = ['active', 'submitted', 'graded'] as const;
export const teacherAssignmentStatusValues = ['active', 'graded'] as const;

export type AssignmentGradingType = (typeof assignmentGradingTypeValues)[number];
export type StudentAssignmentStatus = (typeof studentAssignmentStatusValues)[number];
export type TeacherAssignmentStatus = (typeof teacherAssignmentStatusValues)[number];

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
}

export interface StudentAssignmentItem {
  /** See `AssignmentDetail.assignedAt` — the stored creation instant, not the due date. */
  assignedAt: string;
  dueAt: string;
  gradedAt?: string | undefined;
  gradingType: AssignmentGradingType;
  id: string;
  isGradedAssignment: boolean;
  marks?: number | undefined;
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
  gradedAt?: string | undefined;
  id: string;
  marks?: number | undefined;
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
  rubrics: ReadonlyArray<AssignmentRubric>;
  subjectId: string;
  title: string;
}

export type UpdateAssignmentInput = CreateAssignmentInput;

export interface CreateSubmissionUploadInput {
  contentType: string;
  displayName: string;
  sizeBytes: number;
}

export type CreateAssignmentResourceUploadInput = CreateSubmissionUploadInput;

export interface SubmissionUploadSession {
  expiresAt: string;
  id: string;
  signedUploadUrl: string;
}

export interface GradeSubmissionInput {
  feedback?: string | undefined;
  marks: number;
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
