import { readFileSync } from 'node:fs';

import { getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  coreSchema,
  profileInterests,
  userProfiles,
} from '../src/db/schema/core.js';

const profileMigrationSql = readFileSync(
  new URL(
    '../supabase/migrations/20260715030000_profile_interests_and_avatars.sql',
    import.meta.url,
  ),
  'utf8',
);

const avatarCleanupOutboxMigrationSql = readFileSync(
  new URL(
    '../supabase/migrations/20260715050000_avatar_cleanup_outbox.sql',
    import.meta.url,
  ),
  'utf8',
);

const uploadSessionMigrationSql = readFileSync(
  new URL(
    '../supabase/migrations/20260713020000_platform_idempotency_storage.sql',
    import.meta.url,
  ),
  'utf8',
);

const profileRepositorySource = readFileSync(
  new URL('../src/db/repositories/profile.repository.ts', import.meta.url),
  'utf8',
);

describe('profile schema', () => {
  it('exports the profile interests relation with the core profile schema', () => {
    expect(coreSchema).toMatchObject({ profileInterests, userProfiles });
    expect(getTableName(profileInterests)).toBe('profile_interests');
  });

  it('keeps avatar reads owner-only and profile interests server-only', () => {
    expect(profileMigrationSql).toMatch(
      /create policy "authenticated users read tenant avatar objects"[\s\S]*?on storage\.objects for select[\s\S]*?\(storage\.foldername\(name\)\)\[3\] = auth\.uid\(\)::text/i,
    );
    expect(profileMigrationSql).not.toMatch(
      /create policy\s+"[^"]+"\s+on public\.profile_interests\s+for\s+(?:all|insert|update|delete)\b/i,
    );
  });

  it('continues cleanup dispatch beyond the first 100 pending schools', () => {
    // With 101+ schools, a static `order by school_id limit 100` can retry the
    // same failed tenants forever. The persisted cursor takes the next page
    // and wraps at the end, so the omitted school receives the next turn.
    expect(avatarCleanupOutboxMigrationSql).not.toMatch(
      /order by school_id\s+limit 100/i,
    );
    expect(avatarCleanupOutboxMigrationSql).toMatch(
      /create table public\.avatar_cleanup_dispatch_state/i,
    );
    expect(avatarCleanupOutboxMigrationSql).toMatch(
      /school_id > cursor_school_id[\s\S]*?school_id <= cursor_school_id/i,
    );
  });

  it('replaces the legacy upload-session checks before superseding an avatar', () => {
    const legacyStatuses = uploadSessionMigrationSql.match(
      /status text not null default 'pending' check \(status in \(([^)]+)\)\)/i,
    )?.[1] ?? '';
    const replacementStatuses = avatarCleanupOutboxMigrationSql.match(
      /add constraint upload_sessions_status_check\s+check \(status in \(([^)]+)\)\)/i,
    )?.[1] ?? '';
    const supersededStatus = profileRepositorySource.match(
      /update public\.upload_sessions\s+set status = '([^']+)'/i,
    )?.[1];

    expect(avatarCleanupOutboxMigrationSql).toMatch(
      /drop constraint if exists upload_sessions_status_check[\s\S]*?drop constraint if exists upload_sessions_check[\s\S]*?drop constraint if exists upload_sessions_confirmation_state_check/i,
    );
    expect(avatarCleanupOutboxMigrationSql).toMatch(
      /add constraint upload_sessions_confirmation_state_check[\s\S]*?status in \('confirmed', 'superseded'\)/i,
    );
    expect(replacementStatuses).toContain("'pending'");
    expect(replacementStatuses).toContain("'confirmed'");
    expect(replacementStatuses).toContain("'superseded'");
    expect(legacyStatuses).toContain("'pending'");
    expect(legacyStatuses).toContain("'confirmed'");
    expect(supersededStatus).toBeDefined();
    expect(replacementStatuses).toContain(`'${supersededStatus}'`);
  });
});
