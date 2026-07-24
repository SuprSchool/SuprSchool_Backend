export const RECORDING_AUDIO_CONTENT_TYPE = 'audio/mp4';
export const MAX_RECORDING_AUDIO_BYTES = 128 * 1024 * 1024;
export const MAX_RECORDING_DURATION_MS = 120 * 60 * 1_000;
export const PLAYBACK_URL_TTL_SECONDS = 7_200;
export const UPLOAD_RESERVATION_TTL_SECONDS = 300;
export const MAX_RECORDING_RESOURCES = 10;
export const MAX_RECORDING_RESOURCE_BYTES = 25 * 1024 * 1024;
export const RECORDING_RESOURCE_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

export type RecordingStatus = 'draft' | 'published' | 'deleted';
export type RecordingResourceContentType = typeof RECORDING_RESOURCE_CONTENT_TYPES[number];
export type RecordingResourceKind = 'attachment' | 'banner';

export interface RecordingIdentity {
  schoolId: string;
  userId: string;
}

export interface RecordingSummary {
  classId: string;
  createdAt: string;
  durationMs: number | null;
  id: string;
  publishedAt: string | null;
  status: Exclude<RecordingStatus, 'deleted'>;
  subjectId: string;
  title: string;
  description?: string | null;
  resourceCount?: number;
}

export interface RecordingDetail extends RecordingSummary {
  description: string | null;
  sizeBytes: number | null;
}

export interface RecordingListResponse {
  items: RecordingSummary[];
  nextCursor: string | null;
}

export interface CreateRecordingDraftInput {
  classId: string;
  description?: string | undefined;
  subjectId: string;
  title: string;
}

export interface UpdateRecordingInput {
  description: string | null;
  title: string;
}

export interface RecordingTusUploadTarget {
  endpoint: string;
  headers: { 'x-signature': string };
}

export interface CreateRecordingUploadSessionInput {
  contentType: typeof RECORDING_AUDIO_CONTENT_TYPE;
  durationMs: number;
  sizeBytes: number;
}

export interface RecordingUploadSessionResponse {
  expiresAt: string;
  objectPath: string;
  protocol: 'tus';
  uploadSessionId: string;
  tus: RecordingTusUploadTarget;
}

export interface CreateRecordingResourceUploadInput {
  contentType: RecordingResourceContentType;
  displayName: string;
  kind: RecordingResourceKind;
  sizeBytes: number;
}

export interface RecordingResourceUploadSessionResponse {
  expiresAt: string;
  objectPath: string;
  signedUploadUrl: string;
  uploadSessionId: string;
}

export interface RecordingResource {
  contentType: RecordingResourceContentType;
  id: string;
  kind: RecordingResourceKind;
  name: string;
  sizeBytes: number;
  sortOrder: number;
}

export interface RecordingResourceRead extends RecordingResource {
  signedUrl: string;
}

export interface RecordingDetailResponse extends RecordingDetail {
  banner: RecordingResourceRead | null;
  resources: RecordingResourceRead[];
}

export interface TeacherRecordingDetailResponse extends RecordingDetailResponse {
  previewExpiresAt: string | null;
  previewUrl: string | null;
}

export interface PlaybackUrlResponse {
  expiresAt: string;
  playbackSessionId: string;
  sessionStartedAt: string;
  url: string;
}

export interface RecordingProgress {
  completedAt: string | null;
  positionMs: number;
  recordingId: string;
  updatedAt: string;
}

export interface RecordingProgressResponse extends RecordingProgress {
  accepted: boolean;
}

export interface SaveRecordingProgressInput {
  clientSequence: number;
  completed: boolean;
  playbackSessionId: string;
  positionMs: number;
}

export interface RecordingCursor {
  id: string;
  publishedAt: string;
}

export interface ListRecordingsInput {
  cursor?: RecordingCursor | undefined;
  limit: number;
  subjectId?: string | undefined;
}

export interface TeacherRecordingListInput {
  classId: string;
  cursor?: RecordingCursor | undefined;
  limit: number;
  subjectId?: string | undefined;
}

export interface RecordingPublicationResult extends RecordingSummary {
  eventKey: string;
}

export interface RecordingDeletionResult {
  deletedAt: string;
  id: string;
}
