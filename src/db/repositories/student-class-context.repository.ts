import { and, asc, eq } from 'drizzle-orm';

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
import type {
  ClassContextClass,
  StudentClassContextResponse,
  StudentSubjectsResponse,
} from '../../types/class-context.js';

interface StudentMembership {
  academicYearId: string;
  class: ClassContextClass;
  schoolId: string;
}

export interface StudentClassContextRepository {
  findClassContext(studentId: string, schoolId: string): Promise<StudentClassContextResponse | null>;
  findSubjects(studentId: string, schoolId: string): Promise<StudentSubjectsResponse | null>;
}

export class DrizzleStudentClassContextRepository implements StudentClassContextRepository {
  public constructor(private readonly db: Database) {}

  public async findClassContext(studentId: string, schoolId: string): Promise<StudentClassContextResponse | null> {
    const membership = await this.findCurrentMembership(studentId, schoolId);
    if (!membership) return null;

    const [students, teachers] = await Promise.all([
      this.db
        .select({
          avatarPath: userProfiles.avatarPath,
          displayName: userProfiles.displayName,
          id: userProfiles.id,
          rollNumber: classMembers.rollNumber,
        })
        .from(classMembers)
        .innerJoin(userProfiles, and(
          eq(classMembers.studentId, userProfiles.id),
          eq(userProfiles.schoolId, membership.schoolId),
        ))
        .where(and(
          eq(classMembers.classId, membership.class.id),
          eq(classMembers.academicYearId, membership.academicYearId),
          eq(classMembers.schoolId, membership.schoolId),
          eq(classMembers.isActive, true),
        ))
        .orderBy(asc(classMembers.rollNumber), asc(userProfiles.displayName)),
      this.db
        .select({
          displayName: userProfiles.displayName,
          id: userProfiles.id,
          subjectId: subjects.id,
          subjectName: subjects.name,
        })
        .from(classSubjects)
        .innerJoin(subjects, and(
          eq(classSubjects.subjectId, subjects.id),
          eq(subjects.schoolId, membership.schoolId),
        ))
        .innerJoin(userProfiles, and(
          eq(classSubjects.teacherId, userProfiles.id),
          eq(userProfiles.schoolId, membership.schoolId),
        ))
        .where(and(
          eq(classSubjects.classId, membership.class.id),
          eq(classSubjects.schoolId, membership.schoolId),
        ))
        .orderBy(asc(subjects.name)),
    ]);

    return { class: membership.class, students, teachers, totalStudents: students.length };
  }

  public async findSubjects(studentId: string, schoolId: string): Promise<StudentSubjectsResponse | null> {
    const membership = await this.findCurrentMembership(studentId, schoolId);
    if (!membership) return null;

    const subjectRows = await this.db
      .select({
        code: subjects.code,
        id: subjects.id,
        name: subjects.name,
        teacherId: userProfiles.id,
        teacherName: userProfiles.displayName,
      })
      .from(classSubjects)
      .innerJoin(subjects, and(
        eq(classSubjects.subjectId, subjects.id),
        eq(subjects.schoolId, membership.schoolId),
      ))
      .leftJoin(userProfiles, and(
        eq(classSubjects.teacherId, userProfiles.id),
        eq(userProfiles.schoolId, membership.schoolId),
      ))
      .where(and(
        eq(classSubjects.classId, membership.class.id),
        eq(classSubjects.schoolId, membership.schoolId),
      ))
      .orderBy(asc(subjects.name));

    return {
      class: membership.class,
      subjects: subjectRows.map((subject) => ({
        code: subject.code,
        id: subject.id,
        name: subject.name,
        teacher: subject.teacherId && subject.teacherName
          ? { displayName: subject.teacherName, id: subject.teacherId }
          : null,
      })),
    };
  }

  private async findCurrentMembership(studentId: string, schoolId: string): Promise<StudentMembership | null> {
    const [membership] = await this.db
      .select({
        academicYearId: classMembers.academicYearId,
        displayName: classes.displayName,
        grade: classes.grade,
        id: classes.id,
        schoolId: classes.schoolId,
        section: classes.section,
      })
      .from(classMembers)
      .innerJoin(classes, and(
        eq(classMembers.classId, classes.id),
        eq(classMembers.schoolId, classes.schoolId),
      ))
      .innerJoin(academicYears, and(
        eq(classMembers.academicYearId, academicYears.id),
        eq(academicYears.schoolId, classes.schoolId),
        eq(academicYears.isCurrent, true),
      ))
      .innerJoin(userRoles, and(
        eq(userRoles.userId, classMembers.studentId),
        eq(userRoles.schoolId, schoolId),
        eq(userRoles.role, 'student'),
        eq(userRoles.isActive, true),
      ))
      .where(and(
        eq(classMembers.studentId, studentId),
        eq(classMembers.schoolId, schoolId),
        eq(classes.schoolId, schoolId),
        eq(classMembers.isActive, true),
      ))
      .limit(1);

    if (!membership) return null;
    return {
      academicYearId: membership.academicYearId,
      class: {
        displayName: membership.displayName,
        grade: membership.grade,
        id: membership.id,
        section: membership.section,
      },
      schoolId: membership.schoolId,
    };
  }
}
