import { and, eq, gt, isNotNull, isNull } from 'drizzle-orm';

import type { Database } from '../client.js';
import { signupChallenges } from '../schema/core.js';

export interface SignupChallengeRepository {
  create(input: { phoneE164: string }): Promise<void>;
  findVerifiedByPhone(phoneE164: string): Promise<boolean>;
  markVerified(phoneE164: string): Promise<void>;
  markCompleted(phoneE164: string): Promise<void>;
}

export class DrizzleSignupChallengeRepository implements SignupChallengeRepository {
  public constructor(private readonly db: Database) {}

  public async create({ phoneE164 }: { phoneE164: string }): Promise<void> {
    const now = new Date();
    await this.db.insert(signupChallenges).values({
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), phoneE164,
    }).onConflictDoUpdate({
      target: signupChallenges.phoneE164,
      set: { completedAt: null, createdAt: now, expiresAt: new Date(Date.now() + 10 * 60 * 1000), verifiedAt: null },
    });
  }

  public async findVerifiedByPhone(phoneE164: string): Promise<boolean> {
    const [row] = await this.db.select({ id: signupChallenges.id })
      .from(signupChallenges)
      .where(and(
        eq(signupChallenges.phoneE164, phoneE164),
        gt(signupChallenges.expiresAt, new Date()),
        isNotNull(signupChallenges.verifiedAt),
        isNull(signupChallenges.completedAt),
      ))
      .limit(1);
    return Boolean(row);
  }

  public async markVerified(phoneE164: string): Promise<void> {
    await this.db.update(signupChallenges).set({ verifiedAt: new Date() })
      .where(and(eq(signupChallenges.phoneE164, phoneE164), gt(signupChallenges.expiresAt, new Date())));
  }

  public async markCompleted(phoneE164: string): Promise<void> {
    await this.db.update(signupChallenges).set({ completedAt: new Date() })
      .where(eq(signupChallenges.phoneE164, phoneE164));
  }
}
