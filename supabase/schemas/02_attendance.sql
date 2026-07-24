create type public.attendance_status as enum ('present', 'absent', 'late', 'excused');

create table public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  attendance_date date not null,
  marked_by_teacher_id uuid not null references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (class_id, attendance_date)
);

create index attendance_sessions_school_date_index
  on public.attendance_sessions (school_id, attendance_date);

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  student_id uuid not null references public.user_profiles(id) on delete cascade,
  status public.attendance_status not null,
  marked_at timestamptz not null default now(),
  unique (session_id, student_id)
);

create index attendance_records_student_index
  on public.attendance_records (student_id);

create index attendance_sessions_school_class_date_id_index
  on public.attendance_sessions (school_id, class_id, attendance_date desc, id desc);

create index attendance_records_session_status_student_index
  on public.attendance_records (session_id, status, student_id);

create index class_members_school_class_active_roll_index
  on public.class_members (school_id, class_id, is_active, roll_number, student_id);

alter table public.attendance_sessions enable row level security;
alter table public.attendance_records enable row level security;
