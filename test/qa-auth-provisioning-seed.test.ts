import { readFile } from 'node:fs/promises';

import { expect, it } from 'vitest';

const seed = await readFile(new URL('../supabase/seed.sql', import.meta.url), 'utf8');

it('keeps replayed QA directory entries unclaimed only when no claim exists', () => {
  expect(seed).not.toMatch(/claimed_by_user_id\s*=\s*null/i);
  expect(seed).not.toMatch(/on conflict \(id\) do update set status/i);
  expect(seed).not.toMatch(/\bauth\./i);
});
