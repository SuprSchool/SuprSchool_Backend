import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createNotificationRouter } from '../src/routes/notification.routes.js';

describe('notification router', () => {
  it('registers the authenticated caller device token without accepting a user id from the request', async () => {
    const service = {
      listInbox: vi.fn(),
      markRead: vi.fn(),
      registerDeviceToken: vi.fn().mockResolvedValue({ id: 'device-1' }),
    };
    const app = express();
    app.use(express.json());
    app.use((request: Request, _response: Response, next: NextFunction) => {
      request.auth = { role: 'student', schoolId: '51b893d5-062d-4d63-bb0f-347bea040524', userId: 'c215d95d-5597-4c97-a315-b1d3e2fd577b' };
      next();
    });
    app.use(createNotificationRouter(service, async (
      _request: Request,
      _response: Response,
      next: NextFunction,
    ) => {
      next();
    }));

    await request(app)
      .post('/devices')
      .send({ expoPushToken: 'ExponentPushToken[device-token]', platform: 'android', userId: 'attacker' })
      .expect(201, { id: 'device-1' });

    expect(service.registerDeviceToken).toHaveBeenCalledWith(
      { schoolId: '51b893d5-062d-4d63-bb0f-347bea040524', userId: 'c215d95d-5597-4c97-a315-b1d3e2fd577b' },
      { expoPushToken: 'ExponentPushToken[device-token]', platform: 'android' },
    );
  });
});
