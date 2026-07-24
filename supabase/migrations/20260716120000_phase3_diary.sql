create table public.class_diary_entries (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  class_subject_id uuid not null references public.class_subjects(id) on delete cascade,
  teacher_id uuid not null references public.user_profiles(id) on delete restrict,
  occurred_on date not null,
  period_label text not null,
  title text not null,
  description text not null,
  key_points jsonb not null default '[]'::jsonb,
  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint class_diary_entries_class_subject_date_period_unique
    unique (class_subject_id, occurred_on, period_label)
);

create index class_diary_entries_school_subject_occurred_id_index
  on public.class_diary_entries (school_id, class_subject_id, occurred_on desc, id desc);

create index class_diary_entries_school_class_occurred_id_index
  on public.class_diary_entries (school_id, class_id, occurred_on desc, id desc);

alter table public.class_diary_entries enable row level security;

revoke all on table public.class_diary_entries from anon, authenticated;

grant select, insert, update, delete on table public.class_diary_entries to service_role;

create table public.diary_outbox_events (
  id uuid primary key,
  school_id uuid not null references public.schools(id) on delete cascade,
  event_type text not null check (event_type = 'diary.published'),
  payload jsonb not null,
  occurred_at timestamptz not null,
  dispatched_at timestamptz,
  dispatch_attempts integer not null default 0 check (dispatch_attempts >= 0),
  locked_until timestamptz
);

create index diary_outbox_events_pending_idx
  on public.diary_outbox_events (occurred_at, id)
  where dispatched_at is null;

alter table public.diary_outbox_events enable row level security;

revoke all on table public.diary_outbox_events from anon, authenticated;

grant select, insert, update, delete on table public.diary_outbox_events to service_role;
