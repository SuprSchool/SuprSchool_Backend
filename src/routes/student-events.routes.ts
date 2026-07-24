import { Router } from 'express';

import {
  createEventsController,
  createStudentEventsActionsController,
} from '../controllers/events.controller.js';
import type { AuthenticationMiddleware } from '../middleware/authenticate.js';
import type { EventsService } from '../services/events.service.js';

export function createStudentEventsRouter(
  service: EventsService,
  authenticate: AuthenticationMiddleware,
): Router {
  const router = Router();
  const controller = createEventsController(service);
  const actions = createStudentEventsActionsController(service);

  router.use(authenticate);
  router.get('/events', controller.listStudentEvents);
  router.get('/events/:eventId/results', actions.getStudentResults);
  router.post('/events/:eventId/registrations', actions.registerStudent);
  router.get('/events/:eventId/participants', actions.listStudentParticipants);
  router.get('/events/:eventId/teams/:teamId', actions.getStudentTeam);
  router.get('/events/:eventId/teams', actions.listStudentTeams);
  router.post('/events/:eventId/teams', actions.createTeam);
  router.get('/events/:eventId', actions.getStudentEvent);
  return router;
}
