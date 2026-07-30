import type { Request, Response } from 'express';

import { AppError } from '../lib/errors.js';
import {
  deterministicIdempotencyUuid,
  hashCanonicalRequest,
  IdempotencyConflictError,
  type IdempotencyStore,
} from '../platform/idempotency/idempotency-store.js';
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
  eventMemberOptionsQuerySchema,
  eventResourceParamsSchema,
  eventResourceSessionParamsSchema,
  eventResourceUploadSchema,
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


export function createStudentEventsActionsController(
  service: EventsService,
  idempotency: IdempotencyStore,
) {
  return {
    createTeam: async (request: Request, response: Response): Promise<void> => {
      const identity = studentIdentity(request);
      const { eventId } = eventIdParamsSchema.parse(request.params);
      const input = eventTeamSchema.parse(request.body);
      await runIdempotentEventMutation(
        idempotency,
        request,
        response,
        identity,
        `student-events:create-team:${eventId}`,
        201,
        (mutationId) => service.createTeam(identity, eventId, mutationId, input),
        (mutationId) => service.recoverCreatedStudentTeam(identity, eventId, mutationId),
        eventTeamIdempotencyMessages,
      );
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

class EventCompletionUnavailableError extends AppError {
  public constructor() {
    super(
      'INTERNAL_ERROR',
      503,
      'The event mutation outcome could not be confirmed; retry with the same Idempotency-Key',
    );
  }
}

interface EventIdempotencyMessages {
  conflict: string;
  required: string;
}

const eventMetadataIdempotencyMessages: EventIdempotencyMessages = {
  conflict: 'Idempotency-Key cannot be reused with a different event metadata request',
  required: 'Idempotency-Key is required for event metadata mutations',
};
const eventTeamIdempotencyMessages: EventIdempotencyMessages = {
  conflict: 'Idempotency-Key cannot be reused with a different event team creation request',
  required: 'Idempotency-Key is required for event team creation',
};

function eventIdempotencyConflict(message: string): AppError {
  return new AppError('VALIDATION_ERROR', 409, message);
}

async function runIdempotentEventMutation(
  idempotency: IdempotencyStore,
  request: Request,
  response: Response,
  identity: { schoolId: string; userId: string },
  resource: string,
  status: number,
  action: (mutationId: string) => Promise<unknown>,
  recover?: ((mutationId: string) => Promise<unknown | undefined>) | undefined,
  messages: EventIdempotencyMessages = eventMetadataIdempotencyMessages,
): Promise<void> {
  const submittedKey = request.header('Idempotency-Key')?.trim();
  if (!submittedKey) {
    throw new AppError('VALIDATION_ERROR', 400, messages.required);
  }
  const idempotencyRequest = {
    key: hashCanonicalRequest({ resource, submittedKey }),
    requestBody: { body: request.body ?? null, resource },
    schoolId: identity.schoolId,
    userId: identity.userId,
  };
  const mutationId = deterministicIdempotencyUuid({
    key: idempotencyRequest.key,
    schoolId: identity.schoolId,
    userId: identity.userId,
  });
  const claimRequest = async () => {
    try {
      return await idempotency.claim(idempotencyRequest);
    } catch (error) {
      if (error instanceof IdempotencyConflictError) throw eventIdempotencyConflict(messages.conflict);
      throw error;
    }
  };
  const persistCompletion = async (body: unknown, leaseToken: string): Promise<void> => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const completed = await idempotency.completeOwned(
          idempotencyRequest,
          leaseToken,
          { body, status },
        );
        if (completed.state === 'completed') {
          response.status(completed.response.status).json(completed.response.body);
          return;
        }
      } catch {
        const recoveredClaim = await claimRequest();
        if (recoveredClaim.state === 'completed') {
          response.status(recoveredClaim.response.status).json(recoveredClaim.response.body);
          return;
        }
        continue;
      }
      const recoveredClaim = await claimRequest();
      if (recoveredClaim.state === 'completed') {
        response.status(recoveredClaim.response.status).json(recoveredClaim.response.body);
        return;
      }
      throw new AppError('VALIDATION_ERROR', 409, 'Event mutation lease ownership was lost; retry with the same Idempotency-Key');
    }
    throw new EventCompletionUnavailableError();
  };
  const recoverCommitted = async (): Promise<{ body?: unknown; found: boolean }> => {
    if (recover === undefined) return { found: false };
    try {
      const body = await recover(mutationId);
      return body === undefined ? { found: false } : { body, found: true };
    } catch {
      throw new EventCompletionUnavailableError();
    }
  };

  const claim = await claimRequest();
  if (claim.state === 'completed') {
    response.status(claim.response.status).json(claim.response.body);
    return;
  }
  if (claim.state === 'in_progress') {
    throw new AppError('VALIDATION_ERROR', 409, 'A request with this Idempotency-Key is already in progress');
  }
  let leaseToken: string;
  if (claim.state === 'expired') {
    const reclaimedLeaseToken = await idempotency.reclaimExpired(idempotencyRequest);
    if (reclaimedLeaseToken === undefined) {
      throw new AppError('VALIDATION_ERROR', 409, 'A request with this Idempotency-Key is already in progress');
    }
    leaseToken = reclaimedLeaseToken;
    const recovered = await recoverCommitted();
    if (recovered.found) {
      await persistCompletion(recovered.body, leaseToken);
      return;
    }
  } else {
    leaseToken = claim.leaseToken;
  }

  try {
    const body = await action(mutationId);
    await persistCompletion(body, leaseToken);
  } catch (error) {
    if (error instanceof EventCompletionUnavailableError) throw error;
    const recovered = await recoverCommitted();
    if (recovered.found) {
      await persistCompletion(recovered.body, leaseToken);
      return;
    }
    if (error instanceof AppError && error.status === 503) {
      const released = await idempotency.releaseOwned(idempotencyRequest, leaseToken);
      if (released.state === 'completed') {
        response.status(released.response.status).json(released.response.body);
        return;
      }
      if (released.state === 'ownership_lost') {
        throw new AppError(
          'VALIDATION_ERROR',
          409,
          'Event mutation lease ownership was lost; retry with the same Idempotency-Key',
        );
      }
    }
    throw error;
  }
}

export function createTeacherEventsController(
  service: EventsService,
  idempotency: IdempotencyStore,
) {
  return {
    archiveEvent: async (request: Request, response: Response): Promise<void> => {
      const identity = teacherIdentity(request);
      const { eventId } = eventIdParamsSchema.parse(request.params);
      await service.archiveEvent(identity, eventId);
      response.status(204).end();
    },
    createEvent: async (request: Request, response: Response): Promise<void> => {
      const identity = teacherIdentity(request);
      const input = createEventSchema.parse(request.body);
      await runIdempotentEventMutation(
        idempotency,
        request,
        response,
        identity,
        'teacher-events:create',
        201,
        (mutationId) => service.createEvent(identity, mutationId, input),
        (mutationId) => service.recoverCreatedEvent(identity, mutationId),
      );
    },
    listClassOptions: async (request: Request, response: Response): Promise<void> => {
      response.status(200).json(await service.listClassOptions(teacherIdentity(request)));
    },
    listMemberOptions: async (request: Request, response: Response): Promise<void> => {
      response.status(200).json(await service.listMemberOptions(
        teacherIdentity(request),
        eventMemberOptionsQuerySchema.parse(request.query),
      ));
    },
    requestResourceUploadSession: async (request: Request, response: Response): Promise<void> => {
      const identity = teacherIdentity(request);
      const { eventId } = eventIdParamsSchema.parse(request.params);
      response.status(201).json(await service.requestResourceUploadSession(
        identity, eventId, eventResourceUploadSchema.parse(request.body),
      ));
    },
    confirmResourceUpload: async (request: Request, response: Response): Promise<void> => {
      const identity = teacherIdentity(request);
      const { eventId, sessionId } = eventResourceSessionParamsSchema.parse(request.params);
      emptyEventsMutationSchema.parse(request.body);
      response.status(201).json(await service.confirmResourceUpload(identity, eventId, sessionId));
    },
    deleteResource: async (request: Request, response: Response): Promise<void> => {
      const identity = teacherIdentity(request);
      const { eventId, resourceId } = eventResourceParamsSchema.parse(request.params);
      await service.deleteResource(identity, eventId, resourceId);
      response.status(204).end();
    },
    createManagedTeam: async (request: Request, response: Response): Promise<void> => {
      const identity = teacherIdentity(request);
      const { eventId } = eventIdParamsSchema.parse(request.params);
      const input = eventTeamSchema.parse(request.body);
      await runIdempotentEventMutation(
        idempotency,
        request,
        response,
        identity,
        `teacher-events:create-team:${eventId}`,
        201,
        (mutationId) => service.createManagedTeam(identity, eventId, mutationId, input),
        (mutationId) => service.recoverCreatedManagedTeam(identity, eventId, mutationId),
        eventTeamIdempotencyMessages,
      );
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
      const input = updateEventSchema.parse(request.body);
      await runIdempotentEventMutation(
        idempotency,
        request,
        response,
        identity,
        `teacher-events:update:${eventId}`,
        200,
        (mutationId) => service.updateEvent(identity, eventId, input, mutationId),
        (mutationId) => service.recoverUpdatedEvent(identity, eventId, input, mutationId),
      );
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
