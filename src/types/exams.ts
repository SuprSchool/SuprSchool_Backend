import { z } from 'zod';

export const examGroupStateValues = ['draft', 'published', 'archived'] as const;

export type ExamGroupState = (typeof examGroupStateValues)[number];

export interface ExamIdentity {
  schoolId: string;
  userId: string;
}

export interface CursorPage<T> {
  items: ReadonlyArray<T>;
  nextCursor?: string | undefined;
}

export interface ExamGroupCursor {
  id: string;
  startsOn: string;
}

export interface AssessmentCursor {
  id: string;
  scheduledOn: string;
}

export interface ResultCursor {
  id: string;
  updatedAt: string;
}

export interface LeaderboardCursor {
  marks: number;
  name: string;
  studentId: string;
}

export interface ExamRubric {
  description: string;
  marks: number;
  position: number;
  sectionTitle: string;
}

export interface ExamResource {
  id: string;
  name: string;
  signedUrl: string;
}

export interface ExamResult {
  feedback?: string | undefined;
  id: string;
  marks: number;
  publishedAt?: string | undefined;
  studentId: string;
  updatedAt: string;
}

export interface ExamSubmission {
  id: string;
  studentId: string;
  submittedAt: string;
}

export interface ExamSubmissionRosterEntry {
  result?: ExamResult | undefined;
  rollNumber: number;
  studentId: string;
  studentName: string;
  submission?: ExamSubmission | undefined;
}

export interface ExamSubmissionRoster {
  items: ReadonlyArray<ExamSubmissionRosterEntry>;
  submissionCount: number;
  totalStudents: number;
}

export interface ExamAssessment {
  endsAt: string;
  id: string;
  maxMarks: number;
  scheduledOn: string;
  startsAt: string;
  subjectId: string;
  isPublished?: boolean | undefined;
  resultsPublished?: boolean | undefined;
  syllabus?: string | undefined;
  title: string;
}

/**
 * The teacher assessment list entry. 748:7871 / 748:8071 draw Students / Graded /
 * Pending per card; both figures are aggregated over the whole class in the
 * listing query, never over the returned page. Pending is `totalStudents -
 * submissionCount`, which cannot go negative because the graded count is
 * restricted to students still actively enrolled in the class.
 */
export interface TeacherExamAssessment extends ExamAssessment {
  submissionCount: number;
  totalStudents: number;
}

export interface ExamAssessmentDetail extends ExamAssessment {
  resources: ReadonlyArray<ExamResource>;
  result?: ExamResult | undefined;
  rubrics: ReadonlyArray<ExamRubric>;
}

export interface ExamGroup {
  classId: string;
  endsOn: string;
  id: string;
  startsOn: string;
  state: ExamGroupState;
  title: string;
}

export interface ExamGroupDetail extends ExamGroup {
  assessments: ReadonlyArray<ExamAssessment>;
}

export interface LeaderboardEntry {
  isCurrentUser: boolean;
  marks: number;
  name: string;
  points: 0;
  rank: number;
  rollNo?: string | undefined;
  streakCount: 0;
  studentId: string;
}

export interface CreateExamGroupInput {
  endsOn: string;
  startsOn: string;
  state?: ExamGroupState | undefined;
  title: string;
}

export type UpdateExamGroupInput = CreateExamGroupInput;

export interface CreateExamAssessmentInput {
  endsAt: string;
  maxMarks: number;
  rubrics: ReadonlyArray<ExamRubric>;
  scheduledOn: string;
  startsAt: string;
  subjectId: string;
  syllabus?: string | undefined;
  title: string;
}

export type UpdateExamAssessmentInput = CreateExamAssessmentInput;

export interface UpsertExamResultInput {
  feedback?: string | undefined;
  marks: number;
}

export interface ExamResourceUploadInput {
  contentType: string;
  displayName: string;
  sizeBytes: number;
}

export interface ExamUploadSession {
  expiresAt: string;
  id: string;
  signedUploadUrl: string;
}

export interface ExamGroupListQuery {
  cursor?: ExamGroupCursor | undefined;
  limit: number;
}

export interface ExamAssessmentListQuery {
  cursor?: AssessmentCursor | undefined;
  limit: number;
}

export interface ExamResultListQuery {
  cursor?: ResultCursor | undefined;
  limit: number;
}

export interface LeaderboardQuery {
  cursor?: LeaderboardCursor | undefined;
  limit: number;
  /**
   * Narrows the board to one subject of the group (`253:7515`'s subject tabs).
   * Absent means the Overall tab: every published assessment in the group.
   * Assessments carry a non-null `subject_id`, so this filters real rows.
   */
  subjectId?: string | undefined;
}

const examGroupCursorSchema = z.object({
  id: z.uuid(),
  startsOn: z.string().date(),
  v: z.literal(1),
});

const assessmentCursorSchema = z.object({
  id: z.uuid(),
  scheduledOn: z.string().date(),
  v: z.literal(1),
});

const resultCursorSchema = z.object({
  id: z.uuid(),
  updatedAt: z.string().datetime({ offset: true }),
  v: z.literal(1),
});

const leaderboardCursorSchema = z.object({
  marks: z.number().finite(),
  name: z.string(),
  studentId: z.uuid(),
  v: z.literal(1),
});

function decodeCursor<T>(value: string, schema: z.ZodType<T>): T {
  try {
    return schema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  } catch {
    throw new Error('Invalid exam cursor');
  }
}

function encodeCursor(value: object): string {
  return Buffer.from(JSON.stringify({ ...value, v: 1 }), 'utf8').toString('base64url');
}

export function decodeExamGroupCursor(value: string): ExamGroupCursor {
  const parsed = decodeCursor(value, examGroupCursorSchema);
  return { id: parsed.id, startsOn: parsed.startsOn };
}

export function encodeExamGroupCursor(cursor: ExamGroupCursor): string {
  return encodeCursor(cursor);
}

export function decodeAssessmentCursor(value: string): AssessmentCursor {
  const parsed = decodeCursor(value, assessmentCursorSchema);
  return { id: parsed.id, scheduledOn: parsed.scheduledOn };
}

export function encodeAssessmentCursor(cursor: AssessmentCursor): string {
  return encodeCursor(cursor);
}

export function decodeResultCursor(value: string): ResultCursor {
  const parsed = decodeCursor(value, resultCursorSchema);
  return { id: parsed.id, updatedAt: parsed.updatedAt };
}

export function encodeResultCursor(cursor: ResultCursor): string {
  return encodeCursor(cursor);
}

export function decodeLeaderboardCursor(value: string): LeaderboardCursor {
  const parsed = decodeCursor(value, leaderboardCursorSchema);
  return { marks: parsed.marks, name: parsed.name, studentId: parsed.studentId };
}

export function encodeLeaderboardCursor(cursor: LeaderboardCursor): string {
  return encodeCursor(cursor);
}
