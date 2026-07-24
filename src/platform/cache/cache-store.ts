export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  withLock<T>(key: string, ttlSeconds: number, work: () => Promise<T>): Promise<T | null>;
}

export function assertValidCacheTtl(ttlSeconds: number): void {
  if (!Number.isFinite(ttlSeconds) || !Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new RangeError('ttlSeconds must be a finite, positive integer');
  }
}

export function tenantCacheKey(
  schoolId: string,
  domain: string,
  scope: string,
  identifier: string,
): string {
  return `v1:{${schoolId}}:${domain}:${scope}:${identifier}`;
}
