create table public.academic_storage_cleanup_scheduler_state (
  singleton boolean primary key default true check (singleton),
  cursor_school_id uuid references public.schools(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.academic_storage_cleanup_scheduler_state (singleton)
values (true)
on conflict (singleton) do nothing;

alter table public.academic_storage_cleanup_scheduler_state enable row level security;
revoke all on table public.academic_storage_cleanup_scheduler_state from anon, authenticated;
grant select, insert, update, delete on table public.academic_storage_cleanup_scheduler_state to service_role;

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
        'payload', jsonb_build_object('schoolId', tenant.school_id)
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
end;
$$;

revoke execute on function public.enqueue_expired_upload_session_cleanup() from public, anon, authenticated;
grant execute on function public.enqueue_expired_upload_session_cleanup() to service_role;
