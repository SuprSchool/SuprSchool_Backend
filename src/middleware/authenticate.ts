import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { NextFunction, Request, Response } from 'express';

import type { SchoolDirectoryRepository } from '../db/repositories/school-directory.repository.js';
import type { ApiErrorResponse } from '../types/api.js';
import { sendForbidden } from './authorize.js';

export interface VerifiedToken {
  userId: string;
}

export interface AuthenticatedRequestIdentity {
  userId: string;
  schoolId: string;
  role: 'student' | 'teacher';
}

export interface TokenVerifier {
  verify(token: string): Promise<VerifiedToken>;
}

export function createSupabaseTokenVerifier(supabaseUrl: string): TokenVerifier {
  const issuer = `${supabaseUrl}/auth/v1`;
  const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));

  return {
    async verify(token: string): Promise<VerifiedToken> {
      const { payload } = await jwtVerify(token, jwks, {
        audience: 'authenticated',
        issuer,
      });

      if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
        throw new Error('Supabase token is missing a subject');
      }

      return { userId: payload.sub };
    },
  };
}

function unauthorized(response: Response): void {
  const requestId = typeof response.locals.requestId === 'string'
    ? response.locals.requestId
    : 'unknown';

  const body: ApiErrorResponse = {
    error: {
      code: 'UNAUTHORIZED',
      message: 'A valid bearer token is required',
      requestId,
    },
  };
  response.status(401).json(body);
}

export type AuthenticationMiddleware = (
  request: Request,
  response: Response,
  next: NextFunction,
) => Promise<void>;

export function createAuthenticate(
  verifier: TokenVerifier,
  schoolDirectory: Pick<SchoolDirectoryRepository, 'findIdentityByUser'>,
): AuthenticationMiddleware {
  return async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    const authorization = request.header('authorization');
    if (!authorization?.startsWith('Bearer ')) {
      unauthorized(response);
      return;
    }

    let verified: VerifiedToken;
    try {
      verified = await verifier.verify(authorization.slice('Bearer '.length));
    } catch {
      unauthorized(response);
      return;
    }

    try {
      const identity = await schoolDirectory.findIdentityByUser(verified.userId);
      if (!identity) {
        sendForbidden(response);
        return;
      }

      request.auth = {
        role: identity.role,
        schoolId: identity.schoolId,
        userId: identity.userId,
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}
