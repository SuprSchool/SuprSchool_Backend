-- Paid-tier recordings. Audio objects are private and immutable: a re-upload
-- receives a new recording/upload-session UUID path and is never an upsert.
create table public.class_recordings (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  created_by_teacher_id uuid not null references public.user_profiles(id) on delete restrict,
  title text not null check (char_length(title) between 1 and 180),
  description text check (description is null or char_length(description) between 1 and 4000),
  status text not null default 'draft' check (status in ('draft', 'published', 'deleted')),
  published_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'published' or published_at is not null),
  check ((status = 'deleted') = (deleted_at is not null))
);

create index class_recordings_student_feed_idx
  on public.class_recordings (school_id, class_id, subject_id, published_at desc, id desc)
  where status = 'published';
create index class_recordings_student_all_subjects_feed_idx
  on public.class_recordings (school_id, class_id, published_at desc, id desc)
  where status = 'published';

create index class_recordings_teacher_feed_idx
  on public.class_recordings (school_id, class_id, created_at desc, id desc)
  where status <> 'deleted';

create table public.recording_audio_assets (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null unique references public.class_recordings(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  object_path text not null unique,
  content_type text not null check (content_type = 'audio/mp4'),
  codec text not null check (codec = 'aac-lc'),
  channels integer not null check (channels = 1),
  bitrate_bps bigint not null check (bitrate_bps = 128000),
  size_bytes bigint not null check (size_bytes between 1 and 134217728),
  duration_ms bigint not null check (duration_ms between 1 and 7200000),
  state text not null check (state in ('confirmed', 'deleted')),
  confirmed_at timestamptz not null default now()
);

create table public.recording_upload_sessions (
  id uuid primary key,
  school_id uuid not null references public.schools(id) on delete cascade,
  recording_id uuid not null references public.class_recordings(id) on delete cascade,
  teacher_id uuid not null references public.user_profiles(id) on delete cascade,
  object_path text not null unique,
  expected_content_type text not null check (expected_content_type = 'audio/mp4'),
  expected_size_bytes bigint not null check (expected_size_bytes between 1 and 134217728),
  expected_duration_ms bigint not null check (expected_duration_ms between 1 and 7200000),
  status text not null default 'reserved' check (status in ('reserved', 'pending', 'confirmed', 'superseded')),
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'confirmed') = (confirmed_at is not null))
);

create index recording_upload_sessions_teacher_pending_idx
  on public.recording_upload_sessions (school_id, teacher_id, expires_at)
  where status in ('reserved', 'pending');

create table public.recording_playback_sessions (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.user_profiles(id) on delete cascade,
  recording_id uuid not null references public.class_recordings(id) on delete cascade,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > issued_at)
);

create index recording_playback_sessions_lookup_idx
  on public.recording_playback_sessions (school_id, student_id, recording_id, expires_at desc, sequence desc);

create table public.recording_progress (
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.user_profiles(id) on delete cascade,
  recording_id uuid not null references public.class_recordings(id) on delete cascade,
  position_ms bigint not null check (position_ms between 0 and 7200000),
  completed_at timestamptz,
  playback_session_id uuid not null,
  playback_session_sequence bigint not null check (playback_session_sequence > 0),
  client_sequence bigint not null check (client_sequence >= 0),
  updated_at timestamptz not null default now(),
  primary key (school_id, student_id, recording_id)
);

create index recording_progress_student_updated_idx
  on public.recording_progress (school_id, student_id, updated_at desc);

create table public.recording_resources (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  recording_id uuid not null references public.class_recordings(id) on delete cascade,
  object_path text not null unique,
  content_type text not null check (content_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes bigint not null check (size_bytes between 1 and 26214400),
  sort_order integer not null check (sort_order between 0 and 9),
  created_at timestamptz not null default now(),
  unique (recording_id, sort_order)
);

create or replace function public.enforce_recording_resource_limit()
returns trigger
language plpgsql
as $$
begin
  perform 1 from public.class_recordings where id = new.recording_id for update;
  if (select count(*) from public.recording_resources where recording_id = new.recording_id) >= 10 then
    raise exception 'a recording can have at most 10 resources';
  end if;
  return new;
end;
$$;

create trigger recording_resources_limit_trigger
  before insert on public.recording_resources
  for each row execute function public.enforce_recording_resource_limit();

create table public.recording_cleanup_intents (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  recording_id uuid not null references public.class_recordings(id) on delete cascade,
  object_path text not null unique,
  reason text not null check (reason in ('confirmation_failed', 'deleted', 'expired', 'provision_failed', 'replaced', 'superseded')),
  state text not null default 'pending' check (state in ('pending', 'completed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index recording_cleanup_intents_pending_idx
  on public.recording_cleanup_intents (next_attempt_at, id)
  where state = 'pending';

create table public.recording_outbox_events (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  recording_id uuid not null references public.class_recordings(id) on delete cascade,
  event_key text not null,
  event_type text not null check (event_type = 'recording.published'),
  payload jsonb not null,
  dispatched_at timestamptz,
  created_at timestamptz not null default now(),
  unique (school_id, event_key)
);

create index recording_outbox_events_pending_idx
  on public.recording_outbox_events (created_at, id)
  where dispatched_at is null;

alter table public.class_recordings enable row level security;
alter table public.recording_audio_assets enable row level security;
alter table public.recording_upload_sessions enable row level security;
alter table public.recording_playback_sessions enable row level security;
alter table public.recording_progress enable row level security;
alter table public.recording_resources enable row level security;
alter table public.recording_cleanup_intents enable row level security;
alter table public.recording_outbox_events enable row level security;

revoke all on table public.class_recordings, public.recording_audio_assets,
  public.recording_upload_sessions, public.recording_playback_sessions, public.recording_progress,
  public.recording_resources, public.recording_cleanup_intents,
  public.recording_outbox_events from anon, authenticated;

grant select, insert, update, delete on table public.class_recordings,
  public.recording_audio_assets, public.recording_upload_sessions, public.recording_playback_sessions,
  public.recording_progress, public.recording_resources,
  public.recording_cleanup_intents, public.recording_outbox_events to service_role;

create or replace function public.enqueue_expired_upload_session_cleanup()
returns void
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  tenant record;
begin
  for tenant in
    select school_id
    from (
      select school_id
      from public.upload_sessions
      where status = 'pending'
        and expires_at <= now()
      union
      select school_id
      from public.recording_upload_sessions
      where status in ('reserved', 'pending')
        and expires_at <= now()
    ) expired
    order by school_id
    limit 100
  loop
    perform pgmq.send('storage_cleanup',
      jsonb_build_object(
        'eventId', gen_random_uuid(),
        'eventType', 'storage.cleanup_expired_sessions',
        'occurredAt', now(),
        'schoolId', tenant.school_id,
        'schemaVersion', 1,
        'payload', jsonb_build_object('schoolId', tenant.school_id)
      )
    );
  end loop;
end;
$$;
