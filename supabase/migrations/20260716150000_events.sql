create table public.events (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  created_by_teacher_id uuid not null references public.user_profiles(id) on delete restrict,
  activity_kind text not null check (activity_kind in ('event', 'competition')),
  category text,
  participation_mode text check (participation_mode in ('solo', 'team')),
  title text not null check (char_length(btrim(title)) between 1 and 240),
  description text,
  venue text,
  eligibility_criteria text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  registration_deadline_at timestamptz,
  lifecycle text not null default 'draft' check (lifecycle in ('draft', 'published', 'archived', 'completed')),
  results_published_at timestamptz,
  results_revision integer not null default 0 check (results_revision >= 0),
  manager_revision integer not null default 0 check (manager_revision >= 0),
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at),
  check (registration_deadline_at is null or registration_deadline_at <= starts_at),
  check (activity_kind <> 'competition' or participation_mode is not null),
  check ((lifecycle = 'archived') = (archived_at is not null))
);

create index events_school_lifecycle_starts_id_idx
  on public.events (school_id, lifecycle, starts_at desc, id desc)
  where deleted_at is null;
create index events_school_created_id_idx
  on public.events (school_id, created_at desc, id desc)
  where deleted_at is null;

create table public.event_audiences (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (event_id, class_id)
);

create index event_audiences_school_class_event_idx
  on public.event_audiences (school_id, class_id, event_id);

create table public.event_managers (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  member_type text not null check (member_type in ('teacher', 'student')),
  manager_role text not null check (char_length(btrim(manager_role)) between 1 and 120),
  created_at timestamptz not null default now(),
  unique (event_id, user_id)
);

create index event_managers_school_user_event_idx
  on public.event_managers (school_id, user_id, event_id);

create table public.event_registrations (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  student_id uuid not null references public.user_profiles(id) on delete cascade,
  participation_tag text,
  participation_revision integer not null default 0 check (participation_revision >= 0),
  registered_at timestamptz not null default now(),
  cancelled_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (event_id, student_id)
);

create index event_registrations_school_student_event_idx
  on public.event_registrations (school_id, student_id, event_id)
  where cancelled_at is null;
create index event_registrations_event_registered_student_idx
  on public.event_registrations (event_id, registered_at, student_id)
  where cancelled_at is null;

create table public.event_teams (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_by_student_id uuid not null references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index event_teams_event_lower_name_unique
  on public.event_teams (event_id, lower(name));
create index event_teams_school_event_idx
  on public.event_teams (school_id, event_id);

create table public.event_team_members (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  team_id uuid not null references public.event_teams(id) on delete cascade,
  student_id uuid not null references public.user_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (team_id, student_id),
  unique (event_id, student_id)
);

create index event_team_members_school_student_event_idx
  on public.event_team_members (school_id, student_id, event_id);

create table public.event_result_entries (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  target_type text not null check (target_type in ('registration', 'team')),
  registration_id uuid references public.event_registrations(id) on delete cascade,
  team_id uuid references public.event_teams(id) on delete cascade,
  score numeric,
  dense_rank integer check (dense_rank is null or dense_rank > 0),
  revision integer not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  check (
    (target_type = 'registration' and registration_id is not null and team_id is null)
    or (target_type = 'team' and team_id is not null and registration_id is null)
  )
);

create unique index event_results_registration_target_unique
  on public.event_result_entries (event_id, registration_id)
  where target_type = 'registration';
create unique index event_results_team_target_unique
  on public.event_result_entries (event_id, team_id)
  where target_type = 'team';
create index event_results_school_event_rank_idx
  on public.event_result_entries (school_id, event_id, dense_rank, id);

create table public.event_domain_outbox (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique,
  school_id uuid not null references public.schools(id) on delete cascade,
  event_type text not null check (char_length(event_type) between 1 and 160),
  source_key text not null unique check (char_length(source_key) between 1 and 300),
  payload jsonb not null,
  occurred_at timestamptz not null default now(),
  published_at timestamptz
);

create index event_domain_outbox_school_published_occurred_idx
  on public.event_domain_outbox (school_id, published_at, occurred_at)
  where published_at is null;

create or replace function public.events_assert_audience_tenant()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from public.events event
    join public.classes class_section
      on class_section.id = new.class_id and class_section.school_id = new.school_id
    where event.id = new.event_id and event.school_id = new.school_id
  ) then
    raise exception 'event audience must be in the event school' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger events_audience_tenant_trigger
before insert or update on public.event_audiences
for each row execute function public.events_assert_audience_tenant();

create or replace function public.events_assert_team_member_target()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from public.event_teams team
    join public.event_registrations registration
      on registration.event_id = team.event_id
      and registration.student_id = new.student_id
      and registration.cancelled_at is null
    where team.id = new.team_id
      and team.id = new.team_id
      and team.event_id = new.event_id
      and team.school_id = new.school_id
      and registration.school_id = new.school_id
  ) then
    raise exception 'team member must have an active registration in the same event' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger events_team_member_target_trigger
before insert or update on public.event_team_members
for each row execute function public.events_assert_team_member_target();

create or replace function public.events_assert_result_target()
returns trigger
language plpgsql
as $$
begin
  if new.target_type = 'registration' and not exists (
    select 1 from public.event_registrations registration
    where registration.id = new.registration_id
      and registration.event_id = new.event_id
      and registration.school_id = new.school_id
  ) then
    raise exception 'registration result target must belong to the event school' using errcode = '23514';
  end if;
  if new.target_type = 'team' and not exists (
    select 1 from public.event_teams team
    where team.id = new.team_id
      and team.event_id = new.event_id
      and team.school_id = new.school_id
  ) then
    raise exception 'team result target must belong to the event school' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger events_result_target_trigger
before insert or update on public.event_result_entries
for each row execute function public.events_assert_result_target();

alter table public.events enable row level security;
alter table public.event_audiences enable row level security;
alter table public.event_managers enable row level security;
alter table public.event_registrations enable row level security;
alter table public.event_teams enable row level security;
alter table public.event_team_members enable row level security;
alter table public.event_result_entries enable row level security;
alter table public.event_domain_outbox enable row level security;

revoke all on table public.events, public.event_audiences, public.event_managers,
  public.event_registrations, public.event_teams, public.event_team_members,
  public.event_result_entries, public.event_domain_outbox from anon, authenticated;

grant select, insert, update, delete on table public.events, public.event_audiences,
  public.event_managers, public.event_registrations, public.event_teams,
  public.event_team_members, public.event_result_entries, public.event_domain_outbox to service_role;
