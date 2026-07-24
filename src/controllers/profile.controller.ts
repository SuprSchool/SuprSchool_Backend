import type { Request, Response } from 'express';

import { AppError } from '../lib/errors.js';
import type { AvatarService } from '../services/avatar.service.js';
import type { ProfileService } from '../services/profile.service.js';
import {
  avatarUploadSessionParamsSchema,
  createAvatarUploadSessionSchema,
  replaceProfileInterestsSchema,
  setPresetAvatarSchema,
} from '../validators/profile.schemas.js';

function authenticatedIdentity(request: Request): { schoolId: string; userId: string } {
  if (!request.auth) {
    throw new AppError('UNAUTHORIZED', 401, 'A valid bearer token is required');
  }
  return { schoolId: request.auth.schoolId, userId: request.auth.userId };
}

export function createProfileController(
  service: ProfileService,
  avatarService?: AvatarService,
) {
  return {
    getProfile: async (request: Request, response: Response): Promise<void> => {
      response.status(200).json(await service.getProfile(authenticatedIdentity(request).userId));
    },
    replaceInterests: async (request: Request, response: Response): Promise<void> => {
      const { interests } = replaceProfileInterestsSchema.parse(request.body);
      await service.replaceInterests(
        authenticatedIdentity(request).userId,
        interests,
      );
      response.status(204).end();
    },
    setPresetAvatar: async (request: Request, response: Response): Promise<void> => {
      const { presetId } = setPresetAvatarSchema.parse(request.body);
      response.status(200).json({
        avatar: await service.setPresetAvatar(
          authenticatedIdentity(request).userId,
          presetId,
        ),
      });
    },
    createAvatarUploadSession: async (request: Request, response: Response): Promise<void> => {
      if (avatarService === undefined) {
        throw new AppError('INTERNAL_ERROR', 500, 'Avatar uploads are not configured');
      }
      const body = createAvatarUploadSessionSchema.parse(request.body);
      response.status(201).json(await avatarService.createUploadSession(
        authenticatedIdentity(request),
        body,
      ));
    },
    confirmAvatarUpload: async (request: Request, response: Response): Promise<void> => {
      if (avatarService === undefined) {
        throw new AppError('INTERNAL_ERROR', 500, 'Avatar uploads are not configured');
      }
      const { sessionId } = avatarUploadSessionParamsSchema.parse(request.params);
      const result = await avatarService.confirmUpload(
        authenticatedIdentity(request),
        sessionId,
      );
      response.status(200).json({ avatar: result.avatar });
    },
  };
}
