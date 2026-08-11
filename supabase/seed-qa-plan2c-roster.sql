-- Student roster for the plan2c QA classes (2026-08-12).
--
-- Split out of seed-qa-plan2c-classes-events.sql because these rows have a
-- prerequisite that seed SQL must not satisfy for itself: public.user_profiles.id
-- is FOREIGN KEY (id) REFERENCES auth.users(id), so every student row needs an
-- auth user to exist first.
--
-- This repo deliberately keeps auth-user creation out of seed SQL and behind an
-- explicitly confirmed script -- see scripts/provision-qa-auth-users.ts and the
-- assertion in test/qa-auth-provisioning-seed.test.ts that supabase/seed.sql
-- contains no `auth.` reference at all. This file follows that rule: it touches
-- only the public schema.
--
-- ORDER MATTERS. Applied on its own against a database with no auth shells this
-- file fails on user_profiles_id_fkey -- loudly, and inside a transaction, so it
-- leaves nothing behind. Run scripts/seed-qa-roster-students.ts with
-- QA_PROVISION_CONFIRM=1 first: it creates the 215 auth shells and then applies
-- this file. Re-running either is safe; every statement is idempotent.
--
-- UUID scheme, and why user_roles/class_members derive themselves from the
-- profile id, are documented in the header of seed-qa-plan2c-classes-events.sql.

begin;
-- ---------------------------------------------------------------------------
-- Student roster rows
-- ---------------------------------------------------------------------------
-- 55 / 52 / 58 / 50 = 215 profiles. Names are drawn from a 61-name given pool
-- and a 24-name surname pool indexed by (g mod 61, 7g mod 24) where g is the
-- 0-based global student index. gcd(7,24)=1 and lcm(61,24)=1464 > 215, so every
-- student gets a distinct given/surname pair.
--
-- phone_e164 is NOT NULL on user_profiles, so each profile gets a synthetic
-- +9190XXXXXXXX number. It is not a directory entry and cannot be signed in
-- with; it exists only to satisfy the column.
--
insert into public.user_profiles (id, school_id, display_name, phone_e164)
select
  ('11000000-0000-4000-8000-'
     || lpad(b.class_no::text, 2, '0') || '00000' || lpad(b.seq::text, 5, '0'))::uuid,
  '20000000-0000-4000-8000-000000000001'::uuid,
  b.given || ' ' || b.surname,
  '+9190' || lpad(b.class_no::text, 2, '0') || lpad(b.seq::text, 6, '0')
from (
  select
    r.class_no,
    s.seq,
    n.given_pool[((r.offset_before + s.seq - 1) % 61) + 1]        as given,
    n.surname_pool[(((r.offset_before + s.seq - 1) * 7) % 24) + 1] as surname
  from (values
    (1, 55,   0),
    (2, 52,  55),
    (3, 58, 107),
    (4, 50, 165)
  ) as r(class_no, student_count, offset_before)
  cross join lateral generate_series(1, r.student_count) as s(seq)
  cross join (select
    array[
      'Aarav','Aditi','Advait','Ananya','Anirudh','Anjali','Arjun','Ayesha',
      'Bhavya','Chaitanya','Charu','Darshan','Devika','Dhruv','Diya','Esha',
      'Farhan','Gauri','Harsh','Ibrahim','Ishaan','Ishita','Jatin','Kabir',
      'Kavya','Keerthi','Krishna','Lakshmi','Madhav','Mahira','Manav','Meera',
      'Mihir','Naina','Neel','Nikhil','Nithya','Om','Pallavi','Parth',
      'Pooja','Pranav','Priya','Rachit','Radhika','Rahul','Riya','Rohan',
      'Ruhi','Sahil','Sanya','Shreya','Siddharth','Simran','Sneha','Tanvi',
      'Tara','Uday','Varun','Vedika','Yash'
    ]::text[] as given_pool,
    array[
      'Agarwal','Banerjee','Chatterjee','Deshpande','Fernandes','Gupta',
      'Iyer','Joshi','Kulkarni','Malhotra','Menon','Nair',
      'Patel','Pillai','Rao','Reddy','Saxena','Sharma',
      'Shetty','Singh','Trivedi','Varma','Verma','Yadav'
    ]::text[] as surname_pool
  ) n
) b
on conflict (id) do nothing;

-- Each seeded student needs an active student role for the school. The student
-- read paths all join user_roles (role='student' and is_active) before they
-- will return a membership.
insert into public.user_roles (id, user_id, school_id, role, is_active)
select
  ('12000000-0000-4000-8000-' || right(up.id::text, 12))::uuid,
  up.id,
  up.school_id,
  'student',
  true
from public.user_profiles up
where up.school_id = '20000000-0000-4000-8000-000000000001'::uuid
  and up.id::text like '11000000-0000-4000-8000-%'
on conflict (user_id, school_id, role) do nothing;

-- Memberships, derived from the same key. The class number and roll sequence
-- are read back out of the profile id rather than restated.
insert into public.class_members
  (id, school_id, class_id, student_id, academic_year_id, roll_number, is_active)
select
  ('13000000-0000-4000-8000-' || right(up.id::text, 12))::uuid,
  up.school_id,
  c.id,
  up.id,
  ay.id,
  -- ::int first: lpad() truncates when the input is longer than the target
  -- width, so lpad('00001', 3, '0') would yield '000', not '001'.
  lpad(c.grade, 2, '0') || c.section || '-'
    || lpad(substr(right(up.id::text, 12), 8, 5)::int::text, 3, '0'),
  true
from public.user_profiles up
join lateral (
  select ('41000000-0000-4000-8000-'
    || lpad(substr(right(up.id::text, 12), 1, 2), 12, '0'))::uuid as class_id
) k on true
join public.classes c on c.id = k.class_id and c.school_id = up.school_id
join public.academic_years ay on ay.school_id = up.school_id and ay.is_current
where up.school_id = '20000000-0000-4000-8000-000000000001'::uuid
  and up.id::text like '11000000-0000-4000-8000-%'
on conflict (student_id, academic_year_id) do nothing;

commit;
