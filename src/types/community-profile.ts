import type { ProfileDescriptor } from './profile.js';

export type CommunityRole = 'student' | 'teacher';

/**
 * Community reads use the canonical profile descriptor for ownership and
 * tenancy, while deliberately leaving profile presentation fields to /v1/profile.
 */
export type CommunityIdentity = Pick<ProfileDescriptor, 'schoolId'> & {
  role: CommunityRole;
  userId: ProfileDescriptor['id'];
};

/**
 * Converts the profile contract owned by the profile feature into the narrow
 * identity required by community readers. Overview DTOs intentionally do not
 * duplicate avatar or interests; clients compose them from ProfileDescriptor.
 */
export function toCommunityIdentity(
  profile: ProfileDescriptor,
  role: CommunityRole,
): CommunityIdentity {
  return {
    role,
    schoolId: profile.schoolId,
    userId: profile.id,
  };
}

/**
 * Current-school reads return a stable, bounded first gallery page. A later
 * cursor endpoint can use the same sort key without increasing signing work.
 */
export const CURRENT_SCHOOL_GALLERY_PAGE_SIZE = 24;

export interface StudentProfileOverview {
  id: string;
  classSection: string;
  rollNumber: string;
  schoolName: string;
  stats: {
    attendance: string;
    classRank: string;
    avgScore: string;
    streakDays: number;
    points: number;
    eventsParticipated: number;
  };
  announcementCount: number;
}

export interface TeacherProfileOverview {
  id: string;
  classTeacher: string;
  engages: string;
  schoolName: string;
  stats: {
    diaryEntries: number;
    totalAssignments: number;
    eventsConducted: number;
    testsConducted: number;
  };
  announcementCount: number;
}

export interface AssessmentSummaryReader {
  getStudentAverage(schoolId: string, studentId: string): Promise<number | null>;
}

export interface SchoolEventSummary {
  category: string;
  date: string;
  id: string;
  title: string;
}

export interface SchoolEventSummaryReader {
  listVisible(identity: CommunityIdentity): Promise<readonly SchoolEventSummary[]>;
  countParticipated(schoolId: string, studentId: string): Promise<number>;
  countConducted(schoolId: string, teacherId: string): Promise<number>;
}

/**
 * Task 4/5 owns the point balance and ranking snapshot tables. This adapter
 * keeps their read contract out of community-owned tables and migrations.
 */
export interface StudentProgressSummaryReader {
  getStudentProgress(input: {
    classId: string;
    schoolId: string;
    studentId: string;
  }): Promise<{ classRank: number | null; points: number }>;
}

export interface SchoolAssetUrlSigner {
  createSignedDownloadUrl(
    bucket: string,
    objectPath: string,
    expiresInSeconds: number,
  ): Promise<string>;
}

export interface SchoolGalleryItem {
  altText: string;
  id: string;
  url: string;
}

export interface CurrentSchool {
  address: string;
  description: readonly string[];
  events: readonly SchoolEventSummary[];
  gallery: readonly SchoolGalleryItem[];
  id: string;
  logoUrl?: string;
  name: string;
  rating: string;
  rules: readonly string[];
  rulesIntro: string;
  studentCount: number;
  teacherCount: number;
}
