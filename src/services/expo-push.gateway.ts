import type { NotificationDispatchPayload } from '../types/notification.js';

export interface ExpoPushTicket { id?: string; status: 'ok' | 'error'; message?: string; details?: Record<string, unknown> }
export interface ExpoPushReceipt { status: 'ok' | 'error'; message?: string; details?: Record<string, unknown> }
export interface ExpoPushGateway {
  send(tokens: ReadonlyArray<string>, payload: NotificationDispatchPayload, options: { idempotencyKey: string }): Promise<ReadonlyArray<ExpoPushTicket>>;
  getReceipts?(ticketIds: ReadonlyArray<string>): Promise<Record<string, ExpoPushReceipt>>;
}
