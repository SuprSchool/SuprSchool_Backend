import { readFileSync } from 'node:fs';
import { drizzle, type RemoteCallback } from 'drizzle-orm/pg-proxy';
import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import type { Database } from '../src/db/client.js';
import { DrizzleAnnouncementsRepository } from '../src/db/repositories/announcements.repository.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import type { AuthenticationMiddleware } from '../src/middleware/authenticate.js';
import { createAnnouncementsRouter } from '../src/routes/announcements.routes.js';
import { createAnnouncementsService, type AcademicMutationPort, type AnnouncementsService } from '../src/services/announcements.service.js';
import type { AnnouncementIdentity } from '../src/types/announcements.js';
import type { AnnouncementsRepository } from '../src/db/repositories/announcements.repository.js';

const schoolId = '11111111-1111-4111-8111-111111111111';
const studentId = '22222222-2222-4222-8222-222222222222';
const teacherId = '33333333-3333-4333-8333-333333333333';
const classId = '44444444-4444-4444-8444-444444444444';
const subjectId = '55555555-5555-4555-8555-555555555555';
const announcementId = '66666666-6666-4666-8666-666666666666';
const announcementResourceId = '77777777-7777-4777-8777-777777777777';


function passthroughMutations(): AcademicMutationPort {
  return {
    async execute<T>(
      _identity: AnnouncementIdentity,
      input: {
        idempotencyKey: string;
        requestBody: unknown;
        successStatus: number;
        work: () => Promise<T>;
      },
    ) {
      return { body: await input.work(), replayed: false, status: input.successStatus };
    },
  };
}

const validCreate = {
  body: 'Bring your textbook tomorrow.',
  category: 'Class',
  classId,
  subjectId,
  title: 'Mathematics reminder',
};

function createService(): AnnouncementsService {
  return {
    confirmResource: vi.fn(),
    create: vi.fn(),
    createResourceUploadSession: vi.fn(),
    delete: vi.fn(),
    deleteResource: vi.fn(),
    getForStudent: vi.fn(),
    getForTeacher: vi.fn(),
    listForStudent: vi.fn(),
    listForTeacher: vi.fn(),
    publish: vi.fn(),
    update: vi.fn(),
  };
}

function createAuthenticatedRequest(
  identity: { role: 'student' | 'teacher'; userId: string },
): AuthenticationMiddleware {
  return async (requestValue: Request, _response: Response, next): Promise<void> => {
    requestValue.auth = { schoolId, ...identity };
    next();
  };
}

function createTestApp(
  service: AnnouncementsService,
  identity: { role: 'student' | 'teacher'; userId: string },
) {
  const app = express();
  app.use(express.json());
  app.use('/', createAnnouncementsRouter(service, createAuthenticatedRequest(identity)));
  app.use(errorHandler);
  return app;
}

describe('announcements router', () => {
  it('uses token audience and ignores query classId', async () => {
    const service = createService();
    vi.mocked(service.listForStudent).mockResolvedValue({ items: [], nextCursor: undefined });
    const studentApp = createTestApp(service, { role: 'student', userId: studentId });

    await request(studentApp).get('/announcements?classId=attacker&limit=20').expect(200);

    expect(service.listForStudent).toHaveBeenCalledWith(
      { schoolId, userId: studentId },
      { category: undefined, cursor: undefined, limit: 20, search: undefined },
    );
  });

  it('passes authenticated teacher and key to publish', async () => {
    const service = createService();
    vi.mocked(service.publish).mockResolvedValue({ id: announcementId } as never);
    const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });

    await request(teacherApp).post(`/teacher/announcements/${announcementId}/publish`)
      .set('Idempotency-Key', 'announcement-publish-1').send({}).expect(200);

    expect(service.publish).toHaveBeenCalledWith(
      { schoolId, userId: teacherId }, announcementId, 'announcement-publish-1', {},
    );
  });

  it('returns live teacher detail and deletes by the authenticated tenant identity', async () => {
    const service = createService();
    vi.mocked(service.getForTeacher).mockResolvedValue({ id: announcementId } as never);
    const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });

    await request(teacherApp).get(`/teacher/announcements/${announcementId}`).expect(200);
    await request(teacherApp).delete(`/teacher/announcements/${announcementId}`)
      .set('Idempotency-Key', 'announcement-delete-1').expect(204);

    expect(service.getForTeacher).toHaveBeenCalledWith(
      { schoolId, userId: teacherId }, announcementId,
    );
    expect(service.delete).toHaveBeenCalledWith(
      { schoolId, userId: teacherId }, announcementId, 'announcement-delete-1',
    );
  });

  it('distinguishes the school-readable All feed from the owner-only My feed', async () => {
    const service = createService();
    vi.mocked(service.listForTeacher).mockResolvedValue({ items: [] });
    const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });

    await request(teacherApp).get('/teacher/announcements?scope=all').expect(200);
    await request(teacherApp).get('/teacher/announcements?scope=mine').expect(200);

    expect(service.listForTeacher).toHaveBeenNthCalledWith(
      1, { schoolId, userId: teacherId }, { cursor: undefined, limit: 20, scope: 'all' },
    );
    expect(service.listForTeacher).toHaveBeenNthCalledWith(
      2, { schoolId, userId: teacherId }, { cursor: undefined, limit: 20, scope: 'mine' },
    );
  });

  it('persists an authorized class audience update and deletes a confirmed resource', async () => {
    const service = createService();
    vi.mocked(service.update).mockResolvedValue({ id: announcementId } as never);
    const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });
    const audience = { audienceType: 'class', classId, subjectId } as const;

    await request(teacherApp).patch(`/teacher/announcements/${announcementId}`)
      .set('Idempotency-Key', 'announcement-audience-update-1').send(audience).expect(200);
    await request(teacherApp).delete(
      `/teacher/announcements/${announcementId}/resources/${announcementResourceId}`,
    ).set('Idempotency-Key', 'announcement-resource-delete-1').expect(204);

    expect(service.update).toHaveBeenCalledWith(
      { schoolId, userId: teacherId }, announcementId, audience, 'announcement-audience-update-1',
    );
    expect(service.deleteResource).toHaveBeenCalledWith(
      { schoolId, userId: teacherId }, announcementId, announcementResourceId,
      'announcement-resource-delete-1',
    );
  });

  it('accepts one explicit school-wide audience without class or subject IDs', async () => {
    const service = createService();
    vi.mocked(service.create).mockResolvedValue({ id: announcementId } as never);
    const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });
    const payload = {
      audienceType: 'school',
      body: 'School closes early tomorrow.',
      category: 'School',
      title: 'Early closure',
    };

    await request(teacherApp).post('/teacher/announcements')
      .set('Idempotency-Key', 'announcement-school-1').send(payload).expect(201);

    expect(service.create).toHaveBeenCalledWith(
      { schoolId, userId: teacherId }, payload, 'announcement-school-1',
    );
  });

  it('forbids student creation', async () => {
    const service = createService();
    const studentApp = createTestApp(service, { role: 'student', userId: studentId });

    await request(studentApp).post('/teacher/announcements')
      .set('Idempotency-Key', 'forbidden-1').send(validCreate).expect(403);

    expect(service.create).not.toHaveBeenCalled();
  });
  it('rejects unsupported academic resource MIME types before storage and accepts official Office MIME types', async () => {
    const service = createService();
    const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });

    await request(teacherApp).post(`/teacher/announcements/${announcementId}/resources/upload-sessions`)
      .set('Idempotency-Key', 'bad-mime')
      .send({ contentType: 'application/x-msdownload', displayName: 'bad.exe', sizeBytes: 256 })
      .expect(400);
    expect(service.createResourceUploadSession).not.toHaveBeenCalled();

    await request(teacherApp).post(`/teacher/announcements/${announcementId}/resources/upload-sessions`)
      .set("Idempotency-Key", "audio-mime")
      .send({ contentType: "audio/mp4", displayName: "lecture.m4a", sizeBytes: 256 })
      .expect(400);
    expect(service.createResourceUploadSession).not.toHaveBeenCalled();

    await request(teacherApp).post(`/teacher/announcements/${announcementId}/resources/upload-sessions`)
      .set('Idempotency-Key', 'office-mime')
      .send({
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        displayName: 'lesson.docx', sizeBytes: 256,
      })
      .expect(201);
    expect(service.createResourceUploadSession).toHaveBeenCalledOnce();
  });

  it('returns a validation response rather than throwing for malformed announcement cursors', async () => {
    const service = createService();
    const studentApp = createTestApp(service, { role: 'student', userId: studentId });

    await request(studentApp).get('/announcements?cursor=not-a-cursor').expect(400);

    expect(service.listForStudent).not.toHaveBeenCalled();
  });

  it('forwards immutable resource metadata and a separate confirmation key', async () => {
    const service = createService();
    const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });
    const metadata = { contentType: 'application/pdf', displayName: 'notice.pdf', sizeBytes: 256 };

    await request(teacherApp).post(`/teacher/announcements/${announcementId}/resources/upload-sessions`)
      .set('Idempotency-Key', 'announcement-resource-create')
      .send(metadata)
      .expect(201);
    await request(teacherApp).post(`/teacher/announcements/${announcementId}/resources/confirm`)
      .set('Idempotency-Key', 'announcement-resource-confirm')
      .send({ uploadSessionId: '77777777-7777-4777-8777-777777777777' })
      .expect(201);

    expect(service.createResourceUploadSession).toHaveBeenCalledWith(
      { schoolId, userId: teacherId }, announcementId, metadata, 'announcement-resource-create',
    );
    expect(service.confirmResource).toHaveBeenCalledWith(
      { schoolId, userId: teacherId }, announcementId,
      '77777777-7777-4777-8777-777777777777', 'announcement-resource-confirm',
    );
  });
});

describe('announcement publication integration regression', () => {
  it('rolls back the publication when its transactional outbox write fails', async () => {
    let isPublished = false;
    let outboxWrites = 0;
    const announcement = {
      body: 'Bring your textbook tomorrow.',
      category: 'Class',
      classId,
      createdAt: new Date('2026-07-13T00:00:00.000Z'),
      // Every post-migration row carries both columns, null when unset.
      eventAt: null,
      id: announcementId,
      isPublished,
      location: null,
      publishedAt: null,
      schoolId,
      subjectId,
      teacherId,
      title: 'Mathematics reminder',
      updatedAt: new Date('2026-07-13T00:00:00.000Z'),
    };
    const database = {
      select: () => {
        const query = {
          from: () => query,
          limit: async () => isPublished ? [] : [{ ...announcement, isPublished }],
          orderBy: async () => [],
          where: () => query,
        };
        return query;
      },
      transaction: async (work: (transaction: unknown) => Promise<unknown>) => {
        const previousPublicationState = isPublished;
        try {
          return await work(database);
        } catch (error) {
          isPublished = previousPublicationState;
          throw error;
        }
      },
      update: () => {
        const query = {
          set: () => query,
          where: () => query,
          returning: async () => {
            isPublished = true;
            return [{ ...announcement, isPublished }];
          },
        };
        return query;
      },
    } as unknown as Database;
    const repository = new DrizzleAnnouncementsRepository(database);

    try {
      await repository.publish(
        { schoolId, userId: teacherId },
        announcementId,
        new Date('2026-07-13T01:00:00.000Z'),
        async () => {
          outboxWrites += 1;
          throw new Error('outbox unavailable');
        },
      );
    } catch {
      // The assertion below verifies that the repository propagated the failure.
    }

    expect(outboxWrites).toBe(1);
    expect(isPublished).toBe(false);
  });
});

describe("announcement resource confirmation reliability", () => {
  it('retains the resource row and retries Storage deletion after a transient failure', async () => {
    const resource = {
      id: announcementResourceId,
      name: 'banner.m4a',
      objectPath: 'announcement/banner.m4a',
      type: 'document' as const,
    };
    let storedResource: typeof resource | undefined = resource;
    const deleteObject = vi.fn()
      .mockRejectedValueOnce(new Error('Storage unavailable'))
      .mockResolvedValueOnce(undefined);
    const findResourceForDeletion = vi.fn(async () => storedResource);
    const deleteResource = vi.fn(async () => {
      const deleted = storedResource;
      storedResource = undefined;
      return deleted;
    });
    const service = createAnnouncementsService({
      files: { deleteObject } as never,
      mutations: passthroughMutations(),
      outbox: { writeInTransaction: vi.fn() },
      repository: {
        canManage: vi.fn().mockResolvedValue(true),
        deleteResource,
        findResourceForDeletion,
      } as unknown as AnnouncementsRepository,
    });

    await expect(service.deleteResource(
      { schoolId, userId: teacherId }, announcementId, announcementResourceId,
      'announcement-resource-delete-storage-1',
    )).rejects.toThrow('Storage unavailable');

    expect(storedResource).toEqual(resource);
    expect(deleteResource).not.toHaveBeenCalled();

    await service.deleteResource(
      { schoolId, userId: teacherId }, announcementId, announcementResourceId,
      'announcement-resource-delete-storage-1',
    );

    expect(findResourceForDeletion).toHaveBeenCalledTimes(2);
    expect(deleteResource).toHaveBeenCalledWith(
      { schoolId, userId: teacherId }, announcementId, announcementResourceId,
    );
    expect(deleteObject).toHaveBeenCalledTimes(2);
    expect(storedResource).toBeUndefined();
  });

  it("leaves a failed resource insert cleanup-eligible by never finalizing its upload session", async () => {
    const prepareUpload = vi.fn().mockResolvedValue({
      contentType: "application/pdf", displayName: "notice.pdf", id: "upload-1", objectPath: "notice.pdf",
    });
    const finalizeUpload = vi.fn();
    const confirmUpload = vi.fn().mockResolvedValue({
      contentType: "application/pdf", displayName: "notice.pdf", id: "upload-1", objectPath: "notice.pdf",
    });
    const service = createAnnouncementsService({
      files: {
        confirmUpload,
        createReadUrl: vi.fn(),
        createUpload: vi.fn(),
        finalizeUpload,
        prepareUpload,
      } as never,
      mutations: passthroughMutations(),
      outbox: { writeInTransaction: vi.fn() },
      repository: {
        canManage: vi.fn().mockResolvedValue(true),
        insertResource: vi.fn().mockResolvedValue(undefined),
      } as unknown as AnnouncementsRepository,
    });

    await expect(service.confirmResource(
      { schoolId, userId: teacherId }, announcementId, "upload-1", "resource-failure-1",
    )).rejects.toMatchObject({ status: 404 });

    expect(prepareUpload).toHaveBeenCalledWith({ schoolId, userId: teacherId }, {
      parentId: announcementId, parentType: "announcement-resource", uploadSessionId: "upload-1",
    });
    expect(confirmUpload).not.toHaveBeenCalled();
    expect(finalizeUpload).not.toHaveBeenCalled();
  });
});

  it('keeps resource linking atomic with the live teacher class-subject predicate under concurrent revocation', async () => {
    const queries: string[] = [];
    const callback: RemoteCallback = async (query) => {
      queries.push(query);
      return { rows: [] };
    };
    const repository = new DrizzleAnnouncementsRepository(drizzle(callback) as unknown as Database);

    await repository.insertResource({
      announcementId,
      displayName: 'notice.pdf',
      identity: { schoolId, userId: teacherId },
      objectPath: 'announcement/notice.pdf',
      resourceType: 'pdf',
      schoolId,
      uploadSessionId: '77777777-7777-4777-8777-777777777777',
    } as never);

    expect(queries[0]).toContain('insert into public.announcement_resources');
    expect(queries[0]).toContain('public.class_subjects');
    expect(queries[0]).toContain('teacher_id');
  });


  it('filters teacher announcement lists through the current class-subject assignment', async () => {
    const queries: string[] = [];
    const callback: RemoteCallback = async (query) => {
      queries.push(query);
      return { rows: [] };
    };
    const repository = new DrizzleAnnouncementsRepository(drizzle(callback) as unknown as Database);

    await expect(repository.listForTeacher({ schoolId, userId: teacherId }, { limit: 20 }))
      .resolves.toEqual({ items: [] });

    const query = queries[0];
    expect(query).toContain('from "class_announcements"');
    expect(query).toContain('exists (select "id" from "class_subjects"');
    expect(query).toContain('"class_subjects"."school_id" = ');
    expect(query).toContain('"class_subjects"."class_id" = "class_announcements"."class_id"');
    expect(query).toContain('"class_subjects"."subject_id" = "class_announcements"."subject_id"');
    expect(query).toContain('"class_subjects"."teacher_id" = ');
  });

  it("keeps another teacher's draft out of the All feed", async () => {
    const queries: string[] = [];
    const callback: RemoteCallback = async (query) => {
      queries.push(query);
      return { rows: [] };
    };
    const repository = new DrizzleAnnouncementsRepository(drizzle(callback) as unknown as Database);

    await repository.listForTeacher(
      { schoolId, userId: teacherId }, { limit: 20, scope: 'all' },
    );

    expect(queries[0]).toContain('"class_announcements"."is_published" = ');
    expect(queries[0]).toContain('"class_announcements"."teacher_id" = ');
  });

  it('delivers one school announcement through an active same-school role without class fan-out', async () => {
    const queries: string[] = [];
    const parameters: unknown[][] = [];
    const callback: RemoteCallback = async (query, params) => {
      queries.push(query);
      parameters.push(params);
      return { rows: [] };
    };
    const repository = new DrizzleAnnouncementsRepository(drizzle(callback) as unknown as Database);

    await expect(repository.create(
      { schoolId, userId: teacherId },
      {
        audienceType: 'school', body: 'School closes early.', category: 'School',
        title: 'Early closure',
      },
    )).resolves.toBeUndefined();
    await expect(repository.listForStudent(
      { schoolId, userId: studentId }, { limit: 20 },
    )).resolves.toEqual({ items: [] });

    const createQuery = queries[0] ?? '';
    expect(createQuery.match(/insert into public\.class_announcements/g)).toHaveLength(1);
    expect(createQuery).toContain('public.user_roles');
    expect(createQuery).toContain('role.school_id =');
    expect(createQuery).toContain("role.role = 'teacher'");
    const audienceQuery = queries[1] ?? '';
    expect(audienceQuery).toContain('"class_announcements"."school_id" = ');
    expect(audienceQuery).toContain('"class_announcements"."audience_type" = ');
    expect(audienceQuery).toContain('exists (select "id" from "user_roles"');
    expect(parameters[1]?.[0]).toBe(schoolId);
    expect(parameters[1]?.[3]).toBe(schoolId);
    expect(audienceQuery).toContain('"user_roles"."is_active" = ');
  });

describe('announcement app mount', () => {
  it('mounts the authenticated announcement router at /v1', async () => {
    const service = createService();
    vi.mocked(service.listForStudent).mockResolvedValue({ items: [], nextCursor: undefined });

    await request(createApp({
      announcementService: service,
      authenticate: createAuthenticatedRequest({ role: 'student', userId: studentId }),
    })).get('/v1/announcements').expect(200);
  });
});


describe('announcement event metadata', () => {
  const eventAt = '2026-04-08T11:00:00.000Z';

  it('forwards location and eventAt through create rather than stripping them', async () => {
    const service = createService();
    vi.mocked(service.create).mockResolvedValue({
      id: announcementId, eventAt, location: 'Main Auditorium',
    } as never);
    const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });

    const response = await request(teacherApp).post('/teacher/announcements')
      .set('Idempotency-Key', 'announcement-event-metadata-1')
      .send({ ...validCreate, eventAt, location: 'Main Auditorium' })
      .expect(201);

    expect(service.create).toHaveBeenCalledWith(
      { schoolId, userId: teacherId },
      { ...validCreate, audienceType: 'class', eventAt, location: 'Main Auditorium' },
      'announcement-event-metadata-1',
    );
    expect(response.body.location).toBe('Main Auditorium');
    expect(response.body.eventAt).toBe(eventAt);
  });

  it('accepts an edit that changes only the event metadata', async () => {
    const service = createService();
    vi.mocked(service.update).mockResolvedValue({ id: announcementId } as never);
    const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });

    await request(teacherApp).patch(`/teacher/announcements/${announcementId}`)
      .set('Idempotency-Key', 'announcement-event-metadata-2')
      .send({ eventAt, location: 'Main Auditorium' })
      .expect(200);

    expect(service.update).toHaveBeenCalledWith(
      { schoolId, userId: teacherId }, announcementId,
      { eventAt, location: 'Main Auditorium' }, 'announcement-event-metadata-2',
    );
  });

  it('rejects a malformed eventAt and an over-long location before the service', async () => {
    const service = createService();
    const teacherApp = createTestApp(service, { role: 'teacher', userId: teacherId });

    await request(teacherApp).post('/teacher/announcements')
      .set('Idempotency-Key', 'announcement-event-metadata-bad-date')
      .send({ ...validCreate, eventAt: 'the eighth of April' })
      .expect(400);
    await request(teacherApp).post('/teacher/announcements')
      .set('Idempotency-Key', 'announcement-event-metadata-long-location')
      .send({ ...validCreate, location: 'A'.repeat(201) })
      .expect(400);

    expect(service.create).not.toHaveBeenCalled();
  });

  it('reads location and event_at onto teacher list items, null when the row has none', async () => {
    const callback: RemoteCallback = async () => ({
      rows: [
        [
          'class', 'Bring your textbook tomorrow.', 'Class', classId,
          new Date('2026-07-13T00:00:00.000Z'), new Date(eventAt), announcementId,
          'Main Auditorium', new Date('2026-04-01T00:00:00.000Z'), subjectId, teacherId,
          'Math Olympiad',
        ],
        [
          'school', 'School closes early tomorrow.', 'School', null,
          new Date('2026-07-12T00:00:00.000Z'), null, announcementResourceId,
          null, new Date('2026-03-01T00:00:00.000Z'), null, teacherId,
          'Early closure',
        ],
      ],
    });
    const repository = new DrizzleAnnouncementsRepository(drizzle(callback) as unknown as Database);

    const page = await repository.listForTeacher({ schoolId, userId: teacherId }, { limit: 20 });

    expect(page.items[0]).toMatchObject({ eventAt, location: 'Main Auditorium' });
    // Absent metadata is null, never '' and never the publication date.
    expect(page.items[1]).toMatchObject({ eventAt: null, location: null });
  });

  it('persists location and event_at on the create and update writes', async () => {
    const queries: string[] = [];
    const callback: RemoteCallback = async (query) => {
      queries.push(query);
      return { rows: [] };
    };
    const repository = new DrizzleAnnouncementsRepository(drizzle(callback) as unknown as Database);

    await repository.create({ schoolId, userId: teacherId }, {
      audienceType: 'school', body: 'School closes early.', category: 'School',
      eventAt, location: 'Main Auditorium', title: 'Early closure',
    });
    await repository.update({ schoolId, userId: teacherId }, announcementId, {
      eventAt, location: 'Main Auditorium',
    });

    expect(queries[0]).toContain('location');
    expect(queries[0]).toContain('event_at');
    expect(queries[1]).toContain('"location"');
    expect(queries[1]).toContain('"event_at"');
  });

  it('keeps both columns on the announcements table definition', () => {
    const source = readFileSync(
      new URL('../src/db/schema/announcements.ts', import.meta.url), 'utf8',
    );
    expect(source).toContain("text('location')");
    expect(source).toContain("timestamp('event_at', { withTimezone: true })");
  });
});

describe("announcement final write authorization", () => {
  it("keeps the live class-subject predicate in every decisive announcement write", () => {
    const source = readFileSync(
      new URL("../src/db/repositories/announcements.repository.ts", import.meta.url),
      "utf8",
    );
    const createMethod = source.slice(source.indexOf("public async create"), source.indexOf("public async update"));
    const updateMethod = source.slice(source.indexOf("public async update"), source.indexOf("public async publish"));
    const publishMethod = source.slice(source.indexOf("public async publish"), source.indexOf("public async canManage"));

    expect(createMethod).toContain("from public.class_subjects");
    expect(updateMethod).toContain("this.teacherCanManage");
    expect(publishMethod).toContain("this.teacherCanManage");
  });

  it('keeps the owner edit path available after publication while retaining tenant authorization', () => {
    const source = readFileSync(
      new URL('../src/db/repositories/announcements.repository.ts', import.meta.url), 'utf8',
    );
    const updateMethod = source.slice(source.indexOf('public async update'), source.indexOf('public async publish'));
    expect(updateMethod).toContain('this.teacherCanManage');
    expect(updateMethod).not.toContain('eq(classAnnouncements.isPublished, false)');
    expect(updateMethod).not.toContain("return 'already_published'");
  });

  it("does not write an outbox event when final publication authorization is revoked", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const outbox = { writeInTransaction: vi.fn() };
    const service = createAnnouncementsService({
      files: {} as never,
      mutations: passthroughMutations(),
      outbox,
      repository: { publish } as unknown as AnnouncementsRepository,
    });

    await expect(service.publish(
      { schoolId, userId: teacherId }, announcementId, "revoked-after-precheck", {},
    )).rejects.toMatchObject({ status: 404 });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(outbox.writeInTransaction).not.toHaveBeenCalled();
  });
});
