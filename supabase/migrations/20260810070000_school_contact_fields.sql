-- The Settings frame (Figma 758:4541) draws a HELP & SUPPORT card holding a
-- "Call School Office" row and an "Email Support" row. /v1/schools/current
-- carried no field either row could read, so both were unreachable.
--
-- The columns land on public.school_profiles, not public.schools:
-- school_profiles already owns every presentational field the school payload
-- returns (address, rating, description, rules_intro, rules, logo_path), while
-- public.schools is the tenancy root and carries only id/name/school_code.
-- src/db/schema/community-school.ts is the schema module for this table.
--
-- Both columns are nullable on purpose: a school that has published no contact
-- detail reports null, never an empty string the client would draw as a blank
-- row. No RLS or grant change — school_profiles carries a table-level select
-- policy for active members of the school, and adding nullable columns does
-- not widen it.
alter table public.school_profiles
  add column if not exists phone text,
  add column if not exists support_email text;

comment on column public.school_profiles.phone is
  'School office number for the Settings Call School Office row (Figma 758:4541).';
comment on column public.school_profiles.support_email is
  'Support address for the Settings Email Support row (Figma 758:4541).';
