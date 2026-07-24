import { z } from 'zod';

export const devicePlatformValues = ['ios', 'android'] as const;
export type DevicePlatform = (typeof devicePlatformValues)[number];

export const registerDeviceTokenSchema = z.object({
  expoPushToken: z.string().min(1).max(255),
  platform: z.enum(devicePlatformValues),
});

export type RegisterDeviceTokenInput = z.infer<typeof registerDeviceTokenSchema>;

export interface NotificationInboxItem {
  id: string;
  notificationType: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationInboxPage {
  items: ReadonlyArray<NotificationInboxItem>;
  nextCursor: string | null;
}

export interface NotificationInboxCursor {
  createdAt: string;
  id: string;
}

const notificationInboxCursorSchema = z.object({
  createdAt: z.string().datetime({ offset: true }),
  id: z.uuid(),
  v: z.literal(1),
});

export function encodeNotificationInboxCursor(cursor: NotificationInboxCursor): string {
  return Buffer.from(JSON.stringify({ ...cursor, v: 1 }), 'utf8').toString('base64url');
}

export function decodeNotificationInboxCursor(value: string): NotificationInboxCursor {
  try {
    const parsed = notificationInboxCursorSchema.parse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')),
    );
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    throw new Error('Invalid notification inbox cursor');
  }
}

export interface NotificationDispatchPayload {
  notificationId: string;
  recipientId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export const notificationInboxQuerySchema = z.object({
  cursor: z.string().min(1).transform(decodeNotificationInboxCursor).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  unreadOnly: z.coerce.boolean().default(false),
});
