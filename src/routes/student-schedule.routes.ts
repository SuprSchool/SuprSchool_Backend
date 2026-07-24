import { Router } from 'express';

import { createScheduleController } from '../controllers/schedule.controller.js';
import type { AuthenticationMiddleware } from '../middleware/authenticate.js';
import type { ScheduleService } from '../services/schedule.service.js';

export function createStudentScheduleRouter(
  service: ScheduleService,
  authenticate: AuthenticationMiddleware,
): Router {
  const router = Router();
  const controller = createScheduleController(service);

  router.use(authenticate);
  router.get('/schedule/timetable', controller.getStudentTimetable);
  router.get('/attendance', controller.getStudentAttendance);

  return router;
}
