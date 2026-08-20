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

/**
 * `GET /v1/students/:studentId/profile` — one student as the rest of their
 * school sees them.
 *
 * Plural `students` on purpose: `/v1/student/...` and `/v1/teacher/...` are
 * the caller describing themselves, and this is a collection addressed by id.
 * Mounting it here rather than under `/v1/student` also keeps it obviously
 * role-neutral, which it is.
 */
export function createStudentDirectoryRouter(
  service: CommunityProfileService,
  authenticate: AuthenticationMiddleware,
): Router {
  const router = Router();
  const controller = createCommunityProfileController(service);

  router.get('/:studentId/profile', authenticate, controller.getStudentDirectoryProfile);
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
