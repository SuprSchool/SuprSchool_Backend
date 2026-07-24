import { describe, expect, it, vi } from 'vitest';

import { DrizzleProfileRepository } from '../src/db/repositories/profile.repository.js';

describe('DrizzleProfileRepository', () => {
  it('returns the complete authenticated profile descriptor', async () => {
    const profile = {
      avatarKind: 'preset',
      avatarValue: 'avatar-1',
      displayName: 'Aarav Sharma',
      id: '22222222-2222-4222-8222-222222222222',
      phoneE164: '+917755090948',
      schoolId: '11111111-1111-4111-8111-111111111111',
    };
    const selectProfile = {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([profile]),
        }),
      }),
    };
    const selectInterests = {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([{ interest: 'Coding' }, { interest: 'Reading' }]),
        }),
      }),
    };
    const database = {
      select: vi.fn()
        .mockReturnValueOnce(selectProfile)
        .mockReturnValueOnce(selectInterests),
    };
    const repository = new DrizzleProfileRepository(database as never);

    await expect(repository.getProfile(profile.id)).resolves.toEqual({
      avatar: { kind: 'preset', value: 'avatar-1' },
      displayName: 'Aarav Sharma',
      id: '22222222-2222-4222-8222-222222222222',
      interests: ['Coding', 'Reading'],
      phoneE164: '+917755090948',
      schoolId: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('locks the profile and replaces an uploaded avatar pointer atomically', async () => {
    const newPath = '11111111-1111-4111-8111-111111111111/avatar/22222222-2222-4222-8222-222222222222/session-2';
    const previousPath = '11111111-1111-4111-8111-111111111111/avatar/22222222-2222-4222-8222-222222222222/session-1';
    const lockedProfile = {
      avatarKind: 'upload',
      avatarPath: previousPath,
      avatarValue: previousPath,
    };
    const forUpdate = vi.fn().mockResolvedValue([lockedProfile]);
    const set = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    const transaction = {
      execute: vi.fn().mockResolvedValue([{ id: '33333333-3333-4333-8333-333333333333' }]),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ for: forUpdate }),
        }),
      }),
      update: vi.fn().mockReturnValue({ set }),
    };
    const database = {
      transaction: vi.fn().mockImplementation(async (work) => work(transaction)),
    };
    const repository = new DrizzleProfileRepository(database as never);

    const result = await repository.setUploadedAvatar(
      '22222222-2222-4222-8222-222222222222',
      newPath,
      '33333333-3333-4333-8333-333333333333',
    );

    expect(result).toEqual({
      cleanupIntentId: '33333333-3333-4333-8333-333333333333',
      previousUploadedPath: previousPath,
    });
    expect(forUpdate).toHaveBeenCalledWith('update');
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      avatarKind: 'upload',
      avatarPath: newPath,
      avatarValue: newPath,
    }));
    expect(transaction.execute).toHaveBeenCalledTimes(3);
  });

  it('rejects an in-flight confirmation after another request supersedes its session', async () => {
    const oldPath = '11111111-1111-4111-8111-111111111111/avatar/22222222-2222-4222-8222-222222222222/session-old';
    const profileWrite = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    const forUpdate = vi.fn().mockResolvedValue([{
      avatarKind: 'upload',
      avatarPath: oldPath,
      avatarValue: oldPath,
      schoolId: '11111111-1111-4111-8111-111111111111',
    }]);
    const transaction = {
      // The empty exact-session lock is the deterministic interleaving: A
      // read `confirmed` before B, then B replaced the avatar, superseded A's
      // session, and its cleanup claim is now eligible before A writes.
      execute: vi.fn().mockResolvedValue([]),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ for: forUpdate }),
        }),
      }),
      update: vi.fn().mockReturnValue({ set: profileWrite }),
    };
    const database = {
      transaction: vi.fn().mockImplementation(async (work) => work(transaction)),
    };
    const repository = new DrizzleProfileRepository(database as never);

    await expect(repository.setUploadedAvatar(
      '22222222-2222-4222-8222-222222222222',
      oldPath,
      '33333333-3333-4333-8333-333333333333',
    )).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    // A must not restore its stale object path; cleanup can therefore delete
    // the superseded object only after the currently referenced path is safe.
    expect(profileWrite).not.toHaveBeenCalled();
  });
});
