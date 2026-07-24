import { asc, eq, sql } from 'drizzle-orm';

import type { Database } from '../client.js';
import { AppError } from '../../lib/errors.js';
import { profileInterests, userProfiles } from '../schema/core.js';
import type {
  ProfileAvatarPreset,
  ProfileDescriptor,
  ProfileInterest,
} from '../../types/profile.js';
import type { AvatarCleanupIntent } from '../../services/avatar.service.js';

export interface ProfileRepository {
  getProfile(userId: string): Promise<ProfileDescriptor | null>;
  replaceInterests(userId: string, interests: readonly ProfileInterest[]): Promise<void>;
  setPresetAvatar(userId: string, presetId: ProfileAvatarPreset): Promise<boolean>;
  setUploadedAvatar(
    userId: string,
    objectPath: string,
    sessionId: string,
  ): Promise<{
    cleanupIntentId: string | undefined;
    previousUploadedPath: string | undefined;
  } | null>;
  claimForCleanup(intentId: string): Promise<AvatarCleanupIntent | null>;
  completeCleanup(intentId: string): Promise<void>;
  listPendingCleanup(schoolId: string, limit: number): Promise<ReadonlyArray<AvatarCleanupIntent>>;
}

export class DrizzleProfileRepository implements ProfileRepository {
  public constructor(private readonly db: Database) {}

  public async getProfile(userId: string): Promise<ProfileDescriptor | null> {
    const [profile] = await this.db
      .select({
        avatarKind: userProfiles.avatarKind,
        avatarValue: userProfiles.avatarValue,
        displayName: userProfiles.displayName,
        id: userProfiles.id,
        phoneE164: userProfiles.phoneE164,
        schoolId: userProfiles.schoolId,
      })
      .from(userProfiles)
      .where(eq(userProfiles.id, userId))
      .limit(1);

    if (!profile) return null;

    const interests = await this.db
      .select({ interest: profileInterests.interest })
      .from(profileInterests)
      .where(eq(profileInterests.userId, userId))
      .orderBy(asc(profileInterests.interest));

    return {
      avatar: profile.avatarKind && profile.avatarValue
        ? { kind: profile.avatarKind, value: profile.avatarValue }
        : null,
      displayName: profile.displayName,
      id: profile.id,
      interests: interests.map(({ interest }) => interest as ProfileInterest),
      phoneE164: profile.phoneE164,
      schoolId: profile.schoolId,
    };
  }

  public async replaceInterests(
    userId: string,
    interests: readonly ProfileInterest[],
  ): Promise<void> {
    await this.db.transaction(async (transaction) => {
      await transaction.delete(profileInterests).where(eq(profileInterests.userId, userId));
      if (interests.length > 0) {
        await transaction.insert(profileInterests).values(
          interests.map((interest) => ({ interest, userId })),
        );
      }
    });
  }

  public async setPresetAvatar(
    userId: string,
    presetId: ProfileAvatarPreset,
  ): Promise<boolean> {
    return this.db.transaction(async (transaction) => {
      const [profile] = await transaction
        .select({
          avatarKind: userProfiles.avatarKind,
          avatarPath: userProfiles.avatarPath,
          avatarValue: userProfiles.avatarValue,
          schoolId: userProfiles.schoolId,
        })
        .from(userProfiles)
        .where(eq(userProfiles.id, userId))
        .for('update');
      if (!profile) return false;

      await transaction
        .update(userProfiles)
        .set({
          avatarKind: 'preset',
          avatarPath: null,
          avatarValue: presetId,
          updatedAt: new Date(),
        })
        .where(eq(userProfiles.id, userId));

      const previousUploadedPath = profile.avatarKind === 'upload'
        ? profile.avatarValue ?? profile.avatarPath ?? undefined
        : undefined;
      if (previousUploadedPath !== undefined) {
        await retireAvatarObject(
          transaction,
          profile.schoolId,
          userId,
          previousUploadedPath,
        );
      }
      return true;
    });
  }

  public async setUploadedAvatar(
    userId: string,
    objectPath: string,
    sessionId: string,
  ): Promise<{
    cleanupIntentId: string | undefined;
    previousUploadedPath: string | undefined;
  } | null> {
    return this.db.transaction(async (transaction) => {
      const [profile] = await transaction
        .select({
          avatarKind: userProfiles.avatarKind,
          avatarPath: userProfiles.avatarPath,
          avatarValue: userProfiles.avatarValue,
          schoolId: userProfiles.schoolId,
        })
        .from(userProfiles)
        .where(eq(userProfiles.id, userId))
        .for('update');
      if (!profile) return null;

      const sessions = await transaction.execute(sql<{ id: string; status: 'pending' | 'confirmed' }>`
        select id, status
        from public.upload_sessions
        where id = ${sessionId}::uuid
          and school_id = ${profile.schoolId}::uuid
          and user_id = ${userId}::uuid
          and bucket = 'avatars'
          and object_path = ${objectPath}
          and status in ('pending', 'confirmed')
        for update
      `);
      const session = (sessions as unknown as ReadonlyArray<{
        id: string;
        status: 'pending' | 'confirmed';
      }>)[0];
      if (session === undefined) {
        throw new AppError('VALIDATION_ERROR', 400, 'Avatar upload session is no longer eligible');
      }

      const existingAvatarPath = profile.avatarKind === 'upload'
        ? profile.avatarValue ?? profile.avatarPath ?? undefined
        : undefined;
      if (session.status === 'confirmed' && existingAvatarPath !== objectPath) {
        throw new AppError('VALIDATION_ERROR', 400, 'Avatar upload session is no longer eligible');
      }
      if (session.status === 'pending') {
        const confirmed = await transaction.execute(sql<{ id: string }>`
          update public.upload_sessions
          set status = 'confirmed',
              confirmed_session_id = ${sessionId}::uuid,
              confirmed_at = now()
          where id = ${sessionId}::uuid
            and school_id = ${profile.schoolId}::uuid
            and user_id = ${userId}::uuid
            and status = 'pending'
          returning id
        `);
        if ((confirmed as unknown as ReadonlyArray<{ id: string }>)[0] === undefined) {
          throw new AppError('VALIDATION_ERROR', 400, 'Avatar upload session is no longer eligible');
        }
      }
      const previousUploadedPath = profile.avatarKind === 'upload'
        ? profile.avatarValue ?? profile.avatarPath ?? undefined
        : undefined;
      await transaction
        .update(userProfiles)
        .set({
          avatarKind: 'upload',
          avatarPath: objectPath,
          avatarValue: objectPath,
          updatedAt: new Date(),
        })
        .where(eq(userProfiles.id, userId));

      const cleanupIntentId = previousUploadedPath !== undefined
        && previousUploadedPath !== objectPath
        ? await retireAvatarObject(
          transaction,
          profile.schoolId,
          userId,
          previousUploadedPath,
        )
        : undefined;

      return { cleanupIntentId, previousUploadedPath };
    });
  }

  public async claimForCleanup(intentId: string): Promise<AvatarCleanupIntent | null> {
    return this.db.transaction(async (transaction) => {
      const rows = await transaction.execute(sql<AvatarCleanupIntentRow>`
        select id, school_id, user_id, object_path
        from public.avatar_cleanup_intents
        where id = ${intentId}::uuid
          and status = 'pending'
        for update
      `);
      const intent = toAvatarCleanupIntent((rows as unknown as ReadonlyArray<AvatarCleanupIntentRow>)[0]);
      if (intent === null) return null;

      const profiles = await transaction.execute(sql<{ id: string }>`
        select id
        from public.user_profiles
        where avatar_value = ${intent.objectPath}
        for update
      `);
      const profile = (profiles as unknown as ReadonlyArray<{ id: string }>)[0];
      if (profile !== undefined) {
        await transaction.execute(sql`
          update public.avatar_cleanup_intents
          set status = 'cancelled', updated_at = now()
          where id = ${intent.id}::uuid
        `);
        return null;
      }

      const sessions = await transaction.execute(sql<{ status: string }>`
        select status
        from public.upload_sessions
        where school_id = ${intent.schoolId}::uuid
          and user_id = ${intent.userId}::uuid
          and bucket = 'avatars'
          and object_path = ${intent.objectPath}
        for update
      `);
      const session = (sessions as unknown as ReadonlyArray<{ status: string }>)[0];
      return session?.status === 'superseded' ? intent : null;
    });
  }

  public async completeCleanup(intentId: string): Promise<void> {
    await this.db.execute(sql`
      update public.avatar_cleanup_intents
      set status = 'completed', updated_at = now(), completed_at = now()
      where id = ${intentId}::uuid
        and status = 'pending'
    `);
  }

  public async listPendingCleanup(
    schoolId: string,
    limit: number,
  ): Promise<ReadonlyArray<AvatarCleanupIntent>> {
    const rows = await this.db.execute(sql<AvatarCleanupIntentRow>`
      select id, school_id, user_id, object_path
      from public.avatar_cleanup_intents
      where school_id = ${schoolId}::uuid
        and status = 'pending'
      order by created_at
      limit ${limit}
    `);
    return (rows as unknown as ReadonlyArray<AvatarCleanupIntentRow>)
      .map(toAvatarCleanupIntent)
      .filter((intent): intent is AvatarCleanupIntent => intent !== null);
  }
}

interface AvatarCleanupIntentRow {
  id: string;
  object_path: string;
  school_id: string;
  user_id: string;
}

async function retireAvatarObject(
  transaction: Parameters<Parameters<Database['transaction']>[0]>[0],
  schoolId: string,
  userId: string,
  objectPath: string,
): Promise<string | undefined> {
  await transaction.execute(sql`
    update public.upload_sessions
    set status = 'superseded'
    where school_id = ${schoolId}::uuid
      and user_id = ${userId}::uuid
      and bucket = 'avatars'
      and object_path = ${objectPath}
      and status = 'confirmed'
  `);
  const rows = await transaction.execute(sql<{ id: string }>`
    insert into public.avatar_cleanup_intents (
      school_id,
      user_id,
      object_path,
      status
    )
    values (
      ${schoolId}::uuid,
      ${userId}::uuid,
      ${objectPath},
      'pending'
    )
    on conflict (school_id, object_path) do update
    set status = 'pending', updated_at = now(), completed_at = null
    returning id
  `);
  return (rows as unknown as ReadonlyArray<{ id: string }>)[0]?.id;
}

function toAvatarCleanupIntent(
  row: AvatarCleanupIntentRow | undefined,
): AvatarCleanupIntent | null {
  if (row === undefined) return null;
  return {
    id: row.id,
    objectPath: row.object_path,
    schoolId: row.school_id,
    userId: row.user_id,
  };
}
