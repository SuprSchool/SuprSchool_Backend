create extension if not exists pgmq;

select pgmq.create('notification_dispatch');
select pgmq.create('notification_receipts');
select pgmq.create('reminder_dispatch');
select pgmq.create('attendance_rollup');
select pgmq.create('ranking_refresh');
select pgmq.create('storage_cleanup');
select pgmq.create('cache_refresh');

create table public.processed_queue_events (
  event_id uuid primary key,
  event_type text not null,
  school_id uuid not null,
  processed_at timestamptz not null default now(),
  outcome text not null check (outcome in ('processing', 'succeeded', 'failed')),
  attempt_token uuid,
  lease_expires_at timestamptz
);

create index processed_queue_events_school_id_processed_at_idx
  on public.processed_queue_events (school_id, processed_at);

create table public.queue_dead_letters (
  id uuid primary key default gen_random_uuid(),
  queue_name text not null,
  original_message_id bigint not null,
  event_id uuid not null,
  school_id uuid not null,
  envelope jsonb not null,
  error_category text not null,
  error_detail text not null,
  archived_at timestamptz not null default now()
);

create index queue_dead_letters_school_id_archived_at_idx
  on public.queue_dead_letters (school_id, archived_at);
