export const chatRoomKindValues = ['class', 'subject'] as const;

export type ChatRoomKind = (typeof chatRoomKindValues)[number];
export type ChatParticipantRole = 'student' | 'teacher';

export interface ChatIdentity {
  schoolId: string;
  userId: string;
  role: ChatParticipantRole;
}

export interface ChatMessageSender {
  id: string;
  displayName: string;
  role: ChatParticipantRole;
}

/**
 * A durable attachment row as the repository stores it. `objectPath` never
 * leaves the service layer — the service exchanges it for a short-lived signed
 * URL before the message reaches a client.
 */
export interface StoredChatAttachment {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  objectPath: string;
}

export interface ChatMessageAttachment {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  signedUrl: string;
  /**
   * When `signedUrl` stops working. A reader cannot tell a stale signature
   * from a live one by looking at it — the URL is well-formed either way and
   * opens the storage provider's error page — so the expiry travels with it.
   */
  expiresAt: string;
}

export interface StoredChatMessage {
  id: string;
  roomId: string;
  clientMessageId: string;
  sender: ChatMessageSender;
  body: string;
  createdAt: string;
  attachments: readonly StoredChatAttachment[];
}

export interface ChatMessageDto {
  id: string;
  roomId: string;
  clientMessageId: string;
  sender: ChatMessageSender;
  body: string;
  createdAt: string;
  attachments: readonly ChatMessageAttachment[];
}

interface ChatRoomSummaryBase {
  id: string;
  classId: string;
  subjectId: string | null;
  kind: ChatRoomKind;
  name: string;
  unreadCount: number;
}

export interface StoredChatRoomSummary extends ChatRoomSummaryBase {
  lastMessage: StoredChatMessage | null;
}

export interface ChatRoomSummary extends ChatRoomSummaryBase {
  lastMessage: ChatMessageDto | null;
}

export interface ChatRoomAccess {
  id: string;
  schoolId: string;
  classId: string;
  subjectId: string | null;
  kind: ChatRoomKind;
  userId: string;
}

/** What the wire accepts. `attachmentSessionId` names an upload session. */
export interface SendChatMessageInput {
  clientMessageId: string;
  body: string;
  attachmentSessionId?: string;
}

/**
 * What the repository commits. The upload session is already confirmed by the
 * time this exists, so a message can never reference an unconfirmed upload.
 */
export interface CreateChatMessageInput {
  clientMessageId: string;
  body: string;
  attachment?: ConfirmedChatAttachment;
}

export interface CreateChatAttachmentUploadInput {
  contentType: string;
  displayName: string;
  sizeBytes: number;
}

export interface ChatAttachmentUploadSession {
  id: string;
  signedUploadUrl: string;
  expiresAt: string;
}

export interface SignedChatAttachmentRead {
  signedUrl: string;
  expiresAt: string;
}

export interface ConfirmedChatAttachment {
  uploadSessionId: string;
  objectPath: string;
  displayName: string;
  contentType: string;
  sizeBytes: number;
}

export interface ChatHistoryCursor {
  createdAt: string;
  id: string;
}

export interface ChatCursorPage {
  before?: ChatHistoryCursor;
  after?: ChatHistoryCursor;
  limit: number;
}

export interface StoredChatMessagePage {
  items: readonly StoredChatMessage[];
  nextCursor?: ChatHistoryCursor;
}

export interface ChatMessagePage {
  items: readonly ChatMessageDto[];
  nextCursor?: ChatHistoryCursor;
}
