import express, { type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";

import { logger } from "./lib/logger.js";
import { createAnnouncementsRouter } from "./routes/announcements.routes.js";
import { createAssignmentsRouter } from "./routes/assignments.routes.js";
import { createExamsRouter } from "./routes/exams.routes.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import type { AuthenticationMiddleware } from "./middleware/authenticate.js";
import { requestContext } from "./middleware/request-context.js";
import { createAttendanceRouter } from "./routes/attendance.routes.js";
import { createAuthRouter } from "./routes/auth.routes.js";
import { healthRouter } from "./routes/health.routes.js";
import { createStudentHomeRouter } from "./routes/student-home.routes.js";
import { createTeacherClassesRouter } from "./routes/teacher-classes.routes.js";
import { createStudentClassContextRouter } from "./routes/student-class-context.routes.js";
import { createStudentScheduleRouter } from "./routes/student-schedule.routes.js";
import { createTeacherClassContextRouter } from "./routes/teacher-class-context.routes.js";
import { createTeacherScheduleRouter } from "./routes/teacher-schedule.routes.js";
import { createNotificationRouter } from "./routes/notification.routes.js";
import { createStudentRecordingsRouter } from "./routes/student-recordings.routes.js";
import { createTeacherRecordingsRouter } from "./routes/teacher-recordings.routes.js";
import { createDiaryRouter } from "./routes/diary.routes.js";
import { createStudentEventsRouter } from "./routes/student-events.routes.js";
import { createTeacherEventsRouter } from "./routes/teacher-events.routes.js";
import { createChatRouter } from "./routes/chat.routes.js";
import {
  createSchoolRouter,
  createStudentCommunityProfileRouter,
  createTeacherCommunityProfileRouter,
} from "./routes/community-profile.routes.js";
import {
  createPointsRouter,
  createStudentClassRankingsRouter,
} from "./routes/points.routes.js";
import { createProfileRouter } from "./routes/profile.routes.js";
import type { AttendanceService } from "./services/attendance.service.js";
import type { AuthService } from "./services/auth.service.js";
import type { AnnouncementsService } from "./services/announcements.service.js";
import type { AssignmentsService } from "./services/assignments.service.js";
import type { ExamsService } from "./services/exams.service.js";
import type { StudentHomeService } from "./services/student-home.service.js";
import type { TeacherClassesService } from "./services/teacher-classes.service.js";
import type { ScheduleService } from "./services/schedule.service.js";
import type { StudentClassContextService } from "./services/student-class-context.service.js";
import type { TeacherClassContextService } from "./services/teacher-class-context.service.js";
import type { NotificationService } from "./services/notification.service.js";
import type { RecordingService } from "./services/recordings.service.js";
import type { DiaryService } from "./services/diary.service.js";
import type { EventsService } from "./services/events.service.js";
import type { IdempotencyStore } from "./platform/idempotency/idempotency-store.js";
import type { AvatarService } from "./services/avatar.service.js";
import type { ChatService } from "./services/chat.service.js";
import type { CommunityProfileService } from "./services/community-profile.service.js";
import type { PointsService } from "./services/points.service.js";
import type { ProfileService } from "./services/profile.service.js";

export interface AppDependencies {
  attendanceService?: AttendanceService;
  announcementService?: AnnouncementsService;
  assignmentService?: AssignmentsService;
  examService?: ExamsService;
  authService?: AuthService;
  scheduleService?: ScheduleService;
  studentClassContextService?: StudentClassContextService;
  teacherClassContextService?: TeacherClassContextService;
  authenticate?: AuthenticationMiddleware;
  studentHomeService?: StudentHomeService;
  teacherClassesService?: TeacherClassesService;
  notificationService?: NotificationService;
  eventMetadataIdempotency?: IdempotencyStore;
  recordingsIdempotency?: IdempotencyStore;
  recordingsService?: RecordingService;
  diaryService?: DiaryService;
  eventsService?: EventsService;
  avatarService?: AvatarService;
  chatService?: ChatService;
  communityProfileService?: CommunityProfileService;
  pointsService?: PointsService;
  profileService?: ProfileService;
}

export function createApp(dependencies: AppDependencies = {}): Express {
  const app = express();
  const { authenticate } = dependencies;

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    pinoHttp({
      autoLogging: process.env.NODE_ENV !== "test",
      logger,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(requestContext);
  app.use("/health", healthRouter);
  if (dependencies.authService) {
    app.use(
      "/v1/auth",
      createAuthRouter(dependencies.authService, authenticate),
    );
  }
  if (authenticate && dependencies.studentHomeService) {
    app.use(
      "/v1/student/home",
      createStudentHomeRouter(dependencies.studentHomeService, authenticate),
    );
  }
  if (authenticate && dependencies.studentClassContextService) {
    app.use(
      "/v1/student",
      createStudentClassContextRouter(
        dependencies.studentClassContextService,
        authenticate,
      ),
    );
  }
  if (authenticate && dependencies.scheduleService) {
    app.use(
      "/v1/student",
      createStudentScheduleRouter(dependencies.scheduleService, authenticate),
    );
    app.use(
      "/v1/teacher",
      createTeacherScheduleRouter(dependencies.scheduleService, authenticate),
    );
  }
  if (authenticate && dependencies.teacherClassContextService) {
    app.use(
      "/v1/teacher",
      createTeacherClassContextRouter(
        dependencies.teacherClassContextService,
        authenticate,
      ),
    );
  }
  if (authenticate && dependencies.teacherClassesService) {
    app.use(
      "/v1/teacher/classes",
      createTeacherClassesRouter(
        dependencies.teacherClassesService,
        authenticate,
      ),
    );
  }
  if (authenticate && dependencies.attendanceService) {
    app.use(
      "/v1/attendance",
      createAttendanceRouter(dependencies.attendanceService, authenticate),
    );
  }
  if (authenticate && dependencies.notificationService) {
    app.use(
      "/v1/notifications",
      createNotificationRouter(dependencies.notificationService, authenticate),
    );
  }
  if (authenticate && dependencies.recordingsService) {
    app.use(
      "/v1/student",
      createStudentRecordingsRouter(
        dependencies.recordingsService,
        authenticate,
      ),
    );
    if (dependencies.recordingsIdempotency) {
      app.use(
        "/v1/teacher",
        createTeacherRecordingsRouter(
          dependencies.recordingsService,
          authenticate,
          dependencies.recordingsIdempotency,
        ),
      );
    }
  }
  if (authenticate && dependencies.diaryService) {
    app.use(
      "/v1/student",
      createDiaryRouter(dependencies.diaryService, authenticate),
    );
    app.use(
      "/v1/teacher",
      createDiaryRouter(dependencies.diaryService, authenticate),
    );
  }
  if (authenticate && dependencies.eventsService) {
    if (!dependencies.eventMetadataIdempotency) {
      throw new Error('Event metadata idempotency is required when the events service is configured');
    }
    app.use(
      "/v1/student",
      createStudentEventsRouter(dependencies.eventsService, authenticate, dependencies.eventMetadataIdempotency),
    );
    app.use(
      "/v1/teacher",
      createTeacherEventsRouter(
        dependencies.eventsService,
        authenticate,
        dependencies.eventMetadataIdempotency,
      ),
    );
  }
  if (authenticate && dependencies.announcementService) {
    app.use(
      "/v1",
      createAnnouncementsRouter(dependencies.announcementService, authenticate),
    );
  }
  if (authenticate && dependencies.assignmentService) {
    app.use(
      "/v1",
      createAssignmentsRouter(dependencies.assignmentService, authenticate),
    );
  }
  if (authenticate && dependencies.examService) {
    app.use("/v1", createExamsRouter(dependencies.examService, authenticate));
  }
  if (authenticate && dependencies.profileService) {
    app.use(
      "/v1/profile",
      createProfileRouter(
        dependencies.profileService,
        authenticate,
        dependencies.avatarService,
      ),
    );
  }
  if (authenticate && dependencies.chatService) {
    app.use("/v1/chat", createChatRouter(dependencies.chatService, authenticate));
  }
  if (authenticate && dependencies.communityProfileService) {
    app.use(
      "/v1/student/profile",
      createStudentCommunityProfileRouter(
        dependencies.communityProfileService,
        authenticate,
      ),
    );
    app.use(
      "/v1/teacher/profile",
      createTeacherCommunityProfileRouter(
        dependencies.communityProfileService,
        authenticate,
      ),
    );
    app.use(
      "/v1/schools",
      createSchoolRouter(dependencies.communityProfileService, authenticate),
    );
  }
  if (authenticate && dependencies.pointsService) {
    app.use(
      "/v1/student/points",
      createPointsRouter(dependencies.pointsService, authenticate),
    );
    app.use(
      "/v1/student",
      createStudentClassRankingsRouter(dependencies.pointsService, authenticate),
    );
  }
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
