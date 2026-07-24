import type { StudentClassContextRepository } from '../db/repositories/student-class-context.repository.js';
import { AppError } from '../lib/errors.js';
import type { StudentClassContextResponse, StudentSubjectsResponse } from '../types/class-context.js';

export class StudentClassContextService {
  public constructor(private readonly repository: StudentClassContextRepository) {}

  public async getClassContext(studentId: string, schoolId: string): Promise<StudentClassContextResponse> {
    const context = await this.repository.findClassContext(studentId, schoolId);
    if (!context) throw new AppError('NOT_FOUND', 404, 'No current class membership was found');
    return context;
  }

  public async listSubjects(studentId: string, schoolId: string): Promise<StudentSubjectsResponse> {
    const subjects = await this.repository.findSubjects(studentId, schoolId);
    if (!subjects) throw new AppError('NOT_FOUND', 404, 'No current class membership was found');
    return subjects;
  }
}
