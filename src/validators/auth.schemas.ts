import { z } from 'zod';

import { MIN_SIGNUP_INTERESTS, PROFILE_INTERESTS } from '../types/profile.js';

export const signupStartSchema = z.object({
  mobile: z.string().trim().min(1),
}).strict();

export const signupVerifySchema = z.object({
  mobile: z.string().trim().min(1),
  otp: z.string().regex(/^\d{4}$/),
}).strict();

export const signupCompleteSchema = z.object({
  mobile: z.string().trim().min(1),
  password: z.string().min(8),
  interests: z.array(z.enum(PROFILE_INTERESTS))
    .min(MIN_SIGNUP_INTERESTS)
    .refine((interests) => new Set(interests).size === interests.length, {
      message: 'Interests must be unique',
    })
    .optional(),
}).strict();

export const loginSchema = z.object({
  mobile: z.string().trim().min(1),
  password: z.string().min(8),
}).strict();

export const passwordResetStartSchema = z.object({
  mobile: z.string().trim().min(1),
}).strict();

export const passwordResetVerifySchema = z.object({
  mobile: z.string().trim().min(1),
  otp: z.string().regex(/^\d{4}$/),
}).strict();

export const passwordResetCompleteSchema = z.object({
  mobile: z.string().trim().min(1),
  newPassword: z.string().min(8),
}).strict();

export const contactAdminSchema = z.object({
  mobile: z.string().trim().min(1),
  message: z.string().trim().min(1).max(2000),
  role: z.enum(['student', 'teacher']).optional(),
}).strict();

export const refreshSchema = z.object({
  refreshToken: z.string().trim().min(1),
}).strict();
