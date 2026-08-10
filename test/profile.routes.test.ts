import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import type { AuthenticationMiddleware } from '../src/middleware/authenticate.js';
import { createProfileRouter } from '../src/routes/profile.routes.js';
import type { AvatarService } from '../src/services/avatar.service.js';
import type { ProfileService } from '../src/services/profile.service.js';

function createProfileService(): ProfileService {
  return {
    getProfile: vi.fn(),
    replaceInterests: vi.fn(),
    setPresetAvatar: vi.fn(),
  };
}

function createTestApp(service: ProfileService, avatarService?: AvatarService) {
  const app = express();
  const authenticate: AuthenticationMiddleware = async (
    request: Request,
    _response: Response,
    next,
  ): Promise<void> => {
    request.auth = { role: 'teacher', schoolId: 'school-1', userId: 'user-1' };
    next();
  };

  app.use(express.json());
  app.use('/v1/profile', createProfileRouter(service, authenticate, avatarService));
  app.use(errorHandler);
  return app;
}

function authenticateAsProfileOwner(): AuthenticationMiddleware {
  return async (request: Request, _response: Response, next): Promise<void> => {
    request.auth = { role: 'teacher', schoolId: 'school-1', userId: 'user-1' };
    next();
  };
}

describe('profile router', () => {
  it('mounts the authenticated profile API in the application', async () => {
    const profileService = createProfileService();
    vi.mocked(profileService.getProfile).mockResolvedValue({
      avatar: null,
      className: null,
      displayName: 'Aarav Sharma',
      id: 'user-1',
      interests: [],
      phoneE164: '+917755090948',
      schoolId: 'school-1',
      section: null,
    });

    await request(createApp({
      authenticate: authenticateAsProfileOwner(),
      profileService,
    }))
      .get('/v1/profile')
      .expect(200, {
        avatar: null,
        className: null,
        displayName: 'Aarav Sharma',
        id: 'user-1',
        interests: [],
        phoneE164: '+917755090948',
        schoolId: 'school-1',
        section: null,
      });
  });

  it('mounts avatar upload sessions in the authenticated application API', async () => {
    const profileService = createProfileService();
    const avatarService = {
      createUploadSession: vi.fn().mockResolvedValue({
        expiresAt: '2026-07-13T12:00:00.000Z',
        id: '33333333-3333-4333-8333-333333333333',
        objectPath: 'school/avatar/user/session',
        signedUploadUrl: 'https://storage.example.test/upload',
      }),
    } as unknown as AvatarService;

    await request(createApp({
      authenticate: authenticateAsProfileOwner(),
      avatarService,
      profileService,
    }))
      .post('/v1/profile/avatar/upload-sessions')
      .send({ contentType: 'image/jpeg', sizeBytes: 1024 })
      .expect(201);

    expect(avatarService.createUploadSession).toHaveBeenCalledWith(
      { schoolId: 'school-1', userId: 'user-1' },
      { contentType: 'image/jpeg', sizeBytes: 1024 },
    );
  });

  it('reads only the authenticated user profile', async () => {
    const profileService = createProfileService();
    vi.mocked(profileService.getProfile).mockResolvedValue({
      avatar: { kind: 'preset', value: 'avatar-1' },
      className: null,
      displayName: 'Aarav Sharma',
      id: 'user-1',
      interests: ['Reading', 'Coding'],
      phoneE164: '+917755090948',
      schoolId: 'school-1',
      section: null,
    });

    await request(createTestApp(profileService))
      .get('/v1/profile')
      .expect(200, {
        avatar: { kind: 'preset', value: 'avatar-1' },
        className: null,
        displayName: 'Aarav Sharma',
        id: 'user-1',
        interests: ['Reading', 'Coding'],
        phoneE164: '+917755090948',
        schoolId: 'school-1',
        section: null,
      });

    expect(profileService.getProfile).toHaveBeenCalledWith('user-1', 'school-1');
  });

  // 253:6842 renders "Class 9 • Section B" under the student's name, and the
  // announcements chip row bolds the same two values. Neither existed on the
  // contract before this slice, so the client omitted both.
  it('returns the enrolled class and section on the profile', async () => {
    const profileService = createProfileService();
    vi.mocked(profileService.getProfile).mockResolvedValue({
      avatar: null,
      className: 'Class 9th - B',
      displayName: 'Asha Menon',
      id: 'user-1',
      interests: [],
      phoneE164: '+917755090948',
      schoolId: 'school-1',
      section: 'B',
    });

    const response = await request(createTestApp(profileService))
      .get('/v1/profile')
      .expect(200);

    expect(response.body.className).toBe('Class 9th - B');
    expect(response.body.section).toBe('B');
    expect(profileService.getProfile).toHaveBeenCalledWith('user-1', 'school-1');
  });

  it('publishes a null class and section for a user with no student enrolment', async () => {
    const profileService = createProfileService();
    vi.mocked(profileService.getProfile).mockResolvedValue({
      avatar: null,
      className: null,
      displayName: 'Meera Iyer',
      id: 'user-1',
      interests: [],
      phoneE164: '+917755090948',
      schoolId: 'school-1',
      section: null,
    });

    const response = await request(createTestApp(profileService))
      .get('/v1/profile')
      .expect(200);

    expect(response.body.className).toBeNull();
    expect(response.body.section).toBeNull();
  });

  it('replaces only the authenticated teacher interests', async () => {
    const profileService = createProfileService();
    vi.mocked(profileService.replaceInterests).mockResolvedValue(undefined);

    await request(createTestApp(profileService))
      .put('/v1/profile/interests')
      .send({ interests: ['Reading', 'Coding'] })
      .expect(204);

    expect(profileService.replaceInterests).toHaveBeenCalledWith(
      'user-1',
      ['Reading', 'Coding'],
    );
  });

  it('sets an approved preset only for the authenticated user', async () => {
    const profileService = createProfileService();
    vi.mocked(profileService.setPresetAvatar).mockResolvedValue({
      kind: 'preset',
      value: 'avatar-teacher',
    });

    await request(createTestApp(profileService))
      .post('/v1/profile/avatar/preset')
      .send({ presetId: 'avatar-teacher' })
      .expect(200, {
        avatar: { kind: 'preset', value: 'avatar-teacher' },
      });

    expect(profileService.setPresetAvatar).toHaveBeenCalledWith('user-1', 'avatar-teacher');
  });

  it('rejects an arbitrary avatar path before changing the authenticated profile', async () => {
    const profileService = createProfileService();

    await request(createTestApp(profileService))
      .post('/v1/profile/avatar/preset')
      .send({ presetId: '../../other-user/avatar.png' })
      .expect(400);

    expect(profileService.setPresetAvatar).not.toHaveBeenCalled();
  });

  it('rejects duplicate interests before changing the authenticated profile', async () => {
    const profileService = createProfileService();

    await request(createTestApp(profileService))
      .put('/v1/profile/interests')
      .send({ interests: ['Reading', 'Reading'] })
      .expect(400);

    expect(profileService.replaceInterests).not.toHaveBeenCalled();
  });

  it('creates an owner-bound private avatar upload session', async () => {
    const profileService = createProfileService();
    const avatarService = {
      createUploadSession: vi.fn().mockResolvedValue({
        expiresAt: '2026-07-13T12:00:00.000Z',
        id: '33333333-3333-4333-8333-333333333333',
        objectPath: 'school/avatar/user/session',
        signedUploadUrl: 'https://storage.example.test/upload',
      }),
    } as unknown as AvatarService;

    await request(createTestApp(profileService, avatarService))
      .post('/v1/profile/avatar/upload-sessions')
      .send({ contentType: 'image/png', sizeBytes: 1024 })
      .expect(201, {
        expiresAt: '2026-07-13T12:00:00.000Z',
        id: '33333333-3333-4333-8333-333333333333',
        objectPath: 'school/avatar/user/session',
        signedUploadUrl: 'https://storage.example.test/upload',
      });

    expect(avatarService.createUploadSession).toHaveBeenCalledWith(
      { schoolId: 'school-1', userId: 'user-1' },
      { contentType: 'image/png', sizeBytes: 1024 },
    );
  });

  it('confirms an avatar upload only for the authenticated owner', async () => {
    const profileService = createProfileService();
    const avatarService = {
      confirmUpload: vi.fn().mockResolvedValue({
        avatar: { kind: 'upload', value: 'school/avatar/user/session' },
        previousUploadedPath: undefined,
      }),
    } as unknown as AvatarService;

    await request(createTestApp(profileService, avatarService))
      .post('/v1/profile/avatar/upload-sessions/33333333-3333-4333-8333-333333333333/confirm')
      .expect(200, {
        avatar: { kind: 'upload', value: 'school/avatar/user/session' },
      });

    expect(avatarService.confirmUpload).toHaveBeenCalledWith(
      { schoolId: 'school-1', userId: 'user-1' },
      '33333333-3333-4333-8333-333333333333',
    );
  });
});
