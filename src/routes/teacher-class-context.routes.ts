import { Router } from 'express';

import { createTeacherClassContextController } from '../controllers/teacher-class-context.controller.js';
import type { AuthenticationMiddleware } from '../middleware/authenticate.js';
import type { TeacherClassContextService } from '../services/teacher-class-context.service.js';

export function createTeacherClassContextRouter(
  service: TeacherClassContextService,
  authenticate: AuthenticationMiddleware,
): Router {
  const router = Router();
  const controller = createTeacherClassContextController(service);
  router.use(authenticate);
  router.get('/:classId/subjects/:subjectId', controller.getAssignedClassSubjectContext);
  return router;
}
