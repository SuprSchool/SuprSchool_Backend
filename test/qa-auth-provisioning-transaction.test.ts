import { expect, it } from 'vitest';

import { provisionQaPublicFixtures } from '../scripts/provision-qa-auth-users.js';
import type { Database } from '../src/db/client.js';
import { schoolDirectoryEntries, schoolDirectoryTeacherAssignments } from '../src/db/schema/core.js';

// Simulates a competing claim made after read-only preflight. The atomic
// directory write must report the missing compatible row and abort before
// any user-bound public rows can be written.
it('aborts when the transaction-time directory claim rejects a raced owner', async () => {
  let inserts = 0;
  const transaction = {
    insert: () => {
      inserts += 1;
      return {
        values: () => ({
          onConflictDoNothing: () => undefined,
          onConflictDoUpdate: () => ({
            returning: async () => [],
          }),
        }),
      };
    },
  } as unknown as Database;
  const db = {
    transaction: async (callback: (tx: Database) => Promise<void>) => callback(transaction),
  } as unknown as Database;

  await expect(provisionQaPublicFixtures(db, {
    studentUserId: '1f2d0c30-7b18-4d46-9f23-5a6f0bc15a0e',
    teacherUserId: '2a760c18-1f2e-4374-b4d8-01fc789ae95d',
  })).rejects.toThrow('QA directory phone is already claimed by another user');

  expect(inserts).toBe(5);
});

// Models a persistent unique-index store across two real provisioner calls.
// The alternate directory IDs and first claim time must survive the replay,
// while every generated fixture key resolves to its original record.
it('replays same-user alternate directory rows without replacing claims or duplicating fixtures', async () => {
  const studentUserId = '1f2d0c30-7b18-4d46-9f23-5a6f0bc15a0e';
  const teacherUserId = '2a760c18-1f2e-4374-b4d8-01fc789ae95d';
  const claimedAt = new Date('2026-01-01T00:00:00.000Z');
  const directoryState = new Map([
    ['+917755090948', { id: '60000000-0000-4000-8000-000000000101', phoneE164: '+917755090948', claimedByUserId: studentUserId, claimedAt }],
    ['+919000000001', { id: '60000000-0000-4000-8000-000000000102', phoneE164: '+919000000001', claimedByUserId: teacherUserId, claimedAt }],
  ]);
  const fixtureKeysByTable = new Map<unknown, Set<string>>();
  const directoryConflictOptions: Array<{ set: Record<string, unknown> }> = [];
  const teacherAssignmentValues: Array<readonly { schoolDirectoryEntryId: string }[]> = [];
  let replayedFixtureRows = 0;

  const recordFixtureRows = (table: unknown, values: unknown) => {
    const rows = Array.isArray(values) ? values : [values];
    const fixtureKeys = fixtureKeysByTable.get(table) ?? new Set<string>();
    fixtureKeysByTable.set(table, fixtureKeys);
    for (const row of rows) {
      const key = JSON.stringify(row) ?? 'undefined';
      if (fixtureKeys.has(key)) replayedFixtureRows += 1;
      else fixtureKeys.add(key);
    }
  };
  const transaction = {
    execute: async () => undefined,
    insert: (table: unknown) => ({
      values: (values: unknown) => ({
        onConflictDoNothing: () => {
          recordFixtureRows(table, values);
          if (table === schoolDirectoryTeacherAssignments) {
            teacherAssignmentValues.push(values as readonly { schoolDirectoryEntryId: string }[]);
          }
        },
        onConflictDoUpdate: (options: { set: Record<string, unknown> }) => {
          if (table === schoolDirectoryEntries) {
            directoryConflictOptions.push(options);
            return { returning: async () => Array.from(directoryState.values()) };
          }
          recordFixtureRows(table, values);
          return { returning: async () => [] };
        },
      }),
    }),
  } as unknown as Database;
  const db = {
    transaction: async (callback: (tx: Database) => Promise<void>) => callback(transaction),
  } as unknown as Database;

  await provisionQaPublicFixtures(db, { studentUserId, teacherUserId });
  const fixtureKeyCountAfterFirstRun = Array.from(fixtureKeysByTable.values()).reduce((count, keys) => count + keys.size, 0);
  await provisionQaPublicFixtures(db, { studentUserId, teacherUserId });

  expect(directoryConflictOptions).toHaveLength(2);
  expect(directoryConflictOptions.every((options) => !('id' in options.set))).toBe(true);
  expect(Array.from(directoryState.values())).toEqual([
    { id: '60000000-0000-4000-8000-000000000101', phoneE164: '+917755090948', claimedByUserId: studentUserId, claimedAt },
    { id: '60000000-0000-4000-8000-000000000102', phoneE164: '+919000000001', claimedByUserId: teacherUserId, claimedAt },
  ]);
  expect(Array.from(fixtureKeysByTable.values()).reduce((count, keys) => count + keys.size, 0)).toBe(fixtureKeyCountAfterFirstRun);
  expect(replayedFixtureRows).toBeGreaterThan(0);
  expect(teacherAssignmentValues).toHaveLength(2);
  expect(teacherAssignmentValues.flat().every((row) => row.schoolDirectoryEntryId === directoryState.get('+919000000001')!.id)).toBe(true);
});