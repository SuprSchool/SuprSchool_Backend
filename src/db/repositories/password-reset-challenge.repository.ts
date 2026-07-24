import { and, eq, gt, isNull } from 'drizzle-orm';

import type { Database } from '../client.js';
import { passwordResetChallenges } from '../schema/core.js';

export interface PasswordResetChallengeRepository {
  createVerified(input: { phoneE164: string; userId: string }): Promise<void>;
  findVerifiedByPhone(phoneE164: string): Promise<{ userId: string } | null>;
  markCompleted(phoneE164: string): Promise<void>;
}

export class DrizzlePasswordResetChallengeRepository implements PasswordResetChallengeRepository {
  public constructor(private readonly db: Database) {}

  public async createVerified({ phoneE164, userId }: { phoneE164: string; userId: string }): Promise<void> {
    const now = new Date();
    await this.db.insert(passwordResetChallenges).values({
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), phoneE164, userId, verifiedAt: now,
    }).onConflictDoUpdate({
      target: passwordResetChallenges.phoneE164,
      set: { completedAt: null, createdAt: now, expiresAt: new Date(Date.now() + 10 * 60 * 1000), userId, verifiedAt: now },
    });
  }

  public async findVerifiedByPhone(phoneE164: string): Promise<{ userId: string } | null> {
    const [row] = await this.db.select({ userId: passwordResetChallenges.userId })
      .from(passwordResetChallenges)
      .where(and(
        eq(passwordResetChallenges.phoneE164, phoneE164),
        gt(passwordResetChallenges.expiresAt, new Date()),
        isNull(passwordResetChallenges.completedAt),
      ))
      .limit(1);
    return row ?? null;
  }

  public async markCompleted(phoneE164: string): Promise<void> {
    await this.db.update(passwordResetChallenges).set({ completedAt: new Date() })
      .where(eq(passwordResetChallenges.phoneE164, phoneE164));
  }
}
