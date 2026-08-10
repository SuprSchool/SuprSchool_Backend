import { afterEach, describe, expect, it, vi } from 'vitest';

import { logger } from '../src/lib/logger.js';
import type { QueueClient, QueuedMessage } from '../src/platform/queue/queue-client.js';
import type { QueueMessage } from '../src/platform/queue/queue-message.js';
import {
  QueueWorker,
  type DeadLetterQueueStore,
  type ProcessedQueueEventStore,
} from '../src/platform/queue/queue-worker.js';

const schoolId = '11111111-1111-4111-8111-111111111111';
const eventId = '22222222-2222-4222-8222-222222222222';
const attemptToken = '33333333-3333-4333-8333-333333333333';
const messageId = 4242;

const message: QueueMessage<{ scopeId: string }> = {
  eventId,
  eventType: 'ranking.refresh.requested',
  occurredAt: '2026-08-10T00:00:00.000Z',
  payload: { scopeId: '44444444-4444-4444-8444-444444444444' },
  schemaVersion: 1,
  schoolId,
};

function queued(readCount: number): QueuedMessage<{ scopeId: string }> {
  return { message, messageId, readCount };
}

function createHarness(readCount: number) {
  const archive = vi.fn(async () => undefined);
  const queue: QueueClient = {
    archive,
    enqueue: vi.fn(async () => undefined),
    read: vi.fn(async () => [queued(readCount)]),
  } as unknown as QueueClient;

  const processedEvents = {
    claim: vi.fn(async () => ({ attemptToken, status: 'claimed' as const })),
    getOutcome: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => true),
    markSucceeded: vi.fn(async () => true),
  } satisfies ProcessedQueueEventStore;

  const deadLetters = { record: vi.fn(async () => undefined) } satisfies DeadLetterQueueStore;

  return {
    archive,
    deadLetters,
    processedEvents,
    worker: new QueueWorker(queue, processedEvents, deadLetters),
  };
}

describe('QueueWorker handler failures', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs a throwing handler with the queue, message, and error cause', async () => {
    const logError = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    const { worker } = createHarness(1);
    const cause = new Error('function pgmq.archive(unknown, unknown) is not unique');

    await worker.drainOnce('ranking_refresh', 60, 25, async () => {
      throw new Error('ranking refresh failed', { cause });
    });

    expect(logError).toHaveBeenCalledTimes(1);
    const [details, label] = logError.mock.calls[0] ?? [];
    expect(label).toEqual(expect.any(String));
    expect(details).toMatchObject({
      eventId,
      eventType: 'ranking.refresh.requested',
      messageId,
      queueName: 'ranking_refresh',
      schoolId,
    });
    const logged = details as Record<string, unknown>;
    expect(String(logged.errorMessage)).toContain('ranking refresh failed');
    expect(String(logged.errorCause)).toContain('is not unique');
  });

  it('keeps the retry path identical when a handler throws', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => logger);
    const { archive, processedEvents, worker } = createHarness(1);

    await worker.drainOnce('ranking_refresh', 60, 25, async () => {
      throw new Error('ranking refresh failed');
    });

    expect(processedEvents.markFailed).toHaveBeenCalledWith(eventId, attemptToken);
    expect(processedEvents.markSucceeded).not.toHaveBeenCalled();
    expect(archive).not.toHaveBeenCalled();
  });

  it('leaves the success path silent and archived', async () => {
    const logError = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    const { archive, processedEvents, worker } = createHarness(1);

    await worker.drainOnce('ranking_refresh', 60, 25, async () => undefined);

    expect(logError).not.toHaveBeenCalled();
    expect(processedEvents.markSucceeded).toHaveBeenCalledWith(eventId, attemptToken);
    expect(archive).toHaveBeenCalledWith('ranking_refresh', messageId);
  });

  it('still dead-letters and archives a message past its retry limit', async () => {
    const { archive, deadLetters, processedEvents, worker } = createHarness(4);

    await worker.drainOnce('ranking_refresh', 60, 25, async () => {
      throw new Error('never reached');
    });

    expect(deadLetters.record).toHaveBeenCalledWith(expect.objectContaining({
      errorCategory: 'retry_limit_exceeded',
      eventId,
      messageId,
      queueName: 'ranking_refresh',
      schoolId,
    }));
    expect(archive).toHaveBeenCalledWith('ranking_refresh', messageId);
    expect(processedEvents.claim).not.toHaveBeenCalled();
  });

  it('still skips a message it cannot claim', async () => {
    const logError = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    const { archive, processedEvents, worker } = createHarness(1);
    processedEvents.claim.mockResolvedValue({ status: 'unavailable' } as never);
    const handler = vi.fn(async () => undefined);

    await worker.drainOnce('ranking_refresh', 60, 25, handler);

    expect(handler).not.toHaveBeenCalled();
    expect(archive).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });
});
