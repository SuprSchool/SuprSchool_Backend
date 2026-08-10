import type { Request, Response } from 'express';

import { AppError } from '../lib/errors.js';
import type { DiaryService } from '../services/diary.service.js';
import type {
  CreateDiaryInput,
  CursorPageInput,
  TeacherDiaryPageInput,
  UpdateDiaryInput,
} from '../types/diary.js';
import {
  classParamsSchema,
  createDiaryInputSchema,
  diaryPageQuerySchema,
  diaryParamsSchema,
  idempotencyKeySchema,
  subjectParamsSchema,
  teacherDiaryPageQuerySchema,
  updateDiaryInputSchema,
} from '../validators/diary.schemas.js';

export interface DiaryController {
  create(request: Request, response: Response): Promise<void>;
  deleteEntry(request: Request, response: Response): Promise<void>;
  listForStudent(request: Request, response: Response): Promise<void>;
  listForTeacher(request: Request, response: Response): Promise<void>;
  update(request: Request, response: Response): Promise<void>;
}

function identity(request: Request, role: 'student' | 'teacher') {
  if (!request.auth) {
    throw new AppError('UNAUTHORIZED', 401, 'A valid bearer token is required');
  }
  if (request.auth.role !== role) {
    throw new AppError('FORBIDDEN', 403, 'You do not have access to this resource');
  }
  return request.auth;
}

function idempotencyKey(request: Request): string {
  return idempotencyKeySchema.parse(request.get('Idempotency-Key'));
}

export function createDiaryController(service: DiaryService): DiaryController {
  return {
    async create(request: Request, response: Response): Promise<void> {
      const authenticated = identity(request, 'teacher');
      const { classId } = classParamsSchema.parse(request.params);
      const input: CreateDiaryInput = createDiaryInputSchema.parse(request.body);
      const body = await service.create(authenticated.userId, classId, input, idempotencyKey(request));
      response.status(201).json(body);
    },

    async deleteEntry(request: Request, response: Response): Promise<void> {
      const authenticated = identity(request, 'teacher');
      const { diaryId } = diaryParamsSchema.parse(request.params);
      response.status(200).json(await service.deleteEntry(diaryId, {
        schoolId: authenticated.schoolId,
        teacherId: authenticated.userId,
      }));
    },

    async listForStudent(request: Request, response: Response): Promise<void> {
      const authenticated = identity(request, 'student');
      const { subjectId } = subjectParamsSchema.parse(request.params);
      const page: CursorPageInput = diaryPageQuerySchema.parse(request.query);
      response.status(200).json(await service.listForStudent(
        authenticated.userId,
        authenticated.schoolId,
        subjectId,
        page,
      ));
    },

    async listForTeacher(request: Request, response: Response): Promise<void> {
      const authenticated = identity(request, 'teacher');
      const { classId } = classParamsSchema.parse(request.params);
      const page: TeacherDiaryPageInput = teacherDiaryPageQuerySchema.parse(request.query);
      response.status(200).json(await service.listForTeacher(
        authenticated.userId,
        authenticated.schoolId,
        classId,
        page,
      ));
    },

    async update(request: Request, response: Response): Promise<void> {
      const authenticated = identity(request, 'teacher');
      const { diaryId } = diaryParamsSchema.parse(request.params);
      const input: UpdateDiaryInput = updateDiaryInputSchema.parse(request.body);
      const body = await service.update(authenticated.userId, diaryId, input, idempotencyKey(request));
      response.status(200).json(body);
    },
  };
}
