-- Provision the durable rooms that the chat REST API and private Broadcast use.
-- The trigger functions deliberately derive every value from the affected rows,
-- so a class/subject from another school can never be provisioned into this tenant.

insert into public.chat_rooms (school_id, class_id, subject_id, kind)
select class.school_id, class.id, null, 'class'::public.chat_room_kind
from public.classes as class
join public.academic_years as academic_year
  on academic_year.id = class.academic_year_id
 and academic_year.school_id = class.school_id
where academic_year.is_current = true
on conflict do nothing;

insert into public.chat_rooms (school_id, class_id, subject_id, kind)
select class.school_id, class.id, assignment.subject_id, 'subject'::public.chat_room_kind
from public.class_subjects as assignment
join public.classes as class
  on class.id = assignment.class_id
 and class.school_id = assignment.school_id
join public.subjects as subject
  on subject.id = assignment.subject_id
 and subject.school_id = assignment.school_id
join public.academic_years as academic_year
  on academic_year.id = class.academic_year_id
 and academic_year.school_id = class.school_id
where academic_year.is_current = true
  and assignment.teacher_id is not null
on conflict do nothing;

create or replace function public.provision_current_class_chat_rooms()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.academic_years as academic_year
    where academic_year.id = new.academic_year_id
      and academic_year.school_id = new.school_id
      and academic_year.is_current = true
  ) then
    return new;
  end if;

  insert into public.chat_rooms (school_id, class_id, subject_id, kind)
  values (new.school_id, new.id, null, 'class')
  on conflict do nothing;

  insert into public.chat_rooms (school_id, class_id, subject_id, kind)
  select class.school_id, class.id, assignment.subject_id, 'subject'::public.chat_room_kind
  from public.class_subjects as assignment
  join public.classes as class
    on class.id = assignment.class_id
   and class.school_id = new.school_id
  join public.subjects as subject
    on subject.id = assignment.subject_id
   and subject.school_id = new.school_id
  where assignment.class_id = new.id
    and assignment.school_id = new.school_id
    and assignment.teacher_id is not null
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function public.provision_current_class_chat_rooms() from public;

create trigger provision_current_class_chat_rooms_after_insert
after insert on public.classes
for each row execute function public.provision_current_class_chat_rooms();

create or replace function public.provision_current_class_subject_chat_room()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.teacher_id is null then
    return new;
  end if;

  insert into public.chat_rooms (school_id, class_id, subject_id, kind)
  select class.school_id, class.id, new.subject_id, 'subject'::public.chat_room_kind
  from public.classes as class
  join public.subjects as subject
    on subject.id = new.subject_id
   and subject.school_id = new.school_id
  join public.academic_years as academic_year
    on academic_year.id = class.academic_year_id
   and academic_year.school_id = new.school_id
  where class.id = new.class_id
    and class.school_id = new.school_id
    and academic_year.is_current = true
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function public.provision_current_class_subject_chat_room() from public;

create trigger provision_current_class_subject_chat_room_after_assignment
after insert or update of teacher_id on public.class_subjects
for each row execute function public.provision_current_class_subject_chat_room();

create or replace function public.provision_current_academic_year_chat_rooms()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_current is not true then
    return new;
  end if;

  insert into public.chat_rooms (school_id, class_id, subject_id, kind)
  select class.school_id, class.id, null, 'class'::public.chat_room_kind
  from public.classes as class
  where class.school_id = new.school_id
    and class.academic_year_id = new.id
  on conflict do nothing;

  insert into public.chat_rooms (school_id, class_id, subject_id, kind)
  select class.school_id, class.id, assignment.subject_id, 'subject'::public.chat_room_kind
  from public.class_subjects as assignment
  join public.classes as class
    on class.id = assignment.class_id
   and class.school_id = new.school_id
  join public.subjects as subject
    on subject.id = assignment.subject_id
   and subject.school_id = new.school_id
  where assignment.school_id = new.school_id
    and assignment.teacher_id is not null
    and class.academic_year_id = new.id
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function public.provision_current_academic_year_chat_rooms() from public;

create trigger provision_current_academic_year_chat_rooms_after_current_update
after update of is_current on public.academic_years
for each row
when (new.is_current is true and old.is_current is distinct from new.is_current)
execute function public.provision_current_academic_year_chat_rooms();
