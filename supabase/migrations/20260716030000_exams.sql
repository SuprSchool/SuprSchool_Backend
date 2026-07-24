create table public.exam_groups (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  creator_teacher_id uuid not null references public.user_profiles(id) on delete restrict,
  title text not null check (char_length(title) between 1 and 160),
  starts_on date not null,
  ends_on date not null,
  state text not null default 'draft' check (state in ('draft', 'published', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint exam_groups_date_range_check check (ends_on >= starts_on)
);

alter table public.class_exams
  add column if not exists exam_group_id uuid references public.exam_groups(id) on delete cascade,
  add column if not exists teacher_id uuid references public.user_profiles(id) on delete restrict,
  add column if not exists starts_at time,
  add column if not exists ends_at time,
  add column if not exists max_marks double precision,
  add column if not exists syllabus text,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz;

alter table public.class_exams
  add constraint class_exams_time_order_check check (
    (starts_at is null and ends_at is null)
    or (starts_at is not null and ends_at is not null and ends_at > starts_at)
  ),
  add constraint class_exams_max_marks_check check (max_marks is null or max_marks > 0);

create table public.exam_rubrics (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.class_exams(id) on delete cascade,
  position integer not null check (position between 1 and 100),
  section_title text not null check (char_length(section_title) between 1 and 160),
  marks double precision not null check (marks >= 0),
  description text not null check (char_length(description) between 1 and 2000),
  created_at timestamptz not null default now(),
  unique (assessment_id, position)
);

create table public.exam_results (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  assessment_id uuid not null references public.class_exams(id) on delete cascade,
  student_id uuid not null references public.user_profiles(id) on delete cascade,
  entered_by_teacher_id uuid not null references public.user_profiles(id) on delete restrict,
  marks double precision not null check (marks >= 0),
  feedback text check (feedback is null or char_length(feedback) between 1 and 4000),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assessment_id, student_id)
);

create table public.exam_result_revisions (
  id uuid primary key default gen_random_uuid(),
  result_id uuid not null references public.exam_results(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  assessment_id uuid not null references public.class_exams(id) on delete cascade,
  student_id uuid not null references public.user_profiles(id) on delete cascade,
  entered_by_teacher_id uuid not null references public.user_profiles(id) on delete restrict,
  marks double precision not null check (marks >= 0),
  feedback text check (feedback is null or char_length(feedback) between 1 and 4000),
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.exam_resources (

  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  assessment_id uuid not null references public.class_exams(id) on delete cascade,
  upload_session_id uuid not null unique,
  object_path text not null unique,
  display_name text not null check (char_length(display_name) between 1 and 255),
  created_at timestamptz not null default now()
);

create index exam_groups_student_cursor_idx
  on public.exam_groups (school_id, class_id, starts_on desc, id desc)
  where deleted_at is null;

create index class_exams_group_subject_cursor_idx
  on public.class_exams (school_id, exam_group_id, scheduled_on desc, id desc)
  where is_published and deleted_at is null;

create index class_exams_teacher_cursor_idx
  on public.class_exams (school_id, teacher_id, scheduled_on desc, id desc)
  where deleted_at is null;

create index exam_results_assessment_cursor_idx
  on public.exam_results (assessment_id, updated_at desc, id desc);

create index exam_results_group_leaderboard_idx
  on public.exam_results (school_id, assessment_id, student_id, marks);

create index exam_result_revisions_result_created_idx
  on public.exam_result_revisions (result_id, created_at desc, id desc);


create index exam_resources_assessment_created_idx
  on public.exam_resources (school_id, assessment_id, created_at desc, id desc);

alter table public.exam_groups enable row level security;
alter table public.class_exams enable row level security;
alter table public.exam_rubrics enable row level security;
alter table public.exam_results enable row level security;
alter table public.exam_result_revisions enable row level security;
alter table public.exam_resources enable row level security;

revoke all on table public.exam_groups from anon, authenticated;
revoke all on table public.class_exams from anon, authenticated;
revoke all on table public.exam_rubrics from anon, authenticated;
revoke all on table public.exam_results from anon, authenticated;
revoke all on table public.exam_result_revisions from anon, authenticated;
revoke all on table public.exam_resources from anon, authenticated;

grant select, insert, update, delete on table public.exam_groups to service_role;
grant select, insert, update, delete on table public.class_exams to service_role;
grant select, insert, update, delete on table public.exam_rubrics to service_role;
grant select, insert, update, delete on table public.exam_results to service_role;
grant select, insert, update, delete on table public.exam_result_revisions to service_role;
grant select, insert, update, delete on table public.exam_resources to service_role;
