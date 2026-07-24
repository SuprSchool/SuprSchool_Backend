import type { RecordingRepository } from '../../db/repositories/recordings.repository.js';
import { AppError } from '../../lib/errors.js';
import type {
  CreateRecordingResourceUploadInput,
  RecordingIdentity,
  RecordingResourceKind,
  RecordingResourceUploadSessionResponse,
} from '../../types/recordings.js';
import type {
  PreparedRecordingResourceUpload,
  RecordingResourceFilePort,
} from '../../services/recordings.service.js';
import {
  type StorageService,
  UploadObjectMetadataMismatchError,
  UploadParentAuthorizationError,
  UploadSessionExpiredError,
  UploadSessionIneligibleError,
  UploadSessionNotFoundError,
  type UploadParentAuthorizer,
  type UploadSessionRecord,
} from './storage-service.js';

const RECORDING_BUCKET = 'recordings' as const;
const RECORDING_RESOURCE_READ_TTL_SECONDS = 900;
type RecordingResourceParentType = 'recording-banner' | 'recording-resource';

function parentType(kind: RecordingResourceKind): RecordingResourceParentType {
  return kind === 'banner' ? 'recording-banner' : 'recording-resource';
}

function kindFromParentType(value: string): RecordingResourceKind | undefined {
  if (value === 'recording-banner') return 'banner';
  if (value === 'recording-resource') return 'attachment';
  return undefined;
}

function asAppError(error: unknown): unknown {
  if (error instanceof UploadParentAuthorizationError) {
    return new AppError('FORBIDDEN', 403, 'You cannot upload resources for this recording');
  }
  if (error instanceof UploadSessionNotFoundError) {
    return new AppError('NOT_FOUND', 404, 'Recording resource upload session not found');
  }
  if (error instanceof UploadSessionExpiredError) {
    return new AppError('VALIDATION_ERROR', 400, 'Recording resource upload session expired');
  }
  if (error instanceof UploadSessionIneligibleError) {
    return new AppError('VALIDATION_ERROR', 400, 'Recording resource upload session is no longer eligible');
  }
  if (error instanceof UploadObjectMetadataMismatchError) {
    return new AppError('VALIDATION_ERROR', 400, 'Uploaded recording resource does not match its approved session');
  }
  return error;
}

function assertRecordingResourceSession(
  session: UploadSessionRecord,
  recordingId?: string,
): PreparedRecordingResourceUpload {
  const kind = kindFromParentType(session.parentType);
  if (
    session.bucket !== RECORDING_BUCKET
    || kind === undefined
    || session.displayName === null
    || (recordingId !== undefined && session.parentId !== recordingId)
  ) {
    throw new AppError('VALIDATION_ERROR', 400, 'Upload session is not for this recording resource');
  }
  return {
    contentType: session.contentType as PreparedRecordingResourceUpload['contentType'],
    displayName: session.displayName,
    kind,
    objectPath: session.objectPath,
    sizeBytes: session.sizeBytes,
    uploadSessionId: session.id,
  };
}

export class RecordingResourceUploadParentAuthorizer implements UploadParentAuthorizer {
  public constructor(
    private readonly recordings: Pick<RecordingRepository, 'findResourceEditableRecording'>,
  ) {}

  public async authorize(request: {
    action: 'create' | 'confirm';
    bucket: string;
    parentId: string;
    parentType: string;
    schoolId: string;
    userId: string;
  }): Promise<boolean> {
    if (
      request.bucket !== RECORDING_BUCKET
      || kindFromParentType(request.parentType) === undefined
    ) return false;
    return (await this.recordings.findResourceEditableRecording(
      { schoolId: request.schoolId, userId: request.userId },
      request.parentId,
    )) !== undefined;
  }
}

export class RecordingResourceFileService implements RecordingResourceFilePort {
  public constructor(private readonly storage: StorageService) {}

  public async createUpload(
    identity: RecordingIdentity,
    recordingId: string,
    input: CreateRecordingResourceUploadInput,
  ): Promise<RecordingResourceUploadSessionResponse> {
    try {
      const session = await this.storage.createUploadSession(identity, {
        bucket: RECORDING_BUCKET,
        contentType: input.contentType,
        displayName: input.displayName,
        parentId: recordingId,
        parentType: parentType(input.kind),
        sizeBytes: input.sizeBytes,
      });
      return { ...session, uploadSessionId: session.id };
    } catch (error) {
      throw asAppError(error);
    }
  }

  public async prepareUpload(identity: RecordingIdentity, recordingId: string, uploadSessionId: string): Promise<PreparedRecordingResourceUpload> {
    try {
      return assertRecordingResourceSession(
        await this.storage.prepareUpload(identity, uploadSessionId),
        recordingId,
      );
    } catch (error) {
      throw asAppError(error);
    }
  }

  public async finalizeUpload(identity: RecordingIdentity, uploadSessionId: string): Promise<void> {
    try {
      assertRecordingResourceSession(await this.storage.confirmUpload(identity, uploadSessionId));
    } catch (error) {
      throw asAppError(error);
    }
  }

  public createReadUrl(objectPath: string): Promise<string> {
    return this.storage.createSignedReadUrl(RECORDING_BUCKET, objectPath, RECORDING_RESOURCE_READ_TTL_SECONDS);
  }
}
