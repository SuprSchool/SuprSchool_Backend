import express from 'express';
import { readFile } from 'node:fs/promises';
import type { NextFunction, Request, Response } from 'express';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { errorHandler } from '../src/middleware/error-handler.js';
import { AppError } from '../src/lib/errors.js';
import {
  IdempotencyStore,
  type IdempotencyRecord,
  type IdempotencyRecordStore,
} from '../src/platform/idempotency/idempotency-store.js';
import type { Database } from '../src/db/client.js';
import { DrizzleRecordingsRepository, type RecordingRepository } from '../src/db/repositories/recordings.repository.js';
import { createStudentRecordingsRouter } from '../src/routes/student-recordings.routes.js';
import { createTeacherRecordingsRouter } from '../src/routes/teacher-recordings.routes.js';
import type { RecordingStoragePort } from '../src/services/recordings.ports.js';
import { createRecordingCleanupHandler } from '../src/services/recording-cleanup.service.js';
import { createRecordingService, type RecordingService } from '../src/services/recordings.service.js';

const classId = '11111111-1111-4111-8111-111111111111';
const subjectId = '22222222-2222-4222-8222-222222222222';
const recordingId = '33333333-3333-4333-8333-333333333333';
const playbackSessionId = '44444444-4444-4444-8444-444444444444';
const schoolId = '55555555-5555-4555-8555-555555555555';
const userId = '66666666-6666-4666-8666-666666666666';

function queryText(query: unknown): string {
  return JSON.stringify(query);
}

function databaseWith(
  execute: (query: unknown) => unknown | Promise<unknown>,
): { database: Database; execute: ReturnType<typeof vi.fn> } {
  const executeMock = vi.fn(async (query: unknown) => execute(query));
  const database = {
    execute: executeMock,
    transaction: async <T>(callback: (transaction: { execute: typeof executeMock }) => Promise<T>): Promise<T> => (
      callback({ execute: executeMock })
    ),
  } as unknown as Database;
  return { database, execute: executeMock };
}

function createService(): RecordingService {
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

function createIdempotencyStore(): IdempotencyStore {
  const records = new Map<string, IdempotencyRecord>();
  const recordId = (school: string, user: string, key: string) => `${school}:${user}:${key}`;
  const store: IdempotencyRecordStore = {
    complete: async (school, user, key, response) => {
      const id = recordId(school, user, key);
      const existing = records.get(id);
      if (existing) records.set(id, { ...existing, responseBody: response.body, responseStatus: response.status });
    },
    create: async (record) => {
      const id = recordId(record.schoolId, record.userId, record.key);
      if (records.has(id)) return false;
      records.set(id, record);
      return true;
    },
    find: async (school, user, key) => records.get(recordId(school, user, key)),
    deletePending: async (school, user, key, requestHash) => {
      const id = recordId(school, user, key);
      const existing = records.get(id);
      if (
        existing?.requestHash === requestHash
        && existing.responseStatus === null
      ) {
        records.delete(id);
      }
    },
  };
  return new IdempotencyStore(store);
}

function createTeacherApp(service: RecordingService) {
  const app = express();
  app.use(express.json());
  app.use('/teacher', createTeacherRecordingsRouter(service, authenticate('teacher'), createIdempotencyStore()));
  app.use(errorHandler);
  return app;
}

function authenticate(role: 'student' | 'teacher') {
  return async (requestValue: Request, _response: Response, next: NextFunction) => {
    requestValue.auth = { role, schoolId, userId };
    next();
  };
}

describe('recording routers', () => {
  it('serves a teacher-authorized detail with preview and deletes one resource idempotently', async () => {
    const service = createService();
    const resourceId = '77777777-7777-4777-8777-777777777777';
    vi.mocked(service.getTeacherRecording).mockResolvedValue({
      banner: null, classId, createdAt: '2026-07-14T10:00:00.000Z', description: 'Persisted',
      durationMs: 60_000, id: recordingId, period: '2nd Period',
      previewExpiresAt: '2026-07-14T12:00:00.000Z',
      previewUrl: 'https://signed.example/audio', publishedAt: '2026-07-14T10:01:00.000Z',
      resources: [], sizeBytes: 1000, status: 'published', subjectId, title: 'Lesson',
    });
    vi.mocked(service.deleteResource).mockResolvedValue({ id: resourceId });
    const app = createTeacherApp(service);

    await request(app).get(`/teacher/recordings/${recordingId}`).expect(200)
      .expect((response) => expect(response.body.description).toBe('Persisted'));
    await request(app).delete(`/teacher/recordings/${recordingId}/resources/${resourceId}`)
      .set('Idempotency-Key', 'delete-recording-resource')
      .expect(200, { id: resourceId });

    expect(service.getTeacherRecording).toHaveBeenCalledWith({ schoolId, userId }, recordingId);
    expect(service.deleteResource).toHaveBeenCalledWith({ schoolId, userId }, recordingId, resourceId);
  });

  it('creates and confirms a recording banner upload through authenticated idempotent routes', async () => {
    const service = createService();
    const resourceUploadSessionId = '77777777-7777-4777-8777-777777777777';
    vi.mocked(service.requestResourceUploadSession).mockResolvedValue({
      expiresAt: '2026-07-14T12:00:00.000Z',
      objectPath: `${schoolId}/recording-banner/${recordingId}/${resourceUploadSessionId}`,
      signedUploadUrl: 'https://storage.example.test/signed-upload/banner',
      uploadSessionId: resourceUploadSessionId,
    });
    vi.mocked(service.confirmResourceUpload).mockResolvedValue({
      contentType: 'image/png',
      id: playbackSessionId,
      kind: 'banner',
      name: 'lesson-banner.png',
      sizeBytes: 1_024,
      sortOrder: 0,
    });
    const app = createTeacherApp(service);

    await request(app)
      .post(`/teacher/recordings/${recordingId}/resources/upload-sessions`)
      .set('Idempotency-Key', 'recording-banner-upload-key')
      .send({
        contentType: 'image/png',
        displayName: 'lesson-banner.png',
        kind: 'banner',
        sizeBytes: 1_024,
      })
      .expect(201, {
        expiresAt: '2026-07-14T12:00:00.000Z',
        objectPath: `${schoolId}/recording-banner/${recordingId}/${resourceUploadSessionId}`,
        signedUploadUrl: 'https://storage.example.test/signed-upload/banner',
        uploadSessionId: resourceUploadSessionId,
      });

    await request(app)
      .post(`/teacher/recordings/${recordingId}/resources/upload-sessions/${resourceUploadSessionId}/confirm`)
      .set('Idempotency-Key', 'recording-banner-confirm-key')
      .send({})
      .expect(201, {
        contentType: 'image/png',
        id: playbackSessionId,
        kind: 'banner',
        name: 'lesson-banner.png',
        sizeBytes: 1_024,
        sortOrder: 0,
      });

    expect(service.requestResourceUploadSession).toHaveBeenCalledWith(
      { schoolId, userId },
      recordingId,
      {
        contentType: 'image/png',
        displayName: 'lesson-banner.png',
        kind: 'banner',
        sizeBytes: 1_024,
      },
    );
    expect(service.confirmResourceUpload).toHaveBeenCalledWith(
      { schoolId, userId },
      recordingId,
      resourceUploadSessionId,
    );
  });

  it('creates a teacher recording draft only from the authenticated teacher context', async () => {
    const service = createService();
    vi.mocked(service.createDraft).mockResolvedValue({
      classId,
      createdAt: '2026-07-14T10:00:00.000Z',
      durationMs: null,
      id: recordingId,
      period: '2nd Period',
      publishedAt: null,
      status: 'draft',
      subjectId,
      title: 'Algebra revision',
    });
    const app = createTeacherApp(service);

    await request(app)
      .post(`/teacher/classes/${classId}/recordings`)
      .set('Idempotency-Key', 'create-draft-key')
      .send({ subjectId, title: 'Algebra revision' })
      .expect(201, {
        classId,
        createdAt: '2026-07-14T10:00:00.000Z',
        durationMs: null,
        id: recordingId,
        period: '2nd Period',
        publishedAt: null,
        status: 'draft',
        subjectId,
        title: 'Algebra revision',
      });

    expect(service.createDraft).toHaveBeenCalledWith(
      { schoolId, userId },
      { classId, description: undefined, subjectId, title: 'Algebra revision' },
    );
  });

  it('updates recording metadata through the authenticated idempotent patch route', async () => {
    const service = createService();
    vi.mocked(service.updateRecording).mockResolvedValue({
      classId,
      createdAt: '2026-07-14T10:00:00.000Z',
      durationMs: 60_000,
      id: recordingId,
      // Editing title and description must not disturb the stored period.
      period: '2nd Period',
      publishedAt: '2026-07-14T10:01:00.000Z',
      status: 'published',
      subjectId,
      title: 'Updated revision',
    });
    const app = createTeacherApp(service);

    await request(app)
      .patch(`/teacher/recordings/${recordingId}`)
      .set('Idempotency-Key', 'update-recording-key')
      .send({ description: 'Updated notes', title: 'Updated revision' })
      .expect(200);

    expect(service.updateRecording).toHaveBeenCalledWith(
      { schoolId, userId },
      recordingId,
      { description: 'Updated notes', title: 'Updated revision' },
    );
    expect(service.publishRecording).not.toHaveBeenCalled();
  });

  it('does not expose teacher recording writes to a student role', async () => {
    const service = createService();
    const app = express();
    app.use(express.json());
    app.use('/teacher', createTeacherRecordingsRouter(service, authenticate('student'), createIdempotencyStore()));

    const response = await request(app)
      .post(`/teacher/classes/${classId}/recordings`)
      .send({ subjectId, title: 'Algebra revision' });

    expect(response.status).toBe(403);
    expect(service.createDraft).not.toHaveBeenCalled();
  });

  it('returns a fresh re-authorized playback URL with a server-issued playback session', async () => {
    const service = createService();
    vi.mocked(service.getPlaybackUrl).mockResolvedValue({
      expiresAt: '2026-07-14T12:00:00.000Z',
      playbackSessionId,
      sessionStartedAt: '2026-07-14T10:00:00.000000Z',
      url: 'https://storage.example.test/signed/recording',
    });
    const app = express();
    app.use('/student', createStudentRecordingsRouter(service, authenticate('student')));

    const response = await request(app)
      .get(`/student/recordings/${recordingId}/playback-url?studentId=attacker`)
      .expect(200, {
        expiresAt: '2026-07-14T12:00:00.000Z',
        playbackSessionId,
        sessionStartedAt: '2026-07-14T10:00:00.000000Z',
        url: 'https://storage.example.test/signed/recording',
      });

    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(service.getPlaybackUrl).toHaveBeenCalledWith({ schoolId, userId }, recordingId);
  });

  it('only passes the server-issued playback session and client sequence to progress persistence', async () => {
    const service = createService();
    vi.mocked(service.saveProgress).mockResolvedValue({
      accepted: true,
      completedAt: null,
      positionMs: 1_234,
      recordingId,
      updatedAt: '2026-07-14T10:01:00.000Z',
    });
    const app = express();
    app.use(express.json());
    app.use('/student', createStudentRecordingsRouter(service, authenticate('student')));

    await request(app)
      .patch(`/student/recordings/${recordingId}/progress`)
      .send({
        clientSequence: 4,
        completed: false,
        playbackSessionId,
        positionMs: 1_234,
        sessionStartedAt: '2099-01-01T00:00:00.000Z',
      })
      .expect(200, {
        accepted: true,
        completedAt: null,
        positionMs: 1_234,
        recordingId,
        updatedAt: '2026-07-14T10:01:00.000Z',
      });

    expect(service.saveProgress).toHaveBeenCalledWith(
      { schoolId, userId },
      recordingId,
      {
        clientSequence: 4,
        completed: false,
        playbackSessionId,
        positionMs: 1_234,
      },
    );
  });

  it('preserves microsecond recording cursors', async () => {
    const service = createService();
    vi.mocked(service.listStudentRecordings).mockResolvedValue({ items: [], nextCursor: null });
    const app = express();
    app.use('/student', createStudentRecordingsRouter(service, authenticate('student')));
    const publishedAt = '2026-07-14T10:00:00.123456Z';

    await request(app)
      .get(`/student/recordings?cursor=${encodeURIComponent(`${publishedAt}|${recordingId}`)}`)
      .expect(200, { items: [], nextCursor: null });

    expect(service.listStudentRecordings).toHaveBeenCalledWith(
      { schoolId, userId },
      { cursor: { id: recordingId, publishedAt }, limit: 25 },
    );
  });
  it('replays all teacher recording mutations without invoking a second side effect', async () => {
    const service = createService();
    const draft = {
      classId,
      createdAt: '2026-07-14T10:00:00.000Z',
      durationMs: null,
      id: recordingId,
      period: '2nd Period',
      publishedAt: null,
      status: 'draft' as const,
      subjectId,
      title: 'Algebra revision',
    };
    const uploadSession = {
      expiresAt: '2026-07-14T10:10:00.000Z',
      objectPath: `${schoolId}/recording-audio/${recordingId}/${playbackSessionId}`,
      protocol: 'tus' as const,
      uploadSessionId: playbackSessionId,
      tus: {
        endpoint: 'https://storage.example.test/storage/v1/upload/resumable',
        headers: { 'x-signature': 'opaque-upload-signature' },
      },
    };
    const publication = { ...draft, durationMs: 60_000, eventKey: `recording:${recordingId}:published`, publishedAt: '2026-07-14T10:02:00.000Z', status: 'published' as const };
    const deletion = { deletedAt: '2026-07-14T10:03:00.000Z', id: recordingId };
    vi.mocked(service.createDraft).mockResolvedValue(draft);
    vi.mocked(service.requestUploadSession).mockResolvedValue(uploadSession);
    vi.mocked(service.confirmUpload).mockResolvedValue(undefined);
    vi.mocked(service.publishRecording).mockResolvedValue(publication);
    vi.mocked(service.deleteRecording).mockResolvedValue(deletion);
    const app = createTeacherApp(service);

    const repeat = async (first: request.Test, second: request.Test, status: number, body?: unknown) => {
      if (body === undefined) {
        await first.expect(status);
        await second.expect(status);
      } else {
        await first.expect(status, body);
        await second.expect(status, body);
      }
    };

    await repeat(
      request(app).post(`/teacher/classes/${classId}/recordings`).set('Idempotency-Key', 'draft-key').send({ subjectId, title: draft.title }),
      request(app).post(`/teacher/classes/${classId}/recordings`).set('Idempotency-Key', 'draft-key').send({ subjectId, title: draft.title }),
      201,
      draft,
    );
    await repeat(
      request(app).post(`/teacher/recordings/${recordingId}/upload-sessions`).set('Idempotency-Key', 'upload-key').send({ contentType: 'audio/mp4', durationMs: 60_000, sizeBytes: 1_024 }),
      request(app).post(`/teacher/recordings/${recordingId}/upload-sessions`).set('Idempotency-Key', 'upload-key').send({ contentType: 'audio/mp4', durationMs: 60_000, sizeBytes: 1_024 }),
      201,
      uploadSession,
    );
    await repeat(
      request(app).post(`/teacher/recordings/${recordingId}/upload-sessions/${playbackSessionId}/confirm`).set('Idempotency-Key', 'confirm-key').send({}),
      request(app).post(`/teacher/recordings/${recordingId}/upload-sessions/${playbackSessionId}/confirm`).set('Idempotency-Key', 'confirm-key').send({}),
      204,
    );
    await repeat(
      request(app).patch(`/teacher/recordings/${recordingId}`).set('Idempotency-Key', 'publish-key').send({ action: 'publish' }),
      request(app).patch(`/teacher/recordings/${recordingId}`).set('Idempotency-Key', 'publish-key').send({ action: 'publish' }),
      200,
      publication,
    );
    await repeat(
      request(app).delete(`/teacher/recordings/${recordingId}`).set('Idempotency-Key', 'delete-key').send({}),
      request(app).delete(`/teacher/recordings/${recordingId}`).set('Idempotency-Key', 'delete-key').send({}),
      200,
      deletion,
    );

    expect(service.createDraft).toHaveBeenCalledTimes(1);
    expect(service.requestUploadSession).toHaveBeenCalledTimes(1);
    expect(service.confirmUpload).toHaveBeenCalledTimes(1);
    expect(service.publishRecording).toHaveBeenCalledTimes(1);
    expect(service.deleteRecording).toHaveBeenCalledTimes(1);
  });

  it('rejects a changed payload for an already-claimed mutation key without a second side effect', async () => {
    const service = createService();
    vi.mocked(service.createDraft).mockResolvedValue({
      classId,
      createdAt: '2026-07-14T10:00:00.000Z',
      durationMs: null,
      id: recordingId,
      // Recorded outside any timetable slot: the client renders the date alone.
      period: null,
      publishedAt: null,
      status: 'draft',
      subjectId,
      title: 'Algebra revision',
    });
    const app = createTeacherApp(service);

    await request(app)
      .post(`/teacher/classes/${classId}/recordings`)
      .set('Idempotency-Key', 'conflicting-draft-key')
      .send({ subjectId, title: 'Algebra revision' })
      .expect(201);
    const conflict = await request(app)
      .post(`/teacher/classes/${classId}/recordings`)
      .set('Idempotency-Key', 'conflicting-draft-key')
      .send({ subjectId, title: 'Different algebra revision' })
      .expect(409);

    expect(conflict.body.error.code).toBe('VALIDATION_ERROR');
    expect(service.createDraft).toHaveBeenCalledTimes(1);
  });
  it('releases a retryable inspection failure so the same confirmation key can succeed on retry', async () => {
    const service = createService();
    vi.mocked(service.confirmUpload)
      .mockRejectedValueOnce(new AppError('INTERNAL_ERROR', 503, 'Recording media inspection is temporarily unavailable'))
      .mockResolvedValueOnce(undefined);
    const app = createTeacherApp(service);
    const path = `/teacher/recordings/${recordingId}/upload-sessions/${playbackSessionId}/confirm`;

    const first = await request(app)
      .post(path)
      .set('Idempotency-Key', 'retryable-confirm-key')
      .send({})
      .expect(503);
    await request(app)
      .post(path)
      .set('Idempotency-Key', 'retryable-confirm-key')
      .send({})
      .expect(204);

    expect(first.body.error.code).toBe('INTERNAL_ERROR');
    expect(service.confirmUpload).toHaveBeenCalledTimes(2);
  });
});

describe('recording repository protections', () => {
  it('types recording publication UUIDs before building the durable outbox payload', async () => {
    const { database, execute } = databaseWith((query) => {
      const text = queryText(query);
      if (text.includes('select user_id as id')) return [{ id: userId }];
      if (text.includes('update public.class_recordings cr')) {
        return [{
          classId,
          createdAt: '2026-07-14T10:00:00.000000Z',
          durationMs: 60_000,
          id: recordingId,
          publishedAt: '2026-07-14T10:01:00.000000Z',
          status: 'published',
          subjectId,
          title: 'Algebra revision',
        }];
      }
      return [];
    });
    const recordings = new DrizzleRecordingsRepository(database);

    await expect(
      recordings.publishRecording({ schoolId, userId }, recordingId),
    ).resolves.toMatchObject({ id: recordingId, status: 'published' });

    const outboxQuery = execute.mock.calls
      .map(([query]) => query)
      .find((query) => queryText(query).includes('recording_outbox_events'));
    expect(outboxQuery).toBeDefined();
    const rendered = new PgDialect().sqlToQuery(outboxQuery as SQL).sql;
    expect(rendered).toContain(
      "jsonb_build_object(\n            'recordingId', $4::uuid,\n            'classId', $5::uuid,\n            'subjectId', $6::uuid",
    );
  });

  it('queues confirmed recording resources for cleanup when deleting a recording', async () => {
    const { database, execute } = databaseWith((query) => {
      const text = queryText(query);
      if (text.includes('select user_id as id')) return [{ id: userId }];
      if (text.includes('update public.class_recordings cr')) {
        return [{ deletedAt: '2026-07-14T10:03:00.000Z', id: recordingId }];
      }
      return [];
    });
    const recordings = new DrizzleRecordingsRepository(database);

    await recordings.deleteRecording({ schoolId, userId }, recordingId);

    const queries = execute.mock.calls.map(([query]) => queryText(query));
    expect(queries.some((text) => (
      text.includes('insert into public.recording_cleanup_intents')
      && text.includes('from public.recording_resources')
    ))).toBe(true);
  });

  it('does not disclose teacher recordings when the teacher role is revoked after the preliminary check', async () => {
    const { database, execute } = databaseWith((query) => {
      const text = queryText(query);
      if (text.includes('select user_id as id')) return [{ id: userId }];
      if (text.includes('from public.class_recordings cr')) {
        return text.includes('join public.user_roles role')
          ? []
          : [{
              classId,
              createdAt: '2026-07-14T10:00:00.000000Z',
              durationMs: null,
              id: recordingId,
              publishedAt: null,
              status: 'draft',
              subjectId,
              title: 'Algebra revision',
            }];
      }
      return [];
    });
    const recordings = new DrizzleRecordingsRepository(database);

    await expect(recordings.listTeacherRecordings(
      { schoolId, userId },
      { classId, limit: 25 },
    )).resolves.toEqual({ items: [], nextCursor: null });

    expect(queryText(execute.mock.calls[1]![0])).toContain('join public.user_roles role');
  });

  it('rejects a completed progress update beyond the confirmed recording duration', async () => {
    const { database, execute } = databaseWith((query) => {
      if (queryText(query).includes('recording_playback_sessions')) {
        return [{ durationMs: 60_000, sequence: 1 }];
      }
      return [];
    });
    const recordings = new DrizzleRecordingsRepository(database);

    await expect(recordings.saveProgress(
      { schoolId, userId },
      recordingId,
      {
        clientSequence: 4,
        completed: true,
        playbackSessionId,
        positionMs: 60_001,
      },
    )).rejects.toThrow('recording duration');

    const authorizationQuery = queryText(execute.mock.calls[0]![0]);
    expect(authorizationQuery).toContain('recording_audio_assets');
    expect(authorizationQuery).toContain('duration_ms');
  });
  it('does not disclose progress when student access is revoked after a preliminary lookup', async () => {
    const progress = {
      completedAt: null,
      positionMs: 1_234,
      recordingId,
      updatedAt: '2026-07-14T10:01:00.000Z',
    };
    const { database, execute } = databaseWith((query) => {
      const text = queryText(query);
      if (text.includes('from public.recording_progress')) {
        return text.includes('join public.user_roles role') ? [] : [progress];
      }
      return [{ objectPath: 'recording.m4a' }];
    });
    const recordings = new DrizzleRecordingsRepository(database);

    await expect(recordings.getProgress({ schoolId, userId }, recordingId)).resolves.toBeUndefined();

    expect(execute).toHaveBeenCalledTimes(1);
    const finalRead = queryText(execute.mock.calls[0]![0]);
    expect(finalRead).toContain('recording_audio_assets');
    expect(finalRead).toContain('class_members');
    expect(finalRead).toContain('academic_years');
    expect(finalRead).toContain('join public.user_roles role');
  });

  it('does not upsert progress when student access is revoked after playback-session authorization', async () => {
    const { database, execute } = databaseWith((query) => {
      const text = queryText(query);
      if (text.includes('insert into public.recording_progress')) {
        return text.includes('join public.user_roles role') ? [] : [{
          completedAt: null,
          positionMs: 1_234,
          recordingId,
          updatedAt: '2026-07-14T10:01:00.000Z',
        }];
      }
      return [{ durationMs: 60_000, sequence: 1 }];
    });
    const recordings = new DrizzleRecordingsRepository(database);

    await expect(recordings.saveProgress(
      { schoolId, userId },
      recordingId,
      { clientSequence: 4, completed: false, playbackSessionId, positionMs: 1_234 },
    )).resolves.toBeUndefined();

    expect(execute).toHaveBeenCalledTimes(1);
    const finalWrite = queryText(execute.mock.calls[0]![0]);
    expect(finalWrite).toContain('recording_playback_sessions');
    expect(finalWrite).toContain('recording_audio_assets');
    expect(finalWrite).toContain('class_members');
    expect(finalWrite).toContain('academic_years');
    expect(finalWrite).toContain('join public.user_roles role');
  });
});

describe('recording upload lifecycle', () => {
  function repository(): RecordingRepository {
    return {
      activateUploadSession: vi.fn(),
      confirmResourceUpload: vi.fn(),
      confirmUpload: vi.fn(),
      createDraft: vi.fn(),
      deleteRecording: vi.fn(),
      deleteResource: vi.fn(),
      findEditableRecording: vi.fn(),
      findResourceEditableRecording: vi.fn(),
      findResourceForUpload: vi.fn(),
      findUploadSession: vi.fn(),
      getPlaybackTarget: vi.fn(),
      getProgress: vi.fn(),
      getStudentRecording: vi.fn(),
      getTeacherRecording: vi.fn(),
      getTeacherPlaybackTarget: vi.fn(),
      issuePlaybackSession: vi.fn(),
      listStudentResources: vi.fn(),
      listStudentRecordings: vi.fn(),
      listTeacherResources: vi.fn(),
      listTeacherRecordings: vi.fn(),
      publishRecording: vi.fn(),
      updateRecording: vi.fn(),
      releaseUploadReservation: vi.fn(),
      rejectUploadSession: vi.fn(),
      reserveUploadSession: vi.fn(),
      saveProgress: vi.fn(),
    };
  }

  function storage(): RecordingStoragePort {
    return {
      confirmTusAudioUpload: vi.fn(),
      createSignedPlaybackUrl: vi.fn(),
      createTusUploadSession: vi.fn(),
    };
  }

  it('reserves upload capacity before provisioning TUS and releases the reservation after a provisioning failure', async () => {
    const repositoryPort = repository();
    const storagePort = storage();
    vi.mocked(repositoryPort.findEditableRecording).mockResolvedValue({ id: recordingId, schoolId });
    vi.mocked(storagePort.createTusUploadSession).mockRejectedValue(new Error('TUS unavailable'));
    const service = createRecordingService({
      createId: () => playbackSessionId,
      repository: repositoryPort,
      storage: storagePort,
    });

    await expect(service.requestUploadSession(
      { schoolId, userId },
      recordingId,
      { contentType: 'audio/mp4', durationMs: 60_000, sizeBytes: 1_024 },
    )).rejects.toThrow('TUS unavailable');

    const objectPath = schoolId + '/recording-audio/' + recordingId + '/' + playbackSessionId;
    expect(repositoryPort.reserveUploadSession).toHaveBeenCalledWith(
      { schoolId, userId },
      expect.objectContaining({
        expectedContentType: 'audio/mp4',
        expectedDurationMs: 60_000,
        expectedSizeBytes: 1_024,
        objectPath,
        recordingId,
        reservationExpiresAt: expect.any(String),
        uploadSessionId: playbackSessionId,
      }),
    );
    expect(storagePort.createTusUploadSession).toHaveBeenCalledWith({
      contentType: 'audio/mp4',
      objectPath,
      sizeBytes: 1_024,
      uploadSessionId: playbackSessionId,
    });
    expect(
      vi.mocked(repositoryPort.reserveUploadSession).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(storagePort.createTusUploadSession).mock.invocationCallOrder[0]!,
    );
    expect(repositoryPort.releaseUploadReservation).toHaveBeenCalledWith(
      { schoolId, userId },
      recordingId,
      playbackSessionId,
    );
    expect(repositoryPort.activateUploadSession).not.toHaveBeenCalled();
  });

  it('queues cleanup when a storage object metadata differs from its reserved upload session', async () => {
    const repositoryPort = repository();
    const rejectUploadSession = vi.fn().mockResolvedValue(undefined);
    (repositoryPort as RecordingRepository & { rejectUploadSession: typeof rejectUploadSession })
      .rejectUploadSession = rejectUploadSession;
    const storagePort = storage();
    const expectedObjectPath = schoolId + '/recording-audio/' + recordingId + '/' + playbackSessionId;
    vi.mocked(repositoryPort.findUploadSession).mockResolvedValue({
      expectedContentType: 'audio/mp4',
      expectedDurationMs: 60_000,
      expectedObjectPath,
      expectedSizeBytes: 1_024,
      id: playbackSessionId,
      recordingId,
      status: 'pending',
    });
    vi.mocked(storagePort.confirmTusAudioUpload).mockResolvedValue({
      bitrateBps: 96_000,
      channels: 1,
      codec: 'aac-lc',
      contentType: 'audio/mp4',
      durationMs: 60_000,
      fileExtension: '.m4a',
      objectPath: schoolId + '/recording-audio/another-recording/attacker-object',
      sizeBytes: 1_024,
    });
    const service = createRecordingService({
      repository: repositoryPort,
      storage: storagePort,
    });

    await expect(service.confirmUpload({ schoolId, userId }, recordingId, playbackSessionId))
      .rejects.toThrow('does not match');

    expect(repositoryPort.confirmUpload).not.toHaveBeenCalled();
    expect(rejectUploadSession).toHaveBeenCalledWith(
      { schoolId, userId },
      recordingId,
      playbackSessionId,
    );
  });

  it('treats a concurrent confirmation that observes an already-confirmed session as idempotent', async () => {
    const repositoryPort = repository();
    const storagePort = storage();
    const expectedObjectPath = schoolId + '/recording-audio/' + recordingId + '/' + playbackSessionId;
    vi.mocked(repositoryPort.findUploadSession).mockResolvedValue({
      expectedContentType: 'audio/mp4',
      expectedDurationMs: 60_000,
      expectedObjectPath,
      expectedSizeBytes: 1_024,
      id: playbackSessionId,
      recordingId,
      status: 'pending',
    });
    vi.mocked(storagePort.confirmTusAudioUpload).mockResolvedValue({
      bitrateBps: 96_000,
      channels: 1,
      codec: 'aac-lc',
      contentType: 'audio/mp4',
      durationMs: 60_000,
      fileExtension: '.m4a',
      objectPath: expectedObjectPath,
      sizeBytes: 1_024,
    });
    vi.mocked(repositoryPort.confirmUpload).mockResolvedValue('already_confirmed');
    const service = createRecordingService({
      repository: repositoryPort,
      storage: storagePort,
    });

    await expect(service.confirmUpload({ schoolId, userId }, recordingId, playbackSessionId))
      .resolves.toBeUndefined();

    expect(repositoryPort.confirmUpload).toHaveBeenCalledWith(
      { schoolId, userId },
      {
        bitrateBps: 96_000,
        channels: 1,
        codec: 'aac-lc',
        contentType: 'audio/mp4',
        durationMs: 60_000,
        objectPath: expectedObjectPath,
        recordingId,
        sizeBytes: 1_024,
        uploadSessionId: playbackSessionId,
      },
    );
  });

  it.each([
    { bitrateBps: 96_000, channels: 2, label: 'stereo' },
    { bitrateBps: 256_000, channels: 1, label: '256 kbps' },
  ])('rejects $label inspector metadata and schedules cleanup', async ({ bitrateBps, channels }) => {
    const repositoryPort = repository();
    const storagePort = storage();
    const expectedObjectPath = `${schoolId}/recording-audio/${recordingId}/${playbackSessionId}`;
    vi.mocked(repositoryPort.findUploadSession).mockResolvedValue({
      expectedContentType: 'audio/mp4',
      expectedDurationMs: 60_000,
      expectedObjectPath,
      expectedSizeBytes: 1_024,
      id: playbackSessionId,
      recordingId,
      status: 'pending',
    });
    vi.mocked(storagePort.confirmTusAudioUpload).mockResolvedValue({
      bitrateBps,
      channels,
      codec: 'aac-lc',
      contentType: 'audio/mp4',
      durationMs: 60_000,
      fileExtension: '.m4a',
      objectPath: expectedObjectPath,
      sizeBytes: 1_024,
    });
    const service = createRecordingService({ repository: repositoryPort, storage: storagePort });

    await expect(service.confirmUpload({ schoolId, userId }, recordingId, playbackSessionId))
      .rejects.toThrow('does not match');

    expect(repositoryPort.confirmUpload).not.toHaveBeenCalled();
    expect(repositoryPort.rejectUploadSession).toHaveBeenCalledWith({ schoolId, userId }, recordingId, playbackSessionId);
  });

  it('persists trusted mono 96 kbps AAC-LC inspector metadata', async () => {
    const repositoryPort = repository();
    const storagePort = storage();
    const expectedObjectPath = `${schoolId}/recording-audio/${recordingId}/${playbackSessionId}`;
    vi.mocked(repositoryPort.findUploadSession).mockResolvedValue({
      expectedContentType: 'audio/mp4',
      expectedDurationMs: 60_000,
      expectedObjectPath,
      expectedSizeBytes: 1_024,
      id: playbackSessionId,
      recordingId,
      status: 'pending',
    });
    vi.mocked(storagePort.confirmTusAudioUpload).mockResolvedValue({
      bitrateBps: 96_000,
      channels: 1,
      codec: 'aac-lc',
      contentType: 'audio/mp4',
      durationMs: 60_000,
      fileExtension: '.m4a',
      objectPath: expectedObjectPath,
      sizeBytes: 1_024,
    });
    vi.mocked(repositoryPort.confirmUpload).mockResolvedValue('confirmed');
    const service = createRecordingService({ repository: repositoryPort, storage: storagePort });

    await expect(service.confirmUpload({ schoolId, userId }, recordingId, playbackSessionId)).resolves.toBeUndefined();

    expect(repositoryPort.confirmUpload).toHaveBeenCalledWith(
      { schoolId, userId },
      expect.objectContaining({
        bitrateBps: 96_000,
        channels: 1,
        codec: 'aac-lc',
        contentType: 'audio/mp4',
        durationMs: 60_000,
        objectPath: expectedObjectPath,
        sizeBytes: 1_024,
      }),
    );
  });

  it('accepts nominal 96 kbps AAC-LC encoder variance and stores the profile bitrate', async () => {
    const repositoryPort = repository();
    const storagePort = storage();
    const expectedObjectPath = `${schoolId}/recording-audio/${recordingId}/${playbackSessionId}`;
    vi.mocked(repositoryPort.findUploadSession).mockResolvedValue({
      expectedContentType: 'audio/mp4',
      expectedDurationMs: 10_000,
      expectedObjectPath,
      expectedSizeBytes: 162_184,
      id: playbackSessionId,
      recordingId,
      status: 'pending',
    });
    vi.mocked(storagePort.confirmTusAudioUpload).mockResolvedValue({
      bitrateBps: 95_325,
      channels: 1,
      codec: 'aac-lc',
      contentType: 'audio/mp4',
      durationMs: 10_000,
      fileExtension: '.m4a',
      objectPath: expectedObjectPath,
      sizeBytes: 162_184,
    });
    vi.mocked(repositoryPort.confirmUpload).mockResolvedValue('confirmed');
    const service = createRecordingService({ repository: repositoryPort, storage: storagePort });

    await expect(service.confirmUpload({ schoolId, userId }, recordingId, playbackSessionId))
      .resolves.toBeUndefined();

    expect(repositoryPort.confirmUpload).toHaveBeenCalledWith(
      { schoolId, userId },
      expect.objectContaining({ bitrateBps: 96_000 }),
    );
    expect(repositoryPort.rejectUploadSession).not.toHaveBeenCalled();
  });

  it('returns a signed URL together with a database-owned playback session', async () => {
    const repositoryPort = repository();
    const storagePort = storage();
    vi.mocked(repositoryPort.getPlaybackTarget).mockResolvedValue({ objectPath: 'school/recording.m4a' });
    vi.mocked(storagePort.createSignedPlaybackUrl).mockResolvedValue({
      expiresAt: '2026-07-14T12:00:00.000Z',
      url: 'https://storage.example.test/signed/recording',
    });
    vi.mocked(repositoryPort.issuePlaybackSession).mockResolvedValue({
      id: playbackSessionId,
      issuedAt: '2026-07-14T10:00:00.000000Z',
    });
    const service = createRecordingService({
      repository: repositoryPort,
      storage: storagePort,
    });

    await expect(service.getPlaybackUrl({ schoolId, userId }, recordingId)).resolves.toEqual({
      expiresAt: '2026-07-14T12:00:00.000Z',
      playbackSessionId,
      sessionStartedAt: '2026-07-14T10:00:00.000000Z',
      url: 'https://storage.example.test/signed/recording',
    });

    expect(repositoryPort.issuePlaybackSession).toHaveBeenCalledWith(
      { schoolId, userId },
      recordingId,
      '2026-07-14T12:00:00.000Z',
    );
  });
});

describe('recording cleanup scheduling', () => {
  it('delegates recording cleanup queue messages through the domain port', async () => {
    const expireStaleUploadSessions = vi.fn().mockResolvedValue(undefined);
    await createRecordingCleanupHandler({ expireStaleUploadSessions }).handle({ schoolId });
    expect(expireStaleUploadSessions).toHaveBeenCalledWith(schoolId);
  });

  it('keeps recording cleanup unmounted from the integration-owned runtime dependencies', async () => {
    const platformDependencies = await readFile(
      new URL('../src/config/platform-dependencies.ts', import.meta.url),
      'utf8',
    );
    expect(platformDependencies).not.toContain('recording_upload_sessions');
    expect(platformDependencies).not.toContain('recording_cleanup_intents');
  });
});

// 497:11334 and 513:6598 subtitle a recording as "date • period". The period is
// resolved once, from the timetable slot live at draft creation, and stored — so
// a later timetable edit cannot retitle a recording that already happened.
describe('recording timetable period', () => {
  function draftRepository(): RecordingRepository {
    return {
      activateUploadSession: vi.fn(), confirmResourceUpload: vi.fn(), confirmUpload: vi.fn(),
      createDraft: vi.fn(), deleteRecording: vi.fn(), deleteResource: vi.fn(),
      findEditableRecording: vi.fn(), findResourceEditableRecording: vi.fn(),
      findResourceForUpload: vi.fn(), findUploadSession: vi.fn(), getPlaybackTarget: vi.fn(),
      getProgress: vi.fn(), getStudentRecording: vi.fn(), getTeacherRecording: vi.fn(),
      getTeacherPlaybackTarget: vi.fn(), issuePlaybackSession: vi.fn(),
      listStudentResources: vi.fn(), listStudentRecordings: vi.fn(), listTeacherResources: vi.fn(),
      listTeacherRecordings: vi.fn(), publishRecording: vi.fn(), updateRecording: vi.fn(),
      releaseUploadReservation: vi.fn(), rejectUploadSession: vi.fn(),
      reserveUploadSession: vi.fn(), saveProgress: vi.fn(),
    };
  }

  function draftStorage(): RecordingStoragePort {
    return {
      confirmTusAudioUpload: vi.fn(),
      createSignedPlaybackUrl: vi.fn(),
      createTusUploadSession: vi.fn(),
    };
  }

  const draft = {
    classId,
    createdAt: '2026-07-14T10:00:00.000Z',
    durationMs: null,
    id: recordingId,
    period: '2nd Period',
    publishedAt: null,
    status: 'draft' as const,
    subjectId,
    title: 'Algebra',
  };

  it('returns the timetable period on recording detail', async () => {
    const service = createService();
    vi.mocked(service.getTeacherRecording).mockResolvedValue({
      banner: null, classId, createdAt: '2026-07-14T10:00:00.000Z', description: null,
      durationMs: 60_000, id: recordingId, period: '2nd Period',
      previewExpiresAt: null, previewUrl: null, publishedAt: null, resources: [],
      sizeBytes: 1000, status: 'draft', subjectId, title: 'Algebra',
    });

    const response = await request(createTeacherApp(service))
      .get(`/teacher/recordings/${recordingId}`)
      .expect(200);

    expect(response.body.period).toBe('2nd Period');
  });

  it('returns null period for recordings outside the timetable', async () => {
    const service = createService();
    vi.mocked(service.getTeacherRecording).mockResolvedValue({
      banner: null, classId, createdAt: '2026-07-14T19:00:00.000Z', description: null,
      durationMs: 60_000, id: recordingId, period: null,
      previewExpiresAt: null, previewUrl: null, publishedAt: null, resources: [],
      sizeBytes: 1000, status: 'draft', subjectId, title: 'Extra',
    });

    const response = await request(createTeacherApp(service))
      .get(`/teacher/recordings/${recordingId}`)
      .expect(200);

    expect(response.body.period).toBeNull();
  });

  it('resolves the period from the timetable and stores it on the draft', async () => {
    const repositoryPort = draftRepository();
    const findClassPeriodLabel = vi.fn().mockResolvedValue('2nd Period');
    const service = createRecordingService({
      periods: { findClassPeriodLabel },
      repository: repositoryPort,
      storage: draftStorage(),
    });

    await service.createDraft({ schoolId, userId }, { classId, subjectId, title: 'Algebra' });

    expect(findClassPeriodLabel).toHaveBeenCalledWith(userId, schoolId, classId);
    expect(repositoryPort.createDraft).toHaveBeenCalledWith(
      { schoolId, userId },
      { classId, period: '2nd Period', subjectId, title: 'Algebra' },
    );
  });

  it('stores a null period when the draft is created outside any timetable slot', async () => {
    const repositoryPort = draftRepository();
    const service = createRecordingService({
      periods: { findClassPeriodLabel: vi.fn().mockResolvedValue(null) },
      repository: repositoryPort,
      storage: draftStorage(),
    });

    await service.createDraft({ schoolId, userId }, { classId, subjectId, title: 'Extra' });

    expect(repositoryPort.createDraft).toHaveBeenCalledWith(
      { schoolId, userId },
      { classId, period: null, subjectId, title: 'Extra' },
    );
  });

  it('persists and reads back the period column on the draft insert', async () => {
    const { database, execute } = databaseWith((query) => {
      const text = queryText(query);
      if (text.includes('select user_id as id')) return [{ id: userId }];
      if (text.includes('insert into public.class_recordings')) return [draft];
      return [];
    });

    await expect(new DrizzleRecordingsRepository(database).createDraft(
      { schoolId, userId },
      { classId, period: '2nd Period', subjectId, title: 'Algebra' },
    )).resolves.toMatchObject({ period: '2nd Period' });

    const insert = execute.mock.calls
      .map(([query]) => queryText(query))
      .find((text) => text.includes('insert into public.class_recordings'));
    expect(insert).toContain('period');
  });

  it('selects the period on every teacher and student read path', async () => {
    const reads: string[] = [];
    const { database } = databaseWith((query) => {
      const text = queryText(query);
      if (text.includes('select user_id as id')) return [{ id: userId }];
      if (text.includes('class_recordings')) reads.push(text);
      return [];
    });
    const recordings = new DrizzleRecordingsRepository(database);

    await recordings.listTeacherRecordings({ schoolId, userId }, { classId, limit: 25 });
    await recordings.listStudentRecordings({ schoolId, userId }, { limit: 25 });
    await recordings.getTeacherRecording({ schoolId, userId }, recordingId);
    await recordings.getStudentRecording({ schoolId, userId }, recordingId);

    expect(reads).toHaveLength(4);
    for (const read of reads) expect(read).toContain('cr.period');
  });

  it('reports a stored null period as null rather than dropping the field', async () => {
    const { database } = databaseWith((query) => {
      const text = queryText(query);
      if (text.includes('select user_id as id')) return [{ id: userId }];
      if (text.includes('class_recordings')) return [{ ...draft, period: null }];
      return [];
    });

    await expect(
      new DrizzleRecordingsRepository(database).getTeacherRecording({ schoolId, userId }, recordingId),
    ).resolves.toMatchObject({ period: null });
  });
});
