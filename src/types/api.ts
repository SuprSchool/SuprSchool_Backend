import type {
  AppIdentity,
  AuthenticatedResult,
  LoginInput,
  SignupCompleteInput,
  SignupStartInput,
  SignupVerifyInput,
} from './auth.js';

export interface ApiError { code: string; message: string; requestId: string; }
export interface ApiErrorResponse { error: ApiError; }
export interface HealthResponse { status: 'ok'; }
export type HealthRequest = undefined;
export interface SignupStartResponse { status: 'otp_sent'; }
export interface OtpVerifiedResponse { status: 'otp_verified'; }
export type SignupStartRequest = SignupStartInput;
export type SignupVerifyRequest = SignupVerifyInput;
export type SignupCompleteRequest = SignupCompleteInput;
export type LoginRequest = LoginInput;
export type SignupCompleteResponse = AuthenticatedResult;
export type LoginResponse = AuthenticatedResult;
export type MeResponse = AppIdentity;
export type MeRequest = undefined;
