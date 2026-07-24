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
} from '../../types/events.js';

export interface EventsRepository {
  archiveEvent(identity: EventsIdentity, eventId: string): Promise<void>;
  createEvent(identity: EventsIdentity, input: CreateEventInput): Promise<TeacherEventDetail>;
  createTeam(identity: EventsIdentity, eventId: string, input: EventTeamInput): Promise<EventTeam>;
  createManagedTeam(identity: EventsIdentity, eventId: string, input: EventTeamInput): Promise<EventTeam>;
  deleteTeam(identity: EventsIdentity, eventId: string, teamId: string): Promise<void>;
  getStudentEvent(identity: EventsIdentity, eventId: string): Promise<StudentEventDetail | undefined>;
  getStudentResults(identity: EventsIdentity, eventId: string): Promise<EventResultsState | undefined>;
  getStudentTeam(identity: EventsIdentity, eventId: string, teamId: string): Promise<EventTeam | undefined>;
  getTeacherEvent(identity: EventsIdentity, eventId: string): Promise<TeacherEventDetail | undefined>;
  getTeacherResults(identity: EventsIdentity, eventId: string): Promise<EventResultsState>;
  listStudentParticipants(identity: EventsIdentity, eventId: string): Promise<EventParticipant[] | undefined>;
  listStudentTeams(identity: EventsIdentity, eventId: string): Promise<EventTeam[] | undefined>;
  listParticipants(identity: EventsIdentity, eventId: string): Promise<EventParticipant[]>;
  listPublishedResultAwardRecipients(identity: EventsIdentity, eventId: string): Promise<ReadonlyArray<{ resultId: string; studentId: string }>>;
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
