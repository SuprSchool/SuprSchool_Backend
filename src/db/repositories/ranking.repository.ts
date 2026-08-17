import { sql } from 'drizzle-orm';

import type { Database } from '../client.js';
import { AppError } from '../../lib/errors.js';
import type {
  RankingIdentity,
  RankingOutboxEvent,
  RankingRefreshInput,
  StudentClassRanking,
  StudentClassRankingEntry,
  StudentRankingQuery,
} from '../../types/rankings.js';

interface ActiveClassRow {
  classId: string;
}

interface ScopeRow {
  classId: string;
  dirtyVersion: string;
  id: string;
  refreshedVersion: string;
  schoolId: string;
  subjectId: string | null;
}

interface SnapshotRow {
  generatedAt: Date | string;
  id: string;
}

interface RankingEntryRow {
  marks: number | string;
  name: string;
  points: number | string;
  rank: number | string;
  rollNumber: string | null;
  streakCount: number | string;
  userId: string;
}

interface RankingScoreRow {
  marks: number | string;
  points: number | string;
  rank: number | string;
  streakCount: number | string;
  userId: string;
}

export interface StudentRankingReader {
  getCurrentRanking(
    identity: RankingIdentity,
    query: StudentRankingQuery,
  ): Promise<StudentClassRanking>;
}

export interface RankingRepository extends StudentRankingReader {
  deleteResolvedOutbox(): Promise<void>;
  listDispatchableOutbox(limit: number): Promise<readonly RankingOutboxEvent[]>;
  markOutboxEnqueued(eventId: string): Promise<void>;
  refreshScope(input: RankingRefreshInput): Promise<void>;
}

function rows<T>(result: unknown): readonly T[] {
  return result as readonly T[];
}

function asNumber(value: number | string): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) throw new Error('Ranking query returned a non-numeric value');
  return numberValue;
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function parseVersion(value: string): bigint {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new AppError('VALIDATION_ERROR', 400, 'Ranking refresh version must be a positive integer');
  }
  return BigInt(value);
}

function parseNonNegativeVersion(value: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error('Ranking scope contains an invalid version');
  }
  return BigInt(value);
}

export class DrizzleRankingRepository implements RankingRepository {
  public constructor(private readonly db: Database) {}

  public async deleteResolvedOutbox(): Promise<void> {
    await this.db.execute(sql`
      delete from public.ranking_refresh_outbox as outbox
      using public.ranking_refresh_scopes as scope
      where scope.id = outbox.scope_id
        and scope.refreshed_version >= outbox.target_version
    `);
  }

  public async listDispatchableOutbox(limit: number): Promise<readonly RankingOutboxEvent[]> {
    const selected = rows<RankingOutboxEvent>(await this.db.execute(sql`
      select
        outbox.event_id as "eventId",
        outbox.school_id as "schoolId",
        outbox.scope_id as "scopeId",
        outbox.target_version::text as "targetVersion"
      from public.ranking_refresh_outbox as outbox
      join public.ranking_refresh_scopes as scope
        on scope.id = outbox.scope_id
       and scope.school_id = outbox.school_id
      where scope.refreshed_version < outbox.target_version
        and (
          outbox.last_enqueued_at is null
          or outbox.last_enqueued_at <= now() - interval '5 minutes'
        )
      order by outbox.created_at asc, outbox.event_id asc
      limit ${limit}
    `));
    return selected;
  }

  public async markOutboxEnqueued(eventId: string): Promise<void> {
    await this.db.execute(sql`
      update public.ranking_refresh_outbox
      set
        dispatch_attempts = dispatch_attempts + 1,
        last_enqueued_at = now()
      where event_id = ${eventId}::uuid
    `);
  }

  public async getCurrentRanking(
    identity: RankingIdentity,
    query: StudentRankingQuery,
  ): Promise<StudentClassRanking> {
    const activeClass = await this.findActiveClass(identity);
    if (activeClass === undefined) {
      throw new AppError('FORBIDDEN', 403, 'An active current-class membership is required to view rankings');
    }

    const subjectId = query.scope === 'subject'
      ? await this.resolveSubject(identity, activeClass.classId, query.subjectName)
      : undefined;
    if (query.scope === 'subject' && subjectId === undefined) {
      throw new AppError('NOT_FOUND', 404, 'This subject is not in your active class');
    }

    const snapshot = await this.findCurrentSnapshot(
      identity.schoolId,
      activeClass.classId,
      subjectId,
    );
    if (snapshot === undefined) {
      return {
        entries: [],
        generatedAt: null,
        ...(subjectId === undefined ? {} : { subjectId }),
      };
    }

    // A snapshot is immutable, so a roster defect that was written into one
    // survives every later read of it: the board this school is carrying still
    // seats the class teacher at rank 1 on their own point balance. The same
    // active-student guard the refresh now applies is repeated here so an
    // already-written snapshot stops publishing a teacher without waiting on a
    // refresh, and the rank the client sees is re-derived over what is left so
    // removing a row cannot leave a hole where the top of the podium was.
    const entryRows = rows<RankingEntryRow>(await this.db.execute(sql`
      with board as (
        select
          entry.rank as stored_rank,
          entry.user_id,
          profile.display_name as name,
          membership.roll_number,
          entry.points,
          entry.marks,
          entry.streak_count
        from public.ranking_entries as entry
        join public.user_profiles as profile
          on profile.id = entry.user_id
         and profile.school_id = entry.school_id
        join public.user_roles as student_role
          on student_role.user_id = entry.user_id
         and student_role.school_id = entry.school_id
         and student_role.role = 'student'
         and student_role.is_active
        left join public.class_members as membership
          on membership.school_id = entry.school_id
         and membership.class_id = ${activeClass.classId}::uuid
         and membership.student_id = entry.user_id
         and membership.is_active = true
        where entry.snapshot_id = ${snapshot.id}::uuid
          and entry.school_id = ${identity.schoolId}::uuid
      )
      select
        dense_rank() over (order by stored_rank asc)::integer as rank,
        user_id as "userId",
        name,
        roll_number as "rollNumber",
        points,
        marks,
        streak_count as "streakCount"
      from board
      order by rank asc, "userId" asc
    `));

    return {
      entries: entryRows.map((entry): StudentClassRankingEntry => ({
        isCurrentUser: entry.userId === identity.userId,
        marks: asNumber(entry.marks),
        name: entry.name,
        points: asNumber(entry.points),
        rank: asNumber(entry.rank),
        rollNo: `Roll No. ${entry.rollNumber ?? '—'}`,
        streakCount: asNumber(entry.streakCount),
      })),
      generatedAt: asIso(snapshot.generatedAt),
      ...(subjectId === undefined ? {} : { subjectId }),
    };
  }

  public async refreshScope(input: RankingRefreshInput): Promise<void> {
    const requestedVersion = parseVersion(input.targetVersion);
    await this.db.transaction(async (transaction) => {
      const database = transaction as unknown as Database;
      const locked = rows<ScopeRow>(await database.execute(sql`
        select
          id,
          school_id as "schoolId",
          class_id as "classId",
          subject_id as "subjectId",
          dirty_version::text as "dirtyVersion",
          refreshed_version::text as "refreshedVersion"
        from public.ranking_refresh_scopes
        where id = ${input.scopeId}::uuid
        for update
      `))[0];

      if (locked === undefined) {
        await database.execute(sql`
          delete from public.ranking_refresh_outbox
          where event_id = ${input.eventId}::uuid
        `);
        return;
      }
      if (locked.schoolId !== input.schoolId) {
        throw new AppError('FORBIDDEN', 403, 'Ranking refresh event tenant does not match its scope');
      }

      const dirtyVersion = parseVersion(locked.dirtyVersion);
      const refreshedVersion = parseNonNegativeVersion(locked.refreshedVersion);
      if (refreshedVersion >= requestedVersion) {
        await this.deleteResolvedOutboxInTransaction(database, locked.id, refreshedVersion);
        return;
      }

      const scores = await this.loadScopeScores(database, locked);
      const [snapshot] = rows<SnapshotRow>(await database.execute(sql`
        insert into public.ranking_snapshots (
          school_id,
          class_id,
          subject_id,
          scope_id,
          source_version
        )
        values (
          ${locked.schoolId}::uuid,
          ${locked.classId}::uuid,
          ${locked.subjectId}::uuid,
          ${locked.id}::uuid,
          ${dirtyVersion.toString()}::bigint
        )
        returning id, generated_at as "generatedAt"
      `));
      if (snapshot === undefined) throw new Error('Unable to persist ranking snapshot');

      const payload = JSON.stringify(scores.map((score) => ({
        marks: asNumber(score.marks),
        points: asNumber(score.points),
        rank: asNumber(score.rank),
        streakCount: asNumber(score.streakCount),
        userId: score.userId,
      })));
      await database.execute(sql`
        insert into public.ranking_entries (
          snapshot_id,
          school_id,
          user_id,
          rank,
          points,
          marks,
          streak_count
        )
        select
          ${snapshot.id}::uuid,
          ${locked.schoolId}::uuid,
          candidate."userId",
          candidate.rank,
          candidate.points,
          candidate.marks,
          candidate."streakCount"
        from jsonb_to_recordset(${payload}::jsonb) as candidate(
          "userId" uuid,
          rank integer,
          points integer,
          marks numeric,
          "streakCount" integer
        )
      `);

      await database.execute(sql`
        update public.ranking_refresh_scopes
        set
          refreshed_version = ${dirtyVersion.toString()}::bigint,
          updated_at = now()
        where id = ${locked.id}::uuid
      `);
      await this.deleteResolvedOutboxInTransaction(database, locked.id, dirtyVersion);
    });
  }

  private async findActiveClass(identity: RankingIdentity): Promise<ActiveClassRow | undefined> {
    const [activeClass] = rows<ActiveClassRow>(await this.db.execute(sql`
      select membership.class_id as "classId"
      from public.class_members as membership
      join public.academic_years as academic_year
        on academic_year.id = membership.academic_year_id
       and academic_year.school_id = membership.school_id
       and academic_year.is_current = true
      where membership.school_id = ${identity.schoolId}::uuid
        and membership.student_id = ${identity.userId}::uuid
        and membership.is_active = true
      limit 1
    `));
    return activeClass;
  }

  private async resolveSubject(
    identity: RankingIdentity,
    classId: string,
    subjectName: string | undefined,
  ): Promise<string | undefined> {
    if (!subjectName) return undefined;
    const [subject] = rows<{ id: string }>(await this.db.execute(sql`
      select subject.id
      from public.class_subjects as class_subject
      join public.subjects as subject
        on subject.id = class_subject.subject_id
       and subject.school_id = class_subject.school_id
      where class_subject.school_id = ${identity.schoolId}::uuid
        and class_subject.class_id = ${classId}::uuid
        and subject.name = ${subjectName}
      limit 1
    `));
    return subject?.id;
  }

  private async findCurrentSnapshot(
    schoolId: string,
    classId: string,
    subjectId: string | undefined,
  ): Promise<SnapshotRow | undefined> {
    const [snapshot] = rows<SnapshotRow>(await this.db.execute(sql`
      select snapshot.id, snapshot.generated_at as "generatedAt"
      from public.ranking_refresh_scopes as scope
      join public.ranking_snapshots as snapshot
        on snapshot.scope_id = scope.id
       and snapshot.source_version = scope.refreshed_version
      where scope.school_id = ${schoolId}::uuid
        and scope.class_id = ${classId}::uuid
        and scope.scope_kind = ${subjectId === undefined ? 'class' : 'subject'}::public.ranking_scope_kind
        and (
          (${subjectId ?? null}::uuid is null and scope.subject_id is null)
          or scope.subject_id = ${subjectId ?? null}::uuid
        )
      order by snapshot.generated_at desc, snapshot.id desc
      limit 1
    `));
    return snapshot;
  }

  private async loadScopeScores(
    database: Database,
    scope: ScopeRow,
  ): Promise<readonly RankingScoreRow[]> {
    return rows<RankingScoreRow>(await database.execute(sql`
      with active_members as (
        select distinct membership.student_id
        from public.class_members as membership
        join public.academic_years as academic_year
          on academic_year.id = membership.academic_year_id
         and academic_year.school_id = membership.school_id
         and academic_year.is_current = true
        join public.user_profiles as profile
          on profile.id = membership.student_id
         and profile.school_id = membership.school_id
        -- A class_members row is not proof of being a student. The QA teacher
        -- holds an active membership of the class they teach, and without this
        -- join they were ranked on the student board -- top of it, in fact,
        -- because this scope orders by points first and a teacher accrues
        -- points without ever sitting an assessment. Same guard the exams
        -- leaderboard roster carries.
        join public.user_roles as student_role
          on student_role.user_id = membership.student_id
         and student_role.school_id = membership.school_id
         and student_role.role = 'student'
         and student_role.is_active
        where membership.school_id = ${scope.schoolId}::uuid
          and membership.class_id = ${scope.classId}::uuid
          and membership.is_active = true
      ),
      normalized_marks as (
        select
          result.student_id,
          round(avg((coalesce(revision.marks, result.marks) / nullif(assessment.max_marks, 0)) * 100)::numeric, 2) as marks
        from public.exam_results as result
        join public.class_exams as assessment
          on assessment.id = result.assessment_id
         and assessment.school_id = result.school_id
        join public.exam_groups as exam_group
          on exam_group.id = assessment.exam_group_id
         and exam_group.school_id = assessment.school_id
         and exam_group.class_id = assessment.class_id
         and exam_group.deleted_at is null
        left join lateral (
          select revision.marks
          from public.exam_result_revisions as revision
          where revision.result_id = result.id
            and revision.school_id = result.school_id
            and revision.assessment_id = result.assessment_id
            and revision.student_id = result.student_id
            and revision.published_at is not null
          order by revision.published_at desc, revision.created_at desc, revision.id desc
          limit 1
        ) as revision on true
        join active_members as member on member.student_id = result.student_id
        where result.school_id = ${scope.schoolId}::uuid
          and assessment.class_id = ${scope.classId}::uuid
          and assessment.is_published = true
          and assessment.deleted_at is null
          and assessment.max_marks is not null
          and assessment.max_marks > 0
          and result.published_at is not null
          and (${scope.subjectId}::uuid is null or assessment.subject_id = ${scope.subjectId}::uuid)
        group by result.student_id
      ),
      ordered_attendance as (
        select
          record.student_id,
          sum(case when record.status in ('present', 'late') then 0 else 1 end)
            over (
              partition by record.student_id
              order by session.attendance_date desc, session.id desc
              rows between unbounded preceding and current row
            ) as absence_groups
        from public.attendance_records as record
        join public.attendance_sessions as session on session.id = record.session_id
        join active_members as member on member.student_id = record.student_id
        where session.school_id = ${scope.schoolId}::uuid
          and session.class_id = ${scope.classId}::uuid
      ),
      attendance_streaks as (
        select student_id, count(*)::integer as streak_count
        from ordered_attendance
        where absence_groups = 0
        group by student_id
      ),
      scores as (
        select
          member.student_id as "userId",
          coalesce(balance.current_points, 0)::integer as points,
          coalesce(marks.marks, 0)::numeric as marks,
          coalesce(streak.streak_count, 0)::integer as "streakCount"
        from active_members as member
        left join public.point_account_balances as balance
          on balance.school_id = ${scope.schoolId}::uuid
         and balance.user_id = member.student_id
        left join normalized_marks as marks on marks.student_id = member.student_id
        left join attendance_streaks as streak on streak.student_id = member.student_id
      )
      select
        row_number() over (order by points desc, marks desc, "streakCount" desc, "userId" asc)::integer as rank,
        "userId",
        points,
        marks,
        "streakCount"
      from scores
      order by rank asc, "userId" asc
    `));
  }

  private async deleteResolvedOutboxInTransaction(
    database: Database,
    scopeId: string,
    refreshedVersion: bigint,
  ): Promise<void> {
    await database.execute(sql`
      delete from public.ranking_refresh_outbox
      where scope_id = ${scopeId}::uuid
        and target_version <= ${refreshedVersion.toString()}::bigint
    `);
  }
}
