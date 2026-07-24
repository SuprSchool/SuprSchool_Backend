export interface QueueMessage<TPayload> {
  eventId: string;
  eventType: string;
  occurredAt: string;
  schoolId: string;
  schemaVersion: 1;
  payload: TPayload;
}
