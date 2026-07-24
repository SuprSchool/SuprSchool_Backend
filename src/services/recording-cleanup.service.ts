/**
 * Domain-owned contract for recording upload cleanup. Runtime queue mounting is
 * deliberately deferred to the integration owner.
 */
export interface RecordingCleanupPort {
  expireStaleUploadSessions(schoolId: string): Promise<void>;
}

export interface RecordingCleanupQueueMessage {
  schoolId: string;
}

export interface RecordingCleanupHandler {
  handle(message: RecordingCleanupQueueMessage): Promise<void>;
}

export function createRecordingCleanupHandler(
  cleanup: RecordingCleanupPort,
): RecordingCleanupHandler {
  return { handle: (message) => cleanup.expireStaleUploadSessions(message.schoolId) };
}
