import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';

import type { Database } from '../client.js';
import { AppError } from '../../lib/errors.js';
import { encodeEventsCursor } from '../../validators/events.schemas.js';
import type {
  CreateEventInput,
  EventManagingMember,
  EventManagingMemberInput,
  EventPage,
  EventParticipant,
  EventResultsState,
  EventScoreInput,
  EventSummary,
  EventTeam,
  EventTeamInput,
  EventTeamReplacementInput,
  EventsIdentity,
  PublishedEventResults,
  RegistrationResult,
  StudentEventDetail,
  StudentEventSummary,
  StudentEventsQuery,
  TeacherEventDetail,
  TeacherEventsQuery,
  UpdateEventInput,
} from '../../types/events.js';
import type { EventsRepository } from './events.repository.js';

type Executor = Pick<Database, 'execute'>;

interface EventRow {
  activityKind: EventSummary['activityKind'];
  category: string | null;
  createdAt: string;
  createdByTeacherId: string;
  description: string | null;
  eligibilityCriteria: string | null;
  endsAt: string | null;
  id: string;
  lifecycle: EventSummary['lifecycle'];
  participationMode: EventSummary['participationMode'];
  registrationDeadlineAt: string | null;
  resultsPublishedAt: string | null;
  resultsRevision: number;
  startsAt: string;
  targetClassIds: string[];
  title: string;
  venue: string | null;
}

interface RegistrationRow {
  id: string;
  registeredAt: string;
  teamId: string | null;
  teamName: string | null;
}

function rows<T>(result: unknown): T[] {
  return result as T[];
}

function forbid(message: string): never {
  throw new AppError('FORBIDDEN', 403, message);
}

function eventSummary(row: EventRow): EventSummary {
  return {
    activityKind: row.activityKind,
    category: row.category,
    createdAt: row.createdAt,
    endsAt: row.endsAt,
    id: row.id,
    lifecycle: row.lifecycle,
    participationMode: row.participationMode,
    registrationDeadlineAt: row.registrationDeadlineAt,
    startsAt: row.startsAt,
    title: row.title,
    venue: row.venue,
  };
}

function page<T extends EventSummary>(items: T[], limit: number): EventPage<T> {
  const hasMore = items.length > limit;
  const values = hasMore ? items.slice(0, limit) : items;
  const last = values.at(-1);
  return {
    items: values,
    nextCursor: hasMore && last ? encodeEventsCursor({ createdAt: last.createdAt, id: last.id }) : null,
  };
}

function uuidArray(values: readonly string[]) {
  return sql`array[${sql.join(values.map((value) => sql`${value}::uuid`), sql`, `)}]::uuid[]`;
}

function outboxUuid(sourceKey: string) {
  return sql`(
    substr(md5(${sourceKey}), 1, 8) || '-' || substr(md5(${sourceKey}), 9, 4) || '-' ||
    substr(md5(${sourceKey}), 13, 4) || '-' || substr(md5(${sourceKey}), 17, 4) || '-' ||
    substr(md5(${sourceKey}), 21, 12)
  )::uuid`;
}

async function writeOutbox(
  executor: Executor,
  schoolId: string,
  eventType: string,
  sourceKey: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await executor.execute(sql`
    insert into public.event_domain_outbox (event_id, school_id, event_type, source_key, payload)
    values (${outboxUuid(sourceKey)}, ${schoolId}::uuid, ${eventType}, ${sourceKey}, ${JSON.stringify(payload)}::jsonb)
    on conflict (source_key) do nothing
  `);
}

function eventSourceKey(eventId: string, action: string, fingerprint: string): string {
  return `event:${eventId}:${action}:${createHash('sha256').update(fingerprint).digest('hex')}`;
}

function canonicalManagingMembers(members: readonly EventManagingMemberInput[]): EventManagingMemberInput[] {
  return [...members]
    .map((member) => ({ memberType: member.memberType, role: member.role, userId: member.userId }))
    .sort((left, right) => (
      left.userId.localeCompare(right.userId)
      || left.memberType.localeCompare(right.memberType)
      || left.role.localeCompare(right.role)
    ));
}

const eventFields = sql`
  e.id as "id", e.activity_kind as "activityKind", e.category as "category",
  e.participation_mode as "participationMode", e.title as "title", e.description as "description",
  e.venue as "venue", e.eligibility_criteria as "eligibilityCriteria", e.lifecycle as "lifecycle",
  e.created_by_teacher_id as "createdByTeacherId", e.results_revision as "resultsRevision",
  to_char(e.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",
  to_char(e.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "startsAt",
  case when e.ends_at is null then null else to_char(e.ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end as "endsAt",
  case when e.registration_deadline_at is null then null else to_char(e.registration_deadline_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end as "registrationDeadlineAt",
  case when e.results_published_at is null then null else to_char(e.results_published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end as "resultsPublishedAt",
  coalesce((select array_agg(a.class_id order by a.class_id) from public.event_audiences a where a.event_id = e.id), '{}'::uuid[]) as "targetClassIds"
`;

export class DrizzleEventsRepository implements EventsRepository {
  public constructor(private readonly db: Database) {}

  public async listStudentEvents(identity: EventsIdentity, query: StudentEventsQuery): Promise<EventPage<StudentEventSummary>> {
    const result = rows<EventRow & { registrationId: string | null; registeredAt: string | null; teamId: string | null; teamName: string | null }>(await this.db.execute(sql`
      select ${eventFields}, registration.id as "registrationId",
        case when registration.id is null then null else to_char(registration.registered_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end as "registeredAt",
        member.team_id as "teamId", team.name as "teamName"
      from public.events e
      join public.user_roles role on role.user_id = ${identity.userId}::uuid and role.school_id = ${identity.schoolId}::uuid
        and role.role = 'student' and role.is_active = true
      left join public.event_registrations registration on registration.event_id = e.id and registration.student_id = ${identity.userId}::uuid and registration.cancelled_at is null
      left join public.event_team_members member on member.event_id = e.id and member.student_id = ${identity.userId}::uuid
      left join public.event_teams team on team.id = member.team_id
      where e.school_id = ${identity.schoolId}::uuid and e.deleted_at is null and e.archived_at is null
        and e.lifecycle in ('published', 'completed')
        and exists (
          select 1 from public.event_audiences audience join public.class_members membership
            on membership.class_id = audience.class_id and membership.school_id = audience.school_id
            and membership.student_id = ${identity.userId}::uuid and membership.is_active = true
          where audience.event_id = e.id and audience.school_id = e.school_id
        )
        and (${query.filter} = 'trending'
          or (${query.filter} = 'upcoming' and e.lifecycle = 'published'
            and coalesce(e.ends_at, e.starts_at) >= now())
          or (${query.filter} = 'registered' and registration.id is not null)
          or (${query.filter} = 'completed' and (e.lifecycle = 'completed' or coalesce(e.ends_at, e.starts_at) < now())))
        and (${query.cursor?.createdAt ?? null}::timestamptz is null
          or (e.created_at, e.id) < (${query.cursor?.createdAt ?? null}::timestamptz, ${query.cursor?.id ?? null}::uuid))
      order by e.created_at desc, e.id desc limit ${query.limit + 1}
    `));
    return page(result.map((row) => ({
      ...eventSummary(row),
      registration: row.registrationId === null || row.registeredAt === null
        ? null
        : { id: row.registrationId, registeredAt: row.registeredAt, teamId: row.teamId, teamName: row.teamName },
    })), query.limit);
  }

  public async getStudentEvent(identity: EventsIdentity, eventId: string): Promise<StudentEventDetail | undefined> {
    const result = rows<EventRow & { registrationId: string | null; registeredAt: string | null; teamId: string | null; teamName: string | null }>(await this.db.execute(sql`
      select ${eventFields}, registration.id as "registrationId",
        case when registration.id is null then null else to_char(registration.registered_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end as "registeredAt",
        member.team_id as "teamId", team.name as "teamName"
      from public.events e
      join public.user_roles role on role.user_id = ${identity.userId}::uuid and role.school_id = ${identity.schoolId}::uuid and role.role = 'student' and role.is_active = true
      left join public.event_registrations registration on registration.event_id = e.id and registration.student_id = ${identity.userId}::uuid and registration.cancelled_at is null
      left join public.event_team_members member on member.event_id = e.id and member.student_id = ${identity.userId}::uuid
      left join public.event_teams team on team.id = member.team_id
      where e.id = ${eventId}::uuid and e.school_id = ${identity.schoolId}::uuid and e.deleted_at is null and e.archived_at is null
        and e.lifecycle in ('published', 'completed')
        and exists (select 1 from public.event_audiences audience join public.class_members membership
          on membership.class_id = audience.class_id and membership.school_id = audience.school_id and membership.student_id = ${identity.userId}::uuid and membership.is_active = true
          where audience.event_id = e.id and audience.school_id = e.school_id)
      limit 1
    `));
    const row = result[0];
    if (!row) return undefined;
    return {
      ...eventSummary(row), description: row.description, eligibilityCriteria: row.eligibilityCriteria, eligibilityRules: { targetClassIds: row.targetClassIds }, targetClassIds: row.targetClassIds,
      registration: row.registrationId === null || row.registeredAt === null
        ? null : { id: row.registrationId, registeredAt: row.registeredAt, teamId: row.teamId, teamName: row.teamName },
    };
  }

  public async registerStudent(identity: EventsIdentity, eventId: string): Promise<RegistrationResult> {
    return this.db.transaction(async (transaction) => {
      const eligible = rows<{ id: string }>(await transaction.execute(sql`
        select e.id from public.events e
        join public.user_roles role on role.user_id = ${identity.userId}::uuid and role.school_id = ${identity.schoolId}::uuid and role.role = 'student' and role.is_active = true
        join public.event_audiences audience on audience.event_id = e.id and audience.school_id = e.school_id
        join public.class_members membership on membership.class_id = audience.class_id and membership.school_id = audience.school_id and membership.student_id = ${identity.userId}::uuid and membership.is_active = true
        where e.id = ${eventId}::uuid and e.school_id = ${identity.schoolId}::uuid and e.lifecycle = 'published'
          and e.deleted_at is null and e.archived_at is null and (e.registration_deadline_at is null or e.registration_deadline_at >= now())
        limit 1 for update of e, role, membership
      `));
      if (!eligible[0]) forbid('Registration is not available');
      const existing = rows<RegistrationRow>(await transaction.execute(sql`
        select registration.id as "id", to_char(registration.registered_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "registeredAt",
          member.team_id as "teamId", team.name as "teamName"
        from public.event_registrations registration
        left join public.event_team_members member on member.event_id = registration.event_id and member.student_id = registration.student_id
        left join public.event_teams team on team.id = member.team_id
        where registration.event_id = ${eventId}::uuid and registration.student_id = ${identity.userId}::uuid and registration.cancelled_at is null
        for update of registration
      `));
      if (existing[0]) return { ...existing[0], created: false };
      const created = rows<RegistrationRow>(await transaction.execute(sql`
        insert into public.event_registrations (school_id, event_id, student_id)
        values (${identity.schoolId}::uuid, ${eventId}::uuid, ${identity.userId}::uuid)
        returning id as "id", to_char(registered_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "registeredAt", null::uuid as "teamId", null::text as "teamName"
      `));
      const registration = created[0];
      if (!registration) throw new AppError('INTERNAL_ERROR', 500, 'Unable to create registration');
      await writeOutbox(transaction, identity.schoolId, 'events.registration.created', `event:${eventId}:registration:${identity.userId}`, {
        eventId, registrationId: registration.id, studentId: identity.userId,
      });
      return { ...registration, created: true };
    });
  }

  public async createTeam(identity: EventsIdentity, eventId: string, input: EventTeamInput): Promise<EventTeam> {
    return this.db.transaction(async (transaction) => {
      const allowed = rows<{ id: string }>(await transaction.execute(sql`
        select e.id from public.events e
        join public.user_roles role on role.user_id = ${identity.userId}::uuid and role.school_id = ${identity.schoolId}::uuid and role.role = 'student' and role.is_active = true
        join public.event_audiences audience on audience.event_id = e.id and audience.school_id = e.school_id
        join public.class_members membership on membership.class_id = audience.class_id and membership.school_id = audience.school_id and membership.student_id = ${identity.userId}::uuid and membership.is_active = true
        where e.id = ${eventId}::uuid and e.school_id = ${identity.schoolId}::uuid and e.lifecycle = 'published' and e.participation_mode = 'team'
          and e.deleted_at is null and e.archived_at is null and (e.registration_deadline_at is null or e.registration_deadline_at >= now())
        limit 1 for update of e, role, membership
      `));
      if (!allowed[0]) forbid('Team registration is not available');
      const members = rows<{ studentId: string }>(await transaction.execute(sql`
        select registration.student_id as "studentId" from public.event_registrations registration
        join public.user_roles role on role.user_id = registration.student_id and role.school_id = registration.school_id and role.role = 'student' and role.is_active = true
        where registration.event_id = ${eventId}::uuid and registration.school_id = ${identity.schoolId}::uuid and registration.cancelled_at is null
          and registration.student_id = any(${uuidArray(input.memberStudentIds)})
          and exists (select 1 from public.event_audiences audience join public.class_members membership
            on membership.class_id = audience.class_id and membership.school_id = audience.school_id and membership.student_id = registration.student_id and membership.is_active = true
            where audience.event_id = registration.event_id and audience.school_id = registration.school_id)
      `));
      if (members.length !== input.memberStudentIds.length) forbid('Every team member must be actively registered and eligible');
      const occupied = rows<{ studentId: string }>(await transaction.execute(sql`
        select student_id as "studentId" from public.event_team_members where event_id = ${eventId}::uuid and student_id = any(${uuidArray(input.memberStudentIds)})
      `));
      if (occupied.length) throw new AppError('VALIDATION_ERROR', 400, 'A student is already assigned to an event team');
      const duplicateName = rows<{ id: string }>(await transaction.execute(sql`
        select id from public.event_teams where event_id = ${eventId}::uuid and lower(name) = lower(${input.name}) limit 1
      `));
      if (duplicateName[0]) throw new AppError('VALIDATION_ERROR', 400, 'A team with this name already exists');
      const teams = rows<{ id: string; name: string }>(await transaction.execute(sql`
        insert into public.event_teams (school_id, event_id, name, created_by_student_id)
        values (${identity.schoolId}::uuid, ${eventId}::uuid, ${input.name}, ${identity.userId}::uuid)
        returning id, name
      `));
      const team = teams[0];
      if (!team) throw new AppError('INTERNAL_ERROR', 500, 'Unable to create team');
      await transaction.execute(sql`
        insert into public.event_team_members (school_id, event_id, team_id, student_id)
        select ${identity.schoolId}::uuid, ${eventId}::uuid, ${team.id}::uuid, requested.student_id
        from unnest(${uuidArray(input.memberStudentIds)}) as requested(student_id)
      `);
      await writeOutbox(transaction, identity.schoolId, 'events.team.created', `event:${eventId}:team:${team.id}`, {
        eventId, memberStudentIds: input.memberStudentIds, teamId: team.id,
      });
      return { id: team.id, memberCount: input.memberStudentIds.length, name: team.name };
    });
  }

  public async createManagedTeam(identity: EventsIdentity, eventId: string, input: EventTeamInput): Promise<EventTeam> {
    return this.db.transaction(async (transaction) => {
      const event = await this.lockOwnedEvent(transaction, identity, eventId);
      if (event.participationMode !== 'team') forbid('Teams are only available for team competitions');
      if (new Set(input.memberStudentIds).size !== input.memberStudentIds.length) {
        throw new AppError('VALIDATION_ERROR', 400, 'A team cannot contain the same student twice');
      }
      const teamEvent = rows<{ id: string }>(await transaction.execute(sql`
        select id from public.events
        where id = ${eventId}::uuid and school_id = ${identity.schoolId}::uuid and participation_mode = 'team'
        limit 1
      `));
      if (!teamEvent[0]) forbid('Teams are only available for team competitions');
      await this.assertRegisteredTeamMembers(transaction, identity, eventId, input.memberStudentIds);
      const occupied = rows<{ studentId: string }>(await transaction.execute(sql`
        select student_id as "studentId" from public.event_team_members
        where event_id = ${eventId}::uuid and student_id = any(${uuidArray(input.memberStudentIds)})
      `));
      if (occupied.length) throw new AppError('VALIDATION_ERROR', 400, 'A student is already assigned to an event team');
      const duplicateName = rows<{ id: string }>(await transaction.execute(sql`
        select id from public.event_teams where event_id = ${eventId}::uuid and lower(name) = lower(${input.name}) limit 1
      `));
      if (duplicateName[0]) throw new AppError('VALIDATION_ERROR', 400, 'A team with this name already exists');
      const created = rows<{ id: string; name: string }>(await transaction.execute(sql`
        insert into public.event_teams (school_id, event_id, name, created_by_teacher_id)
        values (${identity.schoolId}::uuid, ${eventId}::uuid, ${input.name}, ${identity.userId}::uuid)
        returning id, name
      `));
      const team = created[0];
      if (!team) throw new AppError('INTERNAL_ERROR', 500, 'Unable to create team');
      await transaction.execute(sql`
        insert into public.event_team_members (school_id, event_id, team_id, student_id)
        select ${identity.schoolId}::uuid, ${eventId}::uuid, ${team.id}::uuid, requested.student_id
        from unnest(${uuidArray(input.memberStudentIds)}) as requested(student_id)
      `);
      await writeOutbox(transaction, identity.schoolId, 'events.team.created', `event:${eventId}:team:${team.id}`, {
        eventId, memberStudentIds: input.memberStudentIds, teamId: team.id,
      });
      return { id: team.id, memberCount: input.memberStudentIds.length, name: team.name };
    });
  }

  public async deleteTeam(identity: EventsIdentity, eventId: string, teamId: string): Promise<void> {
    await this.db.transaction(async (transaction) => {
      await this.lockOwnedEvent(transaction, identity, eventId);
      const deleted = rows<{ id: string }>(await transaction.execute(sql`
        delete from public.event_teams
        where id = ${teamId}::uuid and event_id = ${eventId}::uuid and school_id = ${identity.schoolId}::uuid
        returning id
      `));
      if (!deleted[0]) throw new AppError('NOT_FOUND', 404, 'Team not found');
      const revision = rows<{ revision: number }>(await transaction.execute(sql`
        update public.events set results_revision = results_revision + 1, results_published_at = null, updated_at = now()
        where id = ${eventId}::uuid and school_id = ${identity.schoolId}::uuid
        returning results_revision as revision
      `))[0];
      await writeOutbox(transaction, identity.schoolId, 'events.team.deleted', `event:${eventId}:team:${teamId}:deleted:${revision?.revision ?? 0}`, {
        eventId, teamId,
      });
    });
  }

  public async getTeacherResults(identity: EventsIdentity, eventId: string): Promise<EventResultsState> {
    if (!await this.canReadManagedEvent(identity, eventId)) forbid('Only active event managers can view event results');
    const event = rows<{ publishedAt: string | null; revision: number }>(await this.db.execute(sql`
      select case when results_published_at is null then null else to_char(results_published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end as "publishedAt",
        results_revision as revision
      from public.events
      where id = ${eventId}::uuid and school_id = ${identity.schoolId}::uuid and deleted_at is null and archived_at is null
      limit 1
    `))[0];
    if (!event) throw new AppError('NOT_FOUND', 404, 'Event not found');
    const entries = rows<{ rank: number | null; score: string | null; targetId: string; targetName: string; targetType: 'registration' | 'team' }>(await this.db.execute(sql`
      select case when result.score is null then null else dense_rank() over (order by result.score desc nulls last) end as rank,
        result.score::text as score, result.target_type as "targetType",
        coalesce(result.registration_id, result.team_id) as "targetId", coalesce(profile.display_name, team.name) as "targetName"
      from public.event_result_entries result
      left join public.event_registrations registration on registration.id = result.registration_id
      left join public.user_profiles profile on profile.id = registration.student_id
      left join public.event_teams team on team.id = result.team_id
      where result.event_id = ${eventId}::uuid and result.school_id = ${identity.schoolId}::uuid
      order by rank asc nulls last, coalesce(result.registration_id, result.team_id) asc
    `));
    return {
      entries: entries.map((entry) => ({ ...entry, score: entry.score === null ? null : Number(entry.score) })),
      publishedAt: event.publishedAt,
      revision: event.revision,
    };
  }

  public async replaceTeamMembers(
    identity: EventsIdentity,
    eventId: string,
    teamId: string,
    memberStudentIds: string[],
  ): Promise<EventTeam> {
    return this.db.transaction(async (transaction) => {
      await this.lockOwnedEvent(transaction, identity, eventId);
      if (new Set(memberStudentIds).size !== memberStudentIds.length) {
        throw new AppError('VALIDATION_ERROR', 400, 'A team cannot contain the same student twice');
      }
      const team = rows<{ id: string; name: string }>(await transaction.execute(sql`
        select id, name from public.event_teams
        where id = ${teamId}::uuid and event_id = ${eventId}::uuid and school_id = ${identity.schoolId}::uuid
        limit 1 for update
      `))[0];
      if (!team) throw new AppError('NOT_FOUND', 404, 'Team not found');
      await this.assertRegisteredTeamMembers(transaction, identity, eventId, memberStudentIds);
      const occupied = rows<{ studentId: string }>(await transaction.execute(sql`
        select student_id as "studentId" from public.event_team_members
        where event_id = ${eventId}::uuid and team_id <> ${teamId}::uuid and student_id = any(${uuidArray(memberStudentIds)})
      `));
      if (occupied.length) throw new AppError('VALIDATION_ERROR', 400, 'A student is already assigned to another event team');
      const current = rows<{ studentId: string }>(await transaction.execute(sql`
        select student_id as "studentId" from public.event_team_members where team_id = ${teamId}::uuid order by student_id
      `));
      const requested = [...memberStudentIds].sort();
      const unchanged = current.map((member) => member.studentId).join('|') === requested.join('|');
      if (!unchanged) {
        await transaction.execute(sql`delete from public.event_team_members where team_id = ${teamId}::uuid`);
        await transaction.execute(sql`
          insert into public.event_team_members (school_id, event_id, team_id, student_id)
          select ${identity.schoolId}::uuid, ${eventId}::uuid, ${teamId}::uuid, requested.student_id
          from unnest(${uuidArray(requested)}) as requested(student_id)
        `);
        const revision = rows<{ revision: number }>(await transaction.execute(sql`
          update public.events set results_revision = results_revision + 1, results_published_at = null, updated_at = now()
          where id = ${eventId}::uuid and school_id = ${identity.schoolId}::uuid returning results_revision as revision
        `))[0];
        await writeOutbox(transaction, identity.schoolId, 'events.team.members.replaced', `event:${eventId}:team:${teamId}:members:${revision?.revision ?? 0}`, {
          eventId, memberStudentIds: requested, teamId,
        });
      }
      return { id: team.id, memberCount: requested.length, name: team.name };
    });
  }

  public async replaceTeams(
    identity: EventsIdentity,
    eventId: string,
    teams: EventTeamReplacementInput[],
  ): Promise<EventTeam[]> {
    return this.db.transaction(async (transaction) => {
      const event = await this.lockOwnedEvent(transaction, identity, eventId);
      if (event.participationMode !== 'team') forbid('Teams are only available for team competitions');
      const existingTeams = rows<{ id: string; name: string }>(await transaction.execute(sql`
        select id, name from public.event_teams
        where event_id = ${eventId}::uuid and school_id = ${identity.schoolId}::uuid
        order by id for update
      `));
      const existingIds = new Set(existingTeams.map((team) => team.id));
      const retainedIds = teams.flatMap((team) => team.id === undefined ? [] : [team.id]);
      if (retainedIds.some((teamId) => !existingIds.has(teamId))) {
        throw new AppError('NOT_FOUND', 404, 'Team not found');
      }

      const memberStudentIds = teams.flatMap((team) => team.memberStudentIds);
      await this.assertRegisteredTeamMembers(transaction, identity, eventId, memberStudentIds);

      // Free every current assignment first. Re-inserting the complete desired
      // state below makes cross-team moves independent of request ordering.
      await transaction.execute(sql`
        delete from public.event_team_members
        where event_id = ${eventId}::uuid and school_id = ${identity.schoolId}::uuid
      `);
      await transaction.execute(sql`
        delete from public.event_teams
        where event_id = ${eventId}::uuid and school_id = ${identity.schoolId}::uuid
          and not (id = any(${uuidArray(retainedIds)}))
      `);

      const resolvedTeams: Array<{ id: string; memberStudentIds: string[]; name: string }> = [];
      for (const requested of teams) {
        if (requested.id !== undefined) {
          const updated = rows<{ id: string; name: string }>(await transaction.execute(sql`
            update public.event_teams set name = ${requested.name}, updated_at = now()
            where id = ${requested.id}::uuid and event_id = ${eventId}::uuid and school_id = ${identity.schoolId}::uuid
            returning id, name
          `))[0];
          if (!updated) throw new AppError('NOT_FOUND', 404, 'Team not found');
          resolvedTeams.push({ ...updated, memberStudentIds: requested.memberStudentIds });
          continue;
        }
        const created = rows<{ id: string; name: string }>(await transaction.execute(sql`
          insert into public.event_teams (school_id, event_id, name, created_by_teacher_id)
          values (${identity.schoolId}::uuid, ${eventId}::uuid, ${requested.name}, ${identity.userId}::uuid)
          returning id, name
        `))[0];
        if (!created) throw new AppError('INTERNAL_ERROR', 500, 'Unable to create event team');
        resolvedTeams.push({ ...created, memberStudentIds: requested.memberStudentIds });
      }

      for (const team of resolvedTeams) {
        await transaction.execute(sql`
          insert into public.event_team_members (school_id, event_id, team_id, student_id)
          select ${identity.schoolId}::uuid, ${eventId}::uuid, ${team.id}::uuid, requested.student_id
          from unnest(${uuidArray(team.memberStudentIds)}) as requested(student_id)
        `);
      }
      const revision = rows<{ revision: number }>(await transaction.execute(sql`
        update public.events set results_revision = results_revision + 1, results_published_at = null, updated_at = now()
        where id = ${eventId}::uuid and school_id = ${identity.schoolId}::uuid
        returning results_revision as revision
      `))[0];
      if (!revision) throw new AppError('INTERNAL_ERROR', 500, 'Unable to update event team revision');
      await writeOutbox(
        transaction,
        identity.schoolId,
        'events.teams.replaced',
        `event:${eventId}:teams:${revision.revision}`,
        {
          eventId,
          revision: revision.revision,
          teams: resolvedTeams.map((team) => ({ id: team.id, memberStudentIds: team.memberStudentIds, name: team.name })),
        },
      );
      return resolvedTeams.map((team) => ({ id: team.id, memberCount: team.memberStudentIds.length, name: team.name }));
    });
  }

  public async getStudentResults(identity: EventsIdentity, eventId: string): Promise<EventResultsState | undefined> {
    const event = rows<{ publishedAt: string | null; revision: number }>(await this.db.execute(sql`
      select case when e.results_published_at is null then null else to_char(e.results_published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end as "publishedAt",
        e.results_revision as "revision"
      from public.events e join public.user_roles role on role.user_id = ${identity.userId}::uuid and role.school_id = ${identity.schoolId}::uuid and role.role = 'student' and role.is_active = true
      where e.id = ${eventId}::uuid and e.school_id = ${identity.schoolId}::uuid and e.deleted_at is null and e.archived_at is null and e.lifecycle in ('published', 'completed')
        and exists (select 1 from public.event_audiences audience join public.class_members membership on membership.class_id = audience.class_id and membership.school_id = audience.school_id and membership.student_id = ${identity.userId}::uuid and membership.is_active = true where audience.event_id = e.id)
      limit 1
    `))[0];
    if (!event) return undefined;
    if (event.publishedAt === null) return { entries: [], publishedAt: null, revision: event.revision };
    const entries = rows<{ rank: number | null; score: string | null; targetId: string; targetName: string; targetType: 'registration' | 'team' }>(await this.db.execute(sql`
      select result.dense_rank as "rank", result.score::text as "score", result.target_type as "targetType", coalesce(result.registration_id, result.team_id) as "targetId", coalesce(student.display_name, team.name) as "targetName"
      from public.event_result_entries result left join public.event_registrations registration on registration.id = result.registration_id
      left join public.user_profiles student on student.id = registration.student_id left join public.event_teams team on team.id = result.team_id
      where result.event_id = ${eventId}::uuid and result.school_id = ${identity.schoolId}::uuid
      order by result.dense_rank asc nulls last, coalesce(result.registration_id, result.team_id) asc
    `));
    return { entries: entries.map((entry) => ({ ...entry, score: entry.score === null ? null : Number(entry.score) })), publishedAt: event.publishedAt, revision: event.revision };
  }

  public async listStudentParticipants(identity: EventsIdentity, eventId: string): Promise<EventParticipant[] | undefined> {
    if (await this.getStudentEvent(identity, eventId) === undefined) return undefined;
    return rows<EventParticipant>(await this.db.execute(sql`
      select registration.id as "registrationId", registration.student_id as "studentId", profile.display_name as "studentName", class_section.display_name as "className",
        registration.participation_tag as "participationTag", to_char(registration.registered_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "registeredAt", member.team_id as "teamId", team.name as "teamName"
      from public.event_registrations registration
      join public.user_profiles profile on profile.id = registration.student_id and profile.school_id = registration.school_id
      join public.class_members membership on membership.student_id = registration.student_id and membership.school_id = registration.school_id and membership.is_active = true
      join public.classes class_section on class_section.id = membership.class_id and class_section.school_id = membership.school_id
      left join public.event_team_members member on member.event_id = registration.event_id and member.student_id = registration.student_id
      left join public.event_teams team on team.id = member.team_id
      where registration.event_id = ${eventId}::uuid and registration.school_id = ${identity.schoolId}::uuid and registration.cancelled_at is null
        and exists (
          select 1 from public.events event
          join public.user_roles role on role.user_id = ${identity.userId}::uuid and role.school_id = event.school_id and role.role = 'student' and role.is_active = true
          join public.event_audiences audience on audience.event_id = event.id and audience.school_id = event.school_id
          join public.class_members viewer_membership on viewer_membership.class_id = audience.class_id and viewer_membership.school_id = audience.school_id and viewer_membership.student_id = ${identity.userId}::uuid and viewer_membership.is_active = true
          where event.id = registration.event_id and event.school_id = registration.school_id and event.deleted_at is null and event.archived_at is null
            and event.lifecycle in ('published', 'completed')
        )
      order by profile.display_name, registration.student_id
    `));
  }

  public async listStudentTeams(identity: EventsIdentity, eventId: string): Promise<EventTeam[] | undefined> {
    if (await this.getStudentEvent(identity, eventId) === undefined) return undefined;
    return rows<EventTeam>(await this.db.execute(sql`
      select team.id, team.name, count(member.id)::integer as "memberCount"
      from public.event_teams team
      left join public.event_team_members member on member.team_id = team.id
      where team.event_id = ${eventId}::uuid and team.school_id = ${identity.schoolId}::uuid
        and exists (
          select 1 from public.events event
          join public.user_roles role on role.user_id = ${identity.userId}::uuid and role.school_id = event.school_id and role.role = 'student' and role.is_active = true
          join public.event_audiences audience on audience.event_id = event.id and audience.school_id = event.school_id
          join public.class_members viewer_membership on viewer_membership.class_id = audience.class_id and viewer_membership.school_id = audience.school_id and viewer_membership.student_id = ${identity.userId}::uuid and viewer_membership.is_active = true
          where event.id = team.event_id and event.school_id = team.school_id and event.deleted_at is null and event.archived_at is null
            and event.lifecycle in ('published', 'completed')
        )
      group by team.id, team.name order by lower(team.name), team.id
    `));
  }

  public async getStudentTeam(identity: EventsIdentity, eventId: string, teamId: string): Promise<EventTeam | undefined> {
    const teams = await this.listStudentTeams(identity, eventId);
    return teams?.find((team) => team.id === teamId);
  }

  public async listTeacherEvents(identity: EventsIdentity, query: TeacherEventsQuery): Promise<EventPage<EventSummary>> {
    const result = rows<EventRow>(await this.db.execute(sql`
      select ${eventFields} from public.events e
      join public.user_roles role on role.user_id = ${identity.userId}::uuid and role.school_id = ${identity.schoolId}::uuid and role.role = 'teacher' and role.is_active = true
      where e.school_id = ${identity.schoolId}::uuid and e.deleted_at is null
        and (e.created_by_teacher_id = ${identity.userId}::uuid or e.lifecycle <> 'draft')
        and (${query.scope} = 'all' or (${query.scope} = 'my' and e.created_by_teacher_id = ${identity.userId}::uuid)
          or (${query.scope} = 'upcoming' and e.lifecycle = 'published' and e.starts_at >= now())
          or (${query.scope} = 'completed' and (e.lifecycle = 'completed' or coalesce(e.ends_at, e.starts_at) < now())))
        and (${query.status ?? null}::text is null
          or (${query.status} = 'upcoming' and e.lifecycle = 'published' and e.starts_at >= now())
          or (${query.status} = 'completed' and (e.lifecycle = 'completed' or coalesce(e.ends_at, e.starts_at) < now())))
        and (${query.cursor?.createdAt ?? null}::timestamptz is null or (e.created_at, e.id) < (${query.cursor?.createdAt ?? null}::timestamptz, ${query.cursor?.id ?? null}::uuid))
      order by e.created_at desc, e.id desc limit ${query.limit + 1}
    `));
    return page(result.map(eventSummary), query.limit);
  }

  public async getTeacherEvent(identity: EventsIdentity, eventId: string): Promise<TeacherEventDetail | undefined> {
    const row = rows<EventRow>(await this.db.execute(sql`
      select ${eventFields} from public.events e join public.user_roles role
        on role.user_id = ${identity.userId}::uuid and role.school_id = ${identity.schoolId}::uuid and role.role = 'teacher' and role.is_active = true
      where e.id = ${eventId}::uuid and e.school_id = ${identity.schoolId}::uuid and e.deleted_at is null
        and (e.created_by_teacher_id = ${identity.userId}::uuid or e.lifecycle <> 'draft') limit 1
    `))[0];
    return row ? { ...eventSummary(row), description: row.description, eligibilityCriteria: row.eligibilityCriteria, eligibilityRules: { targetClassIds: row.targetClassIds }, isOwned: row.createdByTeacherId === identity.userId, targetClassIds: row.targetClassIds } : undefined;
  }

  public async createEvent(identity: EventsIdentity, input: CreateEventInput): Promise<TeacherEventDetail> {
    const eventId = await this.db.transaction(async (transaction) => {
      const classes = rows<{ id: string }>(await transaction.execute(sql`
        select id from public.classes where school_id = ${identity.schoolId}::uuid and id = any(${uuidArray(input.targetClassIds)}) for update
      `));
      if (classes.length !== input.targetClassIds.length) forbid('Every target class must be in your school');
      const created = rows<{ id: string }>(await transaction.execute(sql`
        insert into public.events (school_id, created_by_teacher_id, activity_kind, category, participation_mode, title, description, venue, eligibility_criteria, starts_at, ends_at, registration_deadline_at, lifecycle)
        select ${identity.schoolId}::uuid, ${identity.userId}::uuid, ${input.activityKind}, ${input.category ?? null}, ${input.participationMode ?? null}, ${input.title}, ${input.description ?? null}, ${input.venue ?? null}, ${input.eligibilityCriteria ?? null}, ${input.startsAt}::timestamptz, ${input.endsAt ?? null}::timestamptz, ${input.registrationDeadlineAt ?? null}::timestamptz, ${input.lifecycle ?? 'draft'}
        where exists (select 1 from public.user_roles role where role.user_id = ${identity.userId}::uuid and role.school_id = ${identity.schoolId}::uuid and role.role = 'teacher' and role.is_active = true)
        returning id
      `));
      const event = created[0];
      if (!event) forbid('Only an active teacher can create an event');
      await transaction.execute(sql`
        insert into public.event_audiences (school_id, event_id, class_id)
        select ${identity.schoolId}::uuid, ${event.id}::uuid, requested.class_id from unnest(${uuidArray(input.targetClassIds)}) as requested(class_id)
      `);
      await writeOutbox(transaction, identity.schoolId, 'events.created', `event:${event.id}:created`, { eventId: event.id, teacherId: identity.userId });
      return event.id;
    });
    const detail = await this.getTeacherEvent(identity, eventId);
    if (!detail) throw new AppError('INTERNAL_ERROR', 500, 'Unable to load created event');
    return detail;
  }

  public async updateEvent(identity: EventsIdentity, eventId: string, input: UpdateEventInput): Promise<TeacherEventDetail> {
    await this.db.transaction(async (transaction) => {
      const owned = rows<{ id: string }>(await transaction.execute(sql`
        select e.id from public.events e join public.user_roles role on role.user_id = ${identity.userId}::uuid and role.school_id = e.school_id and role.role = 'teacher' and role.is_active = true
        where e.id = ${eventId}::uuid and e.school_id = ${identity.schoolId}::uuid and e.created_by_teacher_id = ${identity.userId}::uuid and e.deleted_at is null
        for update of e, role
      `));
      if (!owned[0]) forbid('Only the owner can update this event');
      if (input.targetClassIds) {
        const classes = rows<{ id: string }>(await transaction.execute(sql`select id from public.classes where school_id = ${identity.schoolId}::uuid and id = any(${uuidArray(input.targetClassIds)})`));
        if (classes.length !== input.targetClassIds.length) forbid('Every target class must be in your school');
        await transaction.execute(sql`delete from public.event_audiences where event_id = ${eventId}::uuid`);
        await transaction.execute(sql`insert into public.event_audiences (school_id, event_id, class_id) select ${identity.schoolId}::uuid, ${eventId}::uuid, requested.class_id from unnest(${uuidArray(input.targetClassIds)}) as requested(class_id)`);
      }
      await transaction.execute(sql`
        update public.events set
          activity_kind = coalesce(${input.activityKind ?? null}, activity_kind), category = case when ${input.category === undefined} then category else ${input.category ?? null} end,
          participation_mode = case when ${input.participationMode === undefined} then participation_mode else ${input.participationMode ?? null} end,
          title = coalesce(${input.title ?? null}, title), description = case when ${input.description === undefined} then description else ${input.description ?? null} end,
          venue = case when ${input.venue === undefined} then venue else ${input.venue ?? null} end,
          eligibility_criteria = case when ${input.eligibilityCriteria === undefined} then eligibility_criteria else ${input.eligibilityCriteria ?? null} end,
          starts_at = coalesce(${input.startsAt ?? null}::timestamptz, starts_at), ends_at = case when ${input.endsAt === undefined} then ends_at else ${input.endsAt ?? null}::timestamptz end,
          registration_deadline_at = case when ${input.registrationDeadlineAt === undefined} then registration_deadline_at else ${input.registrationDeadlineAt ?? null}::timestamptz end,
          lifecycle = coalesce(${input.lifecycle ?? null}, lifecycle), archived_at = case when ${input.lifecycle === 'archived'} then now() when ${input.lifecycle !== undefined} then null else archived_at end,
          updated_at = now()
        where id = ${eventId}::uuid and school_id = ${identity.schoolId}::uuid and created_by_teacher_id = ${identity.userId}::uuid
      `);
      await writeOutbox(transaction, identity.schoolId, 'events.updated', eventSourceKey(eventId, 'updated', JSON.stringify(input)), { eventId });
    });
    const detail = await this.getTeacherEvent(identity, eventId);
    if (!detail) throw new AppError('NOT_FOUND', 404, 'Event not found');
    return detail;
  }

  public async archiveEvent(identity: EventsIdentity, eventId: string): Promise<void> {
    await this.db.transaction(async (transaction) => {
      const changed = rows<{ id: string }>(await transaction.execute(sql`
      update public.events e set lifecycle = 'archived', archived_at = coalesce(archived_at, now()), deleted_at = coalesce(deleted_at, now()), updated_at = now()
      where e.id = ${eventId}::uuid and e.school_id = ${identity.schoolId}::uuid and e.created_by_teacher_id = ${identity.userId}::uuid
        and exists (select 1 from public.user_roles role where role.user_id = ${identity.userId}::uuid and role.school_id = e.school_id and role.role = 'teacher' and role.is_active = true)
      returning e.id
    `));
    if (!changed[0]) forbid('Only the owner can archive this event');
    await writeOutbox(transaction, identity.schoolId, 'events.archived', `event:${eventId}:archived`, { eventId });
    });
  }

  public async replaceManagingTeam(identity: EventsIdentity, eventId: string, members: EventManagingMemberInput[]): Promise<EventManagingMember[]> {
    return this.db.transaction(async (transaction) => {
      const owned = rows<{ id: string }>(await transaction.execute(sql`
        select e.id from public.events e join public.user_roles role on role.user_id = ${identity.userId}::uuid and role.school_id = e.school_id and role.role = 'teacher' and role.is_active = true
        where e.id = ${eventId}::uuid and e.school_id = ${identity.schoolId}::uuid and e.created_by_teacher_id = ${identity.userId}::uuid and e.deleted_at is null for update of e, role
      `));
      if (!owned[0]) forbid('Only the owner can manage the event team');
      const requestedMembers = canonicalManagingMembers(members);
      const requested = JSON.stringify(requestedMembers);
      const current = rows<EventManagingMemberInput>(await transaction.execute(sql`
        select manager.user_id as "userId", manager.member_type as "memberType", manager.manager_role as role
        from public.event_managers manager
        where manager.event_id = ${eventId}::uuid and manager.school_id = ${identity.schoolId}::uuid
        order by manager.user_id, manager.member_type, manager.manager_role
      `));
      const isUnchanged = JSON.stringify(canonicalManagingMembers(current)) === requested;
      if (!isUnchanged) {
      const eligible = rows<{ userId: string }>(await transaction.execute(sql`
        select requested.user_id as "userId" from jsonb_to_recordset(${requested}::jsonb) as requested(user_id uuid, member_type text, role text)
        where (requested.member_type = 'student' and exists (
          select 1 from public.user_roles role join public.class_members membership on membership.student_id = role.user_id and membership.school_id = role.school_id and membership.is_active = true
          join public.event_audiences audience on audience.event_id = ${eventId}::uuid and audience.school_id = membership.school_id and audience.class_id = membership.class_id
          where role.user_id = requested.user_id and role.school_id = ${identity.schoolId}::uuid and role.role = 'student' and role.is_active = true
        )) or (requested.member_type = 'teacher' and exists (
          select 1 from public.user_roles role join public.class_subjects assignment on assignment.teacher_id = role.user_id and assignment.school_id = role.school_id
          join public.event_audiences audience on audience.event_id = ${eventId}::uuid and audience.school_id = assignment.school_id and audience.class_id = assignment.class_id
          where role.user_id = requested.user_id and role.school_id = ${identity.schoolId}::uuid and role.role = 'teacher' and role.is_active = true
        ))
      `));
      if (eligible.length !== members.length) forbid('Every managing member must be active and eligible for the event audience');
      await transaction.execute(sql`delete from public.event_managers where event_id = ${eventId}::uuid`);
      if (members.length) await transaction.execute(sql`
        insert into public.event_managers (school_id, event_id, user_id, member_type, manager_role)
        select ${identity.schoolId}::uuid, ${eventId}::uuid, requested.user_id, requested.member_type, requested.role
        from jsonb_to_recordset(${requested}::jsonb) as requested(user_id uuid, member_type text, role text)
      `);
      const revision = rows<{ managerRevision: number }>(await transaction.execute(sql`
        update public.events set manager_revision = manager_revision + 1, updated_at = now()
        where id = ${eventId}::uuid and school_id = ${identity.schoolId}::uuid
        returning manager_revision as "managerRevision"
      `))[0];
      if (!revision) throw new AppError('INTERNAL_ERROR', 500, 'Unable to advance manager revision');
      await writeOutbox(
        transaction,
        identity.schoolId,
        'events.managers.replaced',
        eventSourceKey(eventId, 'managers', String(revision.managerRevision)),
        { eventId, managerRevision: revision.managerRevision, members: requestedMembers },
      );
      }
      return rows<EventManagingMember>(await transaction.execute(sql`
        select manager.user_id as "userId", manager.member_type as "memberType", manager.manager_role as "role", profile.display_name as "displayName"
        from public.event_managers manager join public.user_profiles profile on profile.id = manager.user_id and profile.school_id = manager.school_id
        where manager.event_id = ${eventId}::uuid order by profile.display_name, manager.user_id
      `));
    });
  }

  public async tagParticipation(identity: EventsIdentity, eventId: string, studentId: string, tag: string | null): Promise<{ tag: string | null }> {
    return this.db.transaction(async (transaction) => {
      await this.lockOwnedEvent(transaction, identity, eventId);
      const changed = rows<{ participationRevision: number; tag: string | null }>(await transaction.execute(sql`
        update public.event_registrations set participation_tag = ${tag}, participation_revision = participation_revision + 1, updated_at = now()
        where event_id = ${eventId}::uuid and school_id = ${identity.schoolId}::uuid and student_id = ${studentId}::uuid and cancelled_at is null
          and participation_tag is distinct from ${tag}
        returning participation_tag as tag, participation_revision as "participationRevision"
      `));
      const existing = changed[0] ?? rows<{ participationRevision: number; tag: string | null }>(await transaction.execute(sql`
        select participation_tag as tag, participation_revision as "participationRevision" from public.event_registrations
        where event_id = ${eventId}::uuid and school_id = ${identity.schoolId}::uuid and student_id = ${studentId}::uuid and cancelled_at is null
      `))[0];
      if (!existing) throw new AppError('NOT_FOUND', 404, 'Participant not found');
      if (changed[0]) await writeOutbox(
        transaction,
        identity.schoolId,
        'events.participation.tagged',
        eventSourceKey(eventId, 'participant-tag', `${studentId}:${changed[0].participationRevision}`),
        { eventId, participationRevision: changed[0].participationRevision, studentId, tag },
      );
      return { tag: existing.tag };
    });
  }

  public async listParticipants(identity: EventsIdentity, eventId: string): Promise<EventParticipant[]> {
    const allowed = await this.canReadManagedEvent(identity, eventId);
    if (!allowed) forbid('Only active event managers can view event participants');
    return rows<EventParticipant>(await this.db.execute(sql`
      select registration.id as "registrationId", registration.student_id as "studentId", profile.display_name as "studentName", class_section.display_name as "className",
        registration.participation_tag as "participationTag", to_char(registration.registered_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "registeredAt", member.team_id as "teamId", team.name as "teamName"
      from public.event_registrations registration join public.user_profiles profile on profile.id = registration.student_id and profile.school_id = registration.school_id
      join public.class_members membership on membership.student_id = registration.student_id and membership.school_id = registration.school_id and membership.is_active = true
      join public.classes class_section on class_section.id = membership.class_id and class_section.school_id = membership.school_id
      left join public.event_team_members member on member.event_id = registration.event_id and member.student_id = registration.student_id
      left join public.event_teams team on team.id = member.team_id
      where registration.event_id = ${eventId}::uuid and registration.school_id = ${identity.schoolId}::uuid and registration.cancelled_at is null
        and exists (
          select 1 from public.events event join public.user_roles role
            on role.user_id = ${identity.userId}::uuid and role.school_id = event.school_id and role.role = 'teacher' and role.is_active = true
          where event.id = registration.event_id and event.school_id = registration.school_id and event.deleted_at is null
            and (event.created_by_teacher_id = ${identity.userId}::uuid or exists (
              select 1 from public.event_managers manager
              where manager.event_id = event.id and manager.school_id = event.school_id and manager.user_id = ${identity.userId}::uuid and manager.member_type = 'teacher'
            ))
        )
      order by profile.display_name, registration.student_id
    `));
  }

  public async listPublishedResultAwardRecipients(identity: EventsIdentity, eventId: string): Promise<ReadonlyArray<{ resultId: string; studentId: string }>> {
    return rows<{ resultId: string; studentId: string }>(await this.db.execute(sql`
      select result.id as "resultId", coalesce(registration.student_id, member.student_id) as "studentId"
      from public.event_result_entries result
      join public.events event on event.id = result.event_id and event.school_id = result.school_id
      left join public.event_registrations registration
        on registration.id = result.registration_id and registration.school_id = result.school_id and registration.cancelled_at is null
      left join public.event_team_members member
        on member.team_id = result.team_id and member.event_id = result.event_id and member.school_id = result.school_id
      where result.event_id = ${eventId}::uuid
        and result.school_id = ${identity.schoolId}::uuid
        and event.results_published_at is not null
        and event.deleted_at is null
        and event.archived_at is null
        and event.created_by_teacher_id = ${identity.userId}::uuid
        and coalesce(registration.student_id, member.student_id) is not null
      order by result.id, coalesce(registration.student_id, member.student_id)
    `));
  }

  public async listTeams(identity: EventsIdentity, eventId: string): Promise<EventTeam[]> {
    const allowed = await this.canReadManagedEvent(identity, eventId);
    if (!allowed) forbid('Only active event managers can view event teams');
    return rows<EventTeam>(await this.db.execute(sql`
      select team.id, team.name, count(member.id)::integer as "memberCount" from public.event_teams team
      left join public.event_team_members member on member.team_id = team.id
      where team.event_id = ${eventId}::uuid and team.school_id = ${identity.schoolId}::uuid
        and exists (
          select 1 from public.events event join public.user_roles role
            on role.user_id = ${identity.userId}::uuid and role.school_id = event.school_id and role.role = 'teacher' and role.is_active = true
          where event.id = team.event_id and event.school_id = team.school_id and event.deleted_at is null
            and (event.created_by_teacher_id = ${identity.userId}::uuid or exists (
              select 1 from public.event_managers manager
              where manager.event_id = event.id and manager.school_id = event.school_id and manager.user_id = ${identity.userId}::uuid and manager.member_type = 'teacher'
            ))
        )
      group by team.id, team.name order by lower(team.name), team.id
    `));
  }

  public async writeScores(identity: EventsIdentity, eventId: string, entries: EventScoreInput[]): Promise<{ revision: number }> {
    return this.db.transaction(async (transaction) => {
      const event = await this.lockOwnedEvent(transaction, identity, eventId);
      const targetType = entries[0]?.targetType;
      if (targetType === undefined) return { revision: event.revision };
      for (const entry of entries) {
        const belongs = rows<{ id: string }>(await transaction.execute(entry.targetType === 'registration'
          ? sql`select id from public.event_registrations where id = ${entry.targetId}::uuid and event_id = ${eventId}::uuid and school_id = ${identity.schoolId}::uuid and cancelled_at is null`
          : sql`select id from public.event_teams where id = ${entry.targetId}::uuid and event_id = ${eventId}::uuid and school_id = ${identity.schoolId}::uuid`));
        if (!belongs[0]) forbid('Score target is not part of this event');
      }
      const current = rows<{ score: string | null; targetId: string }>(await transaction.execute(sql`
        select coalesce(registration_id, team_id) as "targetId", score::text as score
        from public.event_result_entries
        where event_id = ${eventId}::uuid and school_id = ${identity.schoolId}::uuid and target_type = ${targetType}
        order by coalesce(registration_id, team_id)
      `));
      const requested = [...entries].sort((left, right) => left.targetId.localeCompare(right.targetId));
      const unchanged = current.length === requested.length && current.every((existing, index) => {
        const entry = requested[index];
        return entry !== undefined
          && existing.targetId === entry.targetId
          && existing.score === (entry.score === null ? null : String(entry.score));
      });
      if (unchanged) return { revision: event.revision };

      await transaction.execute(sql`
        delete from public.event_result_entries
        where event_id = ${eventId}::uuid and school_id = ${identity.schoolId}::uuid and target_type = ${targetType}
          and not (coalesce(registration_id, team_id) = any(${uuidArray(requested.map((entry) => entry.targetId))}))
      `);
      for (const entry of requested) {
        if (entry.targetType === 'registration') await transaction.execute(sql`
          insert into public.event_result_entries (school_id, event_id, target_type, registration_id, score)
          values (${identity.schoolId}::uuid, ${eventId}::uuid, 'registration', ${entry.targetId}::uuid, ${entry.score})
          on conflict (event_id, registration_id) where target_type = 'registration'
          do update set score = excluded.score, dense_rank = null, updated_at = now()
        `);
        else await transaction.execute(sql`
          insert into public.event_result_entries (school_id, event_id, target_type, team_id, score)
          values (${identity.schoolId}::uuid, ${eventId}::uuid, 'team', ${entry.targetId}::uuid, ${entry.score})
          on conflict (event_id, team_id) where target_type = 'team'
          do update set score = excluded.score, dense_rank = null, updated_at = now()
        `);
      }
      const revision = rows<{ revision: number }>(await transaction.execute(sql`
        update public.events set results_revision = results_revision + 1, results_published_at = null, updated_at = now() where id = ${eventId}::uuid returning results_revision as revision
      `))[0];
      if (!revision) throw new AppError('INTERNAL_ERROR', 500, 'Unable to update score revision');
      await writeOutbox(transaction, identity.schoolId, 'events.scores.updated', `event:${eventId}:scores:${revision.revision}`, { eventId, revision: revision.revision });
      return { revision: revision.revision };
    });
  }

  public async publishResults(identity: EventsIdentity, eventId: string): Promise<PublishedEventResults> {
    return this.db.transaction(async (transaction) => {
      const event = await this.lockOwnedEvent(transaction, identity, eventId);
      if (event.lifecycle !== 'published' && event.lifecycle !== 'completed') forbid('Results can only be published for a published or completed event');
      if (event.publishedAt !== null) return this.readPublishedResults(transaction, identity.schoolId, eventId, event.publishedAt, event.revision);
      await transaction.execute(sql`
        with ranked as (
          select id, case when score is null then null else dense_rank() over (order by score desc nulls last) end as dense_rank
          from public.event_result_entries where event_id = ${eventId}::uuid and school_id = ${identity.schoolId}::uuid
        ) update public.event_result_entries result set dense_rank = ranked.dense_rank from ranked where result.id = ranked.id
      `);
      const published = rows<{ publishedAt: string; revision: number }>(await transaction.execute(sql`
        update public.events set results_published_at = now(), updated_at = now() where id = ${eventId}::uuid
        returning to_char(results_published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "publishedAt", results_revision as revision
      `))[0];
      if (!published) throw new AppError('INTERNAL_ERROR', 500, 'Unable to publish results');
      await writeOutbox(transaction, identity.schoolId, 'events.results.published', `event:${eventId}:results:${published.revision}`, { eventId, revision: published.revision });
      return this.readPublishedResults(transaction, identity.schoolId, eventId, published.publishedAt, published.revision);
    });
  }

  private async assertRegisteredTeamMembers(
    executor: Executor,
    identity: EventsIdentity,
    eventId: string,
    memberStudentIds: string[],
  ): Promise<void> {
    const members = rows<{ studentId: string }>(await executor.execute(sql`
      select registration.student_id as "studentId"
      from public.event_registrations registration
      join public.user_roles role on role.user_id = registration.student_id
        and role.school_id = registration.school_id and role.role = 'student' and role.is_active = true
      where registration.event_id = ${eventId}::uuid and registration.school_id = ${identity.schoolId}::uuid
        and registration.cancelled_at is null and registration.student_id = any(${uuidArray(memberStudentIds)})
        and exists (
          select 1 from public.event_audiences audience
          join public.class_members membership on membership.class_id = audience.class_id
            and membership.school_id = audience.school_id and membership.student_id = registration.student_id
            and membership.is_active = true
          where audience.event_id = registration.event_id and audience.school_id = registration.school_id
        )
    `));
    if (members.length !== memberStudentIds.length) {
      forbid('Every team member must be actively registered and eligible');
    }
  }

  private async canReadManagedEvent(identity: EventsIdentity, eventId: string): Promise<boolean> {
    const result = rows<{ id: string }>(await this.db.execute(sql`
      select e.id from public.events e join public.user_roles role on role.user_id = ${identity.userId}::uuid and role.school_id = e.school_id and role.role = 'teacher' and role.is_active = true
      where e.id = ${eventId}::uuid and e.school_id = ${identity.schoolId}::uuid and e.deleted_at is null
        and (e.created_by_teacher_id = ${identity.userId}::uuid or exists (
          select 1 from public.event_managers manager
          where manager.event_id = e.id and manager.school_id = e.school_id and manager.user_id = ${identity.userId}::uuid and manager.member_type = 'teacher'
        )) limit 1
    `));
    return result[0] !== undefined;
  }

  private async lockOwnedEvent(executor: Executor, identity: EventsIdentity, eventId: string): Promise<{ lifecycle: EventSummary['lifecycle']; participationMode: EventSummary['participationMode']; publishedAt: string | null; revision: number }> {
    const result = rows<{ lifecycle: EventSummary['lifecycle']; participationMode: EventSummary['participationMode']; publishedAt: string | null; revision: number }>(await executor.execute(sql`
      select e.lifecycle as lifecycle, e.participation_mode as "participationMode",
        case when e.results_published_at is null then null else to_char(e.results_published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end as "publishedAt", e.results_revision as revision
      from public.events e join public.user_roles role on role.user_id = ${identity.userId}::uuid and role.school_id = e.school_id and role.role = 'teacher' and role.is_active = true
      where e.id = ${eventId}::uuid and e.school_id = ${identity.schoolId}::uuid and e.created_by_teacher_id = ${identity.userId}::uuid and e.deleted_at is null and e.archived_at is null
      for update of e, role
    `));
    if (!result[0]) forbid('Only the owner can manage event results');
    return result[0];
  }

  private async readPublishedResults(executor: Executor, schoolId: string, eventId: string, publishedAt: string, revision: number): Promise<PublishedEventResults> {
    const entries = rows<{ rank: number | null; score: string | null; targetId: string; targetName: string; targetType: 'registration' | 'team' }>(await executor.execute(sql`
      select result.dense_rank as "rank", result.score::text as "score", result.target_type as "targetType", coalesce(result.registration_id, result.team_id) as "targetId", coalesce(profile.display_name, team.name) as "targetName"
      from public.event_result_entries result left join public.event_registrations registration on registration.id = result.registration_id
      left join public.user_profiles profile on profile.id = registration.student_id left join public.event_teams team on team.id = result.team_id
      where result.event_id = ${eventId}::uuid and result.school_id = ${schoolId}::uuid order by result.dense_rank asc nulls last, coalesce(result.registration_id, result.team_id) asc
    `));
    return { entries: entries.map((entry) => ({ ...entry, score: entry.score === null ? null : Number(entry.score) })), publishedAt, revision };
  }
}
