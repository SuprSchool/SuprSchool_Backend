import { expect, it } from 'vitest';

import { ensureQaAuthUser } from '../scripts/provision-qa-auth-users.js';

const phone = '+917755090948';

// Catches treating a duplicate phone as safe without fetching and verifying the
// existing Admin API record before reusing its immutable identity.
it('verifies and reuses an existing Admin Auth user without writing Auth', async () => {
  const result = await ensureQaAuthUser({
    auth: {
      admin: {
        createUser: async () => {
          throw new Error('must not create an existing user');
        },
        deleteUser: async () => { throw new Error('must not delete an existing user'); },
        getUserById: async (id: string) => ({
          data: { user: { id, phone, phone_confirmed_at: '2026-01-01T00:00:00Z' } },
          error: null,
        }),
        listUsers: async () => ({
          data: { users: [{ id: 'existing-user', phone, phone_confirmed_at: '2026-01-01T00:00:00Z' }] },
          error: null,
        }),
      },
    },
  }, { phoneE164: phone, password: 'test-only-password' }, 'existing-user');

  expect(result).toBe('existing-user');
});

// Catches reusing an account selected from a duplicate-phone listing when the
// direct Admin API lookup shows that it is not the expected confirmed identity.
it('refuses to reuse an existing Admin Auth user whose phone is not verified', async () => {
  await expect(ensureQaAuthUser({
    auth: {
      admin: {
        createUser: async () => ({ data: { user: null }, error: null }),
        deleteUser: async () => ({ data: { user: null }, error: null }),
        getUserById: async (id: string) => ({
          data: { user: { id, phone: '+919999999999', phone_confirmed_at: null } },
          error: null,
        }),
        listUsers: async () => ({
          data: { users: [{ id: 'existing-user', phone, phone_confirmed_at: '2026-01-01T00:00:00Z' }] },
          error: null,
        }),
      },
    },
  }, { phoneE164: phone, password: 'test-only-password' }, 'existing-user')).rejects.toThrow('verified Admin Auth identity');
});

// Catches silently treating the first Admin API page as the complete user set.
it('finds and verifies an existing QA user on a later Admin API page', async () => {
  const pages: number[] = [];

  const result = await ensureQaAuthUser({
    auth: {
      admin: {
        createUser: async () => {
          throw new Error('must not create a user found on a later page');
        },
        deleteUser: async () => {
          throw new Error('must not delete a user found on a later page');
        },
        getUserById: async (id: string) => ({
          data: { user: { id, phone, phone_confirmed_at: '2026-01-01T00:00:00Z' } },
          error: null,
        }),
        listUsers: async ({ page }: { page: number }) => {
          pages.push(page);
          return {
            data: { users: page === 1
              ? Array.from({ length: 1000 }, (_, index) => ({ id: `other-${index}`, phone: `+910000${index}` }))
              : [{ id: 'later-page-user', phone, phone_confirmed_at: '2026-01-01T00:00:00Z' }] },
            error: null,
          };
        },
      },
    },
  }, { phoneE164: phone, password: 'test-only-password' }, 'later-page-user');

  expect(result).toBe('later-page-user');
  expect(pages).toEqual([1, 2]);
});

// A missing identity is safe to create only when the preflight also observed
// it missing; a null snapshot must not be treated as an identity replacement.
it('creates a QA Auth user when both preflight and the second lookup are absent', async () => {
  const created: string[] = [];

  const userId = await ensureQaAuthUser({
    auth: {
      admin: {
        createUser: async ({ phone }) => {
          created.push(phone);
          return { data: { user: { id: 'created-user', phone, phone_confirmed_at: '2026-01-01T00:00:00Z' } }, error: null };
        },
        deleteUser: async () => {
          throw new Error('must not compensate a successful direct create');
        },
        getUserById: async () => ({ data: { user: null }, error: null }),
        listUsers: async () => ({ data: { users: [] }, error: null }),
      },
    },
  }, { phoneE164: phone, password: 'test-only-password' }, null);

  expect(userId).toBe('created-user');
  expect(created).toEqual([phone]);
});
