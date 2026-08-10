-- Timetable period label on the recording read model.
-- Figma 497:11334 and 513:6598 subtitle a recording as "date • period".

alter table public.class_recordings
  add column if not exists period text;

comment on column public.class_recordings.period is
  'Timetable period label active when the draft was created (Figma 497:11334 subtitle "date • period"). Null: pre-existing rows and out-of-timetable recordings.';
