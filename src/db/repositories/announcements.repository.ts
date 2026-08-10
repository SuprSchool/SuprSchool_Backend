import {
  and,
  desc,
  eq,
  exists,
  ilike,
  lt,
  or,
  sql,
} from 'drizzle-orm';

import type { Database } from '../client.js';
import { classMembers, classSubjects, userRoles } from '../schema/core.js';
import { announcementResources, classAnnouncements } from '../schema/announcements.js';
import type {
  AnnouncementCategory,
  AnnouncementDetail,
  AnnouncementIdentity,
  AnnouncementListItem,
  AnnouncementListQuery,
  AnnouncementResourceType,
  CreateAnnouncementInput,
  CursorPage,
  TeacherAnnouncement,
  TeacherAnnouncementListQuery,
  UpdateAnnouncementInput,
} from '../../types/announcements.js';
import {
  encodeAnnouncementPublishedCursor,
  encodeTeacherAnnouncementCursor,
} from '../../types/announcements.js';

export interface StoredAnnouncementResource {
  id: string;
  name: string;
  objectPath: string;
  type: AnnouncementResourceType;
}

export interface StoredAnnouncementDetail extends Omit<AnnouncementDetail, 'imageUri' | 'resources'> {
  imageObjectPath?: string | undefined;
  resources: ReadonlyArray<StoredAnnouncementResource>;
}

export type AnnouncementPublicationCallback = (
  transaction: Database,
  announcement: StoredAnnouncementDetail,
) => Promise<void>;

export interface AnnouncementsRepository {
  canManage(identity: AnnouncementIdentity, announcementId: string): Promise<boolean>;
  create(identity: AnnouncementIdentity, input: CreateAnnouncementInput): Promise<StoredAnnouncementDetail | undefined>;
  delete(identity: AnnouncementIdentity, announcementId: string): Promise<boolean>;
  deleteResource(
    identity: AnnouncementIdentity,
    announcementId: string,
    resourceId: string,
  ): Promise<StoredAnnouncementResource | undefined>;
  findForStudent(identity: AnnouncementIdentity, announcementId: string): Promise<StoredAnnouncementDetail | undefined>;
  findForTeacher(identity: AnnouncementIdentity, announcementId: string): Promise<StoredAnnouncementDetail | undefined>;
  findResourceForDeletion(
    identity: AnnouncementIdentity,
    announcementId: string,
    resourceId: string,
  ): Promise<StoredAnnouncementResource | undefined>;
  findResourceForUpload(input: {
    announcementId: string;
    identity: AnnouncementIdentity;
    uploadSessionId: string;
  }): Promise<StoredAnnouncementResource | undefined>;
  insertResource(input: {
    announcementId: string;
    displayName: string;
    identity: AnnouncementIdentity;
    objectPath: string;
    resourceType: AnnouncementResourceType;
    schoolId: string;
    uploadSessionId: string;
  }): Promise<StoredAnnouncementResource | undefined>;
  listForStudent(identity: AnnouncementIdentity, query: AnnouncementListQuery): Promise<CursorPage<AnnouncementListItem>>;
  listForTeacher(identity: AnnouncementIdentity, query: TeacherAnnouncementListQuery): Promise<CursorPage<TeacherAnnouncement>>;
  publish(
    identity: AnnouncementIdentity,
    announcementId: string,
    publishedAt: Date,
    afterPublish?: AnnouncementPublicationCallback,
  ): Promise<StoredAnnouncementDetail | 'already_published' | undefined>;
  update(identity: AnnouncementIdentity, announcementId: string, input: UpdateAnnouncementInput): Promise<StoredAnnouncementDetail | 'already_published' | undefined>;
}

type AnnouncementRow = {
  audienceType: 'class' | 'school';
  body: string;
  category: AnnouncementCategory;
  classId: string | null;
  createdAt: Date;
  eventAt: Date | null;
  id: string;
  isPublished: boolean;
  location: string | null;
  publishedAt: Date | null;
  schoolId: string;
  subjectId: string | null;
  teacherId: string;
  title: string;
  updatedAt: Date;
};

function minutesToRead(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

export class DrizzleAnnouncementsRepository implements AnnouncementsRepository {
  public constructor(private readonly db: Database) {}

  public async listForStudent(
    identity: AnnouncementIdentity,
    query: AnnouncementListQuery,
  ): Promise<CursorPage<AnnouncementListItem>> {
    const cursor = query.cursor;
    const rows = await this.db
      .select({
        attachmentCount: sql<number>`(
          select count(*)::int
          from ${announcementResources}
          where ${announcementResources.schoolId} = ${classAnnouncements.schoolId}
            and ${announcementResources.announcementId} = ${classAnnouncements.id}
        )`,
        body: classAnnouncements.body,
        category: classAnnouncements.category,
        id: classAnnouncements.id,
        publishedAt: classAnnouncements.publishedAt,
        title: classAnnouncements.title,
      })
      .from(classAnnouncements)
      .where(and(
        eq(classAnnouncements.schoolId, identity.schoolId),
        eq(classAnnouncements.isPublished, true),
        this.studentAudience(identity),
        query.category === undefined ? undefined : eq(classAnnouncements.category, query.category),
        query.search === undefined ? undefined : or(
          ilike(classAnnouncements.title, `%${query.search}%`),
          ilike(classAnnouncements.body, `%${query.search}%`),
        ),
        cursor === undefined ? undefined : or(
          lt(classAnnouncements.publishedAt, new Date(cursor.publishedAt)),
          and(
            eq(classAnnouncements.publishedAt, new Date(cursor.publishedAt)),
            lt(classAnnouncements.id, cursor.id),
          ),
        ),
      ))
      .orderBy(desc(classAnnouncements.publishedAt), desc(classAnnouncements.id))
      .limit(query.limit + 1);

    const pageRows = rows.slice(0, query.limit);
    const items = pageRows.flatMap((row) => row.publishedAt === null ? [] : [{
      attachmentCount: Number(row.attachmentCount),
      body: row.body,
      category: row.category,
      id: row.id,
      publishedAt: row.publishedAt.toISOString(),
      readTimeMinutes: minutesToRead(row.body),
      title: row.title,
    }]);
    const last = items.at(-1);
    return {
      items,
      ...(rows.length > query.limit && last !== undefined ? {
        nextCursor: encodeAnnouncementPublishedCursor({ id: last.id, publishedAt: last.publishedAt }),
      } : {}),
    };
  }

  public async findForStudent(
    identity: AnnouncementIdentity,
    announcementId: string,
  ): Promise<StoredAnnouncementDetail | undefined> {
    const record = await this.findOne(and(
      eq(classAnnouncements.id, announcementId),
      eq(classAnnouncements.schoolId, identity.schoolId),
      eq(classAnnouncements.isPublished, true),
      this.studentAudience(identity),
    ));
    return record === undefined ? undefined : this.withResources(record);
  }

  public async listForTeacher(
    identity: AnnouncementIdentity,
    query: TeacherAnnouncementListQuery,
  ): Promise<CursorPage<TeacherAnnouncement>> {
    const cursor = query.cursor;
    const rows = await this.db
      .select({
        audienceType: classAnnouncements.audienceType,
        body: classAnnouncements.body,
        category: classAnnouncements.category,
        classId: classAnnouncements.classId,
        createdAt: classAnnouncements.createdAt,
        eventAt: classAnnouncements.eventAt,
        id: classAnnouncements.id,
        location: classAnnouncements.location,
        publishedAt: classAnnouncements.publishedAt,
        subjectId: classAnnouncements.subjectId,
        teacherId: classAnnouncements.teacherId,
        title: classAnnouncements.title,
      })
      .from(classAnnouncements)
      .where(and(
        eq(classAnnouncements.schoolId, identity.schoolId),
        this.activeRole(identity, 'teacher'),
        query.scope === 'all'
          ? or(
            eq(classAnnouncements.isPublished, true),
            eq(classAnnouncements.teacherId, identity.userId),
          )
          : and(
            eq(classAnnouncements.teacherId, identity.userId),
            this.teacherCanManage(identity),
          ),
        cursor === undefined ? undefined : or(
          lt(classAnnouncements.createdAt, new Date(cursor.createdAt)),
          and(
            eq(classAnnouncements.createdAt, new Date(cursor.createdAt)),
            lt(classAnnouncements.id, cursor.id),
          ),
        ),
      ))
      .orderBy(desc(classAnnouncements.createdAt), desc(classAnnouncements.id))
      .limit(query.limit + 1);

    const pageRows = rows.slice(0, query.limit);
    const items = pageRows.map((row) => ({
      audienceType: row.audienceType,
      ...(row.classId === null ? {} : { classId: row.classId }),
      description: row.body,
      eventAt: toIso(row.eventAt),
      id: row.id,
      isOwn: row.teacherId === identity.userId,
      location: row.location,
      publishedAt: toIso(row.publishedAt),
      ...(row.subjectId === null ? {} : { subjectId: row.subjectId }),
      title: row.title,
      type: row.category,
    }));
    const last = pageRows.at(-1);
    return {
      items,
      ...(rows.length > query.limit && last !== undefined ? {
        nextCursor: encodeTeacherAnnouncementCursor({
          createdAt: last.createdAt.toISOString(),
          id: last.id,
        }),
      } : {}),
    };
  }

  public async create(
    identity: AnnouncementIdentity,
    input: CreateAnnouncementInput,
  ): Promise<StoredAnnouncementDetail | undefined> {
    const rows = await this.db.execute(sql<AnnouncementRow>`
      insert into public.class_announcements (
        school_id, audience_type, class_id, subject_id, teacher_id, category, title, body,
        location, event_at
      )
      select
        ${identity.schoolId}::uuid,
        ${input.audienceType},
        ${input.classId ?? null}::uuid,
        ${input.subjectId ?? null}::uuid,
        ${identity.userId}::uuid,
        ${input.category},
        ${input.title},
        ${input.body},
        ${input.location ?? null}::text,
        ${input.eventAt ?? null}::timestamptz
      from public.user_roles teacher_role
      where teacher_role.school_id = ${identity.schoolId}::uuid
        and teacher_role.user_id = ${identity.userId}::uuid
        and teacher_role.role = 'teacher'
        and teacher_role.is_active
        and (
          ${input.audienceType} = 'school'
          or exists (
            select 1 from public.class_subjects subject
            where subject.school_id = ${identity.schoolId}::uuid
              and subject.class_id = ${input.classId ?? null}::uuid
              and subject.subject_id = ${input.subjectId ?? null}::uuid
              and subject.teacher_id = ${identity.userId}::uuid
          )
        )
      returning
        audience_type as "audienceType",
        body,
        category,
        class_id as "classId",
        created_at as "createdAt",
        event_at as "eventAt",
        id,
        is_published as "isPublished",
        location,
        published_at as "publishedAt",
        school_id as "schoolId",
        subject_id as "subjectId",
        teacher_id as "teacherId",
        title,
        updated_at as "updatedAt"
    `) as unknown as ReadonlyArray<AnnouncementRow>;
    const created = rows[0];
    return created === undefined ? undefined : this.withResources(created);
  }

  public async delete(
    identity: AnnouncementIdentity,
    announcementId: string,
  ): Promise<boolean> {
    const [deleted] = await this.db
      .delete(classAnnouncements)
      .where(and(
        eq(classAnnouncements.id, announcementId),
        eq(classAnnouncements.schoolId, identity.schoolId),
        eq(classAnnouncements.teacherId, identity.userId),
        this.teacherCanManage(identity),
      ))
      .returning({ id: classAnnouncements.id });
    return deleted !== undefined;
  }

  public async update(
    identity: AnnouncementIdentity,
    announcementId: string,
    input: UpdateAnnouncementInput,
  ): Promise<StoredAnnouncementDetail | 'already_published' | undefined> {
    const audienceFields = input.audienceType === undefined
      ? {}
      : input.audienceType === 'school'
        ? { audienceType: 'school' as const, classId: null, subjectId: null }
        : { audienceType: 'class' as const, classId: input.classId, subjectId: input.subjectId };
    const targetAuthorization = input.audienceType === undefined
      ? undefined
      : input.audienceType === 'school'
        ? this.activeRole(identity, 'teacher')
        : exists(this.db.select({ id: classSubjects.id }).from(classSubjects).where(and(
          eq(classSubjects.schoolId, identity.schoolId),
          eq(classSubjects.classId, input.classId!),
          eq(classSubjects.subjectId, input.subjectId!),
          eq(classSubjects.teacherId, identity.userId),
        )));
    const content = {
      ...(input.body === undefined ? {} : { body: input.body }),
      ...(input.category === undefined ? {} : { category: input.category }),
      ...(input.eventAt === undefined ? {} : { eventAt: new Date(input.eventAt) }),
      ...(input.location === undefined ? {} : { location: input.location }),
      ...(input.title === undefined ? {} : { title: input.title }),
    };
    const [updated] = await this.db
      .update(classAnnouncements)
      .set({ ...content, ...audienceFields, updatedAt: new Date() })
      .where(and(
        eq(classAnnouncements.id, announcementId),
        eq(classAnnouncements.schoolId, identity.schoolId),
        eq(classAnnouncements.teacherId, identity.userId),
        this.teacherCanManage(identity),
        targetAuthorization,
      ))
      .returning();
    return updated === undefined ? undefined : this.withResources(updated);
  }

  public async publish(
    identity: AnnouncementIdentity,
    announcementId: string,
    publishedAt: Date,
    afterPublish?: AnnouncementPublicationCallback,
  ): Promise<StoredAnnouncementDetail | 'already_published' | undefined> {
    return this.db.transaction(async (transaction) => {
      const database = transaction as unknown as Database;
      const current = await this.findManaged(identity, announcementId, database);
      if (current === undefined) {
        return undefined;
      }
      if (current.isPublished) {
        return 'already_published';
      }
      const [published] = await database
        .update(classAnnouncements)
        .set({ isPublished: true, publishedAt, updatedAt: publishedAt })
        .where(and(
          eq(classAnnouncements.id, announcementId),
          eq(classAnnouncements.schoolId, identity.schoolId),
          eq(classAnnouncements.teacherId, identity.userId),
          eq(classAnnouncements.isPublished, false),
          this.teacherCanManage(identity, database),
        ))
        .returning();
      if (published === undefined) {
        const after = await this.findManaged(identity, announcementId, database);
        return after?.isPublished === true ? 'already_published' : undefined;
      }
      const detail = await this.withResources(published, database);
      if (afterPublish !== undefined) {
        await afterPublish(database, detail);
      }
      return detail;
    });
  }

  public async canManage(identity: AnnouncementIdentity, announcementId: string): Promise<boolean> {
    return (await this.findManaged(identity, announcementId)) !== undefined;
  }

  public async findForTeacher(
    identity: AnnouncementIdentity,
    announcementId: string,
  ): Promise<StoredAnnouncementDetail | undefined> {
    const record = await this.findOne(and(
      eq(classAnnouncements.id, announcementId),
      eq(classAnnouncements.schoolId, identity.schoolId),
      this.activeRole(identity, 'teacher'),
      or(
        eq(classAnnouncements.isPublished, true),
        eq(classAnnouncements.teacherId, identity.userId),
      ),
    ));
    return record === undefined ? undefined : this.withResources(record);
  }

  public async findResourceForDeletion(
    identity: AnnouncementIdentity,
    announcementId: string,
    resourceId: string,
  ): Promise<StoredAnnouncementResource | undefined> {
    const [resource] = await this.db
      .select({
        id: announcementResources.id,
        name: announcementResources.displayName,
        objectPath: announcementResources.objectPath,
        type: announcementResources.resourceType,
      })
      .from(announcementResources)
      .innerJoin(classAnnouncements, and(
        eq(classAnnouncements.id, announcementResources.announcementId),
        eq(classAnnouncements.schoolId, announcementResources.schoolId),
      ))
      .where(and(
        eq(announcementResources.id, resourceId),
        eq(announcementResources.schoolId, identity.schoolId),
        eq(announcementResources.announcementId, announcementId),
        eq(classAnnouncements.teacherId, identity.userId),
        this.teacherCanManage(identity),
      ))
      .limit(1);
    return resource;
  }

  public async deleteResource(
    identity: AnnouncementIdentity,
    announcementId: string,
    resourceId: string,
  ): Promise<StoredAnnouncementResource | undefined> {
    const rows = await this.db.execute(sql<StoredAnnouncementResource>`
      delete from public.announcement_resources resource
      using public.class_announcements announcement
      where resource.id = ${resourceId}::uuid
        and resource.school_id = ${identity.schoolId}::uuid
        and resource.announcement_id = ${announcementId}::uuid
        and announcement.id = resource.announcement_id
        and announcement.school_id = resource.school_id
        and announcement.teacher_id = ${identity.userId}::uuid
        and (
          (announcement.audience_type = 'school' and exists (
            select 1 from public.user_roles role
            where role.school_id = announcement.school_id
              and role.user_id = ${identity.userId}::uuid
              and role.role = 'teacher' and role.is_active
          ))
          or (announcement.audience_type = 'class' and exists (
            select 1 from public.class_subjects subject
            where subject.school_id = announcement.school_id
              and subject.class_id = announcement.class_id
              and subject.subject_id = announcement.subject_id
              and subject.teacher_id = ${identity.userId}::uuid
          ))
        )
      returning resource.id, resource.display_name as name,
        resource.object_path as "objectPath", resource.resource_type as type
    `) as unknown as ReadonlyArray<StoredAnnouncementResource>;
    return rows[0];
  }

  public async findResourceForUpload(input: {
    announcementId: string;
    identity: AnnouncementIdentity;
    uploadSessionId: string;
  }): Promise<StoredAnnouncementResource | undefined> {
    const rows = await this.db.execute(sql<StoredAnnouncementResource>`
      select resource.id, resource.display_name as name, resource.object_path as "objectPath",
        resource.resource_type as type
      from public.announcement_resources resource
      join public.class_announcements announcement
        on announcement.id = resource.announcement_id
        and announcement.school_id = resource.school_id
      where resource.school_id = ${input.identity.schoolId}::uuid
        and resource.announcement_id = ${input.announcementId}::uuid
        and resource.upload_session_id = ${input.uploadSessionId}::uuid
        and announcement.teacher_id = ${input.identity.userId}::uuid
        and (
          (
            announcement.audience_type = 'school'
            and exists (
              select 1 from public.user_roles role
              where role.school_id = announcement.school_id
                and role.user_id = ${input.identity.userId}::uuid
                and role.role = 'teacher'
                and role.is_active
            )
          )
          or (
            announcement.audience_type = 'class'
            and exists (
              select 1 from public.class_subjects subject
              where subject.school_id = announcement.school_id
                and subject.class_id = announcement.class_id
                and subject.subject_id = announcement.subject_id
                and subject.teacher_id = ${input.identity.userId}::uuid
            )
          )
        )
      limit 1
    `) as unknown as ReadonlyArray<StoredAnnouncementResource>;
    return rows[0];
  }

  public async insertResource(input: {
    announcementId: string;
    displayName: string;
    identity: AnnouncementIdentity;
    objectPath: string;
    resourceType: AnnouncementResourceType;
    schoolId: string;
    uploadSessionId: string;
  }): Promise<StoredAnnouncementResource | undefined> {
    const rows = await this.db.execute(sql<StoredAnnouncementResource>`
      with allowed as (
        select announcement.id as announcement_id
        from public.class_announcements announcement
        where announcement.id = ${input.announcementId}::uuid
          and announcement.school_id = ${input.schoolId}::uuid
          and announcement.teacher_id = ${input.identity.userId}::uuid
          and (
            (
              announcement.audience_type = 'school'
              and exists (
                select 1 from public.user_roles role
                where role.school_id = announcement.school_id
                  and role.user_id = ${input.identity.userId}::uuid
                  and role.role = 'teacher'
                  and role.is_active
              )
            )
            or (
              announcement.audience_type = 'class'
              and exists (
                select 1 from public.class_subjects subject
                where subject.school_id = announcement.school_id
                  and subject.class_id = announcement.class_id
                  and subject.subject_id = announcement.subject_id
                  and subject.teacher_id = ${input.identity.userId}::uuid
              )
            )
          )
      ), inserted as (
        insert into public.announcement_resources (
          school_id, announcement_id, upload_session_id, object_path, display_name, resource_type
        )
        select
          ${input.schoolId}::uuid,
          allowed.announcement_id,
          ${input.uploadSessionId}::uuid,
          ${input.objectPath},
          ${input.displayName},
          ${input.resourceType}
        from allowed
        on conflict (upload_session_id) do nothing
        returning id, display_name as name, object_path as "objectPath", resource_type as type
      )
      select * from inserted
      union all
      select resource.id, resource.display_name as name, resource.object_path as "objectPath",
        resource.resource_type as type
      from public.announcement_resources resource
      join allowed on allowed.announcement_id = resource.announcement_id
      where resource.school_id = ${input.schoolId}::uuid
        and resource.upload_session_id = ${input.uploadSessionId}::uuid
        and not exists (select 1 from inserted)
      limit 1
    `) as unknown as ReadonlyArray<StoredAnnouncementResource>;
    return rows[0];
  }

  private studentAudience(identity: AnnouncementIdentity) {
    return or(
      and(
        eq(classAnnouncements.audienceType, 'school'),
        this.activeRole(identity, 'student'),
      ),
      and(
        eq(classAnnouncements.audienceType, 'class'),
        exists(this.db
          .select({ id: classMembers.id })
          .from(classMembers)
          .where(and(
            eq(classMembers.schoolId, identity.schoolId),
            eq(classMembers.studentId, identity.userId),
            eq(classMembers.classId, classAnnouncements.classId),
            eq(classMembers.isActive, true),
          ))),
      ),
    );
  }

  private activeRole(
    identity: AnnouncementIdentity,
    role: 'student' | 'teacher',
    database: Database = this.db,
  ) {
    return exists(database
      .select({ id: userRoles.id })
      .from(userRoles)
      .where(and(
        eq(userRoles.schoolId, identity.schoolId),
        eq(userRoles.userId, identity.userId),
        eq(userRoles.role, role),
        eq(userRoles.isActive, true),
      )));
  }

  private teacherAssignment(
    identity: AnnouncementIdentity,
    database: Database = this.db,
  ) {
    return exists(database
      .select({ id: classSubjects.id })
      .from(classSubjects)
      .where(and(
        eq(classSubjects.schoolId, identity.schoolId),
        eq(classSubjects.classId, classAnnouncements.classId),
        eq(classSubjects.subjectId, classAnnouncements.subjectId),
        eq(classSubjects.teacherId, identity.userId),
      )));
  }

  private teacherCanManage(
    identity: AnnouncementIdentity,
    database: Database = this.db,
  ) {
    return or(
      and(
        eq(classAnnouncements.audienceType, 'school'),
        this.activeRole(identity, 'teacher', database),
      ),
      and(
        eq(classAnnouncements.audienceType, 'class'),
        this.teacherAssignment(identity, database),
      ),
    );
  }

  private async findManaged(
    identity: AnnouncementIdentity,
    announcementId: string,
    database: Database = this.db,
  ): Promise<AnnouncementRow | undefined> {
    return this.findOne(and(
      eq(classAnnouncements.id, announcementId),
      eq(classAnnouncements.schoolId, identity.schoolId),
      eq(classAnnouncements.teacherId, identity.userId),
      this.teacherCanManage(identity, database),
    ), database);
  }

  private async findOne(
    condition: ReturnType<typeof and>,
    database: Database = this.db,
  ): Promise<AnnouncementRow | undefined> {
    const [record] = await database
      .select({
        audienceType: classAnnouncements.audienceType,
        body: classAnnouncements.body,
        category: classAnnouncements.category,
        classId: classAnnouncements.classId,
        createdAt: classAnnouncements.createdAt,
        eventAt: classAnnouncements.eventAt,
        id: classAnnouncements.id,
        isPublished: classAnnouncements.isPublished,
        location: classAnnouncements.location,
        publishedAt: classAnnouncements.publishedAt,
        schoolId: classAnnouncements.schoolId,
        subjectId: classAnnouncements.subjectId,
        teacherId: classAnnouncements.teacherId,
        title: classAnnouncements.title,
        updatedAt: classAnnouncements.updatedAt,
      })
      .from(classAnnouncements)
      .where(condition)
      .limit(1);
    return record;
  }

  private async withResources(
    record: AnnouncementRow,
    database: Database = this.db,
  ): Promise<StoredAnnouncementDetail> {
    const resources = await database
      .select({
        id: announcementResources.id,
        name: announcementResources.displayName,
        objectPath: announcementResources.objectPath,
        type: announcementResources.resourceType,
      })
      .from(announcementResources)
      .where(and(
        eq(announcementResources.schoolId, record.schoolId),
        eq(announcementResources.announcementId, record.id),
      ))
      .orderBy(desc(announcementResources.createdAt), desc(announcementResources.id));
    const image = resources.find((resource) => (
      resource.type === 'image' && resource.name.startsWith('announcement-banner-')
    ));
    return {
      attachmentCount: resources.length,
      audienceType: record.audienceType,
      body: record.body,
      category: record.category,
      ...(record.classId === null ? {} : { classId: record.classId }),
      description: record.body,
      eventAt: toIso(record.eventAt),
      id: record.id,
      ...(image === undefined ? {} : { imageObjectPath: image.objectPath }),
      location: record.location,
      publishedAt: toIso(record.publishedAt),
      readTimeMinutes: minutesToRead(record.body),
      resources,
      ...(record.subjectId === null ? {} : { subjectId: record.subjectId }),
      title: record.title,
    };
  }
}
