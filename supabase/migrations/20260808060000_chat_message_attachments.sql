-- Chat message attachments.
--
-- The composer clip that frames 253:11089 (student) and 517:6941 (teacher) draw
-- needs somewhere to record what a message carries. Attachments reuse the
-- generic `public.upload_sessions` flow and the private `academic-files`
-- bucket; this table only records the confirmed result, so a row can never
-- exist for an upload that was never confirmed.
--
-- `upload_session_id` is a restricting reference: a confirmed session stays for
-- as long as the attachment it produced, which keeps the storage-cleanup
-- sweeps from reclaiming an object a live message still points at.
-- Both unique constraints are NAMED. An inline `unique` would be auto-named
-- `chat_message_attachments_upload_session_id_key`, which no code could match
-- deliberately — and re-sending a spent session has to be answered by name,
-- not swallowed as a generic write failure.
create table public.chat_message_attachments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  upload_session_id uuid not null references public.upload_sessions(id) on delete restrict,
  object_path text not null,
  display_name text not null check (char_length(display_name) between 1 and 255),
  content_type text not null check (char_length(content_type) between 1 and 255),
  bytes bigint not null check (bytes > 0),
  created_at timestamptz not null default now(),
  constraint chat_message_attachments_upload_session_unique unique (upload_session_id),
  constraint chat_message_attachments_object_path_unique unique (object_path)
);

create index chat_message_attachments_message_idx
  on public.chat_message_attachments (school_id, message_id, created_at, id);

alter table public.chat_message_attachments enable row level security;

revoke all on table public.chat_message_attachments from anon, authenticated;

grant select, insert, update, delete on table public.chat_message_attachments to service_role;

-- The message broadcast is what every other member of the room receives, and
-- the client de-duplicates by message id — a payload that omitted attachments
-- would hide them from recipients permanently, because the catch-up page
-- carrying the same id is discarded as already seen.
--
-- The attachment row lands in the same statement as its message, so this
-- AFTER ROW trigger (queued to end of statement) already sees it. `signedUrl`
-- and `expiresAt` are both null rather than absent: Postgres cannot sign a
-- storage URL, and null says "not signed in this payload" instead of
-- inventing a value the reader would then act on.
create or replace function public.broadcast_chat_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  sender record;
  attachments jsonb;
begin
  select profile.display_name, active_role.role
  into sender
  from public.user_profiles as profile
  join public.user_roles as active_role
    on active_role.user_id = profile.id
   and active_role.school_id = profile.school_id
   and active_role.is_active = true
   and active_role.role in ('student', 'teacher')
  where profile.id = NEW.sender_id
    and profile.school_id = NEW.school_id
  order by active_role.role
  limit 1;

  if not found then
    raise exception 'Chat message sender must have an active student or teacher role';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', attachment.id,
        'name', attachment.display_name,
        'contentType', attachment.content_type,
        'sizeBytes', attachment.bytes,
        'signedUrl', null,
        'expiresAt', null
      )
      order by attachment.created_at, attachment.id
    ),
    '[]'::jsonb
  )
  into attachments
  from public.chat_message_attachments as attachment
  where attachment.school_id = NEW.school_id
    and attachment.message_id = NEW.id;

  perform realtime.send(
    jsonb_build_object(
      'message', jsonb_build_object(
        'id', NEW.id,
        'roomId', NEW.room_id,
        'clientMessageId', NEW.client_message_id,
        'sender', jsonb_build_object(
          'id', NEW.sender_id,
          'displayName', sender.display_name,
          'role', sender.role
        ),
        'body', NEW.body,
        'createdAt', NEW.created_at,
        'attachments', attachments
      )
    ),
    'message.created',
    format('chat:%s:%s', NEW.school_id, NEW.room_id),
    true
  );

  return NEW;
end;
$$;

revoke all on function public.broadcast_chat_message() from public;
