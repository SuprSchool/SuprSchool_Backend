import type { QueueMessageHandler } from '../../platform/queue/queue-worker.js';
import { rankingRefreshEventType } from './ranking-refresh.message.js';
import type { RankingRefreshPayload } from '../../types/rankings.js';
import type { RankingRefreshService } from '../../services/ranking-refresh.service.js';

export function createRankingRefreshHandler(
  service: RankingRefreshService,
): QueueMessageHandler<unknown> {
  return async (message) => {
    if (message.eventType !== rankingRefreshEventType || !isRankingRefreshPayload(message.payload)) {
      throw new Error(`Unexpected ranking queue payload: `);
    }
    await service.refresh({
      eventId: message.eventId,
      schoolId: message.schoolId,
      scopeId: message.payload.scopeId,
      targetVersion: message.payload.targetVersion,
    });
  };
}

function isRankingRefreshPayload(payload: unknown): payload is RankingRefreshPayload {
  if (typeof payload !== 'object' || payload === null) return false;
  const value = payload as { scopeId?: unknown; targetVersion?: unknown };
  return typeof value.scopeId === 'string' && typeof value.targetVersion === 'string';
}
