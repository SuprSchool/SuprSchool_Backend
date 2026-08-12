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
-- QA_PROVISION_CONFIRM=1 first: it creates the 268 auth shells and then applies
-- this file. Re-running either is safe; every statement is idempotent.
--
-- UUID scheme, and why user_roles/class_members derive themselves from the
-- profile id, are documented in the header of seed-qa-plan2c-classes-events.sql.
--
-- CLASS 5 IS CLASS 9 - B. Roster block 5 fills the pre-existing plan2b class
-- 40000000-0000-4000-8000-000000000001, which is the class the QA student
-- +917230962182 actually belongs to. Without it that class held two members, so
-- every class-scoped surface the QA login can reach -- the My Class roster, the
-- home birthday strip, and above all the exam leaderboard, whose audience CTE
-- requires the caller to be an active member of the exam group's class -- had
-- nothing to draw. Blocks 1-4 keep deriving their class from the 41000000-
-- block; block 5 is mapped explicitly because 9 - B predates that scheme.

begin;
-- ---------------------------------------------------------------------------
-- Student roster rows
-- ---------------------------------------------------------------------------
-- 55 / 52 / 58 / 50 / 53 = 268 profiles. Names are drawn from a 61-name given
-- pool and a 24-name surname pool indexed by (g mod 61, 7g mod 24) where g is
-- the 0-based global student index. gcd(7,24)=1 and lcm(61,24)=1464 > 268, so
-- every student gets a distinct given/surname pair.
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
    (4, 50, 165),
    (5, 53, 215)
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
  --
  -- Block 5 starts at roll 011. Class 9 - B already carries 09B-001 and
  -- 09B-002 from the provisioned QA logins; roll_number has no unique index, so
  -- a clash would not error, it would just print two students under one roll on
  -- the leaderboard and the My Class roster.
  lpad(c.grade, 2, '0') || c.section || '-'
    || lpad((substr(right(up.id::text, 12), 8, 5)::int
              + case when substr(right(up.id::text, 12), 1, 2) = '05' then 10 else 0 end
            )::text, 3, '0'),
  true
from public.user_profiles up
join lateral (
  select case substr(right(up.id::text, 12), 1, 2)
    when '05' then '40000000-0000-4000-8000-000000000001'
    else '41000000-0000-4000-8000-'
      || lpad(substr(right(up.id::text, 12), 1, 2), 12, '0')
  end::uuid as class_id
) k on true
join public.classes c on c.id = k.class_id and c.school_id = up.school_id
join public.academic_years ay on ay.school_id = up.school_id and ay.is_current
where up.school_id = '20000000-0000-4000-8000-000000000001'::uuid
  and up.id::text like '11000000-0000-4000-8000-%'
on conflict (student_id, academic_year_id) do nothing;

-- ---------------------------------------------------------------------------
-- Dates of birth
-- ---------------------------------------------------------------------------
-- public.student_profiles.date_of_birth is NOT NULL and nothing in the repo
-- populated it, so the birthday surfaces had zero rows to draw no matter what
-- the client did.
--
-- WHY THESE DATES ARE RELATIVE TO current_date, NOT LITERALS. The birthday
-- queries match on to_char(date_of_birth, 'MM-DD') against today, so a literal
-- date only demonstrates the feature on the one day it was written. Anchoring
-- the month/day to current_date + an offset means a database reset reproduces a
-- live "today" and a live "upcoming" list on whatever day it is run, which is
-- what makes this seed reproducible rather than a one-day snapshot.
--
-- The offset is keyed off the per-class sequence, not the global index, so
-- every class independently gets birthdays today. That matters because the two
-- surfaces have different scopes: the home strip is CLASS-scoped
-- (getBirthdaysForClass) while the birthdays page is SCHOOL-scoped
-- (getBirthdaysForSchool). Keying globally would have satisfied the page while
-- leaving the QA student's own home strip empty.
--
--   seq % 17 = 3          -> birthday is TODAY          (3 per 53-student class)
--   seq % 17 in 4..8      -> 5/10/15/20/25 days out     (15 per class, "upcoming")
--   otherwise             -> 32..331 days out           (the rest of the year)
--
-- The year is pushed back 10-14 whole years so the stored value is a plausible
-- birth year for a secondary student while the month/day stays exactly on the
-- computed anchor. make_interval(years => n) is used rather than make_date so a
-- 29 February anchor degrades to 28 February instead of raising.
insert into public.student_profiles (student_id, date_of_birth)
select
  b.student_id,
  ((current_date + b.offset_days) - make_interval(years => 10 + (b.seq % 5)))::date
from (
  select
    up.id as student_id,
    substr(right(up.id::text, 12), 8, 5)::int as seq,
    case
      when substr(right(up.id::text, 12), 8, 5)::int % 17 = 3 then 0
      when substr(right(up.id::text, 12), 8, 5)::int % 17 between 4 and 8
        then (substr(right(up.id::text, 12), 8, 5)::int % 17 - 3) * 5
      else 32 + ((substr(right(up.id::text, 12), 8, 5)::int * 11
                  + substr(right(up.id::text, 12), 1, 2)::int * 29) % 300)
    end as offset_days
  from public.user_profiles up
  where up.school_id = '20000000-0000-4000-8000-000000000001'::uuid
    and up.id::text like '11000000-0000-4000-8000-%'
) b
on conflict (student_id) do nothing;

commit;
