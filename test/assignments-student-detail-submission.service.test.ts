import { describe, expect, it, vi } from 'vitest';

import { createAssignmentsService } from '../src/services/assignments.service.js';
import type { StoredAssignmentDetail } from '../src/db/repositories/assignments.repository.js';

const schoolId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const assignmentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const studentA = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const studentB = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

function baseDetail(): StoredAssignmentDetail {
  return {
    assignedAt: '2026-08-02T06:36:52.096Z',
    classId: '40000000-0000-4000-8000-000000000001',
    displayCode: 'ASG-2026-001',
    dueAt: '2026-08-10T23:59:59.000Z',
    gradingType: 'Alphabetic',
    id: assignmentId,
    instructions: 'Complete the attached resource',
    isGradedAssignment: false,
    resources: [],
    rubrics: [],
    subjectId: '50000000-0000-4000-8000-000000000005',
    title: 'QA_Assignment_Aug2',
  };
}

/**
 * The student detail must carry the reading student's own submission — clients
 * derive submitted/graded from it, and without it the confirmation screen shown
 * straight after a successful submit read "Not Submitted".
 *
 * The detail cache is school-scoped, so those per-student fields must never be
 * written into it: doing so serves one student's submission state to every
 * other student in the school for the entry's lifetime.
 */
describe('student assignment detail — own submission', () => {
  function createService(findForStudent: ReturnType<typeof vi.fn>, store: Map<string, string>) {
    return createAssignmentsService({
      cache: {
        get: async (key: string) => store.get(key) ?? null,
        set: async (key: string, value: string) => { store.set(key, value); },
      },
      files: { createReadUrl: async () => 'https://storage.test/file' },
      mutations: { execute: vi.fn() },
      outbox: { enqueue: vi.fn() },
      pointAwards: { awardForSubmission: vi.fn() },
      repository: { findForStudent },
    } as unknown as Parameters<typeof createAssignmentsService>[0]);
  }

  it('returns the caller submission and keeps it out of the shared cache', async () => {
    const store = new Map<string, string>();
    const findForStudent = vi.fn(async (identity: { userId: string }) => (
      identity.userId === studentA
        ? { ...baseDetail(), marks: 7, submittedAt: '2026-08-11T13:11:04.042Z' }
        : baseDetail()
    ));
    const service = createService(findForStudent as never, store);

    const forA = await service.getForStudent({ schoolId, userId: studentA }, assignmentId);
    expect(forA.submittedAt, 'the submitting student must see their submission').toBe('2026-08-11T13:11:04.042Z');
    expect(forA.marks).toBe(7);

    // Second read is served from the cache written by the first.
    const forB = await service.getForStudent({ schoolId, userId: studentB }, assignmentId);
    expect(forB.submittedAt, 'a different student must not inherit the cached submission').toBeUndefined();
    expect(forB.marks).toBeUndefined();

    const cachedBodies = [...store.values()];
    expect(cachedBodies.length, 'the detail must actually be cached').toBeGreaterThan(0);
    for (const body of cachedBodies) {
      expect(body).not.toContain('submittedAt');
      expect(body).not.toContain('"marks"');
    }
  });
});
