import type { Request, Response } from 'express';

import { AppError } from '../lib/errors.js';
import {
  contactAdminSchema,
  loginSchema,
  passwordResetCompleteSchema,
  passwordResetStartSchema,
  passwordResetVerifySchema,
  refreshSchema,
  signupCompleteSchema,
  signupProfileSchema,
  signupStartSchema,
  signupVerifySchema,
} from '../validators/auth.schemas.js';
import type { AuthService } from '../services/auth.service.js';
import type { LoginRequest, LoginResponse, MeResponse, SignupCompleteRequest, SignupCompleteResponse, SignupProfileRequest, SignupProfileResponse, SignupStartRequest, SignupStartResponse, SignupVerifyRequest } from '../types/api.js';

export interface AuthController {
  startSignup(request: Request, response: Response): Promise<void>;
  verifySignup(request: Request, response: Response): Promise<void>;
  getVerifiedSignupProfile(request: Request, response: Response): Promise<void>;
  completeSignup(request: Request, response: Response): Promise<void>;
  login(request: Request, response: Response): Promise<void>;
  getMe(request: Request, response: Response): Promise<void>;
  startPasswordReset(request: Request, response: Response): Promise<void>;
  verifyPasswordReset(request: Request, response: Response): Promise<void>;
  completePasswordReset(request: Request, response: Response): Promise<void>;
  refresh(request: Request, response: Response): Promise<void>;
  logout(request: Request, response: Response): Promise<void>;
  submitContactAdmin(request: Request, response: Response): Promise<void>;
}

export function createAuthController(authService: AuthService): AuthController {
  return {
    startSignup: async (request, response) => {
      const input: SignupStartRequest = signupStartSchema.parse(request.body);
      await authService.startSignup(input);
      const body: SignupStartResponse = { status: 'otp_sent' };
      response.status(202).json(body);
    },
    verifySignup: async (request, response) => {
      const input: SignupVerifyRequest = signupVerifySchema.parse(request.body);
      await authService.verifySignup(input);
      response.status(200).json({ status: 'otp_verified' });
    },
    getVerifiedSignupProfile: async (request, response) => {
      const input: SignupProfileRequest = signupProfileSchema.parse(request.body);
      const body: SignupProfileResponse = await authService.getVerifiedSignupProfile(input);
      response.status(200).json(body);
    },
    completeSignup: async (request, response) => {
      const input: SignupCompleteRequest = signupCompleteSchema.parse(request.body);
      const body: SignupCompleteResponse = await authService.completeSignup(input);
      response.status(201).json(body);
    },
    login: async (request, response) => {
      const input: LoginRequest = loginSchema.parse(request.body);
      const body: LoginResponse = await authService.login(input);
      response.status(200).json(body);
    },
    getMe: async (request, response) => {
      if (!request.auth) throw new AppError('UNAUTHORIZED', 401, 'A valid bearer token is required');
      const body: MeResponse = await authService.getMe(request.auth.userId);
      response.status(200).json(body);
    },
    startPasswordReset: async (request, response) => {
      await authService.startPasswordReset(passwordResetStartSchema.parse(request.body));
      response.status(202).json({ status: 'otp_sent' });
    },
    verifyPasswordReset: async (request, response) => {
      await authService.verifyPasswordReset(passwordResetVerifySchema.parse(request.body));
      response.status(200).json({ status: 'otp_verified' });
    },
    completePasswordReset: async (request, response) => {
      await authService.completePasswordReset(passwordResetCompleteSchema.parse(request.body));
      response.status(204).end();
    },
    refresh: async (request, response) => {
      const body = await authService.refresh(refreshSchema.parse(request.body));
      response.status(200).json({ session: body });
    },
    logout: async (request, response) => {
      const authorization = request.header('authorization');
      const match = authorization?.match(/^Bearer\s+(.+)$/i);
      if (!match?.[1]) throw new AppError('UNAUTHORIZED', 401, 'A valid bearer token is required');
      await authService.logout({ accessToken: match[1] });
      response.status(204).end();
    },
    submitContactAdmin: async (request, response) => {
      const input = contactAdminSchema.parse(request.body);
      await authService.submitContactAdmin({ message: input.message, mobile: input.mobile, ...(input.role ? { role: input.role } : {}) });
      response.status(202).json({ status: 'submitted' });
    },
  };
}
