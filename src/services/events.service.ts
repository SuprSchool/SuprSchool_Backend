import type {
  CreateEventInput,
  CreateEventResourceUploadInput,
  EventClassOption,
  EventMemberOptionsPage,
  EventMemberOptionsQuery,
  EventManagingMember,
  EventManagingMemberInput,
  EventParticipant,
  EventResource,
  EventResourceRead,
  EventResourceUploadSession,
  EventResultsState,
  EventScoreInput,
  EventTeam,
  EventTeamInput,
  EventTeamReplacementInput,
  EventsIdentity,
  PublishedEventResults,
  RegistrationResult,
  StoredStudentEventParticipant,
  StudentEventDetail,
  StudentEventParticipant,
  StudentEventsQuery,
  TeacherEventDetail,
  TeacherEventsQuery,
  UpdateEventInput,
} from '../types/events.js';
import type { EventsRepository, StoredEventResource } from '../db/repositories/events.repository.js';
import { AppError } from '../lib/errors.js';
import { pointAwardRuleCodes, type PointAwardPort } from './point-award.service.js';

export interface EventFilePort {
  createReadUrl(bucket: 'academic-files', objectPath: string, expiresInSeconds?: 900): Promise<string>;
  createUpload(identity: EventsIdentity, input: {
    bucket: 'academic-files';
    contentType: string;
    displayName: string;
    parentId: string;
    parentType: 'event-resource';
    sizeBytes: number;
  }): Promise<{ expiresAt: string; id: string; objectPath: string; signedUploadUrl: string }>;
  deleteObject(bucket: 'academic-files', objectPath: string): Promise<void>;
  finalizeUpload(identity: EventsIdentity, uploadSessionId: string): Promise<void>;
  prepareUpload(identity: EventsIdentity, input: {
    parentId: string;
    parentType: 'event-resource';
    uploadSessionId: string;
  }): Promise<{ contentType: string; displayName: string; id: string; objectPath: string }>;
}

/**
 * The read half of the avatar mechanism the profile and home services already
 * use: object paths live in the `avatars` bucket and are only ever handed to a
 * client as a short-lived signed URL.
 */
export interface EventAvatarUrlSigner {
  createSignedDownloadUrl(bucket: string, objectPath: string): Promise<string>;
}

export interface EventsService {
  archiveEvent(identity: EventsIdentity, eventId: string): Promise<void>;
  createEvent(identity: EventsIdentity, eventId: string, input: CreateEventInput): Promise<TeacherEventDetail>;
  createTeam(identity: EventsIdentity, eventId: string, teamId: string, input: EventTeamInput): Promise<EventTeam>;
  createManagedTeam(identity: EventsIdentity, eventId: string, teamId: string, input: EventTeamInput): Promise<EventTeam>;
  deleteTeam(identity: EventsIdentity, eventId: string, teamId: string): Promise<void>;
  confirmResourceUpload(identity: EventsIdentity, eventId: string, uploadSessionId: string): Promise<EventResource>;
  deleteResource(identity: EventsIdentity, eventId: string, resourceId: string): Promise<void>;
  getStudentEvent(identity: EventsIdentity, eventId: string): Promise<StudentEventDetail>;
  getStudentResults(identity: EventsIdentity, eventId: string): Promise<EventResultsState>;
  getStudentTeam(identity: EventsIdentity, eventId: string, teamId: string): Promise<EventTeam>;
  getTeacherEvent(identity: EventsIdentity, eventId: string): Promise<TeacherEventDetail>;
  getTeacherResults(identity: EventsIdentity, eventId: string): Promise<EventResultsState>;
  listStudentParticipants(identity: EventsIdentity, eventId: string): Promise<StudentEventParticipant[]>;
  listStudentTeams(identity: EventsIdentity, eventId: string): Promise<EventTeam[]>;
  listParticipants(identity: EventsIdentity, eventId: string): Promise<EventParticipant[]>;
  listClassOptions(identity: EventsIdentity): Promise<{ items: EventClassOption[] }>;
  listMemberOptions(identity: EventsIdentity, query: EventMemberOptionsQuery): Promise<EventMemberOptionsPage>;
  listStudentEvents(identity: EventsIdentity, query: StudentEventsQuery): Promise<unknown>;
  listTeacherEvents(identity: EventsIdentity, query: TeacherEventsQuery): Promise<unknown>;
  listTeams(identity: EventsIdentity, eventId: string): Promise<EventTeam[]>;
  publishResults(identity: EventsIdentity, eventId: string): Promise<PublishedEventResults>;
  requestResourceUploadSession(identity: EventsIdentity, eventId: string, input: CreateEventResourceUploadInput): Promise<EventResourceUploadSession>;
  recoverCreatedEvent(identity: EventsIdentity, eventId: string): Promise<TeacherEventDetail | undefined>;
  recoverCreatedStudentTeam(identity: EventsIdentity, eventId: string, teamId: string): Promise<EventTeam | undefined>;
  recoverCreatedManagedTeam(identity: EventsIdentity, eventId: string, teamId: string): Promise<EventTeam | undefined>;
  recoverUpdatedEvent(
    identity: EventsIdentity,
    eventId: string,
    input: UpdateEventInput,
    mutationId: string,
  ): Promise<TeacherEventDetail | undefined>;
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
    mutationId: string,
  ): Promise<TeacherEventDetail>;
  writeScores(
    identity: EventsIdentity,
    eventId: string,
    entries: EventScoreInput[],
  ): Promise<{ revision: number }>;
}

export function createEventsService(
  { avatarUrlSigner, files, repository, pointAwards }: {
    avatarUrlSigner?: EventAvatarUrlSigner;
    files: EventFilePort;
    repository: EventsRepository;
    pointAwards?: PointAwardPort;
  },
): EventsService {
  if (files === undefined) throw new Error('Events service requires file storage');
  if (repository === undefined) throw new Error('Events service requires a repository');

  function requireRepository(): EventsRepository {
    return repository;
  }

  function requireFiles(): EventFilePort {
    return files;
  }

  async function signResources(resources: StoredEventResource[]): Promise<EventResourceRead[]> {
    return Promise.all(resources.map(async ({ objectPath, ...resource }) => ({
      ...resource,
      signedUrl: await files.createReadUrl('academic-files', objectPath, 900),
    })));
  }

  function splitResources(resources: EventResourceRead[]) {
    return {
      banner: resources.find((resource) => resource.kind === 'banner') ?? null,
      resources: resources.filter((resource) => resource.kind === 'attachment'),
    };
  }

  async function requireStudentEvent(identity: EventsIdentity, eventId: string): Promise<StudentEventDetail> {
    const event = await requireRepository().getStudentEvent(identity, eventId);
    if (event === undefined) throw new AppError('NOT_FOUND', 404, 'Event not found');
    const [resources, managingTeam] = await Promise.all([
      requireRepository().listStudentResources(identity, eventId).then(signResources),
      requireRepository().listStudentManagingTeam(identity, eventId),
    ]);
    return { ...event, ...splitResources(resources), managingTeam };
  }

  async function requireTeacherEvent(identity: EventsIdentity, eventId: string): Promise<TeacherEventDetail> {
    const event = await requireRepository().getTeacherEvent(identity, eventId);
    if (event === undefined) throw new AppError('NOT_FOUND', 404, 'Event not found');
    const [resources, managingTeam] = await Promise.all([
      requireRepository().listTeacherResources(identity, eventId).then(signResources),
      requireRepository().listManagingTeam(identity, eventId),
    ]);
    return { ...event, ...splitResources(resources), managingTeam };
  }

  function publicResource(stored: StoredEventResource): EventResource {
    const { objectPath, ...resource } = stored;
    void objectPath;
    return resource;
  }

  async function requireStudentTeam(identity: EventsIdentity, eventId: string, teamId: string): Promise<EventTeam> {
    const team = await requireRepository().getStudentTeam(identity, eventId, teamId);
    if (team === undefined) {
      throw new AppError('NOT_FOUND', 404, 'Team not found');
    }
    return team;
  }

  /**
   * A leaderboard is worth more than one avatar, so a path that will not sign —
   * an object retired behind a stale profile row, or storage being unreachable —
   * degrades that row to the initials disc instead of failing the whole list.
   * The one thing never returned is a URL that would not load.
   */
  async function signParticipantAvatar(objectPath: string | null): Promise<string | null> {
    if (objectPath === null || avatarUrlSigner === undefined) return null;
    try {
      return await avatarUrlSigner.createSignedDownloadUrl('avatars', objectPath);
    } catch {
      return null;
    }
  }

  async function requireStudentParticipants(identity: EventsIdentity, eventId: string): Promise<StudentEventParticipant[]> {
    const participants = await requireRepository().listStudentParticipants(identity, eventId);
    if (participants === undefined) {
      throw new AppError('NOT_FOUND', 404, 'Event not found');
    }
    return Promise.all(participants.map(async (
      { avatarObjectPath, ...participant }: StoredStudentEventParticipant,
    ): Promise<StudentEventParticipant> => ({
      ...participant,
      avatarUrl: await signParticipantAvatar(avatarObjectPath),
    })));
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
    async createEvent(identity, eventId, input) {
      const created = await requireRepository().createEvent(identity, eventId, input);
      return requireTeacherEvent(identity, created.id);
    },
    async createTeam(identity, eventId, teamId, input) {
      if (new Set(input.memberStudentIds).size !== input.memberStudentIds.length) {
        throw new AppError('VALIDATION_ERROR', 400, 'A team cannot contain the same student twice');
      }
      if (!input.memberStudentIds.includes(identity.userId)) {
        throw new AppError('VALIDATION_ERROR', 400, 'The student creating a team must be a member');
      }
      return requireRepository().createTeam(identity, eventId, teamId, input);
    },
    createManagedTeam: (identity, eventId, teamId, input) => requireRepository().createManagedTeam(identity, eventId, teamId, input),
    async confirmResourceUpload(identity, eventId, uploadSessionId) {
      if (!await requireRepository().canManage(identity, eventId)) {
        throw new AppError('FORBIDDEN', 403, 'Only the event owner can manage resources');
      }
      await requireFiles().prepareUpload(identity, {
        parentId: eventId,
        parentType: 'event-resource',
        uploadSessionId,
      });
      const resource = await requireRepository().confirmResourceUpload(identity, eventId, uploadSessionId);
      if (resource === undefined) throw new AppError('NOT_FOUND', 404, 'Event resource upload was not found');
      await requireFiles().finalizeUpload(identity, uploadSessionId);
      return publicResource(resource);
    },
    async deleteResource(identity, eventId, resourceId) {
      const resource = await requireRepository().findResourceForDeletion(identity, eventId, resourceId);
      if (resource === undefined) return;
      await requireFiles().deleteObject('academic-files', resource.objectPath);
      await requireRepository().deleteResource(identity, eventId, resourceId);
    },
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
    async listClassOptions(identity) {
      return { items: await requireRepository().listClassOptions(identity) };
    },
    listMemberOptions: (identity, query) => requireRepository().listMemberOptions(identity, query),
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
    recoverCreatedStudentTeam: (identity, eventId, teamId) => (
      requireRepository().recoverCreatedStudentTeam(identity, eventId, teamId)
    ),
    recoverCreatedManagedTeam: (identity, eventId, teamId) => requireRepository().recoverCreatedManagedTeam(identity, eventId, teamId),
    async recoverCreatedEvent(identity, eventId) {
      const recovered = await requireRepository().recoverCreatedEvent(identity, eventId);
      return recovered === undefined ? undefined : requireTeacherEvent(identity, eventId);
    },
    async recoverUpdatedEvent(identity, eventId, input, mutationId) {
      const recovered = await requireRepository().recoverUpdatedEvent(identity, eventId, input, mutationId);
      return recovered === undefined ? undefined : requireTeacherEvent(identity, eventId);
    },
    async requestResourceUploadSession(identity, eventId, input) {
      if (!await requireRepository().canManage(identity, eventId)) {
        throw new AppError('FORBIDDEN', 403, 'Only the event owner can manage resources');
      }
      const session = await requireFiles().createUpload(identity, {
        bucket: 'academic-files',
        contentType: input.contentType,
        displayName: input.displayName,
        parentId: eventId,
        parentType: 'event-resource',
        sizeBytes: input.sizeBytes,
      });
      const stored = await requireRepository().createPendingResource({
        contentType: input.contentType,
        displayName: input.displayName,
        eventId,
        identity,
        kind: input.kind,
        objectPath: session.objectPath,
        sizeBytes: input.sizeBytes,
        sortOrder: input.sortOrder,
        uploadSessionId: session.id,
      });
      if (!stored) throw new AppError('FORBIDDEN', 403, 'Only the event owner can manage resources');
      return {
        expiresAt: session.expiresAt,
        objectPath: session.objectPath,
        signedUploadUrl: session.signedUploadUrl,
        uploadSessionId: session.id,
      };
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
    async updateEvent(identity, eventId, input, mutationId) {
      await requireRepository().updateEvent(identity, eventId, input, mutationId);
      return requireTeacherEvent(identity, eventId);
    },
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
