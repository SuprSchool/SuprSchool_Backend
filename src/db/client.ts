import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import type { Env } from '../config/env.js';
import * as coreSchema from './schema/core.js';
import { diarySchema } from './schema/diary.js';
import { eventsSchema } from './schema/events.js';
import { recordingsSchema } from './schema/recordings.js';
import { chatSchema } from './schema/chat.js';
import { communitySchoolSchema } from './schema/community-school.js';
import { pointsSchema } from './schema/points.js';
import { rankingsSchema } from './schema/rankings.js';

const schema = {
  ...coreSchema,
  ...diarySchema,
  ...eventsSchema,
  ...recordingsSchema,
  ...chatSchema,
  ...communitySchoolSchema,
  ...pointsSchema,
  ...rankingsSchema,
};

export function createDatabase(env: Pick<Env, 'DATABASE_URL'>) {
  const client = postgres(env.DATABASE_URL, { prepare: false });

  return {
    client,
    db: drizzle({ client, schema }),
  };
}

export type Database = ReturnType<typeof createDatabase>['db'];
