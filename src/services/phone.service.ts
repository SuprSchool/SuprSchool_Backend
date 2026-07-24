import { AppError } from '../lib/errors.js';

export function normalizeIndianPhone(input: string): string {
  const normalized = input.replace(/[\s-]/g, '');

  if (/^[6-9]\d{9}$/.test(normalized)) {
    return `+91${normalized}`;
  }

  if (/^\+91[6-9]\d{9}$/.test(normalized)) {
    return normalized;
  }

  if (/^91[6-9]\d{9}$/.test(normalized)) {
    return `+${normalized}`;
  }

  throw new AppError('VALIDATION_ERROR', 400, 'Enter a valid Indian mobile number');
}
