import type { SchoolDirectoryRepository } from '../db/repositories/school-directory.repository.js';
import type { ContactAdminRepository } from '../db/repositories/contact-admin.repository.js';
import type { PasswordResetChallengeRepository } from '../db/repositories/password-reset-challenge.repository.js';
import type { SignupChallengeRepository } from '../db/repositories/signup-challenge.repository.js';
import { AppError } from '../lib/errors.js';
import type {
  AuthenticatedResult,
  AuthSession,
  LoginInput,
  PasswordResetCompleteInput,
  PasswordResetVerifyInput,
  SignupCompleteInput,
  SignupStartInput,
  SignupVerifyInput,
} from '../types/auth.js';
import { MIN_SIGNUP_INTERESTS } from '../types/profile.js';
import { normalizeIndianPhone } from './phone.service.js';
import type { SupabaseAuthClient } from './supabase-auth.service.js';
import type { OtpVerifier } from './twilio-verify.service.js';

export interface AuthServiceDependencies {
  schoolDirectory: SchoolDirectoryRepository;
  supabase: SupabaseAuthClient;
  otp?: OtpVerifier;
  contactAdmin?: ContactAdminRepository;
  signupChallenges?: SignupChallengeRepository;
  passwordResetChallenges?: PasswordResetChallengeRepository;
}

export interface AuthService {
  startSignup(input: SignupStartInput): Promise<void>;
  verifySignup(input: SignupVerifyInput): Promise<void>;
  completeSignup(input: SignupCompleteInput): Promise<AuthenticatedResult>;
  login(input: LoginInput): Promise<AuthenticatedResult>;
  getMe(userId: string): Promise<AuthenticatedResult['user']>;
  startPasswordReset(input: { mobile: string }): Promise<void>;
  verifyPasswordReset(input: PasswordResetVerifyInput): Promise<void>;
  completePasswordReset(input: PasswordResetCompleteInput): Promise<void>;
  refresh(input: { refreshToken: string }): Promise<AuthSession>;
  logout(input: { accessToken: string }): Promise<void>;
  submitContactAdmin(input: { mobile: string; message: string; role?: 'student' | 'teacher' }): Promise<void>;
}

function assertPassword(password: string): void {
  if (password.length < 8) {
    throw new AppError('VALIDATION_ERROR', 400, 'Password must be at least 8 characters');
  }
}

function assertOtp(otp: string): void {
  if (!/^\d{4}$/.test(otp)) {
    throw new AppError('VALIDATION_ERROR', 400, 'Enter the four-digit verification code');
  }
}

function unavailable(): never {
  throw new AppError('INTERNAL_ERROR', 503, 'Phone verification is temporarily unavailable');
}

function invalidOtp(): never {
  throw new AppError('INVALID_CREDENTIALS', 401, 'The verification code is invalid or expired');
}

export function createAuthService({
  schoolDirectory, supabase, otp: otpVerifier, contactAdmin, signupChallenges, passwordResetChallenges,
}: AuthServiceDependencies): AuthService {
  return {
    async startSignup({ mobile }): Promise<void> {
      if (!otpVerifier || !signupChallenges) unavailable();
      const phoneE164 = normalizeIndianPhone(mobile);
      const existingIdentity = await schoolDirectory.findIdentityByPhone(phoneE164);
      if (existingIdentity) {
        throw new AppError('CONFLICT', 409, 'An account already exists for this mobile number. Please log in.');
      }
      const directoryEntry = await schoolDirectory.findByPhone(phoneE164);
      if (!directoryEntry) {
        throw new AppError('SCHOOL_DIRECTORY_ACCESS_DENIED', 403, 'This number is not listed in your school\'s directory. Please contact your school administrator.');
      }
      await signupChallenges.create({ phoneE164 });
      await otpVerifier.start({ phone: phoneE164, purpose: 'signup' });
    },

    async verifySignup({ mobile, otp }): Promise<void> {
      if (!otpVerifier || !signupChallenges) unavailable();
      assertOtp(otp);
      const phoneE164 = normalizeIndianPhone(mobile);
      const directoryEntry = await schoolDirectory.findByPhone(phoneE164);
      if (!directoryEntry) {
        throw new AppError('SCHOOL_DIRECTORY_ACCESS_DENIED', 403, 'This number is not listed in your school\'s directory. Please contact your school administrator.');
      }
      const verification = await otpVerifier.check({ code: otp, phone: phoneE164, purpose: 'signup' });
      if (!verification.approved) invalidOtp();
      await signupChallenges.markVerified(phoneE164);
    },

    async completeSignup({ mobile, password, interests }): Promise<AuthenticatedResult> {
      if (!signupChallenges) unavailable();
      assertPassword(password);
      const phoneE164 = normalizeIndianPhone(mobile);
      const directoryEntry = await schoolDirectory.findByPhone(phoneE164);
      if (!directoryEntry) {
        throw new AppError('SCHOOL_DIRECTORY_ACCESS_DENIED', 403, 'This number is not listed in your school\'s directory. Please contact your school administrator.');
      }
      if (directoryEntry.role === 'student' && (!interests || interests.length < MIN_SIGNUP_INTERESTS)) {
        throw new AppError('VALIDATION_ERROR', 400, 'Select at least five interests to complete student signup');
      }
      if (!await signupChallenges.findVerifiedByPhone(phoneE164)) invalidOtp();
      const created = await supabase.createConfirmedUser({ phone: phoneE164, password });
      const user = await schoolDirectory.linkAuthenticatedUser(
        directoryEntry.id,
        created.userId,
        interests,
      );
      if (!user) {
        throw new AppError('SCHOOL_DIRECTORY_ACCESS_DENIED', 403, 'This number is not listed in your school\'s directory. Please contact your school administrator.');
      }
      await signupChallenges.markCompleted(phoneE164);
      const session = await supabase.signInWithPassword({ phone: phoneE164, password });
      return { session, user };
    },

    async login({ mobile, password }): Promise<AuthenticatedResult> {
      assertPassword(password);
      const phoneE164 = normalizeIndianPhone(mobile);
      const session = await supabase.signInWithPassword({ phone: phoneE164, password });
      const user = await schoolDirectory.findIdentityByUser(session.userId);
      if (!user) {
        throw new AppError('INVALID_CREDENTIALS', 401, 'Invalid mobile number, password or role');
      }
      return { session, user };
    },

    async getMe(userId) {
      const user = await schoolDirectory.findIdentityByUser(userId);
      if (!user) throw new AppError('UNAUTHORIZED', 401, 'This account does not have the requested active role');
      return user;
    },

    async startPasswordReset({ mobile }): Promise<void> {
      if (!otpVerifier) unavailable();
      const phone = normalizeIndianPhone(mobile);
      const identity = await schoolDirectory.findIdentityByPhone(phone);
      if (!identity) return;
      await otpVerifier.start({ phone, purpose: 'password_reset' });
    },

    async verifyPasswordReset({ mobile, otp }): Promise<void> {
      if (!otpVerifier || !passwordResetChallenges) unavailable();
      assertOtp(otp);
      const phone = normalizeIndianPhone(mobile);
      const identity = await schoolDirectory.findIdentityByPhone(phone);
      if (!identity) invalidOtp();
      const verification = await otpVerifier.check({ code: otp, phone, purpose: 'password_reset' });
      if (!verification.approved) invalidOtp();
      await passwordResetChallenges.createVerified({ phoneE164: phone, userId: identity.userId });
    },

    async completePasswordReset({ mobile, newPassword }): Promise<void> {
      if (!passwordResetChallenges) unavailable();
      assertPassword(newPassword);
      const phone = normalizeIndianPhone(mobile);
      const challenge = await passwordResetChallenges.findVerifiedByPhone(phone);
      if (!challenge) invalidOtp();
      await supabase.updateUserPassword({ password: newPassword, userId: challenge.userId });
      await passwordResetChallenges.markCompleted(phone);
    },

    async refresh({ refreshToken }): Promise<AuthSession> {
      return supabase.refreshSession({ refreshToken });
    },
    async logout({ accessToken }): Promise<void> {
      await supabase.signOut({ accessToken });
    },
    async submitContactAdmin({ mobile, message, role }): Promise<void> {
      if (!contactAdmin) throw new AppError('INTERNAL_ERROR', 503, 'Contact requests are temporarily unavailable');
      await contactAdmin.create({ message, phoneE164: normalizeIndianPhone(mobile), ...(role ? { requestedRole: role } : {}) });
    },
  };
}
