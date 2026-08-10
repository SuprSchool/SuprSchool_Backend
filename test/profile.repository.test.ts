import { drizzle, type RemoteCallback } from 'drizzle-orm/pg-proxy';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../src/db/client.js';
import { DrizzleProfileRepository } from '../src/db/repositories/profile.repository.js';

describe('DrizzleProfileRepository', () => {
  const schoolId = '11111111-1111-4111-8111-111111111111';

  function stubDatabase(
    profile: Record<string, unknown> | undefined,
    enrolment: ReadonlyArray<{ className: string; section: string }>,
  ) {
    const selectProfile = {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(profile === undefined ? [] : [profile]),
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
    const enrolmentWhere = vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue([...enrolment]),
    });
    const selectEnrolment = {
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({ where: enrolmentWhere }),
        }),
      }),
    };
    return {
      enrolmentWhere,
      database: {
        select: vi.fn()
          .mockReturnValueOnce(selectProfile)
          .mockReturnValueOnce(selectInterests)
          .mockReturnValueOnce(selectEnrolment),
      },
    };
  }

  const profileRow = {
    avatarKind: 'preset',
    avatarValue: 'avatar-1',
    displayName: 'Aarav Sharma',
    id: '22222222-2222-4222-8222-222222222222',
    phoneE164: '+917755090948',
    schoolId,
  };

  it('returns the complete authenticated profile descriptor', async () => {
    const { database } = stubDatabase(profileRow, [{ className: 'Class 9th - B', section: 'B' }]);
    const repository = new DrizzleProfileRepository(database as never);

    await expect(repository.getProfile(profileRow.id, schoolId)).resolves.toEqual({
      avatar: { kind: 'preset', value: 'avatar-1' },
      className: 'Class 9th - B',
      displayName: 'Aarav Sharma',
      id: '22222222-2222-4222-8222-222222222222',
      interests: ['Coding', 'Reading'],
      phoneE164: '+917755090948',
      schoolId,
      section: 'B',
    });
  });

  // 253:6842 and the announcements chip row read these two fields directly.
  // A teacher — or a student between enrolments — has no current membership,
  // and both must publish null rather than an empty string.
  it('publishes a null class and section when no current membership exists', async () => {
    const { database } = stubDatabase(profileRow, []);
    const repository = new DrizzleProfileRepository(database as never);

    await expect(repository.getProfile(profileRow.id, schoolId)).resolves.toMatchObject({
      className: null,
      section: null,
    });
  });

  it('never reads a profile outside the caller school', async () => {
    const { database } = stubDatabase(undefined, [{ className: 'Class 9th - B', section: 'B' }]);
    const repository = new DrizzleProfileRepository(database as never);

    await expect(repository.getProfile(profileRow.id, 'another-school')).resolves.toBeNull();
    // The enrolment lookup must not run once the school-scoped profile misses.
    expect(database.select).toHaveBeenCalledTimes(1);
  });

  // The class lookup keys on student_id, which is not tenant-unique on its own.
  // Both halves of the read carry the caller school into the SQL.
  it('scopes the profile read and its enrolment lookup to the caller school', async () => {
    const queries: string[] = [];
    const callback: RemoteCallback = async (query) => {
      queries.push(query);
      return query.includes('from "user_profiles"')
        ? { rows: [['preset', 'avatar-1', 'Aarav Sharma', profileRow.id, '+917755090948', schoolId]] }
        : { rows: [] };
    };
    const repository = new DrizzleProfileRepository(drizzle(callback) as unknown as Database);

    await repository.getProfile(profileRow.id, schoolId);

    expect(queries).toHaveLength(3);
    expect(queries[0]).toContain('"user_profiles"."school_id" =');
    expect(queries[2]).toContain('from "class_members"');
    expect(queries[2]).toContain('"class_members"."school_id" =');
    expect(queries[2]).toContain('"academic_years"."is_current"');
    expect(queries[2]).toContain('"class_members"."is_active"');
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
