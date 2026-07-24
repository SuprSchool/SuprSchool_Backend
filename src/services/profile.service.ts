import type { ProfileRepository } from '../db/repositories/profile.repository.js';
import { AppError } from '../lib/errors.js';
import {
  isProfileAvatarPreset,
  type ProfileAvatar,
  type ProfileDescriptor,
  type ProfileInterest,
} from '../types/profile.js';

export type { ProfileRepository } from '../db/repositories/profile.repository.js';

export interface AvatarDisplayUrlSigner {
  createSignedDownloadUrl(bucket: string, objectPath: string): Promise<string>;
}

export interface ProfileService {
  getProfile(userId: string): Promise<ProfileDescriptor>;
  replaceInterests(userId: string, interests: readonly ProfileInterest[]): Promise<void>;
  setPresetAvatar(userId: string, presetId: string): Promise<ProfileAvatar>;
}

export function createProfileService({
  repository,
  avatarUrlSigner,
}: {
  repository: ProfileRepository;
  avatarUrlSigner?: AvatarDisplayUrlSigner;
}): ProfileService {
  return {
    async getProfile(userId) {
      const profile = await repository.getProfile(userId);
      if (!profile) throw new AppError('NOT_FOUND', 404, 'Profile not found');
      if (profile.avatar?.kind !== 'upload') return profile;
      if (avatarUrlSigner === undefined) {
        throw new AppError('INTERNAL_ERROR', 500, 'Avatar URL signing is not configured');
      }
      return {
        ...profile,
        avatar: {
          kind: 'upload',
          value: await avatarUrlSigner.createSignedDownloadUrl(
            'avatars',
            profile.avatar.value,
          ),
        },
      };
    },
    replaceInterests: (userId, interests) => repository.replaceInterests(userId, interests),
    async setPresetAvatar(userId, presetId) {
      if (!isProfileAvatarPreset(presetId)) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid avatar preset');
      }
      if (!await repository.setPresetAvatar(userId, presetId)) {
        throw new AppError('NOT_FOUND', 404, 'Profile not found');
      }
      return { kind: 'preset', value: presetId };
    },
  };
}
