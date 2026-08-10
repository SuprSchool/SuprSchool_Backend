alter table public.assignment_submissions
  add column if not exists completed_at timestamptz;

comment on column public.assignment_submissions.completed_at is
  'Set by Mark as Complete / cleared by Mark as Incomplete (Figma 668:4935, 667:3525). Independent of grading.';
