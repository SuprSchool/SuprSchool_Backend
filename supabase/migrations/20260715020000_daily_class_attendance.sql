-- Attendance is one class-level register per calendar day.  Do not silently
-- collapse subject-level sessions from an older deployment: an operator must
-- resolve those conflicts explicitly before this migration can continue.
do $$
begin
  if exists (
    select 1
    from (
      select class_id, attendance_date
      from public.attendance_sessions
      group by class_id, attendance_date
      having count(*) > 1
    ) as conflicting_sessions
  ) then
    raise exception
      'cannot convert attendance_sessions to daily class attendance while multiple subject sessions exist for one class/date';
  end if;
end $$;

alter table public.attendance_sessions
  drop constraint if exists attendance_sessions_class_id_subject_id_attendance_date_key;

alter table public.attendance_sessions
  drop column if exists subject_id;

alter table public.attendance_sessions
  add constraint attendance_sessions_class_date_unique
  unique (class_id, attendance_date);

create index if not exists attendance_sessions_school_class_date_id_index
  on public.attendance_sessions (school_id, class_id, attendance_date desc, id desc);
