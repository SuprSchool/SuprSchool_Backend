import { AppError } from '../../lib/errors.js';
import {
  IdempotencyConflictError,
  type IdempotencyStore,
} from '../idempotency/idempotency-store.js';

export interface AcademicMutationIdentity {
  schoolId: string;
  userId: string;
}

export interface AcademicMutationInput<T> {
  idempotencyKey: string;
  requestBody: unknown;
  successStatus: number;
  recover?: () => Promise<T | undefined>;
  work: () => Promise<T>;
}

export interface AcademicMutationExecutor {
  execute<T>(
    identity: AcademicMutationIdentity,
    input: AcademicMutationInput<T>,
  ): Promise<{ body: T; replayed: boolean; status: number }>;
}

function completionUnavailable(): AppError {
  return new AppError(
    'IDEMPOTENCY_COMPLETION_UNAVAILABLE' as never,
    503,
    'The mutation outcome could not be confirmed; retry with the same idempotency key',
  );
}

export function createAcademicMutationExecutor(
  idempotency: IdempotencyStore,
): AcademicMutationExecutor {
  return {
    async execute<T>(identity: AcademicMutationIdentity, input: AcademicMutationInput<T>) {
      const request = {
        key: input.idempotencyKey,
        requestBody: input.requestBody,
        schoolId: identity.schoolId,
        userId: identity.userId,
      };
      let claim;
      try {
        claim = await idempotency.claim(request);
      } catch (error) {
        if (error instanceof IdempotencyConflictError) {
          throw new AppError('IDEMPOTENCY_CONFLICT' as never, 409, error.message);
        }
        throw error;
      }
      if (claim.state === 'completed') {
        if (claim.response.status >= 500) throw completionUnavailable();
        return { body: claim.response.body as T, replayed: true, status: claim.response.status };
      }
      if (claim.state === 'expired') {
        try { await idempotency.failClosed(request); } catch { /* retry keeps fail-closed semantics */ }
        throw completionUnavailable();
      }
      if (claim.state === 'in_progress') {
        if (input.recover === undefined) {
          throw new AppError(
            'IDEMPOTENCY_IN_PROGRESS' as never,
            409,
            'An identical request is already in progress',
          );
        }
        try {
          const recovered = await input.recover();
          if (recovered === undefined) throw completionUnavailable();
          return await persistCompletion(recovered, true);
        } catch (error) {
          if (error instanceof AppError) throw error;
          throw completionUnavailable();
        }
      }
      async function persistCompletion(body: T, replayed: boolean): Promise<{ body: T; replayed: boolean; status: number }> {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            await idempotency.complete(request, { body, status: input.successStatus });
            return { body, replayed, status: input.successStatus };
          } catch {
            const recovered = await idempotency.claim(request);
            if (recovered.state === 'completed') {
              return {
                body: recovered.response.body as T,
                replayed,
                status: recovered.response.status,
              };
            }
          }
        }
        try { await idempotency.failClosed(request); } catch { /* a later same-key retry will close it */ }
        throw completionUnavailable();
      }

      let body: T;
      try {
        body = await input.work();
      } catch (error) {
        if (input.recover === undefined) {
          await idempotency.release(request);
          throw error;
        }
        try {
          const recovered = await input.recover();
          if (recovered === undefined) {
            await idempotency.release(request);
            throw error;
          }
          body = recovered;
        } catch (recoveryError) {
          if (recoveryError === error) throw error;
          throw completionUnavailable();
        }
      }
      return persistCompletion(body, false);
    },
  };
}
