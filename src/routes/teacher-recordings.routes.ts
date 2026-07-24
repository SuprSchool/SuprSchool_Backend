import { Router } from 'express';

import { createTeacherRecordingsController } from '../controllers/recordings.controller.js';
import type { AuthenticationMiddleware } from '../middleware/authenticate.js';
import type { IdempotencyStore } from '../platform/idempotency/idempotency-store.js';
import { requireCapability } from '../middleware/authorize.js';
import type { RecordingService } from '../services/recordings.service.js';

export function createTeacherRecordingsRouter(
  service: RecordingService,
  authenticate: AuthenticationMiddleware,
  idempotency: IdempotencyStore,
): Router {
  const router = Router();
  const controller = createTeacherRecordingsController(service, idempotency);

  router.use(authenticate, requireCapability('createRecording'));
  router.get('/classes/:classId/recordings', controller.list);
  router.get('/recordings/:recordingId', controller.getDetail);
  router.post('/classes/:classId/recordings', controller.createDraft);
  router.post('/recordings/:recordingId/resources/upload-sessions', controller.requestResourceUploadSession);
  router.post('/recordings/:recordingId/resources/upload-sessions/:sessionId/confirm', controller.confirmResourceUpload);
  router.delete('/recordings/:recordingId/resources/:resourceId', controller.deleteResource);
  router.post('/recordings/:recordingId/upload-sessions', controller.requestUploadSession);
  router.post('/recordings/:recordingId/upload-sessions/:sessionId/confirm', controller.confirmUpload);
  router.patch('/recordings/:recordingId', controller.publishRecording);
  router.delete('/recordings/:recordingId', controller.deleteRecording);
  return router;
}
