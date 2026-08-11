-- QA seed for the plan2b device-QA pass (2026-08-11).
-- Applied to the dev database by the final-review fix wave; kept here so a
-- database reset can reproduce the QA fixtures. All statements are additive
-- and idempotent (on conflict do nothing). Values marked DEV PLACEHOLDER
-- should be replaced with the school's real data by the owner.

insert into public.school_profiles
  (school_id, address, description, rules_intro, rules, phone, support_email)
values (
  '20000000-0000-4000-8000-000000000001',
  'DEV PLACEHOLDER - replace with the school''s real street address',
  array[
    'DEV PLACEHOLDER - replace with the school''s real description.',
    'Riverside International School, Class 9 - B QA tenant.'
  ],
  'DEV PLACEHOLDER - replace with the school''s real rules introduction.',
  array[
    'School hours are 08:15 to 15:30, Monday to Friday.',
    'Uniform is required on all working days.',
    'Absences must be reported to the class teacher before 09:00.'
  ],
  '+911234567890',
  'support@riverside-dev.example'
)
on conflict (school_id) do nothing;
insert into public.exam_groups
  (id, school_id, class_id, creator_teacher_id, title, starts_on, ends_on, state)
values (
  '86000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'Unit Tests - Term 2',
  date '2026-08-11', date '2026-08-21', 'published'
)
on conflict (id) do nothing;

insert into public.class_exams
  (id, school_id, class_id, subject_id, teacher_id, exam_group_id, title,
   scheduled_on, starts_at, ends_at, max_marks, syllabus, is_published, published_at)
values
  ('87000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001',
   '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000003',
   '10000000-0000-4000-8000-000000000001', '86000000-0000-4000-8000-000000000002',
   'Unit Test 2 - Mathematics', date '2026-08-11', time '09:00:00', time '10:00:00', 50,
   'Quadratic equations. Coordinate geometry. Statistics revision.', true, now()),
  ('87000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001',
   '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000004',
   '10000000-0000-4000-8000-000000000001', '86000000-0000-4000-8000-000000000002',
   'Unit Test 2 - Physics', date '2026-08-12', time '14:00:00', time '15:30:00', 40,
   'Laws of motion. Work, power and energy.', true, now()),
  ('87000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000001',
   '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001', '86000000-0000-4000-8000-000000000002',
   'Unit Test 2 - English', date '2026-08-18', time '10:00:00', time '11:00:00', 30,
   'Prose comprehension. Formal letter writing.', true, now())
on conflict (id) do nothing;

insert into public.exam_rubrics (assessment_id, position, section_title, marks, description)
values
  ('87000000-0000-4000-8000-000000000003', 1, 'Quadratic equations', 30, 'Solve and verify roots, showing each step.'),
  ('87000000-0000-4000-8000-000000000003', 2, 'Coordinate geometry', 20, 'Distance, section formula and area of a triangle.'),
  ('87000000-0000-4000-8000-000000000004', 1, 'Laws of motion', 25, 'State each law and apply it to a worked example.'),
  ('87000000-0000-4000-8000-000000000004', 2, 'Work and energy', 15, 'Numerical problems on work, power and energy.'),
  ('87000000-0000-4000-8000-000000000005', 1, 'Comprehension', 20, 'Answer in complete sentences with textual support.'),
  ('87000000-0000-4000-8000-000000000005', 2, 'Letter writing', 10, 'Correct format, tone and register.')
on conflict do nothing;
