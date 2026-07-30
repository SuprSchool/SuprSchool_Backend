import type {
  CreateEventInput,
  EventClassOption,
  EventMemberOptionsPage,
  EventMemberOptionsQuery,
  EventResource,
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
} from '../../types/events.js';

export interface StoredEventResource extends EventResource {
  objectPath: string;
}

export type StoredStudentEventDetail = Omit<StudentEventDetail, 'banner' | 'managingTeam' | 'resources'>;
export type StoredTeacherEventDetail = Omit<TeacherEventDetail, 'banner' | 'managingTeam' | 'resources'>;

export interface EventsRepository {
  archiveEvent(identity: EventsIdentity, eventId: string): Promise<void>;
  canManage(identity: EventsIdentity, eventId: string): Promise<boolean>;
  createEvent(identity: EventsIdentity, eventId: string, input: CreateEventInput): Promise<StoredTeacherEventDetail>;
  createTeam(identity: EventsIdentity, eventId: string, teamId: string, input: EventTeamInput): Promise<EventTeam>;
  createManagedTeam(identity: EventsIdentity, eventId: string, teamId: string, input: EventTeamInput): Promise<EventTeam>;
  deleteTeam(identity: EventsIdentity, eventId: string, teamId: string): Promise<void>;
  confirmResourceUpload(identity: EventsIdentity, eventId: string, uploadSessionId: string): Promise<StoredEventResource | undefined>;
  createPendingResource(input: {
    contentType: string;
    displayName: string;
    eventId: string;
    identity: EventsIdentity;
    kind: 'attachment' | 'banner';
    objectPath: string;
    sizeBytes: number;
    sortOrder: number;
    uploadSessionId: string;
  }): Promise<boolean>;
  deleteResource(identity: EventsIdentity, eventId: string, resourceId: string): Promise<void>;
  findResourceForDeletion(identity: EventsIdentity, eventId: string, resourceId: string): Promise<StoredEventResource | undefined>;
  getStudentEvent(identity: EventsIdentity, eventId: string): Promise<StoredStudentEventDetail | undefined>;
  getStudentResults(identity: EventsIdentity, eventId: string): Promise<EventResultsState | undefined>;
  getStudentTeam(identity: EventsIdentity, eventId: string, teamId: string): Promise<EventTeam | undefined>;
  getTeacherEvent(identity: EventsIdentity, eventId: string): Promise<StoredTeacherEventDetail | undefined>;
  getTeacherResults(identity: EventsIdentity, eventId: string): Promise<EventResultsState>;
  listStudentParticipants(identity: EventsIdentity, eventId: string): Promise<EventParticipant[] | undefined>;
  listStudentManagingTeam(identity: EventsIdentity, eventId: string): Promise<EventManagingMember[]>;
  listStudentTeams(identity: EventsIdentity, eventId: string): Promise<EventTeam[] | undefined>;
  listParticipants(identity: EventsIdentity, eventId: string): Promise<EventParticipant[]>;
  listPublishedResultAwardRecipients(identity: EventsIdentity, eventId: string): Promise<ReadonlyArray<{ resultId: string; studentId: string }>>;
  listClassOptions(identity: EventsIdentity): Promise<EventClassOption[]>;
  listMemberOptions(identity: EventsIdentity, query: EventMemberOptionsQuery): Promise<EventMemberOptionsPage>;
  listManagingTeam(identity: EventsIdentity, eventId: string): Promise<EventManagingMember[]>;
  listStudentEvents(identity: EventsIdentity, query: StudentEventsQuery): Promise<unknown>;
  listStudentResources(identity: EventsIdentity, eventId: string): Promise<StoredEventResource[]>;
  listTeacherEvents(identity: EventsIdentity, query: TeacherEventsQuery): Promise<unknown>;
  listTeacherResources(identity: EventsIdentity, eventId: string): Promise<StoredEventResource[]>;
  listTeams(identity: EventsIdentity, eventId: string): Promise<EventTeam[]>;
  publishResults(identity: EventsIdentity, eventId: string): Promise<PublishedEventResults>;
  registerStudent(identity: EventsIdentity, eventId: string): Promise<RegistrationResult>;
  tagParticipation(identity: EventsIdentity, eventId: string, studentId: string, tag: string | null): Promise<{ tag: string | null }>;
  recoverCreatedEvent(identity: EventsIdentity, eventId: string): Promise<StoredTeacherEventDetail | undefined>;
  recoverCreatedStudentTeam(identity: EventsIdentity, eventId: string, teamId: string): Promise<EventTeam | undefined>;
  recoverCreatedManagedTeam(identity: EventsIdentity, eventId: string, teamId: string): Promise<EventTeam | undefined>;
  recoverUpdatedEvent(
    identity: EventsIdentity,
    eventId: string,
    input: UpdateEventInput,
    mutationId: string,
  ): Promise<StoredTeacherEventDetail | undefined>;
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
  ): Promise<StoredTeacherEventDetail>;
  writeScores(
    identity: EventsIdentity,
    eventId: string,
    entries: EventScoreInput[],
  ): Promise<{ revision: number }>;
}
