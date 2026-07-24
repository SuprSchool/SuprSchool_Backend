-- Phase 1 read paths are always tenant-scoped.  These composite indexes keep
-- attendance history and roster reads index-backed as each school grows.
create index if not exists attendance_sessions_school_class_date_id_index
  on public.attendance_sessions (school_id, class_id, attendance_date desc, id desc);

create index if not exists attendance_records_session_status_student_index
  on public.attendance_records (session_id, status, student_id);

create index if not exists class_members_school_class_active_roll_index
  on public.class_members (school_id, class_id, is_active, roll_number, student_id);
