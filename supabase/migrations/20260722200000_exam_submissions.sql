create table if not exists public.exam_submissions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  assessment_id uuid not null references public.class_exams(id) on delete cascade,
  student_id uuid not null references public.user_profiles(id) on delete cascade,
  recorded_by_teacher_id uuid not null references public.user_profiles(id) on delete restrict,
  submitted_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint exam_submissions_assessment_student_unique unique (assessment_id, student_id)
);

create index if not exists exam_submissions_assessment_submitted_idx
  on public.exam_submissions (school_id, assessment_id, submitted_at desc, student_id);

-- Existing grades are conclusive evidence that the corresponding exam was submitted.
-- This backfill preserves the original first-grade time and makes the migration safe
-- for projects that already contain Task 5 result data.
insert into public.exam_submissions (
  school_id,
  assessment_id,
  student_id,
  recorded_by_teacher_id,
  submitted_at
)
select
  result.school_id,
  result.assessment_id,
  result.student_id,
  result.entered_by_teacher_id,
  result.created_at
from public.exam_results result
join public.class_exams assessment
  on assessment.id = result.assessment_id
  and assessment.school_id = result.school_id
join public.class_members member
  on member.school_id = result.school_id
  and member.class_id = assessment.class_id
  and member.student_id = result.student_id
on conflict (assessment_id, student_id) do nothing;

alter table public.exam_submissions enable row level security;

revoke all on table public.exam_submissions from anon, authenticated;
grant select, insert, update, delete on table public.exam_submissions to service_role;
