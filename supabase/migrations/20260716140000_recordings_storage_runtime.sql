-- Integration-owned private Storage configuration for reviewed recordings.
-- Existing bucket settings are only tightened (privacy/size) or preserved; no
-- anonymous/authenticated object policy is introduced.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'recordings',
  'recordings',
  false,
  134217728,
  array['audio/mp4']::text[]
)
on conflict (id) do update
set
  public = false,
  file_size_limit = least(
    coalesce(storage.buckets.file_size_limit, excluded.file_size_limit),
    excluded.file_size_limit
  ),
  allowed_mime_types = excluded.allowed_mime_types;

-- New messages identify their cleanup domain. The worker retains a safe
-- fallback for generic messages already queued before this migration.
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
    where status = 'pending'
      and expires_at <= now()
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
    ) as recordings_needing_cleanup
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
