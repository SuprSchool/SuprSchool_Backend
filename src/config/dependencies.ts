import type { AppDependencies } from "../app.js";
import { createDatabase, type Database } from "../db/client.js";
import { DrizzleAnnouncementsRepository } from "../db/repositories/announcements.repository.js";
import { DrizzleAssignmentsRepository } from "../db/repositories/assignments.repository.js";
import { DrizzleExamsRepository } from "../db/repositories/exams.repository.js";
import { DrizzleAttendanceRepository } from "../db/repositories/attendance.repository.js";
import { DrizzleContactAdminRepository } from "../db/repositories/contact-admin.repository.js";
import { DrizzleNotificationRepository } from "../db/repositories/notification.repository.js";
import { DrizzlePasswordResetChallengeRepository } from "../db/repositories/password-reset-challenge.repository.js";
import { DrizzleSchoolDirectoryRepository } from "../db/repositories/school-directory.repository.js";
import { DrizzleSignupChallengeRepository } from "../db/repositories/signup-challenge.repository.js";
import { DrizzleStudentHomeRepository } from "../db/repositories/student-home.repository.js";
import { DrizzleTeacherClassesRepository } from "../db/repositories/teacher-classes.repository.js";
import { DrizzleRecordingsRepository } from "../db/repositories/recordings.repository.js";
import { DrizzleDiaryRepository } from "../db/repositories/diary.repository.js";
import { DrizzleEventsRepository } from "../db/repositories/drizzle-events.repository.js";
import { DrizzleChatRepository } from "../db/repositories/chat.repository.js";
import { DrizzleCommunityProfileRepository } from "../db/repositories/community-profile.repository.js";
import { DrizzlePointsRepository } from "../db/repositories/points.repository.js";
import { DrizzleProfileRepository } from "../db/repositories/profile.repository.js";
import { DrizzleRankingRepository } from "../db/repositories/ranking.repository.js";
import { DiaryOutbox } from "../async/diary/diary-outbox.js";
import {
  createAuthenticate,
  createSupabaseTokenVerifier,
} from "../middleware/authenticate.js";
import { createAttendanceService } from "../services/attendance.service.js";
import { createAuthService } from "../services/auth.service.js";
import { createNotificationService } from "../services/notification.service.js";
import { createStudentHomeService } from "../services/student-home.service.js";
import { createSupabaseAuthClient } from "../services/supabase-auth.service.js";
import {
  createDevelopmentOtpVerifier,
  createTwilioVerifyAdapter,
} from "../services/twilio-verify.service.js";
import { TeacherClassesService } from "../services/teacher-classes.service.js";
import { DrizzleScheduleRepository } from "../db/repositories/schedule.repository.js";
import { DrizzleStudentClassContextRepository } from "../db/repositories/student-class-context.repository.js";
import { DrizzleTeacherClassContextRepository } from "../db/repositories/teacher-class-context.repository.js";
import { createScheduleService } from "../services/schedule.service.js";
import { StudentClassContextService } from "../services/student-class-context.service.js";
import { createRecordingService } from "../services/recordings.service.js";
import { createDiaryService } from "../services/diary.service.js";
import { createEventsService } from "../services/events.service.js";
import {
  DatabaseIdempotencyRecordStore,
  IdempotencyStore,
} from "../platform/idempotency/idempotency-store.js";
import { TeacherClassContextService } from "../services/teacher-class-context.service.js";
import type { Env } from "./env.js";

import {
  AvatarUploadParentAuthorizer,
  CompositeUploadParentAuthorizer,
  createRuntimePlatformDependencies,
} from "./platform-dependencies.js";
import { AcademicCache } from "../platform/academic/academic-cache.js";
import { AcademicOutbox } from "../platform/academic/academic-outbox.js";
import { createAcademicMutationExecutor } from "../platform/academic/academic-mutation-executor.js";
import {
  AcademicFileService,
  AcademicUploadParentAuthorizer,
} from "../platform/storage/academic-file-service.js";
import {
  ChatAttachmentFileService,
  ChatAttachmentUploadParentAuthorizer,
} from "../platform/storage/chat-attachment-file-service.js";
import {
  RecordingResourceFileService,
  RecordingResourceUploadParentAuthorizer,
} from "../platform/storage/recording-resource-file-service.js";
import { createAnnouncementsService } from "../services/announcements.service.js";
import { createAssignmentsService } from "../services/assignments.service.js";
import { createExamsService } from "../services/exams.service.js";
import { AvatarService, CacheAvatarRateLimiter } from "../services/avatar.service.js";
import { createChatService } from "../services/chat.service.js";
import { createCommunityProfileService } from "../services/community-profile.service.js";
import { PointsService } from "../services/points.service.js";
import { PointAwardGateway } from "../services/point-award.service.js";
import { createProfileService } from "../services/profile.service.js";
import { RankingRefreshService } from "../services/ranking-refresh.service.js";
import { sql } from "drizzle-orm";
export function createRuntimeDependencies(env: Env): AppDependencies {
  const { db } = createDatabase(env);
  const schoolDirectory = new DrizzleSchoolDirectoryRepository(db);
  const attendance = new DrizzleAttendanceRepository(db);
  const studentHome = new DrizzleStudentHomeRepository(db);
  const teacherClasses = new DrizzleTeacherClassesRepository(db);
  const schedule = new DrizzleScheduleRepository(db);
  const notifications = new DrizzleNotificationRepository(db);
  const studentClassContext = new DrizzleStudentClassContextRepository(db);
  const teacherClassContext = new DrizzleTeacherClassContextRepository(db);
  const recordings = new DrizzleRecordingsRepository(db);
  const idempotency = new IdempotencyStore(
    new DatabaseIdempotencyRecordStore(db),
  );
  const diaryOutbox = new DiaryOutbox(db);
  const diary = new DrizzleDiaryRepository(db, diaryOutbox);
  const events = new DrizzleEventsRepository(db);
  const announcements = new DrizzleAnnouncementsRepository(db);
  const assignments = new DrizzleAssignmentsRepository(db);
  const exams = new DrizzleExamsRepository(db);
  const profiles = new DrizzleProfileRepository(db);
  const chat = new DrizzleChatRepository(db);
  const community = new DrizzleCommunityProfileRepository(db);
  const pointsRepository = new DrizzlePointsRepository(db);
  const rankingRepository = new DrizzleRankingRepository(db);
  const pointAwards = new PointAwardGateway({ repository: pointsRepository });
  const platform = createRuntimePlatformDependencies(env, {
    database: db,
    parentAuthorizer: new CompositeUploadParentAuthorizer([
      new AcademicUploadParentAuthorizer({
        announcements,
        assignments,
        events,
        exams,
      }),
      new RecordingResourceUploadParentAuthorizer(recordings),
      new ChatAttachmentUploadParentAuthorizer(chat),
      new AvatarUploadParentAuthorizer(),
    ]),
  });
  const files = new AcademicFileService(platform.storage);
  const chatFiles = new ChatAttachmentFileService(platform.storage);
  const recordingFiles = new RecordingResourceFileService(platform.storage);
  const cache = new AcademicCache(platform.cache);
  const outbox = new AcademicOutbox(db);
  const mutations = createAcademicMutationExecutor(idempotency);
  const rankings = new RankingRefreshService({
    queue: platform.queue,
    repository: rankingRepository,
  });
  const communityReaders = createCommunityReaders(db);
  /*
    Built here rather than inline in the returned object because the community
    service now reads through it: viewing another student's profile needs that
    student's name, avatar and interests, and `getProfile` is the one place
    that signs an uploaded avatar into a URL.
  */
  const profileService = createProfileService({
    repository: profiles,
    avatarUrlSigner: {
      createSignedDownloadUrl: (bucket, objectPath) =>
        platform.storage.createSignedReadUrl(bucket, objectPath, 15 * 60),
    },
  });
  const communityProfileService = createCommunityProfileService({
    assessmentSummaryReader: communityReaders,
    eventSummaryReader: {
      countConducted: (schoolId, teacherId) => communityReaders.countConducted(schoolId, teacherId),
      countParticipated: (schoolId, studentId) => (
        communityReaders.countParticipated(schoolId, studentId)
      ),
      // The visible-events query lives with the rest of the community SQL now
      // that the card carries a banner, a registration count and eligibility.
      listVisible: (identity) => community.findVisibleSchoolEvents(identity),
    },
    profileDescriptorReader: profileService,
    repository: community,
    schoolAssetUrlSigner: {
      createSignedDownloadUrl: (bucket, objectPath, expiresInSeconds) =>
        platform.storage.createSignedReadUrl(bucket, objectPath, expiresInSeconds),
    },
    studentProgressSummaryReader: communityReaders,
  });
  const supabase = createSupabaseAuthClient(
    env.SUPABASE_URL,
    env.SUPABASE_PUBLISHABLE_KEY,
    { secretKey: env.SUPABASE_SECRET_KEY },
  );
  const otp =
    env.TWILIO_ACCOUNT_SID &&
    env.TWILIO_AUTH_TOKEN &&
    env.TWILIO_VERIFY_SERVICE_SID
      ? createTwilioVerifyAdapter({
          accountSid: env.TWILIO_ACCOUNT_SID,
          authToken: env.TWILIO_AUTH_TOKEN,
          serviceSid: env.TWILIO_VERIFY_SERVICE_SID,
        })
      : createDevelopmentOtpVerifier({ code: "0000" });

  return {
    attendanceService: createAttendanceService({ pointAwards, repository: attendance }),
    avatarService: new AvatarService({
      limiter: new CacheAvatarRateLimiter(platform.cache),
      profiles,
      queue: platform.queue,
      storage: platform.storage,
    }),
    chatService: createChatService({
      cache: platform.cache,
      files: chatFiles,
      idempotency,
      repository: chat,
      typingPublisher: chat,
    }),
    communityProfileService,
    pointsService: new PointsService(pointsRepository, rankings),
    profileService,
    announcementService: createAnnouncementsService({
      files,
      mutations,
      outbox,
      repository: announcements,
    }),
    assignmentService: createAssignmentsService({
      cache,
      files,
      mutations,
      outbox,
      pointAwards,
      repository: assignments,
    }),
    examService: createExamsService({ cache, files, mutations, outbox, pointAwards, repository: exams }),
    authService: createAuthService({
      schoolDirectory,
      supabase,
      otp,
      contactAdmin: new DrizzleContactAdminRepository(db),
      passwordResetChallenges: new DrizzlePasswordResetChallengeRepository(db),
      signupChallenges: new DrizzleSignupChallengeRepository(db),
    }),
    notificationService: createNotificationService({
      repository: notifications,
    }),
    diaryService: createDiaryService({
      idempotency,
      outbox: diaryOutbox,
      queue: platform.queue,
      repository: diary,
    }),
    eventMetadataIdempotency: idempotency,
    eventsService: createEventsService({
      avatarUrlSigner: {
        createSignedDownloadUrl: (bucket, objectPath) => platform.storage.createSignedReadUrl(
          bucket,
          objectPath,
          15 * 60,
        ),
      },
      files,
      pointAwards,
      repository: events,
    }),
    recordingsIdempotency: idempotency,
    recordingsService: createRecordingService({
      files: recordingFiles,
      periods: schedule,
      repository: recordings,
      storage: platform.recordingStorage,
    }),
    authenticate: createAuthenticate(
      createSupabaseTokenVerifier(env.SUPABASE_URL),
      schoolDirectory,
    ),
    scheduleService: createScheduleService({ repository: schedule }),
    studentClassContextService: new StudentClassContextService(
      studentClassContext,
    ),
    studentHomeService: createStudentHomeService({
      avatarUrlSigner: {
        createSignedDownloadUrl: (bucket, objectPath) => platform.storage.createSignedReadUrl(
          bucket,
          objectPath,
          15 * 60,
        ),
      },
      repository: studentHome,
    }),
    teacherClassContextService: new TeacherClassContextService(
      teacherClassContext,
    ),
    teacherClassesService: new TeacherClassesService(teacherClasses),
  };
}

function createCommunityReaders(database: Database) {
  return {
    async getStudentAverage(schoolId: string, studentId: string): Promise<number | null> {
      const rows = await database.execute(sql<{ average: number | string | null }>`
        select round(avg((coalesce(revision.marks, result.marks) / nullif(assessment.max_marks, 0)) * 100)::numeric, 2) as average
        from public.exam_results as result
        join public.class_exams as assessment
          on assessment.id = result.assessment_id and assessment.school_id = result.school_id
        left join lateral (
          select latest.marks
          from public.exam_result_revisions as latest
          where latest.result_id = result.id
            and latest.school_id = result.school_id
            and latest.assessment_id = result.assessment_id
            and latest.student_id = result.student_id
            and latest.published_at is not null
          order by latest.published_at desc, latest.created_at desc, latest.id desc
          limit 1
        ) as revision on true
        where result.school_id = ${schoolId}::uuid
          and result.student_id = ${studentId}::uuid
          and result.published_at is not null
          and assessment.is_published
          and assessment.deleted_at is null
          and assessment.max_marks > 0
      `);
      const average = (rows as unknown as readonly { average: number | string | null }[])[0]?.average;
      if (average === null || average === undefined) return null;
      const value = Number(average);
      return Number.isFinite(value) ? value : null;
    },
    async countParticipated(schoolId: string, studentId: string): Promise<number> {
      const rows = await database.execute(sql<{ count: number | string }>`
        select count(*)::int as count
        from public.event_registrations registration
        join public.events event on event.id = registration.event_id and event.school_id = registration.school_id
        where registration.school_id = ${schoolId}::uuid
          and registration.student_id = ${studentId}::uuid
          and registration.cancelled_at is null
          and event.deleted_at is null
      `);
      return Number((rows as unknown as readonly { count: number | string }[])[0]?.count ?? 0);
    },
    async countConducted(schoolId: string, teacherId: string): Promise<number> {
      const rows = await database.execute(sql<{ count: number | string }>`
        select count(*)::int as count
        from public.events event
        where event.school_id = ${schoolId}::uuid
          and event.created_by_teacher_id = ${teacherId}::uuid
          and event.deleted_at is null
      `);
      return Number((rows as unknown as readonly { count: number | string }[])[0]?.count ?? 0);
    },
    async getStudentProgress(input: { classId: string; schoolId: string; studentId: string }): Promise<{ classRank: number | null; points: number }> {
      const rows = await database.execute(sql<{ classRank: number | string | null; points: number | string }>`
        select
          coalesce(balance.current_points, 0)::int as points,
          ranking.rank as "classRank"
        from public.class_members membership
        join public.academic_years year on year.id = membership.academic_year_id
          and year.school_id = membership.school_id and year.is_current
        left join public.point_account_balances balance
          on balance.school_id = membership.school_id and balance.user_id = membership.student_id
        left join lateral (
          select entry.rank
          from public.ranking_refresh_scopes scope
          join public.ranking_snapshots snapshot
            on snapshot.scope_id = scope.id and snapshot.source_version = scope.refreshed_version
          join public.ranking_entries entry
            on entry.snapshot_id = snapshot.id and entry.school_id = snapshot.school_id
          where scope.school_id = membership.school_id
            and scope.class_id = membership.class_id
            and scope.scope_kind = 'class'::public.ranking_scope_kind
            and scope.subject_id is null
            and entry.user_id = membership.student_id
          order by snapshot.generated_at desc, snapshot.id desc
          limit 1
        ) ranking on true
        where membership.school_id = ${input.schoolId}::uuid
          and membership.class_id = ${input.classId}::uuid
          and membership.student_id = ${input.studentId}::uuid
          and membership.is_active
        limit 1
      `);
      const row = (rows as unknown as readonly { classRank: number | string | null; points: number | string }[])[0];
      return {
        classRank: row?.classRank === null || row?.classRank === undefined ? null : Number(row.classRank),
        points: Number(row?.points ?? 0),
      };
    },
  };
}
