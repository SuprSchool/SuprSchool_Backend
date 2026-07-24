import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import { sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import {
  assertObjectPath,
  type CreatedUploadSession,
  type UploadSession,
  type UploadSessionRequest,
} from './upload-session.js';

export const SIGNED_UPLOAD_URL_LIFETIME_SECONDS = 7_200;
export const SIGNED_DOWNLOAD_URL_LIFETIME_SECONDS = 900;

export interface UploadSessionIdentity {
  schoolId: string;
  userId: string;
}

export interface UploadBucketPolicy {
  allowedContentTypes: ReadonlyArray<string>;
  maxSizeBytes: number;
}

export interface UploadUrlSigner {
  createSignedUploadUrl(bucket: string, objectPath: string): Promise<string>;
  createSignedReadUrl(bucket: string, objectPath: string, expiresInSeconds: number): Promise<string>;
  createSignedDownloadUrl?(bucket: string, objectPath: string, expiresInSeconds: number): Promise<string>;
}

export interface UploadParentAuthorizer {
  authorize(request: { action: 'create' | 'confirm'; bucket: string; parentId: string; parentType: string; schoolId: string; userId: string }): Promise<boolean>;
}

export interface StorageObjectMetadataInspector {
  inspect(bucket: string, objectPath: string): Promise<{ bucket: string; contentType: string; objectPath: string; sizeBytes: number } | undefined>;
}

export interface StorageObjectRemover {
  remove(bucket: string, objectPaths: readonly string[]): Promise<void>;
}

export interface UploadSessionRecord extends UploadSession {
  bucket: string;
  confirmedSessionId: string | null;
  contentType: string;
  displayName: string | null;
  parentId: string;
  parentType: string;
  schoolId: string;
  sizeBytes: number;
  status: 'pending' | 'confirmed' | 'superseded';
  userId: string;
}

export interface UploadSessionStore {
  confirm(
    schoolId: string,
    userId: string,
    id: string,
    confirmedSessionId: string,
  ): Promise<UploadSessionRecord | undefined>;
  create(session: UploadSessionRecord): Promise<void>;
  deleteExpiredPending(schoolId: string, userId: string, id: string): Promise<boolean>;
  find(schoolId: string, userId: string, id: string): Promise<UploadSessionRecord | undefined>;
  findExpiredPending(schoolId: string, limit: number): Promise<ReadonlyArray<UploadSessionRecord>>;
}

export class UploadSessionNotFoundError extends Error {
  public constructor(id: string) {
    super(`Upload session ${id} was not found`);
    this.name = 'UploadSessionNotFoundError';
  }
}

export class UploadSessionExpiredError extends Error {
  public constructor(id: string) {
    super(`Upload session ${id} has expired`);
    this.name = 'UploadSessionExpiredError';
  }
}

export class UploadSessionIneligibleError extends Error {
  public constructor(id: string) {
    super(`Upload session ${id} is not eligible for confirmation`);
    this.name = 'UploadSessionIneligibleError';
  }
}

export class UploadParentAuthorizationError extends Error {
  public constructor() { super('Upload parent is not authorized'); this.name = 'UploadParentAuthorizationError'; }
}

export class UploadObjectMetadataMismatchError extends Error {
  public constructor() { super('Storage object metadata does not match the upload session'); this.name = 'UploadObjectMetadataMismatchError'; }
}

export class StorageService {
  public constructor(
    private readonly signer: UploadUrlSigner,
    private readonly sessions: UploadSessionStore,
    private readonly buckets: Readonly<Record<string, UploadBucketPolicy>>,
    private readonly authorizer: UploadParentAuthorizer,
    private readonly metadataInspector: StorageObjectMetadataInspector,
    private readonly objectRemover: StorageObjectRemover | undefined = undefined,
    private readonly createId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async deleteObjectIfExists(bucket: string, objectPath: string): Promise<boolean> {
    const metadata = await this.metadataInspector.inspect(bucket, objectPath);
    if (metadata === undefined) {
      return false;
    }
    if (this.objectRemover === undefined) {
      throw new Error('Storage object removal is not configured');
    }
    await this.objectRemover.remove(bucket, [objectPath]);
    return true;
  }

  public async cleanupExpiredPendingSessions(
    schoolId: string,
    limit = 500,
  ): Promise<number> {
    const sessions = await this.sessions.findExpiredPending(schoolId, limit);
    for (const session of sessions) {
      await this.deleteObjectIfExists(session.bucket, session.objectPath);
      await this.sessions.deleteExpiredPending(session.schoolId, session.userId, session.id);
    }
    return sessions.length;
  }

  public async createUploadSession(
    identity: UploadSessionIdentity,
    request: UploadSessionRequest,
  ): Promise<CreatedUploadSession> {
    const policy = this.buckets[request.bucket];
    if (policy === undefined) {
      throw new RangeError('Storage bucket is not allowed');
    }
    if (!policy.allowedContentTypes.includes(request.contentType)) {
      throw new RangeError('Storage MIME type is not allowed');
    }
    if (
      !Number.isSafeInteger(request.sizeBytes) ||
      request.sizeBytes <= 0 ||
      request.sizeBytes > policy.maxSizeBytes
    ) {
      throw new RangeError('Storage object size exceeds the allowed limit');
    }
    assertStorageSegment(request.parentType, 'parentType');
    assertStorageSegment(request.parentId, 'parentId');

    if (!await this.authorizer.authorize({ action: 'create', bucket: request.bucket, parentId: request.parentId, parentType: request.parentType, schoolId: identity.schoolId, userId: identity.userId })) {
      throw new UploadParentAuthorizationError();
    }
    const id = this.createId();
    const objectPath = `${identity.schoolId}/${request.parentType}/${request.parentId}/${id}`;
    assertObjectPath(identity.schoolId, objectPath);
    const expiresAt = new Date(
      this.now().getTime() + SIGNED_UPLOAD_URL_LIFETIME_SECONDS * 1_000,
    ).toISOString();
    const signedUploadUrl = await this.signer.createSignedUploadUrl(request.bucket, objectPath);
    await this.sessions.create({
      bucket: request.bucket,
      confirmedSessionId: null,
      contentType: request.contentType,
      displayName: request.displayName ?? null,
      expiresAt,
      id,
      objectPath,
      parentId: request.parentId,
      parentType: request.parentType,
      schoolId: identity.schoolId,
      sizeBytes: request.sizeBytes,
      status: 'pending',
      userId: identity.userId,
    });

    return { expiresAt, id, objectPath, signedUploadUrl };
  }


  public async assertUploadReady(
    identity: UploadSessionIdentity,
    id: string,
  ): Promise<UploadSessionRecord> {
    return this.prepareUpload(identity, id);
  }

  public async confirmUpload(
    identity: UploadSessionIdentity,
    id: string,
  ): Promise<UploadSessionRecord> {
    const existing = await this.assertUploadReady(identity, id);
    if (existing.status === 'confirmed') return existing;
    const confirmed = await this.sessions.confirm(identity.schoolId, identity.userId, id, id);
    if (confirmed?.status === 'confirmed') return confirmed;
    if (confirmed !== undefined && Date.parse(confirmed.expiresAt) <= this.now().getTime()) {
      throw new UploadSessionExpiredError(id);
    }
    throw new UploadSessionIneligibleError(id);
  }
  public async createSignedReadUrl(
    bucket: string,
    objectPath: string,
    expiresInSeconds: number,
  ): Promise<string> {
    if (this.buckets[bucket] === undefined) {
      throw new RangeError('Storage bucket is not allowed');
    }
    if (!Number.isInteger(expiresInSeconds) || expiresInSeconds <= 0) {
      throw new RangeError('Signed read URL lifetime must be a positive integer');
    }
    return this.signer.createSignedReadUrl(bucket, objectPath, expiresInSeconds);
  }

  public async createSignedDownloadUrl(
    bucket: string,
    objectPath: string,
  ): Promise<string> {
    return this.createSignedReadUrl(
      bucket,
      objectPath,
      SIGNED_DOWNLOAD_URL_LIFETIME_SECONDS,
    );
  }
  public async prepareUpload(
    identity: UploadSessionIdentity,
    id: string,
  ): Promise<UploadSessionRecord> {
    const existing = await this.sessions.find(identity.schoolId, identity.userId, id);
    if (existing === undefined) {
      throw new UploadSessionNotFoundError(id);
    }
    if (existing.status === 'confirmed') {
      return existing;
    }
    if (existing.status === 'superseded') {
      throw new UploadSessionIneligibleError(id);
    }
    if (Date.parse(existing.expiresAt) <= this.now().getTime()) {
      throw new UploadSessionExpiredError(id);
    }

    if (!await this.authorizer.authorize({ action: 'confirm', bucket: existing.bucket, parentId: existing.parentId, parentType: existing.parentType, schoolId: identity.schoolId, userId: identity.userId })) {
      throw new UploadParentAuthorizationError();
    }
    const metadata = await this.metadataInspector.inspect(existing.bucket, existing.objectPath);
    if (metadata === undefined || metadata.bucket !== existing.bucket || metadata.objectPath !== existing.objectPath || metadata.contentType !== existing.contentType || metadata.sizeBytes !== existing.sizeBytes) {
      throw new UploadObjectMetadataMismatchError();
    }
    return existing;
  }
}
export class SupabaseUploadUrlSigner implements UploadUrlSigner {
  public constructor(private readonly supabase: SupabaseClient) {}

  public async createSignedUploadUrl(bucket: string, objectPath: string): Promise<string> {
    const { data, error } = await this.supabase.storage.from(bucket).createSignedUploadUrl(objectPath);
    if (error !== null) {
      throw error;
    }
    if (data === null) {
      throw new Error('Supabase Storage did not return a signed upload URL');
    }
    return data.signedUrl;
  }

  public async createSignedReadUrl(
    bucket: string,
    objectPath: string,
    expiresInSeconds: number,
  ): Promise<string> {
    const { data, error } = await this.supabase.storage.from(bucket).createSignedUrl(objectPath, expiresInSeconds);
    if (error !== null) throw error;
    if (data === null) throw new Error('Supabase Storage did not return a signed read URL');
    return data.signedUrl;
  }

  public async createSignedDownloadUrl(
    bucket: string,
    objectPath: string,
    expiresInSeconds: number,
  ): Promise<string> {
    return this.createSignedReadUrl(bucket, objectPath, expiresInSeconds);
  }
}
export class SupabaseStorageObjectRemover implements StorageObjectRemover {
  public constructor(private readonly supabase: SupabaseClient) {}

  public async remove(bucket: string, objectPaths: readonly string[]): Promise<void> {
    const { error } = await this.supabase.storage.from(bucket).remove([...objectPaths]);
    if (error !== null) {
      throw error;
    }
  }
}

export class DatabaseUploadSessionStore implements UploadSessionStore {
  public constructor(private readonly db: Database) {}

  public async create(session: UploadSessionRecord): Promise<void> {
    await this.db.execute(sql`
      insert into public.upload_sessions (
        id,
        school_id,
        user_id,
        bucket,
        parent_type,
        parent_id,
        object_path,
        content_type,
        display_name,
        size_bytes,
        status,
        expires_at
      )
      values (
        ${session.id}::uuid,
        ${session.schoolId}::uuid,
        ${session.userId}::uuid,
        ${session.bucket},
        ${session.parentType},
        ${session.parentId},
        ${session.objectPath},
        ${session.contentType},
        ${session.displayName},
        ${session.sizeBytes},
        'pending',
        ${session.expiresAt}::timestamptz
      )
    `);
  }

  public async deleteExpiredPending(
    schoolId: string,
    userId: string,
    id: string,
  ): Promise<boolean> {
    const rows = await this.db.execute(sql<{ id: string }>`
      delete from public.upload_sessions
      where id = ${id}::uuid
        and school_id = ${schoolId}::uuid
        and user_id = ${userId}::uuid
        and status = 'pending'
        and expires_at <= now()
      returning id
    `);
    return (rows as unknown as ReadonlyArray<{ id: string }>).length > 0;
  }

  public async find(
    schoolId: string,
    userId: string,
    id: string,
  ): Promise<UploadSessionRecord | undefined> {
    const rows = await this.db.execute(sql<UploadSessionRow>`
      select
        id,
        school_id,
        user_id,
        bucket,
        parent_type,
        parent_id,
        object_path,
        content_type,
        display_name,
        size_bytes,
        status,
        expires_at,
        confirmed_session_id
      from public.upload_sessions
      where id = ${id}::uuid
        and school_id = ${schoolId}::uuid
        and user_id = ${userId}::uuid
    `);
    const row = (rows as unknown as ReadonlyArray<UploadSessionRow>)[0];
    return row === undefined ? undefined : toUploadSessionRecord(row);
  }

  public async findExpiredPending(
    schoolId: string,
    limit: number,
  ): Promise<ReadonlyArray<UploadSessionRecord>> {
    const rows = await this.db.execute(sql<UploadSessionRow>`
      select
        id,
        school_id,
        user_id,
        bucket,
        parent_type,
        parent_id,
        object_path,
        content_type,
        size_bytes,
        status,
        expires_at,
        confirmed_session_id
      from public.upload_sessions
      where school_id = ${schoolId}::uuid
        and status = 'pending'
        and expires_at <= now()
      order by expires_at
      limit ${limit}
    `);
    return (rows as unknown as ReadonlyArray<UploadSessionRow>).map(toUploadSessionRecord);
  }

  public async confirm(
    schoolId: string,
    userId: string,
    id: string,
    confirmedSessionId: string,
  ): Promise<UploadSessionRecord | undefined> {
    const rows = await this.db.execute(sql<UploadSessionRow>`
      update public.upload_sessions
      set status = 'confirmed',
          confirmed_session_id = ${confirmedSessionId}::uuid,
          confirmed_at = now()
      where id = ${id}::uuid
        and school_id = ${schoolId}::uuid
        and user_id = ${userId}::uuid
        and status = 'pending'
        and expires_at > now()
      returning
        id,
        school_id,
        user_id,
        bucket,
        parent_type,
        parent_id,
        object_path,
        content_type,
        display_name,
        size_bytes,
        status,
        expires_at,
        confirmed_session_id
    `);
    const row = (rows as unknown as ReadonlyArray<UploadSessionRow>)[0];
    return row === undefined ? this.find(schoolId, userId, id) : toUploadSessionRecord(row);
  }
}

interface UploadSessionRow {
  bucket: string;
  confirmed_session_id: string | null;
  content_type: string;
  display_name: string | null;
  expires_at: string;
  id: string;
  object_path: string;
  parent_id: string;
  parent_type: string;
  school_id: string;
  size_bytes: number;
  status: 'pending' | 'confirmed' | 'superseded';
  user_id: string;
}

function assertStorageSegment(value: string, field: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new RangeError(`${field} must contain only letters, numbers, underscores, or hyphens`);
  }
}

function toUploadSessionRecord(row: UploadSessionRow): UploadSessionRecord {
  return {
    bucket: row.bucket,
    confirmedSessionId: row.confirmed_session_id,
    contentType: row.content_type,
    displayName: row.display_name,
    expiresAt: row.expires_at,
    id: row.id,
    objectPath: row.object_path,
    parentId: row.parent_id,
    parentType: row.parent_type,
    schoolId: row.school_id,
    sizeBytes: Number(row.size_bytes),
    status: row.status,
    userId: row.user_id,
  };
}
