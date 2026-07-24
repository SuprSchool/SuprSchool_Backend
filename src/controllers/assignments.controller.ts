import type { Request, Response } from 'express';

import { AppError } from '../lib/errors.js';
import type { AssignmentsService } from '../services/assignments.service.js';
import {
  assignmentIdParamSchema,
  assignmentResourceParamsSchema,
  assignmentResourceUploadSchema,
  classIdParamSchema,
  confirmUploadSchema,
  createAssignmentSchema,
  emptyBodySchema,
  gradeSubmissionSchema,
  studentAssignmentListQuerySchema,
  studentIdParamSchema,
  submissionIdParamSchema,
  submissionListQuerySchema,
  submissionUploadSchema,
  teacherAssignmentListQuerySchema,
  updateAssignmentSchema,
} from '../validators/assignments.schemas.js';

function identity(request: Request, role: 'student' | 'teacher') {
  if (request.auth === undefined) {
    throw new AppError('UNAUTHORIZED', 401, 'A valid bearer token is required');
  }
  if (request.auth.role !== role) {
    throw new AppError('FORBIDDEN', 403, 'You do not have access to this resource');
  }
  return { schoolId: request.auth.schoolId, userId: request.auth.userId };
}

function idempotencyKey(request: Request): string {
  const value = request.header('idempotency-key');
  if (value === undefined || !/^[\x21-\x7e]{1,255}$/.test(value)) {
    throw new AppError('VALIDATION_ERROR', 400, 'A valid Idempotency-Key header is required');
  }
  return value;
}

export interface AssignmentsController {
  confirmResource(request: Request, response: Response): Promise<void>;
  confirmSubmission(request: Request, response: Response): Promise<void>;
  create(request: Request, response: Response): Promise<void>;
  createResourceUploadSession(request: Request, response: Response): Promise<void>;
  createSubmissionUploadSession(request: Request, response: Response): Promise<void>;
  delete(request: Request, response: Response): Promise<void>;
  deleteResource(request: Request, response: Response): Promise<void>;
  getForStudent(request: Request, response: Response): Promise<void>;
  getForTeacher(request: Request, response: Response): Promise<void>;
  grade(request: Request, response: Response): Promise<void>;
  listForStudent(request: Request, response: Response): Promise<void>;
  listForTeacher(request: Request, response: Response): Promise<void>;
  listSubmissions(request: Request, response: Response): Promise<void>;
  remindAll(request: Request, response: Response): Promise<void>;
  remindStudent(request: Request, response: Response): Promise<void>;
  update(request: Request, response: Response): Promise<void>;
}

export function createAssignmentsController(service: AssignmentsService): AssignmentsController {
  return {
    async listForStudent(request, response) {
      response.status(200).json(await service.listForStudent(
        identity(request, 'student'),
        studentAssignmentListQuerySchema.parse(request.query),
      ));
    },

    async getForStudent(request, response) {
      response.status(200).json(await service.getForStudent(
        identity(request, 'student'),
        assignmentIdParamSchema.parse(request.params).assignmentId,
      ));
    },

    async createSubmissionUploadSession(request, response) {
      response.status(201).json(await service.createSubmissionUploadSession(
        identity(request, 'student'),
        assignmentIdParamSchema.parse(request.params).assignmentId,
        submissionUploadSchema.parse(request.body),
        idempotencyKey(request),
      ));
    },

    async confirmSubmission(request, response) {
      const input = confirmUploadSchema.parse(request.body);
      response.status(201).json(await service.confirmSubmission(
        identity(request, 'student'),
        assignmentIdParamSchema.parse(request.params).assignmentId,
        input.uploadSessionId,
        idempotencyKey(request),
      ));
    },

    async listForTeacher(request, response) {
      response.status(200).json(await service.listForTeacher(
        identity(request, 'teacher'),
        classIdParamSchema.parse(request.params).classId,
        teacherAssignmentListQuerySchema.parse(request.query),
      ));
    },

    async create(request, response) {
      response.status(201).json(await service.create(
        identity(request, 'teacher'),
        classIdParamSchema.parse(request.params).classId,
        createAssignmentSchema.parse(request.body),
        idempotencyKey(request),
      ));
    },

    async getForTeacher(request, response) {
      response.status(200).json(await service.getForTeacher(
        identity(request, 'teacher'),
        assignmentIdParamSchema.parse(request.params).assignmentId,
      ));
    },

    async update(request, response) {
      response.status(200).json(await service.update(
        identity(request, 'teacher'),
        assignmentIdParamSchema.parse(request.params).assignmentId,
        updateAssignmentSchema.parse(request.body),
        idempotencyKey(request),
      ));
    },

    async delete(request, response) {
      await service.delete(
        identity(request, 'teacher'),
        assignmentIdParamSchema.parse(request.params).assignmentId,
        idempotencyKey(request),
      );
      response.status(204).send();
    },

    async deleteResource(request, response) {
      const params = assignmentResourceParamsSchema.parse(request.params);
      await service.deleteResource(
        identity(request, 'teacher'),
        params.assignmentId,
        params.resourceId,
        idempotencyKey(request),
      );
      response.status(204).send();
    },

    async listSubmissions(request, response) {
      response.status(200).json(await service.listSubmissions(
        identity(request, 'teacher'),
        assignmentIdParamSchema.parse(request.params).assignmentId,
        submissionListQuerySchema.parse(request.query),
      ));
    },

    async grade(request, response) {
      response.status(200).json(await service.grade(
        identity(request, 'teacher'),
        submissionIdParamSchema.parse(request.params).submissionId,
        gradeSubmissionSchema.parse(request.body),
        idempotencyKey(request),
      ));
    },

    async remindStudent(request, response) {
      emptyBodySchema.parse(request.body);
      response.status(202).json(await service.remindStudent(
        identity(request, 'teacher'),
        assignmentIdParamSchema.parse(request.params).assignmentId,
        studentIdParamSchema.parse(request.params).studentId,
        idempotencyKey(request),
      ));
    },

    async remindAll(request, response) {
      emptyBodySchema.parse(request.body);
      response.status(202).json(await service.remindAll(
        identity(request, 'teacher'),
        assignmentIdParamSchema.parse(request.params).assignmentId,
        idempotencyKey(request),
      ));
    },

    async createResourceUploadSession(request, response) {
      response.status(201).json(await service.createResourceUploadSession(
        identity(request, 'teacher'),
        assignmentIdParamSchema.parse(request.params).assignmentId,
        assignmentResourceUploadSchema.parse(request.body),
        idempotencyKey(request),
      ));
    },

    async confirmResource(request, response) {
      const input = confirmUploadSchema.parse(request.body);
      response.status(201).json(await service.confirmResource(
        identity(request, 'teacher'),
        assignmentIdParamSchema.parse(request.params).assignmentId,
        input.uploadSessionId,
        idempotencyKey(request),
      ));
    },
  };
}
