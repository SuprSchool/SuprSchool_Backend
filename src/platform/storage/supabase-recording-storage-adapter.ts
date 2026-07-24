import type { RecordingAudioMetadata, RecordingStoragePort } from '../../services/recordings.ports.js';
import type { RecordingTusUploadTarget } from '../../types/recordings.js';
import type { RecordingMediaInspection } from './recording-media-inspector.js';

export const RECORDINGS_BUCKET = 'recordings';
export const RECORDING_UPLOAD_URL_LIFETIME_SECONDS = 7_200;

export function createSupabaseSignedTusEndpoint(supabaseUrl: string): string {
  const endpoint = new URL(supabaseUrl);
  if (
    endpoint.hostname.endsWith('.supabase.co')
    && !endpoint.hostname.endsWith('.storage.supabase.co')
  ) {
    endpoint.hostname = endpoint.hostname.replace(
      /\.supabase\.co$/,
      '.storage.supabase.co',
    );
  }
  endpoint.pathname = '/storage/v1/upload/resumable/sign';
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint.toString();
}

interface StorageResult<T> {
  data: T | null;
  error: Error | null;
}

interface RecordingStorageBucket {
  createSignedUploadUrl(
    objectPath: string,
    options: { upsert: boolean },
  ): Promise<StorageResult<{ path: string; signedUrl: string; token: string }>>;
  createSignedUrl(
    objectPath: string,
    expiresInSeconds: number,
  ): Promise<StorageResult<{ signedUrl: string }>>;
  list(
    path?: string,
    options?: { search?: string },
  ): Promise<StorageResult<ReadonlyArray<{
    metadata?: { mimetype?: unknown; size?: unknown } | null;
    name: string;
  }>>>;
}

export interface RecordingStorageClient {
  from(bucket: string): RecordingStorageBucket;
}

export interface RecordingMediaInspectorPort {
  inspect(input: { bucket: string; objectPath: string }): Promise<RecordingMediaInspection>;
}

export interface SupabaseRecordingStorageAdapterOptions {
  bucket?: string;
  inspector: RecordingMediaInspectorPort;
  now?: () => Date;
  storage: RecordingStorageClient;
  tusEndpoint: string;
}

/**
 * The server grants exact object-path upload/download tokens. The client must
 * use the returned TUS endpoint and signature with the agreed transport, while the path is
 * held durably by recording_upload_sessions; no service credential crosses the
 * API boundary.
 */
export class SupabaseRecordingStorageAdapter implements RecordingStoragePort {
  private readonly bucket: string;
  private readonly now: () => Date;

  public constructor(private readonly options: SupabaseRecordingStorageAdapterOptions) {
    this.bucket = options.bucket ?? RECORDINGS_BUCKET;
    this.now = options.now ?? (() => new Date());
  }

  public async createTusUploadSession(input: {
    contentType: 'audio/mp4';
    objectPath: string;
    sizeBytes: number;
    uploadSessionId: string;
  }): Promise<{ expiresAt: string; tus: RecordingTusUploadTarget }> {
    void input.contentType;
    void input.sizeBytes;
    void input.uploadSessionId;
    const { data, error } = await this.options.storage
      .from(this.bucket)
      .createSignedUploadUrl(input.objectPath, { upsert: false });
    if (error !== null || data === null || data.path !== input.objectPath || typeof data.token !== 'string') {
      throw error ?? new Error('Supabase Storage did not return a signed recording upload URL');
    }

    return {
      expiresAt: new Date(
        this.now().getTime() + RECORDING_UPLOAD_URL_LIFETIME_SECONDS * 1_000,
      ).toISOString(),
      tus: {
        endpoint: this.options.tusEndpoint,
        headers: { 'x-signature': data.token },
      },
    };
  }

  public async confirmTusAudioUpload(input: {
    expectedObjectPath: string;
    uploadSessionId: string;
  }): Promise<RecordingAudioMetadata> {
    void input.uploadSessionId;
    const metadata = await this.readObjectMetadata(input.expectedObjectPath);
    const inspected = await this.options.inspector.inspect({
      bucket: this.bucket,
      objectPath: input.expectedObjectPath,
    });

    return {
      bitrateBps: inspected.bitrateBps,
      channels: inspected.channels,
      codec: inspected.codec,
      contentType: metadata.contentType,
      durationMs: inspected.durationMs,
      fileExtension: inspected.fileExtension,
      objectPath: input.expectedObjectPath,
      sizeBytes: metadata.sizeBytes,
    };
  }

  public async createSignedPlaybackUrl(input: {
    expiresInSeconds: number;
    objectPath: string;
  }): Promise<{ expiresAt: string; url: string }> {
    const { data, error } = await this.options.storage
      .from(this.bucket)
      .createSignedUrl(input.objectPath, input.expiresInSeconds);
    if (error !== null || data === null || typeof data.signedUrl !== 'string') {
      throw error ?? new Error('Supabase Storage did not return a signed recording playback URL');
    }

    return {
      expiresAt: new Date(
        this.now().getTime() + input.expiresInSeconds * 1_000,
      ).toISOString(),
      url: data.signedUrl,
    };
  }

  private async readObjectMetadata(objectPath: string): Promise<{ contentType: string; sizeBytes: number }> {
    const separator = objectPath.lastIndexOf('/');
    const directory = separator === -1 ? '' : objectPath.slice(0, separator);
    const objectName = separator === -1 ? objectPath : objectPath.slice(separator + 1);
    if (objectName.length === 0) {
      throw new Error('Recording object path must name an object');
    }

    const { data, error } = await this.options.storage
      .from(this.bucket)
      .list(directory, { search: objectName });
    if (error !== null) throw error;
    const object = data?.find((candidate) => candidate.name === objectName);
    const contentType = object?.metadata?.mimetype;
    const rawSize = object?.metadata?.size;
    const sizeBytes = typeof rawSize === 'number' ? rawSize : Number(rawSize);
    if (
      typeof contentType !== 'string'
      || !Number.isSafeInteger(sizeBytes)
      || sizeBytes < 1
    ) {
      throw new Error('Supabase Storage did not return complete recording object metadata');
    }

    return { contentType, sizeBytes };
  }
}
