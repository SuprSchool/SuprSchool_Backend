export type EventActivityKind = 'event' | 'competition';
export type EventLifecycle = 'draft' | 'published' | 'archived' | 'completed';
export type EventParticipationMode = 'solo' | 'team';
export type EventStudentFilter = 'trending' | 'upcoming' | 'registered' | 'completed';
export type EventTeacherScope = 'all' | 'my' | 'upcoming' | 'completed';
export type EventTeacherStatus = 'upcoming' | 'completed';
export type EventManagerMemberType = 'teacher' | 'student';
export type EventResultTargetType = 'registration' | 'team';

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
  category: string | null;
  createdAt: string;
  endsAt: string | null;
  id: string;
  lifecycle: EventLifecycle;
  participationMode: EventParticipationMode | null;
  registrationDeadlineAt: string | null;
  startsAt: string;
  title: string;
  venue: string | null;
}

export interface StudentEventSummary extends EventSummary {
  registration: EventRegistrationState | null;
}

export interface EventPage<TItem extends EventSummary> {
  items: TItem[];
  nextCursor: string | null;
}

export interface StudentEventDetail extends StudentEventSummary {
  description: string | null;
  eligibilityCriteria: string | null;
  eligibilityRules: EventEligibilityRules;
  targetClassIds: string[];
}

export interface TeacherEventDetail extends EventSummary {
  description: string | null;
  eligibilityCriteria: string | null;
  eligibilityRules: EventEligibilityRules;
  isOwned: boolean;
  targetClassIds: string[];
}

export interface CreateEventInput {
  activityKind: EventActivityKind;
  category?: string | undefined;
  description?: string | undefined;
  eligibilityCriteria?: string | undefined;
  endsAt?: string | undefined;
  lifecycle?: Extract<EventLifecycle, 'draft' | 'published'> | undefined;
  participationMode?: EventParticipationMode | undefined;
  registrationDeadlineAt?: string | undefined;
  startsAt: string;
  targetClassIds: string[];
  title: string;
  venue?: string | undefined;
}

export interface UpdateEventInput {
  activityKind?: EventActivityKind | undefined;
  category?: string | null | undefined;
  description?: string | null | undefined;
  eligibilityCriteria?: string | null | undefined;
  endsAt?: string | null | undefined;
  lifecycle?: EventLifecycle | undefined;
  participationMode?: EventParticipationMode | null | undefined;
  registrationDeadlineAt?: string | null | undefined;
  startsAt?: string | undefined;
  targetClassIds?: string[] | undefined;
  title?: string | undefined;
  venue?: string | null | undefined;
}

export interface EventManagingMemberInput {
  memberType: EventManagerMemberType;
  role: string;
  userId: string;
}

export interface EventManagingMember extends EventManagingMemberInput {
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
