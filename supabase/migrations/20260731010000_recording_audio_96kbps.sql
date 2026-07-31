-- Expo captures the approved paid-plan lecture profile as AAC-LC in an .m4a
-- container, mono, at 96 kbps. Keep the database invariant aligned with the
-- server confirmation policy and the native capture configuration.
alter table public.recording_audio_assets
  drop constraint if exists recording_audio_assets_bitrate_bps_check;

alter table public.recording_audio_assets
  add constraint recording_audio_assets_bitrate_bps_check
  check (bitrate_bps = 96000);
