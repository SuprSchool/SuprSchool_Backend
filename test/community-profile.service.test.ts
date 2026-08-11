import { describe, expect, it, vi } from 'vitest';

import type {
  CommunityProfileRepository,
  SchoolContentRecord,
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
