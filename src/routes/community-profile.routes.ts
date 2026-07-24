import { Router } from 'express';

import { createCommunityProfileController } from '../controllers/community-profile.controller.js';
import type { AuthenticationMiddleware } from '../middleware/authenticate.js';
import type { CommunityProfileService } from '../services/community-profile.service.js';

export function createStudentCommunityProfileRouter(
  service: CommunityProfileService,
  authenticate: AuthenticationMiddleware,
): Router {
  const router = Router();
  const controller = createCommunityProfileController(service);

  router.get('/overview', authenticate, controller.getStudentOverview);
  return router;
}

export function createTeacherCommunityProfileRouter(
  service: CommunityProfileService,
  authenticate: AuthenticationMiddleware,
): Router {
  const router = Router();
  const controller = createCommunityProfileController(service);

  router.get('/overview', authenticate, controller.getTeacherOverview);
  return router;
}

export function createSchoolRouter(
  service: CommunityProfileService,
  authenticate: AuthenticationMiddleware,
): Router {
  const router = Router();
  const controller = createCommunityProfileController(service);

  router.get('/current', authenticate, controller.getCurrentSchool);
  return router;
}
