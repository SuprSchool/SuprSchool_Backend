import type { ChatRepository } from '../../db/repositories/chat.repository.js';
import { AppError } from '../../lib/errors.js';
import type {
  ChatAttachmentUploadSession,
  ConfirmedChatAttachment,
  CreateChatAttachmentUploadInput,
  SignedChatAttachmentRead,
} from '../../types/chat.js';
import type { ChatAttachmentFilePort } from '../../services/chat.service.js';
import { academicFileContentTypes } from './academic-file-content-types.js';
import {
  type StorageService,
  UploadObjectMetadataMismatchError,
  UploadParentAuthorizationError,
  UploadSessionExpiredError,
  UploadSessionIneligibleError,
  UploadSessionNotFoundError,
  type UploadParentAuthorizer,
  type UploadSessionIdentity,
  type UploadSessionRecord,
} from './storage-service.js';

/**
 * Chat attachments ride the private academic bucket and its MIME allowlist
 * rather than opening a second upload path: one `upload_sessions` row, one
 * signed upload URL, one confirmation, exactly as announcements and exam
 * resources already do.
 */
const CHAT_ATTACHMENT_BUCKET = 'academic-files' as const;
const CHAT_ATTACHMENT_PARENT_TYPE = 'chat-attachment' as const;
const CHAT_ATTACHMENT_READ_TTL_SECONDS = 900;

function asAppError(error: unknown): unknown {
  if (error instanceof UploadParentAuthorizationError) {
    return new AppError('FORBIDDEN', 403, 'You cannot attach files to this chat room');
  }
  if (error instanceof UploadSessionNotFoundError) {
    return new AppError('NOT_FOUND', 404, 'Chat attachment upload session not found');
  }
  if (error instanceof UploadSessionExpiredError) {
    return new AppError('VALIDATION_ERROR', 400, 'Chat attachment upload session expired');
  }
  if (error instanceof UploadSessionIneligibleError) {
    return new AppError('VALIDATION_ERROR', 400, 'Chat attachment upload session is no longer eligible');
  }
  if (error instanceof UploadObjectMetadataMismatchError) {
    return new AppError('VALIDATION_ERROR', 400, 'Uploaded chat attachment does not match its approved session');
  }
  if (error instanceof RangeError) {
    return new AppError('VALIDATION_ERROR', 400, 'Chat attachments must be an allowed file type within the size limit');
  }
  return error;
}

function assertChatAttachmentSession(
  session: UploadSessionRecord,
  roomId: string,
): ConfirmedChatAttachment {
  if (
    session.bucket !== CHAT_ATTACHMENT_BUCKET
    || session.parentType !== CHAT_ATTACHMENT_PARENT_TYPE
    || session.displayName === null
    || session.parentId !== roomId
  ) {
    throw new AppError('VALIDATION_ERROR', 400, 'Upload session is not a chat attachment for this room');
  }
  return {
    contentType: session.contentType,
    displayName: session.displayName,
    objectPath: session.objectPath,
    sizeBytes: session.sizeBytes,
    uploadSessionId: session.id,
  };
}

/**
 * Guards the generic upload session against a room the caller cannot reach.
 * The port carries no role, so membership is resolved role-free: a room is
 * reachable by an active student of its class or its assigned teacher.
 */
export class ChatAttachmentUploadParentAuthorizer implements UploadParentAuthorizer {
  public constructor(
    private readonly chat: Pick<ChatRepository, 'canAccessRoom'>,
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
      request.bucket !== CHAT_ATTACHMENT_BUCKET
      || request.parentType !== CHAT_ATTACHMENT_PARENT_TYPE
    ) return false;
    return this.chat.canAccessRoom(
      { schoolId: request.schoolId, userId: request.userId },
      request.parentId,
    );
  }
}

export class ChatAttachmentFileService implements ChatAttachmentFilePort {
  public constructor(
    private readonly storage: StorageService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async createUpload(
    identity: UploadSessionIdentity,
    roomId: string,
    input: CreateChatAttachmentUploadInput,
  ): Promise<ChatAttachmentUploadSession> {
    if (!(academicFileContentTypes as readonly string[]).includes(input.contentType)) {
      throw new AppError('VALIDATION_ERROR', 400, 'Chat attachments must be an allowed file type');
    }
    try {
      const session = await this.storage.createUploadSession(identity, {
        bucket: CHAT_ATTACHMENT_BUCKET,
        contentType: input.contentType,
        displayName: input.displayName,
        parentId: roomId,
        parentType: CHAT_ATTACHMENT_PARENT_TYPE,
        sizeBytes: input.sizeBytes,
      });
      return {
        expiresAt: session.expiresAt,
        id: session.id,
        signedUploadUrl: session.signedUploadUrl,
      };
    } catch (error) {
      throw asAppError(error);
    }
  }

  /**
   * Confirms the session before its message is committed. `confirmUpload`
   * re-authorizes the parent and compares the stored object's real
   * content-type and size against the approved session, so a message can
   * never come to reference an upload that never landed.
   */
  public async confirmUpload(
    identity: UploadSessionIdentity,
    roomId: string,
    uploadSessionId: string,
  ): Promise<ConfirmedChatAttachment> {
    try {
      return assertChatAttachmentSession(
        await this.storage.confirmUpload(identity, uploadSessionId),
        roomId,
      );
    } catch (error) {
      throw asAppError(error);
    }
  }

  /**
   * Signs a read and says when that signature dies. The lifetime is this
   * service's own constant, so it is the only layer that can state the expiry
   * truthfully — a reader holding the URL has no way to tell.
   */
  public async createReadUrl(objectPath: string): Promise<SignedChatAttachmentRead> {
    const signedUrl = await this.storage.createSignedReadUrl(
      CHAT_ATTACHMENT_BUCKET,
      objectPath,
      CHAT_ATTACHMENT_READ_TTL_SECONDS,
    );
    return {
      expiresAt: new Date(this.now().getTime() + CHAT_ATTACHMENT_READ_TTL_SECONDS * 1_000).toISOString(),
      signedUrl,
    };
  }
}
