-- Server-owned intake for users who cannot complete roster-gated signup.
-- Deliberately no client policy: only the API service role may create/read it.
create table public.contact_admin_requests (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null,
  message text not null check (char_length(message) between 1 and 2000),
  requested_role public.app_role,
  status text not null default 'open' check (status in ('open', 'resolved', 'spam')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index contact_admin_requests_phone_created_index
  on public.contact_admin_requests (phone_e164, created_at desc);

alter table public.contact_admin_requests enable row level security;

-- Twilio verifies possession of the phone. This table only maps its short
-- challenge window to the unconfirmed Supabase Auth user created by the API.
create table public.auth_signup_challenges (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null unique,
  user_id uuid not null,
  expires_at timestamptz not null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create index auth_signup_challenges_expiry_index
  on public.auth_signup_challenges (expires_at);

alter table public.auth_signup_challenges enable row level security;
