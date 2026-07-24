create table public.school_profiles (
  school_id uuid primary key references public.schools(id) on delete cascade,
  address text not null default '',
  rating text not null default '—',
  description text[] not null default '{}',
  rules_intro text not null default '',
  rules text[] not null default '{}',
  logo_path text,
  updated_at timestamptz not null default now()
);

create table public.school_gallery_items (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  object_path text not null,
  alt_text text not null,
  sort_order integer not null,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  unique (school_id, object_path),
  unique (school_id, sort_order)
);

create index school_gallery_visible_index
  on public.school_gallery_items (school_id, sort_order)
  where is_published;

alter table public.school_profiles enable row level security;
alter table public.school_gallery_items enable row level security;

create function public.has_active_role_in_current_school(target_school_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_profiles as profile
    join public.user_roles as active_role
      on active_role.user_id = profile.id
     and active_role.school_id = profile.school_id
     and active_role.is_active = true
     and active_role.role in ('student', 'teacher')
    where profile.id = auth.uid()
      and profile.school_id::text = target_school_id
  );
$$;

revoke all on function public.has_active_role_in_current_school(text) from public;
grant execute on function public.has_active_role_in_current_school(text) to authenticated;

create policy "school members read their school profile"
on public.school_profiles for select to authenticated
using (
  public.has_active_role_in_current_school(school_id::text)
);

create policy "school members read their published gallery"
on public.school_gallery_items for select to authenticated
using (
  is_published
  and public.has_active_role_in_current_school(school_id::text)
);

insert into storage.buckets (id, name, public)
values ('school-gallery', 'school-gallery', false)
on conflict (id) do update set public = false;

create policy "school members read published school gallery objects"
on storage.objects for select to authenticated
using (
  bucket_id = 'school-gallery'
  and public.has_active_role_in_current_school((storage.foldername(name))[1])
  and (storage.foldername(name))[2] = 'gallery'
  and exists (
    select 1
    from public.school_gallery_items item
    where item.school_id::text = (storage.foldername(storage.objects.name))[1]
      and item.object_path = storage.objects.name
      and item.is_published
  )
);
