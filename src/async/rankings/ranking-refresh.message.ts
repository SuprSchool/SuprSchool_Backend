import type { QueueMessage } from '../../platform/queue/queue-message.js';
import type { RankingOutboxEvent, RankingRefreshPayload } from '../../types/rankings.js';

export const rankingRefreshEventType = 'ranking.refresh.requested';

export function createRankingRefreshMessage(
  event: RankingOutboxEvent,
): QueueMessage<RankingRefreshPayload> {
  return {
    eventId: event.eventId,
    eventType: rankingRefreshEventType,
    occurredAt: new Date().toISOString(),
    payload: {
      scopeId: event.scopeId,
      targetVersion: event.targetVersion,
    },
    schoolId: event.schoolId,
    schemaVersion: 1,
  };
}
