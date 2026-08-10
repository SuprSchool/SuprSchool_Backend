import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    censor: '[REDACTED]',
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers.set-cookie',
    ],
  },
});

/**
 * Error messages routinely carry a connection string — a failed Drizzle query
 * and a Postgres connection error both do — so every log site that writes an
 * error message through goes past this first.
 */
export function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  return message.replace(
    /\b([a-z][a-z\d+.-]*:\/\/)[^/\s@]+@/gi,
    (_match, protocol: string) => protocol + '[REDACTED]@',
  );
}

/**
 * Returns the chain of `cause` messages under an error, or `null` when there is
 * none. A `DrizzleQueryError` keeps the Postgres error — the part that actually
 * says what went wrong — in its cause, so dropping it loses the diagnosis.
 */
export function safeErrorCause(error: unknown): string | null {
  const causes: string[] = [];
  let current: unknown = error instanceof Error ? error.cause : undefined;

  while (current !== undefined && current !== null && causes.length < 3) {
    causes.push(safeErrorMessage(current));
    current = current instanceof Error ? current.cause : undefined;
  }

  return causes.length === 0 ? null : causes.join(': ');
}
