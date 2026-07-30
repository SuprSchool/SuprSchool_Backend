import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import type { SchoolDirectoryRepository } from '../src/db/repositories/school-directory.repository.js';
import { AppError } from '../src/lib/errors.js';
import { createAuthenticate, type TokenVerifier } from '../src/middleware/authenticate.js';
import type { AuthService } from '../src/services/auth.service.js';

type AuthServiceMock = AuthService;

function createAuthService(): AuthServiceMock {
  return {
    getMe: vi.fn(),
    getVerifiedSignupProfile: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
    startSignup: vi.fn(),
    startPasswordReset: vi.fn(),
    verifyPasswordReset: vi.fn(),
    completePasswordReset: vi.fn(),
    completeSignup: vi.fn(),
    submitContactAdmin: vi.fn(),
    verifySignup: vi.fn(),
  };
}

function createSchoolDirectory(
  findIdentityByUser: SchoolDirectoryRepository['findIdentityByUser'],
): Pick<SchoolDirectoryRepository, 'findIdentityByUser'> {
  return { findIdentityByUser };
}

describe('POST /v1/auth/signup/start', () => {
  it('accepts the client mobile-only pre-password signup request', async () => {
    const authService = createAuthService();
    vi.mocked(authService.startSignup).mockResolvedValue(undefined);

    const response = await request(createApp({ authService }))
      .post('/v1/auth/signup/start')
      .send({ mobile: '9876543210' });

    expect(response.status).toBe(202);
    expect(authService.startSignup).toHaveBeenCalledWith({ mobile: '9876543210' });
  });

  it('returns the stable eligibility error for an unmatched signup phone', async () => {
    const authService = createAuthService();
    vi.mocked(authService.startSignup).mockRejectedValue(
      new AppError(
        'SCHOOL_DIRECTORY_ACCESS_DENIED',
        403,
        'This number is not listed in your school\'s directory. Please contact your school administrator.',
      ),
    );

    const response = await request(createApp({ authService }))
      .post('/v1/auth/signup/start')
      .send({
        mobile: '9876543210',
      });

    expect(response.status).toBe(403);
    expect(response.body.error).toMatchObject({
      code: 'SCHOOL_DIRECTORY_ACCESS_DENIED',
      requestId: expect.any(String),
    });
  });

  it('rate limits repeated signup starts from the same client', async () => {
    const authService = createAuthService();
    vi.mocked(authService.startSignup).mockResolvedValue(undefined);
    const app = createApp({ authService });
    const body = { mobile: '9876543210' };

    for (let count = 0; count < 5; count += 1) {
      const response = await request(app).post('/v1/auth/signup/start').send(body);
      expect(response.status).toBe(202);
    }

    const limited = await request(app).post('/v1/auth/signup/start').send(body);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('GET /v1/auth/me', () => {
  it('loads the student identity derived from the verified bearer token', async () => {
    const authService = createAuthService();
    vi.mocked(authService.getMe).mockResolvedValue({
      displayName: 'Asha Student',
      phoneE164: '+919876543210',
      role: 'student',
      nextOnboardingRoute: '/student/onboarding',
      schoolId: 'school-1',
      userId: 'user-1',
    });
    const verifier: TokenVerifier = {
      verify: vi.fn().mockResolvedValue({ userId: 'user-1' }),
    };
    const schoolDirectory = createSchoolDirectory(vi.fn().mockResolvedValue({
      displayName: 'Asha Student',
      nextOnboardingRoute: '/student/onboarding',
      phoneE164: '+919876543210',
      role: 'student',
      schoolId: 'school-1',
      userId: 'user-1',
    }));

    const response = await request(
      createApp({
        authService,
        authenticate: createAuthenticate(verifier, schoolDirectory),
      }),
    )
      .get('/v1/auth/me')
      .set('authorization', 'Bearer access-token');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      role: 'student',
      schoolId: 'school-1',
      userId: 'user-1',
    });
    expect(authService.getMe).toHaveBeenCalledWith('user-1');
  });

  it('returns the teacher onboarding route from the server-derived identity', async () => {
    const authService = createAuthService();
    vi.mocked(authService.getMe).mockResolvedValue({
      displayName: 'Tejas Teacher',
      phoneE164: '+919876543211',
      role: 'teacher',
      schoolId: 'school-1',
      userId: 'user-2',
      nextOnboardingRoute: '/teacher/onboarding',
    });
    const verifier: TokenVerifier = {
      verify: vi.fn().mockResolvedValue({ userId: 'user-2' }),
    };
    const schoolDirectory = createSchoolDirectory(vi.fn().mockResolvedValue({
      displayName: 'Tejas Teacher',
      nextOnboardingRoute: '/teacher/onboarding',
      phoneE164: '+919876543211',
      role: 'teacher',
      schoolId: 'school-1',
      userId: 'user-2',
    }));

    const response = await request(
      createApp({ authService, authenticate: createAuthenticate(verifier, schoolDirectory) }),
    )
      .get('/v1/auth/me')
      .set('authorization', 'Bearer access-token');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      role: 'teacher',
      nextOnboardingRoute: '/teacher/onboarding',
    });
    expect(authService.getMe).toHaveBeenCalledWith('user-2');
  });
});

describe('POST /v1/auth/signup/verify', () => {
  it('accepts a four-digit OTP', async () => {
    const authService = createAuthService();
    vi.mocked(authService.verifySignup).mockResolvedValue(undefined);

    const response = await request(createApp({ authService }))
      .post('/v1/auth/signup/verify')
      .send({ mobile: '9876543210', otp: '1234' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'otp_verified' });
  });
});

describe('POST /v1/auth/signup/complete', () => {
  const authenticatedResult = {
    session: {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      userId: 'user-1',
    },
    user: {
      displayName: 'Asha Student',
      nextOnboardingRoute: '/student/onboarding' as const,
      phoneE164: '+919876543210',
      role: 'student' as const,
      schoolId: 'school-1',
      userId: 'user-1',
    },
  };

  it('accepts five unique student interests at signup completion', async () => {
    const authService = createAuthService();
    vi.mocked(authService.completeSignup).mockResolvedValue(authenticatedResult);
    const interests = ['Reading', 'Art', 'Music', 'Sports', 'Coding'];

    const response = await request(createApp({ authService }))
      .post('/v1/auth/signup/complete')
      .send({
        mobile: '9876543210',
        password: 'ValidPassword1',
        interests,
      });

    expect(response.status).toBe(201);
    expect(authService.completeSignup).toHaveBeenCalledWith({
      mobile: '9876543210',
      password: 'ValidPassword1',
      interests,
    });
  });

  it.each([
    ['noncanonical', ['Reading', 'Art', 'Music', 'Sports', 'Dancing']],
    ['duplicate', ['Reading', 'Art', 'Music', 'Sports', 'Reading']],
    ['fewer than five', ['Reading', 'Art', 'Music', 'Sports']],
  ])('rejects %s signup interests', async (_reason, interests) => {
    const authService = createAuthService();

    const response = await request(createApp({ authService }))
      .post('/v1/auth/signup/complete')
      .send({
        mobile: '9876543210',
        password: 'ValidPassword1',
        interests,
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(authService.completeSignup).not.toHaveBeenCalled();
  });
});

describe('auth request validation', () => {
  it.each([
    ['/v1/auth/signup/start', { mobile: '9876543210', password: 'ValidPassword1', role: 'student' }],
    ['/v1/auth/signup/verify', { mobile: '9876543210', otp: '1234', role: 'student' }],
    ['/v1/auth/login', { mobile: '9876543210', password: 'ValidPassword1', role: 'student' }],
  ])('rejects a client-provided role for %s', async (path, body) => {
    const response = await request(createApp({ authService: createAuthService() }))
      .post(path)
      .send(body);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects malformed JSON without exposing the request body', async () => {
    const malformedBody = '{"mobile":';
    const response = await request(createApp({ authService: createAuthService() }))
      .post('/v1/auth/login')
      .set('content-type', 'application/json')
      .send(malformedBody);

    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Invalid request',
      requestId: expect.any(String),
    });
    expect(JSON.stringify(response.body)).not.toContain(malformedBody);
  });
});

describe('Phase 1 session routes', () => {
  it('starts a password-reset challenge without changing the frontend contract', async () => {
    const authService = createAuthService();
    vi.mocked(authService.startPasswordReset).mockResolvedValue(undefined);

    const response = await request(createApp({ authService }))
      .post('/v1/auth/password/reset/start')
      .send({ mobile: '9876543210' });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ status: 'otp_sent' });
  });

  it('verifies a password-reset OTP before the client submits the new password', async () => {
    const authService = createAuthService();
    vi.mocked(authService.verifyPasswordReset).mockResolvedValue(undefined);

    const response = await request(createApp({ authService }))
      .post('/v1/auth/password/reset/verify')
      .send({ mobile: '9876543210', otp: '1234' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'otp_verified' });
    expect(authService.verifyPasswordReset).toHaveBeenCalledWith({ mobile: '9876543210', otp: '1234' });
  });

  it('sets a new password only after the server-held OTP verification', async () => {
    const authService = createAuthService();
    vi.mocked(authService.completePasswordReset).mockResolvedValue(undefined);

    const response = await request(createApp({ authService }))
      .post('/v1/auth/password/reset/complete')
      .send({ mobile: '9876543210', newPassword: 'NewPassword1' });

    expect(response.status).toBe(204);
    expect(authService.completePasswordReset).toHaveBeenCalledWith({
      mobile: '9876543210', newPassword: 'NewPassword1',
    });
  });
});

describe('POST /v1/auth/signup/profile', () => {
  const studentPreview = {
    className: 'Class 10-A',
    displayName: 'Asha Student',
    grade: '10',
    phoneE164: '+919876543210',
    role: 'student' as const,
    rollNumber: '14',
    schoolName: 'Supr School',
    section: 'A',
  };

  it('forwards the literal mobile-only request to the verified signup profile service', async () => {
    const authService = createAuthService();
    vi.mocked(authService.getVerifiedSignupProfile).mockResolvedValue(studentPreview);

    const response = await request(createApp({ authService }))
      .post('/v1/auth/signup/profile')
      .send({ mobile: '9876543210' });

    expect(response.status).toBe(200);
    expect(authService.getVerifiedSignupProfile).toHaveBeenCalledWith({ mobile: '9876543210' });
  });

  it('rejects a client-provided role before the directory preview is requested', async () => {
    const authService = createAuthService();

    const response = await request(createApp({ authService }))
      .post('/v1/auth/signup/profile')
      .send({ mobile: '9876543210', role: 'teacher' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(authService.getVerifiedSignupProfile).not.toHaveBeenCalled();
  });

  it('returns the typed role-specific preview without Auth or challenge fields', async () => {
    const authService = createAuthService();
    const teacherPreview = {
      classTeacher: 'Class 9-B, Class 10-A',
      displayName: 'Meera Kapoor',
      employeeCode: 'T-042',
      phoneE164: '+919876543211',
      role: 'teacher' as const,
      schoolName: 'Supr School',
      subjects: ['Chemistry', 'Physics'],
    };
    vi.mocked(authService.getVerifiedSignupProfile).mockResolvedValue(teacherPreview);

    const response = await request(createApp({ authService }))
      .post('/v1/auth/signup/profile')
      .send({ mobile: '9876543211' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(teacherPreview);
  });
});
