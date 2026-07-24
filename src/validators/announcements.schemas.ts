import { z } from 'zod';

import { academicFileContentTypes } from '../platform/storage/academic-file-content-types.js';

import {
  announcementAudienceTypeValues,
  announcementCategoryValues,
  decodeAnnouncementPublishedCursor,
  decodeTeacherAnnouncementCursor,
} from '../types/announcements.js';

const trimmedText = (minimum: number, maximum: number) => z.string()
  .trim()
  .min(minimum)
  .max(maximum);

export const announcementIdParamSchema = z.object({ announcementId: z.uuid() });
export const announcementResourceParamsSchema = z.object({
  announcementId: z.uuid(),
  resourceId: z.uuid(),
});

export const announcementListQuerySchema = z.object({
  category: z.enum(announcementCategoryValues).optional(),
  cursor: z.string().min(1).transform((value, context) => {
    try {
      return decodeAnnouncementPublishedCursor(value);
    } catch {
      context.addIssue({ code: 'custom', message: 'Invalid announcement cursor' });
      return z.NEVER;
    }
  }).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  search: trimmedText(1, 80).optional(),
});

export const teacherAnnouncementListQuerySchema = z.object({
  cursor: z.string().min(1).transform((value, context) => {
    try {
      return decodeTeacherAnnouncementCursor(value);
    } catch {
      context.addIssue({ code: 'custom', message: 'Invalid teacher announcement cursor' });
      return z.NEVER;
    }
  }).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  scope: z.enum(['all', 'mine']).default('mine'),
});

export const createAnnouncementSchema = z.object({
  audienceType: z.enum(announcementAudienceTypeValues).default('class'),
  body: trimmedText(1, 10_000),
  category: z.enum(announcementCategoryValues),
  classId: z.uuid().optional(),
  subjectId: z.uuid().optional(),
  title: trimmedText(1, 160),
}).superRefine((value, context) => {
  const hasClassTarget = value.classId !== undefined && value.subjectId !== undefined;
  if (value.audienceType === 'class' && !hasClassTarget) {
    context.addIssue({ code: 'custom', message: 'Class announcements require classId and subjectId' });
  }
  if (value.audienceType === 'school' && (value.classId !== undefined || value.subjectId !== undefined)) {
    context.addIssue({ code: 'custom', message: 'School announcements cannot include classId or subjectId' });
  }
});

export const updateAnnouncementSchema = z.object({
  audienceType: z.enum(announcementAudienceTypeValues).optional(),
  body: trimmedText(1, 10_000).optional(),
  category: z.enum(announcementCategoryValues).optional(),
  classId: z.uuid().optional(),
  subjectId: z.uuid().optional(),
  title: trimmedText(1, 160).optional(),
}).superRefine((value, context) => {
  if (!Object.values(value).some((entry) => entry !== undefined)) {
    context.addIssue({ code: 'custom', message: 'At least one announcement field must be supplied' });
  }
  const includesTarget = value.classId !== undefined || value.subjectId !== undefined;
  if (value.audienceType === undefined && includesTarget) {
    context.addIssue({ code: 'custom', message: 'Audience targets require audienceType' });
  }
  if (value.audienceType === 'class' && (value.classId === undefined || value.subjectId === undefined)) {
    context.addIssue({ code: 'custom', message: 'Class announcements require classId and subjectId' });
  }
  if (value.audienceType === 'school' && includesTarget) {
    context.addIssue({ code: 'custom', message: 'School announcements cannot include classId or subjectId' });
  }
});

export const announcementResourceUploadSchema = z.object({
  contentType: z.enum(academicFileContentTypes),
  displayName: trimmedText(1, 255),
  sizeBytes: z.coerce.number().int().min(1).max(20 * 1024 * 1024),
});

export const confirmAnnouncementResourceSchema = z.object({ uploadSessionId: z.uuid() });

export type AnnouncementListQueryInput = z.infer<typeof announcementListQuerySchema>;
export type TeacherAnnouncementListQueryInput = z.infer<typeof teacherAnnouncementListQuerySchema>;
export type CreateAnnouncementInputSchema = z.infer<typeof createAnnouncementSchema>;
export type UpdateAnnouncementInputSchema = z.infer<typeof updateAnnouncementSchema>;
export type AnnouncementResourceUploadInputSchema = z.infer<typeof announcementResourceUploadSchema>;
export type ConfirmAnnouncementResourceInputSchema = z.infer<typeof confirmAnnouncementResourceSchema>;
