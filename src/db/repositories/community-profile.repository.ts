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
  CURRENT_SCHOOL_EVENT_PAGE_SIZE,
  CURRENT_SCHOOL_GALLERY_PAGE_SIZE,
  type CommunityIdentity,
  type SchoolEventSummaryRecord,
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
  phone: string | null;
  rating: string;
  rules: readonly string[];
  rulesIntro: string;
  studentCount: number;
  supportEmail: string | null;
  teacherCount: number;
}

export interface CommunityProfileRepository {
  findCurrentSchool(identity: CommunityIdentity): Promise<SchoolContentRecord | null>;
  findStudentOverview(identity: CommunityIdentity, now: Date): Promise<StudentOverviewRecord | null>;
  findTeacherOverview(identity: CommunityIdentity, now: Date): Promise<TeacherOverviewRecord | null>;
  findVisibleSchoolEvents(
    identity: CommunityIdentity,
  ): Promise<readonly SchoolEventSummaryRecord[]>;
}

interface SchoolEventRow {
  additionalCategoryCount: number | string;
  category: string;
  date: string;
  id: string;
  imageObjectPath: string | null;
  isEligible: boolean | string;
  registeredCount: number | string;
  title: string;
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
        phone: schoolProfiles.phone,
        rating: schoolProfiles.rating,
        rules: schoolProfiles.rules,
        rulesIntro: schoolProfiles.rulesIntro,
        supportEmail: schoolProfiles.supportEmail,
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
      // A school with no profile row, or one that published no contact detail,
      // reports null — the Settings rows hide rather than draw a blank chevron.
      phone: school.phone ?? null,
      rating: school.rating ?? '—',
      rules: school.rules ?? [],
      rulesIntro: school.rulesIntro ?? '',
      studentCount: counts.studentCount,
      supportEmail: school.supportEmail ?? null,
      teacherCount: counts.teacherCount,
    };
  }

  /**
   * The school payload's Events tab (`253:15008`). Visibility is unchanged from
   * the reader this replaced; the card fields are new.
   *
   * That inherited visibility carries a known gap, left in place deliberately
   * rather than widened inside a payload change: for a student the `where`
   * clause admits an event only through an `event_audiences` row, so an event
   * with `audience_type = 'school'` and no audience rows is invisible on this
   * tab even though the student may register for it. `isEligible` below does
   * honour `audience_type = 'school'`, because it mirrors the registration
   * predicate — so the two can disagree for exactly those events. Filed as an
   * open backend-contract row in the client repo (SuprSchool) at
   * docs/parity/SHARED-REQUESTS.md.
   *
   * `isEligible` applies the same predicate `registerStudent` enforces —
   * unarchived, registration still open, and the audience covers the caller —
   * so the chip cannot promise a registration the write path would refuse. A
   * teacher never registers, and the teacher school payload draws no
   * eligibility chip, so teachers read `true`.
   */
  public async findVisibleSchoolEvents(
    identity: CommunityIdentity,
  ): Promise<readonly SchoolEventSummaryRecord[]> {
    const result = await this.db.execute(sql<SchoolEventRow>`
      select
        coalesce(event.category, event.activity_kind) as category,
        to_char(event.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as date,
        event.id,
        event.title,
        banner.object_path as "imageObjectPath",
        coalesce(registration_total.total, 0)::int as "registeredCount",
        (
          case when event.category is not null then 1 else 0 end
          + case when event.participation_mode is not null then 1 else 0 end
        )::int as "additionalCategoryCount",
        (
          ${identity.role}::text = 'teacher'
          or (
            event.archived_at is null
            and (
              event.registration_deadline_at is null
              or event.registration_deadline_at >= now()
            )
            and (
              event.audience_type = 'school'
              or exists (
                select 1
                from public.event_audiences audience
                join public.class_members membership
                  on membership.school_id = audience.school_id
                 and membership.class_id = audience.class_id
                 and membership.student_id = ${identity.userId}::uuid
                 and membership.is_active
                join public.academic_years year
                  on year.id = membership.academic_year_id
                 and year.school_id = membership.school_id
                 and year.is_current
                where audience.event_id = event.id and audience.school_id = event.school_id
              )
            )
          )
        ) as "isEligible"
      from public.events event
      left join lateral (
        select resource.object_path
        from public.event_resources resource
        where resource.event_id = event.id
          and resource.school_id = event.school_id
          and resource.resource_kind = 'banner'
          and resource.confirmed_at is not null
        order by resource.sort_order, resource.created_at, resource.id
        limit 1
      ) banner on true
      left join lateral (
        select count(*)::int as total
        from public.event_registrations registration
        where registration.event_id = event.id
          and registration.school_id = event.school_id
          and registration.cancelled_at is null
      ) registration_total on true
      where event.school_id = ${identity.schoolId}::uuid
        and event.lifecycle = 'published'
        and event.deleted_at is null
        and (
           ${identity.role}::text = 'teacher'
          or exists (
            select 1
            from public.event_audiences audience
            join public.class_members membership
              on membership.school_id = audience.school_id
             and membership.class_id = audience.class_id
             and membership.student_id = ${identity.userId}::uuid
             and membership.is_active
            join public.academic_years year
              on year.id = membership.academic_year_id
             and year.school_id = membership.school_id
             and year.is_current
            where audience.event_id = event.id and audience.school_id = event.school_id
          )
        )
      order by event.starts_at desc, event.id desc
      limit ${CURRENT_SCHOOL_EVENT_PAGE_SIZE}
    `);

    return (result as unknown as readonly SchoolEventRow[]).map((row) => ({
      additionalCategoryCount: Number(row.additionalCategoryCount ?? 0),
      category: row.category,
      date: row.date,
      id: row.id,
      imageObjectPath: row.imageObjectPath ?? null,
      isEligible: readBoolean(row.isEligible),
      registeredCount: Number(row.registeredCount ?? 0),
      title: row.title,
    }));
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

/**
 * Raw `execute` bypasses Drizzle's column decoding, so a boolean can arrive as
 * the driver's own representation. Reading it as `=== true` would silently turn
 * an eligible student into an ineligible one.
 */
function readBoolean(value: boolean | string): boolean {
  return value === true || value === 't' || value === 'true';
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
