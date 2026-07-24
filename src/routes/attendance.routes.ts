import { Router } from 'express';

import { createAttendanceController } from '../controllers/attendance.controller.js';
import type { AuthenticationMiddleware } from '../middleware/authenticate.js';
import type { AttendanceService } from '../services/attendance.service.js';

export function createAttendanceRouter(
  attendanceService: AttendanceService,
  authenticate: AuthenticationMiddleware,
): Router {
  const router = Router();
  const controller = createAttendanceController(attendanceService);

  router.post('/mark-bulk', authenticate, controller.markBulk);
  router.get('/classes/:classId/students', authenticate, controller.getClassRoster);
  router.get('/classes/:classId/history', authenticate, controller.getClassHistory);
  router.get('/me/summary', authenticate, controller.getMySummary);

  return router;
}
