alter table public.upload_sessions
  drop constraint if exists upload_sessions_status_check,
  drop constraint if exists upload_sessions_check,
  drop constraint if exists upload_sessions_confirmation_state_check;

alter table public.upload_sessions
  add constraint upload_sessions_status_check
    check (status in ('pending', 'confirmed', 'superseded')),
  add constraint upload_sessions_confirmation_state_check
    check (
      (status = 'pending' and confirmed_session_id is null and confirmed_at is null)
      or (
        status in ('confirmed', 'superseded')
        and confirmed_session_id is not null
        and confirmed_at is not null
      )
    );

create type public.avatar_cleanup_intent_status as enum (
  'pending',
  'completed',
  'cancelled'
);

create table public.avatar_cleanup_intents (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  object_path text not null,
  status public.avatar_cleanup_intent_status not null default 'pending',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, object_path),
  check (
    (status = 'completed' and completed_at is not null)
    or (status in ('pending', 'cancelled') and completed_at is null)
  )
);

create index avatar_cleanup_intents_pending_by_school
  on public.avatar_cleanup_intents (school_id, created_at)
  where status = 'pending';

alter table public.avatar_cleanup_intents enable row level security;
revoke all on table public.avatar_cleanup_intents from anon, authenticated;
grant select, insert, update, delete on table public.avatar_cleanup_intents to service_role;

select pgmq.create('avatar_cleanup_dispatch');

create table public.avatar_cleanup_dispatch_state (
  singleton boolean primary key default true check (singleton),
  last_school_id uuid
);

alter table public.avatar_cleanup_dispatch_state enable row level security;
revoke all on table public.avatar_cleanup_dispatch_state from anon, authenticated;
grant select, insert, update, delete on table public.avatar_cleanup_dispatch_state to service_role;

insert into public.avatar_cleanup_dispatch_state (singleton)
values (true)
on conflict (singleton) do nothing;

create or replace function public.enqueue_avatar_cleanup_dispatch()
returns void
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  tenant record;
  cursor_school_id uuid;
  last_dispatched_school_id uuid;
begin
  select last_school_id
  into cursor_school_id
  from public.avatar_cleanup_dispatch_state
  where singleton = true
  for update;

  for tenant in
    with pending_schools as (
      select distinct school_id
      from public.avatar_cleanup_intents
      where status = 'pending'
    ),
    round_robin as (
      select school_id, 0 as page
      from pending_schools
      where cursor_school_id is null or school_id > cursor_school_id

      union all

      select school_id, 1 as page
      from pending_schools
      where cursor_school_id is not null and school_id <= cursor_school_id
    )
    select school_id
    from round_robin
    order by page, school_id
    limit 100
  loop
    perform pgmq.send('avatar_cleanup_dispatch',
      jsonb_build_object(
        'eventId', gen_random_uuid(),
        'eventType', 'avatar.cleanup.dispatch',
        'occurredAt', now(),
        'schoolId', tenant.school_id,
        'schemaVersion', 1,
        'payload', jsonb_build_object()
      )
    );
    last_dispatched_school_id := tenant.school_id;
  end loop;

  if last_dispatched_school_id is not null then
    update public.avatar_cleanup_dispatch_state
    set last_school_id = last_dispatched_school_id
    where singleton = true;
  end if;
end;
$$;

select cron.schedule('avatar-cleanup-intent-dispatch',
  '*/5 * * * *',
  $$select public.enqueue_avatar_cleanup_dispatch();$$
);
