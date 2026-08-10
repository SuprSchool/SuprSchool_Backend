alter table public.class_announcements
  add column if not exists location text,
  add column if not exists event_at timestamptz;

comment on column public.class_announcements.location is
  'Optional venue row on announcement cards (Figma 594:15213 card 4). Null: no location row is rendered.';
comment on column public.class_announcements.event_at is
  'Optional event date/time on announcement cards. Null: the card draws no event date row.';
