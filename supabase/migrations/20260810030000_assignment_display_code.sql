alter table public.assignments
  add column if not exists display_code text;

create unique index if not exists assignments_display_code_per_school
  on public.assignments (school_id, display_code);

comment on column public.assignments.display_code is
  'Human-readable code (ASG-<year>-<seq>) printed on the success screen (Figma 833:9534). Assigned on insert; null for pre-existing rows, which display their UUID as before.';
