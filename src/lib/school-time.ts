/**
 * The school's wall clock.
 *
 * Timetable slots are naive wall-clock times — `supabase/seed.sql` writes
 * 08:00–11:45, a school morning — while the database session runs in UTC. Two
 * separate questions need the school's own calendar: "which period is it right
 * now?" (resolved in SQL by the schedule repository) and "is this diary entry
 * in the past yet?" (resolved in the diary types). Answering the second in UTC
 * makes an entry's edit lock engage up to 5.5 hours late in IST, because
 * between 00:00 and 05:30 local the server still reads yesterday's date.
 *
 * This module is deliberately dependency-free so both callers can share one
 * definition without either importing the other — the diary types are a leaf
 * that repositories import from, so the constant cannot live in a repository.
 *
 * One school per deployment today; a `schools.time_zone` column is the real
 * fix and is filed in `docs/parity/SHARED-REQUESTS.md`.
 */
export const TIMETABLE_TIME_ZONE = 'Asia/Kolkata';

/**
 * The calendar date at `timeZone` for `instant`, as `YYYY-MM-DD`.
 *
 * Assembled from `formatToParts` rather than a locale format string so the
 * result cannot drift with the host's default locale.
 */
export function isoDateInTimeZone(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(instant);
  const part = (type: 'day' | 'month' | 'year'): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
