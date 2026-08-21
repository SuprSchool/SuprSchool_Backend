-- Assignment banner attachments and alphabetic grading.
--
-- Two independent gaps found in live testing, shipped together because both are
-- pure column additions on the assignments aggregate:
--
--   1. A teacher-uploaded banner image had nowhere to live, so it landed in the
--      general resources list and the detail screens drew it as a file tile
--      instead of a header image.
--   2. `grading_type = 'Alphabetic'` was storable on the assignment but not on
--      the submission: `assignment_submissions` had only a numeric `marks`
--      column, so an alphabetic assignment could never be graded at all and the
--      grading screen fell back to a numeric "0/0".

-- 1 ---------------------------------------------------------------- banner role

alter table public.assignment_resources
  add column if not exists role text not null default 'resource';

alter table public.assignment_resources
  drop constraint if exists assignment_resources_role_check;

alter table public.assignment_resources
  add constraint assignment_resources_role_check
  check (role in ('banner', 'resource'));

-- At most one banner per assignment, enforced in the database rather than only
-- in the service: the confirm path can run concurrently for two uploads and a
-- read-then-insert check would let both through.
create unique index if not exists assignment_resources_one_banner_per_assignment
  on public.assignment_resources (assignment_id)
  where role = 'banner';

comment on column public.assignment_resources.role is
  'banner = the assignment header image surfaced as AssignmentDetail.bannerUrl and excluded from the resources list; resource = an ordinary attachment. Defaults to resource, which is what every pre-existing row is.';

-- 2 --------------------------------------------------------------- letter grade

alter table public.assignment_submissions
  add column if not exists letter_grade text;

alter table public.assignment_submissions
  drop constraint if exists assignment_submissions_letter_grade_check;

alter table public.assignment_submissions
  add constraint assignment_submissions_letter_grade_check
  check (letter_grade is null or letter_grade in ('A+', 'A', 'B+', 'B', 'C+', 'C', 'D', 'E', 'F'));

-- The grade shape check previously read "marks, graded_at and graded_by are all
-- null or all not null", which made an alphabetic grade unrepresentable: it has
-- a grader and a graded instant but no marks. Widened so that a graded row
-- carries exactly one of marks / letter_grade, and an ungraded row still
-- carries neither. Every existing row has letter_grade null, so all of them
-- satisfy this unchanged.
alter table public.assignment_submissions
  drop constraint if exists assignment_submissions_grade_shape_check;

alter table public.assignment_submissions
  add constraint assignment_submissions_grade_shape_check
  check (
    (
      marks is null
      and letter_grade is null
      and graded_at is null
      and graded_by_teacher_id is null
    )
    or (
      num_nonnulls(marks, letter_grade) = 1
      and graded_at is not null
      and graded_by_teacher_id is not null
    )
  );

comment on column public.assignment_submissions.letter_grade is
  'The letter awarded on an assignment whose grading_type is Alphabetic. Mutually exclusive with marks (see assignment_submissions_grade_shape_check); null on every numeric submission and on every ungraded row.';
