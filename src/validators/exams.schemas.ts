import { z } from 'zod';

import { academicFileContentTypes } from '../platform/storage/academic-file-content-types.js';

import {
  decodeAssessmentCursor,
  decodeExamGroupCursor,
  decodeLeaderboardCursor,
  decodeResultCursor,
  examGroupStateValues,
} from '../types/exams.js';

const date = z.string().date();
const time = z.string().regex(
  /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?$/,
  'Expected a 24-hour time',
);
const trimmedText = (minimum: number, maximum: number) => z.string()
  .trim()
  .min(minimum)
  .max(maximum);

const rubricSchema = z.object({
  description: trimmedText(1, 2_000),
  marks: z.coerce.number().finite().min(0),
  position: z.coerce.number().int().min(1).max(100),
  sectionTitle: trimmedText(1, 160),
});

export const groupIdParamSchema = z.object({ groupId: z.uuid() });
export const assessmentIdParamSchema = z.object({ assessmentId: z.uuid() });
export const classIdParamSchema = z.object({ classId: z.uuid() });
export const studentIdParamSchema = z.object({ studentId: z.uuid() });

export const examGroupListQuerySchema = z.object({
  cursor: z.string().min(1).transform((value, context) => {
    try {
      return decodeExamGroupCursor(value);
    } catch {
      context.addIssue({ code: 'custom', message: 'Invalid exam group cursor' });
      return z.NEVER;
    }
  }).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const assessmentListQuerySchema = z.object({
  cursor: z.string().min(1).transform((value, context) => {
    try {
      return decodeAssessmentCursor(value);
    } catch {
      context.addIssue({ code: 'custom', message: 'Invalid assessment cursor' });
      return z.NEVER;
    }
  }).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const resultListQuerySchema = z.object({
  cursor: z.string().min(1).transform((value, context) => {
    try {
      return decodeResultCursor(value);
    } catch {
      context.addIssue({ code: 'custom', message: 'Invalid exam result cursor' });
      return z.NEVER;
    }
  }).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const leaderboardQuerySchema = z.object({
  cursor: z.string().min(1).transform((value, context) => {
    try {
      return decodeLeaderboardCursor(value);
    } catch {
      context.addIssue({ code: 'custom', message: 'Invalid leaderboard cursor' });
      return z.NEVER;
    }
  }).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  subjectId: z.uuid().optional(),
});

export const createExamGroupSchema = z.object({
  endsOn: date,
  startsOn: date,
  state: z.enum(examGroupStateValues).optional(),
  title: trimmedText(1, 160),
}).superRefine((input, context) => {
  if (input.endsOn < input.startsOn) {
    context.addIssue({
      code: 'custom',
      message: 'endsOn must be on or after startsOn',
      path: ['endsOn'],
    });
  }
});

export const updateExamGroupSchema = createExamGroupSchema;

export const createAssessmentSchema = z.object({
  endsAt: time,
  maxMarks: z.coerce.number().finite().positive(),
  rubrics: z.array(rubricSchema).min(1).max(100),
  scheduledOn: date,
  startsAt: time,
  subjectId: z.uuid(),
  syllabus: trimmedText(1, 10_000).optional(),
  title: trimmedText(1, 160),
}).superRefine((input, context) => {
  if (input.endsAt <= input.startsAt) {
    context.addIssue({
      code: 'custom',
      message: 'endsAt must be after startsAt',
      path: ['endsAt'],
    });
  }
  const rubricTotal = input.rubrics.reduce((total, rubric) => total + rubric.marks, 0);
  if (Math.abs(rubricTotal - input.maxMarks) > Number.EPSILON * 100) {
    context.addIssue({
      code: 'custom',
      message: 'Rubric marks must total maxMarks',
      path: ['rubrics'],
    });
  }
});

export const updateAssessmentSchema = createAssessmentSchema;

export const upsertResultSchema = z.object({
  feedback: trimmedText(1, 4_000).optional(),
  marks: z.coerce.number().finite().min(0),
});

export const examResourceUploadSchema = z.object({
  contentType: z.enum(academicFileContentTypes),
  displayName: trimmedText(1, 255),
  sizeBytes: z.coerce.number().int().min(1).max(20 * 1024 * 1024),
});

export const confirmUploadSchema = z.object({ uploadSessionId: z.uuid() });
export const emptyBodySchema = z.object({}).strict();

export type ExamGroupListQueryInput = z.infer<typeof examGroupListQuerySchema>;
export type AssessmentListQueryInput = z.infer<typeof assessmentListQuerySchema>;
export type ResultListQueryInput = z.infer<typeof resultListQuerySchema>;
export type LeaderboardQueryInput = z.infer<typeof leaderboardQuerySchema>;
