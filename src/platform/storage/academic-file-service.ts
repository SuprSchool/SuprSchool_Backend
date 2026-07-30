import type { AnnouncementsRepository } from '../../db/repositories/announcements.repository.js';
import type { AssignmentsRepository } from '../../db/repositories/assignments.repository.js';
import type { ExamsRepository } from '../../db/repositories/exams.repository.js';
import type { EventsRepository } from '../../db/repositories/events.repository.js';
import type { UploadSessionIdentity } from './storage-service.js';
import type { UploadSessionRecord } from './storage-service.js';
import {
  type CreatedUploadSession,
  type UploadSessionRequest,
} from './upload-session.js';
import {
  type StorageService,
  type UploadParentAuthorizer,
} from './storage-service.js';

export const ACADEMIC_FILE_BUCKET = 'academic-files' as const;
export const ACADEMIC_READ_URL_LIFETIME_SECONDS = 900;

export type AcademicFileParentType =
  | 'announcement-resource'
  | 'assignment-resource'
  | 'assignment-submission'
  | 'exam-resource'
  | 'event-resource';

export interface AcademicFileCreateInput extends UploadSessionRequest {
  bucket: typeof ACADEMIC_FILE_BUCKET;
  displayName: string;
  parentType: AcademicFileParentType;
}

export interface AcademicFileConfirmationInput {
  parentId: string;
  parentType: AcademicFileParentType;
  uploadSessionId: string;
}

export interface ConfirmedAcademicFile {
  contentType: string;
  displayName: string;
  id: string;
  objectPath: string;
}

export interface AcademicParentRepositories {
  announcements: Pick<AnnouncementsRepository, 'canManage'>;
  assignments: Pick<AssignmentsRepository, 'canAccessSubmission' | 'canManage'>;
  events: Pick<EventsRepository, 'canManage'>;
  exams: Pick<ExamsRepository, 'canManageAssessment'>;
}

export class AcademicUploadParentAuthorizer implements UploadParentAuthorizer {
  public constructor(private readonly repositories: AcademicParentRepositories) {}

  public async authorize(request: {
    action: 'create' | 'confirm';
    bucket: string;
    parentId: string;
    parentType: string;
    schoolId: string;
    userId: string;
  }): Promise<boolean> {
    if (request.bucket !== ACADEMIC_FILE_BUCKET) return false;
    const identity = { schoolId: request.schoolId, userId: request.userId };
    switch (request.parentType) {
      case 'announcement-resource':
        return this.repositories.announcements.canManage(identity, request.parentId);
      case 'assignment-resource':
        return this.repositories.assignments.canManage(identity, request.parentId);
      case 'assignment-submission':
        return this.repositories.assignments.canAccessSubmission(identity, request.parentId);
      case 'exam-resource':
        return this.repositories.exams.canManageAssessment(identity, request.parentId);
      case 'event-resource':
        return this.repositories.events.canManage(identity, request.parentId);
      default:
        return false;
    }
  }
}

export class AcademicFileService {
  public constructor(private readonly storage: StorageService) {}

  public async deleteObject(
    bucket: typeof ACADEMIC_FILE_BUCKET,
    objectPath: string,
  ): Promise<void> {
    if (bucket !== ACADEMIC_FILE_BUCKET) throw new RangeError('Academic files must use the private bucket');
    await this.storage.deleteObjectIfExists(bucket, objectPath);
  }

  public async createUpload(
    identity: UploadSessionIdentity,
    input: AcademicFileCreateInput,
  ): Promise<CreatedUploadSession> {
    assertAcademicInput(input);
    return this.storage.createUploadSession(identity, input);
  }


  public async prepareUpload(
    identity: UploadSessionIdentity,
    input: AcademicFileConfirmationInput,
  ): Promise<ConfirmedAcademicFile> {
    const prepared = await this.storage.prepareUpload(identity, input.uploadSessionId);
    return this.confirmedAcademicFile(prepared, input);
  }

  public async finalizeUpload(
    identity: UploadSessionIdentity,
    uploadSessionId: string,
  ): Promise<void> {
    const confirmed = await this.storage.confirmUpload(identity, uploadSessionId);
    assertAcademicSession(confirmed);
  }

  public async confirmUpload(
    identity: UploadSessionIdentity,
    uploadSessionId: string,
  ): Promise<ConfirmedAcademicFile>;
  public async confirmUpload(
    identity: UploadSessionIdentity,
    input: AcademicFileConfirmationInput,
  ): Promise<ConfirmedAcademicFile>;
  public async confirmUpload(
    identity: UploadSessionIdentity,
    input: string | AcademicFileConfirmationInput,
  ): Promise<ConfirmedAcademicFile> {
    const sessionId = typeof input === 'string' ? input : input.uploadSessionId;
    const confirmed = await this.storage.confirmUpload(identity, sessionId);
    return this.confirmedAcademicFile(confirmed, typeof input === "string" ? undefined : input);
  }


  private confirmedAcademicFile(
    confirmed: UploadSessionRecord,
    expected: AcademicFileConfirmationInput | undefined,
  ): ConfirmedAcademicFile {
    assertAcademicSession(confirmed);
    if (expected !== undefined && (
      confirmed.parentId !== expected.parentId || confirmed.parentType !== expected.parentType
    )) {
      throw new Error("Upload session parent does not match the academic resource");
    }
    return {
      contentType: confirmed.contentType,
      displayName: confirmed.displayName,
      id: confirmed.id,
      objectPath: confirmed.objectPath,
    };
  }

  public async createReadUrl(
    bucket: typeof ACADEMIC_FILE_BUCKET,
    objectPath: string,
    expiresInSeconds = ACADEMIC_READ_URL_LIFETIME_SECONDS,
  ): Promise<string> {
    if (bucket !== ACADEMIC_FILE_BUCKET || expiresInSeconds !== ACADEMIC_READ_URL_LIFETIME_SECONDS) {
      throw new RangeError('Academic file reads must use the private bucket and a 900-second lifetime');
    }
    return this.storage.createSignedReadUrl(bucket, objectPath, expiresInSeconds);
  }
}

function assertAcademicInput(input: AcademicFileCreateInput): void {
  if (
    input.bucket !== ACADEMIC_FILE_BUCKET
    || !isAcademicParentType(input.parentType)
    || input.displayName.trim().length === 0
    || input.displayName.length > 255
  ) {
    throw new RangeError('Invalid academic file upload input');
  }
}

function assertAcademicSession(session: UploadSessionRecord): asserts session is UploadSessionRecord & {
  bucket: typeof ACADEMIC_FILE_BUCKET;
  displayName: string;
  parentType: AcademicFileParentType;
} {
  if (
    session.bucket !== ACADEMIC_FILE_BUCKET
    || session.displayName === null
    || !isAcademicParentType(session.parentType)
  ) {
    throw new Error('Upload session is not an academic file');
  }
}

function isAcademicParentType(value: string): value is AcademicFileParentType {
  return value === 'announcement-resource'
    || value === 'assignment-resource'
    || value === 'assignment-submission'
    || value === 'exam-resource'
    || value === 'event-resource';
}
