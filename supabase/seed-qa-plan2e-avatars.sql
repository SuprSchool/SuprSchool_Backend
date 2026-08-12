-- Profile avatars for the QA school (2026-08-12).
--
-- WHY THIS EXISTS
-- seed-qa-plan2c-roster.sql fills the school with 268 students and gives every
-- one of them a birthday, but leaves user_profiles.avatar_kind/avatar_value
-- null. Null is rendered as an initials plate, so every face-bearing surface --
-- the home birthday strip, the birthdays page, the birthday-wish screen and the
-- student's own profile header -- drew lettered circles where the Figma frames
-- draw photographs. This file fills those nulls.
--
-- THE AVATAR MODEL IS TWO-KINDED, AND THE KINDS ARE NOT INTERCHANGEABLE
--   avatar_kind = 'preset' -> avatar_value is a preset IDENTIFIER that the
--     CLIENT resolves to a bundled asset. It is never a URL and never a path.
--   avatar_kind = 'upload' -> avatar_value is a STORAGE OBJECT PATH in the
--     private `avatars` bucket, which the backend signs on read
--     (AvatarDisplayUrlSigner / createSignedDownloadUrl).
-- This file writes ONLY the preset kind.
--
-- THE PRESET IDS ARE NOT FREE TEXT. A value that the client cannot resolve is
-- worse than null: null falls back to a readable initials plate, whereas an
-- unresolvable id resolves to `undefined` and renders an empty circle. The
-- authoritative list is the `presetAvatarSources` record in
-- client/services/api/phase4-community.adapter.ts, backed by
-- client/assets/avatars/*.png. It admits exactly seven ids:
--
--     avatar-1 avatar-2 avatar-3 avatar-4 avatar-5 avatar-6 avatar-teacher
--
-- Students are given avatar-1..avatar-6. avatar-teacher is byte-identical to
-- avatar-1 (same md5), so it adds no visual variety -- it is used below only to
-- keep teacher rows semantically correct.
--
-- DO NOT WRITE PRESET IDS INTO user_profiles.avatar_path. avatar_path is a
-- separate legacy column that only ever holds a storage object path, and
-- student-class-context.repository.ts hands it to the client raw, where
-- contracts.ts passes it to expo-image as `{ uri }`. A preset id there would
-- render as a broken image on the My Class roster and the exam leaderboard.
-- This file leaves avatar_path untouched.
--
-- WHAT THIS FIXES, AND WHAT IT DOES NOT
-- Fixed, because these read models carry the tagged { kind, value } DTO and the
-- client resolves it through avatarUri():
--   - GET /v1/student/home            (birthday strip, profile header)
--   - GET /v1/student/home/birthdays  (birthdays page, birthday-wish screen)
--   - GET /v1/profile                 (student and teacher profile screens)
-- NOT fixed by seed data, and no value of avatar_value can fix them:
--   - My Class roster and exam leaderboard read the legacy avatar_path column
--     (student-class-context.repository.ts) and never see avatar_value.
--   - Chat carries no avatar column in any read model at all.
-- Both need a code change, not a seed. See the avatar-seed report.
--
-- PREREQUISITES
--   1. supabase/seed.sql
--   2. npm run provision:qa-auth                (the QA logins)
--   3. supabase/seed-qa-plan2c-classes-events.sql
--   4. scripts/seed-qa-roster-students.ts       (the 268 roster students)
-- Applied earlier this file still succeeds; it simply updates whoever exists.
--
-- IDEMPOTENT AND NON-DESTRUCTIVE. Both statements are guarded on
-- `avatar_kind is null and avatar_value is null`, so a re-run matches nothing
-- and an avatar a real user has already chosen or uploaded is never overwritten.
--
-- DETERMINISTIC. The preset is a hash of the profile id, not a sequence, so a
-- database reset reproduces the identical assignment, and a roster sorted by
-- roll number gets a mixed set of faces rather than a visible 1-2-3-4-5-6
-- repeat. md5() is core Postgres; no pgcrypto extension is required.

begin;

-- ---------------------------------------------------------------------------
-- 1. Students -> avatar-1 .. avatar-6
-- ---------------------------------------------------------------------------
-- Scoped by active student role rather than by the 11000000- roster id prefix,
-- so the provisioned QA student (Class 9 - B, roll 09B-002) is covered too --
-- that account is the one the emulator signs in as, and its home header showed
-- an initials plate for the same reason the roster did.
--
-- get_byte(md5) is 0..255 and 256 is not a multiple of 6, so the six buckets
-- are not exactly equal. Over this roster it lands 39-53 per preset, which is
-- well inside what "distributed" needs to mean here.
update public.user_profiles up
set
  avatar_kind = 'preset',
  avatar_value = 'avatar-' || ((get_byte(decode(md5(up.id::text), 'hex'), 0) % 6) + 1)::text
where up.school_id = '20000000-0000-4000-8000-000000000001'::uuid
  and up.avatar_kind is null
  and up.avatar_value is null
  and exists (
    select 1
    from public.user_roles ur
    where ur.user_id = up.id
      and ur.school_id = up.school_id
      and ur.role = 'student'
      and ur.is_active
  );

-- ---------------------------------------------------------------------------
-- 2. Teachers -> avatar-teacher
-- ---------------------------------------------------------------------------
-- A no-op on the current database: both provisioned teachers already chose a
-- preset through the app, and the null guard skips them. It exists so that a
-- database reset -- which recreates those accounts with null avatars -- does
-- not leave the teacher home header and the My Class teacher rows on initials.
update public.user_profiles up
set
  avatar_kind = 'preset',
  avatar_value = 'avatar-teacher'
where up.school_id = '20000000-0000-4000-8000-000000000001'::uuid
  and up.avatar_kind is null
  and up.avatar_value is null
  and exists (
    select 1
    from public.user_roles ur
    where ur.user_id = up.id
      and ur.school_id = up.school_id
      and ur.role = 'teacher'
      and ur.is_active
  );

commit;
