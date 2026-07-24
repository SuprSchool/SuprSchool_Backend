import type { Request, Response } from 'express';
import { z } from 'zod';

import { AppError } from '../lib/errors.js';
import type { AuthenticatedRequestIdentity } from '../middleware/authenticate.js';
import type { TeacherClassContextService } from '../services/teacher-class-context.service.js';
import type { TeacherClassSubjectContextResponse, TeacherClassSubjectParams } from '../types/class-context.js';

const classSubjectParamsSchema = z.object({
  classId: z.string().min(1),
  subjectId: z.string().min(1),
});

export interface TeacherClassContextController {
  getAssignedClassSubjectContext(request: Request, response: Response): Promise<void>;
}

function requireTeacherAuth(request: Request): AuthenticatedRequestIdentity {
  if (!request.auth) throw new AppError('UNAUTHORIZED', 401, 'A valid bearer token is required');
  if (request.auth.role !== 'teacher') throw new AppError('FORBIDDEN', 403, 'Only teachers can view assigned class context');
  return request.auth;
}

export function createTeacherClassContextController(service: TeacherClassContextService): TeacherClassContextController {
  return {
    getAssignedClassSubjectContext: async (request: Request, response: Response): Promise<void> => {
      const params: TeacherClassSubjectParams = classSubjectParamsSchema.parse(request.params);
      const auth = requireTeacherAuth(request);
      const body: TeacherClassSubjectContextResponse = await service.getAssignedClassSubjectContext(
        auth.userId,
        auth.schoolId,
        params.classId,
        params.subjectId,
      );
      response.status(200).json(body);
    },
  };
}
