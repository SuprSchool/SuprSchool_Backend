// The teacher submission list read model.
//
// Three of its fields exist because the screen could not work without them:
// `maxMarks` (408:10557 draws `0/35`, and the client had nothing to divide by),
// `fileName` + `fileUrl` (every submission frame draws an `Assignment.pdf` tile,
// and `academic-files` is private so a name alone opens nothing), and
// `isGradedAssignment` (526:12658 "Graded" vs 667:3274 "Completed").
import { describe, expect, it, vi } from 'vitest';

import { createAssignmentsService } from '../src/services/assignments.service.js';
import type { StoredSubmission } from '../src/db/repositories/assignments.repository.js';
import type { AssignmentIdentity } from '../src/types/assignments.js';

const schoolId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const teacherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const assignmentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const identity: AssignmentIdentity = { schoolId, userId: teacherId };

/** A student who uploaded, and one who never did — the roster read returns both. */
function storedPage(): { items: StoredSubmission[] } {
  return {
    items: [
      {
        assignmentId,
        completedAt: null,
        fileName: 'Assignment.pdf',
        gradedAt: '2026-08-12T09:00:00.000Z',
        id: 'submission-1',
        isGradedAssignment: true,
        marks: 30,
        maxMarks: 35,
        objectPath: 'school/assignment/submission-1.pdf',
        studentId: 'student-1',
        studentName: 'Anyi Pathak',
        submittedAt: '2026-08-11T13:11:04.042Z',
      },
      {
        assignmentId,
        completedAt: null,
        // No submission row of their own: `id` falls back to the student.
        id: 'student-9',
        isGradedAssignment: true,
        maxMarks: 35,
        studentId: 'student-9',
        studentName: 'Anika Mehra',
      },
    ],
  };
}

function createService(overrides: {
  createReadUrl?: () => Promise<string>;
  listSubmissions?: ReturnType<typeof vi.fn>;
  setStudentCompletion?: ReturnType<typeof vi.fn>;
} = {}) {
  return createAssignmentsService({
    cache: { get: async () => null, set: async () => {} },
    clock: () => new Date('2026-08-12T10:00:00.000Z'),
    files: {
      createReadUrl: overrides.createReadUrl
        ?? (async () => 'https://storage.test/signed.pdf'),
    },
    mutations: { execute: vi.fn() },
    outbox: { enqueue: vi.fn() },
    repository: {
      listSubmissions: overrides.listSubmissions ?? vi.fn(async () => storedPage()),
      setStudentCompletion: overrides.setStudentCompletion ?? vi.fn(),
    },
  } as unknown as Parameters<typeof createAssignmentsService>[0]);
}

describe('teacher submission list read model', () => {
  it('carries the assignment total, mode and file onto every row', async () => {
    const page = await createService().listSubmissions(identity, assignmentId, { limit: 20 });

    const [submitted, missing] = page.items;
    expect(submitted?.maxMarks).toBe(35);
    expect(submitted?.isGradedAssignment).toBe(true);
    expect(submitted?.fileName).toBe('Assignment.pdf');
    expect(submitted?.fileUrl).toBe('https://storage.test/signed.pdf');
    expect(submitted?.studentId).toBe('student-1');

    // A roster row with no upload still states the total and the mode, so the
    // screen can size its marks field and pick its second tab from any row.
    expect(missing?.maxMarks).toBe(35);
    expect(missing?.isGradedAssignment).toBe(true);
    expect(missing?.studentId).toBe('student-9');
    expect(missing?.fileName).toBeUndefined();
    expect(missing?.fileUrl).toBeUndefined();
    expect(missing?.submittedAt).toBeUndefined();
  });

  it('signs only the rows that have an object, once each', async () => {
    const createReadUrl = vi.fn(async () => 'https://storage.test/signed.pdf');
    await createService({ createReadUrl }).listSubmissions(identity, assignmentId, { limit: 20 });

    expect(createReadUrl).toHaveBeenCalledTimes(1);
    expect(createReadUrl).toHaveBeenCalledWith(
      'academic-files',
      'school/assignment/submission-1.pdf',
      900,
    );
  });

  // One unreadable object must not blank the whole roster.
  it('degrades a row whose URL cannot be signed rather than failing the list', async () => {
    const page = await createService({
      createReadUrl: async () => { throw new Error('storage down'); },
    }).listSubmissions(identity, assignmentId, { limit: 20 });

    expect(page.items).toHaveLength(2);
    expect(page.items[0]?.fileName).toBe('Assignment.pdf');
    expect(page.items[0]?.fileUrl).toBeUndefined();
  });

  it('404s when the assignment is not one this teacher manages', async () => {
    const service = createService({ listSubmissions: vi.fn(async () => undefined) });

    await expect(service.listSubmissions(identity, assignmentId, { limit: 20 }))
      .rejects.toMatchObject({ status: 404 });
  });
});

describe('completion by student', () => {
  it('passes the server clock through and returns the stored instant', async () => {
    const setStudentCompletion = vi.fn(async () => ({
      completedAt: '2026-08-12T10:00:00.000Z',
      id: 'submission-9',
    }));
    const service = createService({ setStudentCompletion });

    const result = await service.setStudentCompletion(
      identity, assignmentId, 'student-9', 'complete',
    );

    expect(result).toEqual({ completedAt: '2026-08-12T10:00:00.000Z', id: 'submission-9' });
    expect(setStudentCompletion).toHaveBeenCalledWith(
      identity, assignmentId, 'student-9', 'complete', new Date('2026-08-12T10:00:00.000Z'),
    );
  });

  it('404s when the student is not on the assignment this teacher manages', async () => {
    const service = createService({ setStudentCompletion: vi.fn(async () => undefined) });

    await expect(
      service.setStudentCompletion(identity, assignmentId, 'student-9', 'complete'),
    ).rejects.toMatchObject({ status: 404 });
  });
});
