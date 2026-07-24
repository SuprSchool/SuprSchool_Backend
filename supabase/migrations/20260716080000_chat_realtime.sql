create type public.chat_room_kind as enum ('class', 'subject');

create table public.chat_rooms (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete cascade,
  kind public.chat_room_kind not null,
  created_at timestamptz not null default now(),
  check (
    (kind = 'class' and subject_id is null)
    or (kind = 'subject' and subject_id is not null)
  )
);

create unique index chat_rooms_class_unique
  on public.chat_rooms (school_id, class_id)
  where kind = 'class';

create unique index chat_rooms_subject_unique
  on public.chat_rooms (school_id, class_id, subject_id)
  where kind = 'subject';

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  sender_id uuid not null references public.user_profiles(id) on delete restrict,
  client_message_id uuid not null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  unique (school_id, room_id, sender_id, client_message_id)
);

create index chat_messages_history_index
  on public.chat_messages (school_id, room_id, created_at desc, id desc);

create table public.chat_read_cursors (
  school_id uuid not null references public.schools(id) on delete cascade,
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  last_read_message_id uuid references public.chat_messages(id) on delete set null,
  last_read_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (school_id, room_id, user_id)
);

create index chat_read_cursors_user_room_index
  on public.chat_read_cursors (school_id, user_id, room_id);

create function public.can_access_chat_topic(topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  topic_school_id uuid;
  topic_room_id uuid;
begin
  if topic is null or topic !~ '^chat:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return false;
  end if;

  topic_school_id := split_part(topic, ':', 2)::uuid;
  topic_room_id := split_part(topic, ':', 3)::uuid;

  return exists (
    select 1
    from public.chat_rooms as room
    where room.id = topic_room_id
      and room.school_id = topic_school_id
      and (
        exists (
          select 1
          from public.class_members as membership
          join public.user_roles as active_student_role
            on active_student_role.user_id = membership.student_id
           and active_student_role.school_id = membership.school_id
           and active_student_role.role = 'student'
           and active_student_role.is_active = true
          where membership.student_id = auth.uid()
            and membership.class_id = room.class_id
            and membership.school_id = room.school_id
            and membership.is_active = true
        )
        or exists (
          select 1
          from public.class_subjects as class_subject
          join public.user_roles as active_teacher_role
            on active_teacher_role.user_id = class_subject.teacher_id
           and active_teacher_role.school_id = class_subject.school_id
           and active_teacher_role.role = 'teacher'
           and active_teacher_role.is_active = true
          where class_subject.teacher_id = auth.uid()
            and class_subject.class_id = room.class_id
            and class_subject.school_id = room.school_id
            and (
              room.kind = 'class'
              or class_subject.subject_id = room.subject_id
            )
        )
      )
  );
end;
$$;

revoke all on function public.can_access_chat_topic(text) from public;
grant execute on function public.can_access_chat_topic(text) to authenticated;

alter table public.chat_rooms enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_read_cursors enable row level security;

create policy "chat members read rooms"
on public.chat_rooms for select to authenticated
using (
  public.can_access_chat_topic(format('chat:%s:%s', school_id, id))
);

create policy "chat members read messages"
on public.chat_messages for select to authenticated
using (
  public.can_access_chat_topic(format('chat:%s:%s', school_id, room_id))
);

create policy "chat members read their cursors"
on public.chat_read_cursors for select to authenticated
using (
  user_id = auth.uid()
  and public.can_access_chat_topic(format('chat:%s:%s', school_id, room_id))
);

create policy "chat members receive private broadcasts"
on realtime.messages for select to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and public.can_access_chat_topic((select realtime.topic()))
);

create function public.broadcast_chat_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  sender record;
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
        'createdAt', NEW.created_at
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

create trigger broadcast_chat_message_after_insert
after insert on public.chat_messages
for each row execute function public.broadcast_chat_message();
