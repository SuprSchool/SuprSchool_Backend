import { z } from 'zod';

import { pointActivityPeriodValues, type PointActivityCursor } from '../types/points.js';

const pointCursorSchema = z.object({
  id: z.uuid(),
  occurredAt: z.string().datetime({ offset: true }),
}).strict();

function decodePointsCursor(value: string): PointActivityCursor {
  return pointCursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
}

const encodedPointCursorSchema = z.string().min(1).transform((value, context) => {
  try {
    return decodePointsCursor(value);
  } catch {
    context.addIssue({ code: 'custom', message: 'Use a valid points cursor' });
    return z.NEVER;
  }
});

export const pointsActivityQuerySchema = z.object({
  cursor: encodedPointCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  // `761:4817` offers exactly three windows. An unlisted one is a client bug,
  // not a reason to silently widen the read to all time.
  period: z.enum(pointActivityPeriodValues).default('all'),
}).strict();

export function encodePointsCursor(cursor: PointActivityCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}


const studentRankingQuerySchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('section') }).strict(),
  z.object({
    scope: z.literal('subject'),
    subjectName: z.string().trim().min(1).max(120),
  }).strict(),
]);

export { studentRankingQuerySchema };
