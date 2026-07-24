import type {
  CreateEventInput,
  EventManagingMember,
  EventManagingMemberInput,
  EventParticipant,
  EventResultsState,
  EventScoreInput,
  EventTeam,
  EventTeamInput,
  EventTeamReplacementInput,
  EventsIdentity,
  PublishedEventResults,
  RegistrationResult,
  StudentEventDetail,
  StudentEventsQuery,
  TeacherEventDetail,
  TeacherEventsQuery,
  UpdateEventInput,
} from '../types/events.js';
import type { EventsRepository } from '../db/repositories/events.repository.js';
import { AppError } from '../lib/errors.js';
import { pointAwardRuleCodes, type PointAwardPort } from './point-award.service.js';

export interface EventsService {
  archiveEvent(identity: EventsIdentity, eventId: string): Promise<void>;
  createEvent(identity: EventsIdentity, input: CreateEventInput): Promise<TeacherEventDetail>;
  createTeam(identity: EventsIdentity, eventId: string, input: EventTeamInput): Promise<EventTeam>;
  createManagedTeam(identity: EventsIdentity, eventId: string, input: EventTeamInput): Promise<EventTeam>;
  deleteTeam(identity: EventsIdentity, eventId: string, teamId: string): Promise<void>;
  getStudentEvent(identity: EventsIdentity, eventId: string): Promise<StudentEventDetail>;
  getStudentResults(identity: EventsIdentity, eventId: string): Promise<EventResultsState>;
  getStudentTeam(identity: EventsIdentity, eventId: string, teamId: string): Promise<EventTeam>;
  getTeacherEvent(identity: EventsIdentity, eventId: string): Promise<TeacherEventDetail>;
  getTeacherResults(identity: EventsIdentity, eventId: string): Promise<EventResultsState>;
  listStudentParticipants(identity: EventsIdentity, eventId: string): Promise<EventParticipant[]>;
  listStudentTeams(identity: EventsIdentity, eventId: string): Promise<EventTeam[]>;
  listParticipants(identity: EventsIdentity, eventId: string): Promise<EventParticipant[]>;
  listStudentEvents(identity: EventsIdentity, query: StudentEventsQuery): Promise<unknown>;
  listTeacherEvents(identity: EventsIdentity, query: TeacherEventsQuery): Promise<unknown>;
  listTeams(identity: EventsIdentity, eventId: string): Promise<EventTeam[]>;
  publishResults(identity: EventsIdentity, eventId: string): Promise<PublishedEventResults>;
  registerStudent(identity: EventsIdentity, eventId: string): Promise<RegistrationResult>;
  tagParticipation(identity: EventsIdentity, eventId: string, studentId: string, tag: string | null): Promise<{ tag: string | null }>;
  replaceManagingTeam(
    identity: EventsIdentity,
    eventId: string,
    members: EventManagingMemberInput[],
  ): Promise<EventManagingMember[]>;
  replaceTeams(
    identity: EventsIdentity,
    eventId: string,
    teams: EventTeamReplacementInput[],
  ): Promise<EventTeam[]>;
  replaceTeamMembers(
    identity: EventsIdentity,
    eventId: string,
    teamId: string,
    memberStudentIds: string[],
  ): Promise<EventTeam>;
  updateEvent(
    identity: EventsIdentity,
    eventId: string,
    input: UpdateEventInput,
  ): Promise<TeacherEventDetail>;
  writeScores(
    identity: EventsIdentity,
    eventId: string,
    entries: EventScoreInput[],
  ): Promise<{ revision: number }>;
}

export function createEventsService(
  { repository, pointAwards }: { repository?: EventsRepository; pointAwards?: PointAwardPort } = {},
): EventsService {
  function requireRepository(): EventsRepository {
    if (repository === undefined) {
      throw new Error('Events service requires a repository before it is invoked');
    }
    return repository;
  }

  async function requireStudentEvent(identity: EventsIdentity, eventId: string): Promise<StudentEventDetail> {
    const event = await requireRepository().getStudentEvent(identity, eventId);
    if (event === undefined) {
      throw new AppError('NOT_FOUND', 404, 'Event not found');
    }
    return event;
  }

  async function requireTeacherEvent(identity: EventsIdentity, eventId: string): Promise<TeacherEventDetail> {
    const event = await requireRepository().getTeacherEvent(identity, eventId);
    if (event === undefined) {
      throw new AppError('NOT_FOUND', 404, 'Event not found');
    }
    return event;
  }

  async function requireStudentTeam(identity: EventsIdentity, eventId: string, teamId: string): Promise<EventTeam> {
    const team = await requireRepository().getStudentTeam(identity, eventId, teamId);
    if (team === undefined) {
      throw new AppError('NOT_FOUND', 404, 'Team not found');
    }
    return team;
  }

  async function requireStudentParticipants(identity: EventsIdentity, eventId: string): Promise<EventParticipant[]> {
    const participants = await requireRepository().listStudentParticipants(identity, eventId);
    if (participants === undefined) {
      throw new AppError('NOT_FOUND', 404, 'Event not found');
    }
    return participants;
  }

  async function requireStudentTeams(identity: EventsIdentity, eventId: string): Promise<EventTeam[]> {
    const teams = await requireRepository().listStudentTeams(identity, eventId);
    if (teams === undefined) {
      throw new AppError('NOT_FOUND', 404, 'Event not found');
    }
    return teams;
  }

  return {
    archiveEvent: (identity, eventId) => requireRepository().archiveEvent(identity, eventId),
    createEvent: (identity, input) => requireRepository().createEvent(identity, input),
    async createTeam(identity, eventId, input) {
      if (new Set(input.memberStudentIds).size !== input.memberStudentIds.length) {
        throw new AppError('VALIDATION_ERROR', 400, 'A team cannot contain the same student twice');
      }
      if (!input.memberStudentIds.includes(identity.userId)) {
        throw new AppError('VALIDATION_ERROR', 400, 'The student creating a team must be a member');
      }
      return requireRepository().createTeam(identity, eventId, input);
    },
    createManagedTeam: (identity, eventId, input) => requireRepository().createManagedTeam(identity, eventId, input),
    deleteTeam: (identity, eventId, teamId) => requireRepository().deleteTeam(identity, eventId, teamId),
    getStudentEvent: requireStudentEvent,
    getStudentTeam: requireStudentTeam,
    listStudentParticipants: requireStudentParticipants,
    listStudentTeams: requireStudentTeams,
    async getStudentResults(identity, eventId) {
      const results = await requireRepository().getStudentResults(identity, eventId);
      if (results === undefined) {
        throw new AppError('NOT_FOUND', 404, 'Published results not found');
      }
      return results;
    },
    getTeacherEvent: requireTeacherEvent,
    getTeacherResults: (identity, eventId) => requireRepository().getTeacherResults(identity, eventId),
    listParticipants: (identity, eventId) => requireRepository().listParticipants(identity, eventId),
    listStudentEvents: (identity, query) => requireRepository().listStudentEvents(identity, query),
    listTeacherEvents: (identity, query) => requireRepository().listTeacherEvents(identity, query),
    listTeams: (identity, eventId) => requireRepository().listTeams(identity, eventId),
    async publishResults(identity, eventId) {
      const results = await requireRepository().publishResults(identity, eventId);
      if (pointAwards === undefined) return results;
      for (const recipient of await requireRepository().listPublishedResultAwardRecipients(identity, eventId)) {
        await pointAwards?.awardIfAbsent({
          metadata: { eventId, revision: results.revision },
          occurredAt: new Date(results.publishedAt),
          recipientUserId: recipient.studentId,
          ruleCode: pointAwardRuleCodes.eventResultPublished,
          schoolId: identity.schoolId,
          sourceId: recipient.resultId,
          sourceType: 'event_result',
        });
      }
      return results;
    },
    async registerStudent(identity, eventId) {
      const registration = await requireRepository().registerStudent(identity, eventId);
      await pointAwards?.awardIfAbsent({
        metadata: { eventId },
        occurredAt: new Date(registration.registeredAt),
        recipientUserId: identity.userId,
        ruleCode: pointAwardRuleCodes.eventRegistered,
        schoolId: identity.schoolId,
        sourceId: registration.id,
        sourceType: 'event_registration',
      });
      return registration;
    },
    tagParticipation: (identity, eventId, studentId, tag) => requireRepository().tagParticipation(identity, eventId, studentId, tag),
    replaceManagingTeam: (identity, eventId, members) => (
      requireRepository().replaceManagingTeam(identity, eventId, members)
    ),
    async replaceTeams(identity, eventId, teams) {
      const ids = teams.flatMap((team) => team.id === undefined ? [] : [team.id]);
      if (new Set(ids).size !== ids.length) {
        throw new AppError('VALIDATION_ERROR', 400, 'An event team can appear only once');
      }
      const names = teams.map((team) => team.name.trim().toLocaleLowerCase());
      if (new Set(names).size !== names.length) {
        throw new AppError('VALIDATION_ERROR', 400, 'Event team names must be unique');
      }
      const memberIds = teams.flatMap((team) => team.memberStudentIds);
      if (new Set(memberIds).size !== memberIds.length) {
        throw new AppError('VALIDATION_ERROR', 400, 'A student can belong to only one event team');
      }
      return requireRepository().replaceTeams(identity, eventId, teams);
    },
    replaceTeamMembers: (identity, eventId, teamId, memberStudentIds) => (
      requireRepository().replaceTeamMembers(identity, eventId, teamId, memberStudentIds)
    ),
    updateEvent: (identity, eventId, input) => (
      requireRepository().updateEvent(identity, eventId, input)
    ),
    async writeScores(identity, eventId, entries) {
      const seenTargets = new Set<string>();
      const targetType = entries[0]?.targetType;
      for (const entry of entries) {
        if (entry.targetType !== targetType) {
          throw new AppError('VALIDATION_ERROR', 400, 'A score replacement must contain one target type');
        }
        const key = `${entry.targetType}:${entry.targetId}`;
        if (seenTargets.has(key)) {
          throw new AppError('VALIDATION_ERROR', 400, 'A score target can appear only once');
        }
        seenTargets.add(key);
      }
      return requireRepository().writeScores(identity, eventId, entries);
    },
  };
}
