import { readFile } from 'node:fs/promises';

import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp, type AppDependencies } from '../src/app.js';
import { createStorageCleanupDispatcher } from '../src/config/platform-dependencies.js';
import {
  RecordingMediaInspectionDependencyError,
  RecordingMediaInspector,
} from '../src/platform/storage/recording-media-inspector.js';
import {
  RecordingStorageCleanupHandler,
  type RecordingCleanupStore,
} from '../src/platform/storage/recording-storage-cleanup.js';
import type { RecordingService } from '../src/services/recordings.service.js';

const recordingId = '33333333-3333-4333-8333-333333333333';
const schoolId = '55555555-5555-4555-8555-555555555555';
const userId = '66666666-6666-4666-8666-666666666666';

function createRecordingService(): RecordingService {
  return {
    confirmResourceUpload: vi.fn(),
    confirmUpload: vi.fn(),
    createDraft: vi.fn(),
    deleteRecording: vi.fn(),
    deleteResource: vi.fn(),
    getPlaybackUrl: vi.fn(),
    getProgress: vi.fn(),
    getStudentRecording: vi.fn(),
    getTeacherRecording: vi.fn(),
    listStudentRecordings: vi.fn(),
    listTeacherRecordings: vi.fn(),
    publishRecording: vi.fn(),
    updateRecording: vi.fn(),
    requestResourceUploadSession: vi.fn(),
    requestUploadSession: vi.fn(),
    saveProgress: vi.fn(),
  };
}

async function authenticatedStudent(
  requestValue: Request,
  _response: Response,
  next: NextFunction,
): Promise<void> {
  requestValue.auth = { role: 'student', schoolId, userId };
  next();
}

function ffprobeOutput(): string {
  return JSON.stringify({
    format: {
      bit_rate: '128000',
      duration: '60.125',
      format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
    },
    streams: [{ bit_rate: '128000', channels: 1, codec_name: 'aac', profile: 'LC' }],
  });
}

describe('recordings runtime composition', () => {
  it('mounts the authenticated student recordings router under /v1', async () => {
    const recordingsService = createRecordingService();
    vi.mocked(recordingsService.listStudentRecordings).mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    const dependencies: AppDependencies = { authenticate: authenticatedStudent };
    Object.assign(dependencies, { recordingsService });

    await request(createApp(dependencies))
      .get('/v1/student/recordings')
      .expect(200, { items: [], nextCursor: null });

    expect(recordingsService.listStudentRecordings).toHaveBeenCalledWith(
      { schoolId, userId },
      { cursor: undefined, limit: 25, subjectId: undefined },
    );
  });
});

describe('trusted recording media inspection', () => {
  it('uses a signed private URL and argument-array ffprobe invocation to map trusted AAC metadata', async () => {
    const createSignedReadUrl = vi.fn().mockResolvedValue('https://storage.example.test/private/audio.m4a?token=opaque');
    const run = vi.fn().mockResolvedValue({ exitCode: 0, stderr: '', stdout: ffprobeOutput() });
    const inspector = new RecordingMediaInspector({
      commandRunner: { run },
      createSignedReadUrl,
      ffprobePath: '/usr/local/bin/ffprobe',
    });

    await expect(inspector.inspect({ bucket: 'recordings', objectPath: `${schoolId}/recording-audio/${recordingId}/upload-id` }))
      .resolves.toEqual({
        bitrateBps: 128_000,
        channels: 1,
        codec: 'aac-lc',
        contentType: 'audio/mp4',
        durationMs: 60_125,
        fileExtension: '.m4a',
      });

    expect(createSignedReadUrl).toHaveBeenCalledWith(
      'recordings',
      `${schoolId}/recording-audio/${recordingId}/upload-id`,
      60,
    );
    expect(run).toHaveBeenCalledWith(
      '/usr/local/bin/ffprobe',
      [
        '-v', 'error',
        '-show_entries', 'format=duration,bit_rate,format_name:stream=codec_name,profile,channels,bit_rate',
        '-of', 'json',
        'https://storage.example.test/private/audio.m4a?token=opaque',
      ],
      { timeoutMilliseconds: 30_000 },
    );
  });

  it('fails closed with a retryable dependency error when ffprobe fails or returns partial JSON', async () => {
    const createSignedReadUrl = vi.fn().mockResolvedValue('https://storage.example.test/private/audio.m4a?token=opaque');
    const run = vi.fn()
      .mockResolvedValueOnce({ exitCode: 1, stderr: 'network error', stdout: '' })
      .mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: JSON.stringify({ streams: [] }) });
    const inspector = new RecordingMediaInspector({
      commandRunner: { run },
      createSignedReadUrl,
    });

    await expect(inspector.inspect({ bucket: 'recordings', objectPath: 'school/path' }))
      .rejects.toMatchObject({ retryable: true, status: 503 });
    await expect(inspector.inspect({ bucket: 'recordings', objectPath: 'school/path' }))
      .rejects.toBeInstanceOf(RecordingMediaInspectionDependencyError);
  });

  it('limits concurrent ffprobe executions to two', async () => {
    const pending: Array<(result: { exitCode: number; stderr: string; stdout: string }) => void> = [];
    const run = vi.fn(() => new Promise<{ exitCode: number; stderr: string; stdout: string }>((resolve) => {
      pending.push(resolve);
    }));
    const inspector = new RecordingMediaInspector({
      commandRunner: { run },
      createSignedReadUrl: vi.fn().mockResolvedValue('https://storage.example.test/private/audio.m4a?token=opaque'),
    });

    const inspections = [1, 2, 3].map((number) => inspector.inspect({
      bucket: 'recordings',
      objectPath: `school/path-${number}`,
    }));

    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    pending.shift()?.({ exitCode: 0, stderr: '', stdout: ffprobeOutput() });
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(3));
    for (const resolve of pending) {
      resolve({ exitCode: 0, stderr: '', stdout: ffprobeOutput() });
    }

    await expect(Promise.all(inspections)).resolves.toHaveLength(3);
  });
});

describe('recording cleanup dispatch and execution', () => {
  it('dispatches a recordings cleanup payload only to the recordings handler', async () => {
    const legacy = vi.fn().mockResolvedValue(undefined);
    const recordings = vi.fn().mockResolvedValue(undefined);
    const dispatcher = createStorageCleanupDispatcher({ legacy, recordings });

    await dispatcher({
      eventId: 'event-1',
      eventType: 'storage.cleanup_expired_sessions',
      occurredAt: '2026-07-14T12:00:00.000Z',
      payload: { kind: 'recordings', schoolId },
      schemaVersion: 1,
      schoolId,
    }, { providerIdempotencyKey: 'event-1' });

    expect(recordings).toHaveBeenCalledTimes(1);
    expect(legacy).not.toHaveBeenCalled();
  });

  it('transitions expired sessions and never deletes an adopted recording path', async () => {
    const expireStaleSessions = vi.fn().mockResolvedValue(undefined);
    const listPending = vi.fn().mockResolvedValue([
      { id: 'adopted-intent', objectPath: 'school/adopted' },
      { id: 'orphan-intent', objectPath: 'school/orphan' },
    ]);
    const isAdopted = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const complete = vi.fn().mockResolvedValue(undefined);
    const retry = vi.fn().mockResolvedValue(undefined);
    const store: RecordingCleanupStore = {
      complete,
      expireStaleSessions,
      isAdopted,
      listPending,
      retry,
    };
    const remove = vi.fn().mockResolvedValue(undefined);
    const handler = new RecordingStorageCleanupHandler(store, { remove });

    await handler.handle({ schoolId });

    expect(expireStaleSessions).toHaveBeenCalledWith(schoolId);
    expect(isAdopted).toHaveBeenCalledWith(schoolId, 'school/adopted');
    expect(remove).toHaveBeenCalledWith('recordings', 'school/orphan');
    expect(remove).not.toHaveBeenCalledWith('recordings', 'school/adopted');
    expect(complete).toHaveBeenCalledWith('adopted-intent');
    expect(complete).toHaveBeenCalledWith('orphan-intent');
    expect(retry).not.toHaveBeenCalled();
  });
});

describe('recordings Storage deployment migration', () => {
  it('creates a private audio-only recordings bucket without permissive object policies', async () => {
    const migration = await readFile(
      new URL('../supabase/migrations/20260716140000_recordings_storage_runtime.sql', import.meta.url),
      'utf8',
    );

    expect(migration).toContain("'recordings'");
    expect(migration).toContain('public');
    expect(migration).toContain('134217728');
    expect(migration).toContain("'audio/mp4'");
    expect(migration).toContain('allowed_mime_types = excluded.allowed_mime_types');
    expect(migration).toContain('from public.recording_cleanup_intents');
    expect(migration).toMatch(/state\s*=\s*'pending'/);
    expect(migration).not.toMatch(/create\s+policy/i);
    expect(migration).not.toMatch(/to\s+(anon|authenticated)/i);
  });

  it('expires abandoned drafts and schedules every confirmed object for cleanup', async () => {
    const cleanupSource = await readFile(
      new URL('../src/platform/storage/recording-storage-cleanup.ts', import.meta.url),
      'utf8',
    );
    const migration = await readFile(
      new URL('../supabase/migrations/20260720020000_recording_resources.sql', import.meta.url),
      'utf8',
    );

    expect(cleanupSource).toContain("cr.status = 'draft'");
    expect(cleanupSource).toContain("cr.updated_at <= now() - interval '24 hours'");
    expect(cleanupSource).toContain('from public.recording_audio_assets asset');
    expect(cleanupSource).toContain('from public.recording_resources resource');
    expect(cleanupSource).toContain("set state = 'deleted'");
    expect(migration).toContain('class_recordings_abandoned_drafts_idx');
    expect(migration).toContain("status = 'draft'");
    expect(migration).toContain("updated_at <= now() - interval '24 hours'");
  });

  it('backfills and constrains recording resource display names to non-empty values', async () => {
    const migration = await readFile(
      new URL('../supabase/migrations/20260720020000_recording_resources.sql', import.meta.url),
      'utf8',
    );

    expect(migration).toContain("nullif(regexp_replace(object_path, '^.*/', ''), '')");
    expect(migration).toContain("where display_name is null or btrim(display_name) = ''");
    expect(migration).toContain('recording_resources_display_name_nonempty_check');
    expect(migration).toMatch(/check\s*\(btrim\(display_name\)\s*<>\s*''\)/i);
  });
});
