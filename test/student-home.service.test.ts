import { describe, expect, it, vi } from 'vitest';

import type { StudentHomeRepository } from '../src/db/repositories/student-home.repository.js';
import { createStudentHomeService } from '../src/services/student-home.service.js';

const studentId = 'student-1';
const schoolA = 'school-a';
const schoolB = 'school-b';

function createRepository(): StudentHomeRepository {
  return {
    getBirthdaysForSchool: vi.fn(),
    getCalendarDayForStudent: vi.fn(),
    getCalendarForStudent: vi.fn(),
    getForStudent: vi.fn(),
    getUpcomingBirthdaysForSchool: vi.fn(),
  };
}

describe('student home read-model service', () => {
  it('uses the token school when selecting a calendar from a two-school membership', async () => {
    const repository = createRepository();
    vi.mocked(repository.getCalendarForStudent).mockResolvedValue([]);
    const service = createStudentHomeService({
      avatarUrlSigner: { createSignedDownloadUrl: vi.fn() },
      repository,
    } as never);

    await service.getCalendar({ schoolId: schoolB, userId: studentId }, '2026-07');

    expect(repository.getCalendarForStudent).toHaveBeenCalledWith(
      { schoolId: schoolB, userId: studentId },
      '2026-07-01',
      '2026-07-31',
    );
    expect(repository.getCalendarForStudent).not.toHaveBeenCalledWith(
      { schoolId: schoolA, userId: studentId },
      expect.any(String),
      expect.any(String),
    );
  });

  it('returns signed uploaded avatars and preset descriptors for birthday cards', async () => {
    const repository = createRepository();
    vi.mocked(repository.getBirthdaysForSchool).mockResolvedValue([
      {
        avatar: { kind: 'upload', value: 'school-b/avatars/student-upload.jpg' },
        classLabel: '9 - A',
        id: 'student-upload',
        name: 'Upload Avatar',
      },
      {
        avatar: { kind: 'preset', value: 'avatar-2' },
        classLabel: '9 - A',
        id: 'student-preset',
        name: 'Preset Avatar',
      },
    ] as never);
    vi.mocked(repository.getUpcomingBirthdaysForSchool).mockResolvedValue([]);
    const avatarUrlSigner = {
      createSignedDownloadUrl: vi.fn().mockResolvedValue('https://storage.example.test/signed-avatar'),
    };
    const service = createStudentHomeService({
      avatarUrlSigner,
      clock: () => new Date('2026-07-20T00:00:00.000Z'),
      repository,
    } as never);

    await expect(service.getBirthdays(schoolB)).resolves.toEqual({
      birthdays: [
        {
          avatar: { kind: 'upload', value: 'https://storage.example.test/signed-avatar' },
          classLabel: '9 - A', id: 'student-upload', name: 'Upload Avatar',
        },
        {
          avatar: { kind: 'preset', value: 'avatar-2' },
          classLabel: '9 - A', id: 'student-preset', name: 'Preset Avatar',
        },
      ],
      upcoming: [],
      windowDays: 30,
    });
    expect(avatarUrlSigner.createSignedDownloadUrl).toHaveBeenCalledWith(
      'avatars',
      'school-b/avatars/student-upload.jpg',
    );
  });

  it('defaults the birthday horizon to thirty days and passes it to the repository', async () => {
    const repository = createRepository();
    vi.mocked(repository.getBirthdaysForSchool).mockResolvedValue([]);
    vi.mocked(repository.getUpcomingBirthdaysForSchool).mockResolvedValue([]);
    const service = createStudentHomeService({
      avatarUrlSigner: { createSignedDownloadUrl: vi.fn() },
      clock: () => new Date('2026-07-20T00:00:00.000Z'),
      repository,
    } as never);

    await expect(service.getBirthdays(schoolB)).resolves.toMatchObject({ windowDays: 30 });

    expect(repository.getUpcomingBirthdaysForSchool).toHaveBeenCalledWith(
      schoolB,
      new Date('2026-07-20T00:00:00.000Z'),
      30,
    );
  });

  // Two clock reads could straddle midnight and yield a student who is on
  // neither list, so both queries must be handed the same instant.
  it('reads the clock once for both birthday lists', async () => {
    const repository = createRepository();
    vi.mocked(repository.getBirthdaysForSchool).mockResolvedValue([]);
    vi.mocked(repository.getUpcomingBirthdaysForSchool).mockResolvedValue([]);
    const clock = vi.fn(() => new Date('2026-07-20T00:00:00.000Z'));
    const service = createStudentHomeService({
      avatarUrlSigner: { createSignedDownloadUrl: vi.fn() },
      clock,
      repository,
    } as never);

    await service.getBirthdays(schoolB, 14);

    expect(clock).toHaveBeenCalledTimes(1);
    expect(vi.mocked(repository.getBirthdaysForSchool).mock.calls[0]?.[1])
      .toBe(vi.mocked(repository.getUpcomingBirthdaysForSchool).mock.calls[0]?.[1]);
  });

  // The upcoming rows carry date/inDays. Signing must not widen them away.
  it('keeps the occurrence date on an upcoming birthday whose avatar is signed', async () => {
    const repository = createRepository();
    vi.mocked(repository.getBirthdaysForSchool).mockResolvedValue([]);
    vi.mocked(repository.getUpcomingBirthdaysForSchool).mockResolvedValue([{
      avatar: { kind: 'upload', value: 'school-b/avatars/soon.jpg' },
      classLabel: '9 - B',
      date: '2026-07-27',
      id: 'student-soon',
      inDays: 7,
      name: 'Soon Birthday',
    }] as never);
    const service = createStudentHomeService({
      avatarUrlSigner: {
        createSignedDownloadUrl: vi.fn().mockResolvedValue('https://storage.example.test/signed'),
      },
      clock: () => new Date('2026-07-20T00:00:00.000Z'),
      repository,
    } as never);

    await expect(service.getBirthdays(schoolB, 30)).resolves.toMatchObject({
      upcoming: [{
        avatar: { kind: 'upload', value: 'https://storage.example.test/signed' },
        date: '2026-07-27',
        inDays: 7,
        name: 'Soon Birthday',
      }],
    });
  });
});
