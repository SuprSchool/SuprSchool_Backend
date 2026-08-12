-- Ranking / leaderboard QA seed for Class 9 - B (2026-08-12).
--
-- WHY THIS EXISTS
-- The exam leaderboard (Figma 253:7515) had nothing to render. Class 9 - B held
-- one exam result in total, so the board was a podium of blanks. This file
-- gives the class a completed "Mid Term Examination" -- the same title the
-- Figma frame prints as its subtitle -- with five subject assessments and a
-- published result for every student, so the podium, the ranked rows, the
-- subject tab rail, the points column and the streak badge all populate.
--
-- PREREQUISITES
--   1. supabase/seed.sql                        (school, academic year, 9 - B, subjects)
--   2. npm run provision:qa-auth                (the two real QA logins)
--   3. supabase/seed-qa-plan2c-classes-events.sql
--   4. scripts/seed-qa-roster-students.ts       (fills 9 - B with 53 students)
-- Applied before step 4 this file still succeeds, it just scores whoever is in
-- the class at the time. Re-running is safe; every statement is idempotent.
--
-- WHO GETS SCORED
-- The cohort is class_members of 9 - B joined to user_roles role='student'.
-- The role join is load-bearing: the provisioned teacher +917755090948 is also
-- an active class_member of 9 - B, and without it that teacher would be scored
-- and ranked on a student leaderboard.
--
-- DETERMINISTIC IDS
-- Every generated id puts its varying part in the FIRST uuid group and the
-- student key in the last, e.g. 891000<nn>-0000-4000-8000-<last 12 of student>.
-- Packing both into the last group would collide: the roster key ends in a
-- zero-padded sequence, so class 1 seq 1 and class 5 seq 1 share their last ten
-- characters.
--
-- THE TIE IS DELIBERATE
-- Ranks 2 and 3 are seeded to the same total (475) so the podium exercises
-- dense_rank's tie behaviour, matching the Figma frame, which prints 98 for
-- first and 95 for BOTH second and third.

begin;

-- ---------------------------------------------------------------------------
-- 1. The exam group
-- ---------------------------------------------------------------------------
-- Dated relative to current_date so it always reads as a completed exam: a
-- literal window would drift into the future tab as the calendar moved past it.
insert into public.exam_groups
  (id, school_id, class_id, creator_teacher_id, title, starts_on, ends_on, state)
values (
  '86000000-0000-4000-8000-000000000003'::uuid,
  '20000000-0000-4000-8000-000000000001'::uuid,
  '40000000-0000-4000-8000-000000000001'::uuid,
  '10000000-0000-4000-8000-000000000001'::uuid,
  'Mid Term Examination',
  current_date - 21,
  current_date - 14,
  'published'
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Five subject assessments
-- ---------------------------------------------------------------------------
-- Five subjects, so the leaderboard's subject tab rail has Overall plus five
-- pills. is_published implies published_at is not null (class_exams_check), and
-- starts_at/ends_at must both be set with ends_at > starts_at
-- (class_exams_time_order_check).
insert into public.class_exams
  (id, school_id, class_id, exam_group_id, subject_id, teacher_id, title,
   scheduled_on, starts_at, ends_at, max_marks, is_published, published_at)
select
  v.id::uuid,
  '20000000-0000-4000-8000-000000000001'::uuid,
  '40000000-0000-4000-8000-000000000001'::uuid,
  '86000000-0000-4000-8000-000000000003'::uuid,
  v.subject_id::uuid,
  '10000000-0000-4000-8000-000000000001'::uuid,
  v.title,
  current_date - v.days_ago,
  '09:30'::time,
  '11:30'::time,
  100,
  true,
  now() - make_interval(days => v.days_ago)
from (values
  ('87000000-0000-4000-8000-000000000011', '50000000-0000-4000-8000-000000000001', 'Mid Term - English',          21),
  ('87000000-0000-4000-8000-000000000012', '50000000-0000-4000-8000-000000000002', 'Mid Term - History',           19),
  ('87000000-0000-4000-8000-000000000013', '50000000-0000-4000-8000-000000000003', 'Mid Term - Mathematics',       17),
  ('87000000-0000-4000-8000-000000000014', '50000000-0000-4000-8000-000000000004', 'Mid Term - Physics',           15),
  ('87000000-0000-4000-8000-000000000015', '50000000-0000-4000-8000-000000000005', 'Mid Term - Computer Science',  14)
) as v(id, subject_id, title, days_ago)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. A published result for every student, on every assessment
-- ---------------------------------------------------------------------------
-- seq is the roster sequence read back out of the profile key; the two
-- provisioned members have no roster key, so the QA student falls to seq 0 and
-- is scored by the explicit vector below.
--
-- Totals: seq 1 -> 480 (sole first place)
--         seq 2 -> 475, seq 3 -> 475 (the deliberate tie for second)
--         seq 0 -> 435, the QA student, mid-pack so the pinned "You" row sits
--                  below the fold of the podium and proves the row renders
--         others -> 48..92 per subject, so at most 460 and never above the tie
insert into public.exam_results
  (id, school_id, assessment_id, student_id, entered_by_teacher_id, marks, published_at)
select
  ('891000' || lpad(a.idx::text, 2, '0') || '-0000-4000-8000-'
    || right(c.student_id::text, 12))::uuid,
  '20000000-0000-4000-8000-000000000001'::uuid,
  a.assessment_id::uuid,
  c.student_id,
  '10000000-0000-4000-8000-000000000001'::uuid,
  coalesce(
    case c.seq
      when 1 then (array[98, 97, 96, 95, 94])[a.idx]
      when 2 then (array[95, 95, 95, 95, 95])[a.idx]
      when 3 then (array[96, 94, 95, 96, 94])[a.idx]
      when 0 then (array[89, 86, 88, 85, 87])[a.idx]
      else null
    end,
    48 + ((c.seq * 17 + a.idx * 29) % 45)
  )::double precision,
  now() - make_interval(days => 12)
from (
  select
    cm.student_id,
    case
      when cm.student_id::text like '11000000-0000-4000-8000-05%'
        then substr(right(cm.student_id::text, 12), 8, 5)::int
      else 0
    end as seq
  from public.class_members cm
  join public.user_roles ur
    on ur.user_id = cm.student_id
   and ur.school_id = cm.school_id
   and ur.role = 'student'
   and ur.is_active
  where cm.school_id = '20000000-0000-4000-8000-000000000001'::uuid
    and cm.class_id = '40000000-0000-4000-8000-000000000001'::uuid
    and cm.is_active
) c
cross join (values
  ('87000000-0000-4000-8000-000000000011', 1),
  ('87000000-0000-4000-8000-000000000012', 2),
  ('87000000-0000-4000-8000-000000000013', 3),
  ('87000000-0000-4000-8000-000000000014', 4),
  ('87000000-0000-4000-8000-000000000015', 5)
) as a(assessment_id, idx)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 4. Points
-- ---------------------------------------------------------------------------
-- The leaderboard prints a points column beside the marks. Only the ledger is
-- written: public.point_ledger_entries carries an update trigger
-- (point_ledger_entries_update_balance) that maintains
-- public.point_account_balances, so seeding the balance directly would be
-- overwritten by the next real award and would disagree with its own audit
-- trail. award_key is unique per school, which is what makes this idempotent.
--
-- rule_code is a foreign key to point_earning_rules (school_id, code), so it
-- has to name a rule the school actually has. The school defines three --
-- assignment_submission, event_registration, attendance_streak -- and none of
-- them is an exam award. These points are attributed to attendance_streak
-- rather than to a rule invented for the seed, because section 5 below seeds
-- the attendance history those points would really have come from.
insert into public.point_ledger_entries
  (id, school_id, recipient_user_id, source_type, source_id, rule_code,
   award_key, points, metadata, occurred_at)
select
  ('8c100000-0000-4000-8000-' || right(c.student_id::text, 12))::uuid,
  '20000000-0000-4000-8000-000000000001'::uuid,
  c.student_id,
  'attendance_streak',
  '40000000-0000-4000-8000-000000000001',
  'attendance_streak',
  'qa-plan2d-midterm-' || c.student_id::text,
  10 + (c.seq % 41),
  jsonb_build_object('examGroupTitle', 'Mid Term Examination', 'seed', 'plan2d'),
  now() - make_interval(days => 12)
from (
  select
    cm.student_id,
    case
      when cm.student_id::text like '11000000-0000-4000-8000-05%'
        then substr(right(cm.student_id::text, 12), 8, 5)::int
      else 20
    end as seq
  from public.class_members cm
  join public.user_roles ur
    on ur.user_id = cm.student_id
   and ur.school_id = cm.school_id
   and ur.role = 'student'
   and ur.is_active
  where cm.school_id = '20000000-0000-4000-8000-000000000001'::uuid
    and cm.class_id = '40000000-0000-4000-8000-000000000001'::uuid
    and cm.is_active
) c
on conflict (school_id, award_key) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Attendance, for the streak badge
-- ---------------------------------------------------------------------------
-- The fire badge on every leaderboard row is an attendance streak: a run of
-- consecutive non-absent days counted back from the most recent session. It has
-- no table of its own -- it is derived -- so the only way to make it non-zero
-- is real attendance history.
--
-- 14 sessions on the last 14 weekdays. A student is absent exactly once, on the
-- day (seq % 13) + 1 sessions ago, which hands each student a streak of
-- seq % 13 and spreads the badge across 0..12 instead of printing one number
-- down the whole board.
-- attendance_sessions carries a unique (class_id, attendance_date) and the class
-- already had sessions from the provisioning fixture, so the conflict target is
-- the date, not the id -- and the records below resolve their session id by
-- joining on the date rather than rebuilding it, so a day that already had a
-- session still gets its records against the session that is really there.
insert into public.attendance_sessions
  (id, school_id, class_id, attendance_date, marked_by_teacher_id)
select
  ('8b100000-0000-4000-8000-' || lpad(d.n::text, 12, '0'))::uuid,
  '20000000-0000-4000-8000-000000000001'::uuid,
  '40000000-0000-4000-8000-000000000001'::uuid,
  d.session_date,
  '10000000-0000-4000-8000-000000000001'::uuid
from (
  select row_number() over (order by day desc) as n, day::date as session_date
  from generate_series(current_date - 30, current_date - 1, interval '1 day') as day
  where extract(dow from day) between 1 and 5
  order by day desc
  limit 14
) d
on conflict (class_id, attendance_date) do nothing;

insert into public.attendance_records (id, session_id, student_id, status, marked_at)
select
  ('8a1000' || lpad(d.n::text, 2, '0') || '-0000-4000-8000-'
    || right(c.student_id::text, 12))::uuid,
  ses.id,
  c.student_id,
  -- row_number() is bigint; make_interval only accepts int.
  case when d.n = (c.seq % 13) + 1 then 'absent' else 'present' end::attendance_status,
  now() - make_interval(days => d.n::int)
from (
  select row_number() over (order by day desc) as n, day::date as session_date
  from generate_series(current_date - 30, current_date - 1, interval '1 day') as day
  where extract(dow from day) between 1 and 5
  order by day desc
  limit 14
) d
join public.attendance_sessions ses
  on ses.class_id = '40000000-0000-4000-8000-000000000001'::uuid
 and ses.attendance_date = d.session_date
cross join (
  select
    cm.student_id,
    case
      when cm.student_id::text like '11000000-0000-4000-8000-05%'
        then substr(right(cm.student_id::text, 12), 8, 5)::int
      else 11
    end as seq
  from public.class_members cm
  join public.user_roles ur
    on ur.user_id = cm.student_id
   and ur.school_id = cm.school_id
   and ur.role = 'student'
   and ur.is_active
  where cm.school_id = '20000000-0000-4000-8000-000000000001'::uuid
    and cm.class_id = '40000000-0000-4000-8000-000000000001'::uuid
    and cm.is_active
) c
on conflict do nothing;

commit;
