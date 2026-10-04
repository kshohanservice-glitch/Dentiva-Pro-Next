import { describe, expect, it } from 'vitest';
import { formatBdt, parseBdtToPaisa, dateRangeFor, todayISO } from '../../src/shared/currency';

describe('currency helpers', () => {
  it('formats paisa as BDT with ৳ symbol', () => {
    expect(formatBdt(123456)).toBe('৳1,234.56');
    expect(formatBdt(0)).toBe('৳0.00');
    expect(formatBdt(5)).toBe('৳0.05');
    expect(formatBdt(100, { symbol: false })).toBe('1.00');
  });

  it('parses user input into integer paisa', () => {
    expect(parseBdtToPaisa('150')).toBe(15000);
    expect(parseBdtToPaisa('150.55')).toBe(15055);
    expect(parseBdtToPaisa('৳1,200.00')).toBe(120000);
    expect(parseBdtToPaisa(42)).toBe(4200);
    expect(parseBdtToPaisa(null)).toBeNull();
    expect(parseBdtToPaisa('')).toBeNull();
    expect(parseBdtToPaisa('abc')).toBeNull();
    expect(parseBdtToPaisa('-5')).toBe(-500);
  });

  it('never produces fractional paisa (money is integer end-to-end)', () => {
    for (const input of ['0.001', '1.999', '12.345']) {
      const p = parseBdtToPaisa(input);
      if (p !== null) expect(Number.isInteger(p)).toBe(true);
    }
  });

  it('builds date ranges for filters', () => {
    const today = dateRangeFor('today');
    expect(today.from).toBe(todayISO());
    expect(today.to).toBe(todayISO());
    const all = dateRangeFor('all');
    expect(all.from).toBeUndefined();
    const custom = dateRangeFor('custom', '2026-01-01', '2026-01-31');
    expect(custom).toEqual({ from: '2026-01-01', to: '2026-01-31' });
  });
});
