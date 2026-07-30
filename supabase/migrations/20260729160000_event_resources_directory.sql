create index if not exists user_roles_school_active_role_user_idx
  on public.user_roles (school_id, is_active, role, user_id);

create index if not exists user_profiles_school_lower_name_id_idx
  on public.user_profiles (school_id, lower(display_name) text_pattern_ops, id);

create table public.event_resources (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  upload_session_id uuid not null references public.upload_sessions(id) on delete cascade,
  object_path text not null,
  content_type text not null,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 255),
  resource_kind text not null check (resource_kind in ('attachment', 'banner')),
  sort_order integer not null default 0 check (sort_order between 0 and 1000),
  size_bytes integer not null check (size_bytes between 1 and 20971520),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (upload_session_id),
  unique (object_path)
);

create unique index event_resources_one_current_banner_unique
  on public.event_resources (event_id)
  where resource_kind = 'banner' and confirmed_at is not null;

create index event_resources_school_event_confirmed_order_idx
  on public.event_resources (school_id, event_id, confirmed_at, sort_order, id);

create or replace function public.events_assert_resource_tenant()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from public.events event
    join public.upload_sessions upload on upload.id = new.upload_session_id
      and upload.school_id = new.school_id
      and upload.bucket = 'academic-files'
      and upload.parent_type = 'event-resource'
      and upload.parent_id = new.event_id::text
      and upload.object_path = new.object_path
      and upload.content_type = new.content_type
      and upload.display_name = new.display_name
      and upload.size_bytes = new.size_bytes
    where event.id = new.event_id
      and event.school_id = new.school_id
  ) then
    raise exception 'event resource must match its event and upload session tenant'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger events_resource_tenant_trigger
before insert or update on public.event_resources
for each row execute function public.events_assert_resource_tenant();

alter table public.event_resources enable row level security;
revoke all on table public.event_resources from anon, authenticated;
grant select, insert, update, delete on table public.event_resources to service_role;