-- Phase 2 announcements extend the existing Phase 1 home-feed table. This
-- migration deliberately refuses to infer a teacher/subject for legacy rows.
do $$
begin
  if exists (select 1 from public.class_announcements) then
    raise exception
      'Cannot add required class_announcements teacher_id/subject_id while rows exist; provide an approved backfill first';
  end if;
end $$;

alter table public.class_announcements
  add column teacher_id uuid references public.user_profiles(id) on delete restrict,
  add column subject_id uuid references public.subjects(id) on delete restrict,
  add column updated_at timestamptz not null default now();

alter table public.class_announcements
  alter column teacher_id set not null,
  alter column subject_id set not null;

create index class_announcements_student_cursor_idx
  on public.class_announcements (school_id, class_id, published_at desc, id desc)
  where is_published;

create index class_announcements_teacher_cursor_idx
  on public.class_announcements (school_id, teacher_id, created_at desc, id desc);

create table public.announcement_resources (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  announcement_id uuid not null references public.class_announcements(id) on delete cascade,
  upload_session_id uuid not null unique,
  object_path text not null unique,
  display_name text not null check (char_length(display_name) between 1 and 255),
  resource_type text not null check (resource_type in ('pdf', 'image', 'document')),
  created_at timestamptz not null default now()
);

create index announcement_resources_parent_idx
  on public.announcement_resources (school_id, announcement_id, created_at, id);

alter table public.class_announcements enable row level security;
alter table public.announcement_resources enable row level security;

revoke all on table public.class_announcements from anon, authenticated;
revoke all on table public.announcement_resources from anon, authenticated;

grant select, insert, update, delete on table public.class_announcements to service_role;
grant select, insert, update, delete on table public.announcement_resources to service_role;
