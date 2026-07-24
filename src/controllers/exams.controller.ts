import type { Request, Response } from 'express';

import { AppError } from '../lib/errors.js';
import type { ExamsService } from '../services/exams.service.js';
import {
  assessmentIdParamSchema,
  assessmentListQuerySchema,
  classIdParamSchema,
  confirmUploadSchema,
  createAssessmentSchema,
  createExamGroupSchema,
  emptyBodySchema,
  examGroupListQuerySchema,
  examResourceUploadSchema,
  groupIdParamSchema,
  leaderboardQuerySchema,
  resultListQuerySchema,
  studentIdParamSchema,
  updateAssessmentSchema,
  updateExamGroupSchema,
  upsertResultSchema,
} from '../validators/exams.schemas.js';

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

export interface ExamsController {
  confirmResource(request: Request, response: Response): Promise<void>;
  createAssessment(request: Request, response: Response): Promise<void>;
  createGroup(request: Request, response: Response): Promise<void>;
  createResourceUploadSession(request: Request, response: Response): Promise<void>;
  deleteAssessment(request: Request, response: Response): Promise<void>;
  getAssessmentForTeacher(request: Request, response: Response): Promise<void>;
  deleteGroup(request: Request, response: Response): Promise<void>;
  getAssessmentForStudent(request: Request, response: Response): Promise<void>;
  getGroupForStudent(request: Request, response: Response): Promise<void>;
  getLeaderboard(request: Request, response: Response): Promise<void>;
  listAssessmentsForTeacher(request: Request, response: Response): Promise<void>;
  listGroupsForStudent(request: Request, response: Response): Promise<void>;
  listGroupsForTeacher(request: Request, response: Response): Promise<void>;
  listResults(request: Request, response: Response): Promise<void>;
  listSubmissions(request: Request, response: Response): Promise<void>;
  markSubmission(request: Request, response: Response): Promise<void>;
  remindAll(request: Request, response: Response): Promise<void>;
  remindStudent(request: Request, response: Response): Promise<void>;
  publishAssessment(request: Request, response: Response): Promise<void>;
  publishResults(request: Request, response: Response): Promise<void>;
  updateAssessment(request: Request, response: Response): Promise<void>;
  updateGroup(request: Request, response: Response): Promise<void>;
  upsertResult(request: Request, response: Response): Promise<void>;
}

export function createExamsController(service: ExamsService): ExamsController {
  return {
    async listGroupsForStudent(request, response) {
      response.status(200).json(await service.listGroupsForStudent(
        identity(request, 'student'), examGroupListQuerySchema.parse(request.query),
      ));
    },
    async getGroupForStudent(request, response) {
      response.status(200).json(await service.getGroupForStudent(
        identity(request, 'student'), groupIdParamSchema.parse(request.params).groupId,
      ));
    },
    async getAssessmentForStudent(request, response) {
      response.status(200).json(await service.getAssessmentForStudent(
        identity(request, 'student'), assessmentIdParamSchema.parse(request.params).assessmentId,
      ));
    },
    async getAssessmentForTeacher(request, response) {
      response.status(200).json(await service.getAssessmentForTeacher(
        identity(request, 'teacher'), assessmentIdParamSchema.parse(request.params).assessmentId,
      ));
    },
    async getLeaderboard(request, response) {
      response.status(200).json(await service.getLeaderboard(
        identity(request, 'student'),
        groupIdParamSchema.parse(request.params).groupId,
        leaderboardQuerySchema.parse(request.query),
      ));
    },
    async listGroupsForTeacher(request, response) {
      response.status(200).json(await service.listGroupsForTeacher(
        identity(request, 'teacher'),
        classIdParamSchema.parse(request.params).classId,
        examGroupListQuerySchema.parse(request.query),
      ));
    },
    async createGroup(request, response) {
      response.status(201).json(await service.createGroup(
        identity(request, 'teacher'),
        classIdParamSchema.parse(request.params).classId,
        createExamGroupSchema.parse(request.body),
        idempotencyKey(request),
      ));
    },
    async updateGroup(request, response) {
      response.status(200).json(await service.updateGroup(
        identity(request, 'teacher'),
        groupIdParamSchema.parse(request.params).groupId,
        updateExamGroupSchema.parse(request.body),
        idempotencyKey(request),
      ));
    },
    async deleteGroup(request, response) {
      await service.deleteGroup(identity(request, 'teacher'), groupIdParamSchema.parse(request.params).groupId, idempotencyKey(request));
      response.status(204).send();
    },
    async listAssessmentsForTeacher(request, response) {
      response.status(200).json(await service.listAssessmentsForTeacher(
        identity(request, 'teacher'),
        groupIdParamSchema.parse(request.params).groupId,
        assessmentListQuerySchema.parse(request.query),
      ));
    },
    async createAssessment(request, response) {
      response.status(201).json(await service.createAssessment(
        identity(request, 'teacher'),
        groupIdParamSchema.parse(request.params).groupId,
        createAssessmentSchema.parse(request.body),
        idempotencyKey(request),
      ));
    },
    async updateAssessment(request, response) {
      response.status(200).json(await service.updateAssessment(
        identity(request, 'teacher'),
        assessmentIdParamSchema.parse(request.params).assessmentId,
        updateAssessmentSchema.parse(request.body),
        idempotencyKey(request),
      ));
    },
    async deleteAssessment(request, response) {
      await service.deleteAssessment(identity(request, 'teacher'), assessmentIdParamSchema.parse(request.params).assessmentId, idempotencyKey(request));
      response.status(204).send();
    },
    async listResults(request, response) {
      response.status(200).json(await service.listResults(
        identity(request, 'teacher'),
        assessmentIdParamSchema.parse(request.params).assessmentId,
        resultListQuerySchema.parse(request.query),
      ));
    },
    async listSubmissions(request, response) {
      response.status(200).json(await service.listSubmissions(
        identity(request, 'teacher'),
        assessmentIdParamSchema.parse(request.params).assessmentId,
      ));
    },
    async markSubmission(request, response) {
      const body = emptyBodySchema.parse(request.body);
      response.status(200).json(await service.markSubmission(
        identity(request, 'teacher'),
        assessmentIdParamSchema.parse(request.params).assessmentId,
        studentIdParamSchema.parse(request.params).studentId,
        idempotencyKey(request),
        body,
      ));
    },
    async upsertResult(request, response) {
      response.status(200).json(await service.upsertResult(
        identity(request, 'teacher'),
        assessmentIdParamSchema.parse(request.params).assessmentId,
        studentIdParamSchema.parse(request.params).studentId,
        upsertResultSchema.parse(request.body),
        idempotencyKey(request),
      ));
    },
    async remindStudent(request, response) {
      emptyBodySchema.parse(request.body);
      response.status(202).json(await service.remindStudent(
        identity(request, 'teacher'),
        assessmentIdParamSchema.parse(request.params).assessmentId,
        studentIdParamSchema.parse(request.params).studentId,
        idempotencyKey(request),
      ));
    },
    async remindAll(request, response) {
      emptyBodySchema.parse(request.body);
      response.status(202).json(await service.remindAll(
        identity(request, 'teacher'),
        assessmentIdParamSchema.parse(request.params).assessmentId,
        idempotencyKey(request),
      ));
    },
    async publishAssessment(request, response) {
      const body = emptyBodySchema.parse(request.body);
      response.status(200).json(await service.publishAssessment(
        identity(request, 'teacher'),
        assessmentIdParamSchema.parse(request.params).assessmentId,
        idempotencyKey(request), body,
      ));
    },
    async publishResults(request, response) {
      const body = emptyBodySchema.parse(request.body);
      response.status(200).json(await service.publishResults(
        identity(request, 'teacher'),
        assessmentIdParamSchema.parse(request.params).assessmentId,
        idempotencyKey(request), body,
      ));
    },
    async createResourceUploadSession(request, response) {
      response.status(201).json(await service.createResourceUploadSession(
        identity(request, 'teacher'),
        assessmentIdParamSchema.parse(request.params).assessmentId,
        examResourceUploadSchema.parse(request.body),
        idempotencyKey(request),
      ));
    },
    async confirmResource(request, response) {
      const input = confirmUploadSchema.parse(request.body);
      response.status(201).json(await service.confirmResource(
        identity(request, 'teacher'),
        assessmentIdParamSchema.parse(request.params).assessmentId,
        input.uploadSessionId,
        idempotencyKey(request),
      ));
    },
  };
}
