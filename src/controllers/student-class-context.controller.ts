import type { Request, Response } from 'express';

import { AppError } from '../lib/errors.js';
import type { AuthenticatedRequestIdentity } from '../middleware/authenticate.js';
import type { StudentClassContextService } from '../services/student-class-context.service.js';
import type { StudentClassContextResponse, StudentSubjectsResponse } from '../types/class-context.js';

export interface StudentClassContextController {
  getClassContext(request: Request, response: Response): Promise<void>;
  listSubjects(request: Request, response: Response): Promise<void>;
}

function requireStudentAuth(request: Request): AuthenticatedRequestIdentity {
  if (!request.auth) throw new AppError('UNAUTHORIZED', 401, 'A valid bearer token is required');
  if (request.auth.role !== 'student') throw new AppError('FORBIDDEN', 403, 'Only students can view their class context');
  return request.auth;
}

export function createStudentClassContextController(service: StudentClassContextService): StudentClassContextController {
  return {
    getClassContext: async (request: Request, response: Response): Promise<void> => {
      const auth = requireStudentAuth(request);
      const body: StudentClassContextResponse = await service.getClassContext(auth.userId, auth.schoolId);
      response.status(200).json(body);
    },
    listSubjects: async (request: Request, response: Response): Promise<void> => {
      const auth = requireStudentAuth(request);
      const body: StudentSubjectsResponse = await service.listSubjects(auth.userId, auth.schoolId);
      response.status(200).json(body);
    },
  };
}
