create extension if not exists pgcrypto;

create table public.api_idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  user_id uuid not null references auth.users(id),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 255),
  request_hash text not null check (char_length(request_hash) = 64),
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (school_id, user_id, idempotency_key),
  check (
    (response_status is null and response_body is null and completed_at is null)
    or (response_status is not null and completed_at is not null)
  )
);

create index api_idempotency_keys_completed_by_tenant
  on public.api_idempotency_keys (school_id, user_id, completed_at desc)
  where response_status is not null;

create table public.upload_sessions (
  id uuid primary key,
  school_id uuid not null references public.schools(id),
  user_id uuid not null references auth.users(id),
  bucket text not null,
  parent_type text not null,
  parent_id text not null,
  object_path text not null,
  content_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  status text not null default 'pending' check (status in ('pending', 'confirmed')),
  expires_at timestamptz not null,
  confirmed_session_id uuid unique,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (bucket, object_path),
  check (
    (status = 'pending' and confirmed_session_id is null and confirmed_at is null)
    or (status = 'confirmed' and confirmed_session_id is not null and confirmed_at is not null)
  )
);

create index upload_sessions_pending_by_tenant
  on public.upload_sessions (school_id, expires_at)
  where status = 'pending';

alter table public.api_idempotency_keys enable row level security;
alter table public.upload_sessions enable row level security;

revoke all on table public.api_idempotency_keys from anon, authenticated;
revoke all on table public.upload_sessions from anon, authenticated;

grant select, insert, update, delete on table public.api_idempotency_keys to service_role;
grant select, insert, update, delete on table public.upload_sessions to service_role;
