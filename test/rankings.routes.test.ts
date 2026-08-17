import { drizzle, type RemoteCallback } from 'drizzle-orm/pg-proxy';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { errorHandler } from '../src/middleware/error-handler.js';
import { AppError } from '../src/lib/errors.js';
import type { AuthenticationMiddleware } from '../src/middleware/authenticate.js';
import { createStudentClassRankingsRouter } from '../src/routes/points.routes.js';
import { PointsService } from '../src/services/points.service.js';
import { RankingRefreshService, type StudentRankingReader } from '../src/services/ranking-refresh.service.js';
import { createRankingRefreshHandler } from '../src/async/rankings/ranking-refresh.handler.js';
import type { Database } from '../src/db/client.js';
import { DrizzleRankingRepository, type RankingRepository } from '../src/db/repositories/ranking.repository.js';
import type { RankingIdentity, RankingOutboxEvent, StudentClassRanking } from '../src/types/rankings.js';

const schoolId = '00000000-0000-4000-8000-000000000001';
const studentId = '00000000-0000-4000-8000-000000000101';
const mathematicsId = '00000000-0000-4000-8000-000000000201';

class InMemoryRankingReader implements StudentRankingReader {
  public async getCurrentRanking(
    identity: RankingIdentity,
    query: { scope: 'section' | 'subject'; subjectName?: string },
  ): Promise<StudentClassRanking> {
    if (identity.schoolId !== schoolId) throw new Error('wrong school');
    if (query.scope === 'subject' && query.subjectName !== 'Mathematics') {
      throw new AppError('NOT_FOUND', 404, 'This subject is not in your active class');
    }
    return {
      entries: [{
        isCurrentUser: true,
        marks: 97.5,
        name: 'Student A',
        points: 120,
        rank: 1,
        rollNo: 'Roll No. 7',
        streakCount: 8,
      }],
      generatedAt: '2026-07-14T10:00:00.000Z',
      ...(query.scope === 'subject' ? { subjectId: mathematicsId } : {}),
    };
  }
}

function createApp() {
  const authenticate: AuthenticationMiddleware = async (
    incoming: Request,
    _response: Response,
    next: NextFunction,
  ) => {
    incoming.auth = { role: 'student', schoolId, userId: studentId };
    next();
  };
  const app = express();
  const points = new PointsService({
    findCurrentPoints: async () => 0,
    findLevelRules: async () => [],
    listActivity: async () => ({ items: [] }),
    listActiveEarningRules: async () => [],
  }, new InMemoryRankingReader());
  app.use('/v1/student', createStudentClassRankingsRouter(points, authenticate));
  app.use(errorHandler);
  return app;
}

describe('student class ranking REST API', () => {
  it('returns the immutable current class snapshot in the client ranking shape', async () => {
    const response = await request(createApp())
      .get('/v1/student/class/rankings')
      .query({ scope: 'section' })
      .expect(200);

    expect(response.body).toEqual({
      entries: [expect.objectContaining({ isCurrentUser: true, rank: 1, rollNo: 'Roll No. 7' })],
      generatedAt: '2026-07-14T10:00:00.000Z',
    });
    expect(response.body.entries[0]).not.toHaveProperty('userId');
  });

  it('resolves a subject ranking through the caller active class, never a caller-supplied subject id', async () => {
    const response = await request(createApp())
      .get('/v1/student/class/rankings')
      .query({ scope: 'subject', subjectName: 'Mathematics' })
      .expect(200);

    expect(response.body.subjectId).toBe(mathematicsId);
    await request(createApp())
      .get('/v1/student/class/rankings')
      .query({ scope: 'subject', subjectName: 'Other School Subject' })
      .expect(404);
  });
});


const classId = '00000000-0000-4000-8000-000000000301';
const snapshotId = '00000000-0000-4000-8000-000000000302';
const scopeId = '00000000-0000-4000-8000-000000000402';

/**
 * Records the SQL the ranking repository actually issues.
 *
 * The board is the one student surface where "who is on the roster" is a
 * query, not a route: an active `class_members` row is the only thing the
 * refresh used to ask for, and a class teacher holds one for the class they
 * teach. These read the predicates back out of the statements rather than
 * asserting on a stubbed result set, which is the only way to pin a defect
 * that lives inside a `with` clause.
 */
function createQueryRecordingRankingRepository() {
  const queries: string[] = [];
  const callback: RemoteCallback = async (query) => {
    queries.push(query);
    if (query.includes('membership.class_id as "classId"')) return { rows: [{ classId }] };
    if (query.includes('snapshot.generated_at as "generatedAt"')) {
      return { rows: [{ id: snapshotId, generatedAt: '2026-07-14T10:00:00.000Z' }] };
    }
    if (query.includes('for update')) {
      return {
        rows: [{
          classId,
          dirtyVersion: '3',
          id: scopeId,
          refreshedVersion: '1',
          schoolId,
          subjectId: null,
        }],
      };
    }
    if (query.includes('insert into public.ranking_snapshots')) {
      return { rows: [{ id: snapshotId, generatedAt: '2026-07-14T10:00:00.000Z' }] };
    }
    return { rows: [] };
  };
  const database = drizzle(callback) as unknown as Database;
  Object.assign(database, {
    transaction: async (work: (transaction: never) => Promise<unknown>) => work(database as never),
  });
  return { queries, repository: new DrizzleRankingRepository(database) };
}

describe('student class ranking roster', () => {
  // The QA teacher holds an active class_members row for the class they teach.
  // This scope orders by points first, so without a role guard the teacher was
  // written into the snapshot at rank 1 on a point balance no assessment
  // produced, and the podium published a teacher to the whole class.
  it('admits only active student roles to the refreshed roster', async () => {
    const { queries, repository } = createQueryRecordingRankingRepository();

    await repository.refreshScope({
      eventId: '00000000-0000-4000-8000-000000000401',
      schoolId,
      scopeId,
      targetVersion: '3',
    });

    const roster = queries.find((query) => query.includes('active_members'));
    expect(roster).toBeDefined();
    expect(roster).toContain('public.user_roles');
    expect(roster).toContain("student_role.role = 'student'");
    expect(roster).toContain('student_role.is_active');
  });

  // Snapshots are immutable, so a roster defect already written into one keeps
  // publishing a teacher until something refreshes it. The read repeats the
  // guard and re-derives the rank so the fix does not leave a hole where the
  // top of the podium was.
  it('keeps non-students out of an already-written snapshot and closes the rank it leaves', async () => {
    const { queries, repository } = createQueryRecordingRankingRepository();

    await repository.getCurrentRanking({ schoolId, userId: studentId }, { scope: 'section' });

    const board = queries.at(-1);
    expect(board).toBeDefined();
    expect(board).toContain('public.ranking_entries');
    expect(board).toContain('public.user_roles');
    expect(board).toContain("student_role.role = 'student'");
    expect(board).toContain('student_role.is_active');
    expect(board).toContain('dense_rank() over (order by stored_rank asc)');
  });
});

class InMemoryRankingRepository implements RankingRepository {
  public readonly enqueued: string[] = [];
  public readonly refreshed: Array<{ eventId: string; schoolId: string; scopeId: string; targetVersion: string }> = [];
  private readonly outbox: readonly RankingOutboxEvent[] = [{
    eventId: '00000000-0000-4000-8000-000000000401',
    schoolId,
    scopeId: '00000000-0000-4000-8000-000000000402',
    targetVersion: '3',
  }];

  public async deleteResolvedOutbox(): Promise<void> {}
  public async getCurrentRanking(): Promise<StudentClassRanking> {
    return { entries: [], generatedAt: null };
  }
  public async listDispatchableOutbox(): Promise<readonly RankingOutboxEvent[]> {
    return this.outbox;
  }
  public async markOutboxEnqueued(eventId: string): Promise<void> {
    this.enqueued.push(eventId);
  }
  public async refreshScope(input: { eventId: string; schoolId: string; scopeId: string; targetVersion: string }): Promise<void> {
    this.refreshed.push(input);
  }
}

describe('ranking refresh outbox contract', () => {
  it('dispatches a durable scope/version event and acknowledges only after enqueue', async () => {
    const repository = new InMemoryRankingRepository();
    const messages: Array<{ eventId: string; eventType: string; payload: unknown; schoolId: string }> = [];
    const service = new RankingRefreshService({
      queue: { async enqueue(_queueName, message) { messages.push(message); } },
      repository,
    });

    await expect(service.dispatchPending()).resolves.toBe(1);
    expect(messages).toEqual([expect.objectContaining({
      eventId: '00000000-0000-4000-8000-000000000401',
      eventType: 'ranking.refresh.requested',
      payload: { scopeId: '00000000-0000-4000-8000-000000000402', targetVersion: '3' },
      schoolId,
    })]);
    expect(repository.enqueued).toEqual(['00000000-0000-4000-8000-000000000401']);
  });

  it('passes the scope version to the worker so stale handling remains repository-transactional', async () => {
    const repository = new InMemoryRankingRepository();
    const service = new RankingRefreshService({ repository });
    const handler = createRankingRefreshHandler(service);

    await handler({
      eventId: '00000000-0000-4000-8000-000000000401',
      eventType: 'ranking.refresh.requested',
      occurredAt: '2026-07-14T10:00:00.000Z',
      payload: { scopeId: '00000000-0000-4000-8000-000000000402', targetVersion: '3' },
      schoolId,
      schemaVersion: 1,
    }, { providerIdempotencyKey: 'unused' });

    expect(repository.refreshed).toEqual([{
      eventId: '00000000-0000-4000-8000-000000000401',
      schoolId,
      scopeId: '00000000-0000-4000-8000-000000000402',
      targetVersion: '3',
    }]);
  });
});
