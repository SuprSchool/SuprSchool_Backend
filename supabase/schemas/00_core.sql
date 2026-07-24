create extension if not exists "pgcrypto";

create type public.app_role as enum ('student', 'teacher', 'school-admin', 'super-admin');
create type public.school_directory_entry_status as enum ('unclaimed', 'claimed', 'disabled');
create type public.avatar_kind as enum ('preset', 'upload');

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  school_code text not null unique,
  created_at timestamptz not null default now()
);

create table public.academic_years (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null,
  starts_on date not null,
  ends_on date not null,
  is_current boolean not null default false,
  unique (school_id, name),
  check (ends_on > starts_on)
);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  grade text not null,
  section text not null,
  display_name text not null,
  unique (school_id, academic_year_id, grade, section)
);

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  code text not null,
  name text not null,
  unique (school_id, code)
);

create table public.school_directory_entries (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  phone_e164 text not null,
  role public.app_role not null,
  display_name text not null,
  roll_number text,
  employee_code text,
  student_class_id uuid references public.classes(id),
  status public.school_directory_entry_status not null default 'unclaimed',
  claimed_by_user_id uuid,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint school_directory_entries_phone_e164_unique unique (phone_e164),
  check ((role = 'student') = (student_class_id is not null))
);

create index school_directory_entries_eligible_lookup
  on public.school_directory_entries (phone_e164, role, status);

create table public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete restrict,
  display_name text not null,
  phone_e164 text not null,
  avatar_path text,
  avatar_kind public.avatar_kind,
  avatar_value text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index user_profiles_school_id_index on public.user_profiles (school_id);

create table public.profile_interests (
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  interest text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, interest)
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  role public.app_role not null,
  is_active boolean not null default true,
  unique (user_id, school_id, role)
);

create index user_roles_user_active_index on public.user_roles (user_id, is_active);

create table public.class_members (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references public.user_profiles(id) on delete cascade,
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  roll_number text,
  is_active boolean not null default true,
  unique (student_id, academic_year_id)
);

create index class_members_class_active_index on public.class_members (class_id, is_active);

create table public.school_directory_teacher_assignments (
  id uuid primary key default gen_random_uuid(),
  school_directory_entry_id uuid not null references public.school_directory_entries(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  constraint school_directory_teacher_assignments_unique unique (school_directory_entry_id, class_id, subject_id)
);

create table public.class_subjects (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  teacher_id uuid references public.user_profiles(id),
  unique (class_id, subject_id)
);

create index class_subjects_teacher_index on public.class_subjects (teacher_id);

alter table public.schools enable row level security;
alter table public.academic_years enable row level security;
alter table public.classes enable row level security;
alter table public.subjects enable row level security;
alter table public.school_directory_entries enable row level security;
alter table public.user_profiles enable row level security;
alter table public.profile_interests enable row level security;
alter table public.user_roles enable row level security;
alter table public.class_members enable row level security;
alter table public.school_directory_teacher_assignments enable row level security;
alter table public.class_subjects enable row level security;
