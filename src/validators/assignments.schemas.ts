import { z } from 'zod';

import { academicFileContentTypes } from '../platform/storage/academic-file-content-types.js';

import {
  assignmentGradingTypeValues,
  decodeAssignmentCreatedCursor,
  decodeAssignmentDueCursor,
  decodeSubmissionCursor,
  studentAssignmentStatusValues,
  teacherAssignmentStatusValues,
} from '../types/assignments.js';

const trimmedText = (minimum: number, maximum: number) => z.string()
  .trim()
  .min(minimum)
  .max(maximum);

const rubricSchema = z.object({
  marks: z.coerce.number().finite().min(0),
  moreInfo: trimmedText(1, 2_000).optional(),
  position: z.coerce.number().int().min(1).max(100),
  topic: trimmedText(1, 160),
});

export const assignmentIdParamSchema = z.object({ assignmentId: z.uuid() });
export const assignmentResourceParamsSchema = z.object({
  assignmentId: z.uuid(),
  resourceId: z.uuid(),
});
export const classIdParamSchema = z.object({ classId: z.uuid() });
export const submissionIdParamSchema = z.object({ submissionId: z.uuid() });
export const studentIdParamSchema = z.object({ studentId: z.uuid() });

export const studentAssignmentListQuerySchema = z.object({
  cursor: z.string().min(1).transform((value, context) => {
    try {
      return decodeAssignmentDueCursor(value);
    } catch {
      context.addIssue({ code: 'custom', message: 'Invalid assignment cursor' });
      return z.NEVER;
    }
  }).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(studentAssignmentStatusValues).optional(),
  subjectId: z.uuid().optional(),
});

export const teacherAssignmentListQuerySchema = z.object({
  cursor: z.string().min(1).transform((value, context) => {
    try {
      return decodeAssignmentCreatedCursor(value);
    } catch {
      context.addIssue({ code: 'custom', message: 'Invalid assignment cursor' });
      return z.NEVER;
    }
  }).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(teacherAssignmentStatusValues).optional(),
});

export const submissionListQuerySchema = z.object({
  cursor: z.string().min(1).transform((value, context) => {
    try {
      return decodeSubmissionCursor(value);
    } catch {
      context.addIssue({ code: 'custom', message: 'Invalid assignment cursor' });
      return z.NEVER;
    }
  }).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const createAssignmentSchema = z.object({
  dueAt: z.string().datetime({ offset: true }),
  gradingType: z.enum(assignmentGradingTypeValues),
  instructions: trimmedText(1, 10_000),
  isGradedAssignment: z.boolean(),
  maxMarks: z.coerce.number().finite().optional(),
  rubrics: z.array(rubricSchema).min(1).max(100),
  subjectId: z.uuid(),
  title: trimmedText(1, 160),
}).superRefine((input, context) => {
  const rubricTotal = input.rubrics.reduce((total, rubric) => total + rubric.marks, 0);
  if (input.gradingType === 'Numeric') {
    if (input.maxMarks === undefined || input.maxMarks <= 0) {
      context.addIssue({ code: 'custom', message: 'Numeric assignments require maxMarks greater than zero', path: ['maxMarks'] });
      return;
    }
    if (Math.abs(rubricTotal - input.maxMarks) > Number.EPSILON * 100) {
      context.addIssue({ code: 'custom', message: 'Numeric rubric marks must total maxMarks', path: ['rubrics'] });
    }
    return;
  }
  if (input.maxMarks !== undefined) {
    context.addIssue({ code: 'custom', message: 'Alphabetic assignments do not accept maxMarks', path: ['maxMarks'] });
  }
  if (rubricTotal !== 0) {
    context.addIssue({ code: 'custom', message: 'Alphabetic rubric marks must be zero', path: ['rubrics'] });
  }
});

export const updateAssignmentSchema = createAssignmentSchema;

const uploadSchema = z.object({
  contentType: z.enum(academicFileContentTypes),
  displayName: trimmedText(1, 255),
  sizeBytes: z.coerce.number().int().min(1).max(20 * 1024 * 1024),
});

export const submissionUploadSchema = uploadSchema;
export const assignmentResourceUploadSchema = uploadSchema;
export const confirmUploadSchema = z.object({ uploadSessionId: z.uuid() });
export const gradeSubmissionSchema = z.object({
  feedback: trimmedText(1, 4_000).optional(),
  marks: z.coerce.number().finite().min(0),
});
export const emptyBodySchema = z.object({}).strict();

export type StudentAssignmentListQueryInput = z.infer<typeof studentAssignmentListQuerySchema>;
export type TeacherAssignmentListQueryInput = z.infer<typeof teacherAssignmentListQuerySchema>;
export type SubmissionListQueryInput = z.infer<typeof submissionListQuerySchema>;
export type CreateAssignmentInputSchema = z.infer<typeof createAssignmentSchema>;
export type SubmissionUploadInputSchema = z.infer<typeof submissionUploadSchema>;
export type GradeSubmissionInputSchema = z.infer<typeof gradeSubmissionSchema>;
