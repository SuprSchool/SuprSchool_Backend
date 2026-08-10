import { TIMETABLE_TIME_ZONE, isoDateInTimeZone } from '../lib/school-time.js';

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface DiaryCursor {
  id: string;
  occurredOn: string;
}

export interface CursorPageInput {
  cursor?: DiaryCursor | undefined;
  limit: number;
}

/**
 * `from`/`to` bound the calendar window a teacher is looking at. They arrive
 * together or not at all, and only a bounded window can report the scheduled
 * periods that never received a diary entry.
 */
export interface TeacherDiaryPageInput extends CursorPageInput {
  from?: string | undefined;
  to?: string | undefined;
}

export interface CreateDiaryInput {
  classSubjectId: string;
  description: string;
  keyPoints: string[];
  occurredOn: string;
  periodLabel: string;
  title: string;
}

export interface UpdateDiaryInput {
  description?: string | undefined;
  keyPoints?: string[] | undefined;
  occurredOn?: string | undefined;
  periodLabel?: string | undefined;
  title?: string | undefined;
}

export interface TeacherDiaryDto {
  classId: string;
  classSubjectId: string;
  description: string;
  id: string;
  keyPoints: string[];
  occurredOn: string;
  periodLabel: string;
  teacherId: string;
  title: string;
  updatedAt: string;
}

export interface DiaryRecord extends TeacherDiaryDto {
  revision: number;
  schoolId: string;
}

export interface StudentDiaryDto extends TeacherDiaryDto {
  teacherName: string;
}

/**
 * `occurrenceLocked` marks an entry whose occurrence date has passed, so its
 * date and period can no longer be moved. It is derived per response rather
 * than stored, so a replayed idempotent write never reports a stale lock.
 */
export interface DiaryEntryView extends TeacherDiaryDto {
  occurrenceLocked: boolean;
}

export interface TeacherDiaryListEntry extends DiaryEntryView {
  missing: false;
}

/** A scheduled teaching period in the requested window that has no diary entry. */
export interface MissingDiaryPeriodDto {
  classId: string;
  classSubjectId: string;
  missing: true;
  occurredOn: string;
  periodLabel: string;
}

export type TeacherDiaryListItem = TeacherDiaryListEntry | MissingDiaryPeriodDto;

export interface ScheduledPeriodDto {
  classId: string;
  classSubjectId: string;
  occurredOn: string;
  periodLabel: string;
}

export interface DeletedDiaryDto {
  deletedAt: string;
  id: string;
}

export interface DiaryActor {
  schoolId: string;
  teacherId: string;
}

/** An entry may no longer move once its occurrence date is in the past. */
export function isOccurrenceLocked(occurredOn: string, today: string): boolean {
  return occurredOn < today;
}

/**
 * "Today" on the school's calendar, not the server's.
 *
 * This was the server's UTC date, which made the lock engage up to 5.5 hours
 * late in IST: between 00:00 and 05:30 local, UTC still reads yesterday, so an
 * entry that had already fallen into the past stayed editable. It now shares
 * `TIMETABLE_TIME_ZONE` with the schedule repository's period lookup, so both
 * surfaces agree on when the school day turns.
 */
export function todayIsoDate(): string {
  return isoDateInTimeZone(new Date(), TIMETABLE_TIME_ZONE);
}

const ORDINAL_SUFFIXES = ['th', 'st', 'nd', 'rd'] as const;

/**
 * `class_schedule_slots` carries no label, so a slot's period name is its
 * position in that day's timetable — the same "1st Period" wording teachers
 * type when they write the diary entry.
 */
export function formatPeriodLabel(periodNumber: number): string {
  const remainderTen = periodNumber % 10;
  const remainderHundred = periodNumber % 100;
  const suffix = remainderTen < 4 && remainderHundred - remainderTen !== 10
    ? ORDINAL_SUFFIXES[remainderTen]
    : ORDINAL_SUFFIXES[0];
  return `${periodNumber}${suffix ?? 'th'} Period`;
}

export function encodeDiaryCursor(cursor: DiaryCursor): string {
  return Buffer.from(JSON.stringify({ ...cursor, v: 1 }), 'utf8').toString('base64url');
}
