import { z } from 'zod';

/**
 * Community overview routes derive identity from the bearer token and accept
 * no profile, school, avatar, or interest input from the caller.
 */
export const communityProfileRequestSchema = z.object({}).strict();
