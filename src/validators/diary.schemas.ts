import { z } from 'zod';

import type { DiaryCursor } from '../types/diary.js';

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, { message: 'Use a valid calendar date' });

const diaryCursorPayloadSchema = z.object({
  id: z.uuid(),
  occurredOn: isoDateSchema,
  v: z.literal(1),
});

function parseDiaryCursor(value: string): DiaryCursor | undefined {
  try {
    const parsed = diaryCursorPayloadSchema.safeParse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')),
    );
    return parsed.success ? { id: parsed.data.id, occurredOn: parsed.data.occurredOn } : undefined;
  } catch {
    return undefined;
  }
}

const encodedDiaryCursorSchema = z
  .string()
  .min(1)
  .max(512, "Diary cursor is too long")
  .refine((value) => parseDiaryCursor(value) !== undefined, 'Use a valid diary cursor')
  .transform((value) => parseDiaryCursor(value) as DiaryCursor);

const diaryTextSchema = z.string().trim().min(1).max(160);
const diaryDescriptionSchema = z.string().trim().min(1).max(5_000);
const diaryKeyPointSchema = z.string().trim().min(1).max(240);
const periodLabelSchema = z.string().trim().min(1).max(160);

export const createDiaryInputSchema = z.object({
  classSubjectId: z.uuid(),
  description: diaryDescriptionSchema,
  keyPoints: z.array(diaryKeyPointSchema).max(20).default([]),
  occurredOn: isoDateSchema,
  periodLabel: periodLabelSchema,
  title: diaryTextSchema,
}).strict();

export const updateDiaryInputSchema = z.object({
  description: diaryDescriptionSchema.optional(),
  keyPoints: z.array(diaryKeyPointSchema).max(20).optional(),
  occurredOn: isoDateSchema.optional(),
  periodLabel: periodLabelSchema.optional(),
  title: diaryTextSchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: 'Provide at least one diary field to update',
});

export const diaryPageQuerySchema = z.object({
  cursor: encodedDiaryCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const classParamsSchema = z.object({ classId: z.uuid() });
export const diaryParamsSchema = z.object({ diaryId: z.uuid() });
export const subjectParamsSchema = z.object({ subjectId: z.uuid() });
export const idempotencyKeySchema = z.string().trim().min(1).max(255);
