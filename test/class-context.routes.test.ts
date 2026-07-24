import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { errorHandler } from '../src/middleware/error-handler.js';
import { createStudentClassContextRouter } from '../src/routes/student-class-context.routes.js';
import { createTeacherClassContextRouter } from '../src/routes/teacher-class-context.routes.js';
import type { AuthenticationMiddleware } from '../src/middleware/authenticate.js';
import type { StudentClassContextService } from '../src/services/student-class-context.service.js';
import type { TeacherClassContextService } from '../src/services/teacher-class-context.service.js';

function authenticateAs(userId: string, role: 'student' | 'teacher'): AuthenticationMiddleware {
  return async (requestValue: Request, _response: Response, next: NextFunction): Promise<void> => {
    requestValue.auth = { role, schoolId: 'school-1', userId };
    next();
  };
}

describe('class context routes', () => {
  it('returns the authenticated student class context', async () => {
    const service = {
      getClassContext: vi.fn().mockResolvedValue({
        class: { displayName: 'Grade 8 A', grade: '8', id: 'class-1', section: 'A' },
        students: [],
        teachers: [],
        totalStudents: 0,
      }),
      listSubjects: vi.fn(),
    } as unknown as StudentClassContextService;
    const app = express();
    app.use('/student', createStudentClassContextRouter(service, authenticateAs('student-1', 'student')));
    app.use(errorHandler);

    const response = await request(app).get('/student/class-context');
    expect(response.status).toBe(200);
    expect(service.getClassContext).toHaveBeenCalledWith('student-1', 'school-1');
  });

  it('returns a teacher context only for the requested assigned pair', async () => {
    const service = {
      getAssignedClassSubjectContext: vi.fn().mockResolvedValue({
        class: { displayName: 'Grade 8 A', grade: '8', id: 'class-1', section: 'A' },
        studentCount: 28,
        subject: { code: 'MATH', id: 'subject-1', name: 'Mathematics' },
      }),
    } as unknown as TeacherClassContextService;
    const app = express();
    app.use('/teacher', createTeacherClassContextRouter(service, authenticateAs('teacher-1', 'teacher')));
    app.use(errorHandler);

    const response = await request(app).get('/teacher/class-1/subjects/subject-1');
    expect(response.status).toBe(200);
    expect(service.getAssignedClassSubjectContext).toHaveBeenCalledWith(
      'teacher-1', 'school-1', 'class-1', 'subject-1',
    );
  });
});
