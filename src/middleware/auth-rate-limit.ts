import { rateLimit } from 'express-rate-limit';
import type { Request, Response } from 'express';

import type { ApiErrorResponse } from '../types/api.js';

export function createSignupStartLimiter() {
  return rateLimit({
    windowMs: 60_000,
    limit: 5,
    legacyHeaders: false,
    standardHeaders: 'draft-8',
    handler: (_request: Request, response: Response): void => {
      const requestId = typeof response.locals.requestId === 'string'
        ? response.locals.requestId
        : 'unknown';

      const body: ApiErrorResponse = {
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many signup attempts. Please try again later.',
          requestId,
        },
      };
      response.status(429).json(body);
    },
  });
}
