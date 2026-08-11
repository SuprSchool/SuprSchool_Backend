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

/**
 * The same bound for the Events tab. Each event can carry a banner to sign, so
 * an unbounded list would turn one school read into unbounded signing work.
 */
export const CURRENT_SCHOOL_EVENT_PAGE_SIZE = 24;

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

/**
 * What the reader returns: the banner is still an object path here, because a
 * repository cannot sign a private URL. The service signs it — the same split
 * the gallery already uses.
 */
export interface SchoolEventSummaryRecord {
  /**
   * Chips the card draws beyond the primary category chip (`253:15027` shows
   * `+2`). Derived from the descriptors the event actually carries — the
   * activity kind when it is not already the primary chip, plus the
   * participation mode when one is set — never a placeholder.
   */
  additionalCategoryCount: number;
  category: string;
  date: string;
  id: string;
  imageObjectPath: string | null;
  isEligible: boolean;
  registeredCount: number;
  title: string;
}

/** The wire shape, with the banner signed or explicitly absent. */
export interface SchoolEventSummary {
  additionalCategoryCount: number;
  category: string;
  date: string;
  id: string;
  /** Signed read URL, or null when the event has no confirmed banner. */
  imageUrl: string | null;
  isEligible: boolean;
  registeredCount: number;
  title: string;
}

export interface SchoolEventSummaryReader {
  listVisible(identity: CommunityIdentity): Promise<readonly SchoolEventSummaryRecord[]>;
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
  /** Settings › Call School Office (758:4541). Null when none is published. */
  phone: string | null;
  rating: string;
  rules: readonly string[];
  rulesIntro: string;
  studentCount: number;
  /** Settings › Email Support (758:4541). Null when none is published. */
  supportEmail: string | null;
  teacherCount: number;
}
