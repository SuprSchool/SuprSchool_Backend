import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { createClient } from '@supabase/supabase-js';
import express, {
  type NextFunction,
  type Request as ExpressRequest,
  type Response,
} from 'express';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import type { Database } from '../src/db/client.js';
import { DrizzleRecordingsRepository } from '../src/db/repositories/recordings.repository.js';
import type { AuthenticationMiddleware } from '../src/middleware/authenticate.js';
import {
  NodeCommandRunner,
  RecordingMediaInspector,
} from '../src/platform/storage/recording-media-inspector.js';
import {
  createSupabaseSignedTusEndpoint,
  SupabaseRecordingStorageAdapter,
  type RecordingStorageClient,
} from '../src/platform/storage/supabase-recording-storage-adapter.js';
import { createStudentRecordingsRouter } from '../src/routes/student-recordings.routes.js';
import { createRecordingService } from '../src/services/recordings.service.js';

const execFileAsync = promisify(execFile);
const runLive = process.env.RUN_LIVE_SUPABASE_STORAGE_TEST === 'true';
const liveTest = it.runIf(runLive);

function encodeTusMetadata(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

async function createAacLcFixture(directory: string): Promise<Uint8Array> {
  const path = join(directory, 'mono-aac-lc-128k.m4a');
  await execFileAsync(process.env.FFMPEG_PATH ?? 'ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'lavfi',
    '-i', 'sine=frequency=1000:sample_rate=48000',
    '-t', '10',
    '-ac', '1',
    '-c:a', 'aac',
    '-profile:a', 'aac_low',
    '-b:a', '128k',
    '-movflags', '+faststart',
    path,
  ]);
  return new Uint8Array(await readFile(path));
}

async function uploadThroughSignedTus(input: {
  bytes: Uint8Array;
  endpoint: string;
  objectPath: string;
  signature: string;
}): Promise<void> {
  const signatureSegments = input.signature.split('.').length;
  if (signatureSegments !== 3) {
    throw new Error(
      `Supabase signed upload token is not a compact JWS (segments: ${signatureSegments})`,
    );
  }
  const create = await fetch(input.endpoint, {
    method: 'POST',
    headers: {
      'tus-resumable': '1.0.0',
      'upload-length': String(input.bytes.byteLength),
      'upload-metadata': [
        `bucketName ${encodeTusMetadata('recordings')}`,
        `objectName ${encodeTusMetadata(input.objectPath)}`,
        `contentType ${encodeTusMetadata('audio/mp4')}`,
      ].join(','),
      'x-signature': input.signature,
      'x-upsert': 'false',
    },
  });
  if (create.status !== 201) {
    throw new Error(
      `Signed TUS create failed with ${create.status}: ${await create.text()}`,
    );
  }
  const location = create.headers.get('location');
  expect(location).toBeTruthy();

  const payload = input.bytes.buffer.slice(
    input.bytes.byteOffset,
    input.bytes.byteOffset + input.bytes.byteLength,
  ) as ArrayBuffer;
  const upload = await fetch(new URL(location!, input.endpoint), {
    method: 'PATCH',
    headers: {
      'content-type': 'application/offset+octet-stream',
      'tus-resumable': '1.0.0',
      'upload-offset': '0',
      'x-signature': input.signature,
    },
    body: payload,
  });
  expect(upload.status).toBe(204);
}

describe('live Supabase recording lifecycle proof', () => {
  liveTest(
    'accepts AAC-LC through draft, signed TUS, confirm, publish, and enrolled-student playback',
    async () => {
      const databaseUrl = process.env.DATABASE_URL;
      const supabaseUrl = process.env.SUPABASE_URL;
      const serviceKey = process.env.SUPABASE_SECRET_KEY;
      if (!databaseUrl || !supabaseUrl || !serviceKey) {
        throw new Error('DATABASE_URL, SUPABASE_URL, and SUPABASE_SECRET_KEY are required');
      }

      const fixtureDirectory = await mkdtemp(join(tmpdir(), 'suprschool-recording-live-'));
      const fixtureBytes = await createAacLcFixture(fixtureDirectory);
      const rawDatabase = postgres(databaseUrl, { max: 1, prepare: false });
      const storageClient = createClient(supabaseUrl, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const ids = {
        academicYear: randomUUID(),
        class: randomUUID(),
        school: randomUUID(),
        student: randomUUID(),
        subject: randomUUID(),
        teacher: randomUUID(),
      };
      let uploadedObjectPath: string | undefined;
      let cleanupFailure: unknown;
      let testFailure: unknown;
      const rollback = new Error('ROLLBACK_LIVE_RECORDING_FIXTURE');

      try {
        await rawDatabase.begin(async (transaction) => {
          const applied = await transaction<{ version: string }[]>`
            select version
            from supabase_migrations.schema_migrations
            where version in ('20260716130000', '20260716140000')
            order by version
          `;
          expect(applied.map((row) => row.version)).toEqual([
            '20260716130000',
            '20260716140000',
          ]);

          await transaction`
            insert into public.schools (id, name, school_code)
            values (
              ${ids.school},
              'Recording Lifecycle Test School',
              ${`REC-${ids.school}`}
            )
          `;
          await transaction`
            insert into public.academic_years (
              id, school_id, name, starts_on, ends_on, is_current
            ) values (
              ${ids.academicYear}, ${ids.school}, 'Recording Test Year',
              '2026-01-01', '2027-12-31', true
            )
          `;
          await transaction`
            insert into public.classes (
              id, school_id, academic_year_id, grade, section, display_name
            ) values (
              ${ids.class}, ${ids.school}, ${ids.academicYear},
              '10', 'LIVE', '10-LIVE'
            )
          `;
          await transaction`
            insert into public.subjects (id, school_id, code, name)
            values (${ids.subject}, ${ids.school}, 'LIVE-AUDIO', 'Live Audio')
          `;
          await transaction`
            insert into auth.users (
              id, instance_id, aud, role, email, encrypted_password,
              email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
              created_at, updated_at
            ) values
              (
                ${ids.teacher}, '00000000-0000-0000-0000-000000000000',
                'authenticated', 'authenticated',
                ${`teacher-${ids.teacher}@example.invalid`}, '', now(),
                '{"provider":"email","providers":["email"]}', '{}', now(), now()
              ),
              (
                ${ids.student}, '00000000-0000-0000-0000-000000000000',
                'authenticated', 'authenticated',
                ${`student-${ids.student}@example.invalid`}, '', now(),
                '{"provider":"email","providers":["email"]}', '{}', now(), now()
              )
          `;
          await transaction`
            insert into public.user_profiles (
              id, school_id, display_name, phone_e164
            ) values
              (${ids.teacher}, ${ids.school}, 'Recording Test Teacher', '+15550000101'),
              (${ids.student}, ${ids.school}, 'Recording Test Student', '+15550000102')
          `;
          await transaction`
            insert into public.user_roles (user_id, school_id, role, is_active)
            values
              (${ids.teacher}, ${ids.school}, 'teacher', true),
              (${ids.student}, ${ids.school}, 'student', true)
          `;
          await transaction`
            insert into public.class_subjects (
              school_id, class_id, subject_id, teacher_id
            ) values (${ids.school}, ${ids.class}, ${ids.subject}, ${ids.teacher})
          `;
          await transaction`
            insert into public.class_members (
              school_id, class_id, student_id, academic_year_id, is_active
            ) values (
              ${ids.school}, ${ids.class}, ${ids.student},
              ${ids.academicYear}, true
            )
          `;

          // postgres.js transaction clients intentionally omit the public
          // options bag Drizzle uses to install transparent parsers. Reuse the
          // parent client's parsers, and map nested repository transactions to
          // postgres.js savepoints, while keeping every fixture query inside
          // this rollback-only transaction.
          const transactionClient = Object.assign(transaction, {
            begin: transaction.savepoint.bind(transaction),
            options: rawDatabase.options,
          });
          const database = drizzle(
            transactionClient as unknown as typeof rawDatabase,
          ) as unknown as Database;
          const repository = new DrizzleRecordingsRepository(database);
          const mediaInspector = new RecordingMediaInspector({
            commandRunner: new NodeCommandRunner(),
            createSignedReadUrl: async (bucket, objectPath, expiresInSeconds) => {
              const { data, error } = await storageClient.storage
                .from(bucket)
                .createSignedUrl(objectPath, expiresInSeconds);
              if (error || !data) throw error ?? new Error('Missing signed inspection URL');
              return data.signedUrl;
            },
            ffprobePath: process.env.FFPROBE_PATH ?? 'ffprobe',
          });
          const storage = new SupabaseRecordingStorageAdapter({
            inspector: mediaInspector,
            storage: storageClient.storage as unknown as RecordingStorageClient,
            tusEndpoint: createSupabaseSignedTusEndpoint(supabaseUrl),
          });
          const recordings = createRecordingService({ repository, storage });
          const teacherIdentity = { schoolId: ids.school, userId: ids.teacher };
          const studentIdentity = { schoolId: ids.school, userId: ids.student };

          const draft = await recordings.createDraft(teacherIdentity, {
            classId: ids.class,
            description: 'Disposable end-to-end AAC lifecycle proof',
            subjectId: ids.subject,
            title: 'Live AAC lifecycle',
          });
          expect(draft.status).toBe('draft');

          const uploadSession = await recordings.requestUploadSession(
            teacherIdentity,
            draft.id,
            {
              contentType: 'audio/mp4',
              durationMs: 10_000,
              sizeBytes: fixtureBytes.byteLength,
            },
          );
          uploadedObjectPath = uploadSession.objectPath;
          await uploadThroughSignedTus({
            bytes: fixtureBytes,
            endpoint: uploadSession.tus.endpoint,
            objectPath: uploadSession.objectPath,
            signature: uploadSession.tus.headers['x-signature'],
          });
          await recordings.confirmUpload(
            teacherIdentity,
            draft.id,
            uploadSession.uploadSessionId,
          );
          const publication = await recordings.publishRecording(
            teacherIdentity,
            draft.id,
          );
          expect(publication.status).toBe('published');

          const authenticateStudent: AuthenticationMiddleware = async (
            requestValue: ExpressRequest,
            _response: Response,
            next: NextFunction,
          ): Promise<void> => {
            requestValue.auth = { role: 'student', ...studentIdentity };
            next();
          };
          const app = express();
          app.use(express.json());
          app.use(
            '/v1/student',
            createStudentRecordingsRouter(recordings, authenticateStudent),
          );
          const playbackResponse = await request(app)
            .get(`/v1/student/recordings/${draft.id}/playback-url`)
            .expect(200)
            .expect('Cache-Control', 'private, no-store');
          expect(playbackResponse.body).toEqual(expect.objectContaining({
            expiresAt: expect.any(String),
            playbackSessionId: expect.any(String),
            sessionStartedAt: expect.any(String),
            url: expect.any(String),
          }));

          const read = await fetch(String(playbackResponse.body.url));
          expect(read.status).toBe(200);
          expect(new Uint8Array(await read.arrayBuffer())).toEqual(fixtureBytes);

          throw rollback;
        });
      } catch (error) {
        if (error !== rollback) testFailure = error;
      } finally {
        try {
          if (uploadedObjectPath !== undefined) {
            const { error } = await storageClient.storage
              .from('recordings')
              .remove([uploadedObjectPath]);
            if (error) cleanupFailure = error;
          }
        } catch (error) {
          cleanupFailure = error;
        }
        try {
          await rawDatabase.end({ timeout: 5 });
        } catch (error) {
          cleanupFailure ??= error;
        }
        try {
          await rm(fixtureDirectory, { force: true, recursive: true });
        } catch (error) {
          cleanupFailure ??= error;
        }
      }
      if (testFailure !== undefined) throw testFailure;
      if (cleanupFailure !== undefined) throw cleanupFailure;
    },
    120_000,
  );
});
