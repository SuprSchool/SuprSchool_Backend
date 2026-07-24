alter table public.academic_outbox_events
  drop constraint if exists academic_outbox_events_event_type_check;

alter table public.academic_outbox_events
  add constraint academic_outbox_events_event_type_check
  check (event_type in (
    'announcement.published',
    'assignment.submitted',
    'assignment.graded',
    'assignment.reminder.requested',
    'exam.published',
    'exam.reminder.requested',
    'exam.results_published'
  ));
