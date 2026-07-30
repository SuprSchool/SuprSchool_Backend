import { createClient } from "@supabase/supabase-js";
import { Redis } from "ioredis";
import { sql } from "drizzle-orm";

import { createDatabase, type Database } from "../db/client.js";
import type { CacheStore } from "../platform/cache/cache-store.js";
import { NoopCacheStore } from "../platform/cache/noop-cache-store.js";
import { RedisCacheStore } from "../platform/cache/redis-cache-store.js";
import { DatabaseDeadLetterQueueStore } from "../platform/queue/dead-letter-queue-store.js";
import { PgmqQueueClient } from "../platform/queue/pgmq-queue-client.js";
import type { QueueClient } from "../platform/queue/queue-client.js";
import {
  DatabaseProcessedQueueEventStore,
  type QueueMessageHandler,
  QueueWorker,
} from "../platform/queue/queue-worker.js";
import {
  DatabaseUploadSessionStore,
  StorageService,
  SupabaseStorageObjectRemover,
  SupabaseUploadUrlSigner,
  type UploadParentAuthorizer,
} from "../platform/storage/storage-service.js";
import type { Env } from "./env.js";
import { SupabaseStorageObjectMetadataInspector } from "../platform/storage/supabase-storage-metadata-inspector.js";
import type { RecordingStoragePort } from "../services/recordings.ports.js";
import {
  NodeCommandRunner,
  RecordingMediaInspector,
} from "../platform/storage/recording-media-inspector.js";
import {
  DatabaseRecordingCleanupStore,
  RecordingStorageCleanupHandler,
  SupabaseRecordingObjectDeleter,
} from "../platform/storage/recording-storage-cleanup.js";
import {
  createSupabaseSignedTusEndpoint,
  SupabaseRecordingStorageAdapter,
} from "../platform/storage/supabase-recording-storage-adapter.js";
import { academicFileContentTypes } from "../platform/storage/academic-file-content-types.js";

export const runtimeUploadBuckets = {
  assignments: {
    allowedContentTypes: [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
      "audio/mpeg",
      "audio/mp4",
      "video/mp4",
    ],
    maxSizeBytes: 100 * 1024 * 1024,
  },
  "academic-files": {
    allowedContentTypes: academicFileContentTypes,
    maxSizeBytes: 20 * 1024 * 1024,
  },
  recordings: {
    allowedContentTypes: [
      "application/pdf",
      "audio/mp4",
      "image/jpeg",
      "image/png",
    ],
    maxSizeBytes: 128 * 1024 * 1024,
  },
  avatars: {
    allowedContentTypes: ["image/jpeg", "image/png", "image/webp"],
    maxSizeBytes: 2 * 1024 * 1024,
  },
} as const;

export class AvatarUploadParentAuthorizer implements UploadParentAuthorizer {
  public async authorize(request: {
    action: "create" | "confirm";
    bucket: string;
    parentId: string;
    parentType: string;
    schoolId: string;
    userId: string;
  }): Promise<boolean> {
    return request.bucket === "avatars"
      && request.parentType === "avatar"
      && request.parentId === request.userId;
  }
}

export class CompositeUploadParentAuthorizer implements UploadParentAuthorizer {
  public constructor(
    private readonly authorizers: readonly UploadParentAuthorizer[],
  ) {}

  public async authorize(request: Parameters<UploadParentAuthorizer["authorize"]>[0]): Promise<boolean> {
    for (const authorizer of this.authorizers) {
      if (await authorizer.authorize(request)) return true;
    }
    return false;
  }
}

export interface StorageObjectRemover {
  remove(bucket: string, objectPath: string): Promise<void>;
}
export interface RuntimePlatformDependencies {
  cache: CacheStore;
  close(): Promise<void>;
  database: Database;
  queue: QueueClient;
  storage: StorageService;
  recordingCleanup: QueueMessageHandler<unknown>;
  recordingStorage: RecordingStoragePort;
  storageObjectRemover: StorageObjectRemover;
  worker: QueueWorker;
}

export interface RuntimePlatformOptions {
  database?: Database;
  parentAuthorizer?: UploadParentAuthorizer;
}

export function createRuntimePlatformDependencies(
  env: Env,
  options: RuntimePlatformOptions = {},
): RuntimePlatformDependencies {
  const ownedDatabase =
    options.database === undefined ? createDatabase(env) : undefined;
  const db = options.database ?? ownedDatabase!.db;
  const redis =
    env.REDIS_URL === undefined
      ? undefined
      : new Redis(env.REDIS_URL, {
          enableOfflineQueue: false,
          lazyConnect: true,
          maxRetriesPerRequest: 1,
        });
  const storageClient = createClient(
    env.SUPABASE_URL,
    env.SUPABASE_SECRET_KEY,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
  const queue = new PgmqQueueClient(db);
  const recordingMediaInspector = new RecordingMediaInspector({
    commandRunner: new NodeCommandRunner(),
    createSignedReadUrl: async (
      bucket,
      objectPath,
      expiresInSeconds,
    ): Promise<string> => {
      const { data, error } = await storageClient.storage
        .from(bucket)
        .createSignedUrl(objectPath, expiresInSeconds);
      if (error !== null || data === null) {
        throw (
          error ??
          new Error(
            "Supabase Storage did not return a signed recording inspection URL",
          )
        );
      }
      return data.signedUrl;
    },
    ffprobePath: env.FFPROBE_PATH,
  });
  const recordingStorage = new SupabaseRecordingStorageAdapter({
    inspector: recordingMediaInspector,
    storage: storageClient.storage,
    tusEndpoint: createSupabaseSignedTusEndpoint(env.SUPABASE_URL),
  });
  const recordingCleanup = new RecordingStorageCleanupHandler(
    new DatabaseRecordingCleanupStore(db),
    new SupabaseRecordingObjectDeleter(storageClient),
  );

  const storageObjectRemover: StorageObjectRemover = {
    async remove(bucket, objectPath): Promise<void> {
      const { error } = await storageClient.storage
        .from(bucket)
        .remove([objectPath]);
      if (error !== null) throw error;
    },
  };

  return {
    cache:
      redis === undefined ? new NoopCacheStore() : new RedisCacheStore(redis),
    close: async (): Promise<void> => {
      if (redis !== undefined) {
        redis.disconnect(false);
      }
      if (ownedDatabase !== undefined) {
        await ownedDatabase.client.end({ timeout: 5 });
      }
    },
    database: db,
    recordingCleanup: (message) =>
      recordingCleanup.handle({ schoolId: message.schoolId }),
    recordingStorage,
    queue,
    storage: new StorageService(
      new SupabaseUploadUrlSigner(storageClient),
      new DatabaseUploadSessionStore(db),
      runtimeUploadBuckets,
      options.parentAuthorizer ?? new AvatarUploadParentAuthorizer(),
      new SupabaseStorageObjectMetadataInspector(storageClient),
      new SupabaseStorageObjectRemover(storageClient),
    ),
    storageObjectRemover,
    worker: new QueueWorker(
      queue,
      new DatabaseProcessedQueueEventStore(db),
      new DatabaseDeadLetterQueueStore(db),
    ),
  };
}

export function createStorageCleanupHandler(
  database: Database | Pick<StorageService, "cleanupExpiredPendingSessions">,
  remover?: StorageObjectRemover,
): QueueMessageHandler<unknown> {
  if (remover === undefined) {
    const legacyStorage = database as Pick<StorageService, "cleanupExpiredPendingSessions">;
    return async (message): Promise<void> => {
      await legacyStorage.cleanupExpiredPendingSessions(message.schoolId);
    };
  }
  const cleanupDatabase = database as Database;
  return async (message): Promise<void> => {
    const candidates = await cleanupDatabase.execute(sql<{
      bucket: string;
      event_resource_id: string | null;
      object_path: string;
      upload_session_id: string | null;
    }>`
      select distinct bucket, object_path, upload_session_id, event_resource_id
      from (
        select bucket, object_path, id::text as upload_session_id,
          null::text as event_resource_id
        from public.upload_sessions
        where school_id = ${message.schoolId}::uuid
          and status = 'pending'
          and expires_at <= now()
          and not exists (
            select 1 from public.announcement_resources resource
            where resource.upload_session_id = upload_sessions.id
            union all
            select 1 from public.assignment_resources resource
            where resource.upload_session_id = upload_sessions.id
            union all
            select 1 from public.assignment_submissions submission
            where submission.upload_session_id = upload_sessions.id
            union all
            select 1 from public.exam_resources resource
            where resource.upload_session_id = upload_sessions.id
            union all
            select 1 from public.recording_resources resource
            where resource.upload_session_id = upload_sessions.id
            union all
            select 1 from public.event_resources resource
            where resource.upload_session_id = upload_sessions.id
              and resource.confirmed_at is not null
          )
        union
        select 'academic-files'::text as bucket, resource.object_path,
          null::text as upload_session_id, null::text as event_resource_id
        from public.assignment_resources resource
        inner join public.assignments assignment
          on assignment.id = resource.assignment_id
          and assignment.school_id = resource.school_id
        where resource.school_id = ${message.schoolId}::uuid
          and assignment.deleted_at is not null
        union
        select 'academic-files'::text as bucket, submission.object_path,
          null::text as upload_session_id, null::text as event_resource_id
        from public.assignment_submissions submission
        inner join public.assignments assignment
          on assignment.id = submission.assignment_id
          and assignment.school_id = submission.school_id
        where submission.school_id = ${message.schoolId}::uuid
          and assignment.deleted_at is not null
          and submission.object_path is not null
        union
        select 'academic-files'::text as bucket, resource.object_path,
          null::text as upload_session_id, null::text as event_resource_id
        from public.exam_resources resource
        inner join public.class_exams exam
          on exam.id = resource.assessment_id
          and exam.school_id = resource.school_id
        where resource.school_id = ${message.schoolId}::uuid
          and exam.deleted_at is not null
        union
        select 'academic-files'::text as bucket, resource.object_path,
          null::text as upload_session_id, resource.id::text as event_resource_id
        from public.event_resources resource
        inner join public.events event
          on event.id = resource.event_id
          and event.school_id = resource.school_id
        where resource.school_id = ${message.schoolId}::uuid
          and event.deleted_at is not null
      ) cleanup_objects
      where upload_session_id is not null
        or event_resource_id is not null
        or not exists (
          select 1
          from public.academic_storage_cleanup_objects cleaned
          where cleaned.school_id = ${message.schoolId}::uuid
            and cleaned.bucket = cleanup_objects.bucket
            and cleaned.object_path = cleanup_objects.object_path
        )
      order by bucket, object_path, upload_session_id nulls last
      limit 500
    `);
    const handledSessionIds: string[] = [];
    for (const row of candidates as unknown as ReadonlyArray<{
      bucket: string;
      event_resource_id: string | null;
      object_path: string;
      upload_session_id: string | null;
    }>) {
      try {
        await remover.remove(row.bucket, row.object_path);
      } catch (error) {
        if (!isStorageObjectNotFound(error)) throw error;
      }
      if (row.event_resource_id !== null && row.event_resource_id !== undefined) {
        await cleanupDatabase.execute(sql`
          delete from public.event_resources resource
          using public.events event
          where resource.id = ${row.event_resource_id}::uuid
            and resource.school_id = ${message.schoolId}::uuid
            and event.id = resource.event_id
            and event.school_id = resource.school_id
            and event.deleted_at is not null
        `);
        continue;
      }
      if (row.upload_session_id === null) {
        await cleanupDatabase.execute(sql`
          insert into public.academic_storage_cleanup_objects (school_id, bucket, object_path)
          values (${message.schoolId}::uuid, ${row.bucket}, ${row.object_path})
          on conflict (school_id, bucket, object_path) do nothing
        `);
      } else {
        handledSessionIds.push(row.upload_session_id);
      }
    }
    if (handledSessionIds.length === 0) return;
    await cleanupDatabase.execute(sql`
      delete from public.upload_sessions
      where school_id = ${message.schoolId}::uuid
        and id in (${sql.join(
          handledSessionIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})
        and status = 'pending'
        and expires_at <= now()
    `);
  };
}
export type StorageCleanupKind = "legacy" | "recordings";

function cleanupPayloadKind(
  payload: unknown,
  schoolId: string,
): StorageCleanupKind | undefined {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Storage cleanup payload must be an object");
  }
  const record = payload as { kind?: unknown; schoolId?: unknown };
  if (record.schoolId !== schoolId) {
    throw new Error(
      "Storage cleanup payload schoolId does not match its envelope",
    );
  }
  if (record.kind === undefined) return undefined;
  if (record.kind !== "legacy" && record.kind !== "recordings") {
    throw new Error("Storage cleanup payload kind is not supported");
  }
  return record.kind;
}

/**
 * Older scheduled jobs emit an untyped cleanup payload, so they run both safe
 * handlers. New domain-discriminated messages are sent to exactly one handler.
 */
export function createStorageCleanupDispatcher(handlers: {
  legacy: QueueMessageHandler<unknown>;
  recordings: QueueMessageHandler<unknown>;
}): QueueMessageHandler<unknown> {
  return async (message, context): Promise<void> => {
    const kind = cleanupPayloadKind(message.payload, message.schoolId);
    if (kind === "legacy") {
      await handlers.legacy(message, context);
      return;
    }
    if (kind === "recordings") {
      await handlers.recordings(message, context);
      return;
    }
    await handlers.legacy(message, context);
    await handlers.recordings(message, context);
  };
}

function isStorageObjectNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as {
    code?: string;
    message?: string;
    status?: number;
    statusCode?: number;
  };
  return (
    candidate.status === 404 ||
    candidate.statusCode === 404 ||
    candidate.code === "404" ||
    /object not found/i.test(candidate.message ?? "")
  );
}
