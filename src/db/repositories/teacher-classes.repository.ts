import { and, asc, eq } from 'drizzle-orm';

import type { Database } from '../client.js';
import {
  classes,
  classMembers,
  classSubjects,
  subjects,
  userProfiles,
  userRoles,
} from '../schema/core.js';
import type {
  TeacherClassAssignment,
  TeacherClassStudentsResponse,
} from '../../types/teacher-classes.js';

interface AssignedClassSubject extends TeacherClassAssignment {
  academicYearId: string;
  schoolId: string;
}

export interface TeacherClassesRepository {
  findAssignedClassSubjects(teacherId: string): Promise<TeacherClassAssignment[]>;
  findAssignedClassStudents(
    teacherId: string,
    classId: string,
    subjectId: string,
  ): Promise<TeacherClassStudentsResponse | null>;
}

export class DrizzleTeacherClassesRepository implements TeacherClassesRepository {
  public constructor(private readonly db: Database) {}

  public async findAssignedClassSubjects(
    teacherId: string,
  ): Promise<TeacherClassAssignment[]> {
    const assignments = await this.db
      .select({
        classId: classes.id,
        classSubjectId: classSubjects.id,
        className: classes.displayName,
        grade: classes.grade,
        section: classes.section,
        subjectCode: subjects.code,
        subjectId: subjects.id,
        subjectName: subjects.name,
      })
      .from(classSubjects)
      .innerJoin(
        classes,
        and(
          eq(classSubjects.classId, classes.id),
          eq(classSubjects.schoolId, classes.schoolId),
        ),
      )
      .innerJoin(
        subjects,
        and(
          eq(classSubjects.subjectId, subjects.id),
          eq(subjects.schoolId, classes.schoolId),
        ),
      )
      .innerJoin(
        userProfiles,
        and(
          eq(classSubjects.teacherId, userProfiles.id),
          eq(userProfiles.schoolId, classes.schoolId),
        ),
      )
      .innerJoin(
        userRoles,
        and(
          eq(userRoles.userId, userProfiles.id),
          eq(userRoles.schoolId, classes.schoolId),
          eq(userRoles.role, 'teacher'),
          eq(userRoles.isActive, true),
        ),
      )
      .where(eq(classSubjects.teacherId, teacherId))
      .orderBy(asc(classes.displayName), asc(subjects.name));

    return assignments;
  }

  public async findAssignedClassStudents(
    teacherId: string,
    classId: string,
    subjectId: string,
  ): Promise<TeacherClassStudentsResponse | null> {
    const assignment = await this.findAssignedClassSubject(
      teacherId,
      classId,
      subjectId,
    );
    if (!assignment) {
      return null;
    }

    const students = await this.db
      .select({
        displayName: userProfiles.displayName,
        rollNumber: classMembers.rollNumber,
        studentId: userProfiles.id,
      })
      .from(classMembers)
      .innerJoin(
        userProfiles,
        and(
          eq(classMembers.studentId, userProfiles.id),
          eq(userProfiles.schoolId, assignment.schoolId),
        ),
      )
      .where(
        and(
          eq(classMembers.classId, assignment.classId),
          eq(classMembers.schoolId, assignment.schoolId),
          eq(classMembers.academicYearId, assignment.academicYearId),
          eq(classMembers.isActive, true),
        ),
      )
      .orderBy(asc(classMembers.rollNumber), asc(userProfiles.displayName));

    return {
      classId: assignment.classId,
      students,
      subjectId: assignment.subjectId,
    };
  }

  private async findAssignedClassSubject(
    teacherId: string,
    classId: string,
    subjectId: string,
  ): Promise<AssignedClassSubject | null> {
    const [assignment] = await this.db
      .select({
        academicYearId: classes.academicYearId,
        classId: classes.id,
        classSubjectId: classSubjects.id,
        className: classes.displayName,
        grade: classes.grade,
        schoolId: classes.schoolId,
        section: classes.section,
        subjectCode: subjects.code,
        subjectId: subjects.id,
        subjectName: subjects.name,
      })
      .from(classSubjects)
      .innerJoin(
        classes,
        and(
          eq(classSubjects.classId, classes.id),
          eq(classSubjects.schoolId, classes.schoolId),
        ),
      )
      .innerJoin(
        subjects,
        and(
          eq(classSubjects.subjectId, subjects.id),
          eq(subjects.schoolId, classes.schoolId),
        ),
      )
      .innerJoin(
        userProfiles,
        and(
          eq(classSubjects.teacherId, userProfiles.id),
          eq(userProfiles.schoolId, classes.schoolId),
        ),
      )
      .innerJoin(
        userRoles,
        and(
          eq(userRoles.userId, userProfiles.id),
          eq(userRoles.schoolId, classes.schoolId),
          eq(userRoles.role, 'teacher'),
          eq(userRoles.isActive, true),
        ),
      )
      .where(
        and(
          eq(classSubjects.teacherId, teacherId),
          eq(classes.id, classId),
          eq(subjects.id, subjectId),
        ),
      )
      .limit(1);

    return assignment ?? null;
  }
}
