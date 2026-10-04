/**
 * CSV serialization with spreadsheet formula-injection defense.
 *
 * Excel/LibreOffice/Google Sheets execute cells that begin with `=`, `+`, `@`
 * (and historically `-`) as formulas. Untrusted text (patient names, notes,
 * references…) must be neutralized before the CSV leaves the app. We prefix a
 * single quote — Excel renders the cell literally — and leave pure numbers
 * (including negative numbers) untouched so numeric imports keep working.
 */

const FORMULA_START = new Set(['=', '+', '@', '-']);

export function isNumericCell(s: string): boolean {
  // Strict number (int/decimal, optional leading -, no whitespace) → safe as-is.
  return /^-?(\d+(\.\d+)?|\.\d+)$/.test(s);
}

export function neutralizeFormula(value: unknown): string {
  const s = String(value ?? '');
  if (s.length === 0) return s;
  const first = s.charAt(0);
  if (!FORMULA_START.has(first)) return s;
  if (isNumericCell(s)) return s;
  // Tab/CR variants are also formula triggers in some spreadsheet tools;
  // those never reach here (first char check) but `-2+3+cmd|…` style does.
  return `'${s}`;
}

export function csvEscape(v: unknown): string {
  const s = neutralizeFormula(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(header: string[], rows: string[][]): string {
  return [header.map(csvEscape).join(','), ...rows.map((r) => r.map(csvEscape).join(','))].join('\r\n');
}
