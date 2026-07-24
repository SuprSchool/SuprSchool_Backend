import type { Request, Response } from 'express';
import { z } from 'zod';

import { AppError } from '../lib/errors.js';
import type { AnnouncementsService } from '../services/announcements.service.js';
import {
  announcementIdParamSchema,
  announcementListQuerySchema,
  announcementResourceParamsSchema,
  announcementResourceUploadSchema,
  confirmAnnouncementResourceSchema,
  createAnnouncementSchema,
  teacherAnnouncementListQuerySchema,
  updateAnnouncementSchema,
} from '../validators/announcements.schemas.js';

const emptyBodySchema = z.object({}).strict();

function identity(request: Request, role: 'student' | 'teacher') {
  if (!request.auth) {
    throw new AppError('UNAUTHORIZED', 401, 'A valid bearer token is required');
  }
  if (request.auth.role !== role) {
    throw new AppError('FORBIDDEN', 403, 'You do not have access to this resource');
  }
  return { schoolId: request.auth.schoolId, userId: request.auth.userId };
}

function announcementId(request: Request): string {
  return announcementIdParamSchema.parse(request.params).announcementId;
}

function idempotencyKey(request: Request): string {
  const value = request.header('idempotency-key');
  if (value === undefined || !/^[\x21-\x7e]{1,255}$/.test(value)) {
    throw new AppError('VALIDATION_ERROR', 400, 'A valid Idempotency-Key header is required');
  }
  return value;
}

export interface AnnouncementsController {
  confirmResource(request: Request, response: Response): Promise<void>;
  create(request: Request, response: Response): Promise<void>;
  createResourceUploadSession(request: Request, response: Response): Promise<void>;
  delete(request: Request, response: Response): Promise<void>;
  deleteResource(request: Request, response: Response): Promise<void>;
  getForStudent(request: Request, response: Response): Promise<void>;
  getForTeacher(request: Request, response: Response): Promise<void>;
  listForStudent(request: Request, response: Response): Promise<void>;
  listForTeacher(request: Request, response: Response): Promise<void>;
  publish(request: Request, response: Response): Promise<void>;
  update(request: Request, response: Response): Promise<void>;
}

export function createAnnouncementsController(service: AnnouncementsService): AnnouncementsController {
  return {
    async listForStudent(request, response) {
      const query = announcementListQuerySchema.parse(request.query);
      response.status(200).json(await service.listForStudent(identity(request, 'student'), query));
    },

    async getForStudent(request, response) {
      response.status(200).json(await service.getForStudent(
        identity(request, 'student'),
        announcementId(request),
      ));
    },

    async getForTeacher(request, response) {
      response.status(200).json(await service.getForTeacher(
        identity(request, 'teacher'),
        announcementId(request),
      ));
    },

    async listForTeacher(request, response) {
      const query = teacherAnnouncementListQuerySchema.parse(request.query);
      response.status(200).json(await service.listForTeacher(identity(request, 'teacher'), query));
    },

    async create(request, response) {
      const input = createAnnouncementSchema.parse(request.body);
      response.status(201).json(await service.create(
        identity(request, 'teacher'),
        input,
        idempotencyKey(request),
      ));
    },

    async delete(request, response) {
      await service.delete(
        identity(request, 'teacher'),
        announcementId(request),
        idempotencyKey(request),
      );
      response.status(204).send();
    },

    async deleteResource(request, response) {
      const params = announcementResourceParamsSchema.parse(request.params);
      await service.deleteResource(
        identity(request, 'teacher'),
        params.announcementId,
        params.resourceId,
        idempotencyKey(request),
      );
      response.status(204).send();
    },

    async update(request, response) {
      const input = updateAnnouncementSchema.parse(request.body);
      response.status(200).json(await service.update(
        identity(request, 'teacher'),
        announcementId(request),
        input,
        idempotencyKey(request),
      ));
    },

    async publish(request, response) {
      const body = emptyBodySchema.parse(request.body);
      response.status(200).json(await service.publish(
        identity(request, 'teacher'),
        announcementId(request),
        idempotencyKey(request),
        body,
      ));
    },

    async createResourceUploadSession(request, response) {
      const input = announcementResourceUploadSchema.parse(request.body);
      response.status(201).json(await service.createResourceUploadSession(
        identity(request, 'teacher'),
        announcementId(request),
        input,
        idempotencyKey(request),
      ));
    },

    async confirmResource(request, response) {
      const input = confirmAnnouncementResourceSchema.parse(request.body);
      response.status(201).json(await service.confirmResource(
        identity(request, 'teacher'),
        announcementId(request),
        input.uploadSessionId,
        idempotencyKey(request),
      ));
    },
  };
}
