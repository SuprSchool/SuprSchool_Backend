create table public.point_level_rules (
  school_id uuid not null references public.schools(id) on delete cascade,
  level integer not null check (level >= 1),
  minimum_points integer not null check (minimum_points >= 0),
  primary key (school_id, level),
  unique (school_id, minimum_points)
);

create table public.point_earning_rules (
  school_id uuid not null references public.schools(id) on delete cascade,
  code text not null,
  label text not null,
  icon text not null check (icon in ('document', 'star', 'fire', 'medal', 'calendar')),
  points integer not null check (points > 0),
  is_active boolean not null default true,
  sort_order integer not null,
  primary key (school_id, code)
);

create index point_earning_rules_active_index
  on public.point_earning_rules (school_id, sort_order)
  where is_active;

create table public.point_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  recipient_user_id uuid not null references public.user_profiles(id) on delete cascade,
  source_type text not null check (source_type in (
    'assignment_submission',
    'assessment_result',
    'attendance_streak',
    'event_registration',
    'event_result'
  )),
  source_id text not null,
  rule_code text not null,
  award_key text not null,
  points integer not null check (points <> 0),
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (school_id, award_key),
  foreign key (school_id, rule_code)
    references public.point_earning_rules (school_id, code)
);

create index point_ledger_activity_index
  on public.point_ledger_entries (school_id, recipient_user_id, occurred_at desc, id desc);

create table public.point_account_balances (
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  current_points integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (school_id, user_id)
);

-- This durable flag survives a queue outage; the ranking worker owns clearing it.
create table public.ranking_refresh_requests (
  school_id uuid not null references public.schools(id) on delete cascade,
  recipient_user_id uuid not null references public.user_profiles(id) on delete cascade,
  is_dirty boolean not null default true,
  dirty_at timestamptz not null default now(),
  primary key (school_id, recipient_user_id)
);

create function public.apply_point_ledger_entry_to_balance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.point_account_balances (
    school_id,
    user_id,
    current_points,
    updated_at
  )
  values (NEW.school_id, NEW.recipient_user_id, NEW.points, now())
  on conflict (school_id, user_id) do update
  set
    current_points = public.point_account_balances.current_points + excluded.current_points,
    updated_at = excluded.updated_at;

  insert into public.ranking_refresh_requests (
    school_id,
    recipient_user_id,
    is_dirty,
    dirty_at
  )
  values (NEW.school_id, NEW.recipient_user_id, true, now())
  on conflict (school_id, recipient_user_id) do update
  set
    is_dirty = true,
    dirty_at = excluded.dirty_at;

  return NEW;
end;
$$;

revoke all on function public.apply_point_ledger_entry_to_balance() from public;

create trigger point_ledger_entries_update_balance
after insert on public.point_ledger_entries
for each row execute function public.apply_point_ledger_entry_to_balance();

alter table public.point_level_rules enable row level security;
alter table public.point_earning_rules enable row level security;
alter table public.point_ledger_entries enable row level security;
alter table public.point_account_balances enable row level security;
alter table public.ranking_refresh_requests enable row level security;

create policy "school members read active point earning rules"
on public.point_earning_rules for select to authenticated
using (
  is_active
  and public.has_active_role_in_current_school(school_id::text)
);

create policy "students read their own point ledger"
on public.point_ledger_entries for select to authenticated
using (
  recipient_user_id = auth.uid()
  and public.has_active_role_in_current_school(school_id::text)
);

create policy "students read their own point balance"
on public.point_account_balances for select to authenticated
using (
  user_id = auth.uid()
  and public.has_active_role_in_current_school(school_id::text)
);
