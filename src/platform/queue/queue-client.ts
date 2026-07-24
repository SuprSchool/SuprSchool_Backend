import type { QueueMessage } from './queue-message.js';

export interface QueuedMessage<TPayload> {
  messageId: number;
  readCount: number;
  message: QueueMessage<TPayload>;
}

export interface QueueClient {
  enqueue<TPayload>(
    queueName: string,
    message: QueueMessage<TPayload>,
    delaySeconds?: number,
  ): Promise<void>;
  read<TPayload>(
    queueName: string,
    visibilityTimeoutSeconds: number,
    limit: number,
  ): Promise<ReadonlyArray<QueuedMessage<TPayload>>>;
  archive(queueName: string, messageId: number): Promise<void>;
}
