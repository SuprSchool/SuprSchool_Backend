-- Recording banners and attachments use generic signed upload sessions in the
-- private recordings bucket. Object paths include a new upload-session UUID;
-- replacements never reuse a Storage key.
alter table public.recording_resources
  add column if not exists upload_session_id uuid references public.upload_sessions(id) on delete restrict,
  add column if not exists kind text not null default 'attachment',
  add column if not exists display_name text;

update public.recording_resources
set display_name = coalesce(
  nullif(btrim(display_name), ''),
  nullif(regexp_replace(object_path, '^.*/', ''), ''),
  'recording-resource'
)
where display_name is null or btrim(display_name) = '';

alter table public.recording_resources
  alter column display_name set not null,
  drop constraint if exists recording_resources_kind_check,
  add constraint recording_resources_kind_check check (kind in ('attachment', 'banner')),
  drop constraint if exists recording_resources_display_name_nonempty_check,
  add constraint recording_resources_display_name_nonempty_check check (btrim(display_name) <> '');

alter table public.recording_resources
  drop constraint if exists recording_resources_recording_id_sort_order_key;
drop index if exists public.recording_resources_sort_order_unique;

create unique index if not exists recording_resources_upload_session_unique
  on public.recording_resources (upload_session_id)
  where upload_session_id is not null;
create unique index if not exists recording_resources_kind_sort_order_unique
  on public.recording_resources (recording_id, kind, sort_order);
create unique index if not exists recording_resources_one_banner_unique
  on public.recording_resources (recording_id)
  where kind = 'banner';

create or replace function public.enforce_recording_resource_limit()
returns trigger
language plpgsql
as $$
begin
  perform 1 from public.class_recordings where id = new.recording_id for update;
  if new.kind = 'attachment' and (
    select count(*) from public.recording_resources
    where recording_id = new.recording_id and kind = 'attachment'
  ) >= 10 then
    raise exception 'a recording can have at most 10 attachments';
  end if;
  return new;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'recordings',
  'recordings',
  false,
  134217728,
  array['audio/mp4', 'application/pdf', 'image/jpeg', 'image/png']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = greatest(coalesce(storage.buckets.file_size_limit, excluded.file_size_limit), excluded.file_size_limit),
  allowed_mime_types = excluded.allowed_mime_types;

-- Include confirmed recording resources in recording-domain deletion cleanup.
-- Pending resource sessions remain covered by the generic upload-session cleanup.
create index if not exists recording_resources_cleanup_lookup_idx
  on public.recording_resources (school_id, recording_id, kind, id);

create index if not exists class_recordings_abandoned_drafts_idx
  on public.class_recordings (school_id, updated_at, id)
  where status = 'draft';

-- Keep stale drafts in the existing recordings cleanup queue. The worker
-- atomically marks each draft deleted and enqueues its confirmed objects.
create or replace function public.enqueue_expired_upload_session_cleanup()
returns void
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  tenant record;
begin
  for tenant in
    select distinct school_id
    from public.upload_sessions
    where status = 'pending' and expires_at <= now()
    order by school_id
    limit 100
  loop
    perform pgmq.send(
      'storage_cleanup',
      jsonb_build_object(
        'eventId', gen_random_uuid(),
        'eventType', 'storage.cleanup_expired_sessions',
        'occurredAt', now(),
        'schoolId', tenant.school_id,
        'schemaVersion', 1,
        'payload', jsonb_build_object('kind', 'legacy', 'schoolId', tenant.school_id)
      )
    );
  end loop;

  for tenant in
    select distinct school_id
    from (
      select school_id from public.recording_upload_sessions
      where status in ('reserved', 'pending') and expires_at <= now()
      union
      select school_id from public.recording_cleanup_intents
      where state = 'pending' and next_attempt_at <= now()
      union
      select school_id from public.class_recordings
      where status = 'draft' and updated_at <= now() - interval '24 hours'
    ) recordings_needing_cleanup
    order by school_id
    limit 100
  loop
    perform pgmq.send(
      'storage_cleanup',
      jsonb_build_object(
        'eventId', gen_random_uuid(),
        'eventType', 'storage.cleanup_expired_sessions',
        'occurredAt', now(),
        'schoolId', tenant.school_id,
        'schemaVersion', 1,
        'payload', jsonb_build_object('kind', 'recordings', 'schoolId', tenant.school_id)
      )
    );
  end loop;
end;
$$;
