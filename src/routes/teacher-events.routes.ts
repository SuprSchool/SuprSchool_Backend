import { Router } from 'express';

import { createTeacherEventsController } from '../controllers/events.controller.js';
import type { AuthenticationMiddleware } from '../middleware/authenticate.js';
import type { EventsService } from '../services/events.service.js';

export function createTeacherEventsRouter(
  service: EventsService,
  authenticate: AuthenticationMiddleware,
): Router {
  const router = Router();
  const controller = createTeacherEventsController(service);

  router.use(authenticate);
  router.get('/events', controller.listTeacherEvents);
  router.post('/events', controller.createEvent);
  router.get('/events/:eventId/participants', controller.listParticipants);
  router.get('/events/:eventId/results', controller.getTeacherResults);
  router.put('/events/:eventId/participants/:studentId/tag', controller.tagParticipation);
  router.get('/events/:eventId/teams', controller.listTeams);
  router.post('/events/:eventId/teams', controller.createManagedTeam);
  router.put('/events/:eventId/teams', controller.replaceTeams);
  router.delete('/events/:eventId/teams/:teamId', controller.deleteTeam);
  router.put('/events/:eventId/managing-team', controller.replaceManagingTeam);
  router.put('/events/:eventId/teams/:teamId/members', controller.replaceTeamMembers);
  router.put('/events/:eventId/scores', controller.writeScores);
  router.put('/events/:eventId/results', controller.writeScores);
  router.post('/events/:eventId/results/publish', controller.publishResults);
  router.post('/events/:eventId/publish-results', controller.publishResults);
  router.get('/events/:eventId', controller.getTeacherEvent);
  router.patch('/events/:eventId', controller.updateEvent);
  router.delete('/events/:eventId', controller.archiveEvent);
  return router;
}
