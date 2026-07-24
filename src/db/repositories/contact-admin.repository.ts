import { contactAdminRequests } from '../schema/core.js';
import type { Database } from '../client.js';
import type { ClaimableRole } from '../../types/auth.js';

export interface ContactAdminRepository {
  create(input: { phoneE164: string; message: string; requestedRole?: ClaimableRole }): Promise<void>;
}

export class DrizzleContactAdminRepository implements ContactAdminRepository {
  public constructor(private readonly db: Database) {}

  public async create(input: { phoneE164: string; message: string; requestedRole?: ClaimableRole }): Promise<void> {
    await this.db.insert(contactAdminRequests).values({
      message: input.message,
      phoneE164: input.phoneE164,
      requestedRole: input.requestedRole,
    });
  }
}
