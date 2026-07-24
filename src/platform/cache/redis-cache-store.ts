import { randomUUID } from 'node:crypto';

import { assertValidCacheTtl, type CacheStore } from './cache-store.js';

export interface RedisCacheClient {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    expires: 'EX',
    ttlSeconds: number,
    onlyIfAbsent?: 'NX',
  ): Promise<'OK' | null>;
  del(key: string): Promise<number>;
  eval(
    script: string,
    numberOfKeys: number,
    ...args: string[]
  ): Promise<unknown>;
}

const compareAndDeleteScript = [
  "if redis.call('get', KEYS[1]) == ARGV[1] then",
  "  return redis.call('del', KEYS[1])",
  'end',
  'return 0',
].join('\n');

export class RedisCacheStore implements CacheStore {
  constructor(private readonly client: RedisCacheClient) {}

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    assertValidCacheTtl(ttlSeconds);
    await this.client.set(key, value, 'EX', ttlSeconds);
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  async withLock<T>(
    key: string,
    ttlSeconds: number,
    work: () => Promise<T>,
  ): Promise<T | null> {
    assertValidCacheTtl(ttlSeconds);
    const token = randomUUID();
    const acquired = await this.client.set(key, token, 'EX', ttlSeconds, 'NX');

    if (acquired !== 'OK') {
      return null;
    }

    try {
      return await work();
    } finally {
      await this.client.eval(compareAndDeleteScript, 1, key, token);
    }
  }
}
