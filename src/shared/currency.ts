/** Shared currency + date formatting (BDT default). Rendered client-side and in print views. */

export const CURRENCY_SYMBOL = '৳';

/** Format paisa integer as BDT: 123456 → ৳1,234.56 */
export function formatBdt(paisa: number, opts?: { symbol?: boolean; decimals?: number }): string {
  const symbol = opts?.symbol ?? true;
  const decimals = opts?.decimals ?? 2;
  const sign = paisa < 0 ? '-' : '';
  const abs = Math.abs(paisa);
  const taka = Math.floor(abs / 100);
  const frac = abs % 100;
  const grouped = String(taka).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fracStr = decimals > 0 ? `.${String(frac).padStart(2, '0').slice(0, decimals)}` : '';
  return `${sign}${symbol ? CURRENCY_SYMBOL : ''}${grouped}${fracStr}`;
}

/** Parse user input like "1,200", "1200.50", "৳1200" → paisa integer. Returns null when invalid. */
export function parseBdtToPaisa(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return Math.round(input * 100);
  }
  const cleaned = input.replace(/[৳,\s]/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(parseFloat(cleaned) * 100);
}

/** Today as YYYY-MM-DD (local time). */
export function todayISO(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function nowISO(): string {
  return new Date().toISOString();
}

export function dateRangeFor(filter: 'today' | '7' | '30' | '90' | '365' | 'all' | 'custom', from?: string, to?: string): { from?: string; to?: string } {
  const now = new Date();
  switch (filter) {
    case 'today':
      return { from: todayISO(now), to: todayISO(now) };
    case '7':
    case '30':
    case '90':
    case '365': {
      const start = new Date(now);
      start.setDate(start.getDate() - (Number(filter) - 1));
      return { from: todayISO(start), to: todayISO(now) };
    }
    case 'custom':
      return { from, to };
    case 'all':
    default:
      return {};
  }
}
