import { describe, expect, it, vi } from 'vitest';

import type { RecordingRepository } from '../src/db/repositories/recordings.repository.js';
import {
  RecordingResourceFileService,
  RecordingResourceUploadParentAuthorizer,
} from '../src/platform/storage/recording-resource-file-service.js';
import type { StorageService } from '../src/platform/storage/storage-service.js';
import type { RecordingResourceFilePort } from '../src/services/recordings.service.js';
import { createRecordingService } from '../src/services/recordings.service.js';
import type { RecordingStoragePort } from '../src/services/recordings.ports.js';

const schoolId = '11111111-1111-4111-8111-111111111111';
const teacherId = '22222222-2222-4222-8222-222222222222';
const studentId = '33333333-3333-4333-8333-333333333333';
const recordingId = '44444444-4444-4444-8444-444444444444';
const audioSessionId = '55555555-5555-4555-8555-555555555555';
const resourceSessionId = '66666666-6666-4666-8666-666666666666';

describe('recording Storage lifecycle', () => {
  it('returns signed banner and attachment reads only after the repository authorizes recording access', async () => {
    const bannerPath = `${schoolId}/recording-banner/${recordingId}/banner`;
    const attachmentPath = `${schoolId}/recording-resource/${recordingId}/notes`;
    const repository = {
      getStudentRecording: vi.fn().mockResolvedValue({
        classId: '77777777-7777-4777-8777-777777777777', createdAt: '2026-07-14T10:00:00.000Z',
        description: 'Keep this description', durationMs: 60_000, id: recordingId,
        publishedAt: '2026-07-14T10:01:00.000Z', sizeBytes: 1024, status: 'published',
        subjectId: '88888888-8888-4888-8888-888888888888', title: 'Lesson',
      }),
      listStudentResources: vi.fn().mockResolvedValue([
        { contentType: 'image/png', id: '99999999-9999-4999-8999-999999999999', kind: 'banner', name: 'banner.png', objectPath: bannerPath, sizeBytes: 10, sortOrder: 0 },
        { contentType: 'application/pdf', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', kind: 'attachment', name: 'notes.pdf', objectPath: attachmentPath, sizeBytes: 20, sortOrder: 0 },
      ]),
    } as unknown as RecordingRepository;
    const files = {
      createReadUrl: vi.fn(async (path: string) => `https://signed.example/${path}`),
      createUpload: vi.fn(), finalizeUpload: vi.fn(), prepareUpload: vi.fn(),
    } satisfies RecordingResourceFilePort;
    const service = createRecordingService({ files, repository, storage: {} as RecordingStoragePort });

    const detail = await service.getStudentRecording({ schoolId, userId: studentId }, recordingId);

    expect(detail.description).toBe('Keep this description');
    expect(detail.banner?.signedUrl).toContain('/recording-banner/');
    expect(detail.resources).toHaveLength(1);
    expect(detail.resources[0]?.signedUrl).toContain('/recording-resource/');
    expect(files.createReadUrl).toHaveBeenCalledTimes(2);
  });

  it('confirms stored m4a audio and a banner before serving student playback', async () => {
    const audioObjectPath = `${schoolId}/recording-audio/${recordingId}/${audioSessionId}`;
    const bannerObjectPath = `${schoolId}/recording-banner/${recordingId}/${resourceSessionId}`;
    const storedObjects = new Set<string>();
    const repository = {
      activateUploadSession: vi.fn(),
      confirmResourceUpload: vi.fn().mockResolvedValue({
        contentType: 'image/png', id: resourceSessionId, kind: 'banner',
        name: 'lesson-banner.png', sizeBytes: 512, sortOrder: 0,
      }),
      confirmUpload: vi.fn().mockResolvedValue('confirmed'),
      createDraft: vi.fn(),
      deleteRecording: vi.fn(),
      findEditableRecording: vi.fn().mockResolvedValue({ id: recordingId, schoolId }),
      findResourceEditableRecording: vi.fn().mockResolvedValue({ id: recordingId, schoolId }),
      findResourceForUpload: vi.fn(),
      findUploadSession: vi.fn().mockResolvedValue({
        expectedContentType: 'audio/mp4', expectedDurationMs: 1_000,
        expectedObjectPath: audioObjectPath, expectedSizeBytes: 4,
        id: audioSessionId, recordingId, status: 'pending',
      }),
      getPlaybackTarget: vi.fn().mockResolvedValue({ objectPath: audioObjectPath }),
      getProgress: vi.fn(),
      getStudentRecording: vi.fn(),
      issuePlaybackSession: vi.fn().mockResolvedValue({
        id: resourceSessionId, issuedAt: '2026-07-14T10:00:00.000Z',
      }),
      listStudentRecordings: vi.fn(),
      listTeacherRecordings: vi.fn(),
      publishRecording: vi.fn(),
      updateRecording: vi.fn(),
      releaseUploadReservation: vi.fn(),
      rejectUploadSession: vi.fn(),
      reserveUploadSession: vi.fn(),
      saveProgress: vi.fn(),
    } as unknown as RecordingRepository;
    const storage = {
      confirmTusAudioUpload: vi.fn(async () => {
        expect(storedObjects.has(audioObjectPath)).toBe(true);
        return {
          bitrateBps: 96_000, channels: 1, codec: 'aac-lc',
          contentType: 'audio/mp4', durationMs: 1_000,
          fileExtension: '.m4a', objectPath: audioObjectPath, sizeBytes: 4,
        };
      }),
      createSignedPlaybackUrl: vi.fn(async ({ objectPath }) => {
        expect(storedObjects.has(objectPath)).toBe(true);
        return {
          expiresAt: '2026-07-14T12:00:00.000Z',
          url: `https://storage.example.test/object/${objectPath}`,
        };
      }),
      createTusUploadSession: vi.fn(),
    } satisfies RecordingStoragePort;
    const files = {
      createReadUrl: vi.fn(),
      createUpload: vi.fn(),
      finalizeUpload: vi.fn(),
      prepareUpload: vi.fn().mockResolvedValue({
        contentType: 'image/png', displayName: 'lesson-banner.png', kind: 'banner',
        objectPath: bannerObjectPath, sizeBytes: 512, uploadSessionId: resourceSessionId,
      }),
    } satisfies RecordingResourceFilePort;
    const recordings = createRecordingService({ files, repository, storage });

    storedObjects.add(audioObjectPath);
    storedObjects.add(bannerObjectPath);
    await recordings.confirmUpload({ schoolId, userId: teacherId }, recordingId, audioSessionId);
    await recordings.confirmResourceUpload(
      { schoolId, userId: teacherId }, recordingId, resourceSessionId,
    );
    const playback = await recordings.getPlaybackUrl(
      { schoolId, userId: studentId }, recordingId,
    );

    expect(storedObjects.has(audioObjectPath)).toBe(true);
    expect(storedObjects.has(bannerObjectPath)).toBe(true);
    expect(playback.url).toContain('storage.example.test/object');
    expect(repository.confirmResourceUpload).toHaveBeenCalledOnce();
    expect(files.finalizeUpload).toHaveBeenCalledWith(
      { schoolId, userId: teacherId }, resourceSessionId,
    );
  });

  it('creates immutable recording resource paths and verifies metadata before confirmation', async () => {
    const objectPath = `${schoolId}/recording-banner/${recordingId}/${resourceSessionId}`;
    const createUploadSession = vi.fn().mockResolvedValue({
      expiresAt: '2026-07-14T12:00:00.000Z',
      id: resourceSessionId,
      objectPath,
      signedUploadUrl: 'https://storage.example.test/signed-upload/banner',
    });
    const prepareUpload = vi.fn().mockResolvedValue({
      bucket: 'recordings',
      confirmedSessionId: null,
      contentType: 'image/png',
      displayName: 'lesson-banner.png',
      expiresAt: '2026-07-14T12:00:00.000Z',
      id: resourceSessionId,
      objectPath,
      parentId: recordingId,
      parentType: 'recording-banner',
      schoolId,
      sizeBytes: 512,
      status: 'pending',
      userId: teacherId,
    });
    const confirmUpload = vi.fn().mockResolvedValue({
      ...(await prepareUpload()),
      confirmedSessionId: resourceSessionId,
      status: 'confirmed',
    });
    const files = new RecordingResourceFileService({
      confirmUpload,
      createSignedReadUrl: vi.fn(),
      createUploadSession,
      prepareUpload,
    } as unknown as StorageService);

    await expect(files.createUpload(
      { schoolId, userId: teacherId },
      recordingId,
      { contentType: 'image/png', displayName: 'lesson-banner.png', kind: 'banner', sizeBytes: 512 },
    )).resolves.toMatchObject({ uploadSessionId: resourceSessionId });
    await expect(files.prepareUpload(
      { schoolId, userId: teacherId }, recordingId, resourceSessionId,
    )).resolves.toMatchObject({ kind: 'banner', objectPath, uploadSessionId: resourceSessionId });
    await files.finalizeUpload({ schoolId, userId: teacherId }, resourceSessionId);

    expect(createUploadSession).toHaveBeenCalledWith(
      { schoolId, userId: teacherId },
      {
        bucket: 'recordings',
        contentType: 'image/png',
        displayName: 'lesson-banner.png',
        parentId: recordingId,
        parentType: 'recording-banner',
        sizeBytes: 512,
      },
    );
    expect(prepareUpload).toHaveBeenCalledBefore(confirmUpload);

    const findResourceEditableRecording = vi.fn().mockResolvedValue({ id: recordingId, schoolId });
    const authorizer = new RecordingResourceUploadParentAuthorizer({ findResourceEditableRecording });
    await expect(authorizer.authorize({
      action: 'confirm', bucket: 'recordings', parentId: recordingId,
      parentType: 'recording-resource', schoolId, userId: teacherId,
    })).resolves.toBe(true);
    expect(findResourceEditableRecording).toHaveBeenCalledWith({ schoolId, userId: teacherId }, recordingId);
  });
});
