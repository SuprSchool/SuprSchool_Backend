import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import type { Database } from '../client.js';
import { AppError } from '../../lib/errors.js';
import type {
  RecordingResource,
  RecordingResourceContentType,
  RecordingResourceKind,
  CreateRecordingDraftInput,
  ListRecordingsInput,
  RecordingDeletionResult,
  RecordingDetail,
  RecordingIdentity,
  RecordingListResponse,
  RecordingProgress,
  RecordingProgressResponse,
  RecordingPublicationResult,
  RecordingSummary,
  SaveRecordingProgressInput,
  TeacherRecordingListInput,
  UpdateRecordingInput,
} from '../../types/recordings.js';

export interface EditableRecording {
  id: string;
  schoolId: string;
}

export interface RecordingUploadSessionRecord {
  expectedContentType: 'audio/mp4';
  expectedDurationMs: number;
  expectedObjectPath: string;
  expectedSizeBytes: number;
  id: string;
  recordingId: string;
  status: 'confirmed' | 'pending' | 'reserved' | 'superseded';
}

export interface RecordingPlaybackTarget {
  objectPath: string;
}

export interface RecordingPlaybackSession {
  id: string;
  issuedAt: string;
}

export interface ReserveRecordingUploadSessionInput {
  expectedContentType: 'audio/mp4';
  expectedDurationMs: number;
  expectedSizeBytes: number;
  objectPath: string;
  recordingId: string;
  reservationExpiresAt: string;
  uploadSessionId: string;
}

export interface ActivateRecordingUploadSessionInput {
  expiresAt: string;
  recordingId: string;
  uploadSessionId: string;
}

export interface ConfirmRecordingUploadInput {
  bitrateBps: 96000;
  channels: 1;
  codec: 'aac-lc';
  contentType: 'audio/mp4';
  durationMs: number;
  objectPath: string;
  recordingId: string;
  sizeBytes: number;
  uploadSessionId: string;
}

export interface ConfirmRecordingResourceInput {
  contentType: RecordingResourceContentType;
  displayName: string;
  kind: RecordingResourceKind;
  objectPath: string;
  recordingId: string;
  sizeBytes: number;
  uploadSessionId: string;
}

export interface StoredRecordingResource extends RecordingResource {
  objectPath: string;
}

export interface RecordingRepository {
  confirmResourceUpload(identity: RecordingIdentity, input: ConfirmRecordingResourceInput): Promise<RecordingResource>;
  confirmUpload(identity: RecordingIdentity, input: ConfirmRecordingUploadInput): Promise<'confirmed' | 'already_confirmed'>;
  createDraft(identity: RecordingIdentity, input: CreateRecordingDraftInput): Promise<RecordingSummary>;
  deleteRecording(identity: RecordingIdentity, recordingId: string): Promise<RecordingDeletionResult>;
  deleteResource(identity: RecordingIdentity, recordingId: string, resourceId: string): Promise<{ id: string } | undefined>;
  findEditableRecording(identity: RecordingIdentity, recordingId: string): Promise<EditableRecording | undefined>;
  findResourceEditableRecording(identity: RecordingIdentity, recordingId: string): Promise<EditableRecording | undefined>;
  findResourceForUpload(identity: RecordingIdentity, recordingId: string, uploadSessionId: string): Promise<RecordingResource | undefined>;
  findUploadSession(identity: RecordingIdentity, recordingId: string, uploadSessionId: string): Promise<RecordingUploadSessionRecord | undefined>;
  getPlaybackTarget(identity: RecordingIdentity, recordingId: string): Promise<RecordingPlaybackTarget | undefined>;
  issuePlaybackSession(identity: RecordingIdentity, recordingId: string, expiresAt: string): Promise<RecordingPlaybackSession | undefined>;
  getProgress(identity: RecordingIdentity, recordingId: string): Promise<RecordingProgress | undefined>;
  getStudentRecording(identity: RecordingIdentity, recordingId: string): Promise<RecordingDetail | undefined>;
  getTeacherRecording(identity: RecordingIdentity, recordingId: string): Promise<RecordingDetail | undefined>;
  getTeacherPlaybackTarget(identity: RecordingIdentity, recordingId: string): Promise<RecordingPlaybackTarget | undefined>;
  listStudentResources(identity: RecordingIdentity, recordingId: string): Promise<StoredRecordingResource[]>;
  listTeacherResources(identity: RecordingIdentity, recordingId: string): Promise<StoredRecordingResource[]>;
  listStudentRecordings(identity: RecordingIdentity, input: ListRecordingsInput): Promise<RecordingListResponse>;
  listTeacherRecordings(identity: RecordingIdentity, input: TeacherRecordingListInput): Promise<RecordingListResponse>;
  publishRecording(identity: RecordingIdentity, recordingId: string): Promise<RecordingPublicationResult>;
  reserveUploadSession(identity: RecordingIdentity, input: ReserveRecordingUploadSessionInput): Promise<void>;
  activateUploadSession(identity: RecordingIdentity, input: ActivateRecordingUploadSessionInput): Promise<void>;
  releaseUploadReservation(identity: RecordingIdentity, recordingId: string, uploadSessionId: string): Promise<void>;
  rejectUploadSession(identity: RecordingIdentity, recordingId: string, uploadSessionId: string): Promise<void>;
  saveProgress(identity: RecordingIdentity, recordingId: string, input: SaveRecordingProgressInput): Promise<RecordingProgressResponse | undefined>;
  updateRecording(identity: RecordingIdentity, recordingId: string, input: UpdateRecordingInput): Promise<RecordingSummary>;
}

type SummaryRow = {
  classId: string;
  createdAt: Date | string;
  durationMs: number | string | null;
  id: string;
  publishedAt: Date | string | null;
  status: 'draft' | 'published';
  subjectId: string;
  title: string;
  description?: string | null;
  resourceCount?: number | string;
};

type DetailRow = SummaryRow & { description: string | null; sizeBytes: number | string | null };
type ProgressRow = { completedAt: Date | string | null; positionMs: number | string; recordingId: string; updatedAt: Date | string };
type ProgressMutationRow = {
  accepted: boolean;
  completedAt: Date | string | null;
  positionMs: number | string | null;
  recordingId: string | null;
  withinDuration: boolean;
  updatedAt: Date | string | null;
};

function rowsOf<T>(result: unknown): readonly T[] {
  return result as readonly T[];
}

function asIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return typeof value === 'string' ? value : value.toISOString();
}

function asNumber(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

function toSummary(row: SummaryRow): RecordingSummary {
  const summary: RecordingSummary = {
    classId: row.classId,
    createdAt: asIso(row.createdAt)!,
    durationMs: asNumber(row.durationMs),
    id: row.id,
    publishedAt: asIso(row.publishedAt),
    status: row.status,
    subjectId: row.subjectId,
    title: row.title,
  };
  if (row.description !== undefined) summary.description = row.description;
  if (row.resourceCount !== undefined) summary.resourceCount = Number(row.resourceCount);
  return summary;
}

function toDetail(row: DetailRow): RecordingDetail {
  return { ...toSummary(row), description: row.description, sizeBytes: asNumber(row.sizeBytes) };
}

function toProgress(row: ProgressRow): RecordingProgress {
  return {
    completedAt: asIso(row.completedAt),
    positionMs: Number(row.positionMs),
    recordingId: row.recordingId,
    updatedAt: asIso(row.updatedAt)!,
  };
}

function nextPage(rows: readonly SummaryRow[], limit: number): RecordingListResponse {
  const page = rows.slice(0, limit).map(toSummary);
  const tail = page.at(-1);
  return {
    items: page,
    nextCursor: rows.length > limit && tail?.publishedAt
      ? `${tail.publishedAt}|${tail.id}`
      : null,
  };
}

function nextTeacherPage(rows: readonly SummaryRow[], limit: number): RecordingListResponse {
  const page = rows.slice(0, limit).map(toSummary);
  const tail = page.at(-1);
  return {
    items: page,
    nextCursor: rows.length > limit && tail ? tail.createdAt + "|" + tail.id : null,
  };
}

/**
 * Every query below begins with school_id and joins the live role/membership
 * relation. RLS is server-only; this repository is the authorization boundary
 * for the Express service-role connection.
 */
export class DrizzleRecordingsRepository implements RecordingRepository {
  public constructor(private readonly db: Database, private readonly createId: () => string = randomUUID) {}

  public async createDraft(identity: RecordingIdentity, input: CreateRecordingDraftInput): Promise<RecordingSummary> {
    await this.assertActiveTeacher(identity);
    const rows = rowsOf<SummaryRow>(await this.db.execute(sql`
      insert into public.class_recordings (
        id, school_id, class_id, subject_id, created_by_teacher_id, title, description, status
      )
      select
        ${this.createId()}::uuid, c.school_id, c.id, cs.subject_id, ${identity.userId}::uuid,
        ${input.title}, ${input.description ?? null}, 'draft'
      from public.class_subjects cs
      join public.classes c on c.id = cs.class_id and c.school_id = cs.school_id
      join public.user_roles role on role.user_id = ${identity.userId}::uuid
        and role.school_id = c.school_id and role.role = 'teacher' and role.is_active
      where c.id = ${input.classId}::uuid
        and c.school_id = ${identity.schoolId}::uuid
        and cs.subject_id = ${input.subjectId}::uuid
        and cs.teacher_id = ${identity.userId}::uuid
      returning id, class_id as "classId", subject_id as "subjectId", title, status,
        created_at as "createdAt", published_at as "publishedAt", null::bigint as "durationMs"
    `));
    const row = rows[0];
    if (!row) throw new AppError('FORBIDDEN', 403, 'You are not assigned to this class subject');
    return toSummary(row);
  }

  public async findEditableRecording(identity: RecordingIdentity, recordingId: string): Promise<EditableRecording | undefined> {
    await this.assertActiveTeacher(identity);
    const rows = rowsOf<EditableRecording>(await this.db.execute(sql`
      select cr.id, cr.school_id as "schoolId"
      from public.class_recordings cr
      join public.class_subjects cs on cs.class_id = cr.class_id and cs.subject_id = cr.subject_id
        and cs.school_id = cr.school_id
      join public.user_roles role on role.user_id = ${identity.userId}::uuid
        and role.school_id = cr.school_id and role.role = 'teacher' and role.is_active
      where cr.id = ${recordingId}::uuid
        and cr.school_id = ${identity.schoolId}::uuid
        and cr.status = 'draft'
        and cs.teacher_id = ${identity.userId}::uuid
      limit 1
    `));
    return rows[0];
  }

  public async findResourceEditableRecording(identity: RecordingIdentity, recordingId: string): Promise<EditableRecording | undefined> {
    await this.assertActiveTeacher(identity);
    const rows = rowsOf<EditableRecording>(await this.db.execute(sql`
      select cr.id, cr.school_id as "schoolId"
      from public.class_recordings cr
      join public.class_subjects cs on cs.class_id = cr.class_id and cs.subject_id = cr.subject_id
        and cs.school_id = cr.school_id
      join public.user_roles role on role.user_id = ${identity.userId}::uuid
        and role.school_id = cr.school_id and role.role = 'teacher' and role.is_active
      where cr.id = ${recordingId}::uuid
        and cr.school_id = ${identity.schoolId}::uuid
        and cr.status <> 'deleted'
        and cs.teacher_id = ${identity.userId}::uuid
      limit 1
    `));
    return rows[0];
  }

  public async findResourceForUpload(
    identity: RecordingIdentity,
    recordingId: string,
    uploadSessionId: string,
  ): Promise<RecordingResource | undefined> {
    const rows = rowsOf<RecordingResource>(await this.db.execute(sql`
      select resource.id, resource.kind, resource.display_name as name,
        resource.content_type as "contentType", resource.size_bytes as "sizeBytes",
        resource.sort_order as "sortOrder"
      from public.recording_resources resource
      join public.class_recordings cr on cr.id = resource.recording_id
        and cr.school_id = resource.school_id and cr.status <> 'deleted'
      join public.class_subjects subject on subject.class_id = cr.class_id
        and subject.subject_id = cr.subject_id and subject.school_id = cr.school_id
        and subject.teacher_id = ${identity.userId}::uuid
      join public.user_roles role on role.user_id = ${identity.userId}::uuid
        and role.school_id = cr.school_id and role.role = 'teacher' and role.is_active
      where resource.school_id = ${identity.schoolId}::uuid
        and resource.recording_id = ${recordingId}::uuid
        and resource.upload_session_id = ${uploadSessionId}::uuid
      limit 1
    `));
    const resource = rows[0];
    return resource === undefined ? undefined : {
      ...resource,
      sizeBytes: Number(resource.sizeBytes),
      sortOrder: Number(resource.sortOrder),
    };
  }

  public async confirmResourceUpload(
    identity: RecordingIdentity,
    input: ConfirmRecordingResourceInput,
  ): Promise<RecordingResource> {
    return this.db.transaction(async (transaction) => {
      const authorized = rowsOf<{ id: string }>(await transaction.execute(sql`
        select cr.id
        from public.class_recordings cr
        join public.class_subjects subject on subject.class_id = cr.class_id
          and subject.subject_id = cr.subject_id and subject.school_id = cr.school_id
          and subject.teacher_id = ${identity.userId}::uuid
        join public.user_roles role on role.user_id = ${identity.userId}::uuid
          and role.school_id = cr.school_id and role.role = 'teacher' and role.is_active
        join public.upload_sessions session on session.id = ${input.uploadSessionId}::uuid
          and session.school_id = cr.school_id and session.user_id = ${identity.userId}::uuid
          and session.bucket = 'recordings' and session.parent_id = cr.id::text
          and session.parent_type = ${input.kind === 'banner' ? 'recording-banner' : 'recording-resource'}
          and session.object_path = ${input.objectPath}
          and session.content_type = ${input.contentType}
          and session.size_bytes = ${input.sizeBytes}
          and session.display_name = ${input.displayName}
          and session.status in ('pending', 'confirmed')
        where cr.id = ${input.recordingId}::uuid
          and cr.school_id = ${identity.schoolId}::uuid and cr.status <> 'deleted'
        for update of cr
      `));
      if (!authorized[0]) {
        throw new AppError('FORBIDDEN', 403, 'This recording resource upload is not eligible for confirmation');
      }

      const existing = rowsOf<RecordingResource>(await transaction.execute(sql`
        select id, kind, display_name as name, content_type as "contentType",
          size_bytes as "sizeBytes", sort_order as "sortOrder"
        from public.recording_resources
        where school_id = ${identity.schoolId}::uuid
          and recording_id = ${input.recordingId}::uuid
          and upload_session_id = ${input.uploadSessionId}::uuid
        limit 1
      `));
      if (existing[0]) {
        return {
          ...existing[0],
          sizeBytes: Number(existing[0].sizeBytes),
          sortOrder: Number(existing[0].sortOrder),
        };
      }

      const attachmentCount = input.kind === 'attachment'
        ? rowsOf<{ count: number | string }>(await transaction.execute(sql`
            select count(*)::int as count from public.recording_resources
            where school_id = ${identity.schoolId}::uuid
              and recording_id = ${input.recordingId}::uuid and kind = 'attachment'
          `))
        : [];
      if (Number(attachmentCount[0]?.count ?? 0) >= 10) {
        throw new AppError('VALIDATION_ERROR', 400, 'A recording can have at most 10 attachments');
      }

      const replaced = input.kind === 'banner'
        ? rowsOf<{ objectPath: string }>(await transaction.execute(sql`
            delete from public.recording_resources
            where school_id = ${identity.schoolId}::uuid
              and recording_id = ${input.recordingId}::uuid and kind = 'banner'
            returning object_path as "objectPath"
          `))
        : [];
      for (const resource of replaced) {
        await transaction.execute(sql`
          insert into public.recording_cleanup_intents (school_id, recording_id, object_path, reason)
          values (${identity.schoolId}::uuid, ${input.recordingId}::uuid, ${resource.objectPath}, 'replaced')
          on conflict (object_path) do nothing
        `);
      }

      const sortOrder = input.kind === 'banner' ? 0 : Number(attachmentCount[0]?.count ?? 0);
      const inserted = rowsOf<RecordingResource>(await transaction.execute(sql`
        insert into public.recording_resources (
          id, school_id, recording_id, upload_session_id, kind, display_name,
          object_path, content_type, size_bytes, sort_order
        ) values (
          ${this.createId()}::uuid, ${identity.schoolId}::uuid, ${input.recordingId}::uuid,
          ${input.uploadSessionId}::uuid, ${input.kind}, ${input.displayName},
          ${input.objectPath}, ${input.contentType}, ${input.sizeBytes}, ${sortOrder}
        )
        returning id, kind, display_name as name, content_type as "contentType",
          size_bytes as "sizeBytes", sort_order as "sortOrder"
      `));
      const resource = inserted[0];
      if (!resource) throw new AppError('INTERNAL_ERROR', 500, 'Recording resource could not be saved');
      return { ...resource, sizeBytes: Number(resource.sizeBytes), sortOrder: Number(resource.sortOrder) };
    });
  }

  public async reserveUploadSession(identity: RecordingIdentity, input: ReserveRecordingUploadSessionInput): Promise<void> {
    await this.assertActiveTeacher(identity);
    await this.db.transaction(async (transaction) => {
      await transaction.execute(sql`
        select id from public.user_profiles
        where id = ${identity.userId}::uuid and school_id = ${identity.schoolId}::uuid
        for update
      `);
      const editable = rowsOf<{ id: string }>(await transaction.execute(sql`
        select cr.id
        from public.class_recordings cr
        join public.class_subjects cs on cs.class_id = cr.class_id and cs.subject_id = cr.subject_id
          and cs.school_id = cr.school_id
        join public.user_roles role on role.user_id = ${identity.userId}::uuid
          and role.school_id = cr.school_id and role.role = 'teacher' and role.is_active
        where cr.id = ${input.recordingId}::uuid and cr.school_id = ${identity.schoolId}::uuid
          and cr.status = 'draft' and cs.teacher_id = ${identity.userId}::uuid
        for update
      `));
      if (!editable[0]) throw new AppError('FORBIDDEN', 403, 'You cannot upload audio for this recording');

      const superseded = rowsOf<{ objectPath: string }>(await transaction.execute(sql`
        update public.recording_upload_sessions
        set status = 'superseded'
        where school_id = ${identity.schoolId}::uuid and recording_id = ${input.recordingId}::uuid
          and teacher_id = ${identity.userId}::uuid and status in ('reserved', 'pending')
        returning object_path as "objectPath"
      `));
      for (const session of superseded) {
        await transaction.execute(sql`
          insert into public.recording_cleanup_intents (school_id, recording_id, object_path, reason)
          values (${identity.schoolId}::uuid, ${input.recordingId}::uuid, ${session.objectPath}, 'superseded')
          on conflict (object_path) do nothing
        `);
      }
      const pending = rowsOf<{ count: string }>(await transaction.execute(sql`
        select count(*)::text as count
        from public.recording_upload_sessions
        where school_id = ${identity.schoolId}::uuid and teacher_id = ${identity.userId}::uuid
          and status in ('reserved', 'pending') and expires_at > now()
      `));
      if (Number(pending[0]?.count ?? '0') >= 2) {
        throw new AppError('RATE_LIMITED', 429, 'Only two audio uploads can be active at once');
      }
      await transaction.execute(sql`
        insert into public.recording_upload_sessions (
          id, school_id, recording_id, teacher_id, object_path, expected_content_type,
          expected_size_bytes, expected_duration_ms, status, expires_at
        ) values (
          ${input.uploadSessionId}::uuid, ${identity.schoolId}::uuid, ${input.recordingId}::uuid,
          ${identity.userId}::uuid, ${input.objectPath}, ${input.expectedContentType},
          ${input.expectedSizeBytes}, ${input.expectedDurationMs}, 'reserved', ${input.reservationExpiresAt}::timestamptz
        )
      `);
    });
  }

  public async activateUploadSession(
    identity: RecordingIdentity,
    input: ActivateRecordingUploadSessionInput,
  ): Promise<void> {
    await this.db.transaction(async (transaction) => {
      const reserved = rowsOf<{ id: string }>(await transaction.execute(sql`
        select rus.id
        from public.recording_upload_sessions rus
        join public.class_recordings cr on cr.id = rus.recording_id and cr.school_id = rus.school_id
        join public.class_subjects cs on cs.class_id = cr.class_id and cs.subject_id = cr.subject_id
          and cs.school_id = cr.school_id
        join public.user_roles role on role.user_id = ${identity.userId}::uuid
          and role.school_id = cr.school_id and role.role = 'teacher' and role.is_active
        where rus.id = ${input.uploadSessionId}::uuid and rus.recording_id = ${input.recordingId}::uuid
          and rus.school_id = ${identity.schoolId}::uuid and rus.teacher_id = ${identity.userId}::uuid
          and rus.status = 'reserved' and rus.expires_at > now() and cr.status = 'draft'
          and cs.teacher_id = ${identity.userId}::uuid
        for update
      `));
      if (!reserved[0]) throw new AppError('FORBIDDEN', 403, 'This upload reservation is no longer available');

      const activated = rowsOf<{ id: string }>(await transaction.execute(sql`
        update public.recording_upload_sessions
        set status = 'pending', expires_at = ${input.expiresAt}::timestamptz
        where id = ${input.uploadSessionId}::uuid and ${input.expiresAt}::timestamptz > now()
        returning id
      `));
      if (!activated[0]) throw new AppError('VALIDATION_ERROR', 400, 'The upload session expired before it was activated');
    });
  }

  public async releaseUploadReservation(
    identity: RecordingIdentity,
    recordingId: string,
    uploadSessionId: string,
  ): Promise<void> {
    await this.db.transaction(async (transaction) => {
      const released = rowsOf<{ objectPath: string }>(await transaction.execute(sql`
        update public.recording_upload_sessions rus
        set status = 'superseded'
        where rus.id = ${uploadSessionId}::uuid and rus.recording_id = ${recordingId}::uuid
          and rus.school_id = ${identity.schoolId}::uuid and rus.teacher_id = ${identity.userId}::uuid
          and rus.status = 'reserved'
        returning rus.object_path as "objectPath"
      `));
      for (const session of released) {
        await transaction.execute(sql`
          insert into public.recording_cleanup_intents (school_id, recording_id, object_path, reason)
          values (${identity.schoolId}::uuid, ${recordingId}::uuid, ${session.objectPath}, 'provision_failed')
          on conflict (object_path) do nothing
        `);
      }
    });
  }

  public async rejectUploadSession(
    identity: RecordingIdentity,
    recordingId: string,
    uploadSessionId: string,
  ): Promise<void> {
    await this.db.transaction(async (transaction) => {
      const rejected = rowsOf<{ objectPath: string }>(await transaction.execute(sql`
        update public.recording_upload_sessions rus
        set status = 'superseded'
        where rus.id = ${uploadSessionId}::uuid and rus.recording_id = ${recordingId}::uuid
          and rus.school_id = ${identity.schoolId}::uuid and rus.teacher_id = ${identity.userId}::uuid
          and rus.status = 'pending'
          and not exists (
            select 1
            from public.recording_audio_assets asset
            where asset.school_id = rus.school_id and asset.object_path = rus.object_path
              and asset.state = 'confirmed'
          )
        returning rus.object_path as "objectPath"
      `));
      for (const session of rejected) {
        await transaction.execute(sql`
          insert into public.recording_cleanup_intents (school_id, recording_id, object_path, reason)
          values (${identity.schoolId}::uuid, ${recordingId}::uuid, ${session.objectPath}, 'confirmation_failed')
          on conflict (object_path) do nothing
        `);
      }
    });
  }

  public async findUploadSession(identity: RecordingIdentity, recordingId: string, uploadSessionId: string): Promise<RecordingUploadSessionRecord | undefined> {
    await this.assertActiveTeacher(identity);
    const rows = rowsOf<RecordingUploadSessionRecord>(await this.db.execute(sql`
      select rus.id, rus.recording_id as "recordingId", rus.object_path as "expectedObjectPath",
        rus.expected_content_type as "expectedContentType", rus.expected_size_bytes as "expectedSizeBytes",
        rus.expected_duration_ms as "expectedDurationMs", rus.status
      from public.recording_upload_sessions rus
      join public.class_recordings cr on cr.id = rus.recording_id and cr.school_id = rus.school_id
      join public.class_subjects cs on cs.class_id = cr.class_id and cs.subject_id = cr.subject_id and cs.school_id = cr.school_id
      join public.user_roles role on role.user_id = ${identity.userId}::uuid
        and role.school_id = cr.school_id and role.role = 'teacher' and role.is_active
      where rus.id = ${uploadSessionId}::uuid and rus.recording_id = ${recordingId}::uuid
        and rus.school_id = ${identity.schoolId}::uuid and rus.teacher_id = ${identity.userId}::uuid
        and (cr.status = 'draft' or (cr.status = 'published' and rus.status = 'confirmed'))
        and cs.teacher_id = ${identity.userId}::uuid
      limit 1
    `));
    const row = rows[0];
    return row === undefined ? undefined : { ...row, expectedDurationMs: Number(row.expectedDurationMs), expectedSizeBytes: Number(row.expectedSizeBytes) };
  }

  public async confirmUpload(
    identity: RecordingIdentity,
    input: ConfirmRecordingUploadInput,
  ): Promise<'confirmed' | 'already_confirmed'> {
    await this.assertActiveTeacher(identity);
    return this.db.transaction(async (transaction) => {
      const session = rowsOf<{ status: 'confirmed' | 'pending' }>(await transaction.execute(sql`
        select rus.status
        from public.recording_upload_sessions rus
        join public.class_recordings cr on cr.id = rus.recording_id and cr.school_id = rus.school_id
        join public.class_subjects cs on cs.class_id = cr.class_id and cs.subject_id = cr.subject_id
          and cs.school_id = cr.school_id
        join public.user_roles role on role.user_id = ${identity.userId}::uuid
          and role.school_id = cr.school_id and role.role = 'teacher' and role.is_active
        where rus.id = ${input.uploadSessionId}::uuid and rus.recording_id = ${input.recordingId}::uuid
          and rus.school_id = ${identity.schoolId}::uuid and rus.teacher_id = ${identity.userId}::uuid
          and rus.status in ('pending', 'confirmed')
          and (rus.status = 'confirmed' or rus.expires_at > now())
          and cr.status = 'draft'
          and cs.teacher_id = ${identity.userId}::uuid
          and rus.object_path = ${input.objectPath}
        for update of rus
      `));
      const locked = session[0];
      if (!locked) throw new AppError('FORBIDDEN', 403, 'This upload session is no longer eligible for confirmation');
      if (locked.status === 'confirmed') return 'already_confirmed';

      const existing = rowsOf<{ oldPath: string | null }>(await transaction.execute(sql`
        select asset.object_path as "oldPath"
        from public.recording_audio_assets asset
        where asset.recording_id = ${input.recordingId}::uuid
        for update
      `));
      await transaction.execute(sql`
        insert into public.recording_audio_assets (
          recording_id, school_id, object_path, content_type, codec, channels, bitrate_bps, size_bytes, duration_ms, state
        ) values (
          ${input.recordingId}::uuid, ${identity.schoolId}::uuid, ${input.objectPath}, ${input.contentType},
          ${input.codec}, ${input.channels}, ${input.bitrateBps}, ${input.sizeBytes}, ${input.durationMs}, 'confirmed'
        )
        on conflict (recording_id) do update set
          object_path = excluded.object_path, content_type = excluded.content_type, codec = excluded.codec,
          channels = excluded.channels, bitrate_bps = excluded.bitrate_bps, size_bytes = excluded.size_bytes, duration_ms = excluded.duration_ms, state = 'confirmed', confirmed_at = now()
      `);
      await transaction.execute(sql`
        update public.recording_upload_sessions
        set status = 'confirmed', confirmed_at = now()
        where id = ${input.uploadSessionId}::uuid and status = 'pending'
      `);
      const oldPath = existing[0]?.oldPath;
      if (oldPath && oldPath !== input.objectPath) {
        await transaction.execute(sql`
          insert into public.recording_cleanup_intents (school_id, recording_id, object_path, reason)
          values (${identity.schoolId}::uuid, ${input.recordingId}::uuid, ${oldPath}, 'replaced')
          on conflict (object_path) do nothing
        `);
      }
      return 'confirmed';
    });
  }

  public async publishRecording(identity: RecordingIdentity, recordingId: string): Promise<RecordingPublicationResult> {
    await this.assertActiveTeacher(identity);
    return this.db.transaction(async (transaction) => {
      const rows = rowsOf<SummaryRow>(await transaction.execute(sql`
        update public.class_recordings cr
        set status = 'published', published_at = now(), updated_at = now()
        where cr.id = ${recordingId}::uuid and cr.school_id = ${identity.schoolId}::uuid
          and cr.status = 'draft'
          and exists (
            select 1 from public.class_subjects cs
            join public.user_roles role on role.user_id = ${identity.userId}::uuid
              and role.school_id = cr.school_id and role.role = 'teacher' and role.is_active
            where cs.class_id = cr.class_id and cs.subject_id = cr.subject_id
              and cs.school_id = cr.school_id and cs.teacher_id = ${identity.userId}::uuid
          )
          and exists (
            select 1 from public.recording_audio_assets asset
            where asset.recording_id = cr.id and asset.school_id = cr.school_id and asset.state = 'confirmed'
          )
        returning cr.id, cr.class_id as "classId", cr.subject_id as "subjectId", cr.title, cr.status,
          to_char(cr.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt", to_char(cr.published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "publishedAt",
          (select duration_ms from public.recording_audio_assets where recording_id = cr.id)::bigint as "durationMs"
      `));
      const row = rows[0];
      if (!row) throw new AppError('VALIDATION_ERROR', 400, 'A confirmed audio recording is required before publishing');
      const published = toSummary(row);
      const eventKey = `recording:${published.id}:published`;
      await transaction.execute(sql`
        insert into public.recording_outbox_events (school_id, recording_id, event_key, event_type, payload)
        values (
          ${identity.schoolId}::uuid, ${published.id}::uuid, ${eventKey}, 'recording.published',
          jsonb_build_object(
            'recordingId', ${published.id}::uuid,
            'classId', ${published.classId}::uuid,
            'subjectId', ${published.subjectId}::uuid
          )
        ) on conflict (school_id, event_key) do nothing
      `);
      return { ...published, eventKey };
    });
  }

  public async updateRecording(
    identity: RecordingIdentity,
    recordingId: string,
    input: UpdateRecordingInput,
  ): Promise<RecordingSummary> {
    await this.assertActiveTeacher(identity);
    const rows = rowsOf<SummaryRow>(await this.db.execute(sql`
      update public.class_recordings cr
      set title = ${input.title}, description = ${input.description}, updated_at = now()
      where cr.id = ${recordingId}::uuid
        and cr.school_id = ${identity.schoolId}::uuid
        and cr.status <> 'deleted'
        and exists (
          select 1 from public.class_subjects cs
          join public.user_roles role on role.user_id = ${identity.userId}::uuid
            and role.school_id = cr.school_id and role.role = 'teacher' and role.is_active
          where cs.class_id = cr.class_id and cs.subject_id = cr.subject_id
            and cs.school_id = cr.school_id and cs.teacher_id = ${identity.userId}::uuid
        )
      returning cr.id, cr.class_id as "classId", cr.subject_id as "subjectId", cr.title,
        cr.status, cr.created_at as "createdAt", cr.published_at as "publishedAt",
        (select asset.duration_ms from public.recording_audio_assets asset
          where asset.recording_id = cr.id and asset.school_id = cr.school_id
            and asset.state = 'confirmed') as "durationMs"
    `));
    const row = rows[0];
    if (!row) throw new AppError('FORBIDDEN', 403, 'You cannot update this recording');
    return toSummary(row);
  }

  public async deleteRecording(identity: RecordingIdentity, recordingId: string): Promise<RecordingDeletionResult> {
    await this.assertActiveTeacher(identity);
    return this.db.transaction(async (transaction) => {
      const rows = rowsOf<{ deletedAt: Date | string; id: string }>(await transaction.execute(sql`
        update public.class_recordings cr
        set status = 'deleted', deleted_at = now(), updated_at = now()
        where cr.id = ${recordingId}::uuid and cr.school_id = ${identity.schoolId}::uuid
          and cr.status <> 'deleted'
          and exists (
            select 1 from public.class_subjects cs
            join public.user_roles role on role.user_id = ${identity.userId}::uuid
              and role.school_id = cr.school_id and role.role = 'teacher' and role.is_active
            where cs.class_id = cr.class_id and cs.subject_id = cr.subject_id and cs.school_id = cr.school_id
              and cs.teacher_id = ${identity.userId}::uuid
          )
        returning cr.id, cr.deleted_at as "deletedAt"
      `));
      const row = rows[0];
      if (!row) throw new AppError('FORBIDDEN', 403, 'You cannot delete this recording');
      await transaction.execute(sql`
        insert into public.recording_cleanup_intents (school_id, recording_id, object_path, reason)
        select ${identity.schoolId}::uuid, ${recordingId}::uuid, object_path, 'deleted'
        from public.recording_audio_assets
        where recording_id = ${recordingId}::uuid and school_id = ${identity.schoolId}::uuid and state = 'confirmed'
        on conflict (object_path) do nothing
      `);
      await transaction.execute(sql`
        insert into public.recording_cleanup_intents (school_id, recording_id, object_path, reason)
        select ${identity.schoolId}::uuid, ${recordingId}::uuid, object_path, 'deleted'
        from public.recording_resources
        where recording_id = ${recordingId}::uuid and school_id = ${identity.schoolId}::uuid
        on conflict (object_path) do nothing
      `);
      await transaction.execute(sql`
        insert into public.recording_cleanup_intents (school_id, recording_id, object_path, reason)
        select ${identity.schoolId}::uuid, ${recordingId}::uuid, object_path, 'deleted'
        from public.recording_upload_sessions
        where recording_id = ${recordingId}::uuid and school_id = ${identity.schoolId}::uuid and status = 'pending'
        on conflict (object_path) do nothing
      `);
      await transaction.execute(sql`
        update public.recording_audio_assets set state = 'deleted'
        where recording_id = ${recordingId}::uuid and school_id = ${identity.schoolId}::uuid
      `);
      await transaction.execute(sql`
        update public.recording_upload_sessions set status = 'superseded'
        where recording_id = ${recordingId}::uuid and school_id = ${identity.schoolId}::uuid and status = 'pending'
      `);
      return { deletedAt: asIso(row.deletedAt)!, id: row.id };
    });
  }

  public async deleteResource(
    identity: RecordingIdentity,
    recordingId: string,
    resourceId: string,
  ): Promise<{ id: string } | undefined> {
    await this.assertActiveTeacher(identity);
    return this.db.transaction(async (transaction) => {
      const removed = rowsOf<{ id: string; kind: RecordingResourceKind; objectPath: string }>(await transaction.execute(sql`
        delete from public.recording_resources resource
        using public.class_recordings cr, public.class_subjects subject, public.user_roles role
        where resource.id = ${resourceId}::uuid
          and resource.recording_id = ${recordingId}::uuid
          and resource.school_id = ${identity.schoolId}::uuid
          and cr.id = resource.recording_id and cr.school_id = resource.school_id
          and cr.status <> 'deleted'
          and subject.class_id = cr.class_id and subject.subject_id = cr.subject_id
          and subject.school_id = cr.school_id and subject.teacher_id = ${identity.userId}::uuid
          and role.user_id = ${identity.userId}::uuid and role.school_id = cr.school_id
          and role.role = 'teacher' and role.is_active
        returning resource.id, resource.kind, resource.object_path as "objectPath"
      `));
      const resource = removed[0];
      if (!resource) return undefined;
      await transaction.execute(sql`
        insert into public.recording_cleanup_intents (school_id, recording_id, object_path, reason)
        values (${identity.schoolId}::uuid, ${recordingId}::uuid, ${resource.objectPath}, 'deleted')
        on conflict (object_path) do nothing
      `);
      if (resource.kind === 'attachment') {
        await transaction.execute(sql`
          with ordered as (
            select id, row_number() over (order by sort_order, id) - 1 as next_sort_order
            from public.recording_resources
            where school_id = ${identity.schoolId}::uuid
              and recording_id = ${recordingId}::uuid and kind = 'attachment'
          )
          update public.recording_resources resource
          set sort_order = ordered.next_sort_order
          from ordered where resource.id = ordered.id
        `);
      }
      return { id: resource.id };
    });
  }

  public async listTeacherRecordings(identity: RecordingIdentity, input: TeacherRecordingListInput): Promise<RecordingListResponse> {
    await this.assertActiveTeacher(identity);
    const rows = rowsOf<SummaryRow>(await this.db.execute(sql`
      select cr.id, cr.class_id as "classId", cr.subject_id as "subjectId", cr.title, cr.description, cr.status,
        to_char(cr.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt", to_char(cr.published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "publishedAt", asset.duration_ms as "durationMs",
        (select count(*)::int from public.recording_resources resource
          where resource.school_id = cr.school_id and resource.recording_id = cr.id) as "resourceCount"
      from public.class_recordings cr
      join public.class_subjects cs on cs.class_id = cr.class_id and cs.subject_id = cr.subject_id and cs.school_id = cr.school_id
      join public.user_roles role on role.user_id = ${identity.userId}::uuid
        and role.school_id = cr.school_id and role.role = 'teacher' and role.is_active
      left join public.recording_audio_assets asset on asset.recording_id = cr.id and asset.state = 'confirmed'
      where cr.school_id = ${identity.schoolId}::uuid and cr.class_id = ${input.classId}::uuid
        and cr.status <> 'deleted' and cs.teacher_id = ${identity.userId}::uuid
        and (${input.subjectId ?? null}::uuid is null or cr.subject_id = ${input.subjectId ?? null}::uuid)
        and (${input.cursor?.publishedAt ?? null}::timestamptz is null
          or cr.created_at < ${input.cursor?.publishedAt ?? null}::timestamptz
          or (cr.created_at = ${input.cursor?.publishedAt ?? null}::timestamptz and cr.id < ${input.cursor?.id ?? null}::uuid))
      order by cr.created_at desc, cr.id desc
      limit ${input.limit + 1}
    `));
    return nextTeacherPage(rows, input.limit);
  }

  public async listStudentRecordings(identity: RecordingIdentity, input: ListRecordingsInput): Promise<RecordingListResponse> {
    const rows = rowsOf<SummaryRow>(await this.db.execute(sql`
      select cr.id, cr.class_id as "classId", cr.subject_id as "subjectId", cr.title, cr.status,
        to_char(cr.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt", to_char(cr.published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "publishedAt", asset.duration_ms as "durationMs"
      from public.class_recordings cr
      join public.recording_audio_assets asset on asset.recording_id = cr.id and asset.school_id = cr.school_id and asset.state = 'confirmed'
      join public.class_members member on member.class_id = cr.class_id and member.school_id = cr.school_id
        and member.student_id = ${identity.userId}::uuid and member.is_active
      join public.classes c on c.id = cr.class_id and c.school_id = cr.school_id and c.academic_year_id = member.academic_year_id
      join public.academic_years year on year.id = c.academic_year_id and year.school_id = c.school_id and year.is_current
      join public.user_roles role on role.user_id = ${identity.userId}::uuid and role.school_id = cr.school_id
        and role.role = 'student' and role.is_active
      where cr.school_id = ${identity.schoolId}::uuid and cr.status = 'published'
        and (${input.subjectId ?? null}::uuid is null or cr.subject_id = ${input.subjectId ?? null}::uuid)
        and (${input.cursor?.publishedAt ?? null}::timestamptz is null
          or cr.published_at < ${input.cursor?.publishedAt ?? null}::timestamptz
          or (cr.published_at = ${input.cursor?.publishedAt ?? null}::timestamptz and cr.id < ${input.cursor?.id ?? null}::uuid))
      order by cr.published_at desc, cr.id desc
      limit ${input.limit + 1}
    `));
    return nextPage(rows, input.limit);
  }

  public async getStudentRecording(identity: RecordingIdentity, recordingId: string): Promise<RecordingDetail | undefined> {
    const rows = rowsOf<DetailRow>(await this.db.execute(this.studentRecordingSql(identity, recordingId)));
    const row = rows[0];
    return row === undefined ? undefined : toDetail(row);
  }

  public async getTeacherRecording(identity: RecordingIdentity, recordingId: string): Promise<RecordingDetail | undefined> {
    await this.assertActiveTeacher(identity);
    const rows = rowsOf<DetailRow>(await this.db.execute(sql`
      select cr.id, cr.class_id as "classId", cr.subject_id as "subjectId", cr.title, cr.status,
        cr.created_at as "createdAt", cr.published_at as "publishedAt", cr.description,
        asset.duration_ms as "durationMs", asset.size_bytes as "sizeBytes"
      from public.class_recordings cr
      join public.class_subjects subject on subject.class_id = cr.class_id
        and subject.subject_id = cr.subject_id and subject.school_id = cr.school_id
        and subject.teacher_id = ${identity.userId}::uuid
      join public.user_roles role on role.user_id = ${identity.userId}::uuid
        and role.school_id = cr.school_id and role.role = 'teacher' and role.is_active
      left join public.recording_audio_assets asset on asset.recording_id = cr.id
        and asset.school_id = cr.school_id and asset.state = 'confirmed'
      where cr.id = ${recordingId}::uuid and cr.school_id = ${identity.schoolId}::uuid
        and cr.status <> 'deleted'
      limit 1
    `));
    return rows[0] === undefined ? undefined : toDetail(rows[0]);
  }

  public async getTeacherPlaybackTarget(
    identity: RecordingIdentity,
    recordingId: string,
  ): Promise<RecordingPlaybackTarget | undefined> {
    await this.assertActiveTeacher(identity);
    const rows = rowsOf<RecordingPlaybackTarget>(await this.db.execute(sql`
      select asset.object_path as "objectPath"
      from public.class_recordings cr
      join public.recording_audio_assets asset on asset.recording_id = cr.id
        and asset.school_id = cr.school_id and asset.state = 'confirmed'
      join public.class_subjects subject on subject.class_id = cr.class_id
        and subject.subject_id = cr.subject_id and subject.school_id = cr.school_id
        and subject.teacher_id = ${identity.userId}::uuid
      join public.user_roles role on role.user_id = ${identity.userId}::uuid
        and role.school_id = cr.school_id and role.role = 'teacher' and role.is_active
      where cr.id = ${recordingId}::uuid and cr.school_id = ${identity.schoolId}::uuid
        and cr.status <> 'deleted'
      limit 1
    `));
    return rows[0];
  }

  public async listTeacherResources(
    identity: RecordingIdentity,
    recordingId: string,
  ): Promise<StoredRecordingResource[]> {
    await this.assertActiveTeacher(identity);
    const rows = rowsOf<StoredRecordingResource>(await this.db.execute(sql`
      select resource.id, resource.kind, resource.display_name as name,
        resource.content_type as "contentType", resource.size_bytes as "sizeBytes",
        resource.sort_order as "sortOrder", resource.object_path as "objectPath"
      from public.recording_resources resource
      join public.class_recordings cr on cr.id = resource.recording_id
        and cr.school_id = resource.school_id and cr.status <> 'deleted'
      join public.class_subjects subject on subject.class_id = cr.class_id
        and subject.subject_id = cr.subject_id and subject.school_id = cr.school_id
        and subject.teacher_id = ${identity.userId}::uuid
      join public.user_roles role on role.user_id = ${identity.userId}::uuid
        and role.school_id = cr.school_id and role.role = 'teacher' and role.is_active
      where resource.school_id = ${identity.schoolId}::uuid
        and resource.recording_id = ${recordingId}::uuid
      order by resource.kind desc, resource.sort_order, resource.id
    `));
    return rows.map((row) => ({ ...row, sizeBytes: Number(row.sizeBytes), sortOrder: Number(row.sortOrder) }));
  }

  public async listStudentResources(
    identity: RecordingIdentity,
    recordingId: string,
  ): Promise<StoredRecordingResource[]> {
    const rows = rowsOf<StoredRecordingResource>(await this.db.execute(sql`
      select resource.id, resource.kind, resource.display_name as name,
        resource.content_type as "contentType", resource.size_bytes as "sizeBytes",
        resource.sort_order as "sortOrder", resource.object_path as "objectPath"
      from public.recording_resources resource
      join public.class_recordings cr on cr.id = resource.recording_id
        and cr.school_id = resource.school_id and cr.status = 'published'
      join public.class_members member on member.class_id = cr.class_id and member.school_id = cr.school_id
        and member.student_id = ${identity.userId}::uuid and member.is_active
      join public.classes c on c.id = cr.class_id and c.school_id = cr.school_id
        and c.academic_year_id = member.academic_year_id
      join public.academic_years year on year.id = c.academic_year_id
        and year.school_id = c.school_id and year.is_current
      join public.user_roles role on role.user_id = ${identity.userId}::uuid
        and role.school_id = cr.school_id and role.role = 'student' and role.is_active
      where resource.school_id = ${identity.schoolId}::uuid
        and resource.recording_id = ${recordingId}::uuid
      order by resource.kind desc, resource.sort_order, resource.id
    `));
    return rows.map((row) => ({ ...row, sizeBytes: Number(row.sizeBytes), sortOrder: Number(row.sortOrder) }));
  }

  public async getPlaybackTarget(identity: RecordingIdentity, recordingId: string): Promise<RecordingPlaybackTarget | undefined> {
    const rows = rowsOf<{ objectPath: string }>(await this.db.execute(sql`
      select asset.object_path as "objectPath"
      from public.class_recordings cr
      join public.recording_audio_assets asset on asset.recording_id = cr.id and asset.school_id = cr.school_id and asset.state = 'confirmed'
      join public.class_members member on member.class_id = cr.class_id and member.school_id = cr.school_id
        and member.student_id = ${identity.userId}::uuid and member.is_active
      join public.classes c on c.id = cr.class_id and c.school_id = cr.school_id and c.academic_year_id = member.academic_year_id
      join public.academic_years year on year.id = c.academic_year_id and year.school_id = c.school_id and year.is_current
      join public.user_roles role on role.user_id = ${identity.userId}::uuid and role.school_id = cr.school_id
        and role.role = 'student' and role.is_active
      where cr.id = ${recordingId}::uuid and cr.school_id = ${identity.schoolId}::uuid and cr.status = 'published'
      limit 1
    `));
    return rows[0];
  }

  public async issuePlaybackSession(
    identity: RecordingIdentity,
    recordingId: string,
    expiresAt: string,
  ): Promise<RecordingPlaybackSession | undefined> {
    const rows = rowsOf<RecordingPlaybackSession>(await this.db.execute(sql`
      insert into public.recording_playback_sessions (
        school_id, student_id, recording_id, expires_at
      )
      select ${identity.schoolId}::uuid, ${identity.userId}::uuid, cr.id, ${expiresAt}::timestamptz
      from public.class_recordings cr
      join public.recording_audio_assets asset on asset.recording_id = cr.id
        and asset.school_id = cr.school_id and asset.state = 'confirmed'
      join public.class_members member on member.class_id = cr.class_id and member.school_id = cr.school_id
        and member.student_id = ${identity.userId}::uuid and member.is_active
      join public.classes c on c.id = cr.class_id and c.school_id = cr.school_id
        and c.academic_year_id = member.academic_year_id
      join public.academic_years year on year.id = c.academic_year_id and year.school_id = c.school_id
        and year.is_current
      join public.user_roles role on role.user_id = ${identity.userId}::uuid and role.school_id = cr.school_id
        and role.role = 'student' and role.is_active
      where cr.id = ${recordingId}::uuid and cr.school_id = ${identity.schoolId}::uuid
        and cr.status = 'published' and ${expiresAt}::timestamptz > now()
      returning id, to_char(issued_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "issuedAt"
    `));
    return rows[0];
  }

  public async getProgress(identity: RecordingIdentity, recordingId: string): Promise<RecordingProgress | undefined> {
    const rows = rowsOf<ProgressRow>(await this.db.execute(sql`
      select progress.recording_id as "recordingId", progress.position_ms as "positionMs",
        progress.completed_at as "completedAt", progress.updated_at as "updatedAt"
      from public.recording_progress progress
      join public.class_recordings cr on cr.id = progress.recording_id
        and cr.school_id = progress.school_id and cr.status = 'published'
      join public.recording_audio_assets asset on asset.recording_id = cr.id
        and asset.school_id = cr.school_id and asset.state = 'confirmed'
        and progress.position_ms <= asset.duration_ms
      join public.class_members member on member.class_id = cr.class_id and member.school_id = cr.school_id
        and member.student_id = ${identity.userId}::uuid and member.is_active
      join public.classes c on c.id = cr.class_id and c.school_id = cr.school_id
        and c.academic_year_id = member.academic_year_id
      join public.academic_years year on year.id = c.academic_year_id and year.school_id = c.school_id
        and year.is_current
      join public.user_roles role on role.user_id = ${identity.userId}::uuid
        and role.school_id = cr.school_id and role.role = 'student' and role.is_active
      where progress.school_id = ${identity.schoolId}::uuid and progress.student_id = ${identity.userId}::uuid
        and progress.recording_id = ${recordingId}::uuid
      limit 1
    `));
    return rows[0] ? toProgress(rows[0]) : undefined;
  }

  public async saveProgress(
    identity: RecordingIdentity,
    recordingId: string,
    input: SaveRecordingProgressInput,
  ): Promise<RecordingProgressResponse | undefined> {
    return this.db.transaction(async (transaction) => {
      const rows = rowsOf<ProgressMutationRow>(await transaction.execute(sql`
        with authorized_session as (
          select playback.sequence, asset.duration_ms as "durationMs"
          from public.recording_playback_sessions playback
          join public.class_recordings cr on cr.id = playback.recording_id
            and cr.school_id = playback.school_id and cr.status = 'published'
          join public.recording_audio_assets asset on asset.recording_id = cr.id
            and asset.school_id = cr.school_id and asset.state = 'confirmed'
          join public.class_members member on member.class_id = cr.class_id and member.school_id = cr.school_id
            and member.student_id = ${identity.userId}::uuid and member.is_active
          join public.classes c on c.id = cr.class_id and c.school_id = cr.school_id
            and c.academic_year_id = member.academic_year_id
          join public.academic_years year on year.id = c.academic_year_id and year.school_id = c.school_id
            and year.is_current
          join public.user_roles role on role.user_id = ${identity.userId}::uuid
            and role.school_id = cr.school_id and role.role = 'student' and role.is_active
          where playback.id = ${input.playbackSessionId}::uuid
            and playback.school_id = ${identity.schoolId}::uuid
            and playback.student_id = ${identity.userId}::uuid
            and playback.recording_id = ${recordingId}::uuid
            and playback.expires_at > now()
          limit 1
        ), allowed_session as (
          select * from authorized_session where ${input.positionMs} <= "durationMs"
        ), changed as (
          insert into public.recording_progress (
            school_id, student_id, recording_id, position_ms, completed_at,
            playback_session_id, playback_session_sequence, client_sequence, updated_at
          ) select
            ${identity.schoolId}::uuid, ${identity.userId}::uuid, ${recordingId}::uuid, ${input.positionMs},
            case when ${input.completed} then now() else null end, ${input.playbackSessionId}::uuid,
            allowed_session.sequence, ${input.clientSequence}, now()
          from allowed_session
          on conflict (school_id, student_id, recording_id) do update set
            position_ms = excluded.position_ms,
            completed_at = case when excluded.completed_at is not null then now() else recording_progress.completed_at end,
            playback_session_id = excluded.playback_session_id,
            playback_session_sequence = excluded.playback_session_sequence,
            client_sequence = excluded.client_sequence,
            updated_at = now()
          where (
            recording_progress.playback_session_id = excluded.playback_session_id
            and excluded.client_sequence > recording_progress.client_sequence
          ) or excluded.playback_session_sequence > recording_progress.playback_session_sequence
          returning recording_id as "recordingId", position_ms as "positionMs", completed_at as "completedAt", updated_at as "updatedAt"
        ), current as (
          select progress.recording_id as "recordingId", progress.position_ms as "positionMs",
            progress.completed_at as "completedAt", progress.updated_at as "updatedAt"
          from public.recording_progress progress
          join allowed_session on true
          where progress.school_id = ${identity.schoolId}::uuid and progress.student_id = ${identity.userId}::uuid
            and progress.recording_id = ${recordingId}::uuid
        )
        select "recordingId", "positionMs", "completedAt", "updatedAt", true as accepted, true as "withinDuration"
        from changed
        union all
        select "recordingId", "positionMs", "completedAt", "updatedAt", false as accepted, true as "withinDuration"
        from current where not exists (select 1 from changed)
        union all
        select null::uuid as "recordingId", null::bigint as "positionMs", null::timestamptz as "completedAt",
          null::timestamptz as "updatedAt", false as accepted, false as "withinDuration"
        from authorized_session where ${input.positionMs} > "durationMs"
      `));
      const row = rows[0];
      if (!row) return undefined;
      if (!row.withinDuration) {
        throw new AppError('VALIDATION_ERROR', 400, 'Playback progress cannot exceed the confirmed recording duration');
      }
      if (!row.recordingId || row.positionMs === null || row.updatedAt === null) return undefined;
      return {
        accepted: row.accepted,
        completedAt: asIso(row.completedAt),
        positionMs: Number(row.positionMs),
        recordingId: row.recordingId,
        updatedAt: asIso(row.updatedAt)!,
      };
    });
  }

  private async assertActiveTeacher(identity: RecordingIdentity): Promise<void> {
    const rows = rowsOf<{ id: string }>(await this.db.execute(sql`
      select user_id as id from public.user_roles
      where user_id = ${identity.userId}::uuid and school_id = ${identity.schoolId}::uuid
        and role = 'teacher' and is_active
      limit 1
    `));
    if (!rows[0]) throw new AppError('FORBIDDEN', 403, 'Only active teachers can manage recordings');
  }

  private studentRecordingSql(identity: RecordingIdentity, recordingId: string) {
    return sql`
      select cr.id, cr.class_id as "classId", cr.subject_id as "subjectId", cr.title, cr.status,
        to_char(cr.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt", to_char(cr.published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "publishedAt", cr.description,
        asset.duration_ms as "durationMs", asset.size_bytes as "sizeBytes"
      from public.class_recordings cr
      join public.recording_audio_assets asset on asset.recording_id = cr.id and asset.school_id = cr.school_id and asset.state = 'confirmed'
      join public.class_members member on member.class_id = cr.class_id and member.school_id = cr.school_id
        and member.student_id = ${identity.userId}::uuid and member.is_active
      join public.classes c on c.id = cr.class_id and c.school_id = cr.school_id and c.academic_year_id = member.academic_year_id
      join public.academic_years year on year.id = c.academic_year_id and year.school_id = c.school_id and year.is_current
      join public.user_roles role on role.user_id = ${identity.userId}::uuid and role.school_id = cr.school_id
        and role.role = 'student' and role.is_active
      where cr.id = ${recordingId}::uuid and cr.school_id = ${identity.schoolId}::uuid and cr.status = 'published'
      limit 1
    `;
  }
}
