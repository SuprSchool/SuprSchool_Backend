import type { PointsRepository } from '../db/repositories/points.repository.js';
import type { StudentRankingReader } from './ranking-refresh.service.js';
import { AppError } from '../lib/errors.js';
import type {
  EarnPointsCard,
  PointCursorPage,
  PointsActivityResponse,
  PointsIdentity,
  PointsLevel,
} from '../types/points.js';
import { encodePointsCursor } from '../validators/points.schemas.js';

export class PointsService {
  public constructor(
    private readonly repository: Pick<
      PointsRepository,
      | 'findCurrentPoints'
      | 'findLevelRules'
      | 'listActivity'
      | 'listActiveEarningRules'
    >,
    private readonly rankings?: StudentRankingReader,
  ) {}

  public async getLevel(identity: PointsIdentity): Promise<PointsLevel> {
    const [currentPoints, levels] = await Promise.all([
      this.repository.findCurrentPoints(identity),
      this.repository.findLevelRules(identity.schoolId),
    ]);
    const sortedLevels = [...levels].sort((left, right) => left.minimumPoints - right.minimumPoints);
    const currentLevel = sortedLevels.filter((item) => item.minimumPoints <= currentPoints).at(-1)
      ?? sortedLevels[0];
    if (!currentLevel) {
      throw new AppError('INTERNAL_ERROR', 500, 'Point levels are not configured');
    }
    const nextLevel = sortedLevels.find((item) => item.minimumPoints > currentPoints);
    const maxPoints = nextLevel?.minimumPoints ?? currentLevel.minimumPoints;

    return {
      currentPoints,
      level: currentLevel.level,
      maxPoints,
      pointsToNext: nextLevel ? nextLevel.minimumPoints - currentPoints : 0,
    };
  }

  public async getActivity(
    identity: PointsIdentity,
    page: PointCursorPage,
  ): Promise<PointsActivityResponse> {
    const result = await this.repository.listActivity(identity, page);
    return {
      items: result.items.map((item) => ({
        id: item.id,
        points: item.points,
        timestamp: item.occurredAt,
        title: item.rule.label,
      })),
      ...(result.nextCursor === undefined ? {} : { nextCursor: encodePointsCursor(result.nextCursor) }),
    };
  }

  public async getClassRanking(
    identity: PointsIdentity,
    query: Parameters<StudentRankingReader['getCurrentRanking']>[1],
  ) {
    if (this.rankings === undefined) {
      throw new AppError('NOT_FOUND', 404, 'Class rankings are not available');
    }
    return this.rankings.getCurrentRanking(identity, query);
  }

  public async getEarningRules(identity: PointsIdentity): Promise<readonly EarnPointsCard[]> {
    const rules = await this.repository.listActiveEarningRules(identity.schoolId);
    return rules.map((rule) => ({
      icon: rule.icon,
      id: rule.code,
      label: rule.label,
      points: `+${rule.points} pts`,
    }));
  }
}
