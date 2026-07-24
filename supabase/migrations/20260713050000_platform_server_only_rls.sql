-- Queue bookkeeping contains tenant-identifying envelopes and is accessed only
-- by the backend worker/service role. Do not grant direct client access.
alter table public.processed_queue_events enable row level security;
alter table public.queue_dead_letters enable row level security;

revoke all on table public.processed_queue_events from anon, authenticated;
revoke all on table public.queue_dead_letters from anon, authenticated;

grant select, insert, update, delete on table public.processed_queue_events to service_role;
grant select, insert, update, delete on table public.queue_dead_letters to service_role;
