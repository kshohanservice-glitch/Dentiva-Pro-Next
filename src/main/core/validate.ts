import { validation } from '../errors';

export function reqString(value: unknown, field: string, opts: { max?: number; min?: number } = {}): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw validation(`${field} is required.`);
  }
  const v = value.trim();
  if (opts.min !== undefined && v.length < opts.min) throw validation(`${field} is too short.`);
  if (opts.max !== undefined && v.length > opts.max) throw validation(`${field} is too long (max ${opts.max} characters).`);
  return v;
}

export function optString(value: unknown, field: string, opts: { max?: number } = {}): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw validation(`${field} must be text.`);
  const v = value.trim();
  if (v === '') return null;
  if (opts.max !== undefined && v.length > opts.max) throw validation(`${field} is too long (max ${opts.max} characters).`);
  return v;
}

export function reqInt(value: unknown, field: string, opts: { min?: number; max?: number } = {}): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n)) throw validation(`${field} must be a whole number.`);
  if (opts.min !== undefined && n < opts.min) throw validation(`${field} must be at least ${opts.min}.`);
  if (opts.max !== undefined && n > opts.max) throw validation(`${field} must be at most ${opts.max}.`);
  return n;
}

export function optInt(value: unknown, field: string, opts: { min?: number; max?: number } = {}): number | null {
  if (value === null || value === undefined || value === '') return null;
  return reqInt(value, field, opts);
}

export function reqNumber(value: unknown, field: string, opts: { min?: number; max?: number } = {}): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw validation(`${field} must be a number.`);
  if (opts.min !== undefined && n < opts.min) throw validation(`${field} must be at least ${opts.min}.`);
  if (opts.max !== undefined && n > opts.max) throw validation(`${field} must be at most ${opts.max}.`);
  return n;
}

export function reqDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw validation(`${field} must be a valid date (YYYY-MM-DD).`);
  }
  // Round-trip check: JavaScript's Date rolls impossible days over
  // (2026-02-31 → 2026-03-03), so a NaN check is not enough. Reconstruct the
  // date from components and require an exact match.
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw validation(`${field} must be a valid calendar date.`);
  }
  return value;
}

export function optDate(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  return reqDate(value, field);
}

export function reqTime(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw validation(`${field} must be a valid time (HH:MM).`);
  }
  return value;
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw validation(`${field} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

export function optOneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T | null {
  if (value === null || value === undefined || value === '') return null;
  return oneOf(value, allowed, field);
}

/** Bangladesh phone: 01XXXXXXXXX (11 digits) with optional +880 prefix; also tolerates separators. */
export function normalizePhone(value: string): string | null {
  const digits = value.replace(/[\s\-().]/g, '');
  if (digits === '') return null;
  const normalized = digits.replace(/^\+880/, '0');
  if (!/^01[3-9]\d{8}$/.test(normalized)) {
    throw validation('Phone number must be a valid Bangladeshi number (e.g. 01712345678).');
  }
  return normalized;
}

export function optPhone(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw validation(`${field} must be text.`);
  return normalizePhone(value);
}

export function reqPhone(value: unknown, field: string): string {
  const p = optPhone(value, field);
  if (!p) throw validation(`${field} is required.`);
  return p;
}

export function reqPassword(value: unknown, minLength = 8): string {
  if (typeof value !== 'string' || value.length < minLength) {
    throw validation(`Password must be at least ${minLength} characters long.`);
  }
  if (value.length > 200) throw validation('Password is too long.');
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    throw validation('Password must contain both letters and numbers.');
  }
  return value;
}

export function reqUsername(value: unknown): string {
  const v = reqString(value, 'Username', { min: 3, max: 40 });
  if (!/^[A-Za-z0-9._-]+$/.test(v)) {
    throw validation('Username may only contain letters, numbers, dots, dashes and underscores.');
  }
  return v.toLowerCase();
}

export function pageParams(page: unknown, pageSize: unknown): { page: number; pageSize: number; offset: number } {
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.min(500, Math.max(5, Number(pageSize) || 25));
  return { page: p, pageSize: ps, offset: (p - 1) * ps };
}

/** Escape SQLite LIKE wildcards (`%`, `_`, `\`) for use with `LIKE ? ESCAPE '\'`. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}
