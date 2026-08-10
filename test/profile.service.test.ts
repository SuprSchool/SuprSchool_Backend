import { describe, expect, it, vi } from 'vitest';

import type { ProfileRepository } from '../src/db/repositories/profile.repository.js';
import { createProfileService } from '../src/services/profile.service.js';
import type { ProfileDescriptor, ProfileResponse } from '../src/types/profile.js';

const legacyProfileResponse: ProfileResponse = {
  avatar: null,
  interests: [],
};

describe('ProfileService', () => {
  it('keeps the legacy profile response shape assignable', () => {
    expect(legacyProfileResponse).toEqual({ avatar: null, interests: [] });
  });

  it('returns the authenticated profile descriptor unchanged', async () => {
    const descriptor: ProfileDescriptor = {
      avatar: { kind: 'preset', value: 'avatar-1' },
      className: 'Class 9th - B',
      displayName: 'Aarav Sharma',
      id: '22222222-2222-4222-8222-222222222222',
      interests: ['Coding', 'Reading'],
      phoneE164: '+917755090948',
      schoolId: '11111111-1111-4111-8111-111111111111',
      section: 'B',
    };
    const repository = {
      getProfile: vi.fn().mockResolvedValue(descriptor),
    } as unknown as ProfileRepository;

    const service = createProfileService({ repository });

    await expect(service.getProfile(descriptor.id, descriptor.schoolId)).resolves.toEqual(descriptor);
    expect(repository.getProfile).toHaveBeenCalledWith(descriptor.id, descriptor.schoolId);
  });

  it('exposes a short-lived display URL instead of a private uploaded-avatar path', async () => {
    const descriptor: ProfileDescriptor = {
      avatar: { kind: 'upload', value: 'school/avatar/user/private-object' },
      className: 'Class 9th - B',
      displayName: 'Aarav Sharma',
      id: '22222222-2222-4222-8222-222222222222',
      interests: ['Coding', 'Reading'],
      phoneE164: '+917755090948',
      schoolId: '11111111-1111-4111-8111-111111111111',
      section: 'B',
    };
    const avatarUrlSigner = {
      createSignedDownloadUrl: vi.fn().mockResolvedValue('https://storage.example.test/avatar?token=short-lived'),
    };
    const repository = {
      getProfile: vi.fn().mockResolvedValue(descriptor),
    } as unknown as ProfileRepository;

    const service = createProfileService({ repository, avatarUrlSigner });

    await expect(service.getProfile(descriptor.id, descriptor.schoolId)).resolves.toEqual({
      ...descriptor,
      avatar: { kind: 'upload', value: 'https://storage.example.test/avatar?token=short-lived' },
    });
    expect(avatarUrlSigner.createSignedDownloadUrl).toHaveBeenCalledWith(
      'avatars',
      'school/avatar/user/private-object',
    );
  });

  it('leaves preset avatar values unchanged without signing them', async () => {
    const descriptor: ProfileDescriptor = {
      avatar: { kind: 'preset', value: 'avatar-1' },
      className: null,
      displayName: 'Aarav Sharma',
      id: '22222222-2222-4222-8222-222222222222',
      interests: [],
      phoneE164: '+917755090948',
      schoolId: '11111111-1111-4111-8111-111111111111',
      section: null,
    };
    const avatarUrlSigner = { createSignedDownloadUrl: vi.fn() };
    const service = createProfileService({
      repository: { getProfile: vi.fn().mockResolvedValue(descriptor) } as unknown as ProfileRepository,
      avatarUrlSigner,
    });

    await expect(service.getProfile(descriptor.id, descriptor.schoolId)).resolves.toEqual(descriptor);
    expect(avatarUrlSigner.createSignedDownloadUrl).not.toHaveBeenCalled();
  });
});
