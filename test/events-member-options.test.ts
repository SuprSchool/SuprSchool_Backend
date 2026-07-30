import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import { eventMemberOptionsQuerySchema } from '../src/validators/events.schemas.js';

const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('event member option cursor contract', () => {
  it('decodes an opaque name-and-UUID keyset cursor', () => {
    const cursor = Buffer.from(JSON.stringify({
      displayNameKey: 'alex singh',
      userId,
    })).toString('base64url');

    expect(eventMemberOptionsQuerySchema.parse({
      cursor,
      limit: '20',
      role: 'teacher',
      search: 'Alex',
    })).toEqual({
      cursor: { displayNameKey: 'alex singh', userId },
      limit: 20,
      role: 'teacher',
      search: 'Alex',
    });
  });

  it('rejects a malformed member cursor without accepting client offsets', () => {
    expect(eventMemberOptionsQuerySchema.safeParse({ cursor: 'not-a-cursor', offset: 100 }).success)
      .toBe(false);
  });
});
