import { expect, it } from 'vitest';

import {
  buildQaUserBoundFixtureRows,
  provisionQaPublicFixtures,
} from '../scripts/provision-qa-auth-users.js';
import type { Database } from '../src/db/client.js';
import { chatMessages, chatReadCursors, chatRooms } from '../src/db/schema/chat.js';
import {
  classExams,
  examGroups,
  examResults,
  examRubrics,
  examSubmissions,
} from '../src/db/schema/exams.js';
import { eventAudiences, eventManagers, eventRegistrations, eventResultEntries, eventTeams, events } from '../src/db/schema/events.js';
import { pointLedgerEntries } from '../src/db/schema/points.js';

const qaUsers = {
  studentUserId: '1f2d0c30-7b18-4d46-9f23-5a6f0bc15a0e',
  teacherUserId: '2a760c18-1f2e-4374-b4d8-01fc789ae95d',
};

function createCapturingDatabase() {
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
  return {
    executed,
    inserts,
    db: {
      transaction: async (callback: (tx: Database) => Promise<void>) => callback(transaction),
    } as unknown as Database,
  };
}

function insertedValues(inserts: Array<{ table: unknown; values: unknown }>, table: unknown): unknown {
  const match = inserts.find((insert) => insert.table === table);
  if (!match) throw new Error('Expected fixture table insert');
  return match.values;
}

// Mutation target: deleting the group-3 transaction writes must fail this
// generated-ID graph assertion rather than silently dropping QA exam/chat data.
it('writes the historical group 3 exam and class-chat graph with generated IDs', async () => {
  const fixtureRows = buildQaUserBoundFixtureRows(qaUsers);
  const captured = createCapturingDatabase();

  await provisionQaPublicFixtures(captured.db, qaUsers);

  expect(fixtureRows.examGroup.creatorTeacherId).toBe(qaUsers.teacherUserId);
  expect(fixtureRows.classExams.map((exam) => exam.teacherId)).toEqual([
    qaUsers.teacherUserId,
    qaUsers.teacherUserId,
  ]);
  expect(fixtureRows.examSubmissions[0]!.studentId).toBe(qaUsers.studentUserId);
  expect(fixtureRows.examResults[0]!.enteredByTeacherId).toBe(qaUsers.teacherUserId);
  expect(fixtureRows.classChat.messages.map((message) => message.senderId)).toEqual([
    qaUsers.teacherUserId,
    qaUsers.studentUserId,
  ]);
  expect(fixtureRows.classChat.readCursor.userId).toBe(qaUsers.studentUserId);

  expect(insertedValues(captured.inserts, examGroups)).toEqual(fixtureRows.examGroup);
  expect(insertedValues(captured.inserts, classExams)).toEqual(fixtureRows.classExams);
  expect(insertedValues(captured.inserts, examRubrics)).toEqual(fixtureRows.examRubrics);
  expect(insertedValues(captured.inserts, examSubmissions)).toEqual(fixtureRows.examSubmissions);
  expect(insertedValues(captured.inserts, examResults)).toEqual(fixtureRows.examResults);
  expect(insertedValues(captured.inserts, chatRooms)).toEqual(fixtureRows.classChat.room);
  expect(insertedValues(captured.inserts, chatMessages)).toEqual(fixtureRows.classChat.messages);
  expect(insertedValues(captured.inserts, chatReadCursors)).toEqual(fixtureRows.classChat.readCursor);
  expect(JSON.stringify(captured.inserts.map((insert) => insert.values))).not.toContain('10000000-0000-4000-8000-000000000001');
  expect(captured.executed).toHaveLength(2);
});

// Mutation target: deleting the group-4 transaction writes must fail this
// generated-ID graph assertion instead of quietly dropping event/points QA data.
it('writes the historical group 4 event and points graph with generated IDs', async () => {
  const fixtureRows = buildQaUserBoundFixtureRows(qaUsers);
  const captured = createCapturingDatabase();

  await provisionQaPublicFixtures(captured.db, qaUsers);

  expect(fixtureRows.event.createdByTeacherId).toBe(qaUsers.teacherUserId);
  expect(fixtureRows.eventManager.userId).toBe(qaUsers.teacherUserId);
  expect(fixtureRows.eventRegistration.studentId).toBe(qaUsers.studentUserId);
  expect(fixtureRows.pointLedgerEntries.map((entry) => entry.recipientUserId)).toEqual([
    qaUsers.studentUserId,
    qaUsers.studentUserId,
  ]);

  expect(insertedValues(captured.inserts, events)).toEqual(fixtureRows.event);
  expect(insertedValues(captured.inserts, eventAudiences)).toEqual(fixtureRows.eventAudience);
  expect(insertedValues(captured.inserts, eventManagers)).toEqual(fixtureRows.eventManager);
  expect(insertedValues(captured.inserts, eventRegistrations)).toEqual(fixtureRows.eventRegistration);
  expect(insertedValues(captured.inserts, pointLedgerEntries)).toEqual(fixtureRows.pointLedgerEntries);
  expect(captured.inserts.some((insert) => insert.table === eventTeams)).toBe(false);
  expect(captured.inserts.some((insert) => insert.table === eventResultEntries)).toBe(false);
  expect(JSON.stringify(captured.inserts.map((insert) => insert.values))).not.toContain('10000000-0000-4000-8000-000000000002');
});
