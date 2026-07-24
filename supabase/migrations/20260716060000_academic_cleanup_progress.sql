create table public.academic_storage_cleanup_objects (
  school_id uuid not null references public.schools(id) on delete cascade,
  bucket text not null,
  object_path text not null,
  cleaned_at timestamptz not null default now(),
  primary key (school_id, bucket, object_path)
);

alter table public.academic_storage_cleanup_objects enable row level security;
revoke all on table public.academic_storage_cleanup_objects from anon, authenticated;
grant select, insert, update, delete on table public.academic_storage_cleanup_objects to service_role;
