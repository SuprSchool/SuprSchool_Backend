import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import type { Database } from '../src/db/client.js';
import { DrizzleChatRepository, type ChatRepository, type ChatTypingPublisher } from '../src/db/repositories/chat.repository.js';
import { AppError } from '../src/lib/errors.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import type { AuthenticationMiddleware } from '../src/middleware/authenticate.js';
import { IdempotencyStore, type IdempotencyRecord, type IdempotencyRecordStore, type IdempotencyRequest, type IdempotencyResponse } from '../src/platform/idempotency/idempotency-store.js';
import type { CacheStore } from '../src/platform/cache/cache-store.js';
import { createChatRouter } from '../src/routes/chat.routes.js';
import { createChatService, type ChatAttachmentFilePort } from '../src/services/chat.service.js';
import type { ChatHistoryCursor, ChatRoomAccess, SendChatMessageInput, StoredChatMessage, StoredChatMessagePage, StoredChatRoomSummary } from '../src/types/chat.js';

const schoolId = '00000000-0000-4000-8000-000000000001';
const studentId = '00000000-0000-4000-8000-000000000101';
const outsiderId = '00000000-0000-4000-8000-000000000102';
const roomId = '00000000-0000-4000-8000-000000000201';
const secondRoomId = '00000000-0000-4000-8000-000000000204';
const forbiddenRoomId = '00000000-0000-4000-8000-000000000202';
const foreignRoomId = '00000000-0000-4000-8000-000000000203';
const confirmedSessionId = '00000000-0000-4000-8000-000000000801';
const unconfirmedSessionId = '00000000-0000-4000-8000-000000000802';

type Access = ChatRoomAccess & { userId: string };

function cursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt, id })).toString('base64url');
}

function compare(left: ChatHistoryCursor, right: ChatHistoryCursor): number {
  return left.createdAt === right.createdAt ? left.id.localeCompare(right.id) : left.createdAt.localeCompare(right.createdAt);
}

function createIdempotency(): IdempotencyStore {
  const records = new Map<string, IdempotencyRecord>();
  const key = (school: string, user: string, requestKey: string) => `${school}:${user}:${requestKey}`;
  const store: IdempotencyRecordStore = {
    async complete(school, user, requestKey, response) {
      const recordKey = key(school, user, requestKey);
      const record = records.get(recordKey);
      if (!record) throw new Error('missing record');
      records.set(recordKey, { ...record, responseBody: response.body, responseStatus: response.status });
    },
    async create(record) {
      const recordKey = key(record.schoolId, record.userId, record.key);
      if (records.has(recordKey)) return false;
      records.set(recordKey, record);
      return true;
    },
    async find(school, user, requestKey) {
      return records.get(key(school, user, requestKey));
    },
    async deletePending(school, user, requestKey, requestHash) {
      const recordKey = key(school, user, requestKey);
      const record = records.get(recordKey);
      if (record?.requestHash === requestHash && record.responseStatus === null) {
        records.delete(recordKey);
      }
    },
  };
  return new IdempotencyStore(store);
}

function createCache(): CacheStore {
  const values = new Map<string, string>();
  return {
    async delete(key) { values.delete(key); },
    async get(key) { return values.get(key) ?? null; },
    async set(key, value) { values.set(key, value); },
    async withLock(_key, _ttl, work) { return work(); },
  };
}

function createFiles() {
  const uploadRequests: Array<{ displayName: string; roomId: string }> = [];
  const confirmations: string[] = [];
  const port: ChatAttachmentFilePort = {
    async confirmUpload(_identity, requestedRoom, uploadSessionId) {
      confirmations.push(uploadSessionId);
      // Mirrors the real service: a session whose object never landed in
      // storage is ineligible, and the send is rejected before it commits.
      if (uploadSessionId !== confirmedSessionId) {
        throw new AppError('VALIDATION_ERROR', 400, 'Uploaded chat attachment does not match its approved session');
      }
      return {
        contentType: 'application/pdf',
        displayName: 'notes.pdf',
        objectPath: `${schoolId}/chat-attachment/${requestedRoom}/${uploadSessionId}`,
        sizeBytes: 1024,
        uploadSessionId,
      };
    },
    async createUpload(_identity, requestedRoom, input) {
      uploadRequests.push({ displayName: input.displayName, roomId: requestedRoom });
      return {
        expiresAt: '2026-08-08T10:00:00.000Z',
        id: confirmedSessionId,
        signedUploadUrl: 'https://signed.example/upload',
      };
    },
    async createReadUrl(objectPath) {
      return `https://signed.example/read/${objectPath}`;
    },
  };
  return { confirmations, port, uploadRequests };
}

function createRepository() {
  const messages: StoredChatMessage[] = [];
  const typingEvents: Array<{ expiresAt: string; isTyping: boolean; userId: string }> = [];
  const readCursors = new Map<string, StoredChatMessage>();
  const access: Access = {
    classId: '00000000-0000-4000-8000-000000000301', id: roomId, kind: 'class', schoolId, subjectId: null, userId: studentId,
  };
  let count = 0;
  const repository: ChatRepository & ChatTypingPublisher = {
    async advanceReadCursor(room, messageId) {
      const requestedAccess = room as Access;
      const message = messages.find((item) => item.id === messageId && item.roomId === requestedAccess.id);
      if (!message) throw new AppError('NOT_FOUND', 404, 'Chat message not found');
      const existing = readCursors.get(`${requestedAccess.id}:${requestedAccess.userId}`);
      if (!existing || compare(message, existing) > 0) readCursors.set(`${requestedAccess.id}:${requestedAccess.userId}`, message);
    },
    async canAccessRoom(_identity, requestedRoom) {
      return requestedRoom === roomId || requestedRoom === secondRoomId;
    },
    async assertAccess(identity, requestedRoom) {
      if (requestedRoom === foreignRoomId) throw new AppError('NOT_FOUND', 404, 'Chat room not found');
      if (requestedRoom === forbiddenRoomId || identity.userId === outsiderId) throw new AppError('FORBIDDEN', 403, 'Chat room access denied');
      if (requestedRoom !== roomId && requestedRoom !== secondRoomId) throw new AppError('NOT_FOUND', 404, 'Chat room not found');
      return { ...access, id: requestedRoom, userId: identity.userId };
    },
    async findMessageByClientId(room, clientMessageId) {
      const requestedAccess = room as Access;
      return messages.find((item) => item.roomId === requestedAccess.id && item.sender.id === requestedAccess.userId && item.clientMessageId === clientMessageId);
    },
    async insertMessage(room, input) {
      const requestedAccess = room as Access;
      const duplicate = await repository.findMessageByClientId(requestedAccess, input.clientMessageId);
      if (duplicate) return duplicate;
      count += 1;
      const message: StoredChatMessage = {
        attachments: input.attachment === undefined ? [] : [{
          contentType: input.attachment.contentType,
          id: `00000000-0000-4000-8000-${String(700 + count).padStart(12, '0')}`,
          name: input.attachment.displayName,
          objectPath: input.attachment.objectPath,
          sizeBytes: input.attachment.sizeBytes,
        }],
        body: input.body,
        clientMessageId: input.clientMessageId,
        createdAt: `2026-07-13T10:00:${String(count).padStart(2, '0')}.000Z`,
        id: `00000000-0000-4000-8000-${String(500 + count).padStart(12, '0')}`,
        roomId: requestedAccess.id,
        sender: { displayName: 'Asha Student', id: requestedAccess.userId, role: 'student' },
      };
      messages.push(message);
      return message;
    },
    async listMessages(room, page) {
      let found = messages.filter((item) => item.roomId === room.id).sort(compare);
      if (page.after) found = found.filter((item) => compare(item, page.after!) > 0);
      if (page.before) found = found.filter((item) => compare(item, page.before!) < 0);
      const items = page.before ? found.slice(-page.limit) : found.slice(0, page.limit);
      const edge = page.before ? items.at(0) : items.at(-1);
      const pageResult: StoredChatMessagePage = { items };
      if (found.length > items.length && edge) pageResult.nextCursor = { createdAt: edge.createdAt, id: edge.id };
      return pageResult;
    },
    async listRooms(identity) {
      if (identity.userId === outsiderId) return [];
      const room: StoredChatRoomSummary = { classId: access.classId, id: access.id, kind: access.kind, lastMessage: null, name: 'Class chat', subjectId: null, unreadCount: 0 };
      return [room];
    },
    async publishTyping(room, isTyping, expiresAt) {
      typingEvents.push({ expiresAt, isTyping, userId: (room as Access).userId });
    },
  };
  return { messages, readCursors, repository, typingEvents };
}

function createTestApp(cache: CacheStore = createCache(), role: 'student' | 'teacher' = 'student') {
  const fixture = createRepository();
  const files = createFiles();
  const app = express();
  const authenticate: AuthenticationMiddleware = async (incoming: Request, _response: Response, next: NextFunction) => {
    incoming.auth = { role, schoolId, userId: incoming.header('authorization') === 'Bearer outsider' ? outsiderId : studentId };
    next();
  };
  app.use(express.json());
  app.use('/v1/chat', createChatRouter(createChatService({
    cache, files: files.port, idempotency: createIdempotency(), repository: fixture.repository, typingPublisher: fixture.repository,
  }), authenticate));
  app.use(errorHandler);
  return { app, files, ...fixture };
}

function input(clientMessageId: string, body = 'Can you explain question 4?'): SendChatMessageInput {
  return { body, clientMessageId };
}

describe('chat REST API', () => {
  it('lists only rooms available to the authenticated caller', async () => {
    const { app } = createTestApp();
    const response = await request(app).get('/v1/chat/rooms').expect(200);
    expect(response.body).toEqual({ rooms: [expect.objectContaining({ id: roomId, unreadCount: 0 })] });
    await request(app).get('/v1/chat/rooms').set('authorization', 'Bearer outsider').expect(200, { rooms: [] });
  });

  it('persists one message and returns it for an idempotent replay', async () => {
    const { app, messages } = createTestApp();
    const body = input('00000000-0000-4000-8000-000000000111', '  Can you explain question 4?  ');
    const key = '00000000-0000-4000-8000-000000000112';
    const first = await request(app).post(`/v1/chat/rooms/${roomId}/messages`).set('Idempotency-Key', key).send(body).expect(201);
    const replay = await request(app).post(`/v1/chat/rooms/${roomId}/messages`).set('Idempotency-Key', key).send(body).expect(201);
    expect(replay.body).toEqual(first.body);
    expect(first.body.body).toBe('Can you explain question 4?');
    expect(messages).toHaveLength(1);
  });

  it('sends a text-only message unchanged when no attachment session is supplied', async () => {
    const { app, files, messages } = createTestApp();
    const response = await request(app).post(`/v1/chat/rooms/${roomId}/messages`)
      .set('Idempotency-Key', '00000000-0000-4000-8000-000000000180')
      .send(input('00000000-0000-4000-8000-000000000181'))
      .expect(201);

    expect(response.body.body).toBe('Can you explain question 4?');
    expect(response.body.attachments).toEqual([]);
    expect(files.confirmations).toEqual([]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.attachments).toEqual([]);
  });

  it('commits a message with a confirmed attachment session and returns a signed url', async () => {
    const { app, files, messages } = createTestApp();
    const response = await request(app).post(`/v1/chat/rooms/${roomId}/messages`)
      .set('Idempotency-Key', '00000000-0000-4000-8000-000000000182')
      .send({ ...input('00000000-0000-4000-8000-000000000183', 'see attached'), attachmentSessionId: confirmedSessionId })
      .expect(201);

    expect(files.confirmations).toEqual([confirmedSessionId]);
    expect(response.body.attachments).toEqual([{
      contentType: 'application/pdf',
      id: expect.any(String),
      name: 'notes.pdf',
      signedUrl: `https://signed.example/read/${schoolId}/chat-attachment/${roomId}/${confirmedSessionId}`,
      sizeBytes: 1024,
    }]);
    expect(messages).toHaveLength(1);
  });

  it('rejects a message that references an unconfirmed attachment session with 400', async () => {
    const { app, files, messages } = createTestApp();
    const response = await request(app).post(`/v1/chat/rooms/${roomId}/messages`)
      .set('Idempotency-Key', '00000000-0000-4000-8000-000000000184')
      .send({ ...input('00000000-0000-4000-8000-000000000185'), attachmentSessionId: unconfirmedSessionId })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(files.confirmations).toEqual([unconfirmedSessionId]);
    // Confirm-before-commit: nothing was written for a session that never landed.
    expect(messages).toHaveLength(0);
  });

  it('issues an attachment upload session scoped to the requested room', async () => {
    const { app, files } = createTestApp();
    const response = await request(app).post(`/v1/chat/rooms/${roomId}/attachments/upload-sessions`)
      .send({ contentType: 'application/pdf', displayName: 'notes.pdf', sizeBytes: 1024 })
      .expect(201);

    expect(response.body).toEqual({
      expiresAt: '2026-08-08T10:00:00.000Z',
      id: confirmedSessionId,
      signedUploadUrl: 'https://signed.example/upload',
    });
    expect(files.uploadRequests).toEqual([{ displayName: 'notes.pdf', roomId }]);
  });

  it('persists a message when the optional rate-limit cache is temporarily unavailable', async () => {
    const unavailableCache: CacheStore = {
      delete: async () => undefined,
      get: async () => { throw new Error('cache unavailable'); },
      set: async () => { throw new Error('cache unavailable'); },
      withLock: async () => { throw new Error('cache unavailable'); },
    };
    const { app, messages } = createTestApp(unavailableCache);

    await request(app)
      .post(`/v1/chat/rooms/${roomId}/messages`)
      .set('Idempotency-Key', '00000000-0000-4000-8000-000000000125')
      .send(input('00000000-0000-4000-8000-000000000126'))
      .expect(201);

    expect(messages).toHaveLength(1);
  });

  it('scopes an identical idempotency key to its requested room', async () => {
    const { app, messages } = createTestApp();
    const body = input('00000000-0000-4000-8000-000000000123');
    const key = '00000000-0000-4000-8000-000000000124';

    const firstRoom = await request(app).post(`/v1/chat/rooms/${roomId}/messages`)
      .set('Idempotency-Key', key).send(body).expect(201);
    const secondRoom = await request(app).post(`/v1/chat/rooms/${secondRoomId}/messages`)
      .set('Idempotency-Key', key).send(body).expect(201);
    const secondRoomReplay = await request(app).post(`/v1/chat/rooms/${secondRoomId}/messages`)
      .set('Idempotency-Key', key).send(body).expect(201);

    expect(firstRoom.body.roomId).toBe(roomId);
    expect(secondRoom.body.roomId).toBe(secondRoomId);
    expect(secondRoomReplay.body).toEqual(secondRoom.body);
    expect(messages.filter((message) => message.roomId === roomId)).toHaveLength(1);
    expect(messages.filter((message) => message.roomId === secondRoomId)).toHaveLength(1);
  });

  it('rejects a changed idempotency request and accepts a duplicate durable client id once', async () => {
    const { app, messages } = createTestApp();
    const body = input('00000000-0000-4000-8000-000000000113');
    await request(app).post(`/v1/chat/rooms/${roomId}/messages`).set('Idempotency-Key', '00000000-0000-4000-8000-000000000114').send(body).expect(201);
    const duplicate = await request(app).post(`/v1/chat/rooms/${roomId}/messages`).set('Idempotency-Key', '00000000-0000-4000-8000-000000000115').send(body).expect(201);
    const conflict = await request(app).post(`/v1/chat/rooms/${roomId}/messages`).set('Idempotency-Key', '00000000-0000-4000-8000-000000000114').send(input(body.clientMessageId, 'changed')).expect(409);
    expect(duplicate.body.id).toBe(messages[0]?.id);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(messages).toHaveLength(1);
  });

  it('returns after-cursor history and advances the durable read cursor only forward', async () => {
    const { app, messages, readCursors } = createTestApp();
    const old = await request(app).post(`/v1/chat/rooms/${roomId}/messages`).set('Idempotency-Key', '00000000-0000-4000-8000-000000000116').send(input('00000000-0000-4000-8000-000000000117', 'old')).expect(201);
    const newer = await request(app).post(`/v1/chat/rooms/${roomId}/messages`).set('Idempotency-Key', '00000000-0000-4000-8000-000000000118').send(input('00000000-0000-4000-8000-000000000119', 'new')).expect(201);
    const page = await request(app).get(`/v1/chat/rooms/${roomId}/messages?after=${encodeURIComponent(cursor(old.body.createdAt, old.body.id))}`).expect(200);
    expect(page.body.items.map((item: { id: string }) => item.id)).toEqual([newer.body.id]);
    await request(app).post(`/v1/chat/rooms/${roomId}/read`).send({ lastReadMessageId: newer.body.id }).expect(204);
    await request(app).post(`/v1/chat/rooms/${roomId}/read`).send({ lastReadMessageId: old.body.id }).expect(204);
    expect(readCursors.get(`${roomId}:${studentId}`)?.id).toBe(newer.body.id);
    expect(messages).toHaveLength(2);
  });

  it('returns not found for another school, forbidden for no assignment, and validates request bounds', async () => {
    const { app } = createTestApp();
    await request(app).get(`/v1/chat/rooms/${foreignRoomId}/messages`).expect(404);
    await request(app).get(`/v1/chat/rooms/${forbiddenRoomId}/messages`).set('authorization', 'Bearer outsider').expect(403);
    await request(app).get(`/v1/chat/rooms/${roomId}/messages?before=x&after=y`).expect(400);
    await request(app).get(`/v1/chat/rooms/${roomId}/messages?limit=101`).expect(400);
    await request(app).post(`/v1/chat/rooms/${roomId}/messages`).set('Idempotency-Key', 'invalid').send(input('00000000-0000-4000-8000-000000000120')).expect(400);
    await request(app).post(`/v1/chat/rooms/${roomId}/messages`).set('Idempotency-Key', '00000000-0000-4000-8000-000000000121').send(input('00000000-0000-4000-8000-000000000122', '   ')).expect(400);
  });

  it('throttles ephemeral typing and message sends per user and room', async () => {
    const { app, messages, typingEvents } = createTestApp();
    for (let index = 0; index < 5; index += 1) await request(app).post(`/v1/chat/rooms/${roomId}/typing`).send({ isTyping: true }).expect(204);
    await request(app).post(`/v1/chat/rooms/${roomId}/typing`).send({ isTyping: false }).expect(429);
    expect(typingEvents).toHaveLength(5);
    expect(messages).toHaveLength(0);
    for (let index = 0; index < 10; index += 1) {
      const suffix = String(130 + index).padStart(12, '0');
      await request(app).post(`/v1/chat/rooms/${roomId}/messages`).set('Idempotency-Key', `00000000-0000-4000-8000-${suffix}`).send(input(`00000000-0000-4000-8000-${String(140 + index).padStart(12, '0')}`)).expect(201);
    }
    await request(app).post(`/v1/chat/rooms/${roomId}/messages`).set('Idempotency-Key', '00000000-0000-4000-8000-000000000150').send(input('00000000-0000-4000-8000-000000000151')).expect(429);
    expect(messages).toHaveLength(10);
  });

  it('returns a completed idempotency replay after the message quota is exhausted', async () => {
    const { app, messages } = createTestApp();
    const replayKey = '00000000-0000-4000-8000-000000000152';
    const replayBody = input('00000000-0000-4000-8000-000000000153', 'Replay me');
    const first = await request(app).post(`/v1/chat/rooms/${roomId}/messages`)
      .set('Idempotency-Key', replayKey)
      .send(replayBody)
      .expect(201);

    for (let index = 0; index < 9; index += 1) {
      const keySuffix = String(154 + index).padStart(12, '0');
      const clientSuffix = String(164 + index).padStart(12, '0');
      await request(app).post(`/v1/chat/rooms/${roomId}/messages`)
        .set('Idempotency-Key', `00000000-0000-4000-8000-${keySuffix}`)
        .send(input(`00000000-0000-4000-8000-${clientSuffix}`))
        .expect(201);
    }

    await request(app).post(`/v1/chat/rooms/${roomId}/messages`)
      .set('Idempotency-Key', replayKey)
      .send(replayBody)
      .expect(201, first.body);

    expect(messages).toHaveLength(10);
  });

  it('keeps the newest initial history row while returning a bounded page oldest-to-newest', async () => {
    const database = {
      async execute() {
        return [
          { body: 'new', clientMessageId: '00000000-0000-4000-8000-000000000164', createdAt: '2026-07-13T10:00:03.000Z', id: '00000000-0000-4000-8000-000000000165', roomId, senderDisplayName: 'Asha', senderId: studentId, senderRole: 'student' },
          { body: 'middle', clientMessageId: '00000000-0000-4000-8000-000000000162', createdAt: '2026-07-13T10:00:02.000Z', id: '00000000-0000-4000-8000-000000000163', roomId, senderDisplayName: 'Asha', senderId: studentId, senderRole: 'student' },
          { body: 'old', clientMessageId: '00000000-0000-4000-8000-000000000160', createdAt: '2026-07-13T10:00:01.000Z', id: '00000000-0000-4000-8000-000000000161', roomId, senderDisplayName: 'Asha', senderId: studentId, senderRole: 'student' },
        ];
      },
    } as unknown as Database;
    const repository = new DrizzleChatRepository(database);
    const page = await repository.listMessages({
      classId: '00000000-0000-4000-8000-000000000301', id: roomId, kind: 'class', schoolId, subjectId: null, userId: studentId,
    }, { limit: 2 });

    expect(page.items.map((item) => item.id)).toEqual([
      '00000000-0000-4000-8000-000000000163',
      '00000000-0000-4000-8000-000000000165',
    ]);
    expect(page.nextCursor).toEqual({
      createdAt: '2026-07-13T10:00:02.000Z',
      id: '00000000-0000-4000-8000-000000000163',
    });
  });
  it('preserves microsecond precision in durable history cursors', async () => {
    const queries: unknown[] = [];
    const database = {
      async execute(query: unknown) {
        queries.push(query);
        return [
          { body: 'edge', clientMessageId: '00000000-0000-4000-8000-000000000166', createdAt: '2026-07-13T10:00:03.123456Z', id: '00000000-0000-4000-8000-000000000167', roomId, senderDisplayName: 'Asha', senderId: studentId, senderRole: 'student' },
          { body: 'older', clientMessageId: '00000000-0000-4000-8000-000000000168', createdAt: '2026-07-13T10:00:03.123455Z', id: '00000000-0000-4000-8000-000000000169', roomId, senderDisplayName: 'Asha', senderId: studentId, senderRole: 'student' },
        ];
      },
    } as unknown as Database;
    const repository = new DrizzleChatRepository(database);
    const page = await repository.listMessages({
      classId: '00000000-0000-4000-8000-000000000301', id: roomId, kind: 'class', schoolId, subjectId: null, userId: studentId,
    }, { limit: 1 });

    expect(page.nextCursor).toEqual({
      createdAt: '2026-07-13T10:00:03.123456Z',
      id: '00000000-0000-4000-8000-000000000167',
    });
    expect(JSON.stringify(queries[0])).toContain('HH24:MI:SS.US');
  });

  it('recovers a durable message after an expired idempotency lease without charging quota or inserting', async () => {
    let completed: unknown;
    let failClosedCalls = 0;
    let inserted = false;
    let quotaChecked = false;
    const durableMessage: StoredChatMessage = {
      attachments: [],
      body: 'Already durable',
      clientMessageId: '00000000-0000-4000-8000-000000000172',
      createdAt: '2026-07-13T10:00:01.000Z',
      id: '00000000-0000-4000-8000-000000000173',
      roomId,
      sender: { displayName: 'Asha Student', id: studentId, role: 'student' },
    };
    const service = createChatService({
      cache: {
        delete: async () => undefined,
        get: async () => null,
        set: async () => undefined,
        withLock: async (_key, _ttl, work) => {
          quotaChecked = true;
          return work();
        },
      } as CacheStore,
      files: {} as ChatAttachmentFilePort,
      idempotency: {
        claim: async () => ({ state: 'expired' as const }),
        complete: async (_request: IdempotencyRequest, response: IdempotencyResponse) => { completed = response; },
        failClosed: async () => { failClosedCalls += 1; },
      } as unknown as IdempotencyStore,
      repository: {
        assertAccess: async () => ({
          classId: '00000000-0000-4000-8000-000000000301',
          id: roomId,
          kind: 'class' as const,
          schoolId,
          subjectId: null,
          userId: studentId,
        }),
        findMessageByClientId: async (access: ChatRoomAccess, clientMessageId: string) => {
          expect(access.id).toBe(roomId);
          expect(access.userId).toBe(studentId);
          expect(clientMessageId).toBe(durableMessage.clientMessageId);
          return durableMessage;
        },
        insertMessage: async () => {
          inserted = true;
          throw new Error('must not insert a recovered message');
        },
      } as unknown as ChatRepository,
      typingPublisher: {} as ChatTypingPublisher,
    });

    await expect(service.sendMessage(
      { role: 'student', schoolId, userId: studentId },
      roomId,
      '00000000-0000-4000-8000-000000000171',
      input(durableMessage.clientMessageId),
    )).resolves.toEqual(durableMessage);

    expect(completed).toEqual({ body: durableMessage, status: 201 });
    expect(failClosedCalls).toBe(0);
    expect(quotaChecked).toBe(false);
    expect(inserted).toBe(false);
  });
  it('fail-closes an expired idempotency lease without charging quota or inserting', async () => {
    let failClosedCalls = 0;
    let inserted = false;
    let quotaChecked = false;
    const service = createChatService({
      cache: {
        delete: async () => undefined,
        get: async () => null,
        set: async () => undefined,
        withLock: async (_key, _ttl, work) => {
          quotaChecked = true;
          return work();
        },
      } as CacheStore,
      files: {} as ChatAttachmentFilePort,
      idempotency: {
        claim: async () => ({ state: 'expired' as const }),
        failClosed: async () => { failClosedCalls += 1; },
        release: async () => undefined,
      } as unknown as IdempotencyStore,
      repository: {
        assertAccess: async () => ({
          classId: '00000000-0000-4000-8000-000000000301',
          id: roomId,
          kind: 'class' as const,
          schoolId,
          subjectId: null,
          userId: studentId,
        }),
        findMessageByClientId: async () => undefined,
        insertMessage: async () => {
          inserted = true;
          throw new Error('must not insert an expired request');
        },
      } as unknown as ChatRepository,
      typingPublisher: {} as ChatTypingPublisher,
    });

    await expect(service.sendMessage(
      { role: 'student', schoolId, userId: studentId },
      roomId,
      '00000000-0000-4000-8000-000000000171',
      input('00000000-0000-4000-8000-000000000172'),
    )).rejects.toMatchObject({ code: 'IDEMPOTENCY_IN_PROGRESS', status: 409 });

    expect(failClosedCalls).toBe(1);
    expect(quotaChecked).toBe(false);
    expect(inserted).toBe(false);
  });
});
