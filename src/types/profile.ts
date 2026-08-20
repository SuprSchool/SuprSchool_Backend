/**
 * The interest vocabulary, canonical spellings only.
 *
 * The first eight are what signup offers (`253:5375`). The last four are drawn
 * only by the profile editor (`253:14512` for students, `648:10200` for
 * teachers), which publishes a twelve-pill catalogue rather than signup's
 * eight — so `PUT /v1/profile/interests` rejected `Travel`, `Cooking`,
 * `Writing` and `Science` outright and a student could not save any pill from
 * the bottom two rows of their own profile.
 *
 * `Dance` stays the canonical spelling of the 💃 pill. The profile editor
 * draws it as "Dancing", which is a label, not a value: the client maps the
 * two in `services/presentation/student-profile-hobbies.ts`. Adding `Dancing`
 * here would give one interest two storable spellings and split every
 * student's history across both.
 */
export const PROFILE_INTERESTS = [
  'Reading',
  'Art',
  'Music',
  'Sports',
  'Coding',
  'Gaming',
  'Dance',
  'Photography',
  'Travel',
  'Cooking',
  'Writing',
  'Science',
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
