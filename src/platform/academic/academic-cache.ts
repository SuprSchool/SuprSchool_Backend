import { randomUUID } from 'node:crypto';

import { tenantCacheKey, type CacheStore } from '../cache/cache-store.js';

export interface StudentAssignmentCacheInvalidation {
  assignmentId: string;
  schoolId: string;
  studentId: string;
}

const STUDENT_ASSIGNMENT_LIST_VERSION_TTL_SECONDS = 300;
const EXAM_GROUP_LEADERBOARD_VERSION_TTL_SECONDS = 300;

export function studentAssignmentListVersionKey(schoolId: string, studentId: string): string {
  return tenantCacheKey(schoolId, 'assignments', 'student-list-version', studentId);
}

export function examGroupLeaderboardVersionKey(schoolId: string, groupId: string): string {
  return tenantCacheKey(schoolId, 'exams', 'leaderboard-version', groupId);
}

export interface ExamGroupCacheInvalidation {
  groupId: string;
  schoolId: string;
}

export class AcademicCache {
  public constructor(private readonly cache: CacheStore) {}

  public async get(key: string): Promise<string | null> { return this.cache.get(key); }

  public async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.cache.set(key, value, ttlSeconds);
  }

  public async invalidateStudentAssignments(
    input: StudentAssignmentCacheInvalidation,
  ): Promise<void> {
    await Promise.all([
      this.cache.set(
        studentAssignmentListVersionKey(input.schoolId, input.studentId),
        randomUUID(),
        STUDENT_ASSIGNMENT_LIST_VERSION_TTL_SECONDS,
      ),
      this.cache.delete(tenantCacheKey(input.schoolId, 'assignments', 'detail', input.assignmentId)),
    ]);
  }

  public async invalidateExamGroup(input: ExamGroupCacheInvalidation): Promise<void> {
    await Promise.all([
      this.cache.delete(tenantCacheKey(input.schoolId, 'exams', 'group', input.groupId)),
      this.cache.set(
        examGroupLeaderboardVersionKey(input.schoolId, input.groupId),
        randomUUID(),
        EXAM_GROUP_LEADERBOARD_VERSION_TTL_SECONDS,
      ),
    ]);
  }
}
