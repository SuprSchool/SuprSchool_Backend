-- The same deferred trigger runs for both events and event_audiences.  Trigger
-- records are table-specific, so accessing NEW.event_id while PostgreSQL is
-- validating an events row raises "record new has no field event_id".
create or replace function public.events_validate_audience_cardinality()
returns trigger
language plpgsql
as $$
declare
  audience_count integer;
  audience_event_id uuid;
  audience_type text;
  new_row jsonb := to_jsonb(new);
  old_row jsonb := to_jsonb(old);
begin
  if tg_table_name = 'event_audiences'
    and tg_op = 'UPDATE'
    and (old_row ->> 'event_id')::uuid is distinct from (new_row ->> 'event_id')::uuid
  then
    raise exception 'event audience rows cannot move between events'
      using errcode = '23514';
  end if;

  if tg_table_name = 'events' then
    audience_event_id := coalesce(
      (new_row ->> 'id')::uuid,
      (old_row ->> 'id')::uuid
    );
  else
    audience_event_id := coalesce(
      (new_row ->> 'event_id')::uuid,
      (old_row ->> 'event_id')::uuid
    );
  end if;

  select event.audience_type
  into audience_type
  from public.events event
  where event.id = audience_event_id;

  if not found then
    return null;
  end if;

  select count(*)::integer
  into audience_count
  from public.event_audiences audience
  where audience.event_id = audience_event_id;

  if not (
    (audience_type = 'school' and audience_count = 0)
    or (audience_type = 'classes' and audience_count between 1 and 100)
  ) then
    raise exception 'event audience cardinality does not match its audience type'
      using errcode = '23514';
  end if;

  return null;
end;
$$;
