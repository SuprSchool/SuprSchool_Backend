import type { TeacherClassContextRepository } from '../db/repositories/teacher-class-context.repository.js';
import { AppError } from '../lib/errors.js';
import type { TeacherClassSubjectContextResponse } from '../types/class-context.js';

export class TeacherClassContextService {
  public constructor(private readonly repository: TeacherClassContextRepository) {}

  public async getAssignedClassSubjectContext(
    teacherId: string,
    schoolId: string,
    classId: string,
    subjectId: string,
  ): Promise<TeacherClassSubjectContextResponse> {
    const context = await this.repository.findAssignedClassSubjectContext(
      teacherId,
      schoolId,
      classId,
      subjectId,
    );
    if (!context) throw new AppError('FORBIDDEN', 403, 'You are not assigned to this class subject');
    return context;
  }
}
