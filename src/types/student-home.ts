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

export interface StudentHomeBirthdaysResponse {
  birthdays: StudentHomeBirthday[];
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
