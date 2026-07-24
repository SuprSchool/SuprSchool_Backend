import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  eventResultEntries,
  events,
  eventsSchema,
} from '../src/db/schema/events.js';

const migrationUrl = new URL(
  '../supabase/migrations/20260716150000_events.sql',
  import.meta.url,
);

type Column = {
  getSQLType(): string;
  notNull: boolean;
};

type EventManagersTable = {
  id: Column;
  schoolId: Column;
  eventId: Column;
  userId: Column;
  memberType: Column;
  managerRole: Column;
  createdAt: Column;
};

describe('Events Drizzle schema', () => {
  it('keeps result revisions/ranks and event managers aligned with the migration', async () => {
    const migration = await readFile(migrationUrl, 'utf8');
    const eventManagers = (eventsSchema as Record<string, unknown>)
      .eventManagers as EventManagersTable | undefined;

    expect(events.resultsRevision.getSQLType()).toBe('integer');
    expect(eventResultEntries.denseRank.getSQLType()).toBe('integer');
    expect(eventResultEntries.revision.getSQLType()).toBe('integer');
    expect(eventManagers).toBeDefined();

    if (!eventManagers) {
      throw new Error('eventsSchema must expose eventManagers');
    }

    expect({
      id: eventManagers.id.getSQLType(),
      schoolId: eventManagers.schoolId.getSQLType(),
      eventId: eventManagers.eventId.getSQLType(),
      userId: eventManagers.userId.getSQLType(),
      memberType: eventManagers.memberType.getSQLType(),
      managerRole: eventManagers.managerRole.getSQLType(),
      createdAt: eventManagers.createdAt.getSQLType(),
    }).toEqual({
      id: 'uuid',
      schoolId: 'uuid',
      eventId: 'uuid',
      userId: 'uuid',
      memberType: 'text',
      managerRole: 'text',
      createdAt: 'timestamp with time zone',
    });
    expect([
      eventManagers.schoolId.notNull,
      eventManagers.eventId.notNull,
      eventManagers.userId.notNull,
      eventManagers.memberType.notNull,
      eventManagers.managerRole.notNull,
    ]).toEqual([true, true, true, true, true]);

    expect(migration).toMatch(/results_revision integer not null default 0/);
    expect(migration).toMatch(/dense_rank integer/);
    expect(migration).toMatch(/revision integer not null default 0/);
    expect(migration).toMatch(/create table public\.event_managers/);
    expect(migration).toMatch(/unique \(event_id, user_id\)/);
    expect(migration).toMatch(/event_managers_school_user_event_idx/);
  });
});


describe("Events migration-enforced constraints", () => {
  it("declares every manager and result check plus result index from the migration", async () => {
    const [migration, schema] = await Promise.all([
      readFile(migrationUrl, "utf8"),
      readFile(new URL("../src/db/schema/events.ts", import.meta.url), "utf8"),
    ]);

    for (const construct of [
      "member_type text not null check (member_type in (\x27teacher\x27, \x27student\x27))",
      "manager_role text not null check (char_length(btrim(manager_role)) between 1 and 120)",
      "target_type text not null check (target_type in (\x27registration\x27, \x27team\x27))",
      "dense_rank integer check (dense_rank is null or dense_rank > 0)",
      "revision integer not null default 0 check (revision >= 0)",
      "(target_type = \x27registration\x27 and registration_id is not null and team_id is null)",
      "(target_type = \x27team\x27 and team_id is not null and registration_id is null)",
      "create unique index event_results_registration_target_unique",
      "where target_type = \x27registration\x27",
      "create unique index event_results_team_target_unique",
      "where target_type = \x27team\x27",
      "on public.event_result_entries (school_id, event_id, dense_rank, id)",
    ]) {
      expect(migration).toContain(construct);
    }

    for (const declaration of [
      "check(\x27event_managers_member_type_check\x27, sql`${table.memberType} in (\x27teacher\x27, \x27student\x27)`)",
      "check(\x27event_managers_manager_role_check\x27, sql`char_length(btrim(${table.managerRole})) between 1 and 120`)",
      "check(\x27event_result_entries_target_type_check\x27, sql`${table.targetType} in (\x27registration\x27, \x27team\x27)`)",
      "check(\x27event_result_entries_dense_rank_check\x27, sql`${table.denseRank} is null or ${table.denseRank} > 0`)",
      "check(\x27event_result_entries_revision_check\x27, sql`${table.revision} >= 0`)",
      "check(\x27event_result_entries_target_check\x27",
      "uniqueIndex(\x27event_results_registration_target_unique\x27).on(table.eventId, table.registrationId).where(sql`${table.targetType} = \x27registration\x27`)",
      "uniqueIndex(\x27event_results_team_target_unique\x27).on(table.eventId, table.teamId).where(sql`${table.targetType} = \x27team\x27`)",
      "index(\x27event_results_school_event_rank_idx\x27).on(table.schoolId, table.eventId, table.denseRank, table.id)",
    ]) {
      expect(schema).toContain(declaration);
    }
  });

  it("declares the migration target xor check exactly", async () => {
    const schema = await readFile(new URL("../src/db/schema/events.ts", import.meta.url), "utf8");

    expect(schema).toContain("check('event_result_entries_target_check', sql`(${table.targetType} = 'registration' and ${table.registrationId} is not null and ${table.teamId} is null) or (${table.targetType} = 'team' and ${table.teamId} is not null and ${table.registrationId} is null)`)");
  });
});
