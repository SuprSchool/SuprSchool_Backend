import type { ProfileAvatar } from './profile.js';

export type StudentAnnouncementCategory = 'School' | 'Class' | 'Sports' | 'Parents';

export interface StudentHomeClass {
  id: string;
  displayName: string;
}

export interface StudentHomeAnnouncement {
  id: string;
  category: StudentAnnouncementCategory;
  title: string;
  body: string;
  publishedAt: string;
}

export interface StudentHomeExam {
  id: string;
  title: string;
  subject: string;
  date: string;
}

export interface StudentHomeBirthday {
  avatar: ProfileAvatar | null;
  id: string;
  name: string;
  classLabel: string;
}

export interface StudentHomeIdentity {
  schoolId: string;
  userId: string;
}

export interface StudentHomeScheduleEntry {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  subject: string;
  teacherName: string;
  room?: string;
}

export interface StudentHomeCalendarEvent {
  date: string;
  id: string;
  title: string;
  type: 'event';
}

export interface StudentHomeCalendarDayItem {
  id: string;
  type: 'event';
  title: string;
  subject: string;
  time: string;
  location?: string;
}

export interface StudentHomeCalendarResponse {
  events: StudentHomeCalendarEvent[];
}

export interface StudentHomeCalendarDayResponse {
  items: StudentHomeCalendarDayItem[];
}

/**
 * A birthday that has not happened yet, carrying the date it falls on so the
 * caller can group by "Tomorrow" / "In 5 days" without recomputing the year
 * wrap for itself.
 */
export interface StudentHomeUpcomingBirthday extends StudentHomeBirthday {
  /** ISO date of the next occurrence, e.g. "2026-08-19". Never today. */
  date: string;
  /** Whole days until `date`. 1 is tomorrow; never 0, that is `birthdays`. */
  inDays: number;
}

export interface StudentHomeBirthdaysResponse {
  /** Birthdays falling today. Unchanged shape -- existing callers still read this. */
  birthdays: StudentHomeBirthday[];
  /**
   * Birthdays in the next `windowDays` days, today excluded, ordered by next
   * occurrence then name. Wraps the year end, so on 28 December a 2 January
   * birthday appears here.
   */
  upcoming: StudentHomeUpcomingBirthday[];
  /** The horizon actually applied, echoed back so the caller need not assume. */
  windowDays: number;
}

export interface StudentHomeResponse {
  class: StudentHomeClass;
  announcements: StudentHomeAnnouncement[];
  exams: StudentHomeExam[];
  birthdays: StudentHomeBirthday[];
  schedule: {
    today: StudentHomeScheduleEntry[];
    upcoming: StudentHomeScheduleEntry[];
  };
}
