import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp, type AppDependencies } from '../src/app.js';
import type { IdempotencyStore } from '../src/platform/idempotency/idempotency-store.js';
import type { DiaryService } from '../src/services/diary.service.js';
import type { EventsService } from '../src/services/events.service.js';
import type { RecordingService } from '../src/services/recordings.service.js';

const classId = '11111111-1111-4111-8111-111111111111';
const schoolId = '22222222-2222-4222-8222-222222222222';
const subjectId = '33333333-3333-4333-8333-333333333333';
const userId = '44444444-4444-4444-8444-444444444444';

function createDiaryService(): DiaryService {
  return {
    create: vi.fn(),
    deleteEntry: vi.fn(),
    listForStudent: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    listForTeacher: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    update: vi.fn(),
  };
}

function createEventsService(): EventsService {
  return {
    archiveEvent: vi.fn(),
    createEvent: vi.fn(),
    createManagedTeam: vi.fn(),
    createTeam: vi.fn(),
    confirmResourceUpload: vi.fn(),
    deleteResource: vi.fn(),
    deleteTeam: vi.fn(),
    getStudentEvent: vi.fn(),
    getStudentResults: vi.fn(),
    getStudentTeam: vi.fn(),
    getTeacherEvent: vi.fn(),
    getTeacherResults: vi.fn(),
    listStudentParticipants: vi.fn(),
    listStudentTeams: vi.fn(),
    listParticipants: vi.fn(),
    listClassOptions: vi.fn(),
    listMemberOptions: vi.fn(),
    listStudentEvents: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    listTeacherEvents: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    listTeams: vi.fn(),
    publishResults: vi.fn(),
    requestResourceUploadSession: vi.fn(),
    recoverCreatedStudentTeam: vi.fn(),
    recoverCreatedManagedTeam: vi.fn(),
    registerStudent: vi.fn(),
    recoverCreatedEvent: vi.fn(),
    recoverUpdatedEvent: vi.fn(),
    tagParticipation: vi.fn(),
    replaceManagingTeam: vi.fn(),
    replaceTeams: vi.fn(),
    replaceTeamMembers: vi.fn(),
    updateEvent: vi.fn(),
    writeScores: vi.fn(),
  };
}

function createRecordingService(): RecordingService {
  return {
    confirmResourceUpload: vi.fn(),
    confirmUpload: vi.fn(),
    createDraft: vi.fn(),
    deleteRecording: vi.fn(),
    deleteResource: vi.fn(),
    getPlaybackUrl: vi.fn(),
    getProgress: vi.fn(),
    getStudentRecording: vi.fn(),
    getTeacherRecording: vi.fn(),
    listStudentRecordings: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    listTeacherRecordings: vi.fn(),
    publishRecording: vi.fn(),
    updateRecording: vi.fn(),
    requestResourceUploadSession: vi.fn(),
    requestUploadSession: vi.fn(),
    saveProgress: vi.fn(),
  };
}

async function authenticate(
  requestValue: Request,
  _response: Response,
  next: NextFunction,
): Promise<void> {
  const role = requestValue.header('x-test-role');
  if (role !== 'student' && role !== 'teacher') {
    throw new Error('A supported test role is required');
  }
  requestValue.auth = { role, schoolId, userId };
  next();
}

describe('Phase 3 runtime integration', () => {
  it('mounts each authenticated Phase 3 route exactly once under /v1', async () => {
    const diaryService = createDiaryService();
    const eventsService = createEventsService();
    const recordingsService = createRecordingService();
    const dependencies: AppDependencies = {
      authenticate,
      diaryService,
      eventMetadataIdempotency: {} as IdempotencyStore,
      eventsService,
      recordingsService,
    };
    const app = createApp(dependencies);

    await request(app)
      .get(`/v1/student/subjects/${subjectId}/diary`)
      .set('x-test-role', 'student')
      .expect(200, { items: [], nextCursor: null });
    await request(app)
      .get(`/v1/teacher/classes/${classId}/diary`)
      .set('x-test-role', 'teacher')
      .expect(200, { items: [], nextCursor: null });
    await request(app)
      .get('/v1/student/events')
      .set('x-test-role', 'student')
      .expect(200, { items: [], nextCursor: null });
    await request(app)
      .get('/v1/teacher/events')
      .set('x-test-role', 'teacher')
      .expect(200, { items: [], nextCursor: null });
    await request(app)
      .get('/v1/student/recordings')
      .set('x-test-role', 'student')
      .expect(200, { items: [], nextCursor: null });

    expect(diaryService.listForStudent).toHaveBeenCalledTimes(1);
    expect(diaryService.listForTeacher).toHaveBeenCalledTimes(1);
    expect(eventsService.listStudentEvents).toHaveBeenCalledTimes(1);
    expect(eventsService.listTeacherEvents).toHaveBeenCalledTimes(1);
    expect(recordingsService.listStudentRecordings).toHaveBeenCalledTimes(1);
  });
});
