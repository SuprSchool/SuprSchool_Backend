import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import type { EventsRepository } from '../src/db/repositories/events.repository.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import type { AuthenticationMiddleware } from '../src/middleware/authenticate.js';
import type { IdempotencyStore } from '../src/platform/idempotency/idempotency-store.js';
import { AcademicUploadParentAuthorizer } from '../src/platform/storage/academic-file-service.js';
import { createTeacherEventsRouter } from '../src/routes/teacher-events.routes.js';
import { createEventsService, type EventsService } from '../src/services/events.service.js';

const schoolId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const teacherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const eventId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const sessionId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const resourceId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const unusedIdempotency = {} as IdempotencyStore;

function authenticateAs(role: 'student' | 'teacher'): AuthenticationMiddleware {
  return async (requestValue: Request, _response: Response, next: NextFunction): Promise<void> => {
    requestValue.auth = { role, schoolId, userId: teacherId };
    next();
  };
}

function serviceDouble(overrides: Partial<EventsService>): EventsService {
  return new Proxy(overrides, {
    get(target, property) {
      if (property in target) return target[property as keyof typeof target];
      return vi.fn();
    },
  }) as EventsService;
}

describe('teacher event directory routes', () => {
  it('returns all current-school class options through the manage-events capability', async () => {
    const listClassOptions = vi.fn().mockResolvedValue({
      items: [{ classId: '11111111-1111-4111-8111-111111111111', label: 'Grade 9 - A' }],
    });
    const app = express();
    app.use('/teacher', createTeacherEventsRouter(serviceDouble({ listClassOptions } as Partial<EventsService>), authenticateAs('teacher'), unusedIdempotency));
    app.use(errorHandler);

    const response = await request(app).get('/teacher/events/class-options');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      items: [{ classId: '11111111-1111-4111-8111-111111111111', label: 'Grade 9 - A' }],
    });
    expect(listClassOptions).toHaveBeenCalledWith({ schoolId, userId: teacherId });
  });

  it('rejects non-teachers before class options reach the service', async () => {
    const listClassOptions = vi.fn();
    const app = express();
    app.use('/teacher', createTeacherEventsRouter(serviceDouble({ listClassOptions } as Partial<EventsService>), authenticateAs('student'), unusedIdempotency));
    app.use(errorHandler);

    const response = await request(app).get('/teacher/events/class-options');

    expect(response.status).toBe(403);
    expect(listClassOptions).not.toHaveBeenCalled();
  });

  it('strictly validates bounded member option filters', async () => {
    const listMemberOptions = vi.fn();
    const app = express();
    app.use('/teacher', createTeacherEventsRouter(serviceDouble({ listMemberOptions } as Partial<EventsService>), authenticateAs('teacher'), unusedIdempotency));
    app.use(errorHandler);

    const response = await request(app).get('/teacher/events/member-options?role=school-admin&limit=101&unknown=x');

    expect(response.status).toBe(400);
    expect(listMemberOptions).not.toHaveBeenCalled();
  });

  it('returns active same-school member options without sensitive fields', async () => {
    const listMemberOptions = vi.fn().mockResolvedValue({
      items: [{ displayName: 'A Student', role: 'student', userId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }],
      nextCursor: null,
    });
    const app = express();
    app.use('/teacher', createTeacherEventsRouter(serviceDouble({ listMemberOptions } as Partial<EventsService>), authenticateAs('teacher'), unusedIdempotency));
    app.use(errorHandler);

    const response = await request(app).get('/teacher/events/member-options?role=student&limit=25&search=A');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      items: [{ displayName: 'A Student', role: 'student', userId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }],
      nextCursor: null,
    });
    expect(response.body.items[0]).not.toHaveProperty('phoneE164');
    expect(listMemberOptions).toHaveBeenCalledWith(
      { schoolId, userId: teacherId },
      { limit: 25, role: 'student', search: 'A' },
    );
  });
});

describe('event resource routes', () => {
  it('creates, confirms, and deletes an event resource at immutable session routes', async () => {
    const requestResourceUploadSession = vi.fn().mockResolvedValue({
      expiresAt: '2026-07-29T12:00:00.000Z',
      objectPath: `${schoolId}/event-resource/${eventId}/${sessionId}`,
      signedUploadUrl: 'https://storage.example/upload',
      uploadSessionId: sessionId,
    });
    const confirmResourceUpload = vi.fn().mockResolvedValue({
      contentType: 'image/png', id: resourceId, kind: 'banner', name: 'sports-day.png', sizeBytes: 1024, sortOrder: 0,
    });
    const deleteResource = vi.fn().mockResolvedValue(undefined);
    const app = express();
    app.use(express.json());
    app.use('/teacher', createTeacherEventsRouter(serviceDouble({
      confirmResourceUpload,
      deleteResource,
      requestResourceUploadSession,
    } as Partial<EventsService>), authenticateAs('teacher'), unusedIdempotency));
    app.use(errorHandler);

    const created = await request(app)
      .post(`/teacher/events/${eventId}/resource-upload-sessions`)
      .send({ contentType: 'image/png', displayName: 'sports-day.png', kind: 'banner', sizeBytes: 1024 });
    const confirmed = await request(app)
      .post(`/teacher/events/${eventId}/resource-upload-sessions/${sessionId}/confirm`)
      .send({});
    const deleted = await request(app)
      .delete(`/teacher/events/${eventId}/resources/${resourceId}`)
      .send();

    expect(created.status).toBe(201);
    expect(confirmed.status).toBe(201);
    expect(deleted.status).toBe(204);
    expect(requestResourceUploadSession).toHaveBeenCalledWith(
      { schoolId, userId: teacherId }, eventId,
      { contentType: 'image/png', displayName: 'sports-day.png', kind: 'banner', sizeBytes: 1024, sortOrder: 0 },
    );
    expect(confirmResourceUpload).toHaveBeenCalledWith({ schoolId, userId: teacherId }, eventId, sessionId);
    expect(deleteResource).toHaveBeenCalledWith({ schoolId, userId: teacherId }, eventId, resourceId);
  });

  it('rejects non-image banners before creating a storage session', async () => {
    const requestResourceUploadSession = vi.fn();
    const app = express();
    app.use(express.json());
    app.use('/teacher', createTeacherEventsRouter(serviceDouble({ requestResourceUploadSession } as Partial<EventsService>), authenticateAs('teacher'), unusedIdempotency));
    app.use(errorHandler);

    const response = await request(app)
      .post(`/teacher/events/${eventId}/resource-upload-sessions`)
      .send({ contentType: 'application/pdf', displayName: 'banner.pdf', kind: 'banner', sizeBytes: 1024 });

    expect(response.status).toBe(400);
    expect(requestResourceUploadSession).not.toHaveBeenCalled();
  });
});

describe('event resource service lifecycle', () => {
  it('confirms idempotently and deletes Storage before the database row', async () => {
    const order: string[] = [];
    const stored = {
      contentType: 'application/pdf' as const,
      id: resourceId,
      kind: 'attachment' as const,
      name: 'rules.pdf',
      objectPath: `${schoolId}/event-resource/${eventId}/${sessionId}`,
      sizeBytes: 2048,
      sortOrder: 1,
    };
    const repository = {
      canManage: vi.fn().mockResolvedValue(true),
      confirmResourceUpload: vi.fn().mockResolvedValue(stored),
      deleteResource: vi.fn().mockImplementation(async () => { order.push('database'); }),
      findResourceForDeletion: vi.fn().mockResolvedValue(stored),
    } as unknown as EventsRepository;
    const files = {
      createReadUrl: vi.fn(),
      createUpload: vi.fn(),
      deleteObject: vi.fn().mockImplementation(async () => { order.push('storage'); }),
      finalizeUpload: vi.fn().mockResolvedValue(undefined),
      prepareUpload: vi.fn().mockResolvedValue({
        contentType: stored.contentType,
        displayName: stored.name,
        id: sessionId,
        objectPath: stored.objectPath,
      }),
    };
    const service = createEventsService({ avatarUrlSigner: { createSignedDownloadUrl: vi.fn() }, files: files as never, repository });

    await expect((service as never as { confirmResourceUpload(identity: { schoolId: string; userId: string }, eventId: string, sessionId: string): Promise<unknown> })
      .confirmResourceUpload({ schoolId, userId: teacherId }, eventId, sessionId))
      .resolves.toEqual({ contentType: 'application/pdf', id: resourceId, kind: 'attachment', name: 'rules.pdf', sizeBytes: 2048, sortOrder: 1 });
    await (service as never as { deleteResource(identity: { schoolId: string; userId: string }, eventId: string, resourceId: string): Promise<void> })
      .deleteResource({ schoolId, userId: teacherId }, eventId, resourceId);

    expect(files.finalizeUpload).toHaveBeenCalledWith({ schoolId, userId: teacherId }, sessionId);
    expect(order).toEqual(['storage', 'database']);
  });

  it('allows an archived owner to delete an existing resource without reopening upload access', async () => {
    const stored = {
      contentType: 'application/pdf',
      id: resourceId,
      kind: 'attachment' as const,
      name: 'rules.pdf',
      objectPath: `${schoolId}/event-resource/${eventId}/${sessionId}`,
      sizeBytes: 2048,
      sortOrder: 1,
    };
    const repository = {
      canManage: vi.fn().mockResolvedValue(false),
      deleteResource: vi.fn().mockResolvedValue(undefined),
      findResourceForDeletion: vi.fn().mockResolvedValue(stored),
    } as unknown as EventsRepository;
    const files = {
      deleteObject: vi.fn().mockResolvedValue(undefined),
    };
    const service = createEventsService({ avatarUrlSigner: { createSignedDownloadUrl: vi.fn() }, files: files as never, repository });

    await expect(service.deleteResource({ schoolId, userId: teacherId }, eventId, resourceId))
      .resolves.toBeUndefined();

    expect(repository.canManage).not.toHaveBeenCalled();
    expect(files.deleteObject).toHaveBeenCalledWith('academic-files', stored.objectPath);
    expect(repository.deleteResource).toHaveBeenCalledWith(
      { schoolId, userId: teacherId },
      eventId,
      resourceId,
    );
  });
});

describe('event upload parent authorization', () => {
  it('authorizes only the event owner in the current school', async () => {
    const events = { canManage: vi.fn().mockResolvedValue(true) };
    const authorizer = new AcademicUploadParentAuthorizer({
      announcements: { canManage: vi.fn().mockResolvedValue(false) },
      assignments: { canAccessSubmission: vi.fn().mockResolvedValue(false), canManage: vi.fn().mockResolvedValue(false) },
      events,
      exams: { canManageAssessment: vi.fn().mockResolvedValue(false) },
    } as never);

    await expect(authorizer.authorize({
      action: 'confirm', bucket: 'academic-files', parentId: eventId,
      parentType: 'event-resource', schoolId, userId: teacherId,
    })).resolves.toBe(true);
    expect(events.canManage).toHaveBeenCalledWith({ schoolId, userId: teacherId }, eventId);
  });
});
describe('event application composition', () => {
  it('fails closed when teacher event metadata has no durable idempotency store', () => {
    expect(() => createApp({
      authenticate: authenticateAs('teacher'),
      eventsService: serviceDouble({} as Partial<EventsService>),
    })).toThrow('Event metadata idempotency is required when the events service is configured');
  });

  it('mounts the class-options endpoint under /v1/teacher', async () => {
    const listClassOptions = vi.fn().mockResolvedValue({ items: [] });
    const app = createApp({
      authenticate: authenticateAs('teacher'),
      eventMetadataIdempotency: unusedIdempotency,
      eventsService: serviceDouble({ listClassOptions } as Partial<EventsService>),
    });

    const response = await request(app).get('/v1/teacher/events/class-options');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [] });
  });
});

describe('event detail resource signing', () => {
  it('does not sign resources when a cross-teacher archived detail read is rejected', async () => {
    const repository = {
      getTeacherEvent: vi.fn().mockResolvedValue(undefined),
      listManagingTeam: vi.fn(),
      listTeacherResources: vi.fn(),
    } as unknown as EventsRepository;
    const files = {
      createReadUrl: vi.fn(),
    };
    const service = createEventsService({ avatarUrlSigner: { createSignedDownloadUrl: vi.fn() }, files: files as never, repository });

    await expect(service.getTeacherEvent({ schoolId, userId: teacherId }, eventId))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });

    expect(repository.listManagingTeam).not.toHaveBeenCalled();
    expect(repository.listTeacherResources).not.toHaveBeenCalled();
    expect(files.createReadUrl).not.toHaveBeenCalled();
  });
  it('returns one signed banner and ordered signed attachments for an authorized teacher', async () => {
    const repository = {
      getTeacherEvent: vi.fn().mockResolvedValue({
        activityKind: 'event', category: null, createdAt: '2026-07-29T10:00:00.000000Z',
        description: null, eligibilityCriteria: null, eligibilityRules: { targetClassIds: [] },
        endsAt: null, id: eventId, isOwned: true, lifecycle: 'draft', participationMode: null,
        registrationDeadlineAt: null, startsAt: '2026-07-30T10:00:00.000000Z',
        targetClassIds: [], title: 'Sports Day', venue: null,
      }),
      listTeacherResources: vi.fn().mockResolvedValue([
        { contentType: 'image/png', id: resourceId, kind: 'banner', name: 'banner.png', objectPath: 'banner-path', sizeBytes: 100, sortOrder: 0 },
        { contentType: 'application/pdf', id: sessionId, kind: 'attachment', name: 'rules.pdf', objectPath: 'rules-path', sizeBytes: 200, sortOrder: 1 },
      ]),
      listManagingTeam: vi.fn().mockResolvedValue([{
        displayName: 'A Student',
        memberType: 'student',
        role: 'Coordinator',
        userId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      }]),
    } as unknown as EventsRepository;
    const files = {
      createReadUrl: vi.fn().mockImplementation(async (_bucket: string, objectPath: string) => `https://storage.example/${objectPath}`),
    };
    const service = createEventsService({ avatarUrlSigner: { createSignedDownloadUrl: vi.fn() }, files: files as never, repository });

    const detail = await service.getTeacherEvent({ schoolId, userId: teacherId }, eventId);

    expect(detail.banner).toMatchObject({ id: resourceId, signedUrl: 'https://storage.example/banner-path' });
    expect(detail.resources).toEqual([
      expect.objectContaining({ id: sessionId, signedUrl: 'https://storage.example/rules-path' }),
    ]);
    expect(detail.managingTeam).toEqual([{
      displayName: 'A Student',
      memberType: 'student',
      role: 'Coordinator',
      userId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    }]);
    expect(JSON.stringify(detail)).not.toContain('objectPath');
  });
});