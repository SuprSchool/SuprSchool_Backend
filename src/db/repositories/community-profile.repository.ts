import { and, asc, desc, eq, lte, sql } from 'drizzle-orm';

import type { Database } from '../client.js';
import { attendanceRecords, attendanceSessions } from '../schema/attendance.js';
import {
  academicYears,
  classes,
  classMembers,
  classSubjects,
  schools,
  userProfiles,
  userRoles,
} from '../schema/core.js';
import { schoolGalleryItems, schoolProfiles } from '../schema/community-school.js';
import { classAnnouncements } from '../schema/student-home.js';
import {
  CURRENT_SCHOOL_GALLERY_PAGE_SIZE,
  type CommunityIdentity,
} from '../../types/community-profile.js';

export interface StudentOverviewRecord {
  announcementCount: number;
  attendance: string;
  classId: string;
  classSection: string;
  id: string;
  rollNumber: string;
  schoolId: string;
  schoolName: string;
  streakDays: number;
}

export interface TeacherOverviewRecord {
  announcementCount: number;
  classTeacher: string;
  diaryEntries: number;
  engages: string;
  id: string;
  schoolId: string;
  schoolName: string;
  testsConducted: number;
  totalAssignments: number;
}

export interface SchoolContentRecord {
  address: string;
  description: readonly string[];
  gallery: readonly {
    altText: string;
    id: string;
    objectPath: string;
  }[];
  id: string;
  logoPath: string | null;
  name: string;
  rating: string;
  rules: readonly string[];
  rulesIntro: string;
  studentCount: number;
  teacherCount: number;
}

export interface CommunityProfileRepository {
  findCurrentSchool(identity: CommunityIdentity): Promise<SchoolContentRecord | null>;
  findStudentOverview(identity: CommunityIdentity, now: Date): Promise<StudentOverviewRecord | null>;
  findTeacherOverview(identity: CommunityIdentity, now: Date): Promise<TeacherOverviewRecord | null>;
}

interface AttendanceRow {
  attendanceDate: string;
  status: 'present' | 'absent' | 'late' | 'excused';
}

export class DrizzleCommunityProfileRepository implements CommunityProfileRepository {
  public constructor(private readonly db: Database) {}

  public async findStudentOverview(
    identity: CommunityIdentity,
    now: Date,
  ): Promise<StudentOverviewRecord | null> {
    const [context] = await this.db
      .select({
        classId: classes.id,
        classSection: classes.displayName,
        id: userProfiles.id,
        rollNumber: classMembers.rollNumber,
        schoolId: schools.id,
        schoolName: schools.name,
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
      .innerJoin(
        academicYears,
        and(
          eq(academicYears.id, classMembers.academicYearId),
          eq(academicYears.schoolId, classMembers.schoolId),
          eq(academicYears.isCurrent, true),
        ),
      )
      .innerJoin(
        userProfiles,
        and(
          eq(userProfiles.id, classMembers.studentId),
          eq(userProfiles.schoolId, classMembers.schoolId),
        ),
      )
      .innerJoin(schools, eq(schools.id, classMembers.schoolId))
      .innerJoin(
        userRoles,
        and(
          eq(userRoles.userId, classMembers.studentId),
          eq(userRoles.schoolId, classMembers.schoolId),
          eq(userRoles.role, 'student'),
          eq(userRoles.isActive, true),
        ),
      )
      .where(
        and(
          eq(classMembers.studentId, identity.userId),
          eq(classMembers.schoolId, identity.schoolId),
          eq(classMembers.isActive, true),
        ),
      )
      .limit(1);

    if (!context) return null;

    const [attendanceRows, announcementCount] = await Promise.all([
      this.getAttendance(context.classId, context.schoolId, identity.userId),
      this.getAnnouncementCount(context.classId, context.schoolId, now),
    ]);
    const attendance = summarizeAttendance(attendanceRows);

    return {
      announcementCount,
      attendance: attendance.percentage,
      classId: context.classId,
      classSection: context.classSection,
      id: context.id,
      rollNumber: context.rollNumber ?? '—',
      schoolId: context.schoolId,
      schoolName: context.schoolName,
      streakDays: attendance.streakDays,
    };
  }

  public async findTeacherOverview(
    identity: CommunityIdentity,
    now: Date,
  ): Promise<TeacherOverviewRecord | null> {
    const [teacher] = await this.db
      .select({
        id: userProfiles.id,
        schoolId: schools.id,
        schoolName: schools.name,
      })
      .from(userProfiles)
      .innerJoin(schools, eq(schools.id, userProfiles.schoolId))
      .innerJoin(
        userRoles,
        and(
          eq(userRoles.userId, userProfiles.id),
          eq(userRoles.schoolId, userProfiles.schoolId),
          eq(userRoles.role, 'teacher'),
          eq(userRoles.isActive, true),
        ),
      )
      .where(
        and(
          eq(userProfiles.id, identity.userId),
          eq(userProfiles.schoolId, identity.schoolId),
        ),
      )
      .limit(1);
    if (!teacher) return null;

    const assignments = await this.db
      .select({ classSection: classes.displayName })
      .from(classSubjects)
      .innerJoin(
        classes,
        and(
          eq(classes.id, classSubjects.classId),
          eq(classes.schoolId, classSubjects.schoolId),
        ),
      )
      .innerJoin(
        academicYears,
        and(
          eq(academicYears.id, classes.academicYearId),
          eq(academicYears.schoolId, classes.schoolId),
          eq(academicYears.isCurrent, true),
        ),
      )
      .where(
        and(
          eq(classSubjects.teacherId, identity.userId),
          eq(classSubjects.schoolId, identity.schoolId),
        ),
      )
      .orderBy(asc(classes.displayName));
    const classSections = [...new Set(assignments.map((assignment) => assignment.classSection))];
    const announcementCount = await this.getTeacherAnnouncementCount(
      identity.schoolId,
      identity.userId,
      now,
    );

    return {
      announcementCount,
      classTeacher: classSections[0] ?? '—',
      // Phase 2 owns diary, assignment, and assessment-result persistence.
      // Their absent summaries are represented as zero until its adapter is wired.
      diaryEntries: 0,
      engages: classSections.slice(1).join(', '),
      id: teacher.id,
      schoolId: teacher.schoolId,
      schoolName: teacher.schoolName,
      testsConducted: 0,
      totalAssignments: 0,
    };
  }

  public async findCurrentSchool(identity: CommunityIdentity): Promise<SchoolContentRecord | null> {
    const [school] = await this.db
      .select({
        address: schoolProfiles.address,
        description: schoolProfiles.description,
        id: schools.id,
        logoPath: schoolProfiles.logoPath,
        name: schools.name,
        rating: schoolProfiles.rating,
        rules: schoolProfiles.rules,
        rulesIntro: schoolProfiles.rulesIntro,
      })
      .from(schools)
      .innerJoin(
        userProfiles,
        and(
          eq(userProfiles.id, identity.userId),
          eq(userProfiles.schoolId, schools.id),
        ),
      )
      .leftJoin(schoolProfiles, eq(schoolProfiles.schoolId, schools.id))
      .where(eq(schools.id, identity.schoolId))
      .limit(1);
    if (!school) return null;

    const [counts, gallery] = await Promise.all([
      this.getSchoolRoleCounts(identity.schoolId),
      this.db
        .select({
          altText: schoolGalleryItems.altText,
          id: schoolGalleryItems.id,
          objectPath: schoolGalleryItems.objectPath,
        })
        .from(schoolGalleryItems)
        .where(
          and(
            eq(schoolGalleryItems.schoolId, identity.schoolId),
            eq(schoolGalleryItems.isPublished, true),
          ),
        )
        // The stable first page bounds private-object signing work. sort_order
        // is unique per school; id keeps the cursor order explicit if that
        // constraint ever changes.
        .orderBy(asc(schoolGalleryItems.sortOrder), asc(schoolGalleryItems.id))
        .limit(CURRENT_SCHOOL_GALLERY_PAGE_SIZE),
    ]);

    return {
      address: school.address ?? '',
      description: school.description ?? [],
      gallery,
      id: school.id,
      logoPath: school.logoPath,
      name: school.name,
      rating: school.rating ?? '—',
      rules: school.rules ?? [],
      rulesIntro: school.rulesIntro ?? '',
      studentCount: counts.studentCount,
      teacherCount: counts.teacherCount,
    };
  }

  private async getAttendance(
    classId: string,
    schoolId: string,
    studentId: string,
  ): Promise<readonly AttendanceRow[]> {
    return this.db
      .select({
        attendanceDate: attendanceSessions.attendanceDate,
        status: attendanceRecords.status,
      })
      .from(attendanceRecords)
      .innerJoin(
        attendanceSessions,
        and(
          eq(attendanceSessions.id, attendanceRecords.sessionId),
          eq(attendanceSessions.classId, classId),
          eq(attendanceSessions.schoolId, schoolId),
        ),
      )
      .where(eq(attendanceRecords.studentId, studentId))
      .orderBy(desc(attendanceSessions.attendanceDate), desc(attendanceRecords.id))
      .limit(365);
  }

  private async getAnnouncementCount(classId: string, schoolId: string, now: Date): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(classAnnouncements)
      .where(
        and(
          eq(classAnnouncements.schoolId, schoolId),
          eq(classAnnouncements.classId, classId),
          eq(classAnnouncements.isPublished, true),
          lte(classAnnouncements.publishedAt, now),
        ),
      );
    return Number(row?.count ?? 0);
  }

  private async getTeacherAnnouncementCount(
    schoolId: string,
    teacherId: string,
    now: Date,
  ): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(classAnnouncements)
      .where(
        and(
          eq(classAnnouncements.schoolId, schoolId),
          eq(classAnnouncements.isPublished, true),
          lte(classAnnouncements.publishedAt, now),
          sql`exists (
            select 1
            from public.class_subjects as assignment
            join public.classes as assigned_class
              on assigned_class.id = assignment.class_id
             and assigned_class.school_id = assignment.school_id
            join public.academic_years as academic_year
              on academic_year.id = assigned_class.academic_year_id
             and academic_year.school_id = assigned_class.school_id
             and academic_year.is_current = true
            where assignment.school_id = ${schoolId}::uuid
              and assignment.class_id = ${classAnnouncements.classId}
              and assignment.teacher_id = ${teacherId}::uuid
          )`,
        ),
      );
    return Number(row?.count ?? 0);
  }

  private async getSchoolRoleCounts(schoolId: string): Promise<{
    studentCount: number;
    teacherCount: number;
  }> {
    const [row] = await this.db
      .select({
        studentCount: sql<number>`count(*) filter (where ${userRoles.role} = 'student')::int`,
        teacherCount: sql<number>`count(*) filter (where ${userRoles.role} = 'teacher')::int`,
      })
      .from(userRoles)
      .where(
        and(
          eq(userRoles.schoolId, schoolId),
          eq(userRoles.isActive, true),
        ),
      );
    return {
      studentCount: Number(row?.studentCount ?? 0),
      teacherCount: Number(row?.teacherCount ?? 0),
    };
  }
}

function summarizeAttendance(rows: readonly AttendanceRow[]): {
  percentage: string;
  streakDays: number;
} {
  if (rows.length === 0) return { percentage: '—', streakDays: 0 };

  const attended = rows.filter((row) => row.status === 'present' || row.status === 'late').length;
  let streakDays = 0;
  for (const row of rows) {
    if (row.status !== 'present' && row.status !== 'late') break;
    streakDays += 1;
  }
  return {
    percentage: formatPercentage((attended / rows.length) * 100),
    streakDays,
  };
}

function formatPercentage(value: number): string {
  return `${Number(value.toFixed(1))}%`;
}
