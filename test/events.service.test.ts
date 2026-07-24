import { describe, expect, it, vi } from 'vitest';

import type { EventsRepository } from '../src/db/repositories/events.repository.js';
import { AppError } from '../src/lib/errors.js';
import { createEventsService } from '../src/services/events.service.js';
import {
  decodeEventsCursor,
  paginateEventRows,
  rankEventResults,
} from '../src/validators/events.schemas.js';

const schoolId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const studentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const eventId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('events service', () => {
  it('returns one replay-safe registration when the repository serializes concurrent requests', async () => {
    const registration = {
      created: false,
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      registeredAt: '2026-07-16T15:00:00.000000Z',
      teamId: null,
      teamName: null,
    };
    const repository = {
      registerStudent: vi.fn().mockResolvedValue(registration),
    } as unknown as EventsRepository;
    const service = createEventsService({ repository });

    const [first, replay] = await Promise.all([
      service.registerStudent({ schoolId, userId: studentId }, eventId),
      service.registerStudent({ schoolId, userId: studentId }, eventId),
    ]);

    expect(first.id).toBe(registration.id);
    expect(replay.id).toBe(registration.id);
    expect(repository.registerStudent).toHaveBeenCalledTimes(2);
    expect(repository.registerStudent).toHaveBeenNthCalledWith(1, { schoolId, userId: studentId }, eventId);
  });

  it('propagates the repository live-enrolment deadline and archive refusals', async () => {
    const repository = {
      registerStudent: vi.fn().mockRejectedValue(
        new AppError('FORBIDDEN', 403, 'Registration is not available'),
      ),
    } as unknown as EventsRepository;
    const service = createEventsService({ repository });

    await expect(service.registerStudent({ schoolId, userId: studentId }, eventId))
      .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(repository.registerStudent).toHaveBeenCalledWith({ schoolId, userId: studentId }, eventId);
  });

  it('refuses duplicate team members before repository persistence', async () => {
    const repository = {
      createTeam: vi.fn(),
    } as unknown as EventsRepository;
    const service = createEventsService({ repository });

    await expect(service.createTeam({ schoolId, userId: studentId }, eventId, {
      memberStudentIds: [studentId, studentId],
      name: 'Blue Team',
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(repository.createTeam).not.toHaveBeenCalled();
  });

  it('refuses a student-created team that excludes the authenticated student', async () => {
    const otherStudentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const repository = {
      createTeam: vi.fn(),
    } as unknown as EventsRepository;
    const service = createEventsService({ repository });

    await expect(service.createTeam({ schoolId, userId: studentId }, eventId, {
      memberStudentIds: [otherStudentId],
      name: 'Blue Team',
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(repository.createTeam).not.toHaveBeenCalled();
  });

  it('returns a non-disclosing empty state while student results are unpublished', async () => {
    const repository = {
      getStudentResults: vi.fn().mockResolvedValue({ entries: [], publishedAt: null, revision: 3 }),
    } as unknown as EventsRepository;
    const service = createEventsService({ repository });

    await expect(service.getStudentResults({ schoolId, userId: studentId }, eventId))
      .resolves.toEqual({ entries: [], publishedAt: null, revision: 3 });
  });

  it('creates an unambiguous cursor that does not skip or duplicate equal-time rows', () => {
    const rows = [
      { createdAt: '2026-07-16T15:00:00.000000Z', id: '00000000-0000-4000-8000-000000000003' },
      { createdAt: '2026-07-16T15:00:00.000000Z', id: '00000000-0000-4000-8000-000000000002' },
      { createdAt: '2026-07-16T15:00:00.000000Z', id: '00000000-0000-4000-8000-000000000001' },
    ];

    const first = paginateEventRows(rows, undefined, 2);
    const second = paginateEventRows(rows, decodeEventsCursor(first.nextCursor ?? ''));

    expect(first.items.map((row) => row.id)).toEqual([rows[0]?.id, rows[1]?.id]);
    expect(second.items.map((row) => row.id)).toEqual([rows[2]?.id]);
    expect(new Set([...first.items, ...second.items].map((row) => row.id)).size).toBe(3);
  });

  it('computes dense ranks with a stable target-id tie break after publication', () => {
    expect(rankEventResults([
      { score: 10, targetId: '00000000-0000-4000-8000-000000000002' },
      { score: 10, targetId: '00000000-0000-4000-8000-000000000001' },
      { score: 8, targetId: '00000000-0000-4000-8000-000000000003' },
      { score: null, targetId: '00000000-0000-4000-8000-000000000004' },
    ])).toEqual([
      { rank: 1, score: 10, targetId: '00000000-0000-4000-8000-000000000001' },
      { rank: 1, score: 10, targetId: '00000000-0000-4000-8000-000000000002' },
      { rank: 2, score: 8, targetId: '00000000-0000-4000-8000-000000000003' },
      { rank: null, score: null, targetId: '00000000-0000-4000-8000-000000000004' },
    ]);
  });
});
