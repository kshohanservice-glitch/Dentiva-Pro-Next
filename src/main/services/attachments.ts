import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Ctx } from '../core/context';
import type { AttachmentDTO } from '../../shared/types';
import { AppError, notFound, validation } from '../errors';
import { audit, requirePermission, tx } from '../core/context';
import { ensureDir, safeResolve, sanitizeFilename } from '../paths';
import { nowISO } from '../../shared/currency';
import { reqString } from '../core/validate';

const ENTITY_TYPES = ['patient', 'visit', 'staff', 'invoice', 'referral', 'prescription', 'appointment'] as const;
const ALLOWED_EXT = new Set([
  '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp',
  '.doc', '.docx', '.xls', '.xlsx', '.txt', '.csv', '.rtf', '.odt', '.ods',
]);
const MAX_BYTES = 100 * 1024 * 1024; // 100 MB

function mimeFor(ext: string): string {
  const map: Record<string, string> = {
    '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
    '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.txt': 'text/plain', '.csv': 'text/csv', '.rtf': 'application/rtf',
    '.odt': 'application/vnd.oasis.opendocument.text', '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  };
  return map[ext] ?? 'application/octet-stream';
}

function dto(r: any): AttachmentDTO {
  return {
    id: r.id, entityType: r.entity_type, entityId: r.entity_id,
    originalName: r.original_name, mime: r.mime, size: r.size,
    uploadedAt: r.uploaded_at, uploadedBy: r.uploaded_by,
    uploadedByName: r.uploaded_by_name ?? 'system', note: r.note,
  };
}

function assertEntity(ctx: Ctx, entityType: string, entityId: number): void {
  const table: Record<string, string> = {
    patient: 'patients', visit: 'visits', staff: 'staff', invoice: 'invoices',
    referral: 'referrals', prescription: 'prescriptions', appointment: 'appointments',
  };
  const t = table[entityType];
  if (!t) throw validation('Unknown attachment target.');
  const row = ctx.db.prepare(`SELECT id FROM ${t} WHERE id = ?`).get(entityId);
  if (!row) throw notFound('Attachment target not found.');
}

function requireEntityRead(ctx: Ctx, entityType: string): void {
  if (entityType === 'invoice') {
    requirePermission(ctx, 'billing.invoice.view');
    return;
  }
  if (entityType === 'staff') {
    requirePermission(ctx, 'staff.view');
    return;
  }
  requirePermission(ctx, 'patients.view');
}

/** Attachments are writes — gated by the write permission of their owning domain. */
function requireEntityWrite(ctx: Ctx, entityType: string): void {
  if (entityType === 'invoice') {
    requirePermission(ctx, 'billing.invoice.view');
    requirePermission(ctx, 'billing.invoice.edit');
    return;
  }
  if (entityType === 'staff') {
    requirePermission(ctx, 'staff.manage');
    return;
  }
  requirePermission(ctx, 'patients.edit');
}

export function listAttachments(ctx: Ctx, entityType: string, entityId: number): AttachmentDTO[] {
  requireEntityRead(ctx, entityType);
  assertEntity(ctx, entityType, entityId);
  const rows = ctx.db
    .prepare(
      `SELECT a.*, u.display_name uploaded_by_name FROM attachments a
       LEFT JOIN users u ON u.id = a.uploaded_by
       WHERE a.entity_type = ? AND a.entity_id = ? ORDER BY a.uploaded_at DESC`,
    )
    .all(entityType, entityId) as any[];
  return rows.map(dto);
}

export function addAttachment(ctx: Ctx, entityType: string, entityId: number, sourcePath: string): AttachmentDTO {
  if (!ENTITY_TYPES.includes(entityType as any)) throw validation('Unknown attachment target.');
  requireEntityRead(ctx, entityType);
  requireEntityWrite(ctx, entityType);
  assertEntity(ctx, entityType, entityId);

  if (!fs.existsSync(sourcePath)) throw new AppError('FILE', 'The selected file could not be found.');
  const stat = fs.statSync(sourcePath);
  if (!stat.isFile()) throw validation('The selected path is not a file.');
  if (stat.size === 0) throw validation('The selected file is empty.');
  if (stat.size > MAX_BYTES) throw validation('File is too large (maximum 100 MB).');

  const original = sanitizeFilename(path.basename(sourcePath));
  const ext = path.extname(original).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) throw validation(`File type "${ext || 'unknown'}" is not allowed. Allowed: ${[...ALLOWED_EXT].join(', ')}`);

  // Magic-byte sniff for images/PDF (blocks disguised executables)
  const head = Buffer.alloc(12);
  const fd = fs.openSync(sourcePath, 'r');
  try { fs.readSync(fd, head, 0, 12, 0); } finally { fs.closeSync(fd); }
  if (ext === '.pdf' && head.toString('latin1', 0, 4) !== '%PDF') throw validation('The file does not look like a valid PDF.');
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext)) {
    const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
    const isJpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    const isGif = head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x38;
    const isWebp = head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP';
    const isBmp = head[0] === 0x42 && head[1] === 0x4d;
    const isImage = isPng || isJpeg || isGif || isWebp || isBmp;
    if (!isImage) throw validation('The file does not look like a valid image.');
  }
  if (head[0] === 0x4d && head[1] === 0x5a) throw validation('Executable files cannot be attached.');

  const hash = crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
  const storedRel = path.join(entityType, String(entityId), `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${original}`);
  const dest = safeResolve(ctx.paths.attachmentsDir, storedRel);
  ensureDir(path.dirname(dest));
  fs.copyFileSync(sourcePath, dest);

  const id = tx(ctx.db, () => {
    const info = ctx.db
      .prepare(
        `INSERT INTO attachments (entity_type, entity_id, stored_name, original_name, mime, size, sha256, uploaded_by, uploaded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(entityType, entityId, storedRel, original, mimeFor(ext), stat.size, hash, ctx.session.userId, nowISO());
    const attId = Number(info.lastInsertRowid);
    audit(ctx, { action: 'attachment.add', entityType: 'attachment', entityId: attId, summary: `Attached "${original}" to ${entityType} #${entityId}` });
    return attId;
  });

  const row = ctx.db
    .prepare('SELECT a.*, u.display_name uploaded_by_name FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by WHERE a.id = ?')
    .get(id) as any;
  return dto(row);
}

export function renameAttachment(ctx: Ctx, id: number, name: string): AttachmentDTO {
  const row = ctx.db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as any;
  if (!row) throw notFound('Attachment not found.');
  requireEntityWrite(ctx, row.entity_type);
  const safe = sanitizeFilename(reqString(name, 'File name', { max: 120 }));
  tx(ctx.db, () => {
    ctx.db.prepare('UPDATE attachments SET original_name = ? WHERE id = ?').run(safe, id);
    audit(ctx, { action: 'attachment.rename', entityType: 'attachment', entityId: id, summary: `Renamed attachment to "${safe}"`, before: { name: row.original_name }, after: { name: safe } });
  });
  return { ...dto(row), originalName: safe };
}

export function removeAttachment(ctx: Ctx, id: number): { ok: boolean } {
  const row = ctx.db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as any;
  if (!row) throw notFound('Attachment not found.');
  requireEntityWrite(ctx, row.entity_type);
  tx(ctx.db, () => {
    ctx.db.prepare('DELETE FROM attachments WHERE id = ?').run(id);
    audit(ctx, { action: 'attachment.delete', entityType: 'attachment', entityId: id, summary: `Deleted attachment "${row.original_name}"` });
  });
  try {
    const abs = safeResolve(ctx.paths.attachmentsDir, row.stored_name);
    if (fs.existsSync(abs)) fs.rmSync(abs, { force: true });
  } catch {
    /* file removal is best-effort; DB no longer references it */
  }
  return { ok: true };
}

/** Absolute path for opening/exporting — validated to stay inside storage root. */
export function attachmentPath(ctx: Ctx, id: number): { abs: string; originalName: string } {
  const row = ctx.db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as any;
  if (!row) throw notFound('Attachment not found.');
  requireEntityRead(ctx, row.entity_type);
  const abs = safeResolve(ctx.paths.attachmentsDir, row.stored_name);
  if (!fs.existsSync(abs)) throw new AppError('FILE', 'The attachment file is missing from storage.');
  return { abs, originalName: row.original_name };
}
