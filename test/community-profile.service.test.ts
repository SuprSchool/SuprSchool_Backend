import { describe, expect, it, vi } from 'vitest';

import type {
  CommunityProfileRepository,
  SchoolContentRecord,
  StudentOverviewRecord,
} from '../src/db/repositories/community-profile.repository.js';
import { createCommunityProfileService } from '../src/services/community-profile.service.js';
import {
  CURRENT_SCHOOL_GALLERY_PAGE_SIZE,
  toCommunityIdentity,
} from '../src/types/community-profile.js';
import type { SchoolEventSummaryRecord } from '../src/types/community-profile.js';
import type { ProfileDescriptor } from '../src/types/profile.js';

const profile: ProfileDescriptor = {
  avatar: { kind: 'preset', value: 'avatar-1' },
  className: 'Class 9th - B',
  displayName: 'Ada Lovelace',
  id: '00000000-0000-4000-8000-000000000101',
  interests: ['Coding', 'Reading', 'Art', 'Music', 'Sports'],
  phoneE164: '+15550000001',
  schoolId: '00000000-0000-4000-8000-000000000001',
  section: 'B',
};

function createSchool(
  galleryLength: number,
  contact: Pick<SchoolContentRecord, 'phone' | 'supportEmail'> = {
    phone: '+911234567890',
    supportEmail: 'help@school.example',
  },
): SchoolContentRecord {
  return {
    address: '12 Learning Lane',
    description: [],
    gallery: Array.from({ length: galleryLength }, (_, index) => ({
      altText: `Gallery ${index + 1}`,
      id: `gallery-${index + 1}`,
      objectPath: `${profile.schoolId}/gallery/gallery-${index + 1}`,
    })),
    id: profile.schoolId,
    logoPath: null,
    name: 'Supr School',
    phone: contact.phone,
    rating: 'A+',
    rules: [],
    rulesIntro: '',
    studentCount: 12,
    supportEmail: contact.supportEmail,
    teacherCount: 2,
  };
}

function createEventRecord(
  overrides: Partial<SchoolEventSummaryRecord> = {},
): SchoolEventSummaryRecord {
  return {
    additionalCategoryCount: 2,
    category: 'Curricular Competition',
    date: '2026-08-14T09:00:00.000000Z',
    id: 'event-1',
    imageObjectPath: `${profile.schoolId}/events/event-1/banner.jpg`,
    isEligible: true,
    registeredCount: 50,
    title: 'Drama Club Fest',
    ...overrides,
  };
}

function createRepository(school: SchoolContentRecord): CommunityProfileRepository {
  return {
    findCurrentSchool: vi.fn(async () => school),
    findStudentOverview: vi.fn(async () => null),
    findTeacherOverview: vi.fn(async () => null),
    findVisibleSchoolEvents: vi.fn(async () => []),
  };
}

describe('community profile service', () => {
  it('adapts the canonical profile descriptor without duplicating avatar or interests', () => {
    expect(toCommunityIdentity(profile, 'student')).toEqual({
      role: 'student',
      schoolId: profile.schoolId,
      userId: profile.id,
    });
  });

  it('signs only the bounded stable gallery page', async () => {
    const signer = {
      createSignedDownloadUrl: vi.fn(async (_bucket: string, objectPath: string) => (
        `https://storage.example/${objectPath}?token=private`
      )),
    };
    const service = createCommunityProfileService({
      assessmentSummaryReader: { getStudentAverage: vi.fn(async () => null) },
      eventSummaryReader: {
        countConducted: vi.fn(async () => 0),
        countParticipated: vi.fn(async () => 0),
        listVisible: vi.fn(async () => []),
      },
      repository: createRepository(createSchool(CURRENT_SCHOOL_GALLERY_PAGE_SIZE + 1)),
      schoolAssetUrlSigner: signer,
    });

    const school = await service.getCurrentSchool(toCommunityIdentity(profile, 'teacher'));

    expect(school.gallery).toHaveLength(CURRENT_SCHOOL_GALLERY_PAGE_SIZE);
    expect(school.gallery.at(-1)).toMatchObject({ id: `gallery-${CURRENT_SCHOOL_GALLERY_PAGE_SIZE}` });
    expect(signer.createSignedDownloadUrl).toHaveBeenCalledTimes(CURRENT_SCHOOL_GALLERY_PAGE_SIZE);
  });

  // 758:4541 draws Call School Office and Email Support as chevron rows. The
  // payload carried neither, so both rows were unreachable.
  it('returns the school contact fields the Settings rows need', async () => {
    const school = await createServiceFor(createSchool(0)).getCurrentSchool(
      toCommunityIdentity(profile, 'student'),
    );

    expect(school.phone).toBe('+911234567890');
    expect(school.supportEmail).toBe('help@school.example');
  });

  it('reports a school with no published contact details as null, not as an empty row', async () => {
    const school = await createServiceFor(
      createSchool(0, { phone: null, supportEmail: null }),
    ).getCurrentSchool(toCommunityIdentity(profile, 'student'));

    expect(school.phone).toBeNull();
    expect(school.supportEmail).toBeNull();
  });

  // 253:15008 draws a photo, a +N chip, a registered count and an eligibility
  // chip on every event card.
  it('carries the event card fields and signs the banner it was given', async () => {
    const signer = {
      createSignedDownloadUrl: vi.fn(async (bucket: string, objectPath: string) => (
        `https://storage.example/${bucket}/${objectPath}?token=private`
      )),
    };
    const service = createServiceFor(createSchool(0), signer, [
      createEventRecord(),
      createEventRecord({
        additionalCategoryCount: 0,
        id: 'event-2',
        imageObjectPath: null,
        isEligible: false,
        registeredCount: 0,
        title: 'Football Tournament',
      }),
    ]);

    const school = await service.getCurrentSchool(toCommunityIdentity(profile, 'student'));

    expect(school.events[0]).toMatchObject({
      additionalCategoryCount: 2,
      imageUrl: `https://storage.example/academic-files/${profile.schoolId}/events/event-1/banner.jpg?token=private`,
      isEligible: true,
      registeredCount: 50,
    });
    // Never a broken URL: an event with no confirmed banner says so.
    expect(school.events[1]).toMatchObject({
      additionalCategoryCount: 0,
      imageUrl: null,
      isEligible: false,
      registeredCount: 0,
    });
  });

  it('refuses to sign an event banner belonging to another school', async () => {
    const service = createServiceFor(createSchool(0), undefined, [
      createEventRecord({ imageObjectPath: 'another-school/events/event-1/banner.jpg' }),
    ]);

    await expect(
      service.getCurrentSchool(toCommunityIdentity(profile, 'student')),
    ).rejects.toThrow(/invalid object path/i);
  });
});

/**
 * `648:10485` — one student as the rest of their school sees them.
 *
 * The tenancy argument for this read is that the subject is resolved with the
 * *viewer's* school id, so these assert that pairing directly rather than
 * trusting the SQL.
 */
describe('community profile service: student directory profile', () => {
  const viewerSchoolId = profile.schoolId;
  const subjectId = '00000000-0000-4000-8000-000000000202';
  const teacherViewer = {
    role: 'teacher' as const,
    schoolId: viewerSchoolId,
    userId: '00000000-0000-4000-8000-000000000102',
  };

  function createOverview(
    overrides: Partial<StudentOverviewRecord> = {},
  ): StudentOverviewRecord {
    return {
      announcementCount: 7,
      attendance: '94.3%',
      classId: '00000000-0000-4000-8000-000000000301',
      classSection: 'Class 9th - B',
      id: subjectId,
      rollNumber: '23',
      schoolId: viewerSchoolId,
      schoolName: 'Riverside International School',
      streakDays: 12,
      ...overrides,
    };
  }

  function createDirectoryService(options: {
    descriptor?: ProfileDescriptor | undefined;
    eventsParticipated?: number;
    omitDescriptorReader?: boolean;
    overview?: StudentOverviewRecord | null;
    progress?: { classRank: number | null; points: number };
  } = {}) {
    const overview = options.overview === undefined ? createOverview() : options.overview;
    const findStudentOverview = vi.fn(async () => overview);
    const getProfile = vi.fn(async () => options.descriptor ?? {
      ...profile,
      displayName: 'John Smith',
      id: subjectId,
    });
    const countParticipated = vi.fn(async () => options.eventsParticipated ?? 4);
    const getStudentProgress = vi.fn(async () => (
      options.progress ?? { classRank: 5, points: 850 }
    ));
    const service = createCommunityProfileService({
      assessmentSummaryReader: { getStudentAverage: vi.fn(async () => 91.25) },
      eventSummaryReader: {
        countConducted: vi.fn(async () => 0),
        countParticipated,
        listVisible: vi.fn(async () => []),
      },
      ...(options.omitDescriptorReader === true
        ? {}
        : { profileDescriptorReader: { getProfile } }),
      repository: {
        findCurrentSchool: vi.fn(async () => null),
        findStudentOverview,
        findTeacherOverview: vi.fn(async () => null),
        findVisibleSchoolEvents: vi.fn(async () => []),
      },
      schoolAssetUrlSigner: { createSignedDownloadUrl: vi.fn(async () => 'https://unused') },
      studentProgressSummaryReader: { getStudentProgress },
    });
    return { countParticipated, findStudentOverview, getProfile, getStudentProgress, service };
  }

  it('resolves the subject inside the viewer school and returns the frame fields', async () => {
    const { findStudentOverview, getProfile, getStudentProgress, service } =
      createDirectoryService();

    const view = await service.getStudentDirectoryProfile(teacherViewer, subjectId);

    expect(findStudentOverview).toHaveBeenCalledWith(
      { role: 'student', schoolId: viewerSchoolId, userId: subjectId },
      expect.any(Date),
    );
    expect(getProfile).toHaveBeenCalledWith(subjectId, viewerSchoolId);
    expect(getStudentProgress).toHaveBeenCalledWith({
      classId: '00000000-0000-4000-8000-000000000301',
      schoolId: viewerSchoolId,
      studentId: subjectId,
    });
    expect(view).toEqual({
      avatar: { kind: 'preset', value: 'avatar-1' },
      classSection: 'Class 9th - B',
      id: subjectId,
      interests: ['Coding', 'Reading', 'Art', 'Music', 'Sports'],
      name: 'John Smith',
      rollNumber: '23',
      schoolName: 'Riverside International School',
      stats: {
        classRank: '#5',
        eventsParticipated: 4,
        points: 850,
        streakDays: 12,
      },
    });
  });

  // The self-overview carries all four. None of them belong to a viewer.
  it('never publishes the phone number, attendance, average score or unread count', async () => {
    const { service } = createDirectoryService();

    const view = await service.getStudentDirectoryProfile(teacherViewer, subjectId);

    expect(view).not.toHaveProperty('phoneE164');
    expect(view).not.toHaveProperty('announcementCount');
    expect(view.stats).not.toHaveProperty('attendance');
    expect(view.stats).not.toHaveProperty('avgScore');
    expect(Object.keys(view.stats).sort()).toEqual([
      'classRank', 'eventsParticipated', 'points', 'streakDays',
    ]);
  });

  // A student in another school has no active membership in the viewer's, so
  // the shared query returns null. It must read as "no such student", not as
  // "there is one but you may not see it".
  it('is a 404, not a 403, when the subject is outside the viewer school', async () => {
    const { getProfile, service } = createDirectoryService({ overview: null });

    await expect(service.getStudentDirectoryProfile(teacherViewer, subjectId))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    // The descriptor is never read, so nothing about the subject is touched.
    expect(getProfile).not.toHaveBeenCalled();
  });

  it('serves a student viewer the same payload as a teacher viewer', async () => {
    const { service } = createDirectoryService();

    const asStudent = await service.getStudentDirectoryProfile(
      toCommunityIdentity(profile, 'student'),
      subjectId,
    );
    const asTeacher = await service.getStudentDirectoryProfile(teacherViewer, subjectId);

    expect(asStudent).toEqual(asTeacher);
  });

  it('renders an em dash when no ranking snapshot covers the subject', async () => {
    const { service } = createDirectoryService({ progress: { classRank: null, points: 0 } });

    const view = await service.getStudentDirectoryProfile(teacherViewer, subjectId);

    expect(view.stats.classRank).toBe('—');
    expect(view.stats.points).toBe(0);
  });

  it('fails loudly rather than serving a nameless profile when unwired', async () => {
    const { service } = createDirectoryService({ omitDescriptorReader: true });

    await expect(service.getStudentDirectoryProfile(teacherViewer, subjectId))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR', status: 500 });
  });
});

function createServiceFor(
  school: SchoolContentRecord,
  signer: { createSignedDownloadUrl: (bucket: string, objectPath: string, ttl: number) => Promise<string> } = {
    createSignedDownloadUrl: async (bucket: string, objectPath: string) => (
      `https://storage.example/${bucket}/${objectPath}?token=private`
    ),
  },
  events: readonly SchoolEventSummaryRecord[] = [],
) {
  const repository = createRepository(school);
  return createCommunityProfileService({
    assessmentSummaryReader: { getStudentAverage: vi.fn(async () => null) },
    eventSummaryReader: {
      countConducted: vi.fn(async () => 0),
      countParticipated: vi.fn(async () => 0),
      listVisible: vi.fn(async () => events),
    },
    repository,
    schoolAssetUrlSigner: signer,
  });
}
