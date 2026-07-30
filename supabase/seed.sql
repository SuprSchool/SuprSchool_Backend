-- Reproducible, Auth-safe base QA seed for the Supabase test project.
-- Run `npm run provision:qa-auth` separately to create supported Auth users
-- and their role-owned public fixtures. This SQL intentionally never writes
-- to Supabase Auth tables.

begin;

insert into public.schools (id, name, school_code)
values ('20000000-0000-4000-8000-000000000001', 'Riverside International School', 'RIVERSIDE-QA')
on conflict (id) do update set name = excluded.name, school_code = excluded.school_code;

insert into public.academic_years (id, school_id, name, starts_on, ends_on, is_current)
values ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '2025-2026', '2025-04-01', '2026-03-31', true)
on conflict (id) do update set is_current = excluded.is_current;

insert into public.classes (id, school_id, academic_year_id, grade, section, display_name)
values ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '9', 'B', 'Class 9 - B')
on conflict (id) do update set display_name = excluded.display_name;

insert into public.subjects (id, school_id, code, name) values
  ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'ENG', 'English'),
  ('50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'HIS', 'History'),
  ('50000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'MAT', 'Mathematics'),
  ('50000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', 'PHY', 'Physics'),
  ('50000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000001', 'CSE', 'Computer Science')
on conflict (id) do update set name = excluded.name;

-- These entries are safe to replay before provisioning because no Auth user
-- ID is manufactured or linked here.
insert into public.school_directory_entries (id, school_id, phone_e164, role, display_name, roll_number, employee_code, student_class_id, status)
values
  ('60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '+917755090948', 'student', 'QA Student', '09B-001', null, '40000000-0000-4000-8000-000000000001', 'unclaimed'),
  ('60000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '+919000000001', 'teacher', 'Mr. Alok', null, 'T-001', null, 'unclaimed')
on conflict (phone_e164) do nothing;

insert into public.class_schedule_slots (school_id, class_id, subject_id, day_of_week, start_time, end_time, room) values
  ('20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000003', 1, '08:00', '08:45', 'Room 9B'),
  ('20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 1, '08:50', '09:35', 'Room 9B'),
  ('20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002', 2, '09:00', '09:45', 'Room 9B'),
  ('20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000004', 3, '10:00', '10:45', 'Lab 2'),
  ('20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000005', 4, '11:00', '11:45', 'Computer Lab')
on conflict (class_id, day_of_week, start_time) do nothing;

insert into public.point_level_rules (school_id, level, minimum_points) values
  ('20000000-0000-4000-8000-000000000001', 1, 0),
  ('20000000-0000-4000-8000-000000000001', 2, 100),
  ('20000000-0000-4000-8000-000000000001', 3, 250)
on conflict (school_id, level) do update set minimum_points = excluded.minimum_points;

insert into public.point_earning_rules (school_id, code, label, icon, points, sort_order) values
  ('20000000-0000-4000-8000-000000000001', 'assignment_submission', 'Submit an assignment', 'document', 15, 1),
  ('20000000-0000-4000-8000-000000000001', 'event_registration', 'Register for an event', 'calendar', 10, 2),
  ('20000000-0000-4000-8000-000000000001', 'attendance_streak', 'Attendance streak', 'fire', 20, 3)
on conflict (school_id, code) do update set points = excluded.points, is_active = true;

commit;
