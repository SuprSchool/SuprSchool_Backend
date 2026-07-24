create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  teacher_id uuid not null references public.user_profiles(id) on delete restrict,
  title text not null check (char_length(title) between 1 and 160),
  instructions text not null check (char_length(instructions) between 1 and 10000),
  due_at timestamptz not null,
  is_graded boolean not null,
  grading_type text not null check (grading_type in ('Numeric', 'Alphabetic')),
  max_marks double precision,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assignments_grading_shape_check check (
    (grading_type = 'Numeric' and max_marks is not null and max_marks > 0)
    or (grading_type = 'Alphabetic' and max_marks is null)
  )
);

create table public.assignment_rubrics (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  position integer not null check (position between 1 and 100),
  topic text not null check (char_length(topic) between 1 and 160),
  marks double precision not null check (marks >= 0),
  more_info text check (more_info is null or char_length(more_info) between 1 and 2000),
  created_at timestamptz not null default now(),
  unique (assignment_id, position)
);

create table public.assignment_resources (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  upload_session_id uuid not null unique,
  object_path text not null unique,
  display_name text not null check (char_length(display_name) between 1 and 255),
  created_at timestamptz not null default now()
);

create table public.assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id uuid not null references public.user_profiles(id) on delete cascade,
  upload_session_id uuid unique,
  object_path text unique,
  display_name text,
  submitted_at timestamptz,
  marks double precision,
  feedback text,
  graded_at timestamptz,
  graded_by_teacher_id uuid references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, student_id),
  constraint assignment_submissions_file_shape_check check (
    (upload_session_id is null and object_path is null and display_name is null and submitted_at is null)
    or (upload_session_id is not null and object_path is not null and display_name is not null and submitted_at is not null)
  ),
  constraint assignment_submissions_grade_shape_check check (
    (marks is null and graded_at is null and graded_by_teacher_id is null)
    or (marks is not null and graded_at is not null and graded_by_teacher_id is not null)
  )
);

create index assignments_student_cursor_idx
  on public.assignments (school_id, class_id, due_at desc, id desc)
  where deleted_at is null;

create index assignments_teacher_cursor_idx
  on public.assignments (school_id, teacher_id, created_at desc, id desc)
  where deleted_at is null;

create index assignment_submissions_teacher_cursor_idx
  on public.assignment_submissions (school_id, assignment_id, submitted_at desc nulls last, id desc);

create index assignment_submissions_student_idx
  on public.assignment_submissions (school_id, student_id, assignment_id);

create index assignment_resources_parent_idx
  on public.assignment_resources (school_id, assignment_id, created_at desc, id desc);

alter table public.assignments enable row level security;
alter table public.assignment_rubrics enable row level security;
alter table public.assignment_resources enable row level security;
alter table public.assignment_submissions enable row level security;

revoke all on table public.assignments from anon, authenticated;
revoke all on table public.assignment_rubrics from anon, authenticated;
revoke all on table public.assignment_resources from anon, authenticated;
revoke all on table public.assignment_submissions from anon, authenticated;

grant select, insert, update, delete on table public.assignments to service_role;
grant select, insert, update, delete on table public.assignment_rubrics to service_role;
grant select, insert, update, delete on table public.assignment_resources to service_role;
grant select, insert, update, delete on table public.assignment_submissions to service_role;
