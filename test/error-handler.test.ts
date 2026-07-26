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
});
