
alter table public.api_idempotency_keys
  add column if not exists lease_expires_at timestamptz;

update public.api_idempotency_keys
set lease_expires_at = created_at + interval '10 minutes'
where response_status is null
  and lease_expires_at is null;

alter table public.api_idempotency_keys
  alter column lease_expires_at set default (now() + interval '10 minutes');

create index if not exists api_idempotency_keys_unresolved_lease_idx
  on public.api_idempotency_keys (lease_expires_at)
  where response_status is null;
alter table public.notification_push_deliveries
  add column if not exists stale_at timestamptz;

alter table public.notification_inbox
  add column if not exists stale_at timestamptz;

create index if not exists notification_push_deliveries_actionable_idx
  on public.notification_push_deliveries (school_id, event_id, user_id)
  where delivered_at is null and stale_at is null;

create index if not exists notification_inbox_visible_idx
  on public.notification_inbox (school_id, user_id, created_at desc, id desc)
  where stale_at is null;
