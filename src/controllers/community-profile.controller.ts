import type { Request, Response } from 'express';

import { AppError } from '../lib/errors.js';
import type { CommunityProfileService } from '../services/community-profile.service.js';
import type {
  CommunityIdentity,
  CurrentSchool,
  StudentDirectoryProfile,
  StudentProfileOverview,
  TeacherProfileOverview,
} from '../types/community-profile.js';
import {
  communityProfileRequestSchema,
  studentDirectoryProfileRequestSchema,
} from '../validators/community-profile.schemas.js';

export interface CommunityProfileController {
  getCurrentSchool(request: Request, response: Response): Promise<void>;
  getStudentDirectoryProfile(request: Request, response: Response): Promise<void>;
  getStudentOverview(request: Request, response: Response): Promise<void>;
  getTeacherOverview(request: Request, response: Response): Promise<void>;
}

export function createCommunityProfileController(
  service: CommunityProfileService,
): CommunityProfileController {
  return {
    async getStudentOverview(request: Request, response: Response): Promise<void> {
      assertNoCallerInput(request);
      const body: StudentProfileOverview = await service.getStudentOverview(
        requireIdentity(request, 'student'),
      );
      response.status(200).json(body);
    },
    async getTeacherOverview(request: Request, response: Response): Promise<void> {
      assertNoCallerInput(request);
      const body: TeacherProfileOverview = await service.getTeacherOverview(
        requireIdentity(request, 'teacher'),
      );
      response.status(200).json(body);
    },
    async getStudentDirectoryProfile(request: Request, response: Response): Promise<void> {
      const { studentId } = studentDirectoryProfileRequestSchema.parse({
        ...request.params,
        ...request.query,
      });
      // No expected role: both roles reach this screen from an underlined name.
      const body: StudentDirectoryProfile = await service.getStudentDirectoryProfile(
        requireIdentity(request),
        studentId,
      );
      response.status(200).json(body);
    },
    async getCurrentSchool(request: Request, response: Response): Promise<void> {
      assertNoCallerInput(request);
      const body: CurrentSchool = await service.getCurrentSchool(requireIdentity(request));
      response.status(200).json(body);
    },
  };
}

function assertNoCallerInput(request: Request): void {
  communityProfileRequestSchema.parse({ ...request.params, ...request.query });
}

function requireIdentity(
  request: Request,
  expectedRole?: CommunityIdentity['role'],
): CommunityIdentity {
  if (!request.auth) {
    throw new AppError('UNAUTHORIZED', 401, 'A valid bearer token is required');
  }
  if (expectedRole !== undefined && request.auth.role !== expectedRole) {
    throw new AppError('FORBIDDEN', 403, 'This overview is available only to the active role');
  }
  return request.auth;
}
