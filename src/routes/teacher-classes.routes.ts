import { Router } from 'express';

import { createTeacherClassesController } from '../controllers/teacher-classes.controller.js';
import type { AuthenticationMiddleware } from '../middleware/authenticate.js';
import type { TeacherClassesService } from '../services/teacher-classes.service.js';

export function createTeacherClassesRouter(
  service: TeacherClassesService,
  authenticate: AuthenticationMiddleware,
): Router {
  const router = Router();
  const controller = createTeacherClassesController(service);

  router.use(authenticate);
  router.get('/', controller.listAssignedClasses);
  router.get(
    '/:classId/subjects/:subjectId/students',
    controller.getAssignedClassStudents,
  );

  return router;
}
