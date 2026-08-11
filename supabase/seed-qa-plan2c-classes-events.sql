-- QA seed for the multi-class teacher pass (2026-08-12).
-- Sibling of seed-qa-plan2b.sql, kept here so a database reset can reproduce
-- the fixtures. Every statement is additive and idempotent (on conflict do
-- nothing / where not exists) and nothing here deletes or rewrites a row that
-- an earlier seed created.
--
-- What it builds, against the existing Riverside International School tenant:
--   * 4 subjects, 4 classes in the current academic year
--   * 215 student profiles with roll numbers and class memberships
--   * subject assignments that put teacher +917755090948 in 5 classes
--   * 6 events spanning the upcoming / registered / completed student tabs
--   * a published contact number for the My Class call button
--
-- ---------------------------------------------------------------------------
-- Deterministic UUID scheme
-- ---------------------------------------------------------------------------
-- Re-running this file must not duplicate anything, so every row carries a
-- computed primary key rather than gen_random_uuid(). The prefix says what the
-- row is; the last 12 hex digits say which one.
--
--   11000000-…-CCSSSSSSSSSS  user_profiles   (seeded student)
--   12000000-…-CCSSSSSSSSSS  user_roles      (that student's student role)
--   13000000-…-CCSSSSSSSSSS  class_members   (that student's membership)
--   41000000-…-00000000000N  classes          N = 1..4
--   42000000-…-0000000000NN  class_subjects
--   51000000-…-0000000000NN  subjects
--   88000000-…-0000000000NN  events
--   89000000-…-EE00000000NN  event_registrations   EE = event number
--   8a000000-…-EE00000000NN  event_result_entries  EE = event number
--
-- In the student keys CC is the class number (01..04) zero-padded to 2 and
-- SSSSSSSSSS is 00000 + the 5-digit roll sequence, so student 7 of class 3 is
-- always 11000000-0000-4000-8000-030000000007. Because the key encodes both
-- numbers, user_roles and class_members derive themselves from
-- public.user_profiles by rewriting the prefix instead of repeating the roster.
--
-- ---------------------------------------------------------------------------
-- Why this seed touches auth.users
-- ---------------------------------------------------------------------------
-- public.user_profiles.id is FOREIGN KEY (id) REFERENCES auth.users(id), so a
-- profile cannot exist without an auth row and a roster cannot be seeded at the
-- profile level alone. (The constraint is invisible in information_schema,
-- which hides constraints referencing a table the querying role cannot see;
-- pg_constraint shows it.)
--
-- Each seeded student therefore gets an auth.users row carrying ONLY an id.
-- No password, no email, no phone, no auth.identities row: the account is not
-- addressable by any sign-in path and no credential exists to present. That
-- satisfies the constraint without creating 215 loginable accounts.
--
-- Seeded students also get NO school_directory_entries row. The roster read
-- path is class_members -> user_profiles (see
-- src/db/repositories/student-class-context.repository.ts and
-- teacher-classes.repository.ts) and never consults the directory, while a
-- directory row would make the number claimable at signup - not something a
-- fixture should do.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1. Subjects
-- ---------------------------------------------------------------------------
-- Widens the pool beyond the five plan2b subjects so four classes can carry
-- distinct timetables and a second teacher has something to teach.
insert into public.subjects (id, school_id, code, name)
values
  ('51000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'HIN', 'Hindi'),
  ('51000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'GEO', 'Geography'),
  ('51000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'BIO', 'Biology'),
  ('51000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', 'CHE', 'Chemistry')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Classes
-- ---------------------------------------------------------------------------
-- Class 9 - B already exists from the plan2b seed and is left untouched; these
-- four are new sections in the same current academic year.
insert into public.classes (id, school_id, academic_year_id, grade, section, display_name)
select v.id, v.school_id, ay.id, v.grade, v.section, v.display_name
from (values
  ('41000000-0000-4000-8000-000000000001'::uuid, '20000000-0000-4000-8000-000000000001'::uuid, '8',  'A', 'Class 8 - A'),
  ('41000000-0000-4000-8000-000000000002'::uuid, '20000000-0000-4000-8000-000000000001'::uuid, '9',  'A', 'Class 9 - A'),
  ('41000000-0000-4000-8000-000000000003'::uuid, '20000000-0000-4000-8000-000000000001'::uuid, '10', 'A', 'Class 10 - A'),
  ('41000000-0000-4000-8000-000000000004'::uuid, '20000000-0000-4000-8000-000000000001'::uuid, '10', 'B', 'Class 10 - B')
) as v(id, school_id, grade, section, display_name)
join public.academic_years ay
  on ay.school_id = v.school_id and ay.is_current
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Students -> supabase/seed-qa-plan2c-roster.sql
-- ---------------------------------------------------------------------------
-- The 215 student rows are NOT in this file. public.user_profiles.id references
-- auth.users(id), so each one needs an auth shell first, and this repo keeps
-- auth-user creation out of seed SQL and behind an explicitly confirmed script
-- (scripts/provision-qa-auth-users.ts; test/qa-auth-provisioning-seed.test.ts
-- asserts supabase/seed.sql carries no `auth.` reference at all).
--
-- Everything in THIS file is public-schema only and applies standalone, which is
-- what makes the class switcher and the events tabs reproducible from a reset
-- without provisioning 215 accounts. For the rosters, run
-- scripts/seed-qa-roster-students.ts with QA_PROVISION_CONFIRM=1.

-- ---------------------------------------------------------------------------
-- 4. Teaching assignments
-- ---------------------------------------------------------------------------
-- A teacher's classes come from class_subjects.teacher_id (see
-- src/db/repositories/teacher-classes.repository.ts). A teacher with no
-- class_subjects row has no reachable content at all - that is why Mr. Alok's
-- content was unreachable - so this is the row that makes the class switcher
-- real.
--
-- 10000000-…-0001 is +917755090948. It already teaches 5 subjects in Class 9-B
-- from the plan2b seed; these 12 rows add 4 more classes, giving 5 classes to
-- switch between.
-- 10000000-…-0002 is Mr. Alok, who gets 4 rows so the rosters show a second
-- teacher and so the My Class teacher list has one row with a published contact
-- number and one without.
insert into public.class_subjects (id, school_id, class_id, subject_id, teacher_id)
values
  -- Class 8 - A
  ('42000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001'),
  ('42000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001'),
  ('42000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'),
  ('42000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'),
  -- Class 9 - A
  ('42000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001'),
  ('42000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001'),
  ('42000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001'),
  ('42000000-0000-4000-8000-000000000008', '20000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'),
  -- Class 10 - A
  ('42000000-0000-4000-8000-000000000009', '20000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001'),
  ('42000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001'),
  ('42000000-0000-4000-8000-00000000000b', '20000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001'),
  ('42000000-0000-4000-8000-00000000000c', '20000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'),
  ('42000000-0000-4000-8000-00000000000d', '20000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002'),
  -- Class 10 - B
  ('42000000-0000-4000-8000-00000000000e', '20000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001'),
  ('42000000-0000-4000-8000-00000000000f', '20000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001'),
  -- Class 9 - B: a second teacher on the QA student's own class, so the My Class
  -- teacher list carries both a row with a number and a row without one.
  ('42000000-0000-4000-8000-000000000010', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002')
on conflict (class_id, subject_id) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Published contact number
-- ---------------------------------------------------------------------------
-- Feeds the My Class teacher call button (Figma 253:10699) through
-- user_profiles.contact_phone_e164, added by
-- supabase/migrations/20260812010000_user_profile_contact_phone.sql.
--
-- This is NOT the teacher's login number: they sign in with +917755090948 and
-- publish +917755090942. The two are separate columns for exactly that reason.
-- Mr. Alok is deliberately left null so the "no number" branch stays testable.
update public.user_profiles
set contact_phone_e164 = '+917755090942'
where id = '10000000-0000-4000-8000-000000000001'::uuid
  and school_id = '20000000-0000-4000-8000-000000000001'::uuid
  and contact_phone_e164 is distinct from '+917755090942';

-- ---------------------------------------------------------------------------
-- 6. Events
-- ---------------------------------------------------------------------------
-- Student tab rules, from src/db/repositories/drizzle-events.repository.ts:
--   trending  = published, not yet ended, not registered
--   upcoming  = published, not yet ended
--   registered= published, not yet ended, registered
--   completed = lifecycle 'completed' OR already ended
-- A student sees an event when audience_type='school' or their class is listed
-- in event_audiences. Timestamps are relative to now() so the fixture keeps
-- landing in the right tab however long after seeding it is read.
insert into public.events
  (id, school_id, created_by_teacher_id, activity_kind, audience_type, category,
   participation_mode, title, description, venue, gender_eligibility,
   rules_and_regulations, eligibility_criteria, starts_at, ends_at,
   registration_deadline_at, lifecycle, results_published_at, results_revision)
values
  ('88000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001', 'event', 'school', 'Sports', null,
   'Annual Sports Day',
   'Track and field finals, relay races and the inter-house championship. Parents are welcome from 09:00.',
   'Main Ground', 'mixed',
   'Report to the assembly point 20 minutes before your event. Spikes are not permitted on the synthetic track.',
   'Open to all classes.',
   now() + interval '10 days', now() + interval '10 days 8 hours',
   now() + interval '7 days', 'published', null, 0),

  ('88000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001', 'competition', 'school', 'Academics', 'solo',
   'Inter-House Science Quiz',
   'Six rounds covering physics, chemistry and biology from the current syllabus. Buzzer round decides ties.',
   'Auditorium', 'mixed',
   'No electronic devices. A wrong answer on the buzzer round carries a negative mark.',
   'Classes 8 to 10.',
   now() + interval '4 days', now() + interval '4 days 3 hours',
   now() + interval '2 days', 'published', null, 0),

  ('88000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001', 'competition', 'classes', 'Academics', 'solo',
   'Mathematics Olympiad - Grade 9',
   'Ninety minutes, fifteen problems on algebra, geometry and number theory. Top three advance to the regional round.',
   'Room 204', 'mixed',
   'Non-programmable calculators only. Rough sheets are provided and must be handed back.',
   'Grade 9 sections only.',
   now() + interval '6 days', now() + interval '6 days 90 minutes',
   now() + interval '4 days', 'published', null, 0),

  ('88000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001', 'event', 'school', 'Cultural', null,
   'Annual Day Cultural Fest',
   'Dance, drama and the senior choir, followed by prize distribution.',
   'Open Air Theatre', 'mixed',
   'Rehearsal attendance is compulsory for all performers.',
   'Open to all classes.',
   now() + interval '20 days', now() + interval '20 days 5 hours',
   now() + interval '15 days', 'published', null, 0),

  ('88000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001', 'event', 'school', 'Literary', null,
   'Reading Week',
   'A week of author sessions, a book swap corner and the library reading challenge. Currently running.',
   'Library', 'mixed',
   'Books borrowed for the challenge must be returned by the closing session.',
   'Open to all classes.',
   now() - interval '1 day', now() + interval '3 days',
   now() - interval '2 days', 'published', null, 0),

  ('88000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001', 'competition', 'school', 'Sports', 'solo',
   'Junior Chess Championship',
   'Seven-round Swiss tournament. Results are final and published below.',
   'Activity Hall', 'mixed',
   'Touch-move applies. Each game is 25 minutes plus a 10 second increment.',
   'Classes 8 to 10.',
   now() - interval '14 days', now() - interval '13 days',
   now() - interval '16 days', 'completed', now() - interval '12 days', 1)
on conflict (id) do nothing;

-- Class-scoped audience for the Grade 9 olympiad. audience_type='classes'
-- requires between 1 and 100 rows here; the check is a deferred constraint
-- trigger, so it is validated at commit rather than at insert.
insert into public.event_audiences (id, school_id, event_id, class_id)
values
  ('8b000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
   '88000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000001'),
  ('8b000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001',
   '88000000-0000-4000-8000-000000000003', '41000000-0000-4000-8000-000000000002')
on conflict (event_id, class_id) do nothing;

-- Registrations. cac9609e-… is the QA student (+917230962182); registering them
-- for the upcoming quiz and the running Reading Week makes the Registered tab
-- non-empty, and for the finished championship puts them on the leaderboard.
insert into public.event_registrations (id, school_id, event_id, student_id, participation_tag)
values
  ('89000000-0000-4000-8000-020000000001', '20000000-0000-4000-8000-000000000001',
   '88000000-0000-4000-8000-000000000002', 'cac9609e-237b-4985-9d92-f4819a093618', 'Individual'),
  ('89000000-0000-4000-8000-050000000001', '20000000-0000-4000-8000-000000000001',
   '88000000-0000-4000-8000-000000000005', 'cac9609e-237b-4985-9d92-f4819a093618', 'Individual'),
  ('89000000-0000-4000-8000-060000000001', '20000000-0000-4000-8000-000000000001',
   '88000000-0000-4000-8000-000000000006', 'cac9609e-237b-4985-9d92-f4819a093618', 'Individual'),
  ('89000000-0000-4000-8000-060000000002', '20000000-0000-4000-8000-000000000001',
   '88000000-0000-4000-8000-000000000006', '11000000-0000-4000-8000-010000000001', 'Individual'),
  ('89000000-0000-4000-8000-060000000003', '20000000-0000-4000-8000-000000000001',
   '88000000-0000-4000-8000-000000000006', '11000000-0000-4000-8000-010000000002', 'Individual'),
  ('89000000-0000-4000-8000-060000000004', '20000000-0000-4000-8000-000000000001',
   '88000000-0000-4000-8000-000000000006', '11000000-0000-4000-8000-020000000001', 'Individual'),
  ('89000000-0000-4000-8000-060000000005', '20000000-0000-4000-8000-000000000001',
   '88000000-0000-4000-8000-000000000006', '11000000-0000-4000-8000-030000000001', 'Individual'),
  ('89000000-0000-4000-8000-060000000006', '20000000-0000-4000-8000-000000000001',
   '88000000-0000-4000-8000-000000000006', '11000000-0000-4000-8000-040000000001', 'Individual'),
  -- A few classmates on the upcoming quiz so its participant list is not just
  -- the QA student.
  ('89000000-0000-4000-8000-020000000002', '20000000-0000-4000-8000-000000000001',
   '88000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-010000000003', 'Individual'),
  ('89000000-0000-4000-8000-020000000003', '20000000-0000-4000-8000-000000000001',
   '88000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-020000000002', 'Individual')
on conflict (event_id, student_id) do nothing;

-- Leaderboard for the finished championship. Ranks are dense, and the top two
-- deliberately tie on 92 so the leaderboard's equal-rank rendering is covered:
-- both are dense_rank 1 and the next score down is dense_rank 2.
insert into public.event_result_entries
  (id, school_id, event_id, target_type, registration_id, score, dense_rank, revision)
values
  ('8a000000-0000-4000-8000-060000000002', '20000000-0000-4000-8000-000000000001',
   '88000000-0000-4000-8000-000000000006', 'registration', '89000000-0000-4000-8000-060000000002', 92, 1, 1),
  ('8a000000-0000-4000-8000-060000000003', '20000000-0000-4000-8000-000000000001',
   '88000000-0000-4000-8000-000000000006', 'registration', '89000000-0000-4000-8000-060000000003', 92, 1, 1),
  ('8a000000-0000-4000-8000-060000000001', '20000000-0000-4000-8000-000000000001',
   '88000000-0000-4000-8000-000000000006', 'registration', '89000000-0000-4000-8000-060000000001', 88, 2, 1),
  ('8a000000-0000-4000-8000-060000000004', '20000000-0000-4000-8000-000000000001',
   '88000000-0000-4000-8000-000000000006', 'registration', '89000000-0000-4000-8000-060000000004', 85, 3, 1),
  ('8a000000-0000-4000-8000-060000000005', '20000000-0000-4000-8000-000000000001',
   '88000000-0000-4000-8000-000000000006', 'registration', '89000000-0000-4000-8000-060000000005', 79, 4, 1),
  ('8a000000-0000-4000-8000-060000000006', '20000000-0000-4000-8000-000000000001',
   '88000000-0000-4000-8000-000000000006', 'registration', '89000000-0000-4000-8000-060000000006', 74, 5, 1)
on conflict (id) do nothing;

commit;
