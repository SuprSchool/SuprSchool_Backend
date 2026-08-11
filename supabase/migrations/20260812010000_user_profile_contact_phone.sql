-- The My Class frame (Figma 253:10699) draws a call button on every teacher
-- row. `ClassContextTeacher` carried no number, so every button reported
-- "Number unavailable". This is plan2 Task 1, revisited: that task assumed no
-- phone column existed anywhere. One does -- and it is the wrong one.
--
-- Why a NEW column instead of reusing public.user_profiles.phone_e164:
-- phone_e164 is the *login identity*. It is NOT NULL, it is the number the
-- account authenticates with, and school_directory_entries.phone_e164 carries a
-- UNIQUE constraint over the same value because signup claims a directory row
-- by phone. Surfacing it on the student-facing My Class roster would publish
-- every teacher's sign-in number to their whole class, and overwriting it to
-- change the advertised number would lock the teacher out of the app.
-- A published contact number and a sign-in credential are different facts about
-- a person and need different columns.
--
-- Why public.user_profiles and not public.school_directory_entries:
-- plan2 Task 1 step 1 asks for the identity row, "not on a class-teacher join --
-- the same person teaching three classes has one number". user_profiles is that
-- row here: it is one row per person, and it is already the table the class
-- teachers query joins through (class_subjects.teacher_id -> user_profiles.id in
-- src/db/repositories/student-class-context.repository.ts). Routing through
-- school_directory_entries instead would add a second join for no gain and would
-- lose the number whenever the directory row is missing or carries a stale role.
--
-- Nullable on purpose: most teachers publish no number, and the read model must
-- report null -- never an empty string -- so the client can decide whether to
-- draw the call button at all.
--
-- No RLS or grant change. public.user_profiles carries table-level grants
-- (pg_class.relacl, with every pg_attribute.attacl null), so a new column
-- inherits them, and the existing row policy is unchanged by adding a column.
-- scripts/verify-rls.mjs is therefore not updated for this migration.
alter table public.user_profiles
  add column if not exists contact_phone_e164 text;

comment on column public.user_profiles.contact_phone_e164 is
  'Published E.164 contact number for the My Class teacher call button (Figma 253:10699). Distinct from phone_e164, which is the login identity. Nullable: most profiles publish no number.';
