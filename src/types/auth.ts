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

export interface SignupProfileInput {
  mobile: string;
}

interface SignupProfileBase {
  displayName: string;
  phoneE164: string;
  schoolName: string;
}

export interface StudentSignupProfilePreview extends SignupProfileBase {
  className: string | null;
  grade: string | null;
  role: 'student';
  rollNumber: string | null;
  section: string | null;
}

export interface TeacherSignupProfilePreview extends SignupProfileBase {
  classTeacher: string | null;
  employeeCode: string | null;
  role: 'teacher';
  subjects: string[];
}

export type SignupProfilePreview = StudentSignupProfilePreview | TeacherSignupProfilePreview;

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
