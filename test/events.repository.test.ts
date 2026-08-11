import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { DrizzleEventsRepository } from '../src/db/repositories/drizzle-events.repository.js';
import type { Database } from '../src/db/client.js';
import { createEventsHandler, type EventsDomainQueuePayload } from '../src/async/events/events.handler.js';
import type { AppError } from '../src/lib/errors.js';
import { createEventSchema } from '../src/validators/events.schemas.js';

const schoolId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const teacherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const studentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const eventId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const memberA = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const memberB = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

interface RecordedQuery {
  params: unknown[];
  scope: 'database' | 'transaction';
  sql: string;
}

const dialect = new PgDialect();

function compile(query: unknown): Pick<RecordedQuery, 'params' | 'sql'> {
  const rendered = dialect.sqlToQuery(query as SQL);
  return { params: [...rendered.params], sql: rendered.sql };
}

class RecordingDatabase {
  public readonly committedTransactions: RecordedQuery[][] = [];
  public readonly queries: RecordedQuery[] = [];
  public readonly rolledBackTransactions: RecordedQuery[][] = [];
  public transactionCalls = 0;

  public constructor(
    private readonly respond: (query: RecordedQuery) => unknown[] | Promise<unknown[]>,
  ) {}

  public readonly execute = async (query: unknown): Promise<unknown[]> => {
    const recorded = { ...compile(query), scope: 'database' as const };
    this.queries.push(recorded);
    return this.respond(recorded);
  };

  public readonly transaction = async <T>(
    callback: (transaction: { execute(query: unknown): Promise<unknown[]> }) => Promise<T>,
  ): Promise<T> => {
    this.transactionCalls += 1;
    const staged: RecordedQuery[] = [];
    try {
      const value = await callback({
        execute: async (query: unknown): Promise<unknown[]> => {
          const recorded = { ...compile(query), scope: 'transaction' as const };
          staged.push(recorded);
          return this.respond(recorded);
        },
      });
      this.committedTransactions.push(staged);
      this.queries.push(...staged);
      return value;
    } catch (error) {
      this.rolledBackTransactions.push(staged);
      this.queries.push(...staged);
      throw error;
    }
  };

  public asDatabase(): Database {
    return this as unknown as Database;
  }
}

function outboxQueries(database: RecordingDatabase, eventType: string): RecordedQuery[] {
  return database.queries.filter((query) => (
    query.sql.includes('insert into public.event_domain_outbox')
    && query.params.includes(eventType)
  ));
}

function outboxSourceKey(query: RecordedQuery, eventType: string): string {
  const eventTypeIndex = query.params.findIndex((value) => value === eventType);
  return String(query.params[eventTypeIndex + 1]);
}

function outboxPayload(query: RecordedQuery, eventType: string): Record<string, unknown> {
  const eventTypeIndex = query.params.findIndex((value) => value === eventType);
  return JSON.parse(String(query.params[eventTypeIndex + 2])) as Record<string, unknown>;
}

function ownedEventRow(overrides: Record<string, unknown> = {}) {
  return [{ lifecycle: 'published', managerRevision: 0, participationMode: 'team', publishedAt: null, revision: 0, ...overrides }];
}

describe('DrizzleEventsRepository lifecycle, authorization, and outbox guarantees', () => {
  it('does not publish draft results', async () => {
    const database = new RecordingDatabase((query) => (
      query.sql.includes('for update of e, role') ? ownedEventRow({ lifecycle: 'draft' }) : []
    ));
    const repository = new DrizzleEventsRepository(database.asDatabase());

    await expect(repository.publishResults({ schoolId, userId: teacherId }, eventId))
      .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 } satisfies Partial<AppError>);
    expect(database.queries.some((query) => query.sql.includes('update public.event_result_entries'))).toBe(false);
  });

  it('does not expose draft results even when a publish timestamp exists', async () => {
    const database = new RecordingDatabase(() => [{ publishedAt: '2026-07-16T15:00:00.000000Z', revision: 1 }]);
    const repository = new DrizzleEventsRepository(database.asDatabase());

    await repository.getStudentResults({ schoolId, userId: studentId }, eventId);

    expect(database.queries[0]?.sql).toContain("e.lifecycle in ('published', 'completed')");
  });

  it('returns an empty non-disclosing result state before publication', async () => {
    const database = new RecordingDatabase((query) => (
      query.sql.includes('from public.events e join public.user_roles role')
        ? [{ publishedAt: null, revision: 4 }]
        : []
    ));
    const repository = new DrizzleEventsRepository(database.asDatabase());

    await expect(repository.getStudentResults({ schoolId, userId: studentId }, eventId))
      .resolves.toEqual({ entries: [], publishedAt: null, revision: 4 });
    expect(database.queries).toHaveLength(1);
  });

  it('rolls back the archive update if its outbox insert fails', async () => {
    const database = new RecordingDatabase((query) => {
      if (query.sql.includes('update public.events e set lifecycle =')) return [{ id: eventId }];
      if (query.sql.includes('insert into public.event_domain_outbox')) throw new Error('outbox unavailable');
      return [];
    });
    const repository = new DrizzleEventsRepository(database.asDatabase());

    await expect(repository.archiveEvent({ schoolId, userId: teacherId }, eventId)).rejects.toThrow('outbox unavailable');

    expect(database.transactionCalls).toBe(1);
    expect(database.committedTransactions).toHaveLength(0);
    expect(database.rolledBackTransactions[0]?.map((query) => query.sql)).toEqual(expect.arrayContaining([
      expect.stringContaining('update public.events e set lifecycle ='),
      expect.stringContaining('insert into public.event_domain_outbox'),
    ]));
  });

  it('emits a distinct, versioned durable outbox record for every participation transition', async () => {
    let participationRevision = 0;
    const database = new RecordingDatabase((query) => {
      if (query.sql.includes('for update of e, role')) return ownedEventRow();
      if (query.sql.includes('update public.event_registrations set participation_tag')) {
        participationRevision += 1;
        return [{ participationRevision, tag: 'changed' }];
      }
      return [];
    });
    const repository = new DrizzleEventsRepository(database.asDatabase());

    await repository.tagParticipation({ schoolId, userId: teacherId }, eventId, studentId, 'attended');
    await repository.tagParticipation({ schoolId, userId: teacherId }, eventId, studentId, 'absent');
    await repository.tagParticipation({ schoolId, userId: teacherId }, eventId, studentId, 'attended');

    const outbox = outboxQueries(database, 'events.participation.tagged');
    expect(outbox).toHaveLength(3);
    expect(new Set(outbox.map((query) => outboxSourceKey(query, 'events.participation.tagged'))).size).toBe(3);
    expect(outbox.map((query) => outboxPayload(query, 'events.participation.tagged').participationRevision))
      .toEqual([1, 2, 3]);
  });

  it('emits a distinct, versioned durable outbox record when managing-team membership returns to an earlier state', async () => {
    let managerRevision = 0;
    const priorStates = [[], [{ userId: memberA, memberType: 'student', role: 'Lead' }], [{ userId: memberB, memberType: 'student', role: 'Lead' }]];
    const database = new RecordingDatabase((query) => {
      if (query.sql.includes('where e.id =') && query.sql.includes('for update of e, role')) return [{ id: eventId, managerRevision }];
      if (query.sql.includes('select requested."userId" as "userId"')) return [{ userId: memberA }];
      if (query.sql.includes('select manager.user_id as "userId"') && !query.sql.includes('profile.display_name')) return priorStates.shift() ?? [];
      if (query.sql.includes('update public.events set manager_revision')) return [{ managerRevision: ++managerRevision }];
      return [];
    });
    const repository = new DrizzleEventsRepository(database.asDatabase());

    await repository.replaceManagingTeam({ schoolId, userId: teacherId }, eventId, [{ memberType: 'student', role: 'Lead', userId: memberA }]);
    await repository.replaceManagingTeam({ schoolId, userId: teacherId }, eventId, [{ memberType: 'student', role: 'Lead', userId: memberB }]);
    await repository.replaceManagingTeam({ schoolId, userId: teacherId }, eventId, [{ memberType: 'student', role: 'Lead', userId: memberA }]);

    const outbox = outboxQueries(database, 'events.managers.replaced');
    expect(outbox).toHaveLength(3);
    expect(new Set(outbox.map((query) => outboxSourceKey(query, 'events.managers.replaced'))).size).toBe(3);
    expect(outbox.map((query) => outboxPayload(query, 'events.managers.replaced').managerRevision))
      .toEqual([1, 2, 3]);
  });

  it('keeps the active teacher and owner-or-manager predicate in final participant and team reads', async () => {
    const database = new RecordingDatabase((query) => (
      query.sql.includes('select e.id from public.events') ? [{ id: eventId }] : []
    ));
    const repository = new DrizzleEventsRepository(database.asDatabase());

    await repository.listParticipants({ schoolId, userId: teacherId }, eventId);
    await repository.listTeams({ schoolId, userId: teacherId }, eventId);

    const finalReads = database.queries
      .filter((query) => (
        query.sql.includes('from public.event_registrations registration')
        || query.sql.includes('from public.event_teams team')
      ))
      .map((query) => query.sql);
    expect(finalReads).toHaveLength(2);
    for (const query of finalReads) {
      expect(query).toContain('public.user_roles');
      expect(query).toContain('role.is_active = true');
      expect(query).toContain('public.event_managers');
      expect(query).toContain('created_by_teacher_id');
    }
  });

  it('rejects unsupported opaque eligibility rules while retaining display criteria and target-class rules', () => {
    const common = {
      activityKind: 'event',
      startsAt: '2026-07-20T10:00:00.000Z',
      registrationDeadlineAt: '2026-07-19T10:00:00.000Z',
      targetClassIds: ['11111111-1111-4111-8111-111111111111'],
      title: 'Science fair',
    };

    expect(createEventSchema.safeParse({ ...common, eligibility: { minimumAge: 12 } }).success).toBe(false);
    expect(createEventSchema.parse({
      ...common,
      eligibilityCriteria: 'Class representatives only',
      eligibilityRules: { targetClassIds: common.targetClassIds },
    })).toMatchObject({
      eligibilityCriteria: 'Class representatives only',
      targetClassIds: common.targetClassIds,
    });
  });

  it('uses durable target-class eligibility to deny a student outside the event audience', async () => {
    const database = new RecordingDatabase(() => []);
    const repository = new DrizzleEventsRepository(database.asDatabase());

    await expect(repository.registerStudent({ schoolId, userId: studentId }, eventId))
      .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 } satisfies Partial<AppError>);
    expect(database.queries[0]?.sql).toContain('public.event_audiences');
    expect(database.queries[0]?.sql).toContain('public.class_members');
  });

  it.each([
    { creatorId: studentId, creatorRole: 'student' as const },
    { creatorId: teacherId, creatorRole: 'teacher' as const },
  ])('returns a committed $creatorRole team before validation or another insert', async ({ creatorId, creatorRole }) => {
    const recoveredTeam = { id: memberA, memberCount: 2, name: 'Sparta' };
    const database = new RecordingDatabase((query) => {
      if (query.sql.includes('for update of e, role')) {
        return creatorRole === 'teacher' ? ownedEventRow() : [{ id: eventId }];
      }
      if (query.sql.includes('count(member.student_id)::integer')) return [recoveredTeam];
      return [];
    });
    const repository = new DrizzleEventsRepository(database.asDatabase());
    const input = { memberStudentIds: [studentId, memberB], name: 'Sparta' };

    const result = creatorRole === 'student'
      ? await repository.createTeam({ schoolId, userId: creatorId }, eventId, memberA, input)
      : await repository.createManagedTeam({ schoolId, userId: creatorId }, eventId, memberA, input);

    expect(result).toEqual(recoveredTeam);
    expect(database.queries.some((query) => query.sql.includes('insert into public.event_teams'))).toBe(false);
    const recovery = database.queries.find((query) => query.sql.includes('count(member.student_id)::integer'));
    expect(recovery?.sql).toContain(`team.created_by_${creatorRole}_id`);
    expect(recovery?.sql).toContain('public.event_domain_outbox');
    expect(recovery?.params).toContain(creatorRole);
  });

  it('accepts every Events outbox payload shape in the queue handler contract', async () => {
    const consumer = { handle: vi.fn().mockResolvedValue(undefined) };
    const handler = createEventsHandler(consumer);

    const produced: ReadonlyArray<{ eventType: string; payload: EventsDomainQueuePayload }> = [
      { eventType: 'events.created', payload: { eventId, teacherId } },
      { eventType: 'events.updated', payload: { eventId } },
      { eventType: 'events.archived', payload: { eventId } },
      { eventType: 'events.registration.created', payload: { eventId, registrationId: memberA, studentId } },
      { eventType: 'events.team.created', payload: { eventId, memberStudentIds: [studentId], teamId: memberA } },
      { eventType: 'events.teams.replaced', payload: { eventId, revision: 1, teams: [] } },
      { eventType: 'events.managers.replaced', payload: { eventId, managerRevision: 1, members: [] } },
      { eventType: 'events.scores.updated', payload: { eventId, revision: 1 } },
      { eventType: 'events.participation.tagged', payload: { eventId, participationRevision: 1, studentId, tag: 'attended' } },
      { eventType: 'events.results.published', payload: { eventId, revision: 1 } },
    ];

    for (const producedEvent of produced) {
      await expect(handler({
        eventId,
        eventType: producedEvent.eventType,
        occurredAt: '2026-07-16T15:00:00.000000Z',
        payload: producedEvent.payload,
        schemaVersion: 1,
        schoolId,
      }, { providerIdempotencyKey: eventId })).resolves.toBeUndefined();
    }
    expect(consumer.handle).toHaveBeenCalledTimes(produced.length);
  });
  it('does not create a second manager transition for an identical replay', async () => {
    let managerRevision = 0;
    const priorStates = [[], [{ userId: memberA, memberType: 'student', role: 'Lead' }]];
    const database = new RecordingDatabase((query) => {
      if (query.sql.includes('where e.id =') && query.sql.includes('for update of e, role')) return [{ id: eventId }];
      if (query.sql.includes('select requested."userId" as "userId"')) return [{ userId: memberA }];
      if (query.sql.includes('select manager.user_id as "userId"') && !query.sql.includes('profile.display_name')) return priorStates.shift() ?? [];
      if (query.sql.includes('update public.events set manager_revision')) return [{ managerRevision: ++managerRevision }];
      return [];
    });
    const repository = new DrizzleEventsRepository(database.asDatabase());
    const requested = [{ memberType: 'student' as const, role: 'Lead', userId: memberA }];

    await repository.replaceManagingTeam({ schoolId, userId: teacherId }, eventId, requested);
    await repository.replaceManagingTeam({ schoolId, userId: teacherId }, eventId, requested);

    expect(outboxQueries(database, 'events.managers.replaced')).toHaveLength(1);
  });

  it('uses dense rank SQL and a stable target-id ordering when publishing results', async () => {
    const database = new RecordingDatabase((query) => {
      if (query.sql.includes('for update of e, role')) return ownedEventRow();
      if (query.sql.includes('update public.events set results_published_at')) {
        return [{ publishedAt: '2026-07-16T15:00:00.000000Z', revision: 1 }];
      }
      return [];
    });
    const repository = new DrizzleEventsRepository(database.asDatabase());

    await repository.publishResults({ schoolId, userId: teacherId }, eventId);

    expect(database.queries.some((query) => (
      query.sql.includes('dense_rank() over (order by score desc nulls last)')
    ))).toBe(true);
    expect(database.queries.some((query) => (
      query.sql.includes('order by result.dense_rank asc nulls last, coalesce(result.registration_id, result.team_id) asc')
    ))).toBe(true);
  });

  it('replaces result rows of one target type so omitted rankings stay deleted', async () => {
    const retainedRegistration = '11111111-1111-4111-8111-111111111111';
    const removedRegistration = '22222222-2222-4222-8222-222222222222';
    const database = new RecordingDatabase((query) => {
      if (query.sql.includes('for update of e, role')) return ownedEventRow({ revision: 7 });
      if (query.sql.includes('from public.event_registrations where id')) return [{ id: retainedRegistration }];
      if (query.sql.includes('select coalesce(registration_id, team_id) as "targetId"')) {
        return [
          { score: '2', targetId: retainedRegistration },
          { score: '1', targetId: removedRegistration },
        ];
      }
      if (query.sql.includes('update public.events set results_revision')) return [{ revision: 8 }];
      return [];
    });
    const repository = new DrizzleEventsRepository(database.asDatabase());

    await repository.writeScores({ schoolId, userId: teacherId }, eventId, [
      { score: 2, targetId: retainedRegistration, targetType: 'registration' },
    ]);

    const transaction = database.committedTransactions[0] ?? [];
    expect(transaction.some((query) => (
      query.sql.includes('delete from public.event_result_entries')
      && query.params.includes('registration')
    ))).toBe(true);
    expect(transaction.some((query) => (
      query.sql.includes('insert into public.event_result_entries')
      && query.params.some((parameter) => String(parameter).includes(retainedRegistration))
    ))).toBe(true);
  });

  it('moves students across existing teams inside one replacement transaction', async () => {
    const teamA = '11111111-1111-4111-8111-111111111111';
    const teamB = '22222222-2222-4222-8222-222222222222';
    const database = new RecordingDatabase((query) => {
      if (query.sql.includes('for update of e, role')) return ownedEventRow({ revision: 3 });
      if (query.sql.includes('select id, name from public.event_teams') && query.sql.includes('for update')) {
        return [{ id: teamA, name: 'Alpha' }, { id: teamB, name: 'Beta' }];
      }
      if (query.sql.includes('select registration.student_id as "studentId"')) {
        return [{ studentId: memberA }, { studentId: memberB }];
      }
      if (query.sql.includes('update public.event_teams set name')) {
        const requestedTeamId = query.params.find((parameter) => parameter === teamA || parameter === teamB);
        return [{ id: requestedTeamId, name: requestedTeamId === teamA ? 'Alpha' : 'Beta' }];
      }
      if (query.sql.includes('update public.events set results_revision')) return [{ revision: 4 }];
      if (query.sql.includes('select team.id, team.name')) {
        return [
          { id: teamA, memberCount: 1, name: 'Alpha' },
          { id: teamB, memberCount: 1, name: 'Beta' },
        ];
      }
      return [];
    });
    const repository = new DrizzleEventsRepository(database.asDatabase());

    await repository.replaceTeams({ schoolId, userId: teacherId }, eventId, [
      { id: teamA, memberStudentIds: [memberB], name: 'Alpha' },
      { id: teamB, memberStudentIds: [memberA], name: 'Beta' },
    ]);

    expect(database.transactionCalls).toBe(1);
    const transaction = database.committedTransactions[0] ?? [];
    const deleteIndex = transaction.findIndex((query) => query.sql.includes('delete from public.event_team_members'));
    const insertIndex = transaction.findIndex((query) => query.sql.includes('insert into public.event_team_members'));
    expect(deleteIndex).toBeGreaterThanOrEqual(0);
    expect(insertIndex).toBeGreaterThan(deleteIndex);
  });

  it('persists and clears manager contact through exact JSON mapping and durable outbox payloads', async () => {
    const database = new RecordingDatabase((query) => {
      if (query.sql.includes('where e.id =') && query.sql.includes('for update of e, role')) {
        return [{ id: eventId }];
      }
      if (query.sql.includes('select requested."userId" as "userId"')) return [{ userId: memberA }];
      if (query.sql.includes('select manager.user_id as "userId"') && !query.sql.includes('profile.display_name')) return [];
      if (query.sql.includes('update public.events set manager_revision')) return [{ managerRevision: 1 }];
      if (query.sql.includes('profile.display_name')) {
        return [{
          contact: 'coordinator@school.example',
          displayName: 'Alex Teacher',
          memberType: 'teacher',
          role: 'Coordinator',
          userId: memberA,
        }];
      }
      return [];
    });
    const repository = new DrizzleEventsRepository(database.asDatabase());

    await repository.replaceManagingTeam({ schoolId, userId: teacherId }, eventId, [{
      contact: 'coordinator@school.example',
      memberType: 'teacher',
      role: 'Coordinator',
      userId: memberA,
    }]);

    await repository.replaceManagingTeam({ schoolId, userId: teacherId }, eventId, [{
      contact: null,
      memberType: 'teacher',
      role: 'Coordinator',
      userId: memberA,
    }]);

    const outboxes = outboxQueries(database, 'events.managers.replaced');
    expect(outboxPayload(outboxes[0]!, 'events.managers.replaced').members)
      .toEqual([expect.objectContaining({ contact: 'coordinator@school.example' })]);
    expect(outboxPayload(outboxes[1]!, 'events.managers.replaced').members)
      .toEqual([expect.objectContaining({ contact: null })]);
    expect(database.queries.some((query) => query.sql.includes('requested."userId"'))).toBe(true);
    expect(database.queries.some((query) => query.sql.includes('requested."memberType"'))).toBe(true);
    expect(database.queries.some((query) => query.sql.includes('requested.contact'))).toBe(true);
    expect(database.queries.some((query) => query.params.some((parameter) => (
      String(parameter).includes('"contact":null')
    )))).toBe(true);
  });
});

describe('student event participant standings', () => {
  function participantDatabase(
    participantRows: Record<string, unknown>[],
  ): RecordingDatabase {
    // The visibility check the listing runs first also selects `from
    // public.events event`, which any prefix of `public.events e` matches, so
    // the listing is identified by its own standings CTE instead.
    return new RecordingDatabase((query) => (
      query.sql.includes('with standings as') ? participantRows : [{ id: eventId }]
    ));
  }

  function participantQuery(database: RecordingDatabase): RecordedQuery {
    const query = database.queries.find((candidate) => (
      candidate.sql.includes('from public.event_registrations registration')
    ));
    if (query === undefined) throw new Error('participant listing query was not issued');
    return query;
  }

  it('derives the rank in the listing query instead of reading the stored one', async () => {
    const database = participantDatabase([]);
    const repository = new DrizzleEventsRepository(database.asDatabase());

    await repository.listStudentParticipants({ schoolId, userId: studentId }, eventId);

    const { sql: statement } = participantQuery(database);
    expect(statement).toContain('dense_rank() over (order by result.score desc nulls last)');
    // The stored column is what publication freezes; the read path must not
    // serve it, or a re-score would hand students a rank for a withdrawn result.
    expect(statement).not.toContain('result.dense_rank');
  });

  it('withholds score and rank until the results are published', async () => {
    const database = participantDatabase([]);
    const repository = new DrizzleEventsRepository(database.asDatabase());

    await repository.listStudentParticipants({ schoolId, userId: studentId }, eventId);

    expect(participantQuery(database).sql).toContain('results_published_at is not null');
  });

  it('scopes the standings to the requesting school and reads the avatar only when one was uploaded', async () => {
    const database = participantDatabase([]);
    const repository = new DrizzleEventsRepository(database.asDatabase());

    await repository.listStudentParticipants({ schoolId, userId: studentId }, eventId);

    const query = participantQuery(database);
    expect(query.params.filter((parameter) => parameter === schoolId).length).toBeGreaterThanOrEqual(2);
    expect(query.sql).toContain("profile.avatar_kind = 'upload'");
  });

  it('returns a numeric score and a null standing for a participant without a result', async () => {
    const database = participantDatabase([
      {
        avatarObjectPath: 'school/asha.png',
        className: '10-A',
        participationTag: null,
        rank: 1,
        registeredAt: '2026-07-16T15:00:00.000000Z',
        registrationId: memberA,
        score: '87.5',
        studentId,
        studentName: 'Asha',
        teamId: null,
        teamName: null,
      },
      {
        avatarObjectPath: null,
        className: '10-B',
        participationTag: null,
        rank: null,
        registeredAt: '2026-07-16T15:10:00.000000Z',
        registrationId: memberB,
        score: null,
        studentId: teacherId,
        studentName: 'Meera',
        teamId: null,
        teamName: null,
      },
    ]);
    const repository = new DrizzleEventsRepository(database.asDatabase());

    const participants = await repository.listStudentParticipants({ schoolId, userId: studentId }, eventId);

    expect(participants?.[0]).toMatchObject({ avatarObjectPath: 'school/asha.png', rank: 1, score: 87.5 });
    expect(participants?.[1]).toMatchObject({ avatarObjectPath: null, rank: null, score: null });
  });
});
