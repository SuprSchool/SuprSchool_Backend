export type ErrorCode =
  | 'ATTACHMENT_ALREADY_SENT'
  | 'CONFLICT'
  | 'FORBIDDEN'
  | 'IDEMPOTENCY_CONFLICT'
  | 'IDEMPOTENCY_IN_PROGRESS'
  | 'INVALID_CREDENTIALS'
  | 'INTERNAL_ERROR'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'SCHOOL_DIRECTORY_ACCESS_DENIED'
  | 'UNAUTHORIZED'
  | 'VALIDATION_ERROR';

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;

  public constructor(code: ErrorCode, status: number, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  return new AppError('INTERNAL_ERROR', 500, 'An unexpected error occurred');
}
