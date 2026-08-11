import type { Request, Response } from 'express';

import { AppError } from '../lib/errors.js';
import type { PointsService } from '../services/points.service.js';
import type { PointsIdentity } from '../types/points.js';
import {
  pointsActivityQuerySchema,
  studentRankingQuerySchema,
} from '../validators/points.schemas.js';

export interface PointsController {
  getActivity(request: Request, response: Response): Promise<void>;
  getClassRanking(request: Request, response: Response): Promise<void>;
  getEarningRules(request: Request, response: Response): Promise<void>;
  getLevel(request: Request, response: Response): Promise<void>;
}

export function createPointsController(service: PointsService): PointsController {
  return {
    async getActivity(request, response): Promise<void> {
      const query = pointsActivityQuerySchema.parse(request.query);
      const page = {
        limit: query.limit,
        period: query.period,
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      };
      response.status(200).json(await service.getActivity(requireStudentIdentity(request), page));
    },
    async getClassRanking(request, response): Promise<void> {
      const query = studentRankingQuerySchema.parse(request.query);
      response.status(200).json(await service.getClassRanking(requireStudentIdentity(request), query));
    },
    async getEarningRules(request, response): Promise<void> {
      response.status(200).json({ items: await service.getEarningRules(requireStudentIdentity(request)) });
    },
    async getLevel(request, response): Promise<void> {
      response.status(200).json(await service.getLevel(requireStudentIdentity(request)));
    },
  };
}

function requireStudentIdentity(request: Request): PointsIdentity {
  if (!request.auth) {
    throw new AppError('UNAUTHORIZED', 401, 'A valid bearer token is required');
  }
  if (request.auth.role !== 'student') {
    throw new AppError('FORBIDDEN', 403, 'Only students can view points');
  }
  return { schoolId: request.auth.schoolId, userId: request.auth.userId };
}
