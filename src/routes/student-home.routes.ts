import { Router } from 'express';

import { createStudentHomeController } from '../controllers/student-home.controller.js';
import type { AuthenticationMiddleware } from '../middleware/authenticate.js';
import type { StudentHomeService } from '../services/student-home.service.js';

export function createStudentHomeRouter(
  studentHomeService: StudentHomeService,
  authenticate: AuthenticationMiddleware,
): Router {
  const router = Router();
  const controller = createStudentHomeController(studentHomeService);

  router.get('/', authenticate, controller.getHome);
  router.get('/calendar', authenticate, controller.getCalendar);
  router.get('/calendar/:date', authenticate, controller.getCalendarDay);
  router.get('/birthdays', authenticate, controller.getBirthdays);

  return router;
}
