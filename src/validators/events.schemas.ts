import type { EventMemberCursor } from '../types/events.js';
import { z } from 'zod';

import type { EventsCursor } from '../types/events.js';
import { academicFileContentTypes } from '../platform/storage/academic-file-content-types.js';

const uuidSchema = z.uuid();
const microsecondTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export function decodeEventsCursor(value: string): EventsCursor {
  let decoded: string;
  try {
    decoded = Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    throw new Error('Invalid events cursor');
  }
  const separator = decoded.lastIndexOf('|');
  const createdAt = decoded.slice(0, separator);
  const id = decoded.slice(separator + 1);
  if (separator <= 0 || !microsecondTimestamp.test(createdAt) || !uuidSchema.safeParse(id).success) {
    throw new Error('Invalid events cursor');
  }
  return { createdAt, id };
}

export function encodeEventsCursor(cursor: EventsCursor): string {
  if (!microsecondTimestamp.test(cursor.createdAt) || !uuidSchema.safeParse(cursor.id).success) {
    throw new Error('Invalid events cursor');
  }
  return Buffer.from(`${cursor.createdAt}|${cursor.id}`).toString('base64url');
}

const eventMemberCursorPayloadSchema = z.object({
  displayNameKey: z.string().min(1).max(240),
  userId: uuidSchema,
}).strict();

export function decodeEventMemberCursor(value: string): EventMemberCursor {
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    return eventMemberCursorPayloadSchema.parse(decoded);
  } catch {
    throw new Error('Invalid event member cursor');
  }
}

export function encodeEventMemberCursor(cursor: EventMemberCursor): string {
  const parsed = eventMemberCursorPayloadSchema.parse(cursor);
  return Buffer.from(JSON.stringify(parsed)).toString('base64url');
}

const eventMemberCursorSchema = z.string().transform((value, context) => {
  try {
    return decodeEventMemberCursor(value);
  } catch {
    context.addIssue({ code: 'custom', message: 'Use a valid event member cursor' });
    return z.NEVER;
  }
});

const cursorSchema = z.string().transform((value, context) => {
  try {
    return decodeEventsCursor(value);
  } catch {
    context.addIssue({ code: 'custom', message: 'Use a valid events cursor' });
    return z.NEVER;
  }
});

const studentEventStatusSchema = z.enum(['trending', 'upcoming', 'registered', 'completed']);

export const studentEventsQuerySchema = z.object({
  cursor: cursorSchema.optional(),
  filter: studentEventStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: studentEventStatusSchema.optional(),
}).superRefine((value, context) => {
  if (value.filter !== undefined && value.status !== undefined && value.filter !== value.status) {
    context.addIssue({ code: 'custom', message: 'filter and status must agree when both are supplied' });
  }
}).transform(({ cursor, filter, limit, status }) => ({
  cursor,
  filter: status ?? filter ?? 'trending',
  limit,
}));

export interface EventCursorRow {
  createdAt: string;
  id: string;
}

export interface RankedEventResult {
  rank: number | null;
  score: number | null;
  targetId: string;
}

export function paginateEventRows<TRow extends EventCursorRow>(
  rows: readonly TRow[],
  cursor: EventsCursor | undefined,
  limit = 25,
): { items: TRow[]; nextCursor: string | null } {
  const ordered = [...rows].sort((left, right) => (
    right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
  ));
  const eligibleRows = cursor === undefined
    ? ordered
    : ordered.filter((row) => (
      row.createdAt < cursor.createdAt
      || (row.createdAt === cursor.createdAt && row.id < cursor.id)
    ));
  const slice = eligibleRows.slice(0, limit + 1);
  const items = slice.slice(0, limit);
  const last = items.at(-1);

  return {
    items,
    nextCursor: slice.length > limit && last !== undefined
      ? encodeEventsCursor(last)
      : null,
  };
}

export function rankEventResults(
  rows: ReadonlyArray<Omit<RankedEventResult, 'rank'>>,
): RankedEventResult[] {
  const ordered = [...rows].sort((left, right) => {
    if (left.score === null && right.score === null) return left.targetId.localeCompare(right.targetId);
    if (left.score === null) return 1;
    if (right.score === null) return -1;
    return right.score - left.score || left.targetId.localeCompare(right.targetId);
  });

  let previousScore: number | undefined;
  let rank = 0;
  return ordered.map((row) => {
    if (row.score === null) return { ...row, rank: null };
    if (previousScore === undefined || row.score !== previousScore) {
      rank += 1;
      previousScore = row.score;
    }
    return { ...row, rank };
  });
}

const isoDateTimeSchema = z.string().datetime({ offset: true });
const eventIdParamsSchema = z.object({ eventId: z.uuid() });
const targetClassIdsSchema = z.array(z.uuid()).max(100).superRefine((value, context) => {
  if (new Set(value).size !== value.length) {
    context.addIssue({ code: 'custom', message: 'Target classes must be unique' });
  }
});

export const createEventSchema = z.object({
  activityKind: z.enum(['event', 'competition']),
  audienceType: z.enum(['classes', 'school']).default('classes'),
  category: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(10_000).optional(),
  eligibilityCriteria: z.string().trim().min(1).max(2_000).optional(),
  eligibilityRules: z.object({ targetClassIds: targetClassIdsSchema }).strict().optional(),
  endsAt: isoDateTimeSchema.optional(),
  genderEligibility: z.enum(['female', 'male', 'mixed']).default('mixed'),
  lifecycle: z.enum(['draft', 'published']).optional(),
  participationMode: z.enum(['solo', 'team']).optional(),
  registrationDeadlineAt: isoDateTimeSchema,
  rulesAndRegulations: z.string().trim().min(1).max(10_000).optional(),
  startsAt: isoDateTimeSchema,
  targetClassIds: targetClassIdsSchema.default([]),
  title: z.string().trim().min(1).max(240),
  venue: z.string().trim().min(1).max(240).optional(),
}).strict().superRefine((value, context) => {
  if (value.audienceType === 'classes' && value.targetClassIds.length === 0) {
    context.addIssue({ code: 'custom', message: 'Class events require at least one target class' });
  }
  if (value.audienceType === 'school' && value.targetClassIds.length !== 0) {
    context.addIssue({ code: 'custom', message: 'Whole-school events cannot enumerate target classes' });
  }
  if (value.eligibilityRules !== undefined && value.eligibilityRules.targetClassIds.join('|') !== value.targetClassIds.join('|')) {
    context.addIssue({ code: 'custom', message: 'Eligibility target classes must match the event audience' });
  }
  if (value.activityKind === 'competition' && value.participationMode === undefined) {
    context.addIssue({ code: 'custom', message: 'Competitions require a participation mode' });
  }
  if (value.endsAt !== undefined && value.endsAt < value.startsAt) {
    context.addIssue({ code: 'custom', message: 'An event cannot end before it starts' });
  }
  if (value.registrationDeadlineAt !== undefined && value.registrationDeadlineAt > value.startsAt) {
    context.addIssue({ code: 'custom', message: 'Registration closes no later than the event start' });
  }
});

export const updateEventSchema = z.object({
  activityKind: z.enum(['event', 'competition']).optional(),
  audienceType: z.enum(['classes', 'school']).optional(),
  category: z.string().trim().min(1).max(120).nullable().optional(),
  description: z.string().trim().max(10_000).nullable().optional(),
  eligibilityCriteria: z.string().trim().min(1).max(2_000).nullable().optional(),
  eligibilityRules: z.object({ targetClassIds: targetClassIdsSchema }).strict().optional(),
  endsAt: isoDateTimeSchema.nullable().optional(),
  lifecycle: z.enum(['draft', 'published', 'completed']).optional(),
  genderEligibility: z.enum(['female', 'male', 'mixed']).optional(),
  participationMode: z.enum(['solo', 'team']).nullable().optional(),
  registrationDeadlineAt: isoDateTimeSchema.optional(),
  rulesAndRegulations: z.string().trim().min(1).max(10_000).nullable().optional(),
  startsAt: isoDateTimeSchema.optional(),
  targetClassIds: targetClassIdsSchema.optional(),
  title: z.string().trim().min(1).max(240).optional(),
  venue: z.string().trim().min(1).max(240).nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.audienceType === 'classes' && (value.targetClassIds === undefined || value.targetClassIds.length === 0)) {
    context.addIssue({ code: 'custom', message: 'Changing to a class audience requires target classes' });
  }
  if (value.audienceType === 'school' && value.targetClassIds !== undefined && value.targetClassIds.length !== 0) {
    context.addIssue({ code: 'custom', message: 'Whole-school events cannot enumerate target classes' });
  }
  if (value.audienceType === undefined && value.targetClassIds !== undefined && value.targetClassIds.length === 0) {
    context.addIssue({ code: 'custom', message: 'Class events require at least one target class' });
  }
  if (value.eligibilityRules !== undefined && (value.targetClassIds === undefined || value.eligibilityRules.targetClassIds.join('|') !== value.targetClassIds.join('|'))) {
    context.addIssue({ code: 'custom', message: 'Eligibility target classes must match the event audience' });
  }
});

const teacherEventStatusSchema = z.enum(['upcoming', 'completed']);

export const teacherEventsQuerySchema = z.object({
  cursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  scope: z.enum(['all', 'my', 'upcoming', 'completed']).default('all'),
  status: teacherEventStatusSchema.optional(),
});

export const eventMemberOptionsQuerySchema = z.object({
  cursor: eventMemberCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  role: z.enum(['student', 'teacher']).optional(),
  search: z.string().trim().min(1).max(80).optional(),
}).strict();

export const eventResourceUploadSchema = z.object({
  contentType: z.enum(academicFileContentTypes),
  displayName: z.string().trim().min(1).max(255),
  kind: z.enum(['attachment', 'banner']),
  sizeBytes: z.coerce.number().int().min(1).max(20 * 1024 * 1024),
  sortOrder: z.coerce.number().int().min(0).max(1_000).default(0),
}).strict().superRefine((value, context) => {
  if (value.kind === 'banner' && !['image/jpeg', 'image/png', 'image/webp'].includes(value.contentType)) {
    context.addIssue({ code: 'custom', message: 'Event banners must be JPEG, PNG, or WebP images' });
  }
});

export const eventResourceSessionParamsSchema = z.object({
  eventId: z.uuid(),
  sessionId: z.uuid(),
});

export const eventResourceParamsSchema = z.object({
  eventId: z.uuid(),
  resourceId: z.uuid(),
});

export const managingTeamSchema = z.object({
  members: z.array(z.object({
    memberType: z.enum(['teacher', 'student']),
    role: z.string().trim().min(1).max(120),
    contact: z.string().trim().min(1).max(320).nullable().optional(),
    userId: z.uuid(),
  }).strict()).max(100).superRefine((members, context) => {
    if (new Set(members.map((member) => member.userId)).size !== members.length) {
      context.addIssue({ code: 'custom', message: 'A managing member can appear only once' });
    }
  }),
}).strict();

export const eventTeamSchema = z.object({
  memberStudentIds: z.array(z.uuid()).min(1).max(100),
  name: z.string().trim().min(1).max(120),
}).strict();

export const eventTeamMembersSchema = z.object({
  memberStudentIds: z.array(z.uuid()).min(1).max(100),
}).strict();

export const eventTeamsReplacementSchema = z.object({
  teams: z.array(z.object({
    id: z.uuid().optional(),
    memberStudentIds: z.array(z.uuid()).min(1).max(100),
    name: z.string().trim().min(1).max(120),
  }).strict()).max(100),
}).strict().superRefine(({ teams }, context) => {
  const ids = teams.flatMap((team) => team.id === undefined ? [] : [team.id]);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', message: 'An event team can appear only once' });
  }
  const names = teams.map((team) => team.name.toLocaleLowerCase());
  if (new Set(names).size !== names.length) {
    context.addIssue({ code: 'custom', message: 'Event team names must be unique' });
  }
  const members = teams.flatMap((team) => team.memberStudentIds);
  if (new Set(members).size !== members.length) {
    context.addIssue({ code: 'custom', message: 'A student can belong to only one event team' });
  }
});

export const eventScoresSchema = z.object({
  entries: z.array(z.object({
    score: z.number().finite().nullable(),
    targetId: z.uuid(),
    targetType: z.enum(['registration', 'team']),
  }).strict()).min(1).max(1_000),
}).strict();

export const emptyEventsMutationSchema = z.object({}).strict();
export { eventIdParamsSchema };

export const eventParticipantParamsSchema = z.object({
  eventId: z.uuid(),
  studentId: z.uuid(),
});

export const eventTeamParamsSchema = z.object({
  eventId: z.uuid(),
  teamId: z.uuid(),
});

export const eventParticipationTagSchema = z.object({
  tag: z.string().trim().min(1).max(120).nullable(),
}).strict();
