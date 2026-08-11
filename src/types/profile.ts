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
  /**
   * The current-year class the user is enrolled in as a student, named exactly
   * as `classes.display_name` (e.g. "Class 9th - B") — the same source the
   * signup directory preview already publishes. `null` for anyone with no
   * active student membership in the requested school, teachers included.
   */
  className: string | null;
  /** `classes.section` for that same enrolment (e.g. "B"); `null` alongside it. */
  section: string | null;
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
