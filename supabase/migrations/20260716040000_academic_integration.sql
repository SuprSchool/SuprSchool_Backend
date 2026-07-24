alter table public.upload_sessions
  add column if not exists display_name text;

insert into storage.buckets (id, name, public)
values ('academic-files', 'academic-files', false)
on conflict (id) do update set public = false;

create table public.academic_outbox_events (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  event_type text not null check (event_type in (
    'announcement.published',
    'assignment.submitted',
    'assignment.graded',
    'assignment.reminder.requested',
    'exam.published',
    'exam.results_published'
  )),
  aggregate_type text not null,
  aggregate_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  dispatched_at timestamptz,
  dispatch_attempts integer not null default 0 check (dispatch_attempts >= 0),
  locked_until timestamptz
);

create index academic_outbox_events_pending_idx
  on public.academic_outbox_events (occurred_at, id)
  where dispatched_at is null;

alter table public.academic_outbox_events enable row level security;
revoke all on table public.academic_outbox_events from anon, authenticated;
grant select, insert, update, delete on table public.academic_outbox_events to service_role;

alter table public.notification_inbox
  add column if not exists event_id uuid;

create unique index notification_inbox_event_user_unique
  on public.notification_inbox (event_id, user_id)
  where event_id is not null;

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
    from (
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
    ) stale_academic_tenants
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
