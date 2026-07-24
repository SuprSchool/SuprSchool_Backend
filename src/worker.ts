import {
  createRuntimePlatformDependencies,
  createStorageCleanupDispatcher,
  createStorageCleanupHandler,
} from "./config/platform-dependencies.js";
import { loadEnv } from "./config/env.js";
import {
  createAcademicNotificationHandlers,
  DrizzleAcademicNotificationDeliveryStore,
  ExpoPushSender,
} from "./platform/academic/academic-notification-delivery.js";
import { AcademicOutbox } from "./platform/academic/academic-outbox.js";
import { createQueueWorkerRuntime } from "./platform/queue/queue-runtime.js";
import { DrizzleProfileRepository } from "./db/repositories/profile.repository.js";
import { DrizzleRankingRepository } from "./db/repositories/ranking.repository.js";
import { createRankingRefreshHandler } from "./async/rankings/ranking-refresh.handler.js";
import {
  createAvatarCleanupDispatchHandler,
  createAvatarCleanupHandler,
} from "./services/avatar.service.js";
import { RankingRefreshService } from "./services/ranking-refresh.service.js";

const env = loadEnv();
const platform = createRuntimePlatformDependencies(env);
const handlers = createAcademicNotificationHandlers(
  new DrizzleAcademicNotificationDeliveryStore(platform.database),
  new ExpoPushSender(),
);
const profileCleanupIntents = new DrizzleProfileRepository(platform.database);
const rankings = new RankingRefreshService({
  queue: platform.queue,
  repository: new DrizzleRankingRepository(platform.database),
});
const runtime = createQueueWorkerRuntime(platform.worker, {
  avatar_cleanup: createAvatarCleanupHandler(platform.storage, profileCleanupIntents),
  avatar_cleanup_dispatch: createAvatarCleanupDispatchHandler(profileCleanupIntents, platform.queue),
  ranking_refresh: createRankingRefreshHandler(rankings),
  notification_dispatch: handlers.notification,
  reminder_dispatch: handlers.reminder,
  storage_cleanup: createStorageCleanupDispatcher({
    legacy: createStorageCleanupHandler(
      platform.database,
      platform.storageObjectRemover,
    ),
    recordings: platform.recordingCleanup,
  }),
});
const outbox = new AcademicOutbox(platform.database);
let publishing: Promise<void> | undefined;

function dispatchOutbox(): Promise<void> {
  if (publishing !== undefined) return publishing;
  publishing = Promise.all([
    outbox.dispatchPending(platform.queue),
    rankings.dispatchPending(),
  ]).then(() => undefined).finally(() => {
    publishing = undefined;
  });
  return publishing;
}

runtime.start();
void dispatchOutbox();
const outboxTimer = setInterval(() => {
  void dispatchOutbox();
}, 1_000);
process.stdout.write("SuperSkool queue worker started\n");

let stopping = false;
async function stop(signal: NodeJS.Signals): Promise<void> {
  if (stopping) return;
  stopping = true;
  try {
    clearInterval(outboxTimer);
    await dispatchOutbox();
    await runtime.stop();
    await platform.close();
  } catch (error) {
    process.exitCode = 1;
    process.stderr.write(
      `${signal}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

process.once("SIGINT", () => {
  void stop("SIGINT");
});
process.once("SIGTERM", () => {
  void stop("SIGTERM");
});
