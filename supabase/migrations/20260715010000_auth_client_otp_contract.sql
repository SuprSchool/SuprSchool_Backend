-- Client signup is mobile -> Twilio Verify OTP -> password. No Supabase SMS is used.
alter table public.auth_signup_challenges
  alter column user_id drop not null,
  add column if not exists completed_at timestamptz;

create table public.auth_password_reset_challenges (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null unique,
  user_id uuid not null,
  expires_at timestamptz not null,
  verified_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index auth_password_reset_challenges_expiry_index
  on public.auth_password_reset_challenges (expires_at);

alter table public.auth_password_reset_challenges enable row level security;
