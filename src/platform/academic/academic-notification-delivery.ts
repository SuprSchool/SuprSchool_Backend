import { sql, type SQL } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import type { QueueMessage } from '../queue/queue-message.js';
import type { QueueExecutionContext, QueueMessageHandler } from '../queue/queue-worker.js';
import { ACADEMIC_EVENT_TYPES, type AcademicEventType } from './academic-outbox.js';

/**
 * The diary outbox publishes onto `notification_dispatch` too, so this handler
 * serves more than the academic outbox. Its payload carries a numeric
 * `revision`, which is why the payload is keyed to `unknown` rather than to
 * `string`.
 */
export const DIARY_PUBLISHED_EVENT_TYPE = 'diary.published';

export const NOTIFICATION_EVENT_TYPES = [
  ...ACADEMIC_EVENT_TYPES,
  DIARY_PUBLISHED_EVENT_TYPE,
] as const;

export type NotificationEventType = AcademicEventType | typeof DIARY_PUBLISHED_EVENT_TYPE;

export type AcademicQueueMessage = QueueMessage<Record<string, unknown>> & {
  eventType: NotificationEventType;
};

export interface AcademicNotificationRecipient {
  userId: string;
}

export interface PendingAcademicPush {
  expoPushTokens: ReadonlyArray<string>;
  userId: string;
}

export interface AcademicNotificationDeliveryStore {
  listPendingPushes(message: AcademicQueueMessage): Promise<ReadonlyArray<PendingAcademicPush>>;
  markPushDelivered(eventId: string, userId: string): Promise<void>;
  persistInboxAndPushes(
    message: AcademicQueueMessage,
    recipients: ReadonlyArray<AcademicNotificationRecipient>,
  ): Promise<void>;
  resolveRecipients(message: AcademicQueueMessage): Promise<ReadonlyArray<AcademicNotificationRecipient>>;
}

export interface AcademicPushSender {
  send(input: {
    body: string;
    eventId: string;
    expoPushTokens: ReadonlyArray<string>;
    idempotencyKey: string;
    title: string;
    userId: string;
  }): Promise<void>;
}

export class DrizzleAcademicNotificationDeliveryStore
  implements AcademicNotificationDeliveryStore {
  public constructor(private readonly database: Database) {}

  public async resolveRecipients(
    message: AcademicQueueMessage,
  ): Promise<ReadonlyArray<AcademicNotificationRecipient>> {
    const rows = await this.database.execute(sql`
      select distinct user_id
      from (${this.authorizedRecipientSelect(message)}) authorized
      where user_id is not null
      order by user_id
    `);
    return (rows as unknown as ReadonlyArray<{ user_id: string }>).map((row) => ({
      userId: row.user_id,
    }));
  }

  public async persistInboxAndPushes(
    message: AcademicQueueMessage,
    _recipients: ReadonlyArray<AcademicNotificationRecipient>,
  ): Promise<void> {
    void _recipients;
    const copy = notificationCopy(message.eventType);
    await this.database.execute(sql`
      with authorized as (
        select distinct user_id
        from (${this.authorizedRecipientSelect(message)}) recipient
        where user_id is not null
      ), inbox as (
        insert into public.notification_inbox (
          school_id, user_id, event_id, notification_type, title, body, data
        )
        select
          ${message.schoolId}::uuid,
          authorized.user_id,
          ${message.eventId}::uuid,
          ${message.eventType},
          ${copy.title},
          ${copy.body},
          ${JSON.stringify(message.payload)}::jsonb
        from authorized
        on conflict (event_id, user_id) where event_id is not null do nothing
        returning user_id
      )
      insert into public.notification_push_deliveries (
        event_id, school_id, user_id, title, body, data
      )
      select
        ${message.eventId}::uuid,
        ${message.schoolId}::uuid,
        authorized.user_id,
        ${copy.title},
        ${copy.body},
        ${JSON.stringify(message.payload)}::jsonb
      from authorized
      on conflict (event_id, user_id) do nothing
    `);
  }

  public async listPendingPushes(message: AcademicQueueMessage): Promise<ReadonlyArray<PendingAcademicPush>> {
    const eventId = message.eventId;
    await this.suppressStalePendingPushes(message);
    const rows = await this.database.execute(sql`
      select
        delivery.user_id,
        coalesce(array_agg(token.expo_push_token) filter (
          where token.expo_push_token is not null
        ), '{}') as expo_push_tokens
      from public.notification_push_deliveries delivery
      left join public.device_tokens token
        on token.school_id = delivery.school_id
        and token.user_id = delivery.user_id
        and token.disabled_at is null
      where delivery.event_id = ${eventId}::uuid
        and delivery.delivered_at is null
        and delivery.stale_at is null
      group by delivery.user_id
      order by delivery.user_id
    `);
    return (rows as unknown as ReadonlyArray<{
      expo_push_tokens: string[] | null;
      user_id: string;
    }>).map((row) => ({
      expoPushTokens: row.expo_push_tokens ?? [],
      userId: row.user_id,
    }));
  }

  private authorizedRecipientSelect(message: AcademicQueueMessage): SQL {
    return sql`
      select assignment.teacher_id as user_id
      from public.assignments assignment
      where ${message.eventType} = ${"assignment.submitted"}
        and assignment.id = ${message.payload.assignmentId ?? null}::uuid
        and assignment.school_id = ${message.schoolId}::uuid
        and assignment.deleted_at is null
        and exists (
          select 1
          from public.class_subjects subject
          where subject.school_id = assignment.school_id
            and subject.class_id = assignment.class_id
            and subject.subject_id = assignment.subject_id
            and subject.teacher_id = assignment.teacher_id
        )
      union
      select member.student_id as user_id
      from public.assignments assignment
      join public.class_members member
        on member.school_id = assignment.school_id
        and member.class_id = assignment.class_id
        and member.student_id = ${message.payload.studentId ?? null}::uuid
        and member.is_active
      where ${message.eventType} in (${"assignment.graded"}, ${"assignment.reminder.requested"})
        and assignment.id = ${message.payload.assignmentId ?? null}::uuid
        and assignment.school_id = ${message.schoolId}::uuid
        and assignment.deleted_at is null
        and exists (
          select 1
          from public.class_subjects subject
          where subject.school_id = assignment.school_id
            and subject.class_id = assignment.class_id
            and subject.subject_id = assignment.subject_id
            and subject.teacher_id = assignment.teacher_id
        )
      union
      select member.student_id as user_id
      from public.class_announcements announcement
      join public.class_members member
        on member.school_id = announcement.school_id
        and member.class_id = announcement.class_id
        and member.is_active
      where ${message.eventType} = ${"announcement.published"}
        and announcement.id = ${message.payload.announcementId ?? null}::uuid
        and announcement.school_id = ${message.schoolId}::uuid
        and announcement.is_published
        and exists (
          select 1
          from public.class_subjects subject
          where subject.school_id = announcement.school_id
            and subject.class_id = announcement.class_id
            and subject.subject_id = announcement.subject_id
            and subject.teacher_id = announcement.teacher_id
        )
      union
      select member.student_id as user_id
      from public.class_exams assessment
      join public.exam_groups exam_group
        on exam_group.id = assessment.exam_group_id
        and exam_group.school_id = assessment.school_id
        and exam_group.deleted_at is null
      join public.class_members member
        on member.school_id = assessment.school_id
        and member.class_id = assessment.class_id
        and member.is_active
      where ${message.eventType} in (${"exam.published"}, ${"exam.reminder.requested"}, ${"exam.results_published"})
        and assessment.id = ${message.payload.assessmentId ?? null}::uuid
        and assessment.school_id = ${message.schoolId}::uuid
        and assessment.deleted_at is null
        and assessment.is_published
        and (
          ${message.eventType} <> ${"exam.reminder.requested"}
          or member.student_id = ${message.payload.studentId ?? null}::uuid
        )
        and exists (
          select 1
          from public.class_subjects subject
          where subject.school_id = assessment.school_id
            and subject.class_id = assessment.class_id
            and subject.subject_id = assessment.subject_id
            and subject.teacher_id = assessment.teacher_id
        )
      union
      select member.student_id as user_id
      from public.class_diary_entries diary
      join public.class_members member
        on member.school_id = diary.school_id
        and member.class_id = diary.class_id
        and member.is_active
      where ${message.eventType} = ${DIARY_PUBLISHED_EVENT_TYPE}
        and diary.id = ${message.payload.diaryId ?? null}::uuid
        and diary.school_id = ${message.schoolId}::uuid
        and diary.deleted_at is null
        and exists (
          select 1
          from public.class_subjects subject
          where subject.id = diary.class_subject_id
            and subject.school_id = diary.school_id
            and subject.teacher_id = diary.teacher_id
        )
    `;
  }

  private async suppressStalePendingPushes(message: AcademicQueueMessage): Promise<void> {
    await this.database.execute(sql`
      with authorized as (${this.authorizedRecipientSelect(message)}), stale as (
        update public.notification_push_deliveries delivery
        set stale_at = now()
        where delivery.event_id = ${message.eventId}::uuid
          and delivery.school_id = ${message.schoolId}::uuid
          and delivery.delivered_at is null
          and delivery.stale_at is null
          and not exists (
            select 1 from authorized where authorized.user_id = delivery.user_id
          )
        returning delivery.user_id
      )
      update public.notification_inbox inbox
      set stale_at = now()
      where inbox.event_id = ${message.eventId}::uuid
        and inbox.school_id = ${message.schoolId}::uuid
        and inbox.stale_at is null
        and exists (select 1 from stale where stale.user_id = inbox.user_id)
    `);
  }

  public async markPushDelivered(eventId: string, userId: string): Promise<void> {
    await this.database.execute(sql`
      update public.notification_push_deliveries
      set delivered_at = now()
      where event_id = ${eventId}::uuid
        and user_id = ${userId}::uuid
        and delivered_at is null
    `);
  }
}

export class ExpoPushSender implements AcademicPushSender {
  public async send(input: {
    body: string;
    eventId: string;
    expoPushTokens: ReadonlyArray<string>;
    idempotencyKey: string;
    title: string;
    userId: string;
  }): Promise<void> {
    if (input.expoPushTokens.length === 0) return;
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      body: JSON.stringify(input.expoPushTokens.map((to) => ({
        body: input.body,
        data: {
          eventId: input.eventId,
          idempotencyKey: input.idempotencyKey,
          userId: input.userId,
        },
        title: input.title,
        to,
      }))),
      headers: {
        'content-type': 'application/json',
        'idempotency-key': input.idempotencyKey,
      },
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error('Expo push delivery failed with status ' + response.status);
    }
  }
}

export function createAcademicNotificationHandlers(
  store: AcademicNotificationDeliveryStore,
  push: AcademicPushSender,
): {
  notification: QueueMessageHandler<unknown>;
  reminder: QueueMessageHandler<unknown>;
} {
  const deliver = async (
    rawMessage: QueueMessage<unknown>,
    context: QueueExecutionContext,
  ): Promise<void> => {
    assertNotificationEventType(rawMessage.eventType);
    const message = rawMessage as AcademicQueueMessage;
    const recipients = await store.resolveRecipients(message);
    await store.persistInboxAndPushes(message, recipients);
    for (const pending of await store.listPendingPushes(message)) {
      const copy = notificationCopy(message.eventType);
      await push.send({
        body: copy.body,
        eventId: message.eventId,
        expoPushTokens: pending.expoPushTokens,
        idempotencyKey: context.providerIdempotencyKey + ':' + pending.userId,
        title: copy.title,
        userId: pending.userId,
      });
      await store.markPushDelivered(message.eventId, pending.userId);
    }
  };

  return { notification: deliver, reminder: deliver };
}

function assertNotificationEventType(
  eventType: string,
): asserts eventType is NotificationEventType {
  if (!(NOTIFICATION_EVENT_TYPES as readonly string[]).includes(eventType)) {
    throw new Error(`Unsupported notification event type: ${eventType}`);
  }
}

function notificationCopy(eventType: NotificationEventType): { body: string; title: string } {
  switch (eventType) {
    case 'announcement.published':
      return { body: 'A new class announcement is available.', title: 'New announcement' };
    case 'assignment.submitted':
      return { body: 'A student submitted an assignment.', title: 'Assignment submitted' };
    case 'assignment.graded':
      return { body: 'Your assignment has been graded.', title: 'Assignment graded' };
    case 'assignment.reminder.requested':
      return { body: 'You have an assignment reminder.', title: 'Assignment reminder' };
    case 'exam.published':
      return { body: 'A new exam has been published.', title: 'Exam published' };
    case 'exam.reminder.requested':
      return { body: 'You have an exam reminder.', title: 'Exam reminder' };
    case 'exam.results_published':
      return { body: 'Exam results are now available.', title: 'Exam results published' };
    case DIARY_PUBLISHED_EVENT_TYPE:
      return { body: 'A new class diary entry is available.', title: 'New diary entry' };
    default: {
      // A queue payload is untrusted input; without this the switch fell
      // through and every caller dereferenced `undefined`.
      const unsupported: never = eventType;
      throw new Error(`Unsupported notification event type: ${String(unsupported)}`);
    }
  }
}
