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

function createSchool(galleryLength: number): SchoolContentRecord {
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
    rating: 'A+',
    rules: [],
    rulesIntro: '',
    studentCount: 12,
    teacherCount: 2,
  };
}

function createRepository(school: SchoolContentRecord): CommunityProfileRepository {
  return {
    findCurrentSchool: vi.fn(async () => school),
    findStudentOverview: vi.fn(async () => null),
    findTeacherOverview: vi.fn(async () => null),
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
});
