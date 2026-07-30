import { describe, expect, it, vi } from 'vitest';

import type { SchoolDirectoryRepository } from '../src/db/repositories/school-directory.repository.js';
import type { SignupChallengeRepository } from '../src/db/repositories/signup-challenge.repository.js';
import { AppError } from '../src/lib/errors.js';
import { createAuthService } from '../src/services/auth.service.js';
import type { SupabaseAuthClient } from '../src/services/supabase-auth.service.js';
import type { OtpVerifier } from '../src/services/twilio-verify.service.js';

const studentDirectoryEntry = {
  displayName: 'Aarav Sharma',
  id: 'directory-entry-id',
  phoneE164: '+919876543210',
  role: 'student' as const,
  schoolId: 'school-id',
  studentClassId: 'class-id',
};

function createSchoolDirectory(): SchoolDirectoryRepository {
  return {
    findByPhone: vi.fn().mockResolvedValue(studentDirectoryEntry),
    findSignupProfileByPhone: vi.fn(),
    findIdentityByPhone: vi.fn(),
    findIdentityByUser: vi.fn(),
    linkAuthenticatedUser: vi.fn(),
  };
}

function createSignupChallenges(): SignupChallengeRepository {
  return {
    create: vi.fn(),
    findVerifiedByPhone: vi.fn().mockResolvedValue(true),
    markCompleted: vi.fn(),
    markVerified: vi.fn(),
  };
}

function createOtpVerifier(): OtpVerifier {
  return {
    check: vi.fn(),
    start: vi.fn(),
  };
}

function createSupabase(): SupabaseAuthClient & { deleteUser: ReturnType<typeof vi.fn> } {
  return {
    createConfirmedUser: vi.fn().mockResolvedValue({ userId: 'new-auth-user-id' }),
    deleteUser: vi.fn().mockResolvedValue(undefined),
    refreshSession: vi.fn(),
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
    updateUserPassword: vi.fn(),
  };
}

describe('AuthService.completeSignup', () => {
  // Catches removing compensation when a created auth user cannot be linked to the directory.
  it('compensates for a failed directory link while preserving the directory-access error', async () => {
    const schoolDirectory = createSchoolDirectory();
    const signupChallenges = createSignupChallenges();
    const supabase = createSupabase();
    vi.mocked(schoolDirectory.linkAuthenticatedUser).mockResolvedValue(null);
    const service = createAuthService({
      otp: createOtpVerifier(),
      schoolDirectory,
      signupChallenges,
      supabase,
    });

    await expect(service.completeSignup({
      interests: ['Reading', 'Art', 'Music', 'Sports', 'Coding'],
      mobile: '9876543210',
      password: 'ValidPassword1',
    })).rejects.toMatchObject({
      code: 'SCHOOL_DIRECTORY_ACCESS_DENIED',
      message: 'This number is not listed in your school\'s directory. Please contact your school administrator.',
      status: 403,
    } satisfies Partial<AppError>);

    expect(supabase.deleteUser).toHaveBeenCalledOnce();
    expect(supabase.deleteUser).toHaveBeenCalledWith({ userId: 'new-auth-user-id' });
    expect(supabase.signInWithPassword).not.toHaveBeenCalled();
    expect(signupChallenges.markCompleted).not.toHaveBeenCalled();
  });

  // Catches compensating after a directory link succeeds, which would delete the authenticated account.
  it('completes a verified student signup without deleting the linked auth user', async () => {
    const schoolDirectory = createSchoolDirectory();
    const signupChallenges = createSignupChallenges();
    const supabase = createSupabase();
    const user = {
      displayName: 'Aarav Sharma',
      nextOnboardingRoute: '/student/onboarding' as const,
      phoneE164: '+919876543210',
      role: 'student' as const,
      schoolId: 'school-id',
      userId: 'new-auth-user-id',
    };
    const session = {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      userId: 'new-auth-user-id',
    };
    vi.mocked(schoolDirectory.linkAuthenticatedUser).mockResolvedValue(user);
    vi.mocked(supabase.signInWithPassword).mockResolvedValue(session);
    const service = createAuthService({
      otp: createOtpVerifier(),
      schoolDirectory,
      signupChallenges,
      supabase,
    });

    await expect(service.completeSignup({
      interests: ['Reading', 'Art', 'Music', 'Sports', 'Coding'],
      mobile: '9876543210',
      password: 'ValidPassword1',
    })).resolves.toEqual({ session, user });

    expect(schoolDirectory.linkAuthenticatedUser).toHaveBeenCalledOnce();
    expect(signupChallenges.markCompleted).toHaveBeenCalledOnce();
    expect(supabase.signInWithPassword).toHaveBeenCalledOnce();
    expect(supabase.deleteUser).not.toHaveBeenCalled();
  });

  // Catches dropping compensation when directory linking throws instead of returning no user.
  it('compensates for a thrown directory link while rethrowing the original error', async () => {
    const schoolDirectory = createSchoolDirectory();
    const signupChallenges = createSignupChallenges();
    const supabase = createSupabase();
    const linkError = new AppError('INTERNAL_ERROR', 500, 'Directory link failed');
    vi.mocked(schoolDirectory.linkAuthenticatedUser).mockRejectedValue(linkError);
    const service = createAuthService({
      otp: createOtpVerifier(),
      schoolDirectory,
      signupChallenges,
      supabase,
    });

    await expect(service.completeSignup({
      interests: ['Reading', 'Art', 'Music', 'Sports', 'Coding'],
      mobile: '9876543210',
      password: 'ValidPassword1',
    })).rejects.toBe(linkError);

    expect(supabase.deleteUser).toHaveBeenCalledOnce();
    expect(supabase.deleteUser).toHaveBeenCalledWith({ userId: 'new-auth-user-id' });
    expect(supabase.signInWithPassword).not.toHaveBeenCalled();
    expect(signupChallenges.markCompleted).not.toHaveBeenCalled();
  });
});

const studentSignupProfile = {
  className: 'Class 10-A',
  displayName: 'Aarav Sharma',
  grade: '10',
  phoneE164: '+919876543210',
  role: 'student' as const,
  rollNumber: '14',
  schoolName: 'Supr School',
  section: 'A',
};

const teacherSignupProfile = {
  classTeacher: 'Class 9-B, Class 10-A',
  displayName: 'Meera Kapoor',
  employeeCode: 'T-042',
  phoneE164: '+919876543211',
  role: 'teacher' as const,
  schoolName: 'Supr School',
  subjects: ['Chemistry', 'Physics'],
};

describe('AuthService.getVerifiedSignupProfile', () => {
  // Catches reading school-directory data before the OTP challenge has been verified.
  it('rejects an unverified signup challenge without querying the directory preview', async () => {
    const schoolDirectory = createSchoolDirectory();
    const signupChallenges = createSignupChallenges();
    vi.mocked(signupChallenges.findVerifiedByPhone).mockResolvedValue(false);
    const service = createAuthService({
      schoolDirectory,
      signupChallenges,
      supabase: createSupabase(),
    });

    await expect(service.getVerifiedSignupProfile({ mobile: '9876543210' }))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 } satisfies Partial<AppError>);

    expect(schoolDirectory.findSignupProfileByPhone).not.toHaveBeenCalled();
  });

  // Catches exposing staff-only or Auth fields in a verified student preview.
  it('returns only the verified student directory preview', async () => {
    const schoolDirectory = createSchoolDirectory();
    vi.mocked(schoolDirectory.findSignupProfileByPhone).mockResolvedValue(studentSignupProfile);
    const service = createAuthService({
      schoolDirectory,
      signupChallenges: createSignupChallenges(),
      supabase: createSupabase(),
    });

    await expect(service.getVerifiedSignupProfile({ mobile: '9876543210' }))
      .resolves.toEqual(studentSignupProfile);
    expect(schoolDirectory.findSignupProfileByPhone).toHaveBeenCalledWith('+919876543210');
  });

  // Catches returning duplicate class or subject names from a verified teacher preview.
  it('returns the verified teacher preview with deduplicated assignments', async () => {
    const schoolDirectory = createSchoolDirectory();
    vi.mocked(schoolDirectory.findSignupProfileByPhone).mockResolvedValue(teacherSignupProfile);
    const service = createAuthService({
      schoolDirectory,
      signupChallenges: createSignupChallenges(),
      supabase: createSupabase(),
    });

    await expect(service.getVerifiedSignupProfile({ mobile: '9876543211' }))
      .resolves.toEqual(teacherSignupProfile);
  });

  // Catches turning a verified-but-unclaimed directory race into a distinguishable lookup result.
  it('uses the same invalid-credentials response when a verified challenge has no preview', async () => {
    const schoolDirectory = createSchoolDirectory();
    vi.mocked(schoolDirectory.findSignupProfileByPhone).mockResolvedValue(null);
    const service = createAuthService({
      schoolDirectory,
      signupChallenges: createSignupChallenges(),
      supabase: createSupabase(),
    });

    await expect(service.getVerifiedSignupProfile({ mobile: '9876543210' }))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 } satisfies Partial<AppError>);
  });
});
