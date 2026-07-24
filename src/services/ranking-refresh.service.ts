import type { RankingRepository, StudentRankingReader } from '../db/repositories/ranking.repository.js';
import type { QueueClient } from '../platform/queue/queue-client.js';
import { createRankingRefreshMessage } from '../async/rankings/ranking-refresh.message.js';
import type {
  RankingIdentity,
  RankingRefreshInput,
  StudentClassRanking,
  StudentRankingQuery,
} from '../types/rankings.js';

export type { StudentRankingReader } from '../db/repositories/ranking.repository.js';

export interface RankingRefreshServiceDependencies {
  queue?: Pick<QueueClient, 'enqueue'>;
  repository: RankingRepository;
}

export class RankingRefreshService implements StudentRankingReader {
  public constructor(private readonly dependencies: RankingRefreshServiceDependencies) {}

  public getCurrentRanking(
    identity: RankingIdentity,
    query: StudentRankingQuery,
  ): Promise<StudentClassRanking> {
    return this.dependencies.repository.getCurrentRanking(identity, query);
  }

  public async dispatchPending(limit = 100): Promise<number> {
    const queue = this.dependencies.queue;
    if (queue === undefined) return 0;
    await this.dependencies.repository.deleteResolvedOutbox();
    const events = await this.dependencies.repository.listDispatchableOutbox(limit);
    let dispatched = 0;
    for (const event of events) {
      await queue.enqueue('ranking_refresh', createRankingRefreshMessage(event));
      await this.dependencies.repository.markOutboxEnqueued(event.eventId);
      dispatched += 1;
    }
    return dispatched;
  }

  public refresh(input: RankingRefreshInput): Promise<void> {
    return this.dependencies.repository.refreshScope(input);
  }
}
