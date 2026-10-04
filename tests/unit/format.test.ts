import { describe, expect, it } from 'vitest';
import { formatDate } from '../../src/renderer/format';

describe('formatDate', () => {
  it('formats ISO dates as DD/MM/YYYY', () => {
    expect(formatDate('2026-10-04')).toBe('04/10/2026');
  });

  it('formats Date values as DD/MM/YYYY', () => {
    expect(formatDate(new Date(2026, 9, 4))).toBe('04/10/2026');
  });

  it('returns a safe placeholder for missing or invalid values', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('not-a-date')).toBe('—');
  });
});
