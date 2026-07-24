import type { RecordingTusUploadTarget } from '../types/recordings.js';

export interface RecordingAudioMetadata {
  bitrateBps: number;
  channels: number;
  codec: string;
  contentType: string;
  durationMs: number;
  fileExtension: string;
  objectPath: string;
  sizeBytes: number;
}

export interface RecordingStoragePort {
  confirmTusAudioUpload(input: {
    expectedObjectPath: string;
    uploadSessionId: string;
  }): Promise<RecordingAudioMetadata>;
  createSignedPlaybackUrl(input: {
    expiresInSeconds: number;
    objectPath: string;
  }): Promise<{ expiresAt: string; url: string }>;
  createTusUploadSession(input: {
    contentType: 'audio/mp4';
    objectPath: string;
    sizeBytes: number;
    uploadSessionId: string;
  }): Promise<{ expiresAt: string; tus: RecordingTusUploadTarget }>;
}

/**
 * The database repository writes publication outbox rows in the same
 * transaction as the status transition. A later runtime adapter dispatches
 * these durable events through this port.
 */
export interface RecordingOutboxPort {
  dispatchPending(limit: number): Promise<number>;
}
