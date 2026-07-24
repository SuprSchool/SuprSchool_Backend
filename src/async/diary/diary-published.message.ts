import { createHash } from 'node:crypto';

import type { QueueMessage } from '../../platform/queue/queue-message.js';
import type { DiaryRecord } from '../../types/diary.js';

export const diaryNotificationQueue = 'notification_dispatch';

const DIARY_EVENT_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

export interface DiaryPublishedPayload {
  classId: string;
  classSubjectId: string;
  diaryId: string;
  occurredOn: string;
  revision: number;
  sourceEventKey: string;
}

export function createDiaryPublishedMessage(
  diary: DiaryRecord,
): QueueMessage<DiaryPublishedPayload> {
  const sourceEventKey = diaryPublishedSourceEventKey(diary);

  return {
    eventId: uuidV5(DIARY_EVENT_NAMESPACE, sourceEventKey),
    eventType: 'diary.published',
    occurredAt: diary.updatedAt,
    payload: {
      classId: diary.classId,
      classSubjectId: diary.classSubjectId,
      diaryId: diary.id,
      occurredOn: diary.occurredOn,
      revision: diary.revision,
      sourceEventKey,
    },
    schemaVersion: 1,
    schoolId: diary.schoolId,
  };
}

export function diaryPublishedSourceEventKey(diary: Pick<DiaryRecord, "id" | "revision">): string {
  return `diary:${diary.id}:published:${diary.revision}`;
}

function uuidV5(namespace: string, name: string): string {
  const namespaceBytes = Buffer.from(namespace.replaceAll('-', ''), 'hex');
  if (namespaceBytes.length !== 16) {
    throw new TypeError('UUIDv5 namespace must be a UUID');
  }

  const digest = createHash('sha1')
    .update(namespaceBytes)
    .update(name, 'utf8')
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  const versionByte = bytes.at(6);
  const variantByte = bytes.at(8);
  if (versionByte === undefined || variantByte === undefined) {
    throw new Error("SHA-1 digest is unexpectedly shorter than a UUID");
  }
  bytes[6] = (versionByte & 0x0f) | 0x50;
  bytes[8] = (variantByte & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
