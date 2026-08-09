import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { logger } from '../src/lib/logger.js';
import { errorHandler } from '../src/middleware/error-handler.js';

describe('errorHandler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs an unexpected error with request context and redacts database credentials', async () => {
    const databaseUrl = 'postgresql://postgres:super-secret@db.example.com:5432/postgres';
    const logError = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    const app = express();

    app.get('/broken', () => {
      throw new Error(`Database connection failed: ${databaseUrl}`);
    });
    app.use(errorHandler);

    const response = await request(app).get('/broken');

    expect(response.status).toBe(500);
    expect(response.body.error).toMatchObject({
      code: 'INTERNAL_ERROR',
      requestId: expect.any(String),
    });
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({
        errorName: 'Error',
        method: 'GET',
        path: '/broken',
        requestId: response.body.error.requestId,
        status: 500,
      }),
      'request failed',
    );

    const loggedDetails = logError.mock.calls[0]?.[0] as { errorMessage?: string };
    expect(loggedDetails.errorMessage).not.toContain('super-secret');
    expect(loggedDetails.errorMessage).toContain('postgresql://[REDACTED]@db.example.com');
  });

  it('logs the cause chain so a wrapped dependency failure names its trigger', async () => {
    // A missing ffprobe reached this handler as a 503 whose message read
    // "Recording media inspection is temporarily unavailable"; the actionable
    // `spawn ffprobe ENOENT` sat on `cause` and was never logged, which made a
    // permanent misconfiguration look like a transient outage.
    const logError = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    const app = express();

    app.get('/broken', () => {
      throw new Error('Recording media inspection is temporarily unavailable', {
        cause: new Error('spawn ffprobe ENOENT', { cause: new Error('PATH lookup failed') }),
      });
    });
    app.use(errorHandler);

    const response = await request(app).get('/broken');

    expect(response.status).toBe(500);
    const loggedDetails = logError.mock.calls[0]?.[0] as { errorCause?: string };
    expect(loggedDetails.errorCause).toBe('spawn ffprobe ENOENT <- PATH lookup failed');
  });

  it('omits the cause field entirely when an error has no cause', async () => {
    const logError = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    const app = express();

    app.get('/broken', () => {
      throw new Error('plain failure');
    });
    app.use(errorHandler);

    await request(app).get('/broken');

    expect(logError.mock.calls[0]?.[0]).not.toHaveProperty('errorCause');
  });
});
