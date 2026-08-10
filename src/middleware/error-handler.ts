import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { AppError, toAppError } from '../lib/errors.js';
import { logger, safeErrorCause, safeErrorMessage } from '../lib/logger.js';
import type { ApiErrorResponse } from '../types/api.js';

function isMalformedJsonError(error: unknown): boolean {
  return error instanceof SyntaxError
    && typeof error === 'object'
    && error !== null
    && (error as { type?: unknown }).type === 'entity.parse.failed';
}

export function notFoundHandler(
  _request: Request,
  _response: Response,
  next: NextFunction,
): void {
  next(new AppError('NOT_FOUND', 404, 'Route not found'));
}

export function errorHandler(
  error: unknown,
  request: Request,
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
  const appError = isValidationError || isMalformedJsonError(error)
    ? new AppError('VALIDATION_ERROR', 400, 'Invalid request')
    : toAppError(error);
  const requestId = typeof response.locals.requestId === 'string'
    ? response.locals.requestId
    : 'unknown';

  if (appError.status >= 500) {
    const errorCause = safeErrorCause(error);
    logger.error({
      errorCode: appError.code,
      ...(errorCause === undefined ? {} : { errorCause }),
      errorMessage: safeErrorMessage(error),
      errorName: error instanceof Error ? error.name : typeof error,
      method: request.method,
      path: request.path,
      requestId,
      status: appError.status,
    }, 'request failed');
  }

  const body: ApiErrorResponse = {
    error: {
      code: appError.code,
      message: appError.message,
      requestId,
    },
  };
  response.status(appError.status).json(body);
}
