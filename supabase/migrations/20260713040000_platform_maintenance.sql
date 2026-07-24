create extension if not exists pg_cron with schema extensions;

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
    perform pgmq.send('storage_cleanup',
      jsonb_build_object(
        'eventId', gen_random_uuid(),
        'eventType', 'storage.cleanup_expired_sessions',
        'occurredAt', now(),
        'schoolId', tenant.school_id,
        'schemaVersion', 1,
        'payload', jsonb_build_object('schoolId', tenant.school_id)
      )
    );
  end loop;
end;
$$;

select cron.schedule('platform-upload-session-cleanup-enqueue',
  '*/15 * * * *',
  $$select public.enqueue_expired_upload_session_cleanup();$$
);
