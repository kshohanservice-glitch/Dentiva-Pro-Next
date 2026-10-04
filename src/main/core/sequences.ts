import type { DB } from '../db/database';
import { conflict } from '../errors';

/**
 * Atomic sequential counters (invoices/prescriptions/patients).
 * Guarded against concurrent use via transaction + UPDATE ... RETURNING.
 */
export function nextSequence(db: DB, name: string, year: number): number {
  const row = db
    .prepare('UPDATE sequences SET last_value = last_value + 1 WHERE name = ? AND year = ? RETURNING last_value')
    .get(name, year) as { last_value: number } | undefined;
  if (row) return row.last_value;
  try {
    db.prepare('INSERT INTO sequences (name, year, last_value) VALUES (?, ?, 1)').run(name, year);
    return 1;
  } catch {
    const again = db
      .prepare('UPDATE sequences SET last_value = last_value + 1 WHERE name = ? AND year = ? RETURNING last_value')
      .get(name, year) as { last_value: number } | undefined;
    if (!again) throw conflict('Could not generate document number.');
    return again.last_value;
  }
}

export function formatInvoiceNumber(year: number, n: number): string {
  return `INV-${year}-${String(n).padStart(5, '0')}`;
}

export function parseInvoiceNumber(value: string): { year: number; sequence: number } | null {
  const m = /^INV-(\d{4})-(\d{1,9})$/.exec(String(value).trim());
  if (!m) return null;
  const year = Number(m[1]);
  const sequence = Number(m[2]);
  return Number.isInteger(year) && sequence > 0 ? { year, sequence } : null;
}

export function peekNextInvoiceNumber(db: DB, date: string): string {
  const year = Number(date.slice(0, 4));
  const row = db.prepare('SELECT last_value FROM sequences WHERE name = ? AND year = ?').get('invoice', year) as { last_value: number } | undefined;
  return formatInvoiceNumber(year, Number(row?.last_value ?? 0) + 1);
}

export function nextInvoiceNumber(db: DB, date: string): string {
  const year = Number(date.slice(0, 4));
  return formatInvoiceNumber(year, nextSequence(db, 'invoice', year));
}

export function nextPrescriptionNumber(db: DB, date: string): string {
  const year = Number(date.slice(0, 4));
  const n = nextSequence(db, 'rx', year);
  return `RX-${year}-${String(n).padStart(5, '0')}`;
}

export function nextPatientCode(db: DB): string {
  const n = nextSequence(db, 'patient', 0);
  return `P-${String(n).padStart(6, '0')}`;
}
