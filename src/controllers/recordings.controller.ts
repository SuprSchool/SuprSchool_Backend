import type { Request, Response } from 'express';
import { z } from 'zod';

import { AppError } from '../lib/errors.js';
import {
  hashCanonicalRequest,
  IdempotencyConflictError,
  type IdempotencyStore,
} from '../platform/idempotency/idempotency-store.js';
import type { RecordingService } from '../services/recordings.service.js';
import type { RecordingIdentity } from '../types/recordings.js';
import {
  classIdParamsSchema,
  createRecordingDraftSchema,
  createRecordingResourceUploadSessionSchema,
  createRecordingUploadSessionSchema,
  recordingMutationSchema,
  recordingIdParamsSchema,
  recordingListQuerySchema,
  saveRecordingProgressSchema,
} from '../validators/recordings.schemas.js';

const uploadSessionParamsSchema = z.object({
  recordingId: z.uuid(),
  sessionId: z.uuid(),
});

const recordingResourceParamsSchema = z.object({
  recordingId: z.uuid(),
  resourceId: z.uuid(),
});

function requireIdentity(request: Request, role: 'student' | 'teacher'): RecordingIdentity {
  if (!request.auth) throw new AppError('UNAUTHORIZED', 401, 'A valid bearer token is required');
  if (request.auth.role !== role) throw new AppError('FORBIDDEN', 403, 'You do not have access to this resource');
  return { schoolId: request.auth.schoolId, userId: request.auth.userId };
}

async function runIdempotentMutation(
  idempotency: IdempotencyStore,
  request: Request,
  response: Response,
  identity: RecordingIdentity,
  resource: string,
  status: number,
  action: () => Promise<unknown>,
): Promise<void> {
  const submittedKey = request.header('Idempotency-Key')?.trim();
  if (!submittedKey) {
    throw new AppError('VALIDATION_ERROR', 400, 'Idempotency-Key is required for recording mutations');
  }
  const idempotencyRequest = {
    key: hashCanonicalRequest({ resource, submittedKey }),
    requestBody: { body: request.body ?? null, resource },
    schoolId: identity.schoolId,
    userId: identity.userId,
  };
  let claimed = false;
  try {
    const claim = await idempotency.claim(idempotencyRequest);
    if (claim.state === 'completed') {
      if (claim.response.status === 204) response.status(204).end();
      else response.status(claim.response.status).json(claim.response.body);
      return;
    }
    if (claim.state === 'in_progress') {
      throw new AppError('VALIDATION_ERROR', 409, 'A request with this Idempotency-Key is already in progress');
    }
    claimed = true;
    const body = await action();
    await idempotency.complete(idempotencyRequest, { body: status === 204 ? null : body, status });
    if (status === 204) response.status(204).end();
    else response.status(status).json(body);
  } catch (error) {
    if (claimed && error instanceof AppError && error.status === 503) {
      await idempotency.release(idempotencyRequest);
    }
    if (error instanceof IdempotencyConflictError) {
      throw new AppError('VALIDATION_ERROR', 409, 'Idempotency-Key cannot be reused with a different recording request');
    }
    throw error;
  }
}

export interface StudentRecordingsController {
  getDetail(request: Request, response: Response): Promise<void>;
  getPlaybackUrl(request: Request, response: Response): Promise<void>;
  getProgress(request: Request, response: Response): Promise<void>;
  list(request: Request, response: Response): Promise<void>;
  saveProgress(request: Request, response: Response): Promise<void>;
}

export interface TeacherRecordingsController {
  confirmResourceUpload(request: Request, response: Response): Promise<void>;
  confirmUpload(request: Request, response: Response): Promise<void>;
  createDraft(request: Request, response: Response): Promise<void>;
  deleteRecording(request: Request, response: Response): Promise<void>;
  deleteResource(request: Request, response: Response): Promise<void>;
  getDetail(request: Request, response: Response): Promise<void>;
  list(request: Request, response: Response): Promise<void>;
  publishRecording(request: Request, response: Response): Promise<void>;
  requestResourceUploadSession(request: Request, response: Response): Promise<void>;
  requestUploadSession(request: Request, response: Response): Promise<void>;
}

export function createStudentRecordingsController(service: RecordingService): StudentRecordingsController {
  return {
    list: async (request, response) => {
      const identity = requireIdentity(request, 'student');
      response.status(200).json(await service.listStudentRecordings(identity, recordingListQuerySchema.parse(request.query)));
    },
    getDetail: async (request, response) => {
      const identity = requireIdentity(request, 'student');
      const { recordingId } = recordingIdParamsSchema.parse(request.params);
      response.setHeader('Cache-Control', 'private, no-store');
      response.status(200).json(await service.getStudentRecording(identity, recordingId));
    },
    getPlaybackUrl: async (request, response) => {
      const identity = requireIdentity(request, 'student');
      const { recordingId } = recordingIdParamsSchema.parse(request.params);
      const body = await service.getPlaybackUrl(identity, recordingId);
      response.setHeader('Cache-Control', 'private, no-store');
      response.status(200).json(body);
    },
    getProgress: async (request, response) => {
      const identity = requireIdentity(request, 'student');
      const { recordingId } = recordingIdParamsSchema.parse(request.params);
      const progress = await service.getProgress(identity, recordingId);
      response.status(200).json({ progress });
    },
    saveProgress: async (request, response) => {
      const identity = requireIdentity(request, 'student');
      const { recordingId } = recordingIdParamsSchema.parse(request.params);
      response.status(200).json(await service.saveProgress(identity, recordingId, saveRecordingProgressSchema.parse(request.body)));
    },
  };
}

export function createTeacherRecordingsController(
  service: RecordingService,
  idempotency: IdempotencyStore,
): TeacherRecordingsController {
  return {
    list: async (request, response) => {
      const identity = requireIdentity(request, 'teacher');
      const { classId } = classIdParamsSchema.parse(request.params);
      response.status(200).json(await service.listTeacherRecordings(identity, {
        ...recordingListQuerySchema.parse(request.query),
        classId,
      }));
    },
    getDetail: async (request, response) => {
      const identity = requireIdentity(request, 'teacher');
      const { recordingId } = recordingIdParamsSchema.parse(request.params);
      response.setHeader('Cache-Control', 'private, no-store');
      response.status(200).json(await service.getTeacherRecording(identity, recordingId));
    },
    createDraft: async (request, response) => {
      const identity = requireIdentity(request, 'teacher');
      const { classId } = classIdParamsSchema.parse(request.params);
      const body = createRecordingDraftSchema.parse(request.body);
      await runIdempotentMutation(
        idempotency,
        request,
        response,
        identity,
        `POST:/classes/${classId}/recordings`,
        201,
        () => service.createDraft(identity, {
          classId,
          description: body.description,
          subjectId: body.subjectId,
          title: body.title,
        }),
      );
    },
    requestResourceUploadSession: async (request, response) => {
      const identity = requireIdentity(request, 'teacher');
      const { recordingId } = recordingIdParamsSchema.parse(request.params);
      const body = createRecordingResourceUploadSessionSchema.parse(request.body);
      await runIdempotentMutation(
        idempotency, request, response, identity,
        `POST:/recordings/${recordingId}/resources/upload-sessions`, 201,
        () => service.requestResourceUploadSession(identity, recordingId, body),
      );
    },
    confirmResourceUpload: async (request, response) => {
      const identity = requireIdentity(request, 'teacher');
      const { recordingId, sessionId } = uploadSessionParamsSchema.parse(request.params);
      await runIdempotentMutation(
        idempotency, request, response, identity,
        `POST:/recordings/${recordingId}/resources/upload-sessions/${sessionId}/confirm`, 201,
        () => service.confirmResourceUpload(identity, recordingId, sessionId),
      );
    },
    requestUploadSession: async (request, response) => {
      const identity = requireIdentity(request, 'teacher');
      const { recordingId } = recordingIdParamsSchema.parse(request.params);
      const body = createRecordingUploadSessionSchema.parse(request.body);
      await runIdempotentMutation(
        idempotency,
        request,
        response,
        identity,
        `POST:/recordings/${recordingId}/upload-sessions`,
        201,
        () => service.requestUploadSession(identity, recordingId, body),
      );
    },
    confirmUpload: async (request, response) => {
      const identity = requireIdentity(request, 'teacher');
      const { recordingId, sessionId } = uploadSessionParamsSchema.parse(request.params);
      await runIdempotentMutation(
        idempotency,
        request,
        response,
        identity,
        `POST:/recordings/${recordingId}/upload-sessions/${sessionId}/confirm`,
        204,
        () => service.confirmUpload(identity, recordingId, sessionId),
      );
    },
    publishRecording: async (request, response) => {
      const identity = requireIdentity(request, 'teacher');
      const { recordingId } = recordingIdParamsSchema.parse(request.params);
      const body = recordingMutationSchema.parse(request.body);
      await runIdempotentMutation(
        idempotency,
        request,
        response,
        identity,
        `PATCH:/recordings/${recordingId}`,
        200,
        () => 'action' in body
          ? service.publishRecording(identity, recordingId)
          : service.updateRecording(identity, recordingId, body),
      );
    },
    deleteRecording: async (request, response) => {
      const identity = requireIdentity(request, 'teacher');
      const { recordingId } = recordingIdParamsSchema.parse(request.params);
      await runIdempotentMutation(
        idempotency,
        request,
        response,
        identity,
        `DELETE:/recordings/${recordingId}`,
        200,
        () => service.deleteRecording(identity, recordingId),
      );
    },
    deleteResource: async (request, response) => {
      const identity = requireIdentity(request, 'teacher');
      const { recordingId, resourceId } = recordingResourceParamsSchema.parse(request.params);
      await runIdempotentMutation(
        idempotency,
        request,
        response,
        identity,
        `DELETE:/recordings/${recordingId}/resources/${resourceId}`,
        200,
        () => service.deleteResource(identity, recordingId, resourceId),
      );
    },
  };
}
