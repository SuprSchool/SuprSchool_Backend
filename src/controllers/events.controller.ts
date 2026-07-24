import type { Request, Response } from 'express';

import { AppError } from '../lib/errors.js';
import type { EventsService } from '../services/events.service.js';
import { studentEventsQuerySchema } from '../validators/events.schemas.js';

function studentIdentity(request: Request) {
  if (!request.auth) {
    throw new AppError('UNAUTHORIZED', 401, 'A valid bearer token is required');
  }
  if (request.auth.role !== 'student') {
    throw new AppError('FORBIDDEN', 403, 'Only students can access events');
  }
  return { schoolId: request.auth.schoolId, userId: request.auth.userId };
}

export function createEventsController(service: EventsService) {
  return {
    listStudentEvents: async (request: Request, response: Response): Promise<void> => {
      const identity = studentIdentity(request);
      const query = studentEventsQuerySchema.parse(request.query);
      response.status(200).json(await service.listStudentEvents(identity, query));
    },
  };
}
import {
  createEventSchema,
  emptyEventsMutationSchema,
  eventIdParamsSchema,
  eventParticipantParamsSchema,
  eventParticipationTagSchema,
  eventScoresSchema,
  eventTeamMembersSchema,
  eventTeamParamsSchema,
  eventTeamSchema,
  eventTeamsReplacementSchema,
  managingTeamSchema,
  teacherEventsQuerySchema,
  updateEventSchema,
} from '../validators/events.schemas.js';


export function createStudentEventsActionsController(service: EventsService) {
  return {
    createTeam: async (request: Request, response: Response): Promise<void> => {
      const identity = studentIdentity(request);
      const { eventId } = eventIdParamsSchema.parse(request.params);
      response.status(201).json(await service.createTeam(
        identity,
        eventId,
        eventTeamSchema.parse(request.body),
      ));
    },
    getStudentEvent: async (request: Request, response: Response): Promise<void> => {
      const identity = studentIdentity(request);
      const { eventId } = eventIdParamsSchema.parse(request.params);
      response.status(200).json(await service.getStudentEvent(identity, eventId));
    },
    getStudentResults: async (request: Request, response: Response): Promise<void> => {
      const identity = studentIdentity(request);
      const { eventId } = eventIdParamsSchema.parse(request.params);
      response.status(200).json(await service.getStudentResults(identity, eventId));
    },
    getStudentTeam: async (request: Request, response: Response): Promise<void> => {
      const identity = studentIdentity(request);
      const { eventId, teamId } = eventTeamParamsSchema.parse(request.params);
      response.status(200).json(await service.getStudentTeam(identity, eventId, teamId));
    },
    listStudentParticipants: async (request: Request, response: Response): Promise<void> => {
      const identity = studentIdentity(request);
      const { eventId } = eventIdParamsSchema.parse(request.params);
      response.status(200).json({ items: await service.listStudentParticipants(identity, eventId), nextCursor: null });
    },
    listStudentTeams: async (request: Request, response: Response): Promise<void> => {
      const identity = studentIdentity(request);
      const { eventId } = eventIdParamsSchema.parse(request.params);
      response.status(200).json({ items: await service.listStudentTeams(identity, eventId), nextCursor: null });
    },
    registerStudent: async (request: Request, response: Response): Promise<void> => {
      const identity = studentIdentity(request);
      const { eventId } = eventIdParamsSchema.parse(request.params);
      emptyEventsMutationSchema.parse(request.body);
      const registration = await service.registerStudent(identity, eventId);
      response.status(registration.created ? 201 : 200).json(registration);
    },
  };
}

function teacherIdentity(request: Request) {
  if (!request.auth) {
    throw new AppError('UNAUTHORIZED', 401, 'A valid bearer token is required');
  }
  if (request.auth.role !== 'teacher') {
    throw new AppError('FORBIDDEN', 403, 'Only teachers can manage events');
  }
  return { schoolId: request.auth.schoolId, userId: request.auth.userId };
}

export function createTeacherEventsController(service: EventsService) {
  return {
    archiveEvent: async (request: Request, response: Response): Promise<void> => {
      const identity = teacherIdentity(request);
      const { eventId } = eventIdParamsSchema.parse(request.params);
      await service.archiveEvent(identity, eventId);
      response.status(204).end();
    },
    createEvent: async (request: Request, response: Response): Promise<void> => {
      const identity = teacherIdentity(request);
      response.status(201).json(await service.createEvent(identity, createEventSchema.parse(request.body)));
    },
    createManagedTeam: async (request: Request, response: Response): Promise<void> => {
      const identity = teacherIdentity(request);
      const { eventId } = eventIdParamsSchema.parse(request.params);
      response.status(201).json(await service.createManagedTeam(identity, eventId, eventTeamSchema.parse(request.body)));
    },
    deleteTeam: async (request: Request, response: Response): Promise<void> => {
      const identity = teacherIdentity(request);
      const { eventId, teamId } = eventTeamParamsSchema.parse(request.params);
      await service.deleteTeam(identity, eventId, teamId);
      response.status(204).end();
    },
    getTeacherEvent: async (request: Request, response: Response): Promise<void> => {
      const identity = teacherIdentity(request);
      const { eventId } = eventIdParamsSchema.parse(request.params);
      response.status(200).json(await service.getTeacherEvent(identity, eventId));
    },
    getTeacherResults: async (request: Request, response: Response): Promise<void> => {
      const identity = teacherIdentity(request);
      const { eventId } = eventIdParamsSchema.parse(request.params);
      response.status(200).json(await service.getTeacherResults(identity, eventId));
    },
    listParticipants: async (request: Request, response: Response): Promise<void> => {
      const identity = teacherIdentity(request);
      const { eventId } = eventIdParamsSchema.parse(request.params);
      response.status(200).json({ items: await service.listParticipants(identity, eventId) });
    },
    listTeacherEvents: async (request: Request, response: Response): Promise<void> => {
      const identity = teacherIdentity(request);
      response.status(200).json(await service.listTeacherEvents(
        identity,
        teacherEventsQuerySchema.parse(request.query),
      ));
    },
    listTeams: async (request: Request, response: Response): Promise<void> => {
      const identity = teacherIdentity(request);
      const { eventId } = eventIdParamsSchema.parse(request.params);
      response.status(200).json({ items: await service.listTeams(identity, eventId) });
    },
    publishResults: async (request: Request, response: Response): Promise<void> => {
      const identity = teacherIdentity(request);
      const { eventId } = eventIdParamsSchema.parse(request.params);
      emptyEventsMutationSchema.parse(request.body);
      response.status(200).json(await service.publishResults(identity, eventId));
    },
    replaceManagingTeam: async (request: Request, response: Response): Promise<void> => {
      const identity = teacherIdentity(request);
      const { eventId } = eventIdParamsSchema.parse(request.params);
      const { members } = managingTeamSchema.parse(request.body);
      response.status(200).json(await service.replaceManagingTeam(identity, eventId, members));
    },
    replaceTeams: async (request: Request, response: Response): Promise<void> => {
      const identity = teacherIdentity(request);
      const { eventId } = eventIdParamsSchema.parse(request.params);
      const { teams } = eventTeamsReplacementSchema.parse(request.body);
      response.status(200).json(await service.replaceTeams(identity, eventId, teams));
    },
    replaceTeamMembers: async (request: Request, response: Response): Promise<void> => {
      const identity = teacherIdentity(request);
      const { eventId, teamId } = eventTeamParamsSchema.parse(request.params);
      const teamMembers = eventTeamMembersSchema.safeParse(request.body);
      if (teamMembers.success) {
        response.status(200).json(await service.replaceTeamMembers(
          identity,
          eventId,
          teamId,
          teamMembers.data.memberStudentIds,
        ));
        return;
      }
      // Retain the original Phase 3 contract while current clients migrate to
      // the dedicated /managing-team route.
      const { members } = managingTeamSchema.parse(request.body);
      response.status(200).json(await service.replaceManagingTeam(identity, eventId, members));
    },
    updateEvent: async (request: Request, response: Response): Promise<void> => {
      const identity = teacherIdentity(request);
      const { eventId } = eventIdParamsSchema.parse(request.params);
      response.status(200).json(await service.updateEvent(
        identity,
        eventId,
        updateEventSchema.parse(request.body),
      ));
    },
    tagParticipation: async (request: Request, response: Response): Promise<void> => {
      const identity = teacherIdentity(request);
      const { eventId, studentId } = eventParticipantParamsSchema.parse(request.params);
      const { tag } = eventParticipationTagSchema.parse(request.body);
      response.status(200).json(await service.tagParticipation(identity, eventId, studentId, tag));
    },
    writeScores: async (request: Request, response: Response): Promise<void> => {
      const identity = teacherIdentity(request);
      const { eventId } = eventIdParamsSchema.parse(request.params);
      const { entries } = eventScoresSchema.parse(request.body);
      response.status(200).json(await service.writeScores(identity, eventId, entries));
    },
  };
}
