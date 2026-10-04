/** Application error taxonomy — drives user-facing messages vs. log detail. */

export type ErrorCode =
  | 'VALIDATION' | 'NOT_FOUND' | 'PERMISSION' | 'CONFLICT' | 'AUTH'
  | 'BACKUP' | 'RESTORE' | 'FILE' | 'INTERNAL' | 'ACTIVATION';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly userMessage: string;
  readonly details?: unknown;

  constructor(code: ErrorCode, userMessage: string, options?: { cause?: unknown; details?: unknown }) {
    super(userMessage);
    this.name = 'AppError';
    this.code = code;
    this.userMessage = userMessage;
    if (options?.details !== undefined) this.details = options.details;
    if (options?.cause !== undefined) (this as any).cause = options.cause;
  }
}

export const validation = (msg: string, details?: unknown) => new AppError('VALIDATION', msg, { details });
export const notFound = (msg: string) => new AppError('NOT_FOUND', msg);
export const forbidden = (msg = 'You do not have permission to perform this action.') => new AppError('PERMISSION', msg);
export const conflict = (msg: string) => new AppError('CONFLICT', msg);
export const authError = (msg: string) => new AppError('AUTH', msg);

/** Shape returned over IPC: never includes stack traces. */
export interface WireError {
  ok: false;
  code: ErrorCode | 'INTERNAL';
  message: string;
  correlationId?: string;
  details?: unknown;
}

export function toWireError(err: unknown, correlationId?: string): WireError {
  if (err instanceof AppError) {
    return { ok: false, code: err.code, message: err.userMessage, details: err.details, correlationId };
  }
  const message = err instanceof Error ? 'An unexpected error occurred. Please try again.' : 'An unexpected error occurred.';
  return { ok: false, code: 'INTERNAL', message, correlationId };
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
