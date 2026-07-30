import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import type { Database } from "../../db/client.js";

export interface IdempotencyRequest {
  key: string;
  requestBody: unknown;
  schoolId: string;
  userId: string;
}

export interface IdempotencyResponse {
  body: unknown;
  status: number;
}

export interface IdempotencyRecord {
  key: string;
  leaseExpiresAt?: string | null;
  requestHash: string;
  responseBody: unknown | null;
  responseStatus: number | null;
  schoolId: string;
  userId: string;
}

export interface IdempotencyRecordStore {
  complete(
    schoolId: string,
    userId: string,
    key: string,
    response: IdempotencyResponse,
  ): Promise<void>;
  completeOwned?(
    schoolId: string,
    userId: string,
    key: string,
    requestHash: string,
    leaseToken: string,
    response: IdempotencyResponse,
  ): Promise<boolean>;
  create(record: IdempotencyRecord): Promise<boolean>;
  deletePending?(
    schoolId: string,
    userId: string,
    key: string,
    requestHash: string,
  ): Promise<void>;
  reclaimExpired?(
    schoolId: string,
    userId: string,
    key: string,
    requestHash: string,
  ): Promise<string | undefined>;
  releaseOwned?(
    schoolId: string,
    userId: string,
    key: string,
    requestHash: string,
    leaseToken: string,
  ): Promise<boolean>;
  find(
    schoolId: string,
    userId: string,
    key: string,
  ): Promise<IdempotencyRecord | undefined>;
  release?(schoolId: string, userId: string, key: string): Promise<void>;
}

export type IdempotencyClaim =
  | { leaseToken: string; requestHash: string; state: "claimed" }
  | { state: "expired" }
  | { state: "in_progress" }
  | { response: IdempotencyResponse; state: "completed" };

export type IdempotencyCompletionResult =
  | { response: IdempotencyResponse; state: "completed" }
  | { state: "ownership_lost" };

export type IdempotencyReleaseResult =
  | { response: IdempotencyResponse; state: "completed" }
  | { state: "ownership_lost" }
  | { state: "released" };

export class IdempotencyConflictError extends Error {
  public readonly code = "IDEMPOTENCY_CONFLICT";

  public constructor() {
    super("Idempotency key was already used with a different request");
    this.name = "IdempotencyConflictError";
  }
}

export class IdempotencyStore {
  public constructor(private readonly records: IdempotencyRecordStore) {}

  public async claim(request: IdempotencyRequest): Promise<IdempotencyClaim> {
    const requestHash = hashCanonicalRequest(request.requestBody);
    const leaseToken = new Date(Date.now() + 600_000).toISOString();
    const created = await this.records.create({
      key: request.key,
      leaseExpiresAt: leaseToken,
      requestHash,
      responseBody: null,
      responseStatus: null,
      schoolId: request.schoolId,
      userId: request.userId,
    });
    if (created) {
      return { leaseToken, requestHash, state: "claimed" };
    }

    const existing = await this.records.find(
      request.schoolId,
      request.userId,
      request.key,
    );
    if (existing === undefined) {
      throw new Error("Idempotency record disappeared while being claimed");
    }
    if (existing.requestHash !== requestHash) {
      throw new IdempotencyConflictError();
    }
    if (existing.responseStatus !== null) {
      return {
        response: {
          body: existing.responseBody,
          status: existing.responseStatus,
        },
        state: "completed",
      };
    }

    if (
      existing.leaseExpiresAt !== null &&
      existing.leaseExpiresAt !== undefined &&
      Date.parse(existing.leaseExpiresAt) <= Date.now()
    ) {
      return { state: "expired" };
    }
    return { state: "in_progress" };
  }

  public async complete(
    request: IdempotencyRequest,
    response: IdempotencyResponse,
  ): Promise<void> {
    const existing = await this.records.find(
      request.schoolId,
      request.userId,
      request.key,
    );
    if (existing === undefined) {
      throw new Error("Idempotency key must be claimed before completion");
    }
    if (existing.requestHash !== hashCanonicalRequest(request.requestBody)) {
      throw new IdempotencyConflictError();
    }
    if (existing.responseStatus !== null) return;
    await this.records.complete(
      request.schoolId,
      request.userId,
      request.key,
      response,
    );
  }

  public async completeOwned(
    request: IdempotencyRequest,
    leaseToken: string,
    response: IdempotencyResponse,
  ): Promise<IdempotencyCompletionResult> {
    if (this.records.completeOwned === undefined) {
      throw new Error('Idempotency record store must implement fenced completion');
    }
    const requestHash = hashCanonicalRequest(request.requestBody);
    const completed = await this.records.completeOwned(
      request.schoolId,
      request.userId,
      request.key,
      requestHash,
      leaseToken,
      response,
    );
    if (completed) return { response, state: 'completed' };

    const existing = await this.records.find(
      request.schoolId,
      request.userId,
      request.key,
    );
    if (existing !== undefined && existing.requestHash !== requestHash) {
      throw new IdempotencyConflictError();
    }
    if (existing?.responseStatus !== null && existing?.responseStatus !== undefined) {
      return {
        response: {
          body: existing.responseBody,
          status: existing.responseStatus,
        },
        state: 'completed',
      };
    }
    return { state: 'ownership_lost' };
  }

  public async failClosed(request: IdempotencyRequest): Promise<void> {
    const existing = await this.records.find(
      request.schoolId,
      request.userId,
      request.key,
    );
    if (existing === undefined) {
      throw new Error(
        "Idempotency key must be claimed before it can be closed",
      );
    }
    if (existing.requestHash !== hashCanonicalRequest(request.requestBody)) {
      throw new IdempotencyConflictError();
    }
    if (existing.responseStatus !== null) return;
    await this.records.complete(request.schoolId, request.userId, request.key, {
      body: { code: "IDEMPOTENCY_COMPLETION_UNAVAILABLE" },
      status: 503,
    });
  }

  public async reclaimExpired(request: IdempotencyRequest): Promise<string | undefined> {
    if (this.records.reclaimExpired === undefined) {
      throw new Error('Idempotency record store must implement atomic expired-lease reclamation');
    }
    return this.records.reclaimExpired(
      request.schoolId,
      request.userId,
      request.key,
      hashCanonicalRequest(request.requestBody),
    );
  }

  public async releaseOwned(
    request: IdempotencyRequest,
    leaseToken: string,
  ): Promise<IdempotencyReleaseResult> {
    if (this.records.releaseOwned === undefined) {
      throw new Error('Idempotency record store must implement fenced release');
    }
    const requestHash = hashCanonicalRequest(request.requestBody);
    const released = await this.records.releaseOwned(
      request.schoolId,
      request.userId,
      request.key,
      requestHash,
      leaseToken,
    );
    if (released) return { state: 'released' };

    const existing = await this.records.find(
      request.schoolId,
      request.userId,
      request.key,
    );
    if (existing !== undefined && existing.requestHash !== requestHash) {
      throw new IdempotencyConflictError();
    }
    if (existing?.responseStatus !== null && existing?.responseStatus !== undefined) {
      return {
        response: {
          body: existing.responseBody,
          status: existing.responseStatus,
        },
        state: 'completed',
      };
    }
    return { state: 'ownership_lost' };
  }

  public async release(request: IdempotencyRequest): Promise<void> {
    const requestHash = hashCanonicalRequest(request.requestBody);
    if (this.records.deletePending !== undefined) {
      await this.records.deletePending(
        request.schoolId,
        request.userId,
        request.key,
        requestHash,
      );
      return;
    }
    if (this.records.release === undefined) {
      throw new Error(
        "Idempotency record store must implement release or deletePending",
      );
    }
    const existing = await this.records.find(
      request.schoolId,
      request.userId,
      request.key,
    );
    if (existing === undefined || existing.responseStatus !== null) return;
    if (existing.requestHash !== requestHash) {
      throw new IdempotencyConflictError();
    }
    await this.records.release(request.schoolId, request.userId, request.key);
  }
}
export class DatabaseIdempotencyRecordStore implements IdempotencyRecordStore {
  public constructor(private readonly db: Database) {}

  public async create(record: IdempotencyRecord): Promise<boolean> {
    const leaseExpiresAt = record.leaseExpiresAt ?? new Date(Date.now() + 600_000).toISOString();
    const rows = await this.db.execute(sql<{ school_id: string }>`
      insert into public.api_idempotency_keys (
        school_id,
        user_id,
        idempotency_key,
        request_hash,
        lease_expires_at
      )
      values (
        ${record.schoolId}::uuid,
        ${record.userId}::uuid,
        ${record.key},
        ${record.requestHash},
        ${leaseExpiresAt}::timestamptz
      )
      on conflict (school_id, user_id, idempotency_key) do nothing
      returning school_id
    `);
    return (rows as unknown as ReadonlyArray<{ school_id: string }>).length > 0;
  }

  public async find(
    schoolId: string,
    userId: string,
    key: string,
  ): Promise<IdempotencyRecord | undefined> {
    const rows = await this.db.execute(sql<{
      idempotency_key: string;
      request_hash: string;
      response_body: unknown | null;
      response_status: number | null;
      lease_expires_at: string | null;
      school_id: string;
      user_id: string;
    }>`
      select
        school_id,
        user_id,
        idempotency_key,
        request_hash,
        response_status,
        response_body,
        lease_expires_at
      from public.api_idempotency_keys
      where school_id = ${schoolId}::uuid
        and user_id = ${userId}::uuid
        and idempotency_key = ${key}
    `);
    const row = (
      rows as unknown as ReadonlyArray<{
        idempotency_key: string;
        request_hash: string;
        response_body: unknown | null;
        response_status: number | null;
        lease_expires_at: string | null;
        school_id: string;
        user_id: string;
      }>
    )[0];
    if (row === undefined) {
      return undefined;
    }

    return {
      leaseExpiresAt: row.lease_expires_at,
      key: row.idempotency_key,
      requestHash: row.request_hash,
      responseBody: row.response_body,
      responseStatus: row.response_status,
      schoolId: row.school_id,
      userId: row.user_id,
    };
  }

  public async reclaimExpired(
    schoolId: string,
    userId: string,
    key: string,
    requestHash: string,
  ): Promise<string | undefined> {
    const reclaimed = await this.db.execute(sql<{ lease_expires_at: string }>`
      update public.api_idempotency_keys
      set lease_expires_at = clock_timestamp() + interval '10 minutes'
      where school_id = ${schoolId}::uuid
        and user_id = ${userId}::uuid
        and idempotency_key = ${key}
        and request_hash = ${requestHash}
        and response_status is null
        and lease_expires_at <= clock_timestamp()
      returning lease_expires_at::text as lease_expires_at
    `);
    return (reclaimed as unknown as ReadonlyArray<{ lease_expires_at: string }>)[0]?.lease_expires_at;
  }

  public async deletePending(
    schoolId: string,
    userId: string,
    key: string,
    requestHash: string,
  ): Promise<void> {
    await this.db.execute(
      sql`delete from public.api_idempotency_keys where school_id = ${schoolId}::uuid and user_id = ${userId}::uuid and idempotency_key = ${key} and request_hash = ${requestHash} and response_status is null`,
    );
  }

  public async completeOwned(
    schoolId: string,
    userId: string,
    key: string,
    requestHash: string,
    leaseToken: string,
    response: IdempotencyResponse,
  ): Promise<boolean> {
    const completed = await this.db.execute(sql<{ idempotency_key: string }>`
      update public.api_idempotency_keys
      set response_status = ${response.status},
          response_body = ${JSON.stringify(response.body ?? null)}::jsonb,
          completed_at = now()
      where school_id = ${schoolId}::uuid
        and user_id = ${userId}::uuid
        and idempotency_key = ${key}
        and request_hash = ${requestHash}
        and lease_expires_at = ${leaseToken}::timestamptz
        and response_status is null
      returning idempotency_key
    `);
    return (completed as unknown as ReadonlyArray<{ idempotency_key: string }>).length > 0;
  }

  public async complete(
    schoolId: string,
    userId: string,
    key: string,
    response: IdempotencyResponse,
  ): Promise<void> {
    await this.db.execute(sql`
      update public.api_idempotency_keys
      set response_status = ${response.status},
          response_body = ${JSON.stringify(response.body ?? null)}::jsonb,
          completed_at = now()
      where school_id = ${schoolId}::uuid
        and user_id = ${userId}::uuid
        and idempotency_key = ${key}
        and response_status is null
    `);
  }

  public async releaseOwned(
    schoolId: string,
    userId: string,
    key: string,
    requestHash: string,
    leaseToken: string,
  ): Promise<boolean> {
    const released = await this.db.execute(sql<{ idempotency_key: string }>`
      delete from public.api_idempotency_keys
      where school_id = ${schoolId}::uuid
        and user_id = ${userId}::uuid
        and idempotency_key = ${key}
        and request_hash = ${requestHash}
        and lease_expires_at = ${leaseToken}::timestamptz
        and response_status is null
      returning idempotency_key
    `);
    return (released as unknown as ReadonlyArray<{ idempotency_key: string }>).length > 0;
  }

  public async release(
    schoolId: string,
    userId: string,
    key: string,
  ): Promise<void> {
    await this.db.execute(sql`
      delete from public.api_idempotency_keys
      where school_id = ${schoolId}::uuid
        and user_id = ${userId}::uuid
        and idempotency_key = ${key}
        and response_status is null
    `);
  }
}

export function deterministicIdempotencyUuid(input: {
  key: string;
  schoolId: string;
  userId: string;
}): string {
  const bytes = Buffer.from(hashCanonicalRequest(input), 'hex').subarray(0, 16);
  const versionByte = bytes.at(6);
  const variantByte = bytes.at(8);
  if (versionByte === undefined || variantByte === undefined) {
    throw new Error('Idempotency hash is unexpectedly shorter than a UUID');
  }
  bytes[6] = (versionByte & 0x0f) | 0x80;
  bytes[8] = (variantByte & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function hashCanonicalRequest(requestBody: unknown): string {
  return createHash("sha256").update(canonicalJson(requestBody)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(
        "Idempotency request bodies must contain finite numbers",
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, entryValue]) =>
          `${JSON.stringify(key)}:${canonicalJson(entryValue)}`,
      )
      .join(",")}}`;
  }
  if (value === undefined) {
    return "null";
  }

  throw new TypeError("Idempotency request bodies must be JSON values");
}
