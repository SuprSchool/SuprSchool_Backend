create type public.avatar_kind as enum ('preset', 'upload');

create table public.profile_interests (
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  interest text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, interest)
);

alter table public.user_profiles
  add column avatar_kind public.avatar_kind,
  add column avatar_value text;

alter table public.profile_interests enable row level security;

revoke all on table public.profile_interests from anon, authenticated;
grant select, insert, update, delete on table public.profile_interests to service_role;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do update set public = false;

create policy "authenticated avatar session owners insert objects"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'avatars'
  and exists (
    select 1
    from public.upload_sessions
    where bucket = storage.objects.bucket_id
      and object_path = storage.objects.name
      and parent_type = 'avatar'
      and parent_id = auth.uid()::text
      and user_id = auth.uid()
      and status = 'pending'
      and expires_at > now()
  )
);

create policy "authenticated users read tenant avatar objects"
on storage.objects for select to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (
    select school_id::text from public.user_profiles where id = auth.uid()
  )
  and (storage.foldername(name))[3] = auth.uid()::text
);
