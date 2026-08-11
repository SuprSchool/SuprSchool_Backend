export const pointSourceTypeValues = [
  'assignment_submission',
  'assessment_result',
  'attendance_streak',
  'event_registration',
  'event_result',
] as const;

export const pointEarningIconValues = [
  'document',
  'star',
  'fire',
  'medal',
  'calendar',
] as const;

export type PointSourceType = (typeof pointSourceTypeValues)[number];
export type PointEarningIcon = (typeof pointEarningIconValues)[number];
export type PointMetadata = Record<string, unknown>;

export interface PointsIdentity {
  schoolId: string;
  userId: string;
}

export interface PointEarningRule {
  code: string;
  icon: PointEarningIcon;
  isActive: boolean;
  label: string;
  points: number;
  sortOrder: number;
}

export interface PointLevelRule {
  level: number;
  minimumPoints: number;
}

export interface PointAwardInput {
  metadata: PointMetadata;
  occurredAt: Date;
  recipientUserId: string;
  ruleCode: string;
  schoolId: string;
  sourceId: string;
  sourceType: PointSourceType;
}

export interface PointAwardInsert extends PointAwardInput {
  awardKey: string;
  points: number;
}

export interface PointAwardResult {
  awarded: boolean;
  entryId?: string;
}

export const pointActivityPeriodValues = ['week', 'month', 'all'] as const;

/**
 * The My Points period dropdown (`761:4817`) selects a window. It is a query
 * parameter in its own right — reading it out of `cursor` made one parameter
 * carry two unrelated settings, so every period returned the same page.
 */
export type PointActivityPeriod = (typeof pointActivityPeriodValues)[number];

export interface PointActivityCursor {
  id: string;
  occurredAt: string;
}

export interface PointCursorPage {
  cursor?: PointActivityCursor;
  limit: number;
  period: PointActivityPeriod;
}

export interface PointActivityRecord {
  id: string;
  occurredAt: string;
  points: number;
  rule: Pick<PointEarningRule, 'code' | 'icon' | 'label'>;
}

export interface PointActivityPage {
  items: readonly PointActivityRecord[];
  nextCursor?: PointActivityCursor;
}

export interface PointsLevel {
  currentPoints: number;
  level: number;
  maxPoints: number;
  pointsToNext: number;
}

export interface PointsActivity {
  id: string;
  points: number;
  timestamp: string;
  title: string;
}

export interface PointsActivityResponse {
  items: readonly PointsActivity[];
  nextCursor?: string;
}

export interface EarnPointsCard {
  icon: PointEarningIcon;
  id: string;
  label: string;
  points: string;
}
