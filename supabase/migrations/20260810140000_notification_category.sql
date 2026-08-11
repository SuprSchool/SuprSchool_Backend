-- The notifications table is `notification_inbox`
-- (`20260714030000_notification_delivery.sql`); there is no `notifications`
-- table and no category column anywhere before this migration.
--
-- Figma frame 268:9469 draws seven notification cards across six glyphs, and
-- the glyph follows the category rather than the event type. `category` is
-- plain text with no CHECK, matching `notification_type` beside it: a client
-- that does not recognise a value renders the default glyph, so a producer may
-- introduce a category without a migration and without a client release.
--
-- Existing rows take the `school` default, so nothing is backfilled. No RLS
-- policy or grant changes, so `scripts/verify-rls.mjs` is untouched.
alter table public.notification_inbox
  add column if not exists category text not null default 'school';
