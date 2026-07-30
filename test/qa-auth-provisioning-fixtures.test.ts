import { expect, it } from 'vitest';

import { buildQaUserBoundFixtureRows } from '../scripts/provision-qa-auth-users.js';

// Catches restoring the legacy seed Auth IDs in role-owned QA fixtures. The
// supported Admin API must be the only source of fixture user IDs.
it('binds every role-owned QA fixture row to the supplied Admin Auth user IDs', () => {
  const fixtureRows = buildQaUserBoundFixtureRows({
    studentUserId: '1f2d0c30-7b18-4d46-9f23-5a6f0bc15a0e',
    teacherUserId: '2a760c18-1f2e-4374-b4d8-01fc789ae95d',
  });

  expect(fixtureRows.studentProfile.id).toBe('1f2d0c30-7b18-4d46-9f23-5a6f0bc15a0e');
  expect(fixtureRows.teacherProfile.id).toBe('2a760c18-1f2e-4374-b4d8-01fc789ae95d');
  expect(fixtureRows.studentDirectory.claimedByUserId).toBe('1f2d0c30-7b18-4d46-9f23-5a6f0bc15a0e');
  expect(fixtureRows.teacherDirectory.claimedByUserId).toBe('2a760c18-1f2e-4374-b4d8-01fc789ae95d');
  expect(fixtureRows.classMember.studentId).toBe('1f2d0c30-7b18-4d46-9f23-5a6f0bc15a0e');
  expect(fixtureRows.classSubjects).toHaveLength(5);
  expect(fixtureRows.classSubjects.every((row) => row.teacherId === '2a760c18-1f2e-4374-b4d8-01fc789ae95d')).toBe(true);
});

// Catches losing the historical user-owned home fixtures, or reconnecting any
// of them to the removed fixed Auth IDs rather than the Admin-created users.
it('binds historical interests, announcements, and inbox rows to generated user IDs', () => {
  const fixtureRows = buildQaUserBoundFixtureRows({
    studentUserId: '1f2d0c30-7b18-4d46-9f23-5a6f0bc15a0e',
    teacherUserId: '2a760c18-1f2e-4374-b4d8-01fc789ae95d',
  });

  expect(fixtureRows.profileInterests).toEqual([
    { userId: '1f2d0c30-7b18-4d46-9f23-5a6f0bc15a0e', interest: 'Reading' },
    { userId: '1f2d0c30-7b18-4d46-9f23-5a6f0bc15a0e', interest: 'Music' },
    { userId: '1f2d0c30-7b18-4d46-9f23-5a6f0bc15a0e', interest: 'Football' },
    { userId: '1f2d0c30-7b18-4d46-9f23-5a6f0bc15a0e', interest: 'Drawing' },
    { userId: '1f2d0c30-7b18-4d46-9f23-5a6f0bc15a0e', interest: 'Technology' },
    { userId: '2a760c18-1f2e-4374-b4d8-01fc789ae95d', interest: 'Literature' },
    { userId: '2a760c18-1f2e-4374-b4d8-01fc789ae95d', interest: 'Public Speaking' },
  ]);
  expect(fixtureRows.announcements.map((row) => row.teacherId)).toEqual([
    '2a760c18-1f2e-4374-b4d8-01fc789ae95d',
    '2a760c18-1f2e-4374-b4d8-01fc789ae95d',
  ]);
  expect(fixtureRows.notificationInbox.map((row) => row.userId)).toEqual([
    '1f2d0c30-7b18-4d46-9f23-5a6f0bc15a0e',
    '1f2d0c30-7b18-4d46-9f23-5a6f0bc15a0e',
  ]);
});

// Catches removing historical attendance, diary, or assignment fixtures whose
// foreign keys must now come from supported Admin-created QA identities.
it('binds historical attendance, diary, and assignment rows to generated user IDs', () => {
  const fixtureRows = buildQaUserBoundFixtureRows({
    studentUserId: '1f2d0c30-7b18-4d46-9f23-5a6f0bc15a0e',
    teacherUserId: '2a760c18-1f2e-4374-b4d8-01fc789ae95d',
  });

  expect(fixtureRows.attendanceSessions.map((row) => row.markedByTeacherId)).toEqual([
    '2a760c18-1f2e-4374-b4d8-01fc789ae95d',
  ]);
  expect(fixtureRows.attendanceRecords.map((row) => row.studentId)).toEqual([
    '1f2d0c30-7b18-4d46-9f23-5a6f0bc15a0e',
  ]);
  expect(fixtureRows.diaryEntries.map((row) => row.teacherId)).toEqual([
    '2a760c18-1f2e-4374-b4d8-01fc789ae95d',
    '2a760c18-1f2e-4374-b4d8-01fc789ae95d',
  ]);
  expect(fixtureRows.assignments.map((row) => row.teacherId)).toEqual([
    '2a760c18-1f2e-4374-b4d8-01fc789ae95d',
    '2a760c18-1f2e-4374-b4d8-01fc789ae95d',
  ]);
  expect(fixtureRows.assignmentRubrics).toHaveLength(2);
});
