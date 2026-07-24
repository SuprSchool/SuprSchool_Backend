create type public.student_announcement_category as enum (
  'School',
  'Class',
  'Sports',
  'Parents'
);

create table public.student_profiles (
  student_id uuid primary key references public.user_profiles(id) on delete cascade,
  date_of_birth date not null
);

create table public.class_announcements (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  category public.student_announcement_category not null,
  title text not null,
  body text not null,
  is_published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  check ((is_published and published_at is not null) or not is_published)
);

create index class_announcements_home_lookup
  on public.class_announcements (school_id, class_id, is_published, published_at desc);

create table public.class_exams (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  title text not null,
  scheduled_on date not null,
  is_published boolean not null default false,
  published_at timestamptz,
  check ((is_published and published_at is not null) or not is_published)
);

create index class_exams_home_lookup
  on public.class_exams (school_id, class_id, is_published, scheduled_on);

create table public.class_schedule_slots (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  day_of_week integer not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  room text,
  check (end_time > start_time),
  unique (class_id, day_of_week, start_time)
);

create index class_schedule_slots_home_lookup
  on public.class_schedule_slots (school_id, class_id, day_of_week, start_time);

alter table public.student_profiles enable row level security;
alter table public.class_announcements enable row level security;
alter table public.class_exams enable row level security;
alter table public.class_schedule_slots enable row level security;
