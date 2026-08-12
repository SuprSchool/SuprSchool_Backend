/**
 * Creates the auth shells the plan2c QA rosters need, then applies
 * supabase/seed-qa-plan2c-roster.sql.
 *
 * WHY THIS IS A SCRIPT AND NOT SEED SQL
 * public.user_profiles.id is FOREIGN KEY (id) REFERENCES auth.users(id), so the
 * 215 roster students cannot exist as profile rows alone. This repo keeps
 * auth-user creation out of seed SQL and behind an explicit confirmation --
 * see scripts/provision-qa-auth-users.ts, and the assertion in
 * test/qa-auth-provisioning-seed.test.ts that supabase/seed.sql contains no
 * `auth.` reference. Creating accounts is a deliberate operator action, not
 * something a database reset should do silently.
 *
 * WHAT IT CREATES
 * One auth.users row per student carrying ONLY an id. No password, no email, no
 * phone, no auth.identities row. Nothing addresses these accounts and no
 * credential exists to present, so they cannot be signed in to by any path -
 * they exist purely to satisfy the foreign key behind a class roster. This is
 * deliberately far less than provision-qa-auth-users.ts does for the two real QA
 * logins, which go through the Supabase Admin API because they must actually
 * authenticate.
 *
 * USAGE
 *   QA_PROVISION_CONFIRM=1 node --env-file=.env --import tsx scripts/seed-qa-roster-students.ts
 *
 * Idempotent: every statement is on-conflict-do-nothing, so re-running reports
 * the same totals and changes nothing.
 */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import postgres from 'postgres';

import { assertQaProvisioningSafety } from './provision-qa-auth-users.js';

/** Mirrors the roster in supabase/seed-qa-plan2c-roster.sql. */
const ROSTER_CLASSES = [
  { classNo: 1, studentCount: 55 },
  { classNo: 2, studentCount: 52 },
  { classNo: 3, studentCount: 58 },
  { classNo: 4, studentCount: 50 },
] as const;

/**
 * The same deterministic key the roster SQL builds:
 * 11000000-0000-4000-8000-<CC>00000<SSSSS>.
 */
export function rosterStudentIds(
  roster: readonly { classNo: number; studentCount: number }[] = ROSTER_CLASSES,
): string[] {
  const ids: string[] = [];
  for (const { classNo, studentCount } of roster) {
    for (let seq = 1; seq <= studentCount; seq += 1) {
      const suffix = `${String(classNo).padStart(2, '0')}00000${String(seq).padStart(5, '0')}`;
      ids.push(`11000000-0000-4000-8000-${suffix}`);
    }
  }
  return ids;
}

async function run(): Promise<void> {
  assertQaProvisioningSafety({
    NODE_ENV: process.env.NODE_ENV,
    QA_PROVISION_CONFIRM: process.env.QA_PROVISION_CONFIRM,
    QA_PROVISION_ALLOW_PRODUCTION: process.env.QA_PROVISION_ALLOW_PRODUCTION,
  });

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const ids = rosterStudentIds();
  const rosterSql = await readFile(
    new URL('../supabase/seed-qa-plan2c-roster.sql', import.meta.url),
    'utf8',
  );

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    // Shells first, then the public-schema roster, so the foreign key is always
    // satisfied by the time the profile rows land.
    // postgres.js serialises a plain JS array into a Postgres array parameter;
    // sql.array() here produced a bare comma-joined string that ::uuid[] rejected.
    const shells = await sql`
      insert into auth.users (id)
      select unnest(${ids}::uuid[])
      on conflict (id) do nothing
      returning id
    `;
    console.info(`[qa-roster] auth shells created=${shells.length} requested=${ids.length}`);

    await sql.unsafe(rosterSql);

    const [counts] = await sql`
      select
        (select count(*) from public.user_profiles
          where id::text like '11000000-0000-4000-8000-%') as profiles,
        (select count(*) from public.class_members cm
          join public.user_profiles up on up.id = cm.student_id
          where up.id::text like '11000000-0000-4000-8000-%') as memberships
    `;
    console.info(
      `[qa-roster] success profiles=${counts?.profiles ?? 0} memberships=${counts?.memberships ?? 0}`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error: unknown) => {
    console.error('[qa-roster] failure', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
