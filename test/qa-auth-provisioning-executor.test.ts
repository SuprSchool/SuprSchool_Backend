import { classAnnouncements } from '../src/db/schema/announcements.js';
import { assignments, assignmentRubrics } from '../src/db/schema/assignments.js';
import { attendanceRecords, attendanceSessions } from '../src/db/schema/attendance.js';
import { classDiaryEntries } from '../src/db/schema/diary.js';
import { profileInterests } from '../src/db/schema/core.js';
import { expect, it } from 'vitest';

import { runQaAuthProvisioning, type QaAdminClient } from '../scripts/provision-qa-auth-users.js';
import type { Database } from '../src/db/client.js';

// Catches the original ordering bug: a directory claim belonging to another
// user must stop the command before any Admin Auth write occurs.
it('run rejects an incompatible directory claim before mutating Admin Auth', async () => {
  const mutations: string[] = [];
  const adminClient: QaAdminClient = {
    auth: {
      admin: {
        createUser: async () => {
          mutations.push('create');
          return { data: { user: null }, error: null };
        },
        deleteUser: async (id: string) => {
          mutations.push(`delete:${id}`);
          return { data: { user: null }, error: null };
        },
        getUserById: async (id: string) => ({
          data: { user: { id, phone: '+917755090948', phone_confirmed_at: '2026-01-01T00:00:00Z' } },
          error: null,
        }),
        listUsers: async () => ({
          data: { users: [
            { id: 'student-user', phone: '+917755090948', phone_confirmed_at: '2026-01-01T00:00:00Z' },
            { id: 'teacher-user', phone: '+919000000001', phone_confirmed_at: '2026-01-01T00:00:00Z' },
          ] },
          error: null,
        }),
      },
    },
  };
  const db = {
    select: () => ({
      from: () => ({
        where: async () => [{ phoneE164: '+917755090948', claimedByUserId: 'other-user' }],
      }),
    }),
  } as unknown as Database;

  await expect(runQaAuthProvisioning({
    environment: {
      DATABASE_URL: 'postgres://test',
      SUPABASE_URL: 'https://example.test',
      SUPABASE_SECRET_KEY: 'test-service-key',
      QA_PROVISION_PASSWORD: 'test-only-password',
      QA_PROVISION_CONFIRM: '1',
    },
    createDatabase: () => ({ db, client: { end: async () => undefined } }),
    createAdminClient: () => adminClient,
    log: () => undefined,
  })).rejects.toThrow('claimed by another user');

  expect(mutations).toEqual([]);
});

// Catches a regression where the protected orchestration creates valid Admin
// users but fails to persist the restored group 1-2 public fixture graph.
it('run writes historical group 1-2 rows with generated Admin Auth IDs', async () => {
  const generatedStudentId = '1f2d0c30-7b18-4d46-9f23-5a6f0bc15a0e';
  const generatedTeacherId = '2a760c18-1f2e-4374-b4d8-01fc789ae95d';
  const inserts: Array<{ table: unknown; values: unknown }> = [];
  const executed: unknown[] = [];
  const transaction = {
    execute: async (query: unknown) => { executed.push(query); },
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        inserts.push({ table, values });
        return {
          onConflictDoNothing: () => undefined,
          onConflictDoUpdate: () => ({
            returning: async () => [
              { id: '60000000-0000-4000-8000-000000000001', phoneE164: '+917755090948' },
              { id: '60000000-0000-4000-8000-000000000002', phoneE164: '+919000000001' },
            ],
          }),
        };
      },
    }),
  } as unknown as Database;
  const db = {
    select: () => ({ from: () => ({ where: async () => [] }) }),
    transaction: async (callback: (tx: Database) => Promise<void>) => callback(transaction),
  } as unknown as Database;
  const adminClient: QaAdminClient = {
    auth: {
      admin: {
        createUser: async () => ({ data: { user: null }, error: null }),
        deleteUser: async () => ({ data: { user: null }, error: null }),
        getUserById: async (id: string) => ({
          data: { user: { id, phone: id === generatedStudentId ? '+917755090948' : '+919000000001', phone_confirmed_at: '2026-01-01T00:00:00Z' } },
          error: null,
        }),
        listUsers: async () => ({
          data: { users: [
            { id: generatedStudentId, phone: '+917755090948', phone_confirmed_at: '2026-01-01T00:00:00Z' },
            { id: generatedTeacherId, phone: '+919000000001', phone_confirmed_at: '2026-01-01T00:00:00Z' },
          ] },
          error: null,
        }),
      },
    },
  };

  await runQaAuthProvisioning({
    environment: {
      DATABASE_URL: 'postgres://test', SUPABASE_URL: 'https://example.test',
      SUPABASE_SECRET_KEY: 'test-service-key', QA_PROVISION_PASSWORD: 'test-only-password', QA_PROVISION_CONFIRM: '1',
    },
    createDatabase: () => ({ db, client: { end: async () => undefined } }),
    createAdminClient: () => adminClient,
    log: () => undefined,
  });

  for (const table of [profileInterests, classAnnouncements, attendanceSessions, attendanceRecords, classDiaryEntries, assignments, assignmentRubrics]) {
    expect(inserts.some((insert) => insert.table === table)).toBe(true);
  }
  expect(executed).toHaveLength(2);
  const fixtureValues = JSON.stringify(inserts.map((insert) => insert.values));
  expect(fixtureValues).toContain(generatedStudentId);
  expect(fixtureValues).toContain(generatedTeacherId);
  expect(fixtureValues).not.toContain('10000000-0000-4000-8000-000000000001');
});
// Catches the Auth identity replacement race between read-only preflight and
// reuse. The rejected ownership mismatch must prevent every Admin Auth write.
it('run rejects a replaced student identity before any Auth write', async () => {
  const mutations: string[] = [];
  let listCalls = 0;
  const adminClient: QaAdminClient = {
    auth: {
      admin: {
        createUser: async () => {
          mutations.push('create');
          return { data: { user: null }, error: null };
        },
        deleteUser: async (id: string) => {
          mutations.push(`delete:${id}`);
          return { data: { user: null }, error: null };
        },
        getUserById: async (id: string) => ({
          data: { user: { id, phone: id.startsWith('student') ? '+917755090948' : '+919000000001', phone_confirmed_at: '2026-01-01T00:00:00Z' } },
          error: null,
        }),
        listUsers: async () => {
          listCalls += 1;
          return {
            data: { users: listCalls < 3
              ? [
                { id: 'student-a', phone: '+917755090948', phone_confirmed_at: '2026-01-01T00:00:00Z' },
                { id: 'teacher-a', phone: '+919000000001', phone_confirmed_at: '2026-01-01T00:00:00Z' },
              ]
              : [
                { id: 'student-b', phone: '+917755090948', phone_confirmed_at: '2026-01-01T00:00:00Z' },
                { id: 'teacher-a', phone: '+919000000001', phone_confirmed_at: '2026-01-01T00:00:00Z' },
              ] },
            error: null,
          };
        },
      },
    },
  };
  const db = {
    select: () => ({
      from: () => ({
        where: async () => [{ phoneE164: '+917755090948', claimedByUserId: 'student-a' }],
      }),
    }),
  } as unknown as Database;

  await expect(runQaAuthProvisioning({
    environment: {
      DATABASE_URL: 'postgres://test', SUPABASE_URL: 'https://example.test',
      SUPABASE_SECRET_KEY: 'test-service-key', QA_PROVISION_PASSWORD: 'test-only-password', QA_PROVISION_CONFIRM: '1',
    },
    createDatabase: () => ({ db, client: { end: async () => undefined } }),
    createAdminClient: () => adminClient,
    log: () => undefined,
  })).rejects.toThrow('changed since preflight');

  expect(mutations).toEqual([]);
});

// Catches the second identity changing between preflight and the shared
// read-only verification. Both identities must pass before any Auth write.
it('run rejects a replaced teacher identity before any Auth write', async () => {
  const mutations: string[] = [];
  let listCalls = 0;
  const adminClient: QaAdminClient = {
    auth: {
      admin: {
        createUser: async () => {
          mutations.push('create');
          return { data: { user: null }, error: null };
        },
        deleteUser: async (id: string) => {
          mutations.push(`delete:${id}`);
          return { data: { user: null }, error: null };
        },
        getUserById: async (id: string) => ({
          data: { user: { id, phone: id.startsWith('student') ? '+917755090948' : '+919000000001', phone_confirmed_at: '2026-01-01T00:00:00Z' } },
          error: null,
        }),
        listUsers: async () => {
          listCalls += 1;
          return {
            data: { users: listCalls < 4
              ? [
                { id: 'student-a', phone: '+917755090948', phone_confirmed_at: '2026-01-01T00:00:00Z' },
                { id: 'teacher-a', phone: '+919000000001', phone_confirmed_at: '2026-01-01T00:00:00Z' },
              ]
              : [
                { id: 'student-a', phone: '+917755090948', phone_confirmed_at: '2026-01-01T00:00:00Z' },
                { id: 'teacher-b', phone: '+919000000001', phone_confirmed_at: '2026-01-01T00:00:00Z' },
              ] },
            error: null,
          };
        },
      },
    },
  };
  const db = {
    select: () => ({ from: () => ({ where: async () => [] }) }),
  } as unknown as Database;

  await expect(runQaAuthProvisioning({
    environment: {
      DATABASE_URL: 'postgres://test', SUPABASE_URL: 'https://example.test',
      SUPABASE_SECRET_KEY: 'test-service-key', QA_PROVISION_PASSWORD: 'test-only-password', QA_PROVISION_CONFIRM: '1',
    },
    createDatabase: () => ({ db, client: { end: async () => undefined } }),
    createAdminClient: () => adminClient,
    log: () => undefined,
  })).rejects.toThrow('changed since preflight');

  expect(mutations).toEqual([]);
});

// Catches credential replacement after an existing confirmed identity has
// passed the read-only Admin checks. Existing accounts are reused, never
// updated by the QA fixture command.
it('run reuses existing confirmed Auth users without any Auth writes', async () => {
  const authWrites: string[] = [];
  const users = [
    { id: 'student-user', phone: '+917755090948', phone_confirmed_at: '2026-01-01T00:00:00Z' },
    { id: 'teacher-user', phone: '+919000000001', phone_confirmed_at: '2026-01-01T00:00:00Z' },
  ];
  const adminClient: QaAdminClient = {
    auth: {
      admin: {
        createUser: async () => {
          authWrites.push('create');
          return { data: { user: null }, error: null };
        },
        deleteUser: async (id: string) => {
          authWrites.push(`delete:${id}`);
          return { data: { user: null }, error: null };
        },
        getUserById: async (id: string) => ({
          data: { user: users.find((user) => user.id === id) ?? null },
          error: null,
        }),
        listUsers: async () => ({ data: { users }, error: null }),
      },
    },
  };
  const db = {
    select: () => ({ from: () => ({ where: async () => [] }) }),
    transaction: async () => undefined,
  } as unknown as Database;

  await runQaAuthProvisioning({
    environment: {
      DATABASE_URL: 'postgres://test', SUPABASE_URL: 'https://example.test',
      SUPABASE_SECRET_KEY: 'test-service-key', QA_PROVISION_PASSWORD: 'test-only-password', QA_PROVISION_CONFIRM: '1',
    },
    createDatabase: () => ({ db, client: { end: async () => undefined } }),
    createAdminClient: () => adminClient,
    log: () => undefined,
  });

  expect(authWrites).toEqual([]);
});
