import { Router } from 'express';

import { createStudentRecordingsController } from '../controllers/recordings.controller.js';
import type { AuthenticationMiddleware } from '../middleware/authenticate.js';
import type { RecordingService } from '../services/recordings.service.js';

export function createStudentRecordingsRouter(
  service: RecordingService,
  authenticate: AuthenticationMiddleware,
): Router {
  const router = Router();
  const controller = createStudentRecordingsController(service);

  router.use(authenticate);
  router.get('/recordings', controller.list);
  router.get('/recordings/:recordingId/playback-url', controller.getPlaybackUrl);
  router.get('/recordings/:recordingId/progress', controller.getProgress);
  router.patch('/recordings/:recordingId/progress', controller.saveProgress);
  router.get('/recordings/:recordingId', controller.getDetail);
  return router;
}
