import { z } from 'zod';

/**
 * Community overview routes derive identity from the bearer token and accept
 * no profile, school, avatar, or interest input from the caller.
 */
export const communityProfileRequestSchema = z.object({}).strict();

/**
 * The one community read that takes a subject: whose profile to show.
 *
 * `strict` over params merged with query, so the route accepts the student id
 * and nothing else — no school override, no field selection. Which school the
 * id is resolved in comes from the bearer token, never from the caller.
 */
export const studentDirectoryProfileRequestSchema = z
  .object({ studentId: z.uuid() })
  .strict();
