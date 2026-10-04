/** Formatting helpers shared by renderer pages (BDT money, dates). */

export function bdt(paisa: number): string {
  return `৳${(paisa / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function bdtShort(paisa: number): string {
  const v = paisa / 100;
  if (Math.abs(v) >= 1_000_000) return `৳${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000) return `৳${(v / 1_000).toFixed(1)}k`;
  return bdt(paisa);
}

/** yyyy-MM-dd for <input type="date"> */
export function isoDate(d: Date): string {
  const tz = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

/** Display dates in Bangladesh-friendly day/month/year order: DD/MM/YYYY. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const raw = value instanceof Date ? value : String(value);
  const match = typeof raw === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(raw) : null;
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/** yyyy-MM-ddTHH:mm for <input type="datetime-local"> */
export function localDateTime(d: Date): string {
  const tz = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}

export function ageFromDob(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const t = new Date(dob).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / (365.25 * 86_400_000)));
}

export function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  const t = new Date(date).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / 86_400_000);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Status badge tone mapping reused across lists. */
export function statusTone(status: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand' {
  switch (status) {
    case 'paid':
    case 'completed':
    case 'active':
    case 'success':
      return 'success';
    case 'partial':
    case 'scheduled':
    case 'confirmed':
    case 'waiting':
    case 'called':
    case 'open':
    case 'partial ':
      return 'warning';
    case 'voided':
    case 'cancelled':
    case 'no_show':
    case 'blocked':
    case 'disabled':
    case 'locked':
    case 'expired':
      return 'danger';
    case 'unpaid':
    case 'draft':
    case 'in_queue':
    case 'in_treatment':
      return 'info';
    default:
      return 'neutral';
  }
}

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.slice(0, 1).toUpperCase())
    .join('');
}
