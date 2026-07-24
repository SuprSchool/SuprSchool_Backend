import { z } from 'zod';

import {
  AVATAR_ALLOWED_CONTENT_TYPES,
  AVATAR_MAX_SIZE_BYTES,
} from '../services/avatar.service.js';
import { PROFILE_AVATAR_PRESETS, PROFILE_INTERESTS } from '../types/profile.js';

export const replaceProfileInterestsSchema = z.object({
  interests: z.array(z.enum(PROFILE_INTERESTS)).refine(
    (interests) => new Set(interests).size === interests.length,
    { message: 'Interests must be unique' },
  ),
}).strict();

export const setPresetAvatarSchema = z.object({
  presetId: z.enum(PROFILE_AVATAR_PRESETS),
}).strict();

export const createAvatarUploadSessionSchema = z.object({
  contentType: z.enum(AVATAR_ALLOWED_CONTENT_TYPES),
  sizeBytes: z.number().int().positive().max(AVATAR_MAX_SIZE_BYTES),
}).strict();

export const avatarUploadSessionParamsSchema = z.object({
  sessionId: z.uuid(),
}).strict();
