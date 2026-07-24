insert into storage.buckets (id, name, public)
values ('assignments', 'assignments', false)
on conflict (id) do update set public = false;

drop policy if exists "authenticated upload sessions insert tenant objects" on storage.objects;
create policy "authenticated upload sessions insert tenant objects"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'assignments'
  and (storage.foldername(name))[1] = (
    select school_id::text from public.user_profiles where id = auth.uid()
  )
  and exists (
    select 1 from public.upload_sessions
    where bucket = storage.objects.bucket_id
      and object_path = storage.objects.name
      and school_id::text = (storage.foldername(storage.objects.name))[1]
      and user_id = auth.uid()
      and status = 'pending'
      and expires_at > now()
  )
);

drop policy if exists "authenticated upload sessions read tenant objects" on storage.objects;
create policy "authenticated upload sessions read tenant objects"
on storage.objects for select to authenticated
using (
  bucket_id = 'assignments'
  and (storage.foldername(name))[1] = (
    select school_id::text from public.user_profiles where id = auth.uid()
  )
);
