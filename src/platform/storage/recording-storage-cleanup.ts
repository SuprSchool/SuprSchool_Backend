import type { SupabaseClient } from '@supabase/supabase-js';
import { sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import type { RecordingCleanupHandler } from '../../services/recording-cleanup.service.js';
import { RECORDINGS_BUCKET } from './supabase-recording-storage-adapter.js';

export interface RecordingCleanupIntent {
  id: string;
  objectPath: string;
}

export interface RecordingCleanupStore {
  complete(intentId: string): Promise<void>;
  expireStaleSessions(schoolId: string): Promise<void>;
  isAdopted(schoolId: string, objectPath: string): Promise<boolean>;
  listPending(schoolId: string): Promise<ReadonlyArray<RecordingCleanupIntent>>;
  retry(intentId: string): Promise<void>;
}

export interface RecordingObjectDeleter {
  remove(bucket: string, objectPath: string): Promise<void>;
}

export class RecordingStorageCleanupHandler implements RecordingCleanupHandler {
  public constructor(
    private readonly store: RecordingCleanupStore,
    private readonly objects: RecordingObjectDeleter,
  ) {}

  public async handle(message: { schoolId: string }): Promise<void> {
    await this.store.expireStaleSessions(message.schoolId);
    for (const intent of await this.store.listPending(message.schoolId)) {
      if (await this.store.isAdopted(message.schoolId, intent.objectPath)) {
        await this.store.complete(intent.id);
        continue;
      }

      try {
        await this.objects.remove(RECORDINGS_BUCKET, intent.objectPath);
        await this.store.complete(intent.id);
      } catch (error) {
        await this.store.retry(intent.id);
        throw error;
      }
    }
  }
}

export class DatabaseRecordingCleanupStore implements RecordingCleanupStore {
  public constructor(private readonly database: Database) {}

  public async expireStaleSessions(schoolId: string): Promise<void> {
    await this.database.execute(sql`
      with expired_recording_sessions as (
        select id
        from public.recording_upload_sessions
        where school_id = ${schoolId}::uuid
          and status in ('reserved', 'pending')
          and expires_at <= now()
        order by expires_at
        limit 500
        for update skip locked
      ), expired as (
        update public.recording_upload_sessions session
        set status = 'superseded'
        from expired_recording_sessions
        where session.id = expired_recording_sessions.id
        returning session.school_id, session.recording_id, session.object_path
      )
      insert into public.recording_cleanup_intents (school_id, recording_id, object_path, reason)
      select expired.school_id, expired.recording_id, expired.object_path, 'expired'
      from expired
      where not exists (
        select 1
        from public.recording_audio_assets asset
        where asset.school_id = expired.school_id
          and asset.object_path = expired.object_path
          and asset.state = 'confirmed'
      )
      on conflict (object_path) do nothing
    `);
    await this.database.execute(sql`
      with abandoned_recording_ids as (
        select cr.id
        from public.class_recordings cr
        where cr.school_id = ${schoolId}::uuid
          and cr.status = 'draft'
          and cr.updated_at <= now() - interval '24 hours'
        order by cr.updated_at, cr.id
        limit 100
        for update skip locked
      ), abandoned_recordings as (
        update public.class_recordings cr
        set status = 'deleted', deleted_at = now(), updated_at = now()
        from abandoned_recording_ids abandoned
        where cr.id = abandoned.id
        returning cr.school_id, cr.id as recording_id
      ), expired_audio as (
        update public.recording_audio_assets asset
        set state = 'deleted'
        from abandoned_recordings recording
        where asset.school_id = recording.school_id
          and asset.recording_id = recording.recording_id
          and asset.state = 'confirmed'
        returning asset.school_id, asset.recording_id, asset.object_path
      ), expired_sessions as (
        update public.recording_upload_sessions session
        set status = 'superseded'
        from abandoned_recordings recording
        where session.school_id = recording.school_id
          and session.recording_id = recording.recording_id
          and session.status in ('reserved', 'pending')
        returning session.school_id, session.recording_id, session.object_path
      ), abandoned_objects as (
        select audio.school_id, audio.recording_id, audio.object_path
        from expired_audio audio
        union all
        select resource.school_id, resource.recording_id, resource.object_path
        from public.recording_resources resource
        inner join abandoned_recordings recording
          on recording.school_id = resource.school_id
          and recording.recording_id = resource.recording_id
        union all
        select session.school_id, session.recording_id, session.object_path
        from expired_sessions session
      )
      insert into public.recording_cleanup_intents (school_id, recording_id, object_path, reason)
      select object.school_id, object.recording_id, object.object_path, 'expired'
      from abandoned_objects object
      on conflict (object_path) do nothing
    `);
  }

  public async listPending(schoolId: string): Promise<ReadonlyArray<RecordingCleanupIntent>> {
    await this.database.execute(sql`
      update public.recording_cleanup_intents intent
      set state = 'completed', completed_at = now()
      where intent.school_id = ${schoolId}::uuid
        and intent.state = 'pending'
        and exists (
          select 1
          from public.recording_audio_assets asset
          where asset.school_id = intent.school_id
            and asset.object_path = intent.object_path
            and asset.state = 'confirmed'
        )
    `);
    const rows = await this.database.execute(sql<RecordingCleanupIntent>`
      select intent.id, intent.object_path as "objectPath"
      from public.recording_cleanup_intents intent
      where intent.school_id = ${schoolId}::uuid
        and intent.state = 'pending'
        and intent.next_attempt_at <= now()
        and not exists (
          select 1
          from public.recording_audio_assets asset
          where asset.school_id = intent.school_id
            and asset.object_path = intent.object_path
            and asset.state = 'confirmed'
        )
      order by intent.next_attempt_at, intent.id
      limit 100
      for update skip locked
    `);
    return rows as unknown as ReadonlyArray<RecordingCleanupIntent>;
  }

  public async isAdopted(schoolId: string, objectPath: string): Promise<boolean> {
    const rows = await this.database.execute(sql<{ adopted: boolean }>`
      select exists(
        select 1
        from public.recording_audio_assets
        where school_id = ${schoolId}::uuid
          and object_path = ${objectPath}
          and state = 'confirmed'
      ) as adopted
    `);
    return (rows as unknown as ReadonlyArray<{ adopted: boolean }>)[0]?.adopted === true;
  }

  public async complete(intentId: string): Promise<void> {
    await this.database.execute(sql`
      update public.recording_cleanup_intents
      set state = 'completed', completed_at = now()
      where id = ${intentId}::uuid and state = 'pending'
    `);
  }

  public async retry(intentId: string): Promise<void> {
    await this.database.execute(sql`
      update public.recording_cleanup_intents
      set attempt_count = attempt_count + 1,
          next_attempt_at = now() + interval '5 minutes'
      where id = ${intentId}::uuid and state = 'pending'
    `);
  }
}

export class SupabaseRecordingObjectDeleter implements RecordingObjectDeleter {
  public constructor(private readonly supabase: SupabaseClient) {}

  public async remove(bucket: string, objectPath: string): Promise<void> {
    const { error } = await this.supabase.storage.from(bucket).remove([objectPath]);
    if (error !== null) throw error;
  }
}
