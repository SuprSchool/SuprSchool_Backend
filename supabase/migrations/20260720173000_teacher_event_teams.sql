alter table public.event_teams
  alter column created_by_student_id drop not null;

alter table public.event_teams
  add column created_by_teacher_id uuid references public.user_profiles(id) on delete restrict;

alter table public.event_teams
  add constraint event_teams_exactly_one_creator_check check (
    (created_by_student_id is not null and created_by_teacher_id is null)
    or (created_by_student_id is null and created_by_teacher_id is not null)
  );

create index event_teams_created_by_teacher_idx
  on public.event_teams (school_id, created_by_teacher_id, event_id)
  where created_by_teacher_id is not null;
