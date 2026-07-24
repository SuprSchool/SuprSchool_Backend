export interface UploadSessionRequest {
  displayName?: string;
  bucket: string;
  contentType: string;
  parentId: string;
  parentType: string;
  sizeBytes: number;
}

export interface UploadSession {
  id: string;
  objectPath: string;
  expiresAt: string;
}

export interface CreatedUploadSession extends UploadSession {
  signedUploadUrl: string;
}

export function assertObjectPath(schoolId: string, objectPath: string): void {
  const [pathSchoolId, ...segments] = objectPath.split('/');
  if (
    !isSafePathSegment(schoolId) ||
    pathSchoolId !== schoolId ||
    segments.length === 0 ||
    segments.some((segment) => !isSafePathSegment(segment))
  ) {
    throw new Error('Storage object path is outside the authenticated school');
  }
}

function isSafePathSegment(segment: string): boolean {
  return (
    segment !== '.' &&
    segment !== '..' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment)
  );
}
