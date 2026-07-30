import { expect, it } from 'vitest';

import {
  runQaAuthProvisioning,
  type QaAdminClient,
  type QaAdminUser,
} from '../scripts/provision-qa-auth-users.js';
import type { Database } from '../src/db/client.js';

const studentPhone = '+917755090948';
const teacherPhone = '+919000000001';
const environment = {
  DATABASE_URL: 'postgres://test',
  SUPABASE_URL: 'https://example.test',
  SUPABASE_SECRET_KEY: 'test-service-key',
  QA_PROVISION_PASSWORD: 'test-only-password',
  QA_PROVISION_CONFIRM: '1',
};

function createAdminHarness(input: {
  existingUsers?: readonly QaAdminUser[];
  failCreatePhone?: string;
  failDeleteUserId?: string;
} = {}) {
  const createCalls: string[] = [];
  const deleteCalls: string[] = [];
  const createdIdByPhone = new Map([
    [studentPhone, 'created-student'],
    [teacherPhone, 'created-teacher'],
  ]);
  const existingUsers = input.existingUsers ?? [];

  const client = {
    auth: {
      admin: {
        createUser: async ({ phone }: { phone: string }) => {
          createCalls.push(phone);
          if (phone === input.failCreatePhone) {
            return { data: { user: null }, error: { message: 'create rejected' } };
          }
          const id = createdIdByPhone.get(phone)!;
          return {
            data: { user: { id, phone, phone_confirmed_at: '2026-01-01T00:00:00Z' } },
            error: null,
          };
        },
        deleteUser: async (userId: string) => {
          deleteCalls.push(userId);
          return {
            data: { user: null },
            error: userId === input.failDeleteUserId ? { message: 'delete rejected' } : null,
          };
        },
        getUserById: async (userId: string) => ({
          data: { user: existingUsers.find((user) => user.id === userId) ?? null },
          error: null,
        }),
        listUsers: async () => ({ data: { users: existingUsers }, error: null }),
      },
    },
  } as QaAdminClient;

  return { client, createCalls, deleteCalls };
}

function createDatabaseFor(transaction: () => Promise<void>): Database {
  return {
    select: () => ({ from: () => ({ where: async () => [] }) }),
    transaction,
  } as unknown as Database;
}

async function runWith(input: {
  adminClient: QaAdminClient;
  transaction?: () => Promise<void>;
  log?: (message: string) => void;
  logs?: string[];
}): Promise<void> {
  const db = createDatabaseFor(input.transaction ?? (async () => undefined));
  const log = input.log ?? ((message: string) => input.logs?.push(message));
  await runQaAuthProvisioning({
    environment,
    createDatabase: () => ({ db, client: { end: async () => undefined } }),
    createAdminClient: () => input.adminClient,
    log,
  });
}

it('creates both missing Auth users and completes public provisioning', async () => {
  const harness = createAdminHarness();

  await runWith({ adminClient: harness.client });

  expect(harness.createCalls).toEqual([studentPhone, teacherPhone]);
  expect(harness.deleteCalls).toEqual([]);
});

it('deletes only the invocation-created user when public provisioning rejects', async () => {
  const existingStudent = {
    id: 'existing-student',
    phone: studentPhone,
    phone_confirmed_at: '2026-01-01T00:00:00Z',
  };
  const harness = createAdminHarness({ existingUsers: [existingStudent] });
  const publicError = new Error('public fixture transaction rejected');

  await expect(runWith({
    adminClient: harness.client,
    transaction: async () => {
      throw publicError;
    },
  })).rejects.toBe(publicError);

  expect(harness.createCalls).toEqual([teacherPhone]);
  expect(harness.deleteCalls).toEqual(['created-teacher']);
});

it('deletes the first created Auth user when the second create fails', async () => {
  const harness = createAdminHarness({ failCreatePhone: teacherPhone });

  await expect(runWith({ adminClient: harness.client }))
    .rejects.toThrow('Unable to create QA Auth user');

  expect(harness.createCalls).toEqual([studentPhone, teacherPhone]);
  expect(harness.deleteCalls).toEqual(['created-student']);
});

it('preserves the public error and safely logs a compensation failure', async () => {
  const harness = createAdminHarness({ failDeleteUserId: 'created-teacher' });
  const publicError = new Error('public fixture transaction rejected');
  const logs: string[] = [];

  await expect(runWith({
    adminClient: harness.client,
    logs,
    transaction: async () => {
      throw publicError;
    },
  })).rejects.toBe(publicError);

  expect(harness.deleteCalls).toEqual(['created-teacher', 'created-student']);
  expect(logs).toEqual([
    '[qa-provision] failure operation=auth_compensation category=delete_failed',
  ]);
  expect(logs.join(' ')).not.toContain('created-teacher');
  expect(logs.join(' ')).not.toContain(studentPhone);
  expect(logs.join(' ')).not.toContain(teacherPhone);
  expect(logs.join(' ')).not.toContain(environment.QA_PROVISION_PASSWORD);
});

it('does not delete created Auth users after the public transaction commits', async () => {
  const harness = createAdminHarness();
  const logError = new Error('operator output unavailable');
  let committedTransactions = 0;

  await expect(runWith({
    adminClient: harness.client,
    log: () => {
      throw logError;
    },
    transaction: async () => {
      committedTransactions += 1;
    },
  })).rejects.toBe(logError);

  expect(committedTransactions).toBe(1);
  expect(harness.deleteCalls).toEqual([]);
});
