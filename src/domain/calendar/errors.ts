import { ZodError } from 'zod';
import { NotFoundError, NotPermittedError } from '../common/errors';

// The calendar services' error boundary (ADR 0007 §42). A database error can
// carry its query's parameters in its message and its cause (Drizzle's
// "Failed query … params: …"), and those parameters can be a sealed
// credential or an address fingerprint. So nothing unexpected crosses the
// boundary as it is: HOME's own refusals (fixed codes) and input validation
// pass through; anything else becomes a CalendarUnexpectedError that keeps
// only what helps a diagnosis without holding a secret: the operation, the
// error's class name and a Postgres SQLSTATE. No message, no cause, no stack
// from the original. The logger's value scrubbing stays as defence in depth.

export class CalendarUnexpectedError extends Error {
  constructor(
    readonly operation: string,
    readonly kind: string,
    readonly sqlState: string | null,
  ) {
    super(`calendar_unexpected: ${operation}`);
    this.name = 'CalendarUnexpectedError';
  }
}

const SQLSTATE = /^[0-9A-Z]{5}$/;

function sqlStateOf(e: unknown, depth = 0): string | null {
  if (typeof e !== 'object' || e === null || depth > 3) return null;
  const code = (e as { code?: unknown }).code;
  if (typeof code === 'string' && SQLSTATE.test(code)) return code;
  return sqlStateOf((e as { cause?: unknown }).cause, depth + 1);
}

/** Runs a calendar operation, letting only structural errors out. */
export async function calendarBoundary<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (
      e instanceof NotPermittedError ||
      e instanceof NotFoundError ||
      e instanceof ZodError ||
      e instanceof CalendarUnexpectedError
    )
      throw e;
    const kind = e instanceof Error ? e.name : typeof e;
    throw new CalendarUnexpectedError(operation, kind, sqlStateOf(e));
  }
}
