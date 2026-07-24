create table public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null check (platform in ('ios', 'android')),
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index device_tokens_school_user_active_idx
  on public.device_tokens (school_id, user_id, last_seen_at desc)
  where disabled_at is null;

create table public.notification_inbox (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  notification_type text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notification_inbox_user_created_idx
  on public.notification_inbox (school_id, user_id, created_at desc, id desc);
create index notification_inbox_unread_idx
  on public.notification_inbox (school_id, user_id, created_at desc, id desc)
  where read_at is null;

alter table public.device_tokens enable row level security;
alter table public.notification_inbox enable row level security;

create policy "device tokens are private to their owner"
  on public.device_tokens for all to authenticated
  using (user_id = auth.uid() and school_id = (select school_id from public.user_profiles where id = auth.uid()))
  with check (user_id = auth.uid() and school_id = (select school_id from public.user_profiles where id = auth.uid()));

create policy "notification inbox is private to its owner"
  on public.notification_inbox for select to authenticated
  using (user_id = auth.uid() and school_id = (select school_id from public.user_profiles where id = auth.uid()));

create policy "notification inbox owner updates only"
  on public.notification_inbox for update to authenticated
  using (user_id = auth.uid() and school_id = (select school_id from public.user_profiles where id = auth.uid()))
  with check (user_id = auth.uid() and school_id = (select school_id from public.user_profiles where id = auth.uid()));
