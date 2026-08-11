import type {
  PointActivityPage,
  PointActivityPeriod,
  PointAwardInsert,
  PointCursorPage,
  PointEarningRule,
  PointLevelRule,
  PointsIdentity,
} from '../../types/points.js';

import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { academicYears, classMembers, userProfiles, userRoles } from '../schema/core.js';
import {
  pointAccountBalances,
  pointEarningRules,
  pointLedgerEntries,
  pointLevelRules,
} from '../schema/points.js';

/**
 * The points write path is intentionally separate from public HTTP routes.
 * Source-domain services invoke this repository through PointAwardGateway.
 */
export interface PointsRepository {
  findActiveEarningRule(schoolId: string, ruleCode: string): Promise<PointEarningRule | undefined>;
  hasActiveStudentMembership(schoolId: string, recipientUserId: string): Promise<boolean>;
  insertAwardIfAbsent(input: PointAwardInsert): Promise<string | undefined>;
  findCurrentPoints(identity: PointsIdentity): Promise<number>;
  findLevelRules(schoolId: string): Promise<readonly PointLevelRule[]>;
  listActivity(identity: PointsIdentity, page: PointCursorPage): Promise<PointActivityPage>;
  listActiveEarningRules(schoolId: string): Promise<readonly PointEarningRule[]>;
}

interface PointActivityRow {
  id: string;
  occurredAt: string;
  points: number;
  ruleCode: string;
  ruleIcon: PointEarningRule['icon'];
  ruleLabel: string;
}

/**
 * The window `761:4817` selects. It narrows the same school- and user-scoped
 * query the cursor pages through — the two never share a parameter, so paging
 * inside a week cannot silently reset the window.
 */
function periodWindow(period: PointActivityPeriod) {
  if (period === 'week') return sql`ledger.occurred_at >= now() - interval '7 days'`;
  if (period === 'month') return sql`ledger.occurred_at >= date_trunc('month', now())`;
  return sql`true`;
}


export class DrizzlePointsRepository implements PointsRepository {
  public constructor(private readonly db: Database) {}

  public async findActiveEarningRule(
    schoolId: string,
    ruleCode: string,
  ): Promise<PointEarningRule | undefined> {
    const [rule] = await this.db
      .select({
        code: pointEarningRules.code,
        icon: pointEarningRules.icon,
        isActive: pointEarningRules.isActive,
        label: pointEarningRules.label,
        points: pointEarningRules.points,
        sortOrder: pointEarningRules.sortOrder,
      })
      .from(pointEarningRules)
      .where(and(
        eq(pointEarningRules.schoolId, schoolId),
        eq(pointEarningRules.code, ruleCode),
        eq(pointEarningRules.isActive, true),
      ))
      .limit(1);

    return rule;
  }

  public async hasActiveStudentMembership(
    schoolId: string,
    recipientUserId: string,
  ): Promise<boolean> {
    const [membership] = await this.db
      .select({ id: classMembers.id })
      .from(classMembers)
      .innerJoin(
        academicYears,
        and(
          eq(academicYears.id, classMembers.academicYearId),
          eq(academicYears.schoolId, classMembers.schoolId),
          eq(academicYears.isCurrent, true),
        ),
      )
      .innerJoin(
        userProfiles,
        and(
          eq(userProfiles.id, classMembers.studentId),
          eq(userProfiles.schoolId, classMembers.schoolId),
        ),
      )
      .innerJoin(
        userRoles,
        and(
          eq(userRoles.userId, classMembers.studentId),
          eq(userRoles.schoolId, classMembers.schoolId),
          eq(userRoles.role, 'student'),
          eq(userRoles.isActive, true),
        ),
      )
      .where(and(
        eq(classMembers.schoolId, schoolId),
        eq(classMembers.studentId, recipientUserId),
        eq(classMembers.isActive, true),
      ))
      .limit(1);

    return membership !== undefined;
  }

  public async insertAwardIfAbsent(input: PointAwardInsert): Promise<string | undefined> {
    const [entry] = await this.db
      .insert(pointLedgerEntries)
      .values({
        awardKey: input.awardKey,
        metadata: input.metadata,
        occurredAt: input.occurredAt,
        points: input.points,
        recipientUserId: input.recipientUserId,
        ruleCode: input.ruleCode,
        schoolId: input.schoolId,
        sourceId: input.sourceId,
        sourceType: input.sourceType,
      })
      .onConflictDoNothing({
        target: [pointLedgerEntries.schoolId, pointLedgerEntries.awardKey],
      })
      .returning({ id: pointLedgerEntries.id });

    return entry?.id;
  }


  public async findCurrentPoints(identity: PointsIdentity): Promise<number> {
    const [balance] = await this.db
      .select({ currentPoints: pointAccountBalances.currentPoints })
      .from(pointAccountBalances)
      .where(and(
        eq(pointAccountBalances.schoolId, identity.schoolId),
        eq(pointAccountBalances.userId, identity.userId),
      ))
      .limit(1);

    return balance?.currentPoints ?? 0;
  }

  public async findLevelRules(schoolId: string): Promise<readonly PointLevelRule[]> {
    return this.db
      .select({
        level: pointLevelRules.level,
        minimumPoints: pointLevelRules.minimumPoints,
      })
      .from(pointLevelRules)
      .where(eq(pointLevelRules.schoolId, schoolId))
      .orderBy(asc(pointLevelRules.minimumPoints), asc(pointLevelRules.level));
  }

  public async listActivity(
    identity: PointsIdentity,
    page: PointCursorPage,
  ): Promise<PointActivityPage> {
    const rows = await this.db.execute(sql<PointActivityRow>`
      select
        ledger.id,
        to_char(
          ledger.occurred_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        ) as "occurredAt",
        ledger.points,
        rule.code as "ruleCode",
        rule.icon as "ruleIcon",
        rule.label as "ruleLabel"
      from public.point_ledger_entries as ledger
      join public.point_earning_rules as rule
        on rule.school_id = ledger.school_id
       and rule.code = ledger.rule_code
      where ledger.school_id = ${identity.schoolId}::uuid
        and ledger.recipient_user_id = ${identity.userId}::uuid
        and ${periodWindow(page.period)}
        and (
          ${page.cursor?.occurredAt ?? null}::timestamptz is null
          or (ledger.occurred_at, ledger.id) < (
            ${page.cursor?.occurredAt ?? null}::timestamptz,
            ${page.cursor?.id ?? null}::uuid
          )
        )
      order by ledger.occurred_at desc, ledger.id desc
      limit ${page.limit + 1}
    `);
    const selected = rows as unknown as PointActivityRow[];
    const hasNextPage = selected.length > page.limit;
    const items = selected.slice(0, page.limit).map((row) => ({
      id: row.id,
      occurredAt: row.occurredAt,
      points: row.points,
      rule: {
        code: row.ruleCode,
        icon: row.ruleIcon,
        label: row.ruleLabel,
      },
    }));
    const lastItem = items.at(-1);

    return {
      items,
      ...(!hasNextPage || !lastItem ? {} : {
        nextCursor: { id: lastItem.id, occurredAt: lastItem.occurredAt },
      }),
    };
  }

  public async listActiveEarningRules(schoolId: string): Promise<readonly PointEarningRule[]> {
    return this.db
      .select({
        code: pointEarningRules.code,
        icon: pointEarningRules.icon,
        isActive: pointEarningRules.isActive,
        label: pointEarningRules.label,
        points: pointEarningRules.points,
        sortOrder: pointEarningRules.sortOrder,
      })
      .from(pointEarningRules)
      .where(and(
        eq(pointEarningRules.schoolId, schoolId),
        eq(pointEarningRules.isActive, true),
      ))
      .orderBy(asc(pointEarningRules.sortOrder), asc(pointEarningRules.code));
  }
}
