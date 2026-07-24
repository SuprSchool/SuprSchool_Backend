import type { Request, Response } from 'express';
import { z } from 'zod';

import { AppError } from '../lib/errors.js';
import type { TeacherClassesService } from '../services/teacher-classes.service.js';
import type {
  TeacherClassAssignmentsResponse,
  TeacherClassSubjectParams,
  TeacherClassStudentsResponse,
} from '../types/teacher-classes.js';

const classSubjectParamsSchema = z.object({
  classId: z.string().min(1),
  subjectId: z.string().min(1),
});

export interface TeacherClassesController {
  listAssignedClasses(request: Request, response: Response): Promise<void>;
  getAssignedClassStudents(request: Request, response: Response): Promise<void>;
}

function requireTeacherId(request: Request): string {
  if (!request.auth) {
    throw new AppError('UNAUTHORIZED', 401, 'A valid bearer token is required');
  }

  return request.auth.userId;
}

export function createTeacherClassesController(
  service: TeacherClassesService,
): TeacherClassesController {
  return {
    listAssignedClasses: async (
      request: Request,
      response: Response,
    ): Promise<void> => {
      const body: TeacherClassAssignmentsResponse = await service.listAssignedClasses(
        requireTeacherId(request),
      );
      response.status(200).json(body);
    },
    getAssignedClassStudents: async (
      request: Request,
      response: Response,
    ): Promise<void> => {
      const params: TeacherClassSubjectParams = classSubjectParamsSchema.parse(
        request.params,
      );
      const body: TeacherClassStudentsResponse = await service.getAssignedClassStudents(
        requireTeacherId(request),
        params.classId,
        params.subjectId,
      );
      response.status(200).json(body);
    },
  };
}
