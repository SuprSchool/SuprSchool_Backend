import { and, asc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { Database } from '../client.js';
import {
  classes,
  classMembers,
  classSubjects,
  profileInterests,
  schoolDirectoryEntries,
  schoolDirectoryTeacherAssignments,
  schools,
  subjects,
  userProfiles,
  userRoles,
} from '../schema/core.js';
import type { AppIdentity, ClaimableRole, OnboardingRoute, SignupProfilePreview } from '../../types/auth.js';
import type { ProfileInterest } from '../../types/profile.js';

export interface SchoolDirectoryEntry {
  id: string;
  schoolId: string;
  role: ClaimableRole;
  displayName: string;
  phoneE164: string;
  studentClassId: string | null;
}

export interface SchoolDirectoryRepository {
  findByPhone(phoneE164: string): Promise<SchoolDirectoryEntry | null>;
  findSignupProfileByPhone(phoneE164: string): Promise<SignupProfilePreview | null>;
  findIdentityByPhone(phoneE164: string): Promise<AppIdentity | null>;
  linkAuthenticatedUser(
    entryId: string,
    userId: string,
    initialInterests?: readonly ProfileInterest[],
  ): Promise<AppIdentity | null>;
  findIdentityByUser(userId: string): Promise<AppIdentity | null>;
}

function asClaimableRole(role: string): ClaimableRole | null {
  return role === 'student' || role === 'teacher' ? role : null;
}

function onboardingRoute(role: ClaimableRole): OnboardingRoute {
  return role === 'student' ? '/student/onboarding' : '/teacher/onboarding';
}

function toSchoolDirectoryEntry(
  row: typeof schoolDirectoryEntries.$inferSelect,
): SchoolDirectoryEntry | null {
  const role = asClaimableRole(row.role);
  if (!role) {
    return null;
  }

  return {
    id: row.id,
    schoolId: row.schoolId,
    role,
    displayName: row.displayName,
    phoneE164: row.phoneE164,
    studentClassId: row.studentClassId,
  };
}

function toAppIdentity(input: {
  userId: string;
  schoolId: string;
  role: ClaimableRole;
  displayName: string;
  phoneE164: string;
}): AppIdentity {
  return { ...input, nextOnboardingRoute: onboardingRoute(input.role) };
}

export interface SignupProfileRow {
  displayName: string;
  employeeCode: string | null;
  phoneE164: string;
  role: string;
  rollNumber: string | null;
  schoolName: string;
  studentClassName: string | null;
  studentGrade: string | null;
  studentSection: string | null;
  subjectName: string | null;
  teacherClassName: string | null;
}

export function mapSignupProfileRows(rows: readonly SignupProfileRow[]): SignupProfilePreview | null {
  const row = rows[0];
  if (!row) return null;
  const role = asClaimableRole(row.role);
  if (!role) return null;

  const base = {
    displayName: row.displayName,
    phoneE164: row.phoneE164,
    schoolName: row.schoolName,
  };

  if (role === 'student') {
    return {
      ...base,
      className: row.studentClassName,
      grade: row.studentGrade,
      role,
      rollNumber: row.rollNumber,
      section: row.studentSection,
    };
  }

  const classNames = Array.from(new Set(
    rows.flatMap(({ teacherClassName }) => teacherClassName ? [teacherClassName] : []),
  ));
  const subjectNames = Array.from(new Set(
    rows.flatMap(({ subjectName }) => subjectName ? [subjectName] : []),
  ));

  return {
    ...base,
    classTeacher: classNames.length ? classNames.join(', ') : null,
    employeeCode: row.employeeCode,
    role,
    subjects: subjectNames,
  };
}

export class DrizzleSchoolDirectoryRepository implements SchoolDirectoryRepository {
  public constructor(private readonly db: Database) {}

  public async findByPhone(phoneE164: string): Promise<SchoolDirectoryEntry | null> {
    const [row] = await this.db
      .select()
      .from(schoolDirectoryEntries)
      .where(
        and(
          eq(schoolDirectoryEntries.phoneE164, phoneE164),
          eq(schoolDirectoryEntries.status, 'unclaimed'),
        ),
      )
      .limit(1);

    return row ? toSchoolDirectoryEntry(row) : null;
  }

  public async findSignupProfileByPhone(phoneE164: string): Promise<SignupProfilePreview | null> {
    const teacherClasses = alias(classes, 'signup_preview_teacher_classes');
    const rows = await this.db
      .select({
        displayName: schoolDirectoryEntries.displayName,
        employeeCode: schoolDirectoryEntries.employeeCode,
        phoneE164: schoolDirectoryEntries.phoneE164,
        role: schoolDirectoryEntries.role,
        rollNumber: schoolDirectoryEntries.rollNumber,
        schoolName: schools.name,
        studentClassName: classes.displayName,
        studentGrade: classes.grade,
        studentSection: classes.section,
        subjectName: subjects.name,
        teacherClassName: teacherClasses.displayName,
      })
      .from(schoolDirectoryEntries)
      .innerJoin(schools, eq(schools.id, schoolDirectoryEntries.schoolId))
      .leftJoin(classes, eq(classes.id, schoolDirectoryEntries.studentClassId))
      .leftJoin(
        schoolDirectoryTeacherAssignments,
        eq(
          schoolDirectoryTeacherAssignments.schoolDirectoryEntryId,
          schoolDirectoryEntries.id,
        ),
      )
      .leftJoin(teacherClasses, eq(teacherClasses.id, schoolDirectoryTeacherAssignments.classId))
      .leftJoin(subjects, eq(subjects.id, schoolDirectoryTeacherAssignments.subjectId))
      .where(
        and(
          eq(schoolDirectoryEntries.phoneE164, phoneE164),
          eq(schoolDirectoryEntries.status, 'unclaimed'),
        ),
      )
      .orderBy(asc(teacherClasses.displayName), asc(subjects.name));

    return mapSignupProfileRows(rows);
  }

  public async linkAuthenticatedUser(
    entryId: string,
    userId: string,
    initialInterests?: readonly ProfileInterest[],
  ): Promise<AppIdentity | null> {
    return this.db.transaction(async (transaction) => {
      const [directoryEntry] = await transaction
        .update(schoolDirectoryEntries)
        .set({
          claimedAt: new Date(),
          claimedByUserId: userId,
          status: 'claimed',
        })
        .where(
          and(
            eq(schoolDirectoryEntries.id, entryId),
            eq(schoolDirectoryEntries.status, 'unclaimed'),
          ),
        )
        .returning();

      if (!directoryEntry) {
        return null;
      }

      const role = asClaimableRole(directoryEntry.role);
      if (!role) {
        return null;
      }

      await transaction.insert(userProfiles).values({
        id: userId,
        displayName: directoryEntry.displayName,
        phoneE164: directoryEntry.phoneE164,
        schoolId: directoryEntry.schoolId,
      });
      if (initialInterests?.length) {
        await transaction.insert(profileInterests).values(
          initialInterests.map((interest) => ({ interest, userId })),
        );
      }
      await transaction.insert(userRoles).values({
        userId,
        schoolId: directoryEntry.schoolId,
        role,
      });

      if (role === 'student' && directoryEntry.studentClassId) {
        const [studentClass] = await transaction
          .select({ academicYearId: classes.academicYearId })
          .from(classes)
          .where(eq(classes.id, directoryEntry.studentClassId))
          .limit(1);

        if (!studentClass) {
          throw new Error('School directory student class does not exist');
        }

        await transaction.insert(classMembers).values({
          academicYearId: studentClass.academicYearId,
          classId: directoryEntry.studentClassId,
          isActive: true,
          rollNumber: directoryEntry.rollNumber,
          schoolId: directoryEntry.schoolId,
          studentId: userId,
        });
      }

      if (role === 'teacher') {
        const assignments = await transaction
          .select({
            classId: schoolDirectoryTeacherAssignments.classId,
            subjectId: schoolDirectoryTeacherAssignments.subjectId,
          })
          .from(schoolDirectoryTeacherAssignments)
          .where(
            eq(
              schoolDirectoryTeacherAssignments.schoolDirectoryEntryId,
              directoryEntry.id,
            ),
          );

        for (const assignment of assignments) {
          await transaction
            .insert(classSubjects)
            .values({
              classId: assignment.classId,
              schoolId: directoryEntry.schoolId,
              subjectId: assignment.subjectId,
              teacherId: userId,
            })
            .onConflictDoUpdate({
              target: [classSubjects.classId, classSubjects.subjectId],
              set: { teacherId: userId },
            });
        }
      }

      return toAppIdentity({
        userId,
        schoolId: directoryEntry.schoolId,
        role,
        displayName: directoryEntry.displayName,
        phoneE164: directoryEntry.phoneE164,
      });
    });
  }

  public async findIdentityByPhone(phoneE164: string): Promise<AppIdentity | null> {
    const [row] = await this.db
      .select({
        displayName: userProfiles.displayName,
        phoneE164: userProfiles.phoneE164,
        role: userRoles.role,
        schoolId: userRoles.schoolId,
        userId: userRoles.userId,
      })
      .from(userProfiles)
      .innerJoin(userRoles, eq(userRoles.userId, userProfiles.id))
      .where(and(eq(userProfiles.phoneE164, phoneE164), eq(userRoles.isActive, true)))
      .limit(1);

    if (!row) return null;
    const role = asClaimableRole(row.role);
    return role ? toAppIdentity({ ...row, role }) : null;
  }

  public async findIdentityByUser(userId: string): Promise<AppIdentity | null> {
    const [row] = await this.db
      .select({
        displayName: userProfiles.displayName,
        phoneE164: userProfiles.phoneE164,
        role: userRoles.role,
        schoolId: userRoles.schoolId,
        userId: userRoles.userId,
      })
      .from(userRoles)
      .innerJoin(userProfiles, eq(userProfiles.id, userRoles.userId))
      .where(and(eq(userRoles.userId, userId), eq(userRoles.isActive, true)))
      .limit(1);

    if (!row) {
      return null;
    }

    const role = asClaimableRole(row.role);
    if (!role) {
      return null;
    }

    return toAppIdentity({
      userId: row.userId,
      schoolId: row.schoolId,
      role,
      displayName: row.displayName,
      phoneE164: row.phoneE164,
    });
  }
}
