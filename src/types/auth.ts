import type { ProfileInterest } from './profile.js';

export type ClaimableRole = 'student' | 'teacher';
export type OnboardingRoute = '/student/onboarding' | '/teacher/onboarding';

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  userId: string;
}

export interface AppIdentity {
  userId: string;
  schoolId: string;
  role: ClaimableRole;
  displayName: string;
  phoneE164: string;
  nextOnboardingRoute: OnboardingRoute;
}

export interface SignupStartInput {
  mobile: string;
}

export interface SignupVerifyInput {
  mobile: string;
  otp: string;
}

export interface SignupCompleteInput {
  mobile: string;
  password: string;
  interests?: ProfileInterest[] | undefined;
}

export interface PasswordResetVerifyInput {
  mobile: string;
  otp: string;
}

export interface PasswordResetCompleteInput {
  mobile: string;
  newPassword: string;
}

export interface LoginInput {
  mobile: string;
  password: string;
}

export interface AuthenticatedResult {
  session: AuthSession;
  user: AppIdentity;
}
