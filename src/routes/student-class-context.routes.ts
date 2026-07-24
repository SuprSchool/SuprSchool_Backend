import { Router } from 'express';

import { createStudentClassContextController } from '../controllers/student-class-context.controller.js';
import type { AuthenticationMiddleware } from '../middleware/authenticate.js';
import type { StudentClassContextService } from '../services/student-class-context.service.js';

export function createStudentClassContextRouter(
  service: StudentClassContextService,
  authenticate: AuthenticationMiddleware,
): Router {
  const router = Router();
  const controller = createStudentClassContextController(service);
  router.use(authenticate);
  router.get('/class-context', controller.getClassContext);
  router.get('/subjects', controller.listSubjects);
  return router;
}
