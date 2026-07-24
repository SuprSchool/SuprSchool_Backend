import { Router } from 'express';

import { createAnnouncementsController } from '../controllers/announcements.controller.js';
import type { AuthenticationMiddleware } from '../middleware/authenticate.js';
import { requireCapability } from '../middleware/authorize.js';
import type { AnnouncementsService } from '../services/announcements.service.js';

export function createAnnouncementsRouter(
  service: AnnouncementsService,
  authenticate: AuthenticationMiddleware,
): Router {
  const router = Router();
  const controller = createAnnouncementsController(service);

  router.use(authenticate);
  router.get('/announcements', controller.listForStudent);
  router.get('/announcements/:announcementId', controller.getForStudent);
  router.get('/teacher/announcements', requireCapability('createAnnouncement'), controller.listForTeacher);
  router.get('/teacher/announcements/:announcementId', requireCapability('createAnnouncement'), controller.getForTeacher);
  router.post('/teacher/announcements', requireCapability('createAnnouncement'), controller.create);
  router.patch('/teacher/announcements/:announcementId', requireCapability('createAnnouncement'), controller.update);
  router.delete('/teacher/announcements/:announcementId', requireCapability('createAnnouncement'), controller.delete);
  router.post('/teacher/announcements/:announcementId/publish', requireCapability('createAnnouncement'), controller.publish);
  router.post(
    '/teacher/announcements/:announcementId/resources/upload-sessions',
    requireCapability('createAnnouncement'),
    controller.createResourceUploadSession,
  );
  router.post(
    '/teacher/announcements/:announcementId/resources/confirm',
    requireCapability('createAnnouncement'),
    controller.confirmResource,
  );
  router.delete(
    '/teacher/announcements/:announcementId/resources/:resourceId',
    requireCapability('createAnnouncement'),
    controller.deleteResource,
  );

  return router;
}
