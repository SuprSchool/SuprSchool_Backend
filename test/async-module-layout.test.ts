import { describe, expect, it } from 'vitest';

import { createDiaryPublishedMessage } from '../src/async/diary/diary-published.message.js';
import { DiaryOutbox } from '../src/async/diary/diary-outbox.js';
import { createEventsHandler } from '../src/async/events/events.handler.js';
import { createRankingRefreshMessage } from '../src/async/rankings/ranking-refresh.message.js';
import { createRankingRefreshHandler } from '../src/async/rankings/ranking-refresh.handler.js';

describe('async module layout', () => {
  it('exports the diary, events, and ranking asynchronous boundaries from canonical paths', () => {
    expect([createDiaryPublishedMessage, DiaryOutbox, createEventsHandler, createRankingRefreshMessage, createRankingRefreshHandler]).toHaveLength(5);
  });
});
