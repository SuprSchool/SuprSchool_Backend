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
    });
    expect(avatarUrlSigner.createSignedDownloadUrl).toHaveBeenCalledWith(
      'avatars',
      'school-b/avatars/student-upload.jpg',
    );
  });
});
