import { Router } from 'express';

import { createPointsController } from '../controllers/points.controller.js';
import type { AuthenticationMiddleware } from '../middleware/authenticate.js';
import type { PointsService } from '../services/points.service.js';

export function createPointsRouter(
  pointsService: PointsService,
  authenticate: AuthenticationMiddleware,
): Router {
  const router = Router();
  const controller = createPointsController(pointsService);

  router.get('/level', authenticate, controller.getLevel);
  router.get('/activity', authenticate, controller.getActivity);
  router.get('/earning-rules', authenticate, controller.getEarningRules);

  return router;
}

export function createStudentClassRankingsRouter(
  pointsService: PointsService,
  authenticate: AuthenticationMiddleware,
): Router {
  const router = Router();
  const controller = createPointsController(pointsService);
  router.get('/class/rankings', authenticate, controller.getClassRanking);
  return router;
}
