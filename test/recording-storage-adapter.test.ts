import { describe, expect, it, vi } from 'vitest';

import {
  createSupabaseSignedTusEndpoint,
  SupabaseRecordingStorageAdapter,
} from '../src/platform/storage/supabase-recording-storage-adapter.js';

describe('private recording Storage adapter', () => {
  it('uses the direct Supabase Storage host and signed-resumable endpoint', () => {
    expect(
      createSupabaseSignedTusEndpoint('https://project-ref.supabase.co'),
    ).toBe(
      'https://project-ref.storage.supabase.co/storage/v1/upload/resumable/sign',
    );
  });

  it('keeps the immutable server-issued upload path and returns the Supabase TUS endpoint and signature', async () => {
    const objectPath = 'school/recording-audio/recording/upload-id';
    const bucket = {
      createSignedUploadUrl: vi.fn().mockResolvedValue({
        data: {
          path: objectPath,
          signedUrl: 'https://storage.example.test/upload/sign/opaque',
          token: 'opaque-upload-signature',
        },
        error: null,
      }),
      createSignedUrl: vi.fn().mockResolvedValue({
        data: { signedUrl: 'https://storage.example.test/object/sign/opaque' },
        error: null,
      }),
      list: vi.fn().mockResolvedValue({
        data: [{ metadata: { mimetype: 'audio/mp4', size: '1024' }, name: 'upload-id' }],
        error: null,
      }),
    };
    const storage = { from: vi.fn().mockReturnValue(bucket) };
    const inspector = {
      inspect: vi.fn().mockResolvedValue({
        bitrateBps: 96_000,
        channels: 1,
        codec: 'aac-lc',
        contentType: 'audio/mp4',
        durationMs: 60_000,
        fileExtension: '.m4a',
      }),
    };
    const adapter = new SupabaseRecordingStorageAdapter({
      inspector,
      now: () => new Date('2026-07-14T10:00:00.000Z'),
      storage,
      tusEndpoint: 'https://project.supabase.co/storage/v1/upload/resumable',
    });

    await expect(adapter.createTusUploadSession({
      contentType: 'audio/mp4',
      objectPath,
      sizeBytes: 1_024,
      uploadSessionId: 'upload-id',
    })).resolves.toEqual({
      expiresAt: '2026-07-14T12:00:00.000Z',
      tus: {
        endpoint: 'https://project.supabase.co/storage/v1/upload/resumable',
        headers: { 'x-signature': 'opaque-upload-signature' },
      },
    });
    await expect(adapter.confirmTusAudioUpload({
      expectedObjectPath: objectPath,
      uploadSessionId: 'upload-id',
    })).resolves.toMatchObject({
      objectPath,
      sizeBytes: 1_024,
    });
    await expect(adapter.createSignedPlaybackUrl({
      expiresInSeconds: 60,
      objectPath,
    })).resolves.toEqual({
      expiresAt: '2026-07-14T10:01:00.000Z',
      url: 'https://storage.example.test/object/sign/opaque',
    });

    expect(bucket.createSignedUploadUrl).toHaveBeenCalledWith(objectPath, { upsert: false });
    expect(bucket.createSignedUrl).toHaveBeenCalledWith(objectPath, 60);
    expect(inspector.inspect).toHaveBeenCalledWith({ bucket: 'recordings', objectPath });
  });
});
