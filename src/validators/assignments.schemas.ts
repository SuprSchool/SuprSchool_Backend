import { z } from 'zod';

import { academicFileContentTypes } from '../platform/storage/academic-file-content-types.js';

import {
  assignmentBannerContentTypes,
  assignmentGradingTypeValues,
  assignmentLetterGradeValues,
  assignmentResourceRoleValues,
  bulkCompletionScopeValues,
  decodeAssignmentCreatedCursor,
  decodeAssignmentDueCursor,
  decodeSubmissionCursor,
  studentAssignmentStatusValues,
  submissionCompletionActions,
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
  // A rubric breakdown is an optional aid, not part of what makes an
  // assignment well formed: a teacher may publish one and grade it against the
  // maximum alone. Omitting the key entirely and sending `[]` both mean "no
  // breakdown"; the totalling rules below only bind once a breakdown exists.
  rubrics: z.array(rubricSchema).max(100).optional(),
  subjectId: z.uuid(),
  title: trimmedText(1, 160),
}).superRefine((input, context) => {
  const rubrics = input.rubrics ?? [];
  const hasRubrics = rubrics.length > 0;
  const rubricTotal = rubrics.reduce((total, rubric) => total + rubric.marks, 0);
  if (input.gradingType === 'Numeric') {
    if (input.maxMarks === undefined || input.maxMarks <= 0) {
      context.addIssue({ code: 'custom', message: 'Numeric assignments require maxMarks greater than zero', path: ['maxMarks'] });
      return;
    }
    if (hasRubrics && Math.abs(rubricTotal - input.maxMarks) > Number.EPSILON * 100) {
      context.addIssue({ code: 'custom', message: 'Numeric rubric marks must total maxMarks', path: ['rubrics'] });
    }
    return;
  }
  if (input.maxMarks !== undefined) {
    context.addIssue({ code: 'custom', message: 'Alphabetic assignments do not accept maxMarks', path: ['maxMarks'] });
  }
  if (hasRubrics && rubricTotal !== 0) {
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

/**
 * `role` is the shipped field name; `kind` is accepted as an alias because the
 * rest of the house (events, recordings) spells the same idea that way and
 * clients arrive with either. `role` wins when a body states both, so the
 * documented name is always the authoritative one, and an absent pair means an
 * ordinary resource — which is what every caller that predates banners sends.
 */
const roleAliasFields = {
  kind: z.enum(assignmentResourceRoleValues).optional(),
  role: z.enum(assignmentResourceRoleValues).optional(),
};

function resolveRole(input: {
  kind?: 'banner' | 'resource' | undefined;
  role?: 'banner' | 'resource' | undefined;
}): 'banner' | 'resource' {
  return input.role ?? input.kind ?? 'resource';
}

/**
 * A banner is a header image, so it may only claim an image content type. The
 * check is here as well as on confirm so the teacher is told before uploading
 * twenty megabytes, rather than after.
 */
export const assignmentResourceUploadSchema = uploadSchema
  .extend(roleAliasFields)
  .transform(({ kind, role, ...rest }) => ({ ...rest, role: resolveRole({ kind, role }) }))
  .superRefine((input, context) => {
    if (
      input.role === 'banner'
      && !(assignmentBannerContentTypes as ReadonlyArray<string>).includes(input.contentType)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A banner attachment must be an image',
        path: ['contentType'],
      });
    }
  });

export const confirmUploadSchema = z.object({ uploadSessionId: z.uuid() });

/** The resource confirm restates the role, so the durable write knows the slot
 * without the storage layer having to carry it through the upload session. */
export const confirmResourceUploadSchema = z.object({
  ...roleAliasFields,
  uploadSessionId: z.uuid(),
}).transform(({ kind, role, uploadSessionId }) => ({
  role: resolveRole({ kind, role }),
  uploadSessionId,
}));

/**
 * Exactly one of `marks` / `letterGrade`. Which one is legal depends on the
 * assignment's own `gradingType`, which the request cannot see — the service
 * re-checks it against the stored assignment, so this only rejects a body that
 * is malformed however the assignment is configured.
 */
export const gradeSubmissionSchema = z.object({
  feedback: trimmedText(1, 4_000).optional(),
  letterGrade: z.enum(assignmentLetterGradeValues).optional(),
  marks: z.coerce.number().finite().min(0).optional(),
}).superRefine((input, context) => {
  const stated = [input.marks !== undefined, input.letterGrade !== undefined]
    .filter(Boolean).length;
  if (stated === 1) return;
  context.addIssue({
    code: 'custom',
    message: stated === 0
      ? 'A grade must state either marks or letterGrade'
      : 'A grade must state marks or letterGrade, not both',
    path: stated === 0 ? [] : ['letterGrade'],
  });
});

export const emptyBodySchema = z.object({}).strict();

/**
 * The body of a fileless submission. Deliberately NOT `.strict()`, unlike
 * `emptyBodySchema`: a student submitting with nothing attached has nothing to
 * state, so an unknown key is a client that is ahead of the server rather than
 * an attack — and Zod strips it, which means a smuggled `submittedAt` never
 * reaches the service and the server clock stays authoritative either way.
 * Rejecting the request instead would only turn a harmless extra field into a
 * 400 on a device that cannot be redeployed as quickly as this server.
 */
export const submitWithoutFileSchema = z.object({});

/**
 * Both spellings of the same instruction, because the completion sheet and the
 * roster row reached it from different client screens: the original
 * `{ action: 'complete' | 'incomplete' }` and the boolean
 * `{ completed: true | false }`. Exactly one form per request — `.strict()` on
 * each member, so a client still cannot smuggle its own completedAt past the
 * server clock, and a body stating both at once is rejected rather than
 * silently resolved in favour of one.
 */
export const submissionCompletionSchema = z.union([
  z.object({ action: z.enum(submissionCompletionActions) }).strict(),
  z.object({ completed: z.boolean() }).strict(),
]).transform((input) => ({
  action: 'action' in input
    ? input.action
    : (input.completed ? 'complete' as const : 'incomplete' as const),
}));

export const bulkCompletionSchema = z.object({
  scope: z.enum(bulkCompletionScopeValues),
}).strict();

export type StudentAssignmentListQueryInput = z.infer<typeof studentAssignmentListQuerySchema>;
export type TeacherAssignmentListQueryInput = z.infer<typeof teacherAssignmentListQuerySchema>;
export type SubmissionListQueryInput = z.infer<typeof submissionListQuerySchema>;
export type CreateAssignmentInputSchema = z.infer<typeof createAssignmentSchema>;
export type SubmissionUploadInputSchema = z.infer<typeof submissionUploadSchema>;
export type GradeSubmissionInputSchema = z.infer<typeof gradeSubmissionSchema>;
