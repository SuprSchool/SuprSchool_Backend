create table public.notification_push_deliveries (
  event_id uuid not null,
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create index notification_push_deliveries_pending_idx
  on public.notification_push_deliveries (school_id, created_at, event_id)
  where delivered_at is null;

alter table public.notification_push_deliveries enable row level security;
revoke all on table public.notification_push_deliveries from anon, authenticated;
grant select, insert, update, delete on table public.notification_push_deliveries to service_role;
