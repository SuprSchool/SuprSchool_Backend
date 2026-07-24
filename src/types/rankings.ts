export type RankingScopeKind = 'class' | 'subject';
export type StudentRankingScope = 'section' | 'subject';

export interface RankingIdentity {
  schoolId: string;
  userId: string;
}

export interface StudentRankingQuery {
  scope: StudentRankingScope;
  subjectName?: string;
}

export interface StudentClassRankingEntry {
  isCurrentUser: boolean;
  marks: number;
  name: string;
  points: number;
  rank: number;
  rollNo: string;
  streakCount: number;
}

export interface StudentClassRanking {
  entries: readonly StudentClassRankingEntry[];
  generatedAt: string | null;
  subjectId?: string;
}

export interface RankingOutboxEvent {
  eventId: string;
  schoolId: string;
  scopeId: string;
  targetVersion: string;
}

export interface RankingRefreshPayload {
  scopeId: string;
  targetVersion: string;
}

export type RankingRefreshInput = RankingOutboxEvent;
