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

export interface ChatMessageDto {
  id: string;
  roomId: string;
  clientMessageId: string;
  sender: ChatMessageSender;
  body: string;
  createdAt: string;
}

export interface ChatRoomSummary {
  id: string;
  classId: string;
  subjectId: string | null;
  kind: ChatRoomKind;
  name: string;
  lastMessage: ChatMessageDto | null;
  unreadCount: number;
}

export interface ChatRoomAccess {
  id: string;
  schoolId: string;
  classId: string;
  subjectId: string | null;
  kind: ChatRoomKind;
  userId: string;
}

export interface CreateChatMessageInput {
  clientMessageId: string;
  body: string;
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

export interface ChatMessagePage {
  items: readonly ChatMessageDto[];
  nextCursor?: ChatHistoryCursor;
}
