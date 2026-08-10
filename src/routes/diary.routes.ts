import { Router } from 'express';

import { createDiaryController } from '../controllers/diary.controller.js';
import type { AuthenticationMiddleware } from '../middleware/authenticate.js';
import type { DiaryService } from '../services/diary.service.js';

export function createDiaryRouter(
  service: DiaryService,
  authenticate: AuthenticationMiddleware,
): Router {
  const router = Router();
  const controller = createDiaryController(service);

  router.use(authenticate);
  router.get('/subjects/:subjectId/diary', controller.listForStudent);
  router.get('/classes/:classId/diary', controller.listForTeacher);
  router.post('/classes/:classId/diary', controller.create);
  router.patch('/diary/:diaryId', controller.update);
  router.delete('/diary/:diaryId', controller.deleteEntry);

  return router;
}
