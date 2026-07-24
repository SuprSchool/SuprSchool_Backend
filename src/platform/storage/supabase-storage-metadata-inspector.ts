import type { SupabaseClient } from '@supabase/supabase-js';

import type { StorageObjectMetadataInspector } from './storage-service.js';

export class SupabaseStorageObjectMetadataInspector implements StorageObjectMetadataInspector {
  public constructor(private readonly supabase: SupabaseClient) {}

  public async inspect(
    bucket: string,
    objectPath: string,
  ): Promise<{ bucket: string; contentType: string; objectPath: string; sizeBytes: number } | undefined> {
    const separator = objectPath.lastIndexOf('/');
    const directory = separator === -1 ? '' : objectPath.slice(0, separator);
    const objectName = separator === -1 ? objectPath : objectPath.slice(separator + 1);
    if (objectName.length === 0) {
      return undefined;
    }
    const { data, error } = await this.supabase.storage
      .from(bucket)
      .list(directory, { search: objectName });
    if (error !== null) {
      throw error;
    }
    const object = data?.find((candidate) => candidate.name === objectName);
    const metadata = object?.metadata as { mimetype?: unknown; size?: unknown } | undefined;
    const contentType = metadata?.mimetype;
    const rawSize = metadata?.size;
    const sizeBytes = typeof rawSize === 'number' ? rawSize : Number(rawSize);
    if (typeof contentType !== 'string' || !Number.isSafeInteger(sizeBytes)) {
      return undefined;
    }
    return { bucket, contentType, objectPath, sizeBytes };
  }
}
