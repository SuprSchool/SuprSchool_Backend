import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';

import type { Database } from '../client.js';
import {
  academicYears,
  classes,
  classMembers,
  classSubjects,
  subjects,
  userProfiles,
  userRoles,
} from '../schema/core.js';
import {
  classAnnouncements,
  classExams,
  classScheduleSlots,
  studentProfiles,
} from '../schema/student-home.js';
import type {
  StudentHomeBirthday,
  StudentHomeCalendarDayItem,
  StudentHomeCalendarEvent,
  StudentHomeResponse,
  StudentHomeScheduleEntry,
  StudentHomeIdentity,
} from '../../types/student-home.js';

export interface StudentHomeRepository {
  getForStudent(userId: string, now: Date): Promise<StudentHomeResponse | null>;
  getCalendarForStudent(
    identity: StudentHomeIdentity,
    startDate: string,
    endDate: string,
  ): Promise<StudentHomeCalendarEvent[] | null>;
  getCalendarDayForStudent(
    identity: StudentHomeIdentity,
    date: string,
  ): Promise<StudentHomeCalendarDayItem[] | null>;
  getBirthdaysForSchool(schoolId: string, now: Date): Promise<StudentHomeBirthday[]>;
}

interface StudentClassContext {
  academicYearId: string;
  classId: string;
  displayName: string;
  schoolId: string;
}

interface ScheduleSlotRow {
  dayOfWeek: number;
  endTime: string;
  id: string;
  room: string | null;
  startTime: string;
  subject: string;
  teacherName: string | null;
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function fromIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function datesBetween(startDate: string, endDate: string): Date[] {
  const start = fromIsoDate(startDate);
  const end = fromIsoDate(endDate);
  const dates: Date[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(new Date(cursor));
  }
  return dates;
}

function nextWeekDates(now: Date): Date[] {
  return Array.from({ length: 8 }, (_value, offset) => {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() + offset);
    return date;
  });
}

export class DrizzleStudentHomeRepository implements StudentHomeRepository {
  public constructor(private readonly db: Database) {}

  public async getForStudent(
    userId: string,
    now: Date,
  ): Promise<StudentHomeResponse | null> {
    const context = await this.findStudentClassContext(userId);
    if (!context) return null;

    const [announcements, exams, birthdays, slots] = await Promise.all([
      this.getAnnouncements(context, now),
      this.getExams(context, now),
      this.getBirthdaysForClass(context, now),
      this.getScheduleSlots(context, nextWeekDates(now).map((date) => date.getUTCDay())),
    ]);

    return {
      announcements,
      birthdays,
      class: { displayName: context.displayName, id: context.classId },
      exams,
      schedule: this.toSchedule(slots, now),
    };
  }

  public async getCalendarForStudent(
    identity: StudentHomeIdentity,
    startDate: string,
    endDate: string,
  ): Promise<StudentHomeCalendarEvent[] | null> {
    const context = await this.findStudentClassContext(identity.userId, identity.schoolId);
    if (!context) return null;

    const dates = datesBetween(startDate, endDate);
    const slots = await this.getScheduleSlots(context, dates.map((date) => date.getUTCDay()));
    return dates.flatMap((date) => {
      const isoDate = toIsoDate(date);
      return slots
        .filter((slot) => slot.dayOfWeek === date.getUTCDay())
        .map((slot) => ({
          date: isoDate,
          id: `${slot.id}:${isoDate}`,
          title: slot.subject,
          type: 'event' as const,
        }));
    });
  }

  public async getCalendarDayForStudent(
    identity: StudentHomeIdentity,
    date: string,
  ): Promise<StudentHomeCalendarDayItem[] | null> {
    const context = await this.findStudentClassContext(identity.userId, identity.schoolId);
    if (!context) return null;

    const dayOfWeek = fromIsoDate(date).getUTCDay();
    const slots = await this.getScheduleSlots(context, [dayOfWeek]);
    return slots.map((slot) => ({
      id: `${slot.id}:${date}`,
      ...(slot.room ? { location: slot.room } : {}),
      subject: slot.subject,
      time: `${slot.startTime} - ${slot.endTime}`,
      title: slot.subject,
      type: 'event' as const,
    }));
  }

  public async getBirthdaysForSchool(
    schoolId: string,
    now: Date,
  ): Promise<StudentHomeBirthday[]> {
    const monthDay = toIsoDate(now).slice(5);
    return this.db
      .select({
        avatarKind: userProfiles.avatarKind,
        avatarValue: userProfiles.avatarValue,
        classLabel: classes.displayName,
        id: userProfiles.id,
        name: userProfiles.displayName,
      })
      .from(classMembers)
      .innerJoin(
        classes,
        and(
          eq(classes.id, classMembers.classId),
          eq(classes.schoolId, classMembers.schoolId),
          eq(classes.academicYearId, classMembers.academicYearId),
        ),
      )
      .innerJoin(userProfiles, eq(userProfiles.id, classMembers.studentId))
      .innerJoin(studentProfiles, eq(studentProfiles.studentId, userProfiles.id))
      .where(
        and(
          eq(classMembers.schoolId, schoolId),
          eq(classMembers.isActive, true),
          sql`to_char(${studentProfiles.dateOfBirth}, 'MM-DD') = ${monthDay}`,
        ),
      )
      .orderBy(asc(classes.displayName), asc(userProfiles.displayName))
      .then((rows) => rows.map((row) => ({
        avatar: row.avatarKind === null || row.avatarValue === null
          ? null
          : { kind: row.avatarKind, value: row.avatarValue },
        classLabel: row.classLabel,
        id: row.id,
        name: row.name,
      })));
  }

  private async findStudentClassContext(userId: string, schoolId?: string): Promise<StudentClassContext | null> {
    const [context] = await this.db
      .select({
        academicYearId: classes.academicYearId,
        classId: classes.id,
        displayName: classes.displayName,
        schoolId: classes.schoolId,
      })
      .from(classMembers)
      .innerJoin(
        classes,
        and(
          eq(classes.id, classMembers.classId),
          eq(classes.academicYearId, classMembers.academicYearId),
          eq(classes.schoolId, classMembers.schoolId),
        ),
      )
      .innerJoin(
        academicYears,
        and(
          eq(academicYears.id, classMembers.academicYearId),
          eq(academicYears.schoolId, classMembers.schoolId),
          eq(academicYears.isCurrent, true),
        ),
      )
      .innerJoin(
        userRoles,
        and(
          eq(userRoles.userId, userId),
          eq(userRoles.schoolId, classMembers.schoolId),
          eq(userRoles.role, 'student'),
          eq(userRoles.isActive, true),
        ),
      )
      .where(and(
        eq(classMembers.studentId, userId),
        eq(classMembers.isActive, true),
        ...(schoolId === undefined ? [] : [eq(classMembers.schoolId, schoolId)]),
      ))
      .limit(1);

    return context ?? null;
  }

  private async getAnnouncements(
    context: StudentClassContext,
    now: Date,
  ): Promise<StudentHomeResponse['announcements']> {
    return this.db
      .select({
        body: classAnnouncements.body,
        category: classAnnouncements.category,
        id: classAnnouncements.id,
        publishedAt: classAnnouncements.publishedAt,
        title: classAnnouncements.title,
      })
      .from(classAnnouncements)
      .where(and(
        eq(classAnnouncements.schoolId, context.schoolId),
        eq(classAnnouncements.classId, context.classId),
        eq(classAnnouncements.isPublished, true),
        lte(classAnnouncements.publishedAt, now),
      ))
      .orderBy(desc(classAnnouncements.publishedAt))
      .limit(5)
      .then((rows) => rows.flatMap((row) => row.publishedAt ? [{
        body: row.body,
        category: row.category,
        id: row.id,
        publishedAt: row.publishedAt.toISOString(),
        title: row.title,
      }] : []));
  }

  private async getExams(
    context: StudentClassContext,
    now: Date,
  ): Promise<StudentHomeResponse['exams']> {
    return this.db
      .select({
        id: classExams.id,
        scheduledOn: classExams.scheduledOn,
        subject: subjects.name,
        title: classExams.title,
      })
      .from(classExams)
      .innerJoin(subjects, eq(subjects.id, classExams.subjectId))
      .where(and(
        eq(classExams.schoolId, context.schoolId),
        eq(classExams.classId, context.classId),
        eq(classExams.isPublished, true),
        gte(classExams.scheduledOn, toIsoDate(now)),
      ))
      .orderBy(asc(classExams.scheduledOn))
      .limit(5)
      .then((rows) => rows.map((row) => ({
        date: row.scheduledOn,
        id: row.id,
        subject: row.subject,
        title: row.title,
      })));
  }

  private async getBirthdaysForClass(
    context: StudentClassContext,
    now: Date,
  ): Promise<StudentHomeResponse['birthdays']> {
    const monthDay = toIsoDate(now).slice(5);
    return this.db
      .select({
        avatarKind: userProfiles.avatarKind,
        avatarValue: userProfiles.avatarValue,
        id: userProfiles.id,
        name: userProfiles.displayName,
      })
      .from(classMembers)
      .innerJoin(userProfiles, eq(userProfiles.id, classMembers.studentId))
      .innerJoin(studentProfiles, eq(studentProfiles.studentId, userProfiles.id))
      .where(and(
        eq(classMembers.schoolId, context.schoolId),
        eq(classMembers.classId, context.classId),
        eq(classMembers.academicYearId, context.academicYearId),
        eq(classMembers.isActive, true),
        sql`to_char(${studentProfiles.dateOfBirth}, 'MM-DD') = ${monthDay}`,
      ))
      .orderBy(asc(userProfiles.displayName))
      .then((rows) => rows.map((row) => ({
        avatar: row.avatarKind === null || row.avatarValue === null
          ? null
          : { kind: row.avatarKind, value: row.avatarValue },
        classLabel: context.displayName,
        id: row.id,
        name: row.name,
      })));
  }

  private async getScheduleSlots(
    context: StudentClassContext,
    dayValues: number[],
  ): Promise<ScheduleSlotRow[]> {
    const dayOfWeek = [...new Set(dayValues)];
    return this.db
      .select({
        dayOfWeek: classScheduleSlots.dayOfWeek,
        endTime: classScheduleSlots.endTime,
        id: classScheduleSlots.id,
        room: classScheduleSlots.room,
        startTime: classScheduleSlots.startTime,
        subject: subjects.name,
        teacherName: userProfiles.displayName,
      })
      .from(classScheduleSlots)
      .innerJoin(subjects, eq(subjects.id, classScheduleSlots.subjectId))
      .leftJoin(
        classSubjects,
        and(
          eq(classSubjects.classId, classScheduleSlots.classId),
          eq(classSubjects.subjectId, classScheduleSlots.subjectId),
        ),
      )
      .leftJoin(userProfiles, eq(userProfiles.id, classSubjects.teacherId))
      .where(and(
        eq(classScheduleSlots.schoolId, context.schoolId),
        eq(classScheduleSlots.classId, context.classId),
        inArray(classScheduleSlots.dayOfWeek, dayOfWeek),
      ))
      .orderBy(asc(classScheduleSlots.startTime));
  }

  private toSchedule(slots: ScheduleSlotRow[], now: Date): StudentHomeResponse['schedule'] {
    const dates = nextWeekDates(now);
    const entries: StudentHomeScheduleEntry[] = dates.flatMap((date) => slots
      .filter((slot) => slot.dayOfWeek === date.getUTCDay())
      .map((slot) => ({
        ...(slot.room ? { room: slot.room } : {}),
        date: toIsoDate(date),
        endTime: slot.endTime,
        id: slot.id,
        startTime: slot.startTime,
        subject: slot.subject,
        teacherName: slot.teacherName ?? 'Unassigned',
      })));
    const today = toIsoDate(now);
    return {
      today: entries.filter((entry) => entry.date === today),
      upcoming: entries.filter((entry) => entry.date !== today),
    };
  }
}
