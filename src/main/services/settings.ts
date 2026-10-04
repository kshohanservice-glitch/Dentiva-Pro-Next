import fs from 'node:fs';
import path from 'node:path';
import type { Ctx } from '../core/context';
import type { PrintProfile, SettingsDTO } from '../../shared/types';
import { forbidden, validation } from '../errors';
import { audit, requirePermission, tx } from '../core/context';
import { ensureDir, safeResolve } from '../paths';
import { nowISO, todayISO } from '../../shared/currency';
import { peekNextInvoiceNumber, parseInvoiceNumber } from '../core/sequences';
import { reqString } from '../core/validate';

function readSetting<T>(ctx: Ctx, key: string, fallback: T): T {
  const row = ctx.db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as { value_json: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    return fallback;
  }
}

function writeSetting(ctx: Ctx, key: string, value: unknown): void {
  ctx.db
    .prepare(
      `INSERT INTO settings (key, value_json, updated_at, updated_by) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
    .run(key, JSON.stringify(value), nowISO(), ctx.session.userId);
}

function clinicLogoDataUrl(ctx: Ctx, logoPath?: string | null): string | null {
  if (!logoPath) return null;
  try {
    const full = safeResolve(ctx.paths.dataDir, logoPath);
    if (!fs.existsSync(full)) return null;
    const ext = path.extname(full).toLowerCase();
    const mime = ext === '.svg' ? 'image/svg+xml'
      : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
      : ext === '.webp' ? 'image/webp'
      : 'image/png';
    return `data:${mime};base64,${fs.readFileSync(full).toString('base64')}`;
  } catch {
    return null;
  }
}

export function getSettings(ctx: Ctx): SettingsDTO {
  const clinic = readSetting(ctx, 'clinic', {} as SettingsDTO['clinic']);
  const logoDataUrl = clinicLogoDataUrl(ctx, clinic.logoPath);
  const prescription = readSetting(ctx, 'prescription', {} as SettingsDTO['prescription']);
  const rawInvoice = readSetting(ctx, 'invoice', {} as Partial<SettingsDTO['invoice']>);
  const invoice = { ...rawInvoice, nextNumber: rawInvoice.nextNumber || peekNextInvoiceNumber(ctx.db, todayISO()) } as SettingsDTO['invoice'];
  const security = readSetting<SettingsDTO['security']>(ctx, 'security', { autoLockMinutes: 10, minPasswordLength: 8, maxFailedLogins: 5 });
  const backup = readSetting<SettingsDTO['backup']>(ctx, 'backup', { autoFrequencyDays: 7, destination: null, retention: 10 });
  const appearance = readSetting<SettingsDTO['appearance']>(ctx, 'appearance', { theme: 'light', density: 'comfortable', animations: true, sidebarCollapsed: false });
  const notifications = readSetting(ctx, 'notifications', { appointments: true, lowStock: true, dues: true, backup: true });
  const paymentMethods = readSetting(ctx, 'paymentMethods', ['cash', 'bank', 'card', 'bkash', 'nagad', 'rocket', 'upay', 'other']);
  const printProfiles = readSetting<PrintProfile[]>(ctx, 'printProfiles', []);
  return {
    clinic: { ...clinic, currency: 'BDT' as const, logoDataUrl },
    prescription,
    invoice,
    security,
    backup,
    appearance,
    notifications,
    paymentMethods,
    expenseCategories: ctx.db.prepare("SELECT name FROM account_categories WHERE kind = 'expense' ORDER BY name").all<{ name: string }>().map((r) => r.name),
    printProfiles,
  };
}

export function saveSettings(ctx: Ctx, patch: Partial<SettingsDTO>): SettingsDTO {
  requirePermission(ctx, 'settings.manage');
  if (!patch || typeof patch !== 'object') throw validation('No settings supplied.');

  tx(ctx.db, () => {
    if (patch.clinic) {
      const current = readSetting<SettingsDTO['clinic']>(ctx, 'clinic', { clinicName: '', currency: 'BDT' } as any);
      const clinicName = reqString(patch.clinic.clinicName ?? current.clinicName, 'Clinic name', { max: 160 });
      writeSetting(ctx, 'clinic', {
        ...current,
        clinicName,
        clinicNameBn: patch.clinic.clinicNameBn !== undefined ? patch.clinic.clinicNameBn : current.clinicNameBn ?? null,
        logoPath: patch.clinic.logoPath !== undefined ? patch.clinic.logoPath : current.logoPath ?? null,
        address: patch.clinic.address !== undefined ? patch.clinic.address : current.address ?? null,
        phone: patch.clinic.phone !== undefined ? patch.clinic.phone : current.phone ?? null,
        email: patch.clinic.email !== undefined ? patch.clinic.email : current.email ?? null,
        website: patch.clinic.website !== undefined ? patch.clinic.website : current.website ?? null,
        operatingHours: patch.clinic.operatingHours !== undefined ? patch.clinic.operatingHours : current.operatingHours ?? null,
        visitingDays: patch.clinic.visitingDays !== undefined ? patch.clinic.visitingDays : current.visitingDays ?? null,
        currency: 'BDT',
      });
    }

    if (patch.prescription) {
      const current = readSetting<SettingsDTO['prescription']>(ctx, 'prescription', {} as any);
      const labels = { ...current.labels, ...(patch.prescription.labels ?? {}) };
      for (const [k, v] of Object.entries(labels)) {
        labels[k as keyof typeof labels] = reqString(v, `Prescription label "${k}"`, { max: 60 });
      }
      writeSetting(ctx, 'prescription', {
        footerMessage: patch.prescription.footerMessage !== undefined ? patch.prescription.footerMessage : current.footerMessage ?? null,
        visitingHours: patch.prescription.visitingHours !== undefined ? patch.prescription.visitingHours : current.visitingHours ?? null,
        labels,
        signatureReserved: patch.prescription.signatureReserved !== undefined ? !!patch.prescription.signatureReserved : current.signatureReserved ?? true,
      });
    }

    if (patch.invoice) {
      const current = readSetting<SettingsDTO['invoice']>(ctx, 'invoice', {} as any);
      const nextNumber = patch.invoice.nextNumber !== undefined ? String(patch.invoice.nextNumber).trim() : current.nextNumber;
      if (nextNumber) {
        const parsed = parseInvoiceNumber(nextNumber);
        if (!parsed) throw validation('Next invoice number must look like INV-YYYY-00001.');
        const seqRow = ctx.db.prepare('SELECT last_value FROM sequences WHERE name = ? AND year = ?').get('invoice', parsed.year) as { last_value: number } | undefined;
        const invRow = ctx.db.prepare("SELECT COALESCE(MAX(CAST(substr(number, 10) AS INTEGER)), 0) m FROM invoices WHERE number LIKE ?").get(`INV-${parsed.year}-%`) as { m: number };
        const floor = Math.max(Number(seqRow?.last_value ?? 0), Number(invRow?.m ?? 0));
        if (parsed.sequence <= floor) throw validation(`Next invoice number must be greater than the current ${parsed.year} invoice sequence (${floor}).`);
      }
      writeSetting(ctx, 'invoice', {
        nextNumber,
        footerNote: patch.invoice.footerNote !== undefined ? patch.invoice.footerNote : current.footerNote ?? null,
      });
    }

    if (patch.security) {
      const current = readSetting<SettingsDTO['security']>(ctx, 'security', { autoLockMinutes: 10, minPasswordLength: 8, maxFailedLogins: 5 });
      const autoLock = patch.security.autoLockMinutes;
      if (autoLock !== null && autoLock !== undefined && ![5, 10, 15, 30, 60].includes(Number(autoLock))) {
        throw validation('Auto-lock must be 5, 10, 15, 30 or 60 minutes (or disabled).');
      }
      writeSetting(ctx, 'security', {
        autoLockMinutes: autoLock === undefined ? current.autoLockMinutes : autoLock,
        minPasswordLength: Math.max(8, Math.min(64, Number(patch.security.minPasswordLength ?? current.minPasswordLength) || 8)),
        maxFailedLogins: Math.max(3, Math.min(20, Number(patch.security.maxFailedLogins ?? current.maxFailedLogins) || 5)),
      });
    }

    if (patch.backup) {
      const freq = Number(patch.backup.autoFrequencyDays ?? 0);
      if (![0, 7, 15, 30].includes(freq)) throw validation('Backup frequency must be 7, 15, 30 days, or off.');
      writeSetting(ctx, 'backup', {
        autoFrequencyDays: freq,
        destination: patch.backup.destination !== undefined ? patch.backup.destination : readSetting<any>(ctx, 'backup', {}).destination ?? null,
        retention: Math.max(1, Math.min(365, Number(patch.backup.retention ?? 10) || 10)),
      });
    }

    if (patch.appearance) {
      const current = readSetting<SettingsDTO['appearance']>(ctx, 'appearance', {} as any);
      writeSetting(ctx, 'appearance', {
        theme: ['light', 'dark', 'system'].includes(patch.appearance.theme as any) ? patch.appearance.theme : current.theme ?? 'light',
        density: ['comfortable', 'compact'].includes(patch.appearance.density as any) ? patch.appearance.density : current.density ?? 'comfortable',
        animations: patch.appearance.animations !== undefined ? !!patch.appearance.animations : current.animations ?? true,
        sidebarCollapsed: patch.appearance.sidebarCollapsed !== undefined ? !!patch.appearance.sidebarCollapsed : current.sidebarCollapsed ?? false,
      });
    }

    if (patch.notifications) {
      const current = readSetting<SettingsDTO['notifications']>(ctx, 'notifications', {} as any);
      writeSetting(ctx, 'notifications', {
        appointments: patch.notifications.appointments ?? current.appointments ?? true,
        lowStock: patch.notifications.lowStock ?? current.lowStock ?? true,
        dues: patch.notifications.dues ?? current.dues ?? true,
        backup: patch.notifications.backup ?? current.backup ?? true,
      });
    }

    if (patch.paymentMethods) {
      const methods = (Array.isArray(patch.paymentMethods) ? patch.paymentMethods : [])
        .map((m) => String(m).trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 20);
      if (methods.length === 0) throw validation('At least one payment method is required.');
      writeSetting(ctx, 'paymentMethods', methods);
    }

    if (patch.printProfiles) {
      const profiles = (Array.isArray(patch.printProfiles) ? patch.printProfiles : []).slice(0, 30).map((p, i) => {
        const id = reqString(p.id, `Printer profile #${i + 1} id`, { max: 60 });
        const name = reqString(p.name, `Printer profile name`, { max: 80 });
        const width = Number(p.widthMm); const height = Number(p.heightMm);
        if (!Number.isFinite(width) || width < 20 || width > 1000) throw validation(`Profile "${name}": width must be 20–1000 mm.`);
        if (!Number.isFinite(height) || height < 20 || height > 2000) throw validation(`Profile "${name}": height must be 20–2000 mm.`);
        return {
          id, name,
          documentType: (['prescription', 'invoice', 'report', 'receipt'] as const).includes(p.documentType as any) ? p.documentType : 'invoice',
          printerName: String(p.printerName ?? ''),
          paperSize: (['a4', 'a5', 'thermal', 'custom'] as const).includes(p.paperSize as any) ? p.paperSize : 'custom',
          widthMm: width, heightMm: height,
          orientation: p.orientation === 'landscape' ? 'landscape' : 'portrait',
          margins: {
            top: clampNum(p.margins?.top, 0, 50, 10), right: clampNum(p.margins?.right, 0, 50, 10),
            bottom: clampNum(p.margins?.bottom, 0, 50, 10), left: clampNum(p.margins?.left, 0, 50, 10),
          },
          scale: clampNum(p.scale, 50, 200, 100),
          copies: clampNum(p.copies, 1, 10, 1),
        } satisfies PrintProfile;
      });
      writeSetting(ctx, 'printProfiles', profiles);
    }

    audit(ctx, { action: 'settings.update', entityType: 'settings', entityId: null, summary: `Updated settings: ${Object.keys(patch).join(', ')}` });
  });

  return getSettings(ctx);
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/** Copy a logo/clinic image into managed storage; returns relative path. */
export function uploadLogo(ctx: Ctx, sourcePath: string): string {
  requirePermission(ctx, 'settings.manage');
  if (!fs.existsSync(sourcePath)) throw validation('Logo file not found.');
  const stat = fs.statSync(sourcePath);
  if (stat.size > 5 * 1024 * 1024) throw validation('Logo must be smaller than 5 MB.');
  const ext = path.extname(sourcePath).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.svg', '.webp'].includes(ext)) throw validation('Logo must be a PNG, JPG, WEBP or SVG file.');
  const rel = path.join('branding', `logo-${Date.now()}${ext}`);
  const dest = safeResolve(ctx.paths.dataDir, rel);
  ensureDir(path.dirname(dest));
  fs.copyFileSync(sourcePath, dest);

  const clinicRow = ctx.db.prepare("SELECT value_json FROM settings WHERE key = 'clinic'").get<{ value_json: string }>();
  const clinic = clinicRow ? JSON.parse(clinicRow.value_json) : {};
  const previous = clinic.logoPath as string | null;
  clinic.logoPath = rel;
  writeSetting(ctx, 'clinic', clinic);
  if (previous) {
    try {
      const old = safeResolve(ctx.paths.dataDir, previous);
      if (fs.existsSync(old)) fs.rmSync(old, { force: true });
    } catch {
      /* best effort */
    }
  }
  audit(ctx, { action: 'settings.logo_upload', entityType: 'settings', entityId: null, summary: 'Updated clinic logo' });
  return rel;
}

/**
 * Delete all business data (patients, clinical, financial, stock, files).
 * Keeps users/roles/settings/audit. Requires: data.delete permission, password
 * re-confirmation, typed clinic-name confirmation, and writes a pre-reset backup first.
 */
export async function resetBusiness(ctx: Ctx, input: { typedConfirm: string; password: string }, preResetBackup: () => Promise<string>): Promise<{ ok: true }> {
  requirePermission(ctx, 'data.delete');
  if (ctx.session.roleKey !== 'owner') {
    throw forbidden('Only the Owner role can delete business data.');
  }
  const clinic = readSetting<SettingsDTO['clinic']>(ctx, 'clinic', { clinicName: '' } as any);
  if (!clinic.clinicName) throw validation('Clinic name is not configured.');
  if (String(input?.typedConfirm ?? '').trim() !== clinic.clinicName) {
    throw validation(`Type the exact clinic name ("${clinic.clinicName}") to confirm.`);
  }
  const { verifyPassword } = await import('../core/passwords');
  const row = ctx.db.prepare('SELECT password_hash FROM users WHERE id = ?').get<{ password_hash: string }>(ctx.session.userId);
  if (!row || !(await verifyPassword(row.password_hash, String(input?.password ?? '')))) {
    throw validation('Password confirmation is incorrect.');
  }

  const backupPath = await preResetBackup();

  const WIPED = [
    'queue_entries', 'appointments', 'prescription_items', 'prescriptions',
    'visit_treatments', 'tooth_conditions', 'visits', 'referrals',
    'invoice_items', 'payments', 'invoices', 'inventory_txns', 'inventory_batches', 'inventory_items', 'suppliers',
    'expenses', 'incomes', 'attachments', 'patient_tags', 'tags', 'patient_histories', 'patients',
    'notifications', 'medicine_templates',
  ];
  const APPEND_ONLY_TRIGGERS = [
    'trg_payments_no_update', 'trg_payments_no_delete',
    'trg_invoice_items_no_update', 'trg_invoice_items_no_delete',
  ];
  const TRIGGER_DDL = [
    `CREATE TRIGGER trg_payments_no_update BEFORE UPDATE ON payments BEGIN SELECT RAISE(ABORT, 'payments are append-only'); END`,
    `CREATE TRIGGER trg_payments_no_delete BEFORE DELETE ON payments BEGIN SELECT RAISE(ABORT, 'payments are append-only'); END`,
    `CREATE TRIGGER trg_invoice_items_no_update BEFORE UPDATE ON invoice_items BEGIN SELECT RAISE(ABORT, 'invoice lines are immutable'); END`,
    `CREATE TRIGGER trg_invoice_items_no_delete BEFORE DELETE ON invoice_items BEGIN SELECT RAISE(ABORT, 'invoice lines are immutable'); END`,
  ];
  tx(ctx.db, () => {
    // The typed-confirmed, pre-backed-up destructive reset is the one sanctioned
    // path that may remove append-only rows; triggers are restored in the same
    // transaction so they can never be left disabled.
    for (const t of APPEND_ONLY_TRIGGERS) ctx.db.prepare(`DROP TRIGGER IF EXISTS ${t}`).run();
    try {
      for (const t of WIPED) ctx.db.prepare(`DELETE FROM ${t}`).run();
      ctx.db.prepare("DELETE FROM sequences WHERE name != 'patient'").run();
    } finally {
      for (const ddl of TRIGGER_DDL) ctx.db.prepare(ddl).run();
    }
    audit(ctx, { action: 'data.reset_business', entityType: 'business', entityId: null, summary: `All business data deleted (pre-reset backup: ${path.basename(backupPath)})` });
  });

  // Remove attachment files
  try {
    for (const sub of fs.readdirSync(ctx.paths.attachmentsDir)) {
      fs.rmSync(path.join(ctx.paths.attachmentsDir, sub), { recursive: true, force: true });
    }
  } catch {
    /* best effort — DB no longer references files */
  }
  return { ok: true };
}
