alter table public.class_announcements
  add column audience_type text not null default 'class';

alter table public.class_announcements
  alter column class_id drop not null,
  alter column subject_id drop not null;

alter table public.class_announcements
  add constraint class_announcements_audience_type_check
    check (audience_type in ('class', 'school')),
  add constraint class_announcements_audience_check
    check (
      (audience_type = 'school' and class_id is null and subject_id is null)
      or
      (audience_type = 'class' and class_id is not null and subject_id is not null)
    );

create index class_announcements_school_audience_cursor_idx
  on public.class_announcements (school_id, published_at desc, id desc)
  where is_published and audience_type = 'school';
