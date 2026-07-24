import { and, count, eq } from 'drizzle-orm';

import type { Database } from '../client.js';
import {
  academicYears,
  classes,
  classMembers,
  classSubjects,
  subjects,
  userRoles,
} from '../schema/core.js';
import type { TeacherClassSubjectContextResponse } from '../../types/class-context.js';

export interface TeacherClassContextRepository {
  findAssignedClassSubjectContext(
    teacherId: string,
    schoolId: string,
    classId: string,
    subjectId: string,
  ): Promise<TeacherClassSubjectContextResponse | null>;
}

export class DrizzleTeacherClassContextRepository implements TeacherClassContextRepository {
  public constructor(private readonly db: Database) {}

  public async findAssignedClassSubjectContext(
    teacherId: string,
    schoolId: string,
    classId: string,
    subjectId: string,
  ): Promise<TeacherClassSubjectContextResponse | null> {
    const [assignment] = await this.db
      .select({
        academicYearId: classes.academicYearId,
        classId: classes.id,
        className: classes.displayName,
        grade: classes.grade,
        section: classes.section,
        subjectCode: subjects.code,
        subjectId: subjects.id,
        subjectName: subjects.name,
      })
      .from(classSubjects)
      .innerJoin(classes, and(
        eq(classSubjects.classId, classes.id),
        eq(classSubjects.schoolId, classes.schoolId),
      ))
      .innerJoin(subjects, and(
        eq(classSubjects.subjectId, subjects.id),
        eq(subjects.schoolId, classes.schoolId),
      ))
      .innerJoin(academicYears, and(
        eq(classes.academicYearId, academicYears.id),
        eq(academicYears.schoolId, schoolId),
        eq(academicYears.isCurrent, true),
      ))
      .innerJoin(userRoles, and(
        eq(userRoles.userId, classSubjects.teacherId),
        eq(userRoles.schoolId, classes.schoolId),
        eq(userRoles.role, 'teacher'),
        eq(userRoles.isActive, true),
      ))
      .where(and(
        eq(classSubjects.teacherId, teacherId),
        eq(classSubjects.schoolId, schoolId),
        eq(classes.schoolId, schoolId),
        eq(classes.id, classId),
        eq(subjects.id, subjectId),
      ))
      .limit(1);

    if (!assignment) return null;

    const [studentCount] = await this.db
      .select({ value: count() })
      .from(classMembers)
      .where(and(
        eq(classMembers.classId, assignment.classId),
        eq(classMembers.schoolId, schoolId),
        eq(classMembers.academicYearId, assignment.academicYearId),
        eq(classMembers.isActive, true),
      ));

    return {
      class: {
        displayName: assignment.className,
        grade: assignment.grade,
        id: assignment.classId,
        section: assignment.section,
      },
      studentCount: Number(studentCount?.value ?? 0),
      subject: {
        code: assignment.subjectCode,
        id: assignment.subjectId,
        name: assignment.subjectName,
      },
    };
  }
}
