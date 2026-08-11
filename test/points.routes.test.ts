import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { errorHandler } from '../src/middleware/error-handler.js';
import type { AuthenticationMiddleware } from '../src/middleware/authenticate.js';
import { createPointsRouter } from '../src/routes/points.routes.js';
import { PointAwardGateway } from '../src/services/point-award.service.js';
import { PointsService } from '../src/services/points.service.js';
import type {
  PointActivityPage,
  PointAwardInsert,
  PointCursorPage,
  PointEarningRule,
  PointLevelRule,
  PointsIdentity,
} from '../src/types/points.js';
import type { Database } from '../src/db/client.js';
import { DrizzlePointsRepository, type PointsRepository } from '../src/db/repositories/points.repository.js';

const schoolId = '00000000-0000-4000-8000-000000000001';
const studentId = '00000000-0000-4000-8000-000000000101';
const outsiderId = '00000000-0000-4000-8000-000000000102';
const assignmentId = '00000000-0000-4000-8000-000000000201';

class InMemoryPointsRepository implements PointsRepository {
  public readonly entries: PointAwardInsert[] = [];
  public readonly dirtyRecipients: string[] = [];
  /** Every page the route handed down, so a query parameter cannot be dropped silently. */
  public readonly activityPages: PointCursorPage[] = [];
  public failPostInsertDirtyWrite = false;
  private readonly recipientIds = new Set([studentId, outsiderId]);
  private readonly rules = new Map<string, PointEarningRule>([
    ['assignment-submitted', {
      code: 'assignment-submitted', icon: 'document', isActive: true, label: 'Submit Assignment', points: 10, sortOrder: 1,
    }],
  ]);

  public async findActiveEarningRule(
    requestedSchoolId: string,
    ruleCode: string,
  ): Promise<PointEarningRule | undefined> {
    if (requestedSchoolId !== schoolId) return undefined;
    const rule = this.rules.get(ruleCode);
    return rule?.isActive ? rule : undefined;
  }

  public async hasActiveStudentMembership(
    requestedSchoolId: string,
    recipientUserId: string,
  ): Promise<boolean> {
    return requestedSchoolId === schoolId && this.recipientIds.has(recipientUserId);
  }

  public async insertAwardIfAbsent(input: PointAwardInsert): Promise<string | undefined> {
    if (this.entries.some((entry) => entry.awardKey === input.awardKey && entry.schoolId === input.schoolId)) {
      return undefined;
    }
    this.entries.push(input);
    this.dirtyRecipients.push(`${input.schoolId}:${input.recipientUserId}`);
    return `entry-${this.entries.length}`;
  }

  public async markRankingRefreshDirty(requestedSchoolId: string, recipientUserId: string): Promise<void> {
    this.dirtyRecipients.push(`${requestedSchoolId}:${recipientUserId}`);
    if (this.failPostInsertDirtyWrite) throw new Error('post-insert dirty write is forbidden');
  }

  public async findCurrentPoints(identity: PointsIdentity): Promise<number> {
    return this.entries
      .filter((entry) => entry.schoolId === identity.schoolId && entry.recipientUserId === identity.userId)
      .reduce((total, entry) => total + entry.points, 0);
  }

  public async findLevelRules(requestedSchoolId: string): Promise<readonly PointLevelRule[]> {
    return requestedSchoolId === schoolId ? [{ level: 1, minimumPoints: 0 }] : [];
  }

  public async listActivity(
    identity: PointsIdentity,
    page: PointCursorPage,
  ): Promise<PointActivityPage> {
    this.activityPages.push(page);
    return {
      items: this.entries
        .filter((entry) => entry.schoolId === identity.schoolId && entry.recipientUserId === identity.userId)
        .map((entry, index) => ({
          id: `entry-${index + 1}`,
          occurredAt: entry.occurredAt.toISOString(),
          points: entry.points,
          rule: {
            code: entry.ruleCode,
            icon: 'document' as const,
            label: 'Submit Assignment',
          },
        })),
    };
  }

  public async listActiveEarningRules(requestedSchoolId: string): Promise<readonly PointEarningRule[]> {
    return requestedSchoolId === schoolId
      ? [...this.rules.values()].filter((rule) => rule.isActive)
      : [];
  }
}

function createTestApp() {
  const repository = new InMemoryPointsRepository();
  const awardGateway = new PointAwardGateway({ repository });
  const pointsService = new PointsService(repository);
  const authenticate: AuthenticationMiddleware = async (
    incoming: Request,
    _response: Response,
    next: NextFunction,
  ) => {
    incoming.auth = {
      role: 'student',
      schoolId,
      userId: incoming.header('authorization') === 'Bearer outsider' ? outsiderId : studentId,
    };
    next();
  };
  const app = express();
  app.use('/v1/student/points', createPointsRouter(pointsService, authenticate));
  app.use(errorHandler);

  return { app, awardGateway, repository };
}

describe('student points REST API', () => {
  it('records a source/rule award once and exposes one activity row', async () => {
    const { app, awardGateway, repository } = createTestApp();
    const input = {
      metadata: {},
      occurredAt: new Date('2026-07-13T10:00:00Z'),
      recipientUserId: studentId,
      ruleCode: 'assignment-submitted',
      schoolId,
      sourceId: assignmentId,
      sourceType: 'assignment_submission' as const,
    };

    await awardGateway.awardIfAbsent(input);
    expect((await awardGateway.awardIfAbsent(input)).awarded).toBe(false);

    const response = await request(app).get('/v1/student/points/activity').expect(200);
    expect(response.body.items).toEqual([
      expect.objectContaining({ points: 10, title: 'Submit Assignment' }),
    ]);
    expect(repository.entries).toHaveLength(1);
    expect(repository.dirtyRecipients).toEqual([`${schoolId}:${studentId}`]);
  });

  it('does not expose a direct point-award route', async () => {
    const { app } = createTestApp();

    await request(app)
      .post('/v1/student/points/awards')
      .send({ points: 9999 })
      .expect(404);
  });

  it('does not expose a student activity row to another student', async () => {
    const { app, awardGateway } = createTestApp();
    const input = {
      metadata: {},
      occurredAt: new Date('2026-07-13T10:00:00Z'),
      recipientUserId: studentId,
      ruleCode: 'assignment-submitted',
      schoolId,
      sourceId: assignmentId,
      sourceType: 'assignment_submission' as const,
    };

    await awardGateway.awardIfAbsent(input);

    const response = await request(app)
      .get('/v1/student/points/activity')
      .set('authorization', 'Bearer outsider')
      .expect(200);
    expect(response.body).toEqual({ items: [] });
  });

  it('treats an inactive earning rule as an intentional no-op', async () => {
    const { awardGateway, repository } = createTestApp();
    const rule = await repository.findActiveEarningRule(schoolId, 'assignment-submitted');
    if (!rule) throw new Error('Test rule is missing');
    rule.isActive = false;

    await expect(awardGateway.awardIfAbsent({
      metadata: {}, occurredAt: new Date('2026-07-13T10:00:00Z'), recipientUserId: studentId,
      ruleCode: 'assignment-submitted', schoolId, sourceId: assignmentId, sourceType: 'assignment_submission',
    })).resolves.toEqual({ awarded: false });
    expect(repository.entries).toHaveLength(0);
  });

  it('returns a final level with its own threshold as the progress maximum', async () => {
    const { app, awardGateway } = createTestApp();

    await awardGateway.awardIfAbsent({
      metadata: {}, occurredAt: new Date('2026-07-13T10:00:00Z'), recipientUserId: studentId,
      ruleCode: 'assignment-submitted', schoolId, sourceId: assignmentId, sourceType: 'assignment_submission',
    });

    await request(app).get('/v1/student/points/level').expect(200, {
      currentPoints: 10, level: 1, maxPoints: 0, pointsToNext: 0,
    });
  });

  it('keeps a durable award when the eventual ranking dispatcher is unavailable', async () => {
    const repository = new InMemoryPointsRepository();
    const awardGateway = new PointAwardGateway({ repository });

    await expect(awardGateway.awardIfAbsent({
      metadata: {}, occurredAt: new Date('2026-07-13T10:00:00Z'), recipientUserId: studentId,
      ruleCode: 'assignment-submitted', schoolId, sourceId: assignmentId, sourceType: 'assignment_submission',
    })).resolves.toMatchObject({ awarded: true });
    expect(repository.entries).toHaveLength(1);
    expect(repository.dirtyRecipients).toHaveLength(1);
  });

  it('scopes points activity by period', async () => {
    const { app, repository } = createTestApp();

    const response = await request(app)
      .get('/v1/student/points/activity')
      .query({ period: 'week' });

    expect(response.status).toBe(200);
    expect(repository.activityPages.at(-1)).toMatchObject({ period: 'week' });
  });

  it('defaults an unfiltered activity read to all time', async () => {
    const { app, repository } = createTestApp();

    await request(app).get('/v1/student/points/activity').expect(200);

    expect(repository.activityPages.at(-1)).toMatchObject({ period: 'all' });
  });

  it('rejects an invalid period', async () => {
    const { app, repository } = createTestApp();

    await request(app)
      .get('/v1/student/points/activity')
      .query({ period: 'fortnight' })
      .expect(400);

    expect(repository.activityPages).toHaveLength(0);
  });

  // 761:4817 selects a window; the cursor keeps paging inside it. Reading the
  // period out of the cursor — what the client had to do before this endpoint
  // took a period — makes the two settings fight over one parameter.
  it('keeps the cursor pagination-only when a period is selected', async () => {
    const { app, repository } = createTestApp();
    const cursor = Buffer.from(JSON.stringify({
      id: '00000000-0000-4000-8000-000000000301',
      occurredAt: '2026-07-13T10:00:00.123456Z',
    })).toString('base64url');

    await request(app)
      .get('/v1/student/points/activity')
      .query({ cursor, period: 'month' })
      .expect(200);

    expect(repository.activityPages.at(-1)).toMatchObject({
      cursor: { id: '00000000-0000-4000-8000-000000000301' },
      period: 'month',
    });
  });

  it('rejects a cursor with a non-UUID id before querying activity', async () => {
    const { app } = createTestApp();
    const cursor = Buffer.from(JSON.stringify({
      id: 'not-a-uuid',
      occurredAt: '2026-07-13T10:00:00.123456Z',
    })).toString('base64url');

    await request(app)
      .get('/v1/student/points/activity')
      .query({ cursor })
      .expect(400);
  });

  it('does not require a best-effort enqueue after the repository durably creates the ranking request', async () => {
    const repository = new InMemoryPointsRepository();
    repository.failPostInsertDirtyWrite = true;
    const awardGateway = new PointAwardGateway({ repository });

    await expect(awardGateway.awardIfAbsent({
      metadata: {}, occurredAt: new Date('2026-07-13T10:00:00Z'), recipientUserId: studentId,
      ruleCode: 'assignment-submitted', schoolId, sourceId: assignmentId, sourceType: 'assignment_submission',
    })).resolves.toMatchObject({ awarded: true });
    expect(repository.entries).toHaveLength(1);
    expect(repository.dirtyRecipients).toHaveLength(1);
  });
});

describe('points activity repository', () => {
  it('keeps PostgreSQL microseconds at a cursor page edge', async () => {
    const queries: unknown[] = [];
    const pages = [
      [
        {
          id: '00000000-0000-4000-8000-000000000301',
          occurredAt: '2026-07-13T10:00:03.123456Z',
          points: 10,
          ruleCode: 'assignment-submitted',
          ruleIcon: 'document',
          ruleLabel: 'Submit Assignment',
        },
        {
          id: '00000000-0000-4000-8000-000000000302',
          occurredAt: '2026-07-13T10:00:03.123455Z',
          points: 10,
          ruleCode: 'assignment-submitted',
          ruleIcon: 'document',
          ruleLabel: 'Submit Assignment',
        },
      ],
      [
        {
          id: '00000000-0000-4000-8000-000000000302',
          occurredAt: '2026-07-13T10:00:03.123455Z',
          points: 10,
          ruleCode: 'assignment-submitted',
          ruleIcon: 'document',
          ruleLabel: 'Submit Assignment',
        },
      ],
    ];
    let pageIndex = 0;
    const database = {
      async execute(query: unknown) {
        queries.push(query);
        const page = pages[pageIndex] ?? [];
        pageIndex += 1;
        return page;
      },
    } as unknown as Database;
    const repository = new DrizzlePointsRepository(database);
    const identity = { schoolId, userId: studentId };

    const first = await repository.listActivity(identity, { limit: 1, period: 'all' });
    const second = await repository.listActivity(identity, {
      cursor: first.nextCursor!,
      limit: 1,
      period: 'all',
    });

    expect(first.nextCursor).toEqual({
      id: '00000000-0000-4000-8000-000000000301',
      occurredAt: '2026-07-13T10:00:03.123456Z',
    });
    expect(second.items.map((item) => item.id)).toEqual([
      '00000000-0000-4000-8000-000000000302',
    ]);
    expect(JSON.stringify(queries[0])).toContain('HH24:MI:SS.US');
    expect(JSON.stringify(queries[1])).toContain('2026-07-13T10:00:03.123456Z');
  });

  it('bounds the activity window per period and leaves all time unbounded', async () => {
    const queries: unknown[] = [];
    const database = {
      async execute(query: unknown) {
        queries.push(query);
        return [];
      },
    } as unknown as Database;
    const repository = new DrizzlePointsRepository(database);
    const identity = { schoolId, userId: studentId };

    await repository.listActivity(identity, { limit: 10, period: 'week' });
    await repository.listActivity(identity, { limit: 10, period: 'month' });
    await repository.listActivity(identity, { limit: 10, period: 'all' });

    expect(JSON.stringify(queries[0])).toContain("interval '7 days'");
    expect(JSON.stringify(queries[1])).toContain("date_trunc('month', now())");
    expect(JSON.stringify(queries[2])).not.toContain('interval');
    expect(JSON.stringify(queries[2])).not.toContain('date_trunc');
    // The window never widens the tenancy or ownership predicate.
    for (const query of queries) {
      expect(JSON.stringify(query)).toContain('ledger.school_id');
      expect(JSON.stringify(query)).toContain('ledger.recipient_user_id');
    }
  });
});
