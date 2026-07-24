import type { TeacherClassesRepository } from '../db/repositories/teacher-classes.repository.js';
import { AppError } from '../lib/errors.js';
import type {
  TeacherClassAssignmentsResponse,
  TeacherClassStudentsResponse,
} from '../types/teacher-classes.js';

export class TeacherClassesService {
  public constructor(private readonly repository: TeacherClassesRepository) {}

  public async listAssignedClasses(
    teacherId: string,
  ): Promise<TeacherClassAssignmentsResponse> {
    const assignments = await this.repository.findAssignedClassSubjects(teacherId);
    return { assignments };
  }

  public async getAssignedClassStudents(
    teacherId: string,
    classId: string,
    subjectId: string,
  ): Promise<TeacherClassStudentsResponse> {
    const classStudents = await this.repository.findAssignedClassStudents(
      teacherId,
      classId,
      subjectId,
    );
    if (!classStudents) {
      throw new AppError('FORBIDDEN', 403, 'You are not assigned to this class subject');
    }

    return classStudents;
  }
}
