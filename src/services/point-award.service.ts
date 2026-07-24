import type { PointsRepository } from '../db/repositories/points.repository.js';
import { AppError } from '../lib/errors.js';
import type { PointAwardInput, PointAwardResult } from '../types/points.js';

export interface PointAwardPort {
  awardIfAbsent(input: PointAwardInput): Promise<PointAwardResult>;
}

/** Stable source-domain rule codes; amounts and activation remain school-configured. */
export const pointAwardRuleCodes = {
  assignmentSubmitted: 'assignment-submitted',
  assessmentResultPublished: 'assessment-result-published',
  attendanceStreak: 'attendance-streak',
  eventRegistered: 'event-registered',
  eventResultPublished: 'event-result-published',
} as const;

export interface PointAwardGatewayDependencies {
  repository: Pick<
    PointsRepository,
    | 'findActiveEarningRule'
    | 'hasActiveStudentMembership'
    | 'insertAwardIfAbsent'
  >;
}

/**
 * The only point-award entry point. It derives the amount from a durable
 * earning rule and makes a source/rule/recipient award idempotent.
 */
export class PointAwardGateway implements PointAwardPort {
  public constructor(private readonly dependencies: PointAwardGatewayDependencies) {}

  public async awardIfAbsent(input: PointAwardInput): Promise<PointAwardResult> {
    const rule = await this.dependencies.repository.findActiveEarningRule(
      input.schoolId,
      input.ruleCode,
    );
    if (!rule) return { awarded: false };
    const hasMembership = await this.dependencies.repository.hasActiveStudentMembership(
      input.schoolId,
      input.recipientUserId,
    );
    if (!hasMembership) {
      throw new AppError('FORBIDDEN', 403, 'Point recipient must have an active student membership');
    }

    const entryId = await this.dependencies.repository.insertAwardIfAbsent({
      ...input,
      awardKey: awardKeyFor(input),
      points: rule.points,
    });
    if (!entryId) return { awarded: false };


    return { awarded: true, entryId };
  }
}

function awardKeyFor(input: PointAwardInput): string {
  return JSON.stringify([
    input.recipientUserId,
    input.sourceType,
    input.sourceId,
    input.ruleCode,
  ]);
}
