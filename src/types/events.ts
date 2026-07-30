export type EventActivityKind = 'event' | 'competition';
export type EventLifecycle = 'draft' | 'published' | 'archived' | 'completed';
export type EventParticipationMode = 'solo' | 'team';
export type EventStudentFilter = 'trending' | 'upcoming' | 'registered' | 'completed';
export type EventTeacherScope = 'all' | 'my' | 'upcoming' | 'completed';
export type EventTeacherStatus = 'upcoming' | 'completed';
export type EventManagerMemberType = 'teacher' | 'student';
export type EventResultTargetType = 'registration' | 'team';
export type EventAudienceType = 'classes' | 'school';
export type EventGenderEligibility = 'female' | 'male' | 'mixed';
export type EventMemberRole = 'student' | 'teacher';
export type EventResourceKind = 'attachment' | 'banner';

export interface EventsIdentity {
  schoolId: string;
  userId: string;
}

export interface EventsCursor {
  createdAt: string;
  id: string;
}

export interface EventsPageQuery {
  cursor?: EventsCursor | undefined;
  limit: number;
}

export interface StudentEventsQuery extends EventsPageQuery {
  filter: EventStudentFilter;
}

export interface TeacherEventsQuery extends EventsPageQuery {
  scope: EventTeacherScope;
  status?: EventTeacherStatus | undefined;
}

export interface EventEligibilityRules {
  targetClassIds: string[];
}

export interface EventRegistrationState {
  id: string;
  registeredAt: string;
  teamId: string | null;
  teamName: string | null;
}

export interface EventSummary {
  activityKind: EventActivityKind;
  audienceType: EventAudienceType;
  category: string | null;
  createdAt: string;
  isOwned: boolean;
  endsAt: string | null;
  genderEligibility: EventGenderEligibility;
  id: string;
  lifecycle: EventLifecycle;
  participationMode: EventParticipationMode | null;
  registrationDeadlineAt: string;
  startsAt: string;
  title: string;
  targetClassIds: string[];
  venue: string | null;
}

export interface StudentEventSummary extends EventSummary {
  registration: EventRegistrationState | null;
}

export interface EventPage<TItem extends EventSummary> {
  items: TItem[];
  nextCursor: string | null;
}

export interface EventResource {
  contentType: string;
  id: string;
  kind: EventResourceKind;
  name: string;
  sizeBytes: number;
  sortOrder: number;
}

export interface EventResourceRead extends EventResource {
  signedUrl: string;
}

export interface EventResourceUploadSession {
  expiresAt: string;
  objectPath: string;
  signedUploadUrl: string;
  uploadSessionId: string;
}

export interface CreateEventResourceUploadInput {
  contentType: string;
  displayName: string;
  kind: EventResourceKind;
  sizeBytes: number;
  sortOrder: number;
}

export interface EventClassOption {
  classId: string;
  label: string;
}
export interface EventMemberCursor {
  displayNameKey: string;
  userId: string;
}

export interface EventMemberOptionsPage {
  items: EventMemberOption[];
  nextCursor: string | null;
}


export interface EventMemberOption {
  displayName: string;
  role: EventMemberRole;
  userId: string;
}

export interface EventMemberOptionsQuery {
  cursor?: EventMemberCursor | undefined;
  limit: number;
  role?: EventMemberRole | undefined;
  search?: string | undefined;
}

export interface StudentEventDetail extends StudentEventSummary {
  banner: EventResourceRead | null;
  description: string | null;
  eligibilityCriteria: string | null;
  eligibilityRules: EventEligibilityRules;
  managingTeam: EventManagingMember[];
  targetClassIds: string[];
  resources: EventResourceRead[];
  rulesAndRegulations: string | null;
}

export interface TeacherEventDetail extends EventSummary {
  banner: EventResourceRead | null;
  description: string | null;
  eligibilityCriteria: string | null;
  eligibilityRules: EventEligibilityRules;
  isOwned: boolean;
  managingTeam: EventManagingMember[];
  targetClassIds: string[];
  resources: EventResourceRead[];
  rulesAndRegulations: string | null;
}

export interface CreateEventInput {
  activityKind: EventActivityKind;
  audienceType?: EventAudienceType | undefined;
  category?: string | undefined;
  description?: string | undefined;
  eligibilityCriteria?: string | undefined;
  endsAt?: string | undefined;
  genderEligibility?: EventGenderEligibility | undefined;
  lifecycle?: Extract<EventLifecycle, 'draft' | 'published'> | undefined;
  participationMode?: EventParticipationMode | undefined;
  registrationDeadlineAt: string;
  rulesAndRegulations?: string | undefined;
  startsAt: string;
  targetClassIds: string[];
  title: string;
  venue?: string | undefined;
}

export interface UpdateEventInput {
  activityKind?: EventActivityKind | undefined;
  audienceType?: EventAudienceType | undefined;
  category?: string | null | undefined;
  description?: string | null | undefined;
  eligibilityCriteria?: string | null | undefined;
  endsAt?: string | null | undefined;
  lifecycle?: Exclude<EventLifecycle, 'archived'> | undefined;
  genderEligibility?: EventGenderEligibility | undefined;
  participationMode?: EventParticipationMode | null | undefined;
  registrationDeadlineAt?: string | undefined;
  rulesAndRegulations?: string | null | undefined;
  startsAt?: string | undefined;
  targetClassIds?: string[] | undefined;
  title?: string | undefined;
  venue?: string | null | undefined;
}

export interface EventManagingMemberInput {
  memberType: EventManagerMemberType;
  role: string;
  contact?: string | null | undefined;
  userId: string;
}

export interface EventManagingMember extends EventManagingMemberInput {
  contact: string | null;
  displayName: string;
}

export interface EventTeamInput {
  memberStudentIds: string[];
  name: string;
}

export interface EventTeamReplacementInput extends EventTeamInput {
  id?: string | undefined;
}

export interface EventTeam {
  id: string;
  memberCount: number;
  name: string;
}

export interface EventParticipant {
  className: string;
  participationTag: string | null;
  registrationId: string;
  registeredAt: string;
  studentId: string;
  studentName: string;
  teamId: string | null;
  teamName: string | null;
}

export interface EventScoreInput {
  score: number | null;
  targetId: string;
  targetType: EventResultTargetType;
}

export interface EventResultEntry {
  rank: number | null;
  score: number | null;
  targetId: string;
  targetName: string;
  targetType: EventResultTargetType;
}

export interface PublishedEventResults {
  entries: EventResultEntry[];
  publishedAt: string;
  revision: number;
}

export interface EventResultsState {
  entries: EventResultEntry[];
  publishedAt: string | null;
  revision: number;
}

export interface RegistrationResult extends EventRegistrationState {
  created: boolean;
}

export interface EventsOutboxRecord {
  eventId: string;
  eventType: string;
  occurredAt: string;
  payload: Record<string, unknown>;
  schoolId: string;
  sourceKey: string;
}
