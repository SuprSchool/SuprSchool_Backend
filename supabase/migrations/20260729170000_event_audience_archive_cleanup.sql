alter table public.events
  add column audience_type text not null default 'classes'
  check (audience_type in ('classes', 'school'));

create index classes_school_academic_year_lower_name_id_idx
  on public.classes (school_id, academic_year_id, lower(display_name), id);

create or replace function public.events_validate_audience_cardinality()
returns trigger
language plpgsql
as $$
declare
  audience_count integer;
  audience_event_id uuid;
  audience_type text;
begin
  if tg_table_name = 'event_audiences' and tg_op = 'UPDATE' then
    if old.event_id is distinct from new.event_id then
      raise exception 'event audience rows cannot move between events'
        using errcode = '23514';
    end if;
  end if;

  audience_event_id := case
    when tg_table_name = 'events' then coalesce(new.id, old.id)
    else coalesce(new.event_id, old.event_id)
  end;

  select event.audience_type
  into audience_type
  from public.events event
  where event.id = audience_event_id;

  if not found then
    return null;
  end if;

  select count(*)::integer
  into audience_count
  from public.event_audiences audience
  where audience.event_id = audience_event_id;

  if not (
    (audience_type = 'school' and audience_count = 0)
    or (audience_type = 'classes' and audience_count between 1 and 100)
  ) then
    raise exception 'event audience cardinality does not match its audience type'
      using errcode = '23514';
  end if;

  return null;
end;
$$;

create constraint trigger events_validate_audience
after insert or update of audience_type on public.events
deferrable initially deferred
for each row execute function public.events_validate_audience_cardinality();

create constraint trigger event_audiences_validate_event
after insert or update or delete on public.event_audiences
deferrable initially deferred
for each row execute function public.events_validate_audience_cardinality();

create index events_school_deleted_id_idx
  on public.events (school_id, deleted_at, id)
  where deleted_at is not null;

create or replace function public.events_enqueue_media_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if old.deleted_at is null
    and new.deleted_at is not null
    and exists (
      select 1
      from public.event_resources resource
      where resource.event_id = new.id
        and resource.school_id = new.school_id
    )
  then
    perform pgmq.send('storage_cleanup',
      jsonb_build_object(
        'eventId', gen_random_uuid(),
        'eventType', 'storage.cleanup_expired_sessions',
        'occurredAt', now(),
        'schoolId', new.school_id,
        'schemaVersion', 1,
        'payload', jsonb_build_object('kind', 'legacy', 'schoolId', new.school_id)
      )
    );
  end if;
  return new;
end;
$$;

create trigger events_enqueue_media_cleanup_trigger
after update of deleted_at on public.events
for each row execute function public.events_enqueue_media_cleanup();

revoke execute on function public.events_enqueue_media_cleanup() from public, anon, authenticated;
grant execute on function public.events_enqueue_media_cleanup() to service_role;

create or replace function public.enqueue_expired_upload_session_cleanup()
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  last_school_id uuid;
  scheduler_cursor uuid;
  tenant record;
begin
  select cursor_school_id
  into scheduler_cursor
  from public.academic_storage_cleanup_scheduler_state
  where singleton
  for update;

  for tenant in
    with stale_academic_tenants as (
      select school_id
      from public.upload_sessions
      where status = 'pending'
        and expires_at <= now()
      union
      select resource.school_id
      from public.assignment_resources resource
      join public.assignments assignment
        on assignment.id = resource.assignment_id
        and assignment.school_id = resource.school_id
      where assignment.deleted_at is not null
        and not exists (
          select 1 from public.academic_storage_cleanup_objects cleaned
          where cleaned.school_id = resource.school_id
            and cleaned.bucket = 'academic-files'
            and cleaned.object_path = resource.object_path
        )
      union
      select submission.school_id
      from public.assignment_submissions submission
      join public.assignments assignment
        on assignment.id = submission.assignment_id
        and assignment.school_id = submission.school_id
      where assignment.deleted_at is not null
        and submission.object_path is not null
        and not exists (
          select 1 from public.academic_storage_cleanup_objects cleaned
          where cleaned.school_id = submission.school_id
            and cleaned.bucket = 'academic-files'
            and cleaned.object_path = submission.object_path
        )
      union
      select resource.school_id
      from public.exam_resources resource
      join public.class_exams exam
        on exam.id = resource.assessment_id
        and exam.school_id = resource.school_id
      where exam.deleted_at is not null
        and not exists (
          select 1 from public.academic_storage_cleanup_objects cleaned
          where cleaned.school_id = resource.school_id
            and cleaned.bucket = 'academic-files'
            and cleaned.object_path = resource.object_path
        )
      union
      select resource.school_id
      from public.event_resources resource
      join public.events event
        on event.id = resource.event_id
        and event.school_id = resource.school_id
      where event.deleted_at is not null
    ), ranked_tenants as (
      select distinct
        school_id,
        case
          when scheduler_cursor is null or school_id > scheduler_cursor then 0
          else 1
        end as cursor_group
      from stale_academic_tenants
    ), selected_tenants as (
      select school_id, cursor_group
      from ranked_tenants
      order by cursor_group, school_id
      limit 100
    )
    select school_id
    from selected_tenants
    order by cursor_group, school_id
  loop
    perform pgmq.send('storage_cleanup',
      jsonb_build_object(
        'eventId', gen_random_uuid(),
        'eventType', 'storage.cleanup_expired_sessions',
        'occurredAt', now(),
        'schoolId', tenant.school_id,
        'schemaVersion', 1,
        'payload', jsonb_build_object('kind', 'legacy', 'schoolId', tenant.school_id)
      )
    );
    last_school_id := tenant.school_id;
  end loop;

  if last_school_id is not null then
    update public.academic_storage_cleanup_scheduler_state
    set cursor_school_id = last_school_id,
        updated_at = now()
    where singleton;
  end if;

  for tenant in
    select distinct school_id
    from (
      select school_id
      from public.recording_upload_sessions
      where status in ('reserved', 'pending')
        and expires_at <= now()
      union
      select school_id
      from public.recording_cleanup_intents
      where state = 'pending'
        and next_attempt_at <= now()
      union
      select school_id
      from public.class_recordings
      where status = 'draft'
        and updated_at <= now() - interval '24 hours'
    ) recordings_needing_cleanup
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
        'payload', jsonb_build_object('kind', 'recordings', 'schoolId', tenant.school_id)
      )
    );
  end loop;
end;
$$;

revoke execute on function public.enqueue_expired_upload_session_cleanup() from public, anon, authenticated;
grant execute on function public.enqueue_expired_upload_session_cleanup() to service_role;
