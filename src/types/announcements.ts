import { z } from 'zod';

export const announcementCategoryValues = ['School', 'Class', 'Sports', 'Parents'] as const;
export const announcementAudienceTypeValues = ['class', 'school'] as const;
export const announcementResourceTypeValues = ['pdf', 'image', 'document'] as const;

export type AnnouncementCategory = (typeof announcementCategoryValues)[number];
export type AnnouncementAudienceType = (typeof announcementAudienceTypeValues)[number];
export type AnnouncementResourceType = (typeof announcementResourceTypeValues)[number];

export interface AnnouncementIdentity {
  schoolId: string;
  userId: string;
}

export interface AnnouncementCursor {
  createdAt: string;
  id: string;
}

export interface AnnouncementPublishedCursor {
  id: string;
  publishedAt: string;
}

export interface AnnouncementListQuery {
  category?: AnnouncementCategory | undefined;
  cursor?: AnnouncementPublishedCursor | undefined;
  limit: number;
  search?: string | undefined;
}

export interface TeacherAnnouncementListQuery {
  cursor?: AnnouncementCursor | undefined;
  limit: number;
  scope?: 'all' | 'mine' | undefined;
}

export interface AnnouncementListItem {
  attachmentCount: number;
  body: string;
  category: AnnouncementCategory;
  id: string;
  publishedAt: string;
  readTimeMinutes: number;
  title: string;
}

export interface AnnouncementResource {
  id: string;
  name: string;
  signedUrl?: string | undefined;
  type: AnnouncementResourceType;
}

export interface AnnouncementDetail {
  attachmentCount: number;
  audienceType: AnnouncementAudienceType;
  body: string;
  category: AnnouncementCategory;
  classId?: string | undefined;
  description: string;
  id: string;
  imageUri?: string | undefined;
  publishedAt: string | null;
  readTimeMinutes: number;
  resources: ReadonlyArray<AnnouncementResource>;
  subjectId?: string | undefined;
  title: string;
}

export interface TeacherAnnouncement {
  audienceType: AnnouncementAudienceType;
  classId?: string | undefined;
  description: string;
  id: string;
  isOwn: boolean;
  publishedAt: string | null;
  title: string;
  type: AnnouncementCategory;
  subjectId?: string | undefined;
}

export interface CursorPage<T> {
  items: ReadonlyArray<T>;
  nextCursor?: string | undefined;
}

export interface CreateAnnouncementInput {
  audienceType: AnnouncementAudienceType;
  body: string;
  category: AnnouncementCategory;
  classId?: string | undefined;
  subjectId?: string | undefined;
  title: string;
}

export interface UpdateAnnouncementInput {
  audienceType?: AnnouncementAudienceType | undefined;
  body?: string | undefined;
  category?: AnnouncementCategory | undefined;
  classId?: string | undefined;
  subjectId?: string | undefined;
  title?: string | undefined;
}

export interface CreateAnnouncementResourceUploadInput {
  contentType: string;
  displayName: string;
  sizeBytes: number;
}

export interface AnnouncementResourceUploadSession {
  expiresAt: string;
  id: string;
  signedUploadUrl: string;
}

export interface ConfirmAnnouncementResourceInput {
  uploadSessionId: string;
}

const publishedCursorSchema = z.object({
  id: z.uuid(),
  publishedAt: z.string().datetime({ offset: true }),
  v: z.literal(1),
});

const teacherCursorSchema = z.object({
  createdAt: z.string().datetime({ offset: true }),
  id: z.uuid(),
  v: z.literal(1),
});

export function decodeAnnouncementPublishedCursor(value: string): AnnouncementPublishedCursor {
  try {
    const parsed = publishedCursorSchema.parse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')),
    );
    return { id: parsed.id, publishedAt: parsed.publishedAt };
  } catch {
    throw new Error('Invalid announcement cursor');
  }
}

export function encodeAnnouncementPublishedCursor(cursor: AnnouncementPublishedCursor): string {
  return Buffer.from(JSON.stringify({ ...cursor, v: 1 }), 'utf8').toString('base64url');
}

export function decodeTeacherAnnouncementCursor(value: string): AnnouncementCursor {
  try {
    const parsed = teacherCursorSchema.parse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')),
    );
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    throw new Error('Invalid teacher announcement cursor');
  }
}

export function encodeTeacherAnnouncementCursor(cursor: AnnouncementCursor): string {
  return Buffer.from(JSON.stringify({ ...cursor, v: 1 }), 'utf8').toString('base64url');
}
