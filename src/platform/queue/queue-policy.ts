export const QUEUE_NAMES = [
  'notification_dispatch',
  'notification_receipts',
  'reminder_dispatch',
  'attendance_rollup',
  'ranking_refresh',
  'storage_cleanup',
  'avatar_cleanup',
  'avatar_cleanup_dispatch',
  'cache_refresh',
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

export interface QueueRetryPolicy {
  maxAttempts: number;
}

export const QUEUE_RETRY_POLICIES = {
  notification_dispatch: { maxAttempts: 3 },
  notification_receipts: { maxAttempts: 3 },
  reminder_dispatch: { maxAttempts: 3 },
  attendance_rollup: { maxAttempts: 3 },
  ranking_refresh: { maxAttempts: 3 },
  storage_cleanup: { maxAttempts: 3 },
  avatar_cleanup: { maxAttempts: 3 },
  avatar_cleanup_dispatch: { maxAttempts: 3 },
  cache_refresh: { maxAttempts: 3 },
} satisfies Record<QueueName, QueueRetryPolicy>;
