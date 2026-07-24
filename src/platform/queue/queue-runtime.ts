import type { QueueMessageHandler } from './queue-worker.js';
import type { QueueName } from './queue-policy.js';

export interface QueueWorkerLike {
  drainOnce<TPayload>(
    queueName: string,
    visibilityTimeoutSeconds: number,
    limit: number,
    handler: QueueMessageHandler<TPayload>,
  ): Promise<void>;
}

export type QueueHandlerRegistry = Partial<
  Record<QueueName, QueueMessageHandler<unknown>>
>;

export interface QueueWorkerRuntimeOptions {
  batchSize?: number;
  pollIntervalMilliseconds?: number;
  visibilityTimeoutSeconds?: number;
}

export interface QueueWorkerRuntime {
  drainOnce(): Promise<void>;
  start(): void;
  stop(): Promise<void>;
}

const defaultOptions = {
  batchSize: 25,
  pollIntervalMilliseconds: 1_000,
  visibilityTimeoutSeconds: 60,
} as const;

export function createQueueWorkerRuntime(
  worker: QueueWorkerLike,
  handlers: QueueHandlerRegistry,
  options: QueueWorkerRuntimeOptions = {},
): QueueWorkerRuntime {
  const settings = { ...defaultOptions, ...options };
  assertPositiveInteger(settings.batchSize, 'batchSize');
  assertPositiveInteger(settings.pollIntervalMilliseconds, 'pollIntervalMilliseconds');
  assertPositiveInteger(settings.visibilityTimeoutSeconds, 'visibilityTimeoutSeconds');

  const registeredHandlers = Object.entries(handlers) as ReadonlyArray<
    [QueueName, QueueMessageHandler<unknown>]
  >;
  if (registeredHandlers.length === 0) {
    throw new Error('At least one queue handler must be registered');
  }

  let timer: ReturnType<typeof setInterval> | undefined;
  let draining: Promise<void> | undefined;

  async function drainOnce(): Promise<void> {
    if (draining !== undefined) {
      return draining;
    }

    draining = (async () => {
      for (const [queueName, handler] of registeredHandlers) {
        await worker.drainOnce(
          queueName,
          settings.visibilityTimeoutSeconds,
          settings.batchSize,
          handler,
        );
      }
    })();

    try {
      await draining;
    } finally {
      draining = undefined;
    }
  }

  return {
    drainOnce,
    start(): void {
      if (timer !== undefined) {
        return;
      }
      timer = setInterval(() => {
        void drainOnce();
      }, settings.pollIntervalMilliseconds);
    },
    async stop(): Promise<void> {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
      await draining;
    },
  };
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}
