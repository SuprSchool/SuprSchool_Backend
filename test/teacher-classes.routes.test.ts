import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { errorHandler } from '../src/middleware/error-handler.js';
import type { AuthenticationMiddleware } from '../src/middleware/authenticate.js';
import type { TeacherClassesService } from '../src/services/teacher-classes.service.js';
import { createTeacherClassesRouter } from '../src/routes/teacher-classes.routes.js';

function createTeacherClassesService(): TeacherClassesService {
  return {
    getAssignedClassStudents: vi.fn(),
    listAssignedClasses: vi.fn(),
  } as unknown as TeacherClassesService;
}

function createTestApp(service: TeacherClassesService) {
  const app = express();
  const authenticate: AuthenticationMiddleware = async (
    request: Request,
    _response: Response,
    next,
  ): Promise<void> => {
    request.auth = { role: 'teacher', schoolId: 'school-1', userId: 'teacher-1' };
    next();
  };
  app.use('/v1/teacher/classes', createTeacherClassesRouter(service, authenticate));
  app.use(errorHandler);
  return app;
}

describe('teacher classes router', () => {
  it('returns the authenticated teacher\'s class subject assignments', async () => {
    const service = createTeacherClassesService();
    vi.mocked(service.listAssignedClasses).mockResolvedValue({
      assignments: [
        {
          classId: 'class-1',
          classSubjectId: 'class-subject-1',
          className: 'Grade 8 A',
          grade: '8',
          section: 'A',
          subjectCode: 'MATH',
          subjectId: 'subject-1',
          subjectName: 'Mathematics',
        },
      ],
    });

    const response = await request(createTestApp(service)).get('/v1/teacher/classes');

    expect(response.status).toBe(200);
    expect(response.body.assignments).toEqual([
      expect.objectContaining({ classId: 'class-1', classSubjectId: 'class-subject-1', subjectId: 'subject-1' }),
    ]);
    expect(service.listAssignedClasses).toHaveBeenCalledWith('teacher-1');
  });

  it('reads enrolled class students only for the requested assigned class subject', async () => {
    const service = createTeacherClassesService();
    vi.mocked(service.getAssignedClassStudents).mockResolvedValue({
      classId: 'class-1',
      subjectId: 'subject-1',
      students: [
        {
          displayName: 'Asha Student',
          rollNumber: '12',
          studentId: 'student-1',
        },
      ],
    });

    const response = await request(createTestApp(service))
      .get('/v1/teacher/classes/class-1/subjects/subject-1/students');

    expect(response.status).toBe(200);
    expect(response.body.students).toEqual([
      expect.objectContaining({ studentId: 'student-1', rollNumber: '12' }),
    ]);
    expect(service.getAssignedClassStudents).toHaveBeenCalledWith(
      'teacher-1',
      'class-1',
      'subject-1',
    );
  });
});
