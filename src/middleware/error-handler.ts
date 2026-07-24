import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { AppError, toAppError } from '../lib/errors.js';
import type { ApiErrorResponse } from '../types/api.js';

export function notFoundHandler(
  _request: Request,
  _response: Response,
  next: NextFunction,
): void {
  next(new AppError('NOT_FOUND', 404, 'Route not found'));
}

export function errorHandler(
  error: unknown,
  _request: Request,
  response: Response,
  _next: NextFunction,
): void {
  void _next;
  const isValidationError = error instanceof ZodError
    || (
      typeof error === 'object'
      && error !== null
      && Array.isArray((error as { issues?: unknown }).issues)
    );
  const appError = isValidationError
    ? new AppError('VALIDATION_ERROR', 400, 'Invalid request')
    : toAppError(error);
  const requestId = typeof response.locals.requestId === 'string'
    ? response.locals.requestId
    : 'unknown';

  const body: ApiErrorResponse = {
    error: {
      code: appError.code,
      message: appError.message,
      requestId,
    },
  };
  response.status(appError.status).json(body);
}
