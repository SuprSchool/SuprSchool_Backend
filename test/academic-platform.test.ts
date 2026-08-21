import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
// @ts-expect-error The executable verifier is JavaScript; this test types its exported contract locally.
import { migrations as scriptMigrations, missingRequiredMigrations as scriptMissingRequiredMigrations } from '../scripts/verify-rls.mjs';

const migrations: ReadonlyArray<string> = scriptMigrations;
const missingRequiredMigrations = scriptMissingRequiredMigrations as (applied: ReadonlyArray<{ version: string } | string>) => ReadonlyArray<string>;

import { createStorageCleanupHandler, runtimeUploadBuckets } from '../src/config/platform-dependencies.js';
import type { Database } from '../src/db/client.js';
import { AcademicCache, examGroupLeaderboardVersionKey, studentAssignmentListVersionKey } from '../src/platform/academic/academic-cache.js';
import { createAcademicMutationExecutor } from '../src/platform/academic/academic-mutation-executor.js';
import { DatabaseIdempotencyRecordStore, IdempotencyStore, type IdempotencyRecord, type IdempotencyRecordStore } from '../src/platform/idempotency/idempotency-store.js';
import { AcademicOutbox } from '../src/platform/academic/academic-outbox.js';
import {
  createAcademicNotificationHandlers,
  DrizzleAcademicNotificationDeliveryStore,
  type AcademicNotificationDeliveryStore,
} from '../src/platform/academic/academic-notification-delivery.js';
import type { QueueClient } from '../src/platform/queue/queue-client.js';
import {
  AcademicFileService,
  AcademicUploadParentAuthorizer,
} from '../src/platform/storage/academic-file-service.js';
import { StorageService, type StorageService as StorageServiceContract } from '../src/platform/storage/storage-service.js';
import { tenantCacheKey } from '../src/platform/cache/cache-store.js';
import { createAssignmentsService } from '../src/services/assignments.service.js';
import { createExamsService } from '../src/services/exams.service.js';
import type { AssignmentsRepository } from '../src/db/repositories/assignments.repository.js';
import type { ExamsRepository } from '../src/db/repositories/exams.repository.js';

const schoolId = '11111111-1111-4111-8111-111111111111';
const studentId = '22222222-2222-4222-8222-222222222222';
const teacherId = '33333333-3333-4333-8333-333333333333';
const assignmentId = '44444444-4444-4444-8444-444444444444';
const submissionId = '55555555-5555-4555-8555-555555555555';
const eventId = '66666666-6666-4666-8666-666666666666';

const pgDialect = new PgDialect();

interface CleanupUploadSessionState {
  bucket: string;
  expired: boolean;
  id: string;
  objectPath: string;
  schoolId: string;
  status: 'pending';
}

class QueryAwareCleanupDatabase {
  private readonly adoptedRecordingResourceSessions = new Set<string>();
  private readonly uploadSessions = new Map<string, CleanupUploadSessionState>();

  public attachRecordingResource(uploadSessionId: string): void {
    this.adoptedRecordingResourceSessions.add(uploadSessionId);
  }

  public expireUploadSession(uploadSessionId: string): void {
    const session = this.uploadSessions.get(uploadSessionId);
    if (session === undefined) throw new Error('Unknown cleanup upload session');
    session.expired = true;
  }

  public hasUploadSession(uploadSessionId: string): boolean {
    return this.uploadSessions.has(uploadSessionId);
  }

  public insertUploadSession(session: CleanupUploadSessionState): void {
    this.uploadSessions.set(session.id, { ...session });
  }

  public readonly execute = async (query: unknown): Promise<unknown[]> => {
    const rendered = pgDialect.sqlToQuery(query as SQL);
    if (rendered.sql.includes('select distinct bucket, object_path, upload_session_id')) {
      const school = rendered.params.find((value) => value === schoolId);
      if (school === undefined) throw new Error('Cleanup query was not scoped to the school');
      const excludesRecordingResources = rendered.sql.includes(
        'from public.recording_resources resource',
      ) && rendered.sql.includes(
        'where resource.upload_session_id = upload_sessions.id',
      );
      return [...this.uploadSessions.values()]
        .filter((session) => session.schoolId === schoolId)
        .filter((session) => session.status === 'pending' && session.expired)
        .filter((session) => (
          !excludesRecordingResources
          || !this.adoptedRecordingResourceSessions.has(session.id)
        ))
        .map((session) => ({
          bucket: session.bucket,
          object_path: session.objectPath,
          upload_session_id: session.id,
        }));
    }
    if (rendered.sql.includes('delete from public.upload_sessions')) {
      for (const value of rendered.params) {
        if (typeof value === 'string' && this.uploadSessions.has(value)) {
          this.uploadSessions.delete(value);
        }
      }
      return [];
    }
    throw new Error(`Unexpected cleanup query: ${rendered.sql}`);
  };

  public asDatabase(): Database {
    return this as unknown as Database;
  }
}

describe('academic file service', () => {
  it('uses only approved parent authorizers and delegates each one to its repository', async () => {
    const announcementCanManage = vi.fn().mockResolvedValue(true);
    const assignmentCanManage = vi.fn().mockResolvedValue(true);
    const submissionCanAccess = vi.fn().mockResolvedValue(true);
    const examCanManage = vi.fn().mockResolvedValue(true);
    const authorizer = new AcademicUploadParentAuthorizer({
      announcements: { canManage: announcementCanManage },
      assignments: {
        canAccessSubmission: submissionCanAccess,
        canManage: assignmentCanManage,
      },
      events: { canManage: vi.fn().mockResolvedValue(false) },
      exams: { canManageAssessment: examCanManage },
    });

    await expect(authorizer.authorize({
      action: 'create', bucket: 'academic-files', parentId: 'announcement-1',
      parentType: 'announcement-resource', schoolId, userId: teacherId,
    })).resolves.toBe(true);
    await expect(authorizer.authorize({
      action: 'create', bucket: 'academic-files', parentId: assignmentId,
      parentType: 'assignment-resource', schoolId, userId: teacherId,
    })).resolves.toBe(true);
    await expect(authorizer.authorize({
      action: 'confirm', bucket: 'academic-files', parentId: submissionId,
      parentType: 'assignment-submission', schoolId, userId: studentId,
    })).resolves.toBe(true);
    await expect(authorizer.authorize({
      action: 'confirm', bucket: 'academic-files', parentId: 'exam-1',
      parentType: 'exam-resource', schoolId, userId: teacherId,
    })).resolves.toBe(true);
    await expect(authorizer.authorize({
      action: 'create', bucket: 'academic-files', parentId: 'other-1',
      parentType: 'profile-avatar', schoolId, userId: teacherId,
    })).resolves.toBe(false);

    expect(announcementCanManage).toHaveBeenCalledWith({ schoolId, userId: teacherId }, 'announcement-1');
    expect(assignmentCanManage).toHaveBeenCalledWith({ schoolId, userId: teacherId }, assignmentId);
    expect(submissionCanAccess).toHaveBeenCalledWith({ schoolId, userId: studentId }, submissionId);
    expect(examCanManage).toHaveBeenCalledWith({ schoolId, userId: teacherId }, 'exam-1');
  });

  it('preserves display metadata while wrapping create, confirm, and fixed-lifetime reads', async () => {
    const createUploadSession = vi.fn().mockResolvedValue({
      expiresAt: '2026-07-14T00:00:00.000Z', id: submissionId,
      objectPath: `${schoolId}/assignment-submission/${submissionId}/upload-1`,
      signedUploadUrl: 'https://upload.example/file',
    });
    const confirmUpload = vi.fn().mockResolvedValue({
      bucket: 'academic-files', contentType: 'application/pdf', displayName: 'homework.pdf',
      id: submissionId, objectPath: `${schoolId}/assignment-submission/${submissionId}/upload-1`,
      parentId: submissionId, parentType: 'assignment-submission', schoolId,
      sizeBytes: 256, status: 'confirmed', userId: studentId,
    });
    const createSignedReadUrl = vi.fn().mockResolvedValue('https://read.example/file');
    const service = new AcademicFileService({
      confirmUpload,
      createSignedReadUrl,
      createUploadSession,
    } as unknown as StorageServiceContract);

    await service.createUpload({ schoolId, userId: studentId }, {
      bucket: 'academic-files', contentType: 'application/pdf', displayName: 'homework.pdf',
      parentId: submissionId, parentType: 'assignment-submission', sizeBytes: 256,
    });
    await expect(service.confirmUpload({ schoolId, userId: studentId }, {
      parentId: submissionId, parentType: 'assignment-submission', uploadSessionId: submissionId,
    })).resolves.toMatchObject({ displayName: 'homework.pdf', id: submissionId });
    await expect(service.createReadUrl(
      'academic-files', `${schoolId}/assignment-submission/${submissionId}/upload-1`, 900,
    )).resolves.toBe('https://read.example/file');

    expect(createUploadSession).toHaveBeenCalledWith(
      { schoolId, userId: studentId },
      expect.objectContaining({ displayName: 'homework.pdf' }),
    );
    expect(createSignedReadUrl).toHaveBeenCalledWith(
      'academic-files', `${schoolId}/assignment-submission/${submissionId}/upload-1`, 900,
    );
  });
});

describe('runtime academic file policy', () => {
  it('admits the domain Office MIME contract at 20 MiB without StorageService rejection', async () => {
    const createSignedUploadUrl = vi.fn().mockResolvedValue('https://upload.example/document');
    const create = vi.fn().mockResolvedValue(undefined);
    const storage = new StorageService(
      { createSignedReadUrl: vi.fn(), createSignedUploadUrl },
      { confirm: vi.fn(), create, deleteExpiredPending: vi.fn(), find: vi.fn(), findExpiredPending: vi.fn() },
      runtimeUploadBuckets,
      { authorize: vi.fn().mockResolvedValue(true) },
      { inspect: vi.fn() },
      undefined,
      () => 'session-1',
      () => new Date('2026-07-14T00:00:00.000Z'),
    );

    await expect(storage.createUploadSession({ schoolId, userId: teacherId }, {
      bucket: 'academic-files',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      parentId: assignmentId,
      parentType: 'assignment-resource',
      sizeBytes: 20 * 1024 * 1024,
    })).resolves.toMatchObject({ id: 'session-1', signedUploadUrl: 'https://upload.example/document' });

    expect(createSignedUploadUrl).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
    expect(runtimeUploadBuckets['academic-files'].allowedContentTypes).toEqual([
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'image/jpeg', 'image/png', 'image/webp',
    ]);
    expect(runtimeUploadBuckets['academic-files'].maxSizeBytes).toBe(20 * 1024 * 1024);
  });
});

describe('academic outbox', () => {
  const event = {
    aggregateId: assignmentId,
    aggregateType: 'assignment-submission' as const,
    dispatchAttempts: 0,
    dispatchedAt: null,
    eventType: 'assignment.submitted' as const,
    id: eventId,
    lockedUntil: null,
    occurredAt: '2026-07-13T00:00:00.000Z',
    payload: { assignmentId, studentId },
    schoolId,
  };

  it('claims pending events with a 60-second SKIP LOCKED lease', async () => {
    const execute = vi.fn().mockResolvedValue([{
      aggregate_id: event.aggregateId,
      aggregate_type: event.aggregateType,
      dispatch_attempts: event.dispatchAttempts,
      dispatched_at: event.dispatchedAt,
      event_type: event.eventType,
      id: event.id,
      locked_until: event.lockedUntil,
      occurred_at: event.occurredAt,
      payload: event.payload,
      school_id: event.schoolId,
    }]);
    const outbox = new AcademicOutbox({ execute } as unknown as Database);

    await expect(outbox.claimPending()).resolves.toEqual([event]);

    const source = readFileSync(
      new URL('../src/platform/academic/academic-outbox.ts', import.meta.url),
      'utf8',
    );
    expect(source.toLowerCase()).toContain('for update skip locked');
    expect(source).toContain("interval '60 seconds'");
  });

  it('uses the outbox id as the queue event id and keeps failed deliveries retryable', async () => {
    const outbox = new AcademicOutbox({ execute: vi.fn() } as unknown as Database);
    vi.spyOn(outbox, 'claimPending').mockResolvedValue([event]);
    const markDispatched = vi.spyOn(outbox, 'markDispatched').mockResolvedValue(undefined);
    const markEnqueueFailed = vi.spyOn(outbox, 'markEnqueueFailed').mockResolvedValue(undefined);
    const queue: QueueClient = {
      archive: vi.fn(),
      enqueue: vi.fn(),
      read: vi.fn(),
    };

    await outbox.dispatchPending(queue);

    expect(queue.enqueue).toHaveBeenCalledWith('notification_dispatch', expect.objectContaining({
      eventId, eventType: 'assignment.submitted', schoolId,
    }));
    expect(markDispatched).toHaveBeenCalledWith(eventId);

    vi.mocked(queue.enqueue).mockRejectedValueOnce(new Error('PGMQ unavailable'));
    await outbox.dispatchPending(queue);
    expect(markEnqueueFailed).toHaveBeenCalledWith(eventId);
  });
});

describe('academic notification delivery', () => {
  it('durably resolves recipients, creates inbox effects, and retries pending push delivery', async () => {
    const recipient = { userId: studentId };
    const store: AcademicNotificationDeliveryStore = {
      listPendingPushes: vi.fn().mockResolvedValue([{
        expoPushTokens: ['ExponentPushToken[student]'],
        userId: studentId,
      }]),
      markPushDelivered: vi.fn().mockResolvedValue(undefined),
      persistInboxAndPushes: vi.fn().mockResolvedValue(undefined),
      resolveRecipients: vi.fn().mockResolvedValue([recipient]),
    };
    const push = { send: vi.fn().mockResolvedValue(undefined) };
    const handlers = createAcademicNotificationHandlers(store, push);
    const message = {
      eventId,
      eventType: 'assignment.graded',
      occurredAt: '2026-07-13T00:00:00.000Z',
      payload: { assignmentId, studentId },
      schoolId,
      schemaVersion: 1,
    } as const;

    await handlers.notification(message, { providerIdempotencyKey: eventId });

    expect(store.resolveRecipients).toHaveBeenCalledWith(message);
    expect(store.persistInboxAndPushes).toHaveBeenCalledWith(message, [recipient]);
    expect(store.listPendingPushes).toHaveBeenCalledWith(message);
    expect(push.send).toHaveBeenCalledWith(expect.objectContaining({
      eventId,
      idempotencyKey: `${eventId}:${studentId}`,
      userId: studentId,
    }));
    expect(store.markPushDelivered).toHaveBeenCalledWith(eventId, studentId);

    await handlers.reminder({ ...message, eventType: 'assignment.reminder.requested' }, {
      providerIdempotencyKey: eventId,
    });
    expect(store.persistInboxAndPushes).toHaveBeenCalledTimes(2);
  });

  it('does not persist revoked or unpublished recipients before the shared live-authorization predicate', () => {
    const source = readFileSync(
      new URL('../src/platform/academic/academic-notification-delivery.ts', import.meta.url),
      'utf8',
    );
    const resolve = source.slice(
      source.indexOf('public async resolveRecipients'),
      source.indexOf('public async persistInboxAndPushes'),
    );
    const authorizedRecipients = source.slice(
      source.indexOf('private authorizedRecipientSelect'),
      source.indexOf('private async suppressStalePendingPushes'),
    );
    const persist = source.slice(
      source.indexOf('public async persistInboxAndPushes'),
      source.indexOf('public async listPendingPushes'),
    );

    expect(resolve).toContain('authorizedRecipientSelect(message)');
    expect(authorizedRecipients).toContain('public.class_members');
    expect(authorizedRecipients).toContain('public.class_subjects');
    expect(authorizedRecipients).toContain('announcement.is_published');
    expect(authorizedRecipients).toContain('assessment.is_published');
    expect(authorizedRecipients).toContain('join public.exam_groups exam_group');
    expect(authorizedRecipients).toContain('exam_group.deleted_at is null');
    expect(persist).toContain('with authorized as');
    expect(persist).toContain('authorizedRecipientSelect(message)');
    expect(persist).toContain('insert into public.notification_inbox');
    expect(persist).toContain('insert into public.notification_push_deliveries');
  });

  it('reauthorizes every pending delivery and marks the inbox stale before retrying push', async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const store = new DrizzleAcademicNotificationDeliveryStore({ execute } as unknown as Database);
    const message = {
      eventId,
      eventType: "assignment.graded" as const,
      occurredAt: "2026-07-13T00:00:00.000Z",
      payload: { assignmentId, studentId },
      schoolId,
      schemaVersion: 1 as const,
    };

    await expect(store.listPendingPushes(message)).resolves.toEqual([]);

    expect(execute).toHaveBeenCalledTimes(2);
    const source = readFileSync(
      new URL("../src/platform/academic/academic-notification-delivery.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("public.class_members");
    expect(source).toContain("public.class_subjects");
    expect(source).toContain("set stale_at = now()");
    expect(source).toContain("and delivery.stale_at is null");
  });

});

  it('registers durable notification and reminder handlers in the worker runtime', () => {
    const source = readFileSync(new URL('../src/worker.ts', import.meta.url), 'utf8');

    expect(source).toContain('notification_dispatch: handlers.notification');
    expect(source).toContain('reminder_dispatch: handlers.reminder');
    expect(source).toContain('DrizzleAcademicNotificationDeliveryStore');
    expect(source).toContain('ExpoPushSender');
  });

describe('academic cache', () => {
  it('versions student assignment lists and leaderboard namespaces while deleting exact detail and group keys', async () => {
    const cache = { delete: vi.fn(), get: vi.fn(), set: vi.fn(), withLock: vi.fn() };
    const academicCache = new AcademicCache(cache);

    await academicCache.invalidateStudentAssignments({ assignmentId, schoolId, studentId });
    await academicCache.invalidateExamGroup({ groupId: 'group-1', schoolId });

    expect(cache.set).toHaveBeenCalledWith(
      studentAssignmentListVersionKey(schoolId, studentId),
      expect.any(String),
      300,
    );
    expect(cache.delete).toHaveBeenCalledWith(tenantCacheKey(schoolId, 'assignments', 'detail', assignmentId));
    expect(cache.delete).toHaveBeenCalledWith(tenantCacheKey(schoolId, 'exams', 'group', 'group-1'));
    expect(cache.set).toHaveBeenCalledWith(
      examGroupLeaderboardVersionKey(schoolId, 'group-1'),
      expect.any(String),
      300,
    );
  });
});

describe('academic storage cleanup', () => {
  it('keeps archived event media durable across Storage failure and deletes the row only after retry succeeds', async () => {
    const resourceId = '77777777-7777-4777-8777-777777777777';
    const objectPath = `${schoolId}/event-resource/${eventId}/${resourceId}`;
    let rowExists = true;
    const execute = vi.fn(async (query: unknown) => {
      const rendered = pgDialect.sqlToQuery(query as SQL);
      if (rendered.sql.includes('select distinct bucket, object_path, upload_session_id')) {
        return rowExists ? [{
          bucket: 'academic-files',
          event_resource_id: resourceId,
          object_path: objectPath,
          upload_session_id: null,
        }] : [];
      }
      if (rendered.sql.includes('delete from public.event_resources')) {
        rowExists = false;
        return [];
      }
      throw new Error(`Unexpected archived event cleanup query: ${rendered.sql}`);
    });
    const remove = vi.fn()
      .mockRejectedValueOnce(new Error('Storage temporarily unavailable'))
      .mockResolvedValueOnce(undefined);
    const handler = createStorageCleanupHandler(
      { execute } as unknown as Database,
      { remove },
    );
    const message = {
      eventId,
      eventType: 'storage.cleanup_expired_sessions' as const,
      occurredAt: '2026-07-13T00:00:00.000Z',
      payload: {},
      schoolId,
      schemaVersion: 1 as const,
    };

    await expect(handler(message, { providerIdempotencyKey: eventId }))
      .rejects.toThrow('Storage temporarily unavailable');
    expect(rowExists).toBe(true);

    await expect(handler(message, { providerIdempotencyKey: eventId }))
      .resolves.toBeUndefined();
    expect(rowExists).toBe(false);
    expect(remove).toHaveBeenCalledTimes(2);

    const candidate = execute.mock.calls
      .map(([query]) => pgDialect.sqlToQuery(query as SQL).sql)
      .find((sqlText) => sqlText.includes('select distinct bucket, object_path, upload_session_id'));
    expect(candidate).toContain('from public.event_resources resource');
    expect(candidate).toContain('event.deleted_at is not null');
    expect(candidate).toContain('event_resource_id is not null');
    expect(candidate).toContain('limit 500');
  });
  it('removes expired academic objects and treats an object-not-found response as success', async () => {
    const database = {
      execute: vi.fn().mockResolvedValue([{
        bucket: 'academic-files', object_path: `${schoolId}/expired-file`, upload_session_id: null,
      }]),
    } as unknown as Database;
    const remove = vi.fn().mockRejectedValue({ statusCode: 404 });
    const handler = createStorageCleanupHandler(database, { remove });

    await expect(handler({
      eventId, eventType: 'storage.cleanup_expired_sessions', occurredAt: '2026-07-13T00:00:00.000Z',
      payload: {}, schoolId, schemaVersion: 1,
    }, { providerIdempotencyKey: eventId })).resolves.toBeUndefined();

    expect(remove).toHaveBeenCalledWith('academic-files', `${schoolId}/expired-file`);
  });
  it('preserves cleanup for expired upload sessions in every private bucket', async () => {
    const profileObject = `${schoolId}/profile-avatar/upload-1`;
    const execute = vi.fn().mockResolvedValueOnce([{
      bucket: 'profile-avatars', object_path: profileObject, upload_session_id: submissionId,
    }]).mockResolvedValueOnce([]);
    const remove = vi.fn().mockResolvedValue(undefined);
    const handler = createStorageCleanupHandler({ execute } as unknown as Database, { remove });

    await handler({
      eventId, eventType: 'storage.cleanup_expired_sessions', occurredAt: '2026-07-13T00:00:00.000Z',
      payload: {}, schoolId, schemaVersion: 1,
    }, { providerIdempotencyKey: eventId });

    expect(remove).toHaveBeenCalledWith('profile-avatars', profileObject);
    const source = readFileSync(new URL('../src/config/platform-dependencies.ts', import.meta.url), 'utf8');
    expect(source).toContain('select bucket, object_path, id::text as upload_session_id');
    expect(source).not.toContain("and bucket = 'academic-files'\n          and status = 'pending'");
  });
  it('does not delete a recording resource when finalization is interrupted before its session expires', async () => {
    const uploadSessionId = '77777777-7777-4777-8777-777777777777';
    const objectPath = `${schoolId}/recording-resource/recording-1/${uploadSessionId}`;
    const database = new QueryAwareCleanupDatabase();
    database.insertUploadSession({
      bucket: 'recordings',
      expired: false,
      id: uploadSessionId,
      objectPath,
      schoolId,
      status: 'pending',
    });

    // The durable resource row was committed, then upload-session finalization
    // failed. Time passes before the scheduled cleanup handler executes.
    database.attachRecordingResource(uploadSessionId);
    database.expireUploadSession(uploadSessionId);

    const remove = vi.fn();
    const handler = createStorageCleanupHandler(database.asDatabase(), { remove });

    await handler({
      eventId, eventType: 'storage.cleanup_expired_sessions', occurredAt: '2026-07-13T00:00:00.000Z',
      payload: {}, schoolId, schemaVersion: 1,
    }, { providerIdempotencyKey: eventId });

    expect(remove).not.toHaveBeenCalled();
    expect(database.hasUploadSession(uploadSessionId)).toBe(true);
  });
  it('limits cleanup to a 500-object batch and deletes only those handled upload sessions', async () => {
    const candidates = Array.from({ length: 500 }, (_, index) => ({
      bucket: 'academic-files',
      object_path: `${schoolId}/expired-${index}`,
      upload_session_id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    }));
    const execute = vi.fn()
      .mockResolvedValueOnce(candidates)
      .mockResolvedValueOnce([]);
    const remove = vi.fn().mockResolvedValue(undefined);
    const handler = createStorageCleanupHandler({ execute } as unknown as Database, { remove });

    await handler({
      eventId, eventType: 'storage.cleanup_expired_sessions', occurredAt: '2026-07-13T00:00:00.000Z',
      payload: {}, schoolId, schemaVersion: 1,
    }, { providerIdempotencyKey: eventId });

    expect(remove).toHaveBeenCalledTimes(500);
    expect(execute).toHaveBeenCalledTimes(2);
    const source = readFileSync(new URL('../src/config/platform-dependencies.ts', import.meta.url), 'utf8');
    expect(source).toContain('limit 500');
    expect(source).toContain('handledSessionIds');
  });
  it('advances past 500 soft-deleted-parent objects by marking the handled first batch', async () => {
    const firstBatch = Array.from({ length: 500 }, (_, index) => ({
      bucket: 'academic-files',
      object_path: `${schoolId}/soft-deleted-${index}`,
      upload_session_id: null,
    }));
    const nextBatch = [{
      bucket: 'academic-files', object_path: `${schoolId}/soft-deleted-500`, upload_session_id: null,
    }];
    let call = 0;
    const execute = vi.fn(async () => {
      call += 1;
      if (call === 1) return firstBatch;
      if (call === 502) return nextBatch;
      return [];
    });
    const remove = vi.fn().mockResolvedValue(undefined);
    const handler = createStorageCleanupHandler({ execute } as unknown as Database, { remove });
    const message = {
      eventId, eventType: 'storage.cleanup_expired_sessions' as const, occurredAt: '2026-07-13T00:00:00.000Z',
      payload: {}, schoolId, schemaVersion: 1 as const,
    };

    await handler(message, { providerIdempotencyKey: eventId });
    await handler(message, { providerIdempotencyKey: eventId });

    expect(remove).toHaveBeenCalledTimes(501);
    expect(remove).toHaveBeenLastCalledWith('academic-files', `${schoolId}/soft-deleted-500`);
    const source = readFileSync(new URL('../src/config/platform-dependencies.ts', import.meta.url), 'utf8');
    expect(source).toContain('academic_storage_cleanup_objects');
    expect(source).toContain('not exists');
  });
});

describe('academic service cache wiring', () => {
  it('keeps announcement caching out of the runtime and invalidates exam groups after publication', () => {
    const announcements = readFileSync(new URL('../src/services/announcements.service.ts', import.meta.url), 'utf8');
    const exams = readFileSync(new URL('../src/services/exams.service.ts', import.meta.url), 'utf8');
    const dependencies = readFileSync(new URL('../src/config/dependencies.ts', import.meta.url), 'utf8');

    expect(announcements).not.toContain('AnnouncementCachePort');
    expect(exams).toContain('await invalidate(assessment.groupId, identity.schoolId)');
    expect(dependencies).not.toContain('createAnnouncementsService({ cache,');
    expect(dependencies).toContain('createExamsService({ cache,');
  });
});

describe('database idempotency lease recovery', () => {
  it('persists a JSON null response for a successful no-content operation', async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const store = new DatabaseIdempotencyRecordStore({ execute } as unknown as Database);

    await store.complete(schoolId, teacherId, 'delete-resource', { body: undefined, status: 204 });
    await store.completeOwned(
      schoolId,
      teacherId,
      'delete-resource-owned',
      'a'.repeat(64),
      '2026-07-30T00:00:00.000Z',
      { body: undefined, status: 204 },
    );

    const rendered = execute.mock.calls.map(([query]) => pgDialect.sqlToQuery(query as SQL));
    expect(rendered.every((query) => query.params.includes('null'))).toBe(true);
    expect(rendered.flatMap((query) => query.params)).not.toContain(undefined);
  });

  it('atomically reclaims only the matching expired pending request', async () => {
    const leaseToken = '2026-07-29 18:40:00+00';
    const execute = vi.fn().mockResolvedValue([{ lease_expires_at: leaseToken }]);
    const store = new DatabaseIdempotencyRecordStore({ execute } as unknown as Database);

    await expect(store.reclaimExpired(
      schoolId,
      teacherId,
      'scoped-key',
      'a'.repeat(64),
    )).resolves.toBe(leaseToken);

    const rendered = pgDialect.sqlToQuery(execute.mock.calls[0]?.[0] as SQL);
    expect(rendered.sql).toContain("set lease_expires_at = clock_timestamp() + interval '10 minutes'");
    expect(rendered.sql).toContain('request_hash =');
    expect(rendered.sql).toContain('response_status is null');
    expect(rendered.sql).toContain('lease_expires_at <= clock_timestamp()');
    expect(rendered.params).toEqual(expect.arrayContaining([schoolId, teacherId, 'scoped-key', 'a'.repeat(64)]));
  });
});

describe('academic mutation idempotency recovery', () => {
  it('releases a failed claim so an identical retry can complete without an in-progress deadlock', async () => {
    const records = new Map<string, IdempotencyRecord>();
    const recordStore: IdempotencyRecordStore = {
      complete: vi.fn(async (_schoolId, _userId, key, response) => {
        const current = records.get(key)!;
        records.set(key, { ...current, responseBody: response.body, responseStatus: response.status });
      }),
      create: vi.fn(async (record) => {
        if (records.has(record.key)) return false;
        records.set(record.key, record);
        return true;
      }),
      find: vi.fn(async (_schoolId, _userId, key) => records.get(key)),
      release: vi.fn(async (_schoolId, _userId, key) => { records.delete(key); }),
    };
    const executor = createAcademicMutationExecutor(new IdempotencyStore(recordStore));
    const identity = { schoolId, userId: teacherId };
    const input = { idempotencyKey: 'retry-after-failure', requestBody: { title: 'A' }, successStatus: 201 };

    await expect(executor.execute(identity, {
      ...input,
      work: async () => { throw new Error('transactional outbox failure'); },
    })).rejects.toThrow('transactional outbox failure');

    await expect(executor.execute(identity, {
      ...input,
      work: async () => ({ id: 'created-once' }),
    })).resolves.toMatchObject({ body: { id: 'created-once' }, replayed: false, status: 201 });

    expect(recordStore.release).toHaveBeenCalledTimes(1);
    await expect(executor.execute(identity, {
      ...input,
      work: async () => { throw new Error('must not run'); },
    })).resolves.toMatchObject({ body: { id: 'created-once' }, replayed: true, status: 201 });
  });

  it('reconciles a durable post-commit result before releasing its idempotency key', async () => {
    const records = new Map<string, IdempotencyRecord>();
    const recordStore: IdempotencyRecordStore = {
      complete: vi.fn(async (_schoolId, _userId, key, response) => {
        const current = records.get(key)!;
        records.set(key, { ...current, responseBody: response.body, responseStatus: response.status });
      }),
      create: vi.fn(async (record) => {
        if (records.has(record.key)) return false;
        records.set(record.key, record);
        return true;
      }),
      find: vi.fn(async (_schoolId, _userId, key) => records.get(key)),
      release: vi.fn(async (_schoolId, _userId, key) => { records.delete(key); }),
    };
    const executor = createAcademicMutationExecutor(new IdempotencyStore(recordStore));
    const identity = { schoolId, userId: teacherId };
    const recover = vi.fn().mockResolvedValue({ id: 'linked-once' });
    const work = vi.fn(async () => { throw new Error('upload finalization timed out'); });
    const input = {
      idempotencyKey: 'reconcile-after-commit',
      recover,
      requestBody: { uploadSessionId: submissionId },
      successStatus: 201,
      work,
    };

    await expect(executor.execute(identity, input)).resolves.toMatchObject({
      body: { id: 'linked-once' }, replayed: false, status: 201,
    });
    await expect(executor.execute(identity, {
      ...input,
      requestBody: { uploadSessionId: assignmentId },
    })).rejects.toMatchObject({ status: 409 });

    expect(recover).toHaveBeenCalledOnce();
    expect(work).toHaveBeenCalledOnce();
    expect(recordStore.release).not.toHaveBeenCalled();
  });

  it('recovers a completion acknowledgement failure without rerunning committed work', async () => {
    const records = new Map<string, IdempotencyRecord>();
    const recordStore: IdempotencyRecordStore = {
      complete: vi.fn(async (_schoolId, _userId, key, response) => {
        const current = records.get(key)!;
        records.set(key, { ...current, responseBody: response.body, responseStatus: response.status });
        throw new Error('connection dropped after commit');
      }),
      create: vi.fn(async (record) => {
        if (records.has(record.key)) return false;
        records.set(record.key, record);
        return true;
      }),
      find: vi.fn(async (_schoolId, _userId, key) => records.get(key)),
      release: vi.fn(async (_schoolId, _userId, key) => { records.delete(key); }),
    };
    const executor = createAcademicMutationExecutor(new IdempotencyStore(recordStore));
    const identity = { schoolId, userId: teacherId };
    const work = vi.fn(async () => ({ id: 'created-once' }));
    const input = {
      idempotencyKey: 'complete-after-commit', requestBody: { title: 'A' }, successStatus: 201, work,
    };

    await expect(executor.execute(identity, input)).resolves.toMatchObject({
      body: { id: 'created-once' }, replayed: false, status: 201,
    });
    await expect(executor.execute(identity, input)).resolves.toMatchObject({
      body: { id: 'created-once' }, replayed: true, status: 201,
    });
    expect(work).toHaveBeenCalledTimes(1);
    expect(recordStore.release).not.toHaveBeenCalled();
  });

  it('does not replace a fail-closed completion outcome with an in-memory recovery result', async () => {
    const records = new Map<string, IdempotencyRecord>();
    const recordStore: IdempotencyRecordStore = {
      complete: vi.fn(async (_schoolId, _userId, key, response) => {
        if (response.status !== 503) throw new Error('completion write unavailable');
        const current = records.get(key)!;
        records.set(key, { ...current, responseBody: response.body, responseStatus: response.status });
      }),
      create: vi.fn(async (record) => {
        if (records.has(record.key)) return false;
        records.set(record.key, record);
        return true;
      }),
      find: vi.fn(async (_schoolId, _userId, key) => records.get(key)),
      release: vi.fn(),
    };
    const executor = createAcademicMutationExecutor(new IdempotencyStore(recordStore));
    const recover = vi.fn().mockResolvedValue({ id: 'must-not-replace-503' });
    const input = {
      idempotencyKey: 'fail-closed-stays-durable',
      recover,
      requestBody: { uploadSessionId: submissionId },
      successStatus: 201,
      work: async () => ({ id: 'created-once' }),
    };

    await expect(executor.execute({ schoolId, userId: teacherId }, input)).rejects.toMatchObject({ status: 503 });
    expect(recover).not.toHaveBeenCalled();
    expect(records.get(input.idempotencyKey)?.responseStatus).toBe(503);
  });

  it("fails closed after completion never persists and never reruns committed work", async () => {
    const records = new Map<string, IdempotencyRecord>();
    const recordStore: IdempotencyRecordStore = {
      complete: vi.fn(async (_schoolId, _userId, key, response) => {
        if (response.status !== 503) throw new Error("completion write unavailable");
        const current = records.get(key)!;
        records.set(key, { ...current, responseBody: response.body, responseStatus: response.status });
      }),
      create: vi.fn(async (record) => {
        if (records.has(record.key)) return false;
        records.set(record.key, record);
        return true;
      }),
      find: vi.fn(async (_schoolId, _userId, key) => records.get(key)),
      release: vi.fn(),
    };
    const executor = createAcademicMutationExecutor(new IdempotencyStore(recordStore));
    const identity = { schoolId, userId: teacherId };
    const work = vi.fn(async () => ({ id: "created-once" }));
    const input = {
      idempotencyKey: "completion-never-persists", requestBody: { title: "A" }, successStatus: 201, work,
    };

    await expect(executor.execute(identity, input)).rejects.toMatchObject({ status: 503 });
    await expect(executor.execute(identity, input)).rejects.toMatchObject({ status: 503 });

    expect(work).toHaveBeenCalledTimes(1);
    expect(records.get(input.idempotencyKey)?.responseStatus).toBe(503);
  });

});

describe('academic cache degradation', () => {
  it('uses the scoped assignment database read when cache reads or writes fail', async () => {
    const databasePage = { items: [{ id: assignmentId }] };
    const cache = {
      get: vi.fn().mockRejectedValue(new Error('redis unavailable')),
      invalidateStudentAssignments: vi.fn(),
      set: vi.fn().mockRejectedValue(new Error('redis unavailable')),
    };
    const listForStudent = vi.fn().mockResolvedValue(databasePage);
    const service = createAssignmentsService({
      cache,
      files: {} as never,
      mutations: { execute: vi.fn() },
      outbox: { write: vi.fn(), writeInTransaction: vi.fn() },
      repository: {
        listActiveClassIdsForStudent: vi.fn().mockResolvedValue(['class-current']),
        listForStudent,
      } as unknown as AssignmentsRepository,
    });

    await expect(service.listForStudent({ schoolId, userId: studentId }, { limit: 20 }))
      .resolves.toEqual(databasePage);
    expect(listForStudent).toHaveBeenCalledOnce();
  });

  it('uses scoped exam database reads when cache reads or writes fail', async () => {
    const group = { id: 'group-1', title: 'Term one' };
    const cache = {
      get: vi.fn().mockRejectedValue(new Error('redis unavailable')),
      invalidateExamGroup: vi.fn(),
      set: vi.fn().mockRejectedValue(new Error('redis unavailable')),
    };
    const findGroupForStudent = vi.fn().mockResolvedValue(group);
    const service = createExamsService({
      cache,
      files: {} as never,
      mutations: { execute: vi.fn() },
      outbox: { write: vi.fn(), writeInTransaction: vi.fn() },
      repository: { findGroupForStudent } as unknown as ExamsRepository,
    });

    await expect(service.getGroupForStudent({ schoolId, userId: studentId }, 'group-1'))
      .resolves.toEqual(group);
    expect(findGroupForStudent).toHaveBeenCalledOnce();
  });

  it('treats corrupt cached JSON as a cache miss while preserving scoped academic reads', async () => {
    const assignmentPage = { items: [{ id: assignmentId }] };
    const listAssignmentCache = {
      get: vi.fn()
        .mockResolvedValueOnce('assignment-version')
        .mockResolvedValueOnce('{broken-json')
        .mockResolvedValueOnce('assignment-version'),
      invalidateStudentAssignments: vi.fn(),
      set: vi.fn(),
    };
    const listForStudent = vi.fn().mockResolvedValue(assignmentPage);
    const assignmentListService = createAssignmentsService({
      cache: listAssignmentCache,
      files: {} as never,
      mutations: { execute: vi.fn() },
      outbox: { write: vi.fn(), writeInTransaction: vi.fn() },
      repository: {
        listActiveClassIdsForStudent: vi.fn().mockResolvedValue(['class-current']),
        listForStudent,
      } as unknown as AssignmentsRepository,
    });

    await expect(assignmentListService.listForStudent({ schoolId, userId: studentId }, { limit: 20 }))
      .resolves.toEqual(assignmentPage);
    expect(listForStudent).toHaveBeenCalledOnce();

    const assignment = {
      assignedAt: '2026-07-25T09:30:00.000Z',
      dueAt: '2026-08-01T00:00:00.000Z', gradingType: 'Numeric', id: assignmentId,
      instructions: 'Read the chapter', isGradedAssignment: false, maxMarks: 10,
      resources: [], rubrics: [], subjectId: 'subject-1', title: 'Homework',
    };
    const findForStudent = vi.fn().mockResolvedValue(assignment);
    const assignmentDetailService = createAssignmentsService({
      cache: { get: vi.fn().mockResolvedValue('{broken-json'), invalidateStudentAssignments: vi.fn(), set: vi.fn() },
      files: {} as never,
      mutations: { execute: vi.fn() },
      outbox: { write: vi.fn(), writeInTransaction: vi.fn() },
      repository: { findForStudent } as unknown as AssignmentsRepository,
    });

    // `bannerUrl` is resolved by the service, not stored on the record: a
    // detail with no banner still states the absence, so the field is present
    // and null rather than missing.
    await expect(assignmentDetailService.getForStudent({ schoolId, userId: studentId }, assignmentId))
      .resolves.toEqual({ ...assignment, banner: null, bannerUrl: null });
    expect(findForStudent).toHaveBeenCalledWith({ schoolId, userId: studentId }, assignmentId);

    const group = { id: 'group-1', title: 'Term one' };
    const findGroupForStudent = vi.fn().mockResolvedValue(group);
    const examGroupService = createExamsService({
      cache: { get: vi.fn().mockResolvedValue('{broken-json'), invalidateExamGroup: vi.fn(), set: vi.fn() },
      files: {} as never,
      mutations: { execute: vi.fn() },
      outbox: { write: vi.fn(), writeInTransaction: vi.fn() },
      repository: { findGroupForStudent } as unknown as ExamsRepository,
    });

    await expect(examGroupService.getGroupForStudent({ schoolId, userId: studentId }, group.id))
      .resolves.toEqual(group);
    expect(findGroupForStudent).toHaveBeenCalledWith({ schoolId, userId: studentId }, group.id);

    const leaderboard = { items: [{ marks: 95, rank: 1, studentId }] };
    const findLeaderboardAudience = vi.fn().mockResolvedValue(group);
    const getLeaderboard = vi.fn().mockResolvedValue(leaderboard);
    const leaderboardService = createExamsService({
      cache: {
        get: vi.fn().mockResolvedValueOnce('leaderboard-version').mockResolvedValueOnce('{broken-json'),
        invalidateExamGroup: vi.fn(),
        set: vi.fn(),
      },
      files: {} as never,
      mutations: { execute: vi.fn() },
      outbox: { write: vi.fn(), writeInTransaction: vi.fn() },
      repository: { findGroupForStudent: findLeaderboardAudience, getLeaderboard } as unknown as ExamsRepository,
    });

    await expect(leaderboardService.getLeaderboard({ schoolId, userId: studentId }, group.id, { limit: 20 }))
      .resolves.toEqual(leaderboard);
    expect(findLeaderboardAudience).toHaveBeenCalledWith({ schoolId, userId: studentId }, group.id);
    expect(getLeaderboard).toHaveBeenCalledWith({ schoolId, userId: studentId }, group.id, { limit: 20 });
  });
});

describe('academic cache authorization and invalidation', () => {
  it('checks the current class-membership snapshot before it can read a warm assignment list cache', async () => {
    const cache = {
      get: vi.fn().mockResolvedValue(JSON.stringify({
        audienceClassIds: ['class-revoked'],
        page: { items: [{ id: assignmentId }] },
        // Current shape, so the audience mismatch is what forces the read.
        version: 2,
      })),
      invalidateStudentAssignments: vi.fn(),
      set: vi.fn(),
    };
    const listActiveClassIdsForStudent = vi.fn().mockResolvedValue(['class-current']);
    const listForStudent = vi.fn().mockResolvedValue({ items: [] });
    const service = createAssignmentsService({
      cache,
      files: {} as never,
      mutations: { execute: vi.fn() },
      outbox: { write: vi.fn(), writeInTransaction: vi.fn() },
      repository: {
        listActiveClassIdsForStudent,
        listForStudent,
      } as unknown as AssignmentsRepository,
    });

    await expect(service.listForStudent({ schoolId, userId: studentId }, { limit: 20 }))
      .resolves.toEqual({ items: [] });

    expect(listActiveClassIdsForStudent).toHaveBeenCalledWith({ schoolId, userId: studentId });
    expect(cache.get).toHaveBeenCalledAfter(listActiveClassIdsForStudent as never);
    expect(listForStudent).toHaveBeenCalledOnce();
  });

  it('refuses a cached assignment page written before assignedAt joined the item shape', async () => {
    const cache = {
      get: vi.fn().mockResolvedValue(JSON.stringify({
        audienceClassIds: ['class-current'],
        // Audience matches and the entry is well-formed; only the shape is old.
        page: { items: [{ dueAt: '2026-08-01T00:00:00.000Z', id: assignmentId }] },
        version: 1,
      })),
      invalidateStudentAssignments: vi.fn(),
      set: vi.fn(),
    };
    const listForStudent = vi.fn().mockResolvedValue({ items: [] });
    const service = createAssignmentsService({
      cache,
      files: {} as never,
      mutations: { execute: vi.fn() },
      outbox: { write: vi.fn(), writeInTransaction: vi.fn() },
      repository: {
        listActiveClassIdsForStudent: vi.fn().mockResolvedValue(['class-current']),
        listForStudent,
      } as unknown as AssignmentsRepository,
    });

    // Serving it would hand the client an item missing a field the contract
    // declares as always present.
    await expect(service.listForStudent({ schoolId, userId: studentId }, { limit: 20 }))
      .resolves.toEqual({ items: [] });
    expect(listForStudent).toHaveBeenCalledOnce();
  });

  it('refuses a cached assignment detail written before assignedAt existed', async () => {
    const stored = {
      assignedAt: '2026-07-25T09:30:00.000Z',
      classId: 'class-1', displayCode: null, dueAt: '2026-08-01T00:00:00.000Z',
      gradingType: 'Numeric' as const, id: assignmentId, instructions: 'Read the chapter',
      isGradedAssignment: false, maxMarks: 10, resources: [], rubrics: [],
      subjectId: 'subject-1', title: 'Homework',
    };
    const findForStudent = vi.fn().mockResolvedValue(stored);
    const service = createAssignmentsService({
      cache: {
        get: vi.fn().mockResolvedValue(JSON.stringify({ ...stored, assignedAt: undefined })),
        invalidateStudentAssignments: vi.fn(),
        set: vi.fn(),
      },
      files: {} as never,
      mutations: { execute: vi.fn() },
      outbox: { write: vi.fn(), writeInTransaction: vi.fn() },
      repository: { findForStudent } as unknown as AssignmentsRepository,
    });

    await expect(service.getForStudent({ schoolId, userId: studentId }, assignmentId))
      .resolves.toMatchObject({ assignedAt: '2026-07-25T09:30:00.000Z' });
  });

  it('uses distinct canonical cache keys for subject, status, limit, and cursor variants', async () => {
    const cache = {
      get: vi.fn().mockImplementation(async (key: string) => (
        key.includes('student-list-version') ? 'version-a' : null
      )),
      invalidateStudentAssignments: vi.fn(),
      set: vi.fn(),
    };
    const listForStudent = vi.fn().mockResolvedValue({ items: [] });
    const service = createAssignmentsService({
      cache,
      files: {} as never,
      mutations: { execute: vi.fn() },
      outbox: { write: vi.fn(), writeInTransaction: vi.fn() },
      repository: {
        listActiveClassIdsForStudent: vi.fn().mockResolvedValue(['class-current']),
        listForStudent,
      } as unknown as AssignmentsRepository,
    });

    await service.listForStudent({ schoolId, userId: studentId }, { limit: 20, status: 'active' });
    await service.listForStudent({ schoolId, userId: studentId }, {
      cursor: { dueAt: '2026-08-01T00:00:00.000Z', id: assignmentId },
      limit: 10,
      status: 'graded',
      subjectId: 'subject-1',
    });

    const pageKeys = vi.mocked(cache.get).mock.calls
      .map(([key]) => key)
      .filter((key) => key.includes(':student-list:'));
    expect(pageKeys).toHaveLength(2);
    expect(pageKeys[0]).not.toBe(pageKeys[1]);
    expect(listForStudent).toHaveBeenCalledTimes(2);
  });

  it('does not consult a warm assignment list after every active class membership is revoked', async () => {
    const cache = {
      get: vi.fn().mockResolvedValue(JSON.stringify({ items: [{ id: assignmentId }] })),
      invalidateStudentAssignments: vi.fn(),
      set: vi.fn(),
    };
    const listForStudent = vi.fn().mockResolvedValue({ items: [] });
    const service = createAssignmentsService({
      cache,
      files: {} as never,
      mutations: { execute: vi.fn() },
      outbox: { write: vi.fn(), writeInTransaction: vi.fn() },
      repository: {
        listActiveClassIdsForStudent: vi.fn().mockResolvedValue([]),
        listForStudent,
      } as unknown as AssignmentsRepository,
    });

    await expect(service.listForStudent({ schoolId, userId: studentId }, { limit: 20 }))
      .resolves.toEqual({ items: [] });

    expect(cache.get).not.toHaveBeenCalled();
    expect(listForStudent).toHaveBeenCalledOnce();
  });

  it('does not read assignment or exam caches until the student audience query succeeds', async () => {
    const cache = {
      get: vi.fn().mockResolvedValue(JSON.stringify({ id: assignmentId })),
      invalidateExamGroup: vi.fn(),
      invalidateStudentAssignments: vi.fn(),
      set: vi.fn(),
    };
    const files = {
      deleteObject: vi.fn(),
      confirmUpload: vi.fn(),
      finalizeUpload: vi.fn(),
      prepareUpload: vi.fn(),
      createReadUrl: vi.fn().mockResolvedValue('https://signed.example/file'),
      createUpload: vi.fn(),
    };
    const mutations = { execute: vi.fn() };
    const outbox = { write: vi.fn(), writeInTransaction: vi.fn() };
    const deniedAssignments = {
      findForStudent: vi.fn().mockResolvedValue(undefined),
    } as unknown as AssignmentsRepository;
    const deniedExams = {
      findGroupForStudent: vi.fn().mockResolvedValue(undefined),
    } as unknown as ExamsRepository;
    const student = { schoolId, userId: studentId };

    await expect(createAssignmentsService({
      cache, files, mutations, outbox, repository: deniedAssignments,
    }).getForStudent(student, assignmentId)).rejects.toMatchObject({ status: 404 });
    await expect(createExamsService({
      cache, files, mutations, outbox, repository: deniedExams,
    }).getGroupForStudent(student, 'group-1')).rejects.toMatchObject({ status: 404 });
    await expect(createExamsService({
      cache, files, mutations, outbox, repository: deniedExams,
    }).getLeaderboard(student, 'group-1', { limit: 20 })).rejects.toMatchObject({ status: 404 });

    expect(cache.get).not.toHaveBeenCalled();
  });

  it('invalidates every affected student assignment key after assignment writes', async () => {
    const cache = { invalidateStudentAssignments: vi.fn().mockResolvedValue(undefined) };
    const stored = {
      classId: 'class-1', dueAt: '2026-08-01T00:00:00.000Z', gradingType: 'Numeric' as const,
      id: assignmentId, instructions: 'Instructions', isGradedAssignment: false,
      maxMarks: 10, resources: [], rubrics: [], subjectId: 'subject-1', title: 'Homework',
    };
    const repository = {
      canManage: vi.fn().mockResolvedValue(true),
      create: vi.fn().mockResolvedValue(stored),
      delete: vi.fn().mockResolvedValue(true),
      insertResource: vi.fn().mockResolvedValue({ id: 'resource-1', name: 'worksheet.pdf', objectPath: 'resource-1' }),
      listStudentIdsForAssignment: vi.fn().mockResolvedValue([studentId, 'student-2']),
      update: vi.fn().mockResolvedValue(stored),
    } as unknown as AssignmentsRepository;
    const files = {
      deleteObject: vi.fn(),
      finalizeUpload: vi.fn(),
      prepareUpload: vi.fn().mockResolvedValue({ displayName: 'worksheet.pdf', id: 'upload-1', objectPath: 'resource-1' }),
      createReadUrl: vi.fn().mockResolvedValue('https://signed.example/file'),
      createUpload: vi.fn(),
    };
    const mutations = {
      execute: async <T>(_identity: unknown, input: { successStatus: number; work: () => Promise<T> }) => ({
        body: await input.work(), replayed: false, status: input.successStatus,
      }),
    };
    const service = createAssignmentsService({
      cache, files, mutations, outbox: { write: vi.fn(), writeInTransaction: vi.fn() }, repository,
    });
    const teacher = { schoolId, userId: teacherId };

    await service.create(teacher, 'class-1', {
      dueAt: stored.dueAt, gradingType: 'Numeric', instructions: stored.instructions,
      isGradedAssignment: false, maxMarks: 10, rubrics: [], subjectId: stored.subjectId, title: stored.title,
    }, 'create');
    await service.update(teacher, assignmentId, {
      dueAt: stored.dueAt, gradingType: 'Numeric', instructions: stored.instructions,
      isGradedAssignment: false, maxMarks: 10, rubrics: [], subjectId: stored.subjectId, title: 'Updated',
    }, 'update');
    await service.confirmResource(teacher, assignmentId, 'upload-1', 'resource');
    await service.delete(teacher, assignmentId, 'delete');

    expect(cache.invalidateStudentAssignments).toHaveBeenCalledTimes(8);
    for (const studentIdToInvalidate of [studentId, 'student-2']) {
      expect(cache.invalidateStudentAssignments).toHaveBeenCalledWith({
        assignmentId, schoolId, studentId: studentIdToInvalidate,
      });
    }
  });
});

describe('RLS verification prerequisites', () => {
  it('requires the final reliability migration and detects an incomplete applied set', () => {
    expect(migrations).toContain('20260716070000');
    expect(migrations).toContain('20260716105000');
    expect(migrations).toContain('20260722200000');
    const incompleteApplied = migrations
      .filter((version) => version !== '20260716105000')
      .map((version) => ({ version }));
    expect(missingRequiredMigrations(incompleteApplied)).toEqual(['20260716105000']);

    const source = readFileSync(new URL('../scripts/verify-rls.mjs', import.meta.url), 'utf8');
    expect(source).toContain('const missing = missingRequiredMigrations(applied);');
    expect(source).toContain('insert into public.exam_submissions');
    expect(source).toContain("'exam_submissions'");
  });
});

describe('cleanup dispatcher fairness', () => {
  it('rotates beyond the first 100 tenants even when the early cleanup work persists', () => {
    const schools = Array.from({ length: 101 }, (_, index) => `school-${String(index).padStart(3, '0')}`);
    const selectBatch = (cursor: string | undefined) => schools
      .slice()
      .sort((left, right) => {
        const leftWraps = cursor !== undefined && left <= cursor;
        const rightWraps = cursor !== undefined && right <= cursor;
        if (leftWraps !== rightWraps) return leftWraps ? 1 : -1;
        return left.localeCompare(right);
      })
      .slice(0, 100);

    const firstBatch = selectBatch(undefined);
    const secondBatch = selectBatch(firstBatch.at(-1));
    expect(firstBatch).toHaveLength(100);
    expect(secondBatch[0]).toBe('school-100');
    expect(secondBatch).toContain('school-100');

    const migration = readFileSync(
      new URL('../supabase/migrations/20260716070000_academic_cleanup_scheduler_rotation.sql', import.meta.url),
      'utf8',
    );
    expect(migration).toContain('cursor_school_id');
    expect(migration).toContain('for update');
    expect(migration).toContain('public.assignment_submissions submission');
    expect(migration).toContain('submission.object_path is not null');
    expect(migration).toContain('revoke execute on function public.enqueue_expired_upload_session_cleanup() from public, anon, authenticated;');
    expect(migration).toContain('grant execute on function public.enqueue_expired_upload_session_cleanup() to service_role;');
  });
});
