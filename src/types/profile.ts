export const PROFILE_INTERESTS = [
  'Reading',
  'Art',
  'Music',
  'Sports',
  'Coding',
  'Gaming',
  'Dance',
  'Photography',
] as const;

export const MIN_SIGNUP_INTERESTS = 5;

export type ProfileInterest = (typeof PROFILE_INTERESTS)[number];

export type ProfileAvatarKind = 'preset' | 'upload';

export interface ProfileAvatar {
  kind: ProfileAvatarKind;
  value: string;
}

export interface ProfileResponse {
  avatar: ProfileAvatar | null;
  interests: ProfileInterest[];
}

export interface ProfileDescriptor extends ProfileResponse {
  id: string;
  schoolId: string;
  displayName: string;
  phoneE164: string;
}

export const PROFILE_AVATAR_PRESETS = [
  'avatar-1',
  'avatar-2',
  'avatar-3',
  'avatar-4',
  'avatar-5',
  'avatar-6',
  'avatar-teacher',
] as const;

export type ProfileAvatarPreset = (typeof PROFILE_AVATAR_PRESETS)[number];

export function isProfileAvatarPreset(value: string): value is ProfileAvatarPreset {
  return (PROFILE_AVATAR_PRESETS as readonly string[]).includes(value);
}
