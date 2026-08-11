import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createNotificationRouter } from '../src/routes/notification.routes.js';
import type { NotificationInboxPage } from '../src/types/notification.js';

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

  it('carries the dispatch category on inbox items', async () => {
    // Typed as the read model on purpose: the assertion below only proves the
    // controller does not strip the field, while this annotation is what fails
    // if `NotificationInboxItem` has no category to carry.
    const page: NotificationInboxPage = {
      items: [{
        body: 'Your assignment has been graded.',
        category: 'grade-update',
        createdAt: '2026-08-10T09:30:00.000Z',
        data: {},
        id: 'e3f1c2b4-5a6d-4e7f-8a9b-0c1d2e3f4a5b',
        notificationType: 'assignment.graded',
        readAt: null,
        title: 'Assignment graded',
      }],
      nextCursor: null,
    };
    const service = {
      listInbox: vi.fn().mockResolvedValue(page),
      markRead: vi.fn(),
      registerDeviceToken: vi.fn(),
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

    const response = await request(app).get('/inbox').expect(200);

    // 268:9469 picks each card's glyph from the category, so a read model that
    // drops it renders all seven cards with the same default.
    expect(response.body.items[0].category).toBe('grade-update');
  });
});
