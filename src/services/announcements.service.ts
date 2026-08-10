import type {
  AnnouncementsRepository,
  StoredAnnouncementDetail,
  StoredAnnouncementResource,
} from '../db/repositories/announcements.repository.js';
import type { Database } from '../db/client.js';
import { AppError } from '../lib/errors.js';
import type {
  AnnouncementDetail,
  AnnouncementIdentity,
  AnnouncementListItem,
  AnnouncementResource,
  AnnouncementResourceType,
  AnnouncementResourceUploadSession,
  CreateAnnouncementInput,
  CreateAnnouncementResourceUploadInput,
  CursorPage,
  TeacherAnnouncement,
  TeacherAnnouncementListQuery,
  UpdateAnnouncementInput,
  AnnouncementListQuery,
} from '../types/announcements.js';

export interface AcademicFilePort {
  deleteObject(bucket: 'academic-files', objectPath: string): Promise<void>;
  finalizeUpload(identity: AnnouncementIdentity, sessionId: string): Promise<void>;
  prepareUpload(identity: AnnouncementIdentity, input: {
    parentId: string;
    parentType: 'announcement-resource';
    uploadSessionId: string;
  }): Promise<{
    contentType: string;
    displayName: string;
    id: string;
    objectPath: string;
  }>;
  createReadUrl(bucket: 'academic-files', objectPath: string, expiresInSeconds: 900): Promise<string>;
  createUpload(identity: AnnouncementIdentity, input: {
    displayName: string;
    bucket: 'academic-files';
    contentType: string;
    parentId: string;
    parentType: 'announcement-resource';
    sizeBytes: number;
  }): Promise<{
    expiresAt: string;
    id: string;
    objectPath: string;
    signedUploadUrl: string;
  }>;
}

export interface AcademicMutationPort {
  execute<T>(identity: AnnouncementIdentity, input: {
    idempotencyKey: string;
    requestBody: unknown;
    successStatus: number;
    recover?: () => Promise<T | undefined>;
    work: () => Promise<T>;
  }): Promise<{ body: T; replayed: boolean; status: number }>;
}

export interface AnnouncementOutboxPort {
  writeInTransaction(
    transaction: Database,
    identity: AnnouncementIdentity,
    event: {
      aggregateId: string;
      aggregateType: 'announcement';
      eventType: 'announcement.published';
      payload: Record<string, string>;
    },
  ): Promise<void>;
}

export interface AnnouncementsService {
  confirmResource(
    identity: AnnouncementIdentity,
    announcementId: string,
    uploadSessionId: string,
    idempotencyKey: string,
  ): Promise<AnnouncementResource>;
  delete(
    identity: AnnouncementIdentity,
    announcementId: string,
    idempotencyKey: string,
  ): Promise<void>;
  deleteResource(
    identity: AnnouncementIdentity,
    announcementId: string,
    resourceId: string,
    idempotencyKey: string,
  ): Promise<void>;
  create(
    identity: AnnouncementIdentity,
    input: CreateAnnouncementInput,
    idempotencyKey: string,
  ): Promise<AnnouncementDetail>;
  createResourceUploadSession(
    identity: AnnouncementIdentity,
    announcementId: string,
    input: CreateAnnouncementResourceUploadInput,
    idempotencyKey: string,
  ): Promise<AnnouncementResourceUploadSession>;
  getForStudent(identity: AnnouncementIdentity, announcementId: string): Promise<AnnouncementDetail>;
  getForTeacher(identity: AnnouncementIdentity, announcementId: string): Promise<AnnouncementDetail>;
  listForStudent(identity: AnnouncementIdentity, query: AnnouncementListQuery): Promise<CursorPage<AnnouncementListItem>>;
  listForTeacher(identity: AnnouncementIdentity, query: TeacherAnnouncementListQuery): Promise<CursorPage<TeacherAnnouncement>>;
  publish(
    identity: AnnouncementIdentity,
    announcementId: string,
    idempotencyKey: string,
    requestBody: Record<string, never>,
  ): Promise<AnnouncementDetail>;
  update(
    identity: AnnouncementIdentity,
    announcementId: string,
    input: UpdateAnnouncementInput,
    idempotencyKey: string,
  ): Promise<AnnouncementDetail>;
}

export interface AnnouncementsServiceDependencies {
  files: AcademicFilePort;
  mutations: AcademicMutationPort;
  outbox: AnnouncementOutboxPort;
  repository: AnnouncementsRepository;
  clock?: () => Date;
}


function resourceType(contentType: string): AnnouncementResourceType {
  if (contentType === 'application/pdf') return 'pdf';
  if (contentType === 'image/jpeg' || contentType === 'image/png' || contentType === 'image/webp') {
    return 'image';
  }
  return 'document';
}

function notFound(): AppError {
  return new AppError('NOT_FOUND', 404, 'Announcement not found');
}

function alreadyPublished(): AppError {
  return new AppError(
    'ANNOUNCEMENT_ALREADY_PUBLISHED' as never,
    409,
    'Published announcements cannot be edited',
  );
}

function cannotManage(): AppError {
  return new AppError('FORBIDDEN', 403, 'You do not have access to this resource');
}

export function createAnnouncementsService({
  clock = () => new Date(),
  files,
  mutations,
  repository,
  outbox,
}: AnnouncementsServiceDependencies): AnnouncementsService {
  async function toResource(stored: StoredAnnouncementResource): Promise<AnnouncementResource> {
    return {
      id: stored.id,
      name: stored.name,
      signedUrl: await files.createReadUrl('academic-files', stored.objectPath, 900),
      type: stored.type,
    };
  }

  async function toDetail(stored: StoredAnnouncementDetail): Promise<AnnouncementDetail> {
    const resources = await Promise.all(stored.resources.map(toResource));
    return {
      attachmentCount: stored.attachmentCount,
      audienceType: stored.audienceType,
      body: stored.body,
      category: stored.category,
      ...(stored.classId === undefined ? {} : { classId: stored.classId }),
      description: stored.description,
      eventAt: stored.eventAt,
      id: stored.id,
      ...(stored.imageObjectPath === undefined ? {} : {
        imageUri: await files.createReadUrl('academic-files', stored.imageObjectPath, 900),
      }),
      location: stored.location,
      publishedAt: stored.publishedAt,
      readTimeMinutes: stored.readTimeMinutes,
      resources,
      ...(stored.subjectId === undefined ? {} : { subjectId: stored.subjectId }),
      title: stored.title,
    };
  }

  return {
    async listForStudent(identity, query) {
      return repository.listForStudent(identity, query);
    },

    async getForStudent(identity, announcementId) {
      const announcement = await repository.findForStudent(identity, announcementId);
      if (announcement === undefined) throw notFound();
      return toDetail(announcement);
    },

    async getForTeacher(identity, announcementId) {
      const announcement = await repository.findForTeacher(identity, announcementId);
      if (announcement === undefined) throw notFound();
      return toDetail(announcement);
    },

    async listForTeacher(identity, query) {
      return repository.listForTeacher(identity, query);
    },

    async create(identity, input, idempotencyKey) {
      const result = await mutations.execute(identity, {
        idempotencyKey,
        requestBody: input,
        successStatus: 201,
        work: async () => {
          const created = await repository.create(identity, input);
          if (created === undefined) throw cannotManage();
          return toDetail(created);
        },
      });
      return result.body;
    },

    async delete(identity, announcementId, idempotencyKey) {
      await mutations.execute(identity, {
        idempotencyKey,
        requestBody: {},
        successStatus: 204,
        work: async () => {
          if (!await repository.delete(identity, announcementId)) throw notFound();
        },
      });
    },

    async deleteResource(identity, announcementId, resourceId, idempotencyKey) {
      await mutations.execute(identity, {
        idempotencyKey,
        requestBody: { resourceId },
        successStatus: 204,
        work: async () => {
          const resource = await repository.findResourceForDeletion(identity, announcementId, resourceId);
          if (resource === undefined) {
            if (!await repository.canManage(identity, announcementId)) throw notFound();
            return;
          }
          await files.deleteObject('academic-files', resource.objectPath);
          await repository.deleteResource(identity, announcementId, resourceId);
        },
      });
    },

    async update(identity, announcementId, input, idempotencyKey) {
      const result = await mutations.execute(identity, {
        idempotencyKey,
        requestBody: input,
        successStatus: 200,
        work: async () => {
          const updated = await repository.update(identity, announcementId, input);
          if (updated === undefined) throw notFound();
          if (updated === 'already_published') throw alreadyPublished();
          return toDetail(updated);
        },
      });
      return result.body;
    },

    async publish(identity, announcementId, idempotencyKey, requestBody) {
      const result = await mutations.execute(identity, {
        idempotencyKey,
        requestBody,
        successStatus: 200,
        work: async () => {
          const published = await repository.publish(
            identity,
            announcementId,
            clock(),
            async (transaction, announcement) => outbox.writeInTransaction(
              transaction,
              identity,
              {
                aggregateId: announcement.id,
                aggregateType: 'announcement',
                eventType: 'announcement.published',
                payload: { announcementId: announcement.id },
              },
            ),
          );
          if (published === undefined) throw notFound();
          if (published === 'already_published') throw alreadyPublished();
          return toDetail(published);
        },
      });
      return result.body;
    },

    async createResourceUploadSession(identity, announcementId, input, idempotencyKey) {
      const result = await mutations.execute(identity, {
        idempotencyKey,
        requestBody: input,
        successStatus: 201,
        work: async () => {
          if (!await repository.canManage(identity, announcementId)) throw cannotManage();
          const session = await files.createUpload(identity, {
            bucket: 'academic-files',
            contentType: input.contentType,
            displayName: input.displayName,
            parentId: announcementId,
            parentType: 'announcement-resource',
            sizeBytes: input.sizeBytes,
          });
          return {
            expiresAt: session.expiresAt,
            id: session.id,
            signedUploadUrl: session.signedUploadUrl,
          };
        },
      });
      return result.body;
    },

    async confirmResource(identity, announcementId, uploadSessionId, idempotencyKey) {
      const result = await mutations.execute(identity, {
        idempotencyKey,
        requestBody: { uploadSessionId },
        successStatus: 201,
        recover: async () => {
          const stored = await repository.findResourceForUpload({
            announcementId, identity, uploadSessionId,
          });
          if (stored === undefined) return undefined;
          await files.finalizeUpload(identity, uploadSessionId);
          return toResource(stored);
        },
        work: async () => {
          if (!await repository.canManage(identity, announcementId)) throw cannotManage();
          const session = await files.prepareUpload(identity, {
            parentId: announcementId,
            parentType: 'announcement-resource',
            uploadSessionId,
          });
          const stored = await repository.insertResource({
            announcementId,
            identity,
            displayName: session.displayName,
            objectPath: session.objectPath,
            resourceType: resourceType(session.contentType),
            schoolId: identity.schoolId,
            uploadSessionId,
          });
          if (stored === undefined) throw notFound();
          await files.finalizeUpload(identity, uploadSessionId);
          return toResource(stored);
        },
      });
      return result.body;
    },
  };
}
