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

const MAX_LOGGED_CAUSE_DEPTH = 4;

/**
 * Error messages routinely carry a connection string — a failed Drizzle query
 * and a Postgres connection error both do — so every log site that writes an
 * error message through goes past this first.
 *
 * Shared by the queue worker and the HTTP 5xx handler. The two kept private
 * copies while the worker and request paths sat in different slices; they were
 * folded together here once both landed on main.
 */
export function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  return message.replace(
    /\b([a-z][a-z\d+.-]*:\/\/)[^/\s@]+@/gi,
    (_match, protocol: string) => protocol + '[REDACTED]@',
  );
}

/**
 * Returns the chain of `cause` messages under an error, or `undefined` when
 * there is none. A `DrizzleQueryError` keeps the Postgres error — the part that
 * actually says what went wrong — in its cause, so dropping it loses the
 * diagnosis.
 *
 * The same holds on the request path: a wrapped dependency failure carries the
 * actionable detail on `cause`, so a missing ffprobe binary reaches the error
 * handler as a generic 503 whose cause is `spawn ffprobe ENOENT`. Without the
 * chain the log names only the wrapper, leaving a permanent misconfiguration
 * indistinguishable from a transient outage.
 */
export function safeErrorCause(error: unknown): string | undefined {
  const messages: string[] = [];
  let current: unknown = (error as { cause?: unknown } | null)?.cause;

  for (
    let depth = 0;
    depth < MAX_LOGGED_CAUSE_DEPTH && current !== undefined && current !== null;
    depth += 1
  ) {
    messages.push(safeErrorMessage(current));
    current = (current as { cause?: unknown }).cause;
  }

  return messages.length === 0 ? undefined : messages.join(' <- ');
}
