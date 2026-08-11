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

function eventFiles() {
  return {
    createReadUrl: vi.fn(),
    createUpload: vi.fn(),
    deleteObject: vi.fn(),
    finalizeUpload: vi.fn(),
    prepareUpload: vi.fn(),
  };
}

function eventAvatarSigner() {
  return { createSignedDownloadUrl: vi.fn() };
}
describe('events service', () => {
  it('fails fast when repository or private file storage dependencies are absent', () => {
    const repository = {} as EventsRepository;
    const files = {
      createReadUrl: vi.fn(),
      createUpload: vi.fn(),
      deleteObject: vi.fn(),
      finalizeUpload: vi.fn(),
      prepareUpload: vi.fn(),
    };

    expect(() => createEventsService({ repository } as never))
      .toThrow('Events service requires file storage');
    expect(() => createEventsService({ files } as never))
      .toThrow('Events service requires a repository');
    // Without this guard a dropped wiring line would return every participant
    // unphotographed rather than failing, which looks like a design choice.
    expect(() => createEventsService({ files, repository } as never))
      .toThrow('Events service requires an avatar URL signer');
  });
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
    const service = createEventsService({ avatarUrlSigner: eventAvatarSigner(), files: eventFiles(), repository });

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
    const service = createEventsService({ avatarUrlSigner: eventAvatarSigner(), files: eventFiles(), repository });

    await expect(service.registerStudent({ schoolId, userId: studentId }, eventId))
      .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(repository.registerStudent).toHaveBeenCalledWith({ schoolId, userId: studentId }, eventId);
  });

  it('refuses duplicate team members before repository persistence', async () => {
    const repository = {
      createTeam: vi.fn(),
    } as unknown as EventsRepository;
    const service = createEventsService({ avatarUrlSigner: eventAvatarSigner(), files: eventFiles(), repository });

    await expect(service.createTeam({ schoolId, userId: studentId }, eventId, eventId, {
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
    const service = createEventsService({ avatarUrlSigner: eventAvatarSigner(), files: eventFiles(), repository });

    await expect(service.createTeam({ schoolId, userId: studentId }, eventId, eventId, {
      memberStudentIds: [otherStudentId],
      name: 'Blue Team',
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(repository.createTeam).not.toHaveBeenCalled();
  });

  it('returns a non-disclosing empty state while student results are unpublished', async () => {
    const repository = {
      getStudentResults: vi.fn().mockResolvedValue({ entries: [], publishedAt: null, revision: 3 }),
    } as unknown as EventsRepository;
    const service = createEventsService({ avatarUrlSigner: eventAvatarSigner(), files: eventFiles(), repository });

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

describe('student event participant avatars', () => {
  function storedParticipant(overrides: Record<string, unknown>) {
    return {
      className: '10-A',
      participationTag: null,
      rank: null,
      registeredAt: '2026-07-16T15:00:00.000000Z',
      registrationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      score: null,
      studentId,
      studentName: 'Asha',
      teamId: null,
      teamName: null,
      ...overrides,
    };
  }

  it('signs an uploaded avatar on read and leaves an absent one null', async () => {
    const repository = {
      listStudentParticipants: vi.fn().mockResolvedValue([
        storedParticipant({ avatarObjectPath: 'school/asha.png', rank: 1, score: 87 }),
        storedParticipant({ avatarObjectPath: null, rank: 2, score: 84, studentName: 'Ravi' }),
      ]),
    } as unknown as EventsRepository;
    const createSignedDownloadUrl = vi.fn().mockResolvedValue('https://signed.example.test/asha.png');
    const service = createEventsService({
      avatarUrlSigner: { createSignedDownloadUrl },
      files: eventFiles(),
      repository,
    });

    const participants = await service.listStudentParticipants({ schoolId, userId: studentId }, eventId);

    expect(participants[0]?.avatarUrl).toBe('https://signed.example.test/asha.png');
    expect(participants[1]?.avatarUrl).toBeNull();
    expect(createSignedDownloadUrl).toHaveBeenCalledTimes(1);
    expect(createSignedDownloadUrl).toHaveBeenCalledWith('avatars', 'school/asha.png');
  });

  it('never leaks the object path a signed URL was built from', async () => {
    const repository = {
      listStudentParticipants: vi.fn().mockResolvedValue([
        storedParticipant({ avatarObjectPath: 'school/asha.png' }),
      ]),
    } as unknown as EventsRepository;
    const service = createEventsService({
      avatarUrlSigner: { createSignedDownloadUrl: vi.fn().mockResolvedValue('https://signed.example.test/asha.png') },
      files: eventFiles(),
      repository,
    });

    const participants = await service.listStudentParticipants({ schoolId, userId: studentId }, eventId);

    expect(participants[0]).not.toHaveProperty('avatarObjectPath');
  });

  it('falls back to no avatar rather than a broken URL when signing fails', async () => {
    const repository = {
      listStudentParticipants: vi.fn().mockResolvedValue([
        storedParticipant({ avatarObjectPath: 'school/missing.png', rank: 1, score: 87 }),
      ]),
    } as unknown as EventsRepository;
    const service = createEventsService({
      avatarUrlSigner: { createSignedDownloadUrl: vi.fn().mockRejectedValue(new Error('object missing')) },
      files: eventFiles(),
      repository,
    });

    const participants = await service.listStudentParticipants({ schoolId, userId: studentId }, eventId);

    expect(participants[0]).toMatchObject({ avatarUrl: null, rank: 1, score: 87 });
  });

  it('holds avatar signing at a bounded width instead of opening one request per participant', async () => {
    const participantCount = 60;
    const repository = {
      listStudentParticipants: vi.fn().mockResolvedValue(
        Array.from({ length: participantCount }, (_unused, index) => storedParticipant({
          avatarObjectPath: `school/student-${index}.png`,
          registrationId: `registration-${index}`,
          studentName: `Student ${index}`,
        })),
      ),
    } as unknown as EventsRepository;

    let inFlight = 0;
    let peakInFlight = 0;
    const createSignedDownloadUrl = vi.fn().mockImplementation(async (_bucket: string, objectPath: string) => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      // Yielding here lets every worker the pool is willing to run start before
      // any of them finish, so the peak measures the pool width rather than how
      // fast the stub resolves.
      await new Promise<void>((resolve) => setImmediate(resolve));
      inFlight -= 1;
      return `https://signed.example.test/${objectPath}`;
    });
    const service = createEventsService({
      avatarUrlSigner: { createSignedDownloadUrl },
      files: eventFiles(),
      repository,
    });

    const participants = await service.listStudentParticipants({ schoolId, userId: studentId }, eventId);

    expect(participants).toHaveLength(participantCount);
    expect(createSignedDownloadUrl).toHaveBeenCalledTimes(participantCount);
    // Bounded above, so 60 participants never become 60 open storage requests;
    // and above one, so this is a pool rather than a serial loop.
    expect(peakInFlight).toBeLessThanOrEqual(8);
    expect(peakInFlight).toBeGreaterThan(1);
    expect(participants[0]?.avatarUrl).toBe('https://signed.example.test/school/student-0.png');
    expect(participants.at(-1)?.avatarUrl).toBe(`https://signed.example.test/school/student-${participantCount - 1}.png`);
  });

  it('signs a repeated object path once and gives every row that shares it the same URL', async () => {
    // The participant listing joins class_members, so a student in two active
    // classes arrives twice; signing per row would pay for the duplicate.
    const repository = {
      listStudentParticipants: vi.fn().mockResolvedValue([
        storedParticipant({ avatarObjectPath: 'school/asha.png', registrationId: 'registration-1' }),
        storedParticipant({ avatarObjectPath: 'school/asha.png', registrationId: 'registration-2' }),
        storedParticipant({ avatarObjectPath: 'school/ravi.png', registrationId: 'registration-3' }),
        storedParticipant({ avatarObjectPath: null, registrationId: 'registration-4' }),
      ]),
    } as unknown as EventsRepository;
    const createSignedDownloadUrl = vi.fn().mockImplementation(
      async (_bucket: string, objectPath: string) => `https://signed.example.test/${objectPath}`,
    );
    const service = createEventsService({
      avatarUrlSigner: { createSignedDownloadUrl },
      files: eventFiles(),
      repository,
    });

    const participants = await service.listStudentParticipants({ schoolId, userId: studentId }, eventId);

    expect(createSignedDownloadUrl).toHaveBeenCalledTimes(2);
    expect(participants[0]?.avatarUrl).toBe('https://signed.example.test/school/asha.png');
    expect(participants[1]?.avatarUrl).toBe('https://signed.example.test/school/asha.png');
    expect(participants[2]?.avatarUrl).toBe('https://signed.example.test/school/ravi.png');
    expect(participants[3]?.avatarUrl).toBeNull();
  });

  it('raises the event not-found error when the student cannot see the event', async () => {
    const repository = {
      listStudentParticipants: vi.fn().mockResolvedValue(undefined),
    } as unknown as EventsRepository;
    const service = createEventsService({ avatarUrlSigner: eventAvatarSigner(), files: eventFiles(), repository });

    await expect(service.listStudentParticipants({ schoolId, userId: studentId }, eventId))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 } satisfies Partial<AppError>);
  });
});
