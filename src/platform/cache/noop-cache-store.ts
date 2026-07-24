import { assertValidCacheTtl, type CacheStore } from './cache-store.js';

export class NoopCacheStore implements CacheStore {
  async get(_key: string): Promise<string | null> {
    void _key;
    return null;
  }

  async set(_key: string, _value: string, _ttlSeconds: number): Promise<void> {
    void _key;
    void _value;
    assertValidCacheTtl(_ttlSeconds);
  }

  async delete(_key: string): Promise<void> {
    void _key;
  }

  async withLock<T>(
    _key: string,
    _ttlSeconds: number,
    work: () => Promise<T>,
  ): Promise<T> {
    void _key;
    assertValidCacheTtl(_ttlSeconds);
    return work();
  }
}
