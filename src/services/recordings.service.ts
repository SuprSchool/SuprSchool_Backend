import { randomUUID } from 'node:crypto';

import type {
  ConfirmRecordingUploadInput,
  RecordingRepository,
  StoredRecordingResource,
} from '../db/repositories/recordings.repository.js';
import { AppError } from '../lib/errors.js';
import type {
  CreateRecordingDraftInput,
  CreateRecordingResourceUploadInput,
  CreateRecordingUploadSessionInput,
  ListRecordingsInput,
  PlaybackUrlResponse,
  RecordingDeletionResult,
  RecordingDetailResponse,
  RecordingIdentity,
  RecordingListResponse,
  RecordingProgress,
  RecordingProgressResponse,
  RecordingPublicationResult,
  RecordingResource,
  RecordingResourceUploadSessionResponse,
  RecordingSummary,
  RecordingResourceRead,
  RecordingUploadSessionResponse,
  SaveRecordingProgressInput,
  TeacherRecordingListInput,
  TeacherRecordingDetailResponse,
  UpdateRecordingInput,
} from '../types/recordings.js';
import {
  MAX_RECORDING_AUDIO_BYTES,
  MAX_RECORDING_DURATION_MS,
  PLAYBACK_URL_TTL_SECONDS,
  UPLOAD_RESERVATION_TTL_SECONDS,
  RECORDING_AUDIO_CONTENT_TYPE,
} from '../types/recordings.js';
import type { RecordingAudioMetadata, RecordingStoragePort } from './recordings.ports.js';

export interface RecordingService {
  confirmResourceUpload(identity: RecordingIdentity, recordingId: string, uploadSessionId: string): Promise<RecordingResource>;
  confirmUpload(identity: RecordingIdentity, recordingId: string, uploadSessionId: string): Promise<void>;
  createDraft(identity: RecordingIdentity, input: CreateRecordingDraftInput): Promise<RecordingSummary>;
  deleteRecording(identity: RecordingIdentity, recordingId: string): Promise<RecordingDeletionResult>;
  deleteResource(identity: RecordingIdentity, recordingId: string, resourceId: string): Promise<{ id: string }>;
  getPlaybackUrl(identity: RecordingIdentity, recordingId: string): Promise<PlaybackUrlResponse>;
  getProgress(identity: RecordingIdentity, recordingId: string): Promise<RecordingProgress | undefined>;
  getStudentRecording(identity: RecordingIdentity, recordingId: string): Promise<RecordingDetailResponse>;
  getTeacherRecording(identity: RecordingIdentity, recordingId: string): Promise<TeacherRecordingDetailResponse>;
  listStudentRecordings(identity: RecordingIdentity, input: ListRecordingsInput): Promise<RecordingListResponse>;
  listTeacherRecordings(identity: RecordingIdentity, input: TeacherRecordingListInput): Promise<RecordingListResponse>;
  publishRecording(identity: RecordingIdentity, recordingId: string): Promise<RecordingPublicationResult>;
  requestResourceUploadSession(identity: RecordingIdentity, recordingId: string, input: CreateRecordingResourceUploadInput): Promise<RecordingResourceUploadSessionResponse>;
  requestUploadSession(identity: RecordingIdentity, recordingId: string, input: CreateRecordingUploadSessionInput): Promise<RecordingUploadSessionResponse>;
  saveProgress(identity: RecordingIdentity, recordingId: string, input: SaveRecordingProgressInput): Promise<RecordingProgressResponse>;
  updateRecording(identity: RecordingIdentity, recordingId: string, input: UpdateRecordingInput): Promise<RecordingSummary>;
}

export interface PreparedRecordingResourceUpload {
  contentType: CreateRecordingResourceUploadInput['contentType'];
  displayName: string;
  kind: CreateRecordingResourceUploadInput['kind'];
  objectPath: string;
  sizeBytes: number;
  uploadSessionId: string;
}

export interface RecordingResourceFilePort {
  createUpload(identity: RecordingIdentity, recordingId: string, input: CreateRecordingResourceUploadInput): Promise<RecordingResourceUploadSessionResponse>;
  createReadUrl(objectPath: string): Promise<string>;
  finalizeUpload(identity: RecordingIdentity, uploadSessionId: string): Promise<void>;
  prepareUpload(identity: RecordingIdentity, recordingId: string, uploadSessionId: string): Promise<PreparedRecordingResourceUpload>;
}

/**
 * "Which period was this subject scheduled in, right now?", answered by the
 * schedule repository so the timetable has one owner. Narrowed to the single
 * question recordings asks of it.
 */
export interface RecordingPeriodPort {
  findClassPeriodLabel(
    teacherId: string,
    schoolId: string,
    classId: string,
    subjectId: string,
  ): Promise<string | null>;
}

export interface RecordingServiceDependencies {
  createId?: () => string;
  files?: RecordingResourceFilePort;
  periods?: RecordingPeriodPort;
  repository: RecordingRepository;
  storage: RecordingStoragePort;
}

/** An unwired timetable leaves the period unknown, which is null — never a guess. */
const unknownRecordingPeriod: RecordingPeriodPort = {
  async findClassPeriodLabel() { return null; },
};

const unavailableRecordingResourceFiles: RecordingResourceFilePort = {
  async createReadUrl() { throw new Error('Recording resource Storage is not configured'); },
  async createUpload() { throw new Error('Recording resource Storage is not configured'); },
  async finalizeUpload() { throw new Error('Recording resource Storage is not configured'); },
  async prepareUpload() { throw new Error('Recording resource Storage is not configured'); },
};

const RECORDING_AUDIO_TARGET_BITRATE_BPS = 96_000;
const RECORDING_AUDIO_BITRATE_TOLERANCE_BPS = 6_400;

function assertAudioInput(input: CreateRecordingUploadSessionInput): void {
  if (
    input.contentType !== RECORDING_AUDIO_CONTENT_TYPE
    || input.sizeBytes > MAX_RECORDING_AUDIO_BYTES
    || input.durationMs > MAX_RECORDING_DURATION_MS
  ) {
    throw new AppError('VALIDATION_ERROR', 400, 'Only paid-tier AAC-LC .m4a recordings within the allowed limits can be uploaded');
  }
}

type ApprovedRecordingAudioMetadata = RecordingAudioMetadata & {
  channels: 1;
  codec: 'aac-lc';
  contentType: 'audio/mp4';
};

function isApprovedRecordingAudio(
  metadata: RecordingAudioMetadata,
  expectedObjectPath: string,
): metadata is ApprovedRecordingAudioMetadata {
  return metadata.objectPath === expectedObjectPath
    && metadata.fileExtension === '.m4a'
    && metadata.contentType === RECORDING_AUDIO_CONTENT_TYPE
    && metadata.codec === 'aac-lc'
    && metadata.channels === 1
    && Math.abs(metadata.bitrateBps - RECORDING_AUDIO_TARGET_BITRATE_BPS)
      <= RECORDING_AUDIO_BITRATE_TOLERANCE_BPS
    && metadata.durationMs >= 1
    && metadata.durationMs <= MAX_RECORDING_DURATION_MS
    && metadata.sizeBytes >= 1
    && metadata.sizeBytes <= MAX_RECORDING_AUDIO_BYTES;
}

function toConfirmInput(
  recordingId: string,
  uploadSessionId: string,
  metadata: ApprovedRecordingAudioMetadata,
): ConfirmRecordingUploadInput {
  return {
    // AAC encoders report the measured stream average, which legitimately
    // varies around the selected 96 kbps profile. Persist the profile value
    // after the measured bitrate has passed the bounded acceptance check.
    bitrateBps: RECORDING_AUDIO_TARGET_BITRATE_BPS,
    channels: metadata.channels,
    codec: metadata.codec,
    contentType: metadata.contentType,
    durationMs: metadata.durationMs,
    objectPath: metadata.objectPath,
    recordingId,
    sizeBytes: metadata.sizeBytes,
    uploadSessionId,
  };
}

export function createRecordingService({
  createId = randomUUID,
  files = unavailableRecordingResourceFiles,
  periods = unknownRecordingPeriod,
  repository,
  storage,
}: RecordingServiceDependencies): RecordingService {
  async function signResources(resources: StoredRecordingResource[]): Promise<RecordingResourceRead[]> {
    return Promise.all(resources.map(async ({ objectPath, ...resource }) => ({
      ...resource,
      signedUrl: await files.createReadUrl(objectPath),
    })));
  }

  function splitResources(resources: RecordingResourceRead[]): {
    banner: RecordingResourceRead | null;
    resources: RecordingResourceRead[];
  } {
    return {
      banner: resources.find((resource) => resource.kind === 'banner') ?? null,
      resources: resources.filter((resource) => resource.kind === 'attachment'),
    };
  }

  return {
    // Resolved once, here, and stored: a recording is subtitled with the period
    // it happened in, so a later timetable edit must not retitle it. The
    // recording's own subject is part of the question — the same class/subject
    // pair the insert below authorizes — so a subject recorded outside its own
    // slot is out-of-timetable and stores null rather than borrowing the
    // ordinal of whatever else the teacher was scheduled for.
    async createDraft(identity, input) {
      const period = await periods.findClassPeriodLabel(
        identity.userId,
        identity.schoolId,
        input.classId,
        input.subjectId,
      );
      return repository.createDraft(identity, { ...input, period });
    },
    listTeacherRecordings: (identity, input) => repository.listTeacherRecordings(identity, input),
    listStudentRecordings: (identity, input) => repository.listStudentRecordings(identity, input),
    publishRecording: (identity, recordingId) => repository.publishRecording(identity, recordingId),
    deleteRecording: (identity, recordingId) => repository.deleteRecording(identity, recordingId),
    async deleteResource(identity, recordingId, resourceId) {
      const result = await repository.deleteResource(identity, recordingId, resourceId);
      if (!result) throw new AppError('FORBIDDEN', 403, 'You cannot delete this recording resource');
      return result;
    },
    updateRecording: (identity, recordingId, input) => repository.updateRecording(identity, recordingId, input),
    async requestResourceUploadSession(identity, recordingId, input) {
      const recording = await repository.findResourceEditableRecording(identity, recordingId);
      if (!recording) {
        throw new AppError('FORBIDDEN', 403, 'You cannot upload resources for this recording');
      }
      return files.createUpload(identity, recording.id, input);
    },
    async confirmResourceUpload(identity, recordingId, uploadSessionId) {
      const existing = await repository.findResourceForUpload(identity, recordingId, uploadSessionId);
      if (existing) {
        await files.finalizeUpload(identity, uploadSessionId);
        return existing;
      }
      const prepared = await files.prepareUpload(identity, recordingId, uploadSessionId);
      const resource = await repository.confirmResourceUpload(identity, {
        contentType: prepared.contentType,
        displayName: prepared.displayName,
        kind: prepared.kind,
        objectPath: prepared.objectPath,
        recordingId,
        sizeBytes: prepared.sizeBytes,
        uploadSessionId: prepared.uploadSessionId,
      });
      await files.finalizeUpload(identity, uploadSessionId);
      return resource;
    },
    async requestUploadSession(identity, recordingId, input) {
      assertAudioInput(input);
      const recording = await repository.findEditableRecording(identity, recordingId);
      if (!recording) {
        throw new AppError('FORBIDDEN', 403, 'You cannot upload audio for this recording');
      }
      const uploadSessionId = createId();
      const objectPath = `${identity.schoolId}/recording-audio/${recording.id}/${uploadSessionId}`;
      const reservationExpiresAt = new Date(
        Date.now() + UPLOAD_RESERVATION_TTL_SECONDS * 1_000,
      ).toISOString();

      await repository.reserveUploadSession(identity, {
        expectedContentType: RECORDING_AUDIO_CONTENT_TYPE,
        expectedDurationMs: input.durationMs,
        expectedSizeBytes: input.sizeBytes,
        objectPath,
        recordingId: recording.id,
        reservationExpiresAt,
        uploadSessionId,
      });

      let storageSession: { expiresAt: string; tus: RecordingUploadSessionResponse['tus'] };
      try {
        storageSession = await storage.createTusUploadSession({
          contentType: RECORDING_AUDIO_CONTENT_TYPE,
          objectPath,
          sizeBytes: input.sizeBytes,
          uploadSessionId,
        });
      } catch (error) {
        await repository.releaseUploadReservation(identity, recording.id, uploadSessionId);
        throw error;
      }

      try {
        await repository.activateUploadSession(identity, {
          expiresAt: storageSession.expiresAt,
          recordingId: recording.id,
          uploadSessionId,
        });
      } catch (error) {
        await repository.releaseUploadReservation(identity, recording.id, uploadSessionId);
        throw error;
      }

      return {
        expiresAt: storageSession.expiresAt,
        objectPath,
        protocol: 'tus',
        uploadSessionId,
        tus: storageSession.tus,
      };
    },
    async confirmUpload(identity, recordingId, uploadSessionId) {
      const session = await repository.findUploadSession(identity, recordingId, uploadSessionId);
      if (!session) {
        throw new AppError('FORBIDDEN', 403, 'This upload session is not available');
      }
      if (session.status === 'confirmed') return;
      if (session.status !== 'pending') {
        throw new AppError('VALIDATION_ERROR', 400, 'This upload session has not been activated');
      }
      const metadata = await storage.confirmTusAudioUpload({
        expectedObjectPath: session.expectedObjectPath,
        uploadSessionId,
      });
      if (!isApprovedRecordingAudio(metadata, session.expectedObjectPath)) {
        await repository.rejectUploadSession(identity, recordingId, uploadSessionId);
        throw new AppError('VALIDATION_ERROR', 400, 'Uploaded audio does not match its approved recording session');
      }
      await repository.confirmUpload(identity, toConfirmInput(recordingId, uploadSessionId, metadata));
    },
    async getStudentRecording(identity, recordingId) {
      const recording = await repository.getStudentRecording(identity, recordingId);
      if (!recording) throw new AppError('FORBIDDEN', 403, 'You do not have access to this recording');
      return {
        ...recording,
        ...splitResources(await signResources(await repository.listStudentResources(identity, recordingId))),
      };
    },
    async getTeacherRecording(identity, recordingId) {
      const recording = await repository.getTeacherRecording(identity, recordingId);
      if (!recording) throw new AppError('FORBIDDEN', 403, 'You cannot access this recording');
      const [resources, playbackTarget] = await Promise.all([
        repository.listTeacherResources(identity, recordingId),
        repository.getTeacherPlaybackTarget(identity, recordingId),
      ]);
      const preview = playbackTarget
        ? await storage.createSignedPlaybackUrl({
            expiresInSeconds: PLAYBACK_URL_TTL_SECONDS,
            objectPath: playbackTarget.objectPath,
          })
        : undefined;
      return {
        ...recording,
        ...splitResources(await signResources(resources)),
        previewExpiresAt: preview?.expiresAt ?? null,
        previewUrl: preview?.url ?? null,
      };
    },
    async getPlaybackUrl(identity, recordingId) {
      const target = await repository.getPlaybackTarget(identity, recordingId);
      if (!target) throw new AppError('FORBIDDEN', 403, 'You do not have access to this recording');
      const signed = await storage.createSignedPlaybackUrl({ expiresInSeconds: PLAYBACK_URL_TTL_SECONDS, objectPath: target.objectPath });
      const session = await repository.issuePlaybackSession(identity, recordingId, signed.expiresAt);
      if (!session) throw new AppError('FORBIDDEN', 403, 'You do not have access to this recording');
      return { ...signed, playbackSessionId: session.id, sessionStartedAt: session.issuedAt };
    },
    async getProgress(identity, recordingId) {
      return repository.getProgress(identity, recordingId);
    },
    async saveProgress(identity, recordingId, input) {
      const result = await repository.saveProgress(identity, recordingId, input);
      if (!result) throw new AppError('FORBIDDEN', 403, 'You do not have access to this recording');
      return result;
    },
  };
}
