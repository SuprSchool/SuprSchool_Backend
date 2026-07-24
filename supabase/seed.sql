-- Reproducible QA seed for the Supabase test project.
-- The records mirror the Riverside International School mock flows without
-- inserting storage objects. Upload-backed resources must be created through
-- the API so their upload-session and Storage metadata stay consistent.
-- Test-only password for both seeded auth users: @Vidy2006

begin;

create extension if not exists "pgcrypto";

do $$
begin
  if not exists (select 1 from auth.users where id = '10000000-0000-4000-8000-000000000001') then
    insert into auth.users (
      id, instance_id, aud, role, encrypted_password, phone,
      phone_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, is_sso_user, is_anonymous
    ) values (
      '10000000-0000-4000-8000-000000000001',
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', crypt('@Vidy2006', gen_salt('bf')),
      '+917755090948', now(),
      '{"provider":"phone","providers":["phone"]}'::jsonb,
      '{"display_name":"QA Student"}'::jsonb,
      now(), now(), false, false
    );
  end if;
  if not exists (select 1 from auth.users where id = '10000000-0000-4000-8000-000000000002') then
    insert into auth.users (
      id, instance_id, aud, role, encrypted_password, phone,
      phone_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, is_sso_user, is_anonymous
    ) values (
      '10000000-0000-4000-8000-000000000002',
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', crypt('@Vidy2006', gen_salt('bf')),
      '+919000000001', now(),
      '{"provider":"phone","providers":["phone"]}'::jsonb,
      '{"display_name":"Mr. Alok"}'::jsonb,
      now(), now(), false, false
    );
  end if;
end $$;

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

insert into public.user_profiles (id, school_id, display_name, phone_e164, avatar_kind, avatar_value)
values
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'QA Student', '+917755090948', 'preset', 'avatar-1'),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'Mr. Alok', '+919000000001', 'preset', 'avatar-2')
on conflict (id) do update set display_name = excluded.display_name, phone_e164 = excluded.phone_e164,
  avatar_kind = excluded.avatar_kind, avatar_value = excluded.avatar_value;

insert into public.user_roles (user_id, school_id, role) values
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'student'),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'teacher')
on conflict (user_id, school_id, role) do update set is_active = true;

insert into public.school_directory_entries (id, school_id, phone_e164, role, display_name, roll_number, employee_code, student_class_id, status, claimed_by_user_id, claimed_at)
values
  ('60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '+917755090948', 'student', 'QA Student', '09B-001', null, '40000000-0000-4000-8000-000000000001', 'claimed', '10000000-0000-4000-8000-000000000001', now()),
  ('60000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '+919000000001', 'teacher', 'Mr. Alok', null, 'T-001', null, 'claimed', '10000000-0000-4000-8000-000000000002', now())
on conflict (id) do update set status = excluded.status, claimed_by_user_id = excluded.claimed_by_user_id, claimed_at = excluded.claimed_at;

insert into public.class_members (school_id, class_id, student_id, academic_year_id, roll_number)
values ('20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '09B-001')
on conflict (student_id, academic_year_id) do update set is_active = true, roll_number = excluded.roll_number;

insert into public.class_subjects (id, school_id, class_id, subject_id, teacher_id) values
  ('70000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'),
  ('70000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'),
  ('70000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002'),
  ('70000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002'),
  ('70000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000002')
on conflict (id) do update set teacher_id = excluded.teacher_id;

insert into public.school_directory_teacher_assignments (school_directory_entry_id, class_id, subject_id)
select '60000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001', id from public.subjects
where school_id = '20000000-0000-4000-8000-000000000001'
on conflict (school_directory_entry_id, class_id, subject_id) do nothing;

insert into public.student_profiles (student_id, date_of_birth)
values ('10000000-0000-4000-8000-000000000001', '2011-08-17')
on conflict (student_id) do update set date_of_birth = excluded.date_of_birth;

insert into public.profile_interests (user_id, interest) values
  ('10000000-0000-4000-8000-000000000001', 'Reading'),
  ('10000000-0000-4000-8000-000000000001', 'Music'),
  ('10000000-0000-4000-8000-000000000001', 'Football'),
  ('10000000-0000-4000-8000-000000000001', 'Drawing'),
  ('10000000-0000-4000-8000-000000000001', 'Technology'),
  ('10000000-0000-4000-8000-000000000002', 'Literature'),
  ('10000000-0000-4000-8000-000000000002', 'Public Speaking')
on conflict (user_id, interest) do nothing;

insert into public.class_schedule_slots (school_id, class_id, subject_id, day_of_week, start_time, end_time, room) values
  ('20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000003', 1, '08:00', '08:45', 'Room 9B'),
  ('20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 1, '08:50', '09:35', 'Room 9B'),
  ('20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002', 2, '09:00', '09:45', 'Room 9B'),
  ('20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000004', 3, '10:00', '10:45', 'Lab 2'),
  ('20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000005', 4, '11:00', '11:45', 'Computer Lab')
on conflict (class_id, day_of_week, start_time) do nothing;

insert into public.class_announcements (id, school_id, class_id, teacher_id, subject_id, category, title, body, is_published, published_at)
values
  ('80000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000001', 'School', 'Winter Break Notice', 'The school will remain closed from 24th December to 2nd January. Classes resume on 3rd January.', true, now()),
  ('80000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000003', 'Class', 'Mathematics Test Rescheduled', 'The Mathematics unit test is rescheduled to 19th December.', true, now())
on conflict (id) do update set title = excluded.title, body = excluded.body, is_published = true, published_at = excluded.published_at;

insert into public.notification_inbox (id, school_id, user_id, notification_type, title, body, data)
values
  ('81000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'announcement', 'Winter Break Notice', 'The school holiday announcement is available.', '{"announcementId":"80000000-0000-4000-8000-000000000001"}'::jsonb),
  ('81000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'assignment', 'New assignment', 'Character Sketch Writing is due soon.', '{}'::jsonb)
on conflict (id) do update set title = excluded.title, body = excluded.body;

insert into public.attendance_sessions (id, school_id, class_id, attendance_date, marked_by_teacher_id)
values ('82000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', current_date, '10000000-0000-4000-8000-000000000002')
on conflict (id) do update set updated_at = now();

insert into public.attendance_records (session_id, student_id, status)
values ('82000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'present')
on conflict (session_id, student_id) do update set status = excluded.status, marked_at = now();

insert into public.class_diary_entries (id, school_id, class_id, class_subject_id, teacher_id, occurred_on, period_label, title, description, key_points)
values
  ('83000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', current_date, '2nd Period', 'Chapter 4 - The Lion King', 'We covered the key events, characters, and the Circle of Life theme.', '["Introduced Simba and Mufasa","Discussed the central theme"]'::jsonb),
  ('83000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', current_date - 1, '4th Period', 'Algebra revision', 'Revision of variables, expressions, and linear equations.', '["Variables","Linear equations"]'::jsonb)
on conflict (id) do update set description = excluded.description, key_points = excluded.key_points;

insert into public.assignments (id, school_id, class_id, subject_id, teacher_id, title, instructions, due_at, is_graded, grading_type, max_marks)
values
  ('84000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'Character Sketch Writing', 'Write a brief character sketch of a protagonist from any chapter discussed in class.', now() + interval '14 days', true, 'Numeric', 35),
  ('84000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'Algebra Practice', 'Solve the assigned linear-equation exercises and show all working.', now() + interval '7 days', true, 'Numeric', 25)
on conflict (id) do update set instructions = excluded.instructions, due_at = excluded.due_at;

insert into public.assignment_rubrics (assignment_id, position, topic, marks, more_info) values
  ('84000000-0000-4000-8000-000000000001', 1, 'Character understanding', 15, 'Explain feelings and development.'),
  ('84000000-0000-4000-8000-000000000001', 2, 'Clarity and writing', 20, 'Use clear paragraphs and examples.')
on conflict (assignment_id, position) do nothing;

insert into public.exam_groups (id, school_id, class_id, creator_teacher_id, title, starts_on, ends_on, state)
values ('86000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'Unit Tests - Term 1', current_date + 3, current_date + 10, 'published')
on conflict (id) do update set state = 'published';

insert into public.class_exams (id, school_id, class_id, subject_id, exam_group_id, teacher_id, title, scheduled_on, starts_at, ends_at, max_marks, syllabus, is_published, published_at)
values
  ('87000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000003', '86000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'Unit Test - Mathematics', current_date + 5, '09:00', '10:00', 50, 'Algebra and linear equations', true, now()),
  ('87000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000004', '86000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'Unit Test - Science', current_date + 8, '10:00', '11:00', 50, 'Kinematics and energy', true, now())
on conflict (id) do update set title = excluded.title, scheduled_on = excluded.scheduled_on, is_published = true, published_at = excluded.published_at;

insert into public.exam_rubrics (assessment_id, position, section_title, marks, description)
values ('87000000-0000-4000-8000-000000000001', 1, 'Algebra', 30, 'Solve equations accurately.'),
       ('87000000-0000-4000-8000-000000000001', 2, 'Reasoning', 20, 'Show clear working.')
on conflict (assessment_id, position) do nothing;

insert into public.exam_submissions (id, school_id, assessment_id, student_id, recorded_by_teacher_id, submitted_at)
values ('88000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '87000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', now() - interval '1 day')
on conflict (assessment_id, student_id) do nothing;

insert into public.exam_results (id, school_id, assessment_id, student_id, entered_by_teacher_id, marks, feedback, published_at)
values ('89000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '87000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 42, 'Strong understanding of the method.', now())
on conflict (assessment_id, student_id) do update set marks = excluded.marks, feedback = excluded.feedback, published_at = excluded.published_at;

insert into public.chat_messages (id, school_id, room_id, sender_id, client_message_id, body)
select v.id, v.school_id, r.id, v.sender_id, v.client_message_id, v.body
from (values
  ('91000000-0000-4000-8000-000000000001'::uuid, '20000000-0000-4000-8000-000000000001'::uuid, '10000000-0000-4000-8000-000000000002'::uuid, '92000000-0000-4000-8000-000000000001'::uuid, 'Ask anything and your teacher will answer it ASAP.'::text),
  ('91000000-0000-4000-8000-000000000002'::uuid, '20000000-0000-4000-8000-000000000001'::uuid, '10000000-0000-4000-8000-000000000001'::uuid, '92000000-0000-4000-8000-000000000002'::uuid, 'Can you explain the variables exercise again?'::text)
) as v(id, school_id, sender_id, client_message_id, body)
join public.chat_rooms r on r.school_id = v.school_id
  and r.class_id = '40000000-0000-4000-8000-000000000001'
  and r.kind = 'class'
on conflict (id) do nothing;

insert into public.chat_read_cursors (school_id, room_id, user_id, last_read_message_id, last_read_at)
select '20000000-0000-4000-8000-000000000001', r.id, '10000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000002', now()
from public.chat_rooms r
where r.school_id = '20000000-0000-4000-8000-000000000001'
  and r.class_id = '40000000-0000-4000-8000-000000000001'
  and r.kind = 'class'
on conflict (school_id, room_id, user_id) do update
set last_read_message_id = excluded.last_read_message_id, last_read_at = excluded.last_read_at;

insert into public.events (id, school_id, created_by_teacher_id, activity_kind, category, participation_mode, title, description, venue, eligibility_criteria, starts_at, ends_at, registration_deadline_at, lifecycle, results_published_at, results_revision)
values ('93000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'competition', 'Curricular Competition', 'solo', 'Drama Club Fest', 'A showcase of student talent featuring plays, skits, and improv sessions.', 'Main Auditorium, Building A', 'Open to Classes 9 and 10.', current_date + 20, current_date + 20 + interval '2 hours', current_date + 14, 'published', null, 0)
on conflict (id) do update set title = excluded.title, lifecycle = excluded.lifecycle;

insert into public.event_audiences (school_id, event_id, class_id)
values ('20000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001')
on conflict (event_id, class_id) do nothing;

insert into public.event_managers (school_id, event_id, user_id, member_type, manager_role)
values ('20000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'teacher', 'Competition Manager')
on conflict (event_id, user_id) do nothing;

insert into public.event_registrations (id, school_id, event_id, student_id, participation_tag)
values ('94000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Solo performance')
on conflict (event_id, student_id) do update set participation_tag = excluded.participation_tag, cancelled_at = null;

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

insert into public.point_ledger_entries (id, school_id, recipient_user_id, source_type, source_id, rule_code, award_key, points, metadata, occurred_at)
values
  ('95000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'assignment_submission', '85000000-0000-4000-8000-000000000001', 'assignment_submission', 'qa-assignment-submission', 15, '{}'::jsonb, now() - interval '2 days'),
  ('95000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'event_registration', '94000000-0000-4000-8000-000000000001', 'event_registration', 'qa-event-registration', 10, '{}'::jsonb, now() - interval '1 day')
on conflict (school_id, award_key) do nothing;

commit;
