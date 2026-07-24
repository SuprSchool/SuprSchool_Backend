import { z } from 'zod';

import {
  MAX_RECORDING_AUDIO_BYTES,
  MAX_RECORDING_DURATION_MS,
  MAX_RECORDING_RESOURCE_BYTES,
  RECORDING_AUDIO_CONTENT_TYPE,
  RECORDING_RESOURCE_CONTENT_TYPES,
} from '../types/recordings.js';

const isoTimestampSchema = z.string().datetime({ offset: true });
const uuidSchema = z.uuid();

const recordingCursorSchema = z
  .string()
  .regex(/^.+\|[0-9a-f-]{36}$/i, 'Use a valid recording cursor')
  .transform((value, context) => {
    const separator = value.lastIndexOf('|');
    const publishedAt = value.slice(0, separator);
    const id = value.slice(separator + 1);
    if (!isoTimestampSchema.safeParse(publishedAt).success || !uuidSchema.safeParse(id).success) {
      context.addIssue({ code: 'custom', message: 'Use a valid recording cursor' });
      return z.NEVER;
    }
    return { id, publishedAt };
  });

export const recordingIdParamsSchema = z.object({ recordingId: uuidSchema });
export const classIdParamsSchema = z.object({ classId: uuidSchema });

export const createRecordingDraftSchema = z.object({
  description: z.string().trim().min(1).max(4_000).optional(),
  subjectId: uuidSchema,
  title: z.string().trim().min(1).max(180),
});

export const recordingListQuerySchema = z.object({
  cursor: recordingCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  subjectId: uuidSchema.optional(),
});

export const createRecordingUploadSessionSchema = z.object({
  contentType: z.literal(RECORDING_AUDIO_CONTENT_TYPE),
  durationMs: z.coerce.number().int().min(1).max(MAX_RECORDING_DURATION_MS),
  sizeBytes: z.coerce.number().int().min(1).max(MAX_RECORDING_AUDIO_BYTES),
});

export const createRecordingResourceUploadSessionSchema = z.object({
  contentType: z.enum(RECORDING_RESOURCE_CONTENT_TYPES),
  displayName: z.string().trim().min(1).max(255),
  kind: z.enum(['attachment', 'banner']),
  sizeBytes: z.coerce.number().int().min(1).max(MAX_RECORDING_RESOURCE_BYTES),
});

export const recordingMutationSchema = z.union([
  z.object({ action: z.literal('publish') }),
  z.object({
    description: z.string().trim().max(4_000).nullable(),
    title: z.string().trim().min(1).max(180),
  }),
]);

export const saveRecordingProgressSchema = z.object({
  clientSequence: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  completed: z.boolean(),
  playbackSessionId: uuidSchema,
  positionMs: z.coerce.number().int().min(0).max(MAX_RECORDING_DURATION_MS),
});

export type CreateRecordingDraftRequest = z.infer<typeof createRecordingDraftSchema>;
export type CreateRecordingUploadSessionRequest = z.infer<typeof createRecordingUploadSessionSchema>;
export type CreateRecordingResourceUploadSessionRequest = z.infer<typeof createRecordingResourceUploadSessionSchema>;
export type RecordingListQuery = z.infer<typeof recordingListQuerySchema>;
export type SaveRecordingProgressRequest = z.infer<typeof saveRecordingProgressSchema>;
