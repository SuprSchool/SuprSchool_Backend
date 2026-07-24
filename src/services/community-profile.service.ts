import type { CommunityProfileRepository } from '../db/repositories/community-profile.repository.js';
import { AppError } from '../lib/errors.js';
import { CURRENT_SCHOOL_GALLERY_PAGE_SIZE } from '../types/community-profile.js';
import type {
  AssessmentSummaryReader,
  CommunityIdentity,
  CurrentSchool,
  SchoolAssetUrlSigner,
  SchoolEventSummaryReader,
  StudentProfileOverview,
  StudentProgressSummaryReader,
  TeacherProfileOverview,
} from '../types/community-profile.js';

export const SCHOOL_GALLERY_BUCKET = 'school-gallery';
export const SCHOOL_ASSET_URL_TTL_SECONDS = 300;

export interface CommunityProfileService {
  getCurrentSchool(identity: CommunityIdentity): Promise<CurrentSchool>;
  getStudentOverview(identity: CommunityIdentity): Promise<StudentProfileOverview>;
  getTeacherOverview(identity: CommunityIdentity): Promise<TeacherProfileOverview>;
}

export interface CommunityProfileServiceDependencies {
  assessmentSummaryReader: AssessmentSummaryReader;
  eventSummaryReader: SchoolEventSummaryReader;
  repository: CommunityProfileRepository;
  schoolAssetUrlSigner: SchoolAssetUrlSigner;
  studentProgressSummaryReader?: StudentProgressSummaryReader;
  clock?: () => Date;
}

export function createCommunityProfileService(
  dependencies: CommunityProfileServiceDependencies,
): CommunityProfileService {
  const clock = dependencies.clock ?? (() => new Date());
  const progressSummaryReader = dependencies.studentProgressSummaryReader ?? {
    async getStudentProgress() {
      return { classRank: null, points: 0 };
    },
  } satisfies StudentProgressSummaryReader;

  return {
    async getStudentOverview(identity): Promise<StudentProfileOverview> {
      requireRole(identity, 'student');
      const overview = await dependencies.repository.findStudentOverview(identity, clock());
      if (!overview) {
        throw new AppError('FORBIDDEN', 403, 'An active student class membership is required');
      }
      const [average, eventsParticipated, progress] = await Promise.all([
        dependencies.assessmentSummaryReader.getStudentAverage(identity.schoolId, identity.userId),
        dependencies.eventSummaryReader.countParticipated(identity.schoolId, identity.userId),
        progressSummaryReader.getStudentProgress({
          classId: overview.classId,
          schoolId: identity.schoolId,
          studentId: identity.userId,
        }),
      ]);
      return {
        announcementCount: overview.announcementCount,
        classSection: overview.classSection,
        id: overview.id,
        rollNumber: overview.rollNumber,
        schoolName: overview.schoolName,
        stats: {
          attendance: overview.attendance,
          avgScore: average === null ? '—' : formatPercentage(average),
          classRank: progress.classRank === null ? '—' : `#${progress.classRank}`,
          eventsParticipated: Math.max(0, eventsParticipated),
          points: Math.max(0, progress.points),
          streakDays: overview.streakDays,
        },
      };
    },

    async getTeacherOverview(identity): Promise<TeacherProfileOverview> {
      requireRole(identity, 'teacher');
      const overview = await dependencies.repository.findTeacherOverview(identity, clock());
      if (!overview) {
        throw new AppError('FORBIDDEN', 403, 'An active teacher role is required');
      }
      const eventsConducted = await dependencies.eventSummaryReader.countConducted(
        identity.schoolId,
        identity.userId,
      );
      return {
        announcementCount: overview.announcementCount,
        classTeacher: overview.classTeacher,
        engages: overview.engages,
        id: overview.id,
        schoolName: overview.schoolName,
        stats: {
          diaryEntries: overview.diaryEntries,
          eventsConducted: Math.max(0, eventsConducted),
          testsConducted: overview.testsConducted,
          totalAssignments: overview.totalAssignments,
        },
      };
    },

    async getCurrentSchool(identity): Promise<CurrentSchool> {
      const school = await dependencies.repository.findCurrentSchool(identity);
      if (!school) throw new AppError('FORBIDDEN', 403, 'School access denied');

      const logoUrl = school.logoPath === null
        ? undefined
        : await signSchoolAsset(
          dependencies.schoolAssetUrlSigner,
          school.id,
          school.logoPath,
        );
      const [gallery, events] = await Promise.all([
        // The repository selects a stable first page. Keep a defensive bound
        // here too, so an implementation cannot turn one request into
        // unbounded private-URL signing work.
        Promise.all(school.gallery.slice(0, CURRENT_SCHOOL_GALLERY_PAGE_SIZE).map(async (item) => ({
          altText: item.altText,
          id: item.id,
          url: await signSchoolGalleryItem(
            dependencies.schoolAssetUrlSigner,
            school.id,
            item.id,
            item.objectPath,
          ),
        }))),
        dependencies.eventSummaryReader.listVisible(identity),
      ]);

      return {
        address: school.address,
        description: school.description,
        events,
        gallery,
        id: school.id,
        ...(logoUrl === undefined ? {} : { logoUrl }),
        name: school.name,
        rating: school.rating,
        rules: school.rules,
        rulesIntro: school.rulesIntro,
        studentCount: school.studentCount,
        teacherCount: school.teacherCount,
      };
    },
  };
}

function requireRole(identity: CommunityIdentity, role: CommunityIdentity['role']): void {
  if (identity.role !== role) {
    throw new AppError('FORBIDDEN', 403, 'This overview is available only to the active role');
  }
}

async function signSchoolGalleryItem(
  signer: SchoolAssetUrlSigner,
  schoolId: string,
  galleryItemId: string,
  objectPath: string,
): Promise<string> {
  if (!objectPath.startsWith(`${schoolId}/gallery/`)) {
    throw new AppError('INTERNAL_ERROR', 500, `Gallery item ${galleryItemId} has an invalid object path`);
  }
  return signer.createSignedDownloadUrl(
    SCHOOL_GALLERY_BUCKET,
    objectPath,
    SCHOOL_ASSET_URL_TTL_SECONDS,
  );
}

async function signSchoolAsset(
  signer: SchoolAssetUrlSigner,
  schoolId: string,
  objectPath: string,
): Promise<string> {
  if (!objectPath.startsWith(`${schoolId}/`)) {
    throw new AppError('INTERNAL_ERROR', 500, 'School logo has an invalid object path');
  }
  return signer.createSignedDownloadUrl(
    SCHOOL_GALLERY_BUCKET,
    objectPath,
    SCHOOL_ASSET_URL_TTL_SECONDS,
  );
}

function formatPercentage(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${Number(value.toFixed(1))}%`;
}
