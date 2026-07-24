create type public.ranking_scope_kind as enum ('class', 'subject');

create table public.ranking_refresh_scopes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete cascade,
  scope_kind public.ranking_scope_kind not null,
  dirty_version bigint not null default 1 check (dirty_version >= 1),
  refreshed_version bigint not null default 0 check (refreshed_version >= 0 and refreshed_version <= dirty_version),
  dirty_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, school_id),
  check (
    (scope_kind = 'class' and subject_id is null)
    or (scope_kind = 'subject' and subject_id is not null)
  )
);

create unique index ranking_refresh_scopes_class_unique
  on public.ranking_refresh_scopes (school_id, class_id)
  where scope_kind = 'class' and subject_id is null;

create unique index ranking_refresh_scopes_subject_unique
  on public.ranking_refresh_scopes (school_id, class_id, subject_id)
  where scope_kind = 'subject' and subject_id is not null;

create index ranking_refresh_scopes_dirty_index
  on public.ranking_refresh_scopes (school_id, dirty_at)
  where dirty_version > refreshed_version;

create table public.ranking_refresh_outbox (
  event_id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  scope_id uuid not null,
  target_version bigint not null check (target_version >= 1),
  dispatch_attempts integer not null default 0 check (dispatch_attempts >= 0),
  last_enqueued_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (scope_id, school_id) references public.ranking_refresh_scopes (id, school_id) on delete cascade,
  unique (scope_id, target_version)
);

create index ranking_refresh_outbox_dispatch_index
  on public.ranking_refresh_outbox (last_enqueued_at, created_at, event_id);

create table public.ranking_snapshots (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete cascade,
  scope_id uuid not null,
  source_version bigint not null check (source_version >= 1),
  generated_at timestamptz not null default now(),
  unique (id, school_id),
  foreign key (scope_id, school_id) references public.ranking_refresh_scopes (id, school_id) on delete cascade,
  unique (scope_id, source_version)
);

create index ranking_snapshots_current_index
  on public.ranking_snapshots (school_id, class_id, scope_id, source_version desc, generated_at desc);

create table public.ranking_entries (
  snapshot_id uuid not null,
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  rank integer not null check (rank > 0),
  points integer not null,
  marks numeric(7, 2) not null default 0,
  streak_count integer not null default 0 check (streak_count >= 0),
  foreign key (snapshot_id, school_id) references public.ranking_snapshots (id, school_id) on delete cascade,
  primary key (snapshot_id, user_id),
  unique (snapshot_id, rank)
);

create index ranking_entries_user_index
  on public.ranking_entries (school_id, user_id, snapshot_id);

-- Each mutation gets a new version and its own durable event. A worker may safely
-- satisfy a newer version while handling an older message; the remaining events
-- are then removed only after that immutable snapshot commits.
create function public.queue_ranking_scope_refresh(
  p_school_id uuid,
  p_class_id uuid,
  p_scope_kind public.ranking_scope_kind,
  p_subject_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_scope record;
begin
  if p_scope_kind = 'class' and p_subject_id is not null then
    raise exception 'Class ranking scope cannot include a subject';
  end if;
  if p_scope_kind = 'subject' and p_subject_id is null then
    raise exception 'Subject ranking scope requires a subject';
  end if;

  if p_scope_kind = 'class' then
    insert into public.ranking_refresh_scopes (
      school_id, class_id, subject_id, scope_kind, dirty_version, refreshed_version, dirty_at, updated_at
    )
    values (p_school_id, p_class_id, null, 'class', 1, 0, now(), now())
    on conflict (school_id, class_id) where scope_kind = 'class' and subject_id is null
    do update
    set dirty_version = public.ranking_refresh_scopes.dirty_version + 1,
        dirty_at = now(),
        updated_at = now()
    returning id, dirty_version into requested_scope;
  else
    insert into public.ranking_refresh_scopes (
      school_id, class_id, subject_id, scope_kind, dirty_version, refreshed_version, dirty_at, updated_at
    )
    values (p_school_id, p_class_id, p_subject_id, 'subject', 1, 0, now(), now())
    on conflict (school_id, class_id, subject_id) where scope_kind = 'subject' and subject_id is not null
    do update
    set dirty_version = public.ranking_refresh_scopes.dirty_version + 1,
        dirty_at = now(),
        updated_at = now()
    returning id, dirty_version into requested_scope;
  end if;

  insert into public.ranking_refresh_outbox (
    event_id, school_id, scope_id, target_version
  )
  values (
    gen_random_uuid(), p_school_id, requested_scope.id, requested_scope.dirty_version
  )
  on conflict (scope_id, target_version) do nothing;
end;
$$;

revoke all on function public.queue_ranking_scope_refresh(uuid, uuid, public.ranking_scope_kind, uuid) from public;

-- This replaces the earlier function definition in an additive migration. The
-- original append-only ledger trigger remains unchanged and invokes this new body.
create or replace function public.apply_point_ledger_entry_to_balance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  class_membership record;
  subject_scope record;
begin
  insert into public.point_account_balances (
    school_id, user_id, current_points, updated_at
  )
  values (NEW.school_id, NEW.recipient_user_id, NEW.points, now())
  on conflict (school_id, user_id) do update
  set
    current_points = public.point_account_balances.current_points + excluded.current_points,
    updated_at = excluded.updated_at;

  -- Preserve the previous per-recipient dirty marker for operators during the
  -- transition; queue delivery uses the scoped outbox below.
  insert into public.ranking_refresh_requests (
    school_id, recipient_user_id, is_dirty, dirty_at
  )
  values (NEW.school_id, NEW.recipient_user_id, true, now())
  on conflict (school_id, recipient_user_id) do update
  set is_dirty = true, dirty_at = excluded.dirty_at;

  for class_membership in
    select membership.class_id
    from public.class_members as membership
    join public.academic_years as academic_year
      on academic_year.id = membership.academic_year_id
     and academic_year.school_id = membership.school_id
     and academic_year.is_current = true
    join public.user_roles as role
      on role.user_id = membership.student_id
     and role.school_id = membership.school_id
     and role.role = 'student'
     and role.is_active = true
    where membership.school_id = NEW.school_id
      and membership.student_id = NEW.recipient_user_id
      and membership.is_active = true
  loop
    perform public.queue_ranking_scope_refresh(
      NEW.school_id, class_membership.class_id, 'class', null
    );
    for subject_scope in
      select class_subject.subject_id
      from public.class_subjects as class_subject
      where class_subject.school_id = NEW.school_id
        and class_subject.class_id = class_membership.class_id
    loop
      perform public.queue_ranking_scope_refresh(
        NEW.school_id, class_membership.class_id, 'subject', subject_scope.subject_id
      );
    end loop;
  end loop;

  return NEW;
end;
$$;

revoke all on function public.apply_point_ledger_entry_to_balance() from public;

create function public.queue_ranking_refresh_for_class(
  p_school_id uuid,
  p_class_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  subject_scope record;
begin
  perform public.queue_ranking_scope_refresh(p_school_id, p_class_id, 'class', null);
  for subject_scope in
    select class_subject.subject_id
    from public.class_subjects as class_subject
    where class_subject.school_id = p_school_id
      and class_subject.class_id = p_class_id
  loop
    perform public.queue_ranking_scope_refresh(
      p_school_id, p_class_id, 'subject', subject_scope.subject_id
    );
  end loop;
end;
$$;

revoke all on function public.queue_ranking_refresh_for_class(uuid, uuid) from public;

create function public.queue_ranking_refresh_for_attendance_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_row record;
begin
  if TG_OP = 'INSERT' then
    for session_row in
      select session.school_id, session.class_id
      from public.attendance_sessions as session
      where session.id = NEW.session_id
    loop
      perform public.queue_ranking_refresh_for_class(session_row.school_id, session_row.class_id);
    end loop;
  elsif TG_OP = 'DELETE' then
    for session_row in
      select session.school_id, session.class_id
      from public.attendance_sessions as session
      where session.id = OLD.session_id
    loop
      perform public.queue_ranking_refresh_for_class(session_row.school_id, session_row.class_id);
    end loop;
  else
    for session_row in
      select distinct session.school_id, session.class_id
      from public.attendance_sessions as session
      where session.id in (OLD.session_id, NEW.session_id)
    loop
      perform public.queue_ranking_refresh_for_class(session_row.school_id, session_row.class_id);
    end loop;
  end if;
  return coalesce(NEW, OLD);
end;
$$;

revoke all on function public.queue_ranking_refresh_for_attendance_change() from public;

create trigger attendance_records_queue_ranking_refresh
  after insert or update or delete on public.attendance_records
  for each row execute function public.queue_ranking_refresh_for_attendance_change();

create function public.queue_ranking_refresh_for_attendance_session_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'DELETE' then
    perform public.queue_ranking_refresh_for_class(OLD.school_id, OLD.class_id);
  else
    perform public.queue_ranking_refresh_for_class(NEW.school_id, NEW.class_id);
    if TG_OP = 'UPDATE' and (OLD.school_id, OLD.class_id) is distinct from (NEW.school_id, NEW.class_id) then
      perform public.queue_ranking_refresh_for_class(OLD.school_id, OLD.class_id);
    end if;
  end if;
  return coalesce(NEW, OLD);
end;
$$;

revoke all on function public.queue_ranking_refresh_for_attendance_session_change() from public;

create trigger attendance_sessions_queue_ranking_refresh
  after insert or update or delete on public.attendance_sessions
  for each row execute function public.queue_ranking_refresh_for_attendance_session_change();

create function public.queue_ranking_refresh_for_class_member_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'DELETE' then
    perform public.queue_ranking_refresh_for_class(OLD.school_id, OLD.class_id);
  else
    perform public.queue_ranking_refresh_for_class(NEW.school_id, NEW.class_id);
    if TG_OP = 'UPDATE' and (OLD.school_id, OLD.class_id) is distinct from (NEW.school_id, NEW.class_id) then
      perform public.queue_ranking_refresh_for_class(OLD.school_id, OLD.class_id);
    end if;
  end if;
  return coalesce(NEW, OLD);
end;
$$;

revoke all on function public.queue_ranking_refresh_for_class_member_change() from public;

create trigger class_members_queue_ranking_refresh
  after insert or update or delete on public.class_members
  for each row execute function public.queue_ranking_refresh_for_class_member_change();

create function public.queue_ranking_refresh_for_class_subject_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'DELETE' then
    perform public.queue_ranking_scope_refresh(OLD.school_id, OLD.class_id, 'class', null);
  else
    perform public.queue_ranking_scope_refresh(NEW.school_id, NEW.class_id, 'class', null);
    perform public.queue_ranking_scope_refresh(NEW.school_id, NEW.class_id, 'subject', NEW.subject_id);
    if TG_OP = 'UPDATE' and (OLD.school_id, OLD.class_id, OLD.subject_id) is distinct from (NEW.school_id, NEW.class_id, NEW.subject_id) then
      perform public.queue_ranking_scope_refresh(OLD.school_id, OLD.class_id, 'class', null);
    end if;
  end if;
  return coalesce(NEW, OLD);
end;
$$;

revoke all on function public.queue_ranking_refresh_for_class_subject_change() from public;

create trigger class_subjects_queue_ranking_refresh
  after insert or update or delete on public.class_subjects
  for each row execute function public.queue_ranking_refresh_for_class_subject_change();

-- Phase 2 creates exam_results later in the merge order. Attach these invalidators
-- only when that domain is present so this additive migration remains runnable alone.
create function public.queue_ranking_refresh_for_assessment_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'DELETE' then
    perform public.queue_ranking_refresh_for_class(OLD.school_id, OLD.class_id);
  else
    perform public.queue_ranking_refresh_for_class(NEW.school_id, NEW.class_id);
    if TG_OP = 'UPDATE' and (OLD.school_id, OLD.class_id) is distinct from (NEW.school_id, NEW.class_id) then
      perform public.queue_ranking_refresh_for_class(OLD.school_id, OLD.class_id);
    end if;
  end if;
  return coalesce(NEW, OLD);
end;
$$;

revoke all on function public.queue_ranking_refresh_for_assessment_change() from public;

create trigger class_exams_queue_ranking_refresh
  after insert or update or delete on public.class_exams
  for each row execute function public.queue_ranking_refresh_for_assessment_change();

do $$
begin
  if to_regclass('public.exam_results') is not null then
    execute $trigger$
      create function public.queue_ranking_refresh_for_exam_result_change()
      returns trigger
      language plpgsql
      security definer
      set search_path = ''
      as $body$
      declare
        assessment_row record;
      begin
        select assessment.school_id, assessment.class_id
        into assessment_row
        from public.class_exams as assessment
        where assessment.id = case when TG_OP = 'DELETE' then OLD.assessment_id else NEW.assessment_id end;
        if found then
          perform public.queue_ranking_refresh_for_class(assessment_row.school_id, assessment_row.class_id);
        end if;
        return coalesce(NEW, OLD);
      end;
      $body$;
    $trigger$;
    revoke all on function public.queue_ranking_refresh_for_exam_result_change() from public;
    execute 'create trigger exam_results_queue_ranking_refresh after insert or update or delete on public.exam_results for each row execute function public.queue_ranking_refresh_for_exam_result_change()';
  end if;
end;
$$;


-- Revision rows supersede a base result only after publication. Their lifecycle must
-- refresh every class/subject scope affected by the assessment.
do $$
begin
  if to_regclass('public.exam_result_revisions') is not null then
    execute $trigger$
      create function public.queue_ranking_refresh_for_exam_result_revision_change()
      returns trigger
      language plpgsql
      security definer
      set search_path = ''
      as $body$
      declare
        assessment_row record;
      begin
        select assessment.school_id, assessment.class_id
        into assessment_row
        from public.class_exams as assessment
        where assessment.id = case when TG_OP = 'DELETE' then OLD.assessment_id else NEW.assessment_id end;
        if found then
          perform public.queue_ranking_refresh_for_class(assessment_row.school_id, assessment_row.class_id);
        end if;
        return coalesce(NEW, OLD);
      end;
      $body$;
    $trigger$;
    execute 'revoke all on function public.queue_ranking_refresh_for_exam_result_revision_change() from public';
    execute 'create trigger exam_result_revisions_queue_ranking_refresh after insert or update or delete on public.exam_result_revisions for each row execute function public.queue_ranking_refresh_for_exam_result_revision_change()';
  end if;

  if to_regclass('public.exam_groups') is not null then
    execute $trigger$
      create function public.queue_ranking_refresh_for_exam_group_change()
      returns trigger
      language plpgsql
      security definer
      set search_path = ''
      as $body$
      begin
        if TG_OP = 'DELETE' then
          perform public.queue_ranking_refresh_for_class(OLD.school_id, OLD.class_id);
        else
          perform public.queue_ranking_refresh_for_class(NEW.school_id, NEW.class_id);
          if TG_OP = 'UPDATE' and (OLD.school_id, OLD.class_id) is distinct from (NEW.school_id, NEW.class_id) then
            perform public.queue_ranking_refresh_for_class(OLD.school_id, OLD.class_id);
          end if;
        end if;
        return coalesce(NEW, OLD);
      end;
      $body$;
    $trigger$;
    execute 'revoke all on function public.queue_ranking_refresh_for_exam_group_change() from public';
    execute 'create trigger exam_groups_queue_ranking_refresh after insert or update or delete on public.exam_groups for each row execute function public.queue_ranking_refresh_for_exam_group_change()';
  end if;
end;
$$;

create function public.can_read_ranking_scope(
  p_school_id uuid,
  p_class_id uuid,
  p_subject_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.class_members as membership
    join public.academic_years as academic_year
      on academic_year.id = membership.academic_year_id
     and academic_year.school_id = membership.school_id
     and academic_year.is_current = true
    join public.user_roles as role
      on role.user_id = membership.student_id
     and role.school_id = membership.school_id
     and role.role = 'student'
     and role.is_active = true
    where membership.school_id = p_school_id
      and membership.class_id = p_class_id
      and membership.student_id = auth.uid()
      and membership.is_active = true
      and (
        p_subject_id is null
        or exists (
          select 1
          from public.class_subjects as class_subject
          where class_subject.school_id = p_school_id
            and class_subject.class_id = p_class_id
            and class_subject.subject_id = p_subject_id
        )
      )
  );
$$;

revoke all on function public.can_read_ranking_scope(uuid, uuid, uuid) from public;
grant execute on function public.can_read_ranking_scope(uuid, uuid, uuid) to authenticated;

alter table public.ranking_refresh_scopes enable row level security;
alter table public.ranking_refresh_outbox enable row level security;
alter table public.ranking_snapshots enable row level security;
alter table public.ranking_entries enable row level security;

revoke all on table public.ranking_refresh_scopes from anon, authenticated;
revoke all on table public.ranking_refresh_outbox from anon, authenticated;

create policy "students read active class ranking snapshots"
on public.ranking_snapshots for select to authenticated
using (
  public.can_read_ranking_scope(school_id, class_id, subject_id)
);

create policy "students read active class ranking entries"
on public.ranking_entries for select to authenticated
using (
  exists (
    select 1
    from public.ranking_snapshots as snapshot
    where snapshot.id = ranking_entries.snapshot_id
      and snapshot.school_id = ranking_entries.school_id
      and public.can_read_ranking_scope(snapshot.school_id, snapshot.class_id, snapshot.subject_id)
  )
);
