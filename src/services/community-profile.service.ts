import type { CommunityProfileRepository } from '../db/repositories/community-profile.repository.js';
import { AppError } from '../lib/errors.js';
import {
  CURRENT_SCHOOL_EVENT_PAGE_SIZE,
  CURRENT_SCHOOL_GALLERY_PAGE_SIZE,
} from '../types/community-profile.js';
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
/** Event banners live with the rest of the event resources the events service signs. */
export const SCHOOL_EVENT_IMAGE_BUCKET = 'academic-files';
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
      const [gallery, eventRecords] = await Promise.all([
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
      // Bounded here as well as in the query, so an implementation cannot turn
      // one school read into unbounded banner-signing work.
      const events = await Promise.all(eventRecords
        .slice(0, CURRENT_SCHOOL_EVENT_PAGE_SIZE)
        .map(async (event) => ({
          additionalCategoryCount: event.additionalCategoryCount,
          category: event.category,
          date: event.date,
          id: event.id,
          // Never a broken URL: an event with no confirmed banner says so.
          imageUrl: event.imageObjectPath === null
            ? null
            : await signSchoolAsset(
              dependencies.schoolAssetUrlSigner,
              school.id,
              event.imageObjectPath,
              SCHOOL_EVENT_IMAGE_BUCKET,
            ),
          isEligible: event.isEligible,
          registeredCount: event.registeredCount,
          title: event.title,
        })));

      return {
        address: school.address,
        description: school.description,
        events,
        gallery,
        id: school.id,
        ...(logoUrl === undefined ? {} : { logoUrl }),
        name: school.name,
        phone: school.phone,
        rating: school.rating,
        rules: school.rules,
        rulesIntro: school.rulesIntro,
        studentCount: school.studentCount,
        supportEmail: school.supportEmail,
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
  bucket: string = SCHOOL_GALLERY_BUCKET,
): Promise<string> {
  // Every storage object path is rooted at its own school. Signing one that is
  // not would hand a caller a URL into another tenant's bucket.
  if (!objectPath.startsWith(`${schoolId}/`)) {
    throw new AppError('INTERNAL_ERROR', 500, `School asset in ${bucket} has an invalid object path`);
  }
  return signer.createSignedDownloadUrl(
    bucket,
    objectPath,
    SCHOOL_ASSET_URL_TTL_SECONDS,
  );
}

function formatPercentage(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${Number(value.toFixed(1))}%`;
}
