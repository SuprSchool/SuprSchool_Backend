import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';
import { eventManagers, events } from '../src/db/schema/events.js';

import {
  createEventSchema,
  managingTeamSchema,
  updateEventSchema,
} from '../src/validators/events.schemas.js';

const commonEvent = {
  activityKind: 'event' as const,
  startsAt: '2026-08-20T10:00:00.000Z',
  targetClassIds: ['11111111-1111-4111-8111-111111111111'],
  title: 'Science fair',
};

describe('event metadata contract', () => {
  it('requires a registration deadline when an event is created', () => {
    const parsed = createEventSchema.safeParse(commonEvent);

    expect(parsed.success).toBe(false);
  });

  it('accepts persisted gender and rules metadata with a required deadline', () => {
    expect(createEventSchema.parse({
      ...commonEvent,
      genderEligibility: 'female',
      registrationDeadlineAt: '2026-08-19T10:00:00.000Z',
      rulesAndRegulations: 'Bring school identification.',
    })).toMatchObject({
      genderEligibility: 'female',
      registrationDeadlineAt: '2026-08-19T10:00:00.000Z',
      rulesAndRegulations: 'Bring school identification.',
    });
  });

  it('does not allow an update to clear the required registration deadline', () => {
    expect(updateEventSchema.safeParse({ registrationDeadlineAt: null }).success).toBe(false);
  });

  it('accepts an optional event-specific manager contact and rejects blank contact', () => {
    const manager = {
      memberType: 'teacher' as const,
      role: 'Coordinator',
      userId: '22222222-2222-4222-8222-222222222222',
    };

    expect(managingTeamSchema.parse({
      members: [{ ...manager, contact: 'coordinator@school.example' }],
    }).members[0]).toMatchObject({ contact: 'coordinator@school.example' });
    expect(managingTeamSchema.safeParse({
      members: [{ ...manager, contact: '   ' }],
    }).success).toBe(false);
  });
});

describe('event metadata storage contract', () => {
  it('maps the new event and manager columns in Drizzle', () => {
    expect({
      genderEligibility: events.genderEligibility.getSQLType(),
      rulesAndRegulations: events.rulesAndRegulations.getSQLType(),
      managerContact: eventManagers.contact.getSQLType(),
    }).toEqual({
      genderEligibility: 'text',
      rulesAndRegulations: 'text',
      managerContact: 'text',
    });
    expect(events.registrationDeadlineAt.notNull).toBe(true);
  });

  it('backfills deadlines before making them required and adds bounded metadata constraints', async () => {
    const migration = await readFile(new URL(
      '../supabase/migrations/20260729180000_event_metadata_manager_contact.sql',
      import.meta.url,
    ), 'utf8');

    expect(migration).toContain("gender_eligibility text not null default 'mixed'");
    expect(migration).toContain("gender_eligibility in ('female', 'male', 'mixed')");
    expect(migration).toContain('char_length(rules_and_regulations) <= 10000');
    expect(migration).toContain('char_length(btrim(contact)) between 1 and 320');
    expect(migration.indexOf('set registration_deadline_at = starts_at'))
      .toBeLessThan(migration.indexOf('registration_deadline_at set not null'));
    expect(migration).not.toContain('create index');
  });
});
