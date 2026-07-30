alter table public.events
  add column gender_eligibility text not null default 'mixed',
  add column rules_and_regulations text;

alter table public.events
  add constraint events_gender_eligibility_check
    check (gender_eligibility in ('female', 'male', 'mixed')),
  add constraint events_rules_and_regulations_length_check
    check (rules_and_regulations is null or char_length(rules_and_regulations) <= 10000);

alter table public.event_managers
  add column contact text;

alter table public.event_managers
  add constraint event_managers_contact_length_check
    check (contact is null or char_length(btrim(contact)) between 1 and 320);

update public.events
set registration_deadline_at = starts_at
where registration_deadline_at is null;

alter table public.events
  alter column registration_deadline_at set not null;
