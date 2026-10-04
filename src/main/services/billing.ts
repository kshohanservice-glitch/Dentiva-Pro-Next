import type { Ctx } from '../core/context';
import type { InvoiceDTO, InvoiceInput, InvoiceItemDTO, PaymentDTO, PaymentInput, Paged } from '../../shared/types';
import { conflict, notFound, validation } from '../errors';
import { audit, requirePermission, tx } from '../core/context';
import { formatInvoiceNumber, nextInvoiceNumber, parseInvoiceNumber } from '../core/sequences';
import { nowISO, todayISO, dateRangeFor } from '../../shared/currency';
import { optString, pageParams, reqDate, reqInt, reqString, oneOf } from '../core/validate';

interface InvoiceRow {
  id: number; number: string; patient_id: number; patient_name: string; patient_code: string;
  visit_id: number | null; date: string; status: string; subtotal_paisa: number;
  discount_paisa: number; total_paisa: number; note: string | null;
  created_at: string; voided_at: string | null; void_reason: string | null;
}

const SELECT_INV = `
  SELECT i.*, p.name patient_name, p.code patient_code
  FROM invoices i JOIN patients p ON p.id = i.patient_id`;

export function paidNetFor(db: Ctx['db'], invoiceId: number): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN type = 'payment' THEN amount_paisa ELSE -amount_paisa END), 0) net
       FROM payments WHERE invoice_id = ?`,
    )
    .get<{ net: number }>(invoiceId)!;
  return Number(row.net);
}

function computeStatus(total: number, paidNet: number, voidedAt: string | null): InvoiceDTO['status'] {
  if (voidedAt) return 'voided';
  if (total === 0) return 'paid';
  if (paidNet >= total) return 'paid';
  if (paidNet > 0) return 'partial';
  return 'unpaid';
}

function hydrate(ctx: Ctx, row: InvoiceRow): InvoiceDTO {
  const items = ctx.db
    .prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id')
    .all(row.id) as any[];
  const paidNet = paidNetFor(ctx.db, row.id);
  const paid = Math.max(0, Math.min(paidNet, row.total_paisa));
  const due = Math.max(0, row.total_paisa - paidNet);
  return {
    id: row.id, number: row.number, patientId: row.patient_id, patientName: row.patient_name,
    patientCode: row.patient_code, visitId: row.visit_id, date: row.date,
    status: computeStatus(row.total_paisa, paidNet, row.voided_at),
    subtotalPaisa: row.subtotal_paisa, discountPaisa: row.discount_paisa, totalPaisa: row.total_paisa,
    paidPaisa: paid, duePaisa: due, note: row.note, createdAt: row.created_at,
    voidedAt: row.voided_at, voidReason: row.void_reason,
    items: items.map((it) => ({
      id: it.id, description: it.description, treatmentId: it.treatment_id,
      qty: it.qty, unitPricePaisa: it.unit_price_paisa, discountPaisa: it.discount_paisa,
      totalPaisa: it.total_paisa,
    })) as InvoiceItemDTO[],
  };
}

export function listInvoices(ctx: Ctx, filter: { patientId?: number; range?: string; status?: string; page?: number; pageSize?: number }): Paged<InvoiceDTO> {
  requirePermission(ctx, 'billing.invoice.view');
  const { page, pageSize, offset } = pageParams(filter.page, filter.pageSize);
  const where = ['i.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (filter.patientId) { where.push('i.patient_id = ?'); params.push(filter.patientId); }
  if (filter.status && filter.status !== 'all') { where.push('i.status = ?'); params.push(filter.status); }
  if (filter.range && filter.range !== 'all') {
    const { from, to } = dateRangeFor(filter.range as any);
    if (from) { where.push('i.date >= ?'); params.push(from); }
    if (to) { where.push('i.date <= ?'); params.push(to); }
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const total = Number(ctx.db.prepare(`SELECT COUNT(*) c FROM invoices i ${whereSql}`).get(...params as any[])!['c']);
  const rows = ctx.db
    .prepare(`${SELECT_INV} ${whereSql} ORDER BY i.date DESC, i.id DESC LIMIT ? OFFSET ?`)
    .all(...params as any[], pageSize, offset) as InvoiceRow[];
  return { items: rows.map((r) => hydrate(ctx, r)), total, page, pageSize };
}

export function getInvoice(ctx: Ctx, id: number): InvoiceDTO {
  requirePermission(ctx, 'billing.invoice.view');
  const row = ctx.db.prepare(`${SELECT_INV} WHERE i.id = ? AND i.deleted_at IS NULL`).get(id) as InvoiceRow | undefined;
  if (!row) throw notFound('Invoice not found.');
  return hydrate(ctx, row);
}

export function createInvoice(ctx: Ctx, raw: unknown): InvoiceDTO {
  requirePermission(ctx, 'billing.invoice.create');
  const input = raw as InvoiceInput;
  const patientId = reqInt(input?.patientId, 'Patient', { min: 1 });
  const patient = ctx.db.prepare('SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL').get(patientId);
  if (!patient) throw notFound('Patient not found.');
  const date = reqDate(input?.date ?? todayISO(), 'Invoice date');
  const items = Array.isArray(input?.items) ? input.items : [];
  if (items.length === 0) throw validation('Add at least one line item.');
  if (items.length > 500) throw validation('Too many line items.');

  const clean = items.map((it, i) => {
    const qty = reqInt(it.qty ?? 1, `Item #${i + 1} quantity`, { min: 1, max: 100000 });
    const unit = reqInt(it.unitPricePaisa, `Item #${i + 1} unit price`, { min: 0, max: 100_000_000_00 });
    const disc = reqInt(it.discountPaisa ?? 0, `Item #${i + 1} discount`, { min: 0, max: 100_000_000_00 });
    const lineTotal = qty * unit;
    if (disc > lineTotal) throw validation(`Item #${i + 1} discount exceeds the line total.`);
    return {
      description: reqString(it.description, `Item #${i + 1} description`, { max: 300 }),
      treatmentId: it.treatmentId ?? null,
      qty, unitPricePaisa: unit, discountPaisa: disc,
      totalPaisa: lineTotal - disc,
    };
  });

  const subtotal = clean.reduce((s, it) => s + it.qty * it.unitPricePaisa, 0);
  const lineDiscounts = clean.reduce((s, it) => s + it.discountPaisa, 0);
  const invoiceDiscount = reqInt(input?.discountPaisa ?? 0, 'Invoice discount', { min: 0, max: 100_000_000_00 });
  const total = subtotal - lineDiscounts - invoiceDiscount;
  if (total < 0) throw validation('Discounts exceed the invoice subtotal.');

  const id = tx(ctx.db, () => {
    const settingRow = ctx.db.prepare("SELECT value_json FROM settings WHERE key = 'invoice'").get() as { value_json: string } | undefined;
    const invoiceSettings = settingRow ? JSON.parse(settingRow.value_json) as { nextNumber?: string } : {};
    const configured = invoiceSettings.nextNumber ? parseInvoiceNumber(invoiceSettings.nextNumber) : null;
    const year = Number(date.slice(0, 4));
    let number: string;
    if (configured && configured.year === year) {
      const existingMaxRow = ctx.db.prepare("SELECT COALESCE(MAX(CAST(substr(number, 10) AS INTEGER)), 0) AS m FROM invoices WHERE number LIKE ?").get(`INV-${year}-%`) as { m: number };
      const existingMax = Number(existingMaxRow.m);
      if (configured.sequence <= existingMax) {
        throw validation(`Next invoice number ${invoiceSettings.nextNumber} is already used or behind the existing sequence.`);
      }
      number = formatInvoiceNumber(configured.year, configured.sequence);
      ctx.db.prepare(
        "INSERT INTO sequences (name, year, last_value) VALUES ('invoice', ?, ?) ON CONFLICT(name, year) DO UPDATE SET last_value = excluded.last_value"
      ).run(year, configured.sequence);
    } else {
      number = nextInvoiceNumber(ctx.db, date);
    }
    const info = ctx.db
      .prepare(
        `INSERT INTO invoices (number, patient_id, visit_id, date, status, subtotal_paisa, discount_paisa, total_paisa, note, created_by, created_at)
         VALUES (?, ?, ?, ?, 'unpaid', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        number, patientId, input.visitId ?? null, date,
        subtotal, subtotal - total, total,
        optString(input.note, 'Note', { max: 2000 }),
        ctx.session.userId, nowISO(),
      );
    const invoiceId = Number(info.lastInsertRowid);
    const insItem = ctx.db.prepare(
      `INSERT INTO invoice_items (invoice_id, description, treatment_id, qty, unit_price_paisa, discount_paisa, total_paisa)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const it of clean) {
      insItem.run(invoiceId, it.description, it.treatmentId, it.qty, it.unitPricePaisa, it.discountPaisa, it.totalPaisa);
    }
    if (input.visitId) {
      ctx.db.prepare('UPDATE visits SET invoice_id = ? WHERE id = ? AND invoice_id IS NULL').run(invoiceId, input.visitId);
    }
    const nextNumber = formatInvoiceNumber(year, Number(number.slice(9)) + 1);
    const currentSettingRow = ctx.db.prepare("SELECT value_json FROM settings WHERE key = 'invoice'").get() as { value_json: string } | undefined;
    const currentInvoiceSettings = currentSettingRow ? JSON.parse(currentSettingRow.value_json) as Record<string, unknown> : {};
    if (configured && configured.year === year) {
      ctx.db.prepare("INSERT INTO settings (key, value_json, updated_at, updated_by) VALUES ('invoice', ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by")
        .run(JSON.stringify({ ...currentInvoiceSettings, nextNumber }), nowISO(), ctx.session.userId);
    }
    audit(ctx, {
      action: 'invoice.create', entityType: 'invoice', entityId: invoiceId,
      summary: `Invoice ${number} issued (total ${(total / 100).toFixed(2)} BDT)`,
      after: { total, items: clean.length, patientId },
    });
    return invoiceId;
  });
  return getInvoice(ctx, id);
}

export function deleteInvoice(ctx: Ctx, id: number): { ok: boolean } {
  requirePermission(ctx, 'data.delete');
  const row = ctx.db.prepare('SELECT id, number, patient_id, status FROM invoices WHERE id = ? AND deleted_at IS NULL').get(id) as { id: number; number: string; patient_id: number; status: string } | undefined;
  if (!row) throw notFound('Invoice not found.');
  const payment = ctx.db.prepare('SELECT 1 FROM payments WHERE invoice_id = ? LIMIT 1').get(id);
  if (payment) throw conflict('This invoice has payment history. Void/refund it instead of deleting it.');
  tx(ctx.db, () => {
    ctx.db.prepare('UPDATE invoices SET deleted_at = ? WHERE id = ?').run(nowISO(), id);
    ctx.db.prepare('UPDATE visits SET invoice_id = NULL WHERE invoice_id = ?').run(id);
    audit(ctx, {
      action: 'invoice.delete', entityType: 'invoice', entityId: id,
      summary: `Invoice ${row.number} deleted manually`,
      before: { number: row.number, patientId: row.patient_id, status: row.status },
    });
  });
  return { ok: true };
}

export function voidInvoice(ctx: Ctx, id: number, reason: string): InvoiceDTO {
  requirePermission(ctx, 'billing.invoice.void');
  const row = ctx.db.prepare('SELECT * FROM invoices WHERE id = ? AND deleted_at IS NULL').get(id) as InvoiceRow | undefined;
  if (!row) throw notFound('Invoice not found.');
  if (row.voided_at) throw conflict('Invoice is already voided.');
  const why = reqString(reason, 'Void reason', { max: 500 });
  tx(ctx.db, () => {
    ctx.db.prepare("UPDATE invoices SET status = 'voided', voided_at = ?, void_reason = ? WHERE id = ?")
      .run(nowISO(), why, id);
    audit(ctx, {
      action: 'invoice.void', entityType: 'invoice', entityId: id,
      summary: `Invoice ${row.number} voided: ${why}`,
      before: { status: row.status, total: row.total_paisa }, reason: why,
    });
  });
  return getInvoice(ctx, id);
}

/* ------------------------------ Payments ------------------------------ */

const SELECT_PAY = `
  SELECT pay.*, p.name patient_name, i.number invoice_number, u.display_name received_by_name
  FROM payments pay
  JOIN patients p ON p.id = pay.patient_id
  LEFT JOIN invoices i ON i.id = pay.invoice_id
  JOIN users u ON u.id = pay.received_by`;

function payDTO(r: any): PaymentDTO {
  return {
    id: r.id, invoiceId: r.invoice_id, invoiceNumber: r.invoice_number,
    patientId: r.patient_id, patientName: r.patient_name, amountPaisa: r.amount_paisa,
    method: r.method, reference: r.reference, receivedBy: r.received_by,
    receivedByName: r.received_by_name, paidAt: r.paid_at, note: r.note, type: r.type,
  };
}

export function listPayments(ctx: Ctx, filter: { patientId?: number; invoiceId?: number; range?: string; method?: string; page?: number; pageSize?: number }): Paged<PaymentDTO> {
  requirePermission(ctx, 'billing.payment.view');
  const { page, pageSize, offset } = pageParams(filter.page, filter.pageSize);
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.patientId) { where.push('pay.patient_id = ?'); params.push(filter.patientId); }
  if (filter.invoiceId) { where.push('pay.invoice_id = ?'); params.push(filter.invoiceId); }
  if (filter.method) { where.push('pay.method = ?'); params.push(filter.method); }
  if (filter.range && filter.range !== 'all') {
    const { from, to } = dateRangeFor(filter.range as any);
    if (from) { where.push('pay.paid_at >= ?'); params.push(`${from}T00:00:00.000Z`); }
    if (to) { where.push('pay.paid_at <= ?'); params.push(`${to}T23:59:59.999Z`); }
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = Number(ctx.db.prepare(`SELECT COUNT(*) c FROM payments pay ${whereSql}`).get(...params as any[])!['c']);
  const rows = ctx.db
    .prepare(`${SELECT_PAY} ${whereSql} ORDER BY pay.paid_at DESC, pay.id DESC LIMIT ? OFFSET ?`)
    .all(...params as any[], pageSize, offset) as any[];
  return { items: rows.map(payDTO), total, page, pageSize };
}

export function createPayment(ctx: Ctx, raw: PaymentInput): { payment: PaymentDTO; invoice: InvoiceDTO | null } {
  requirePermission(ctx, 'billing.payment.create');
  const amount = reqInt(raw?.amountPaisa, 'Amount', { min: 1, max: 100_000_000_00 });
  const method = oneOf(raw?.method, ['cash', 'bank', 'card', 'bkash', 'nagad', 'rocket', 'upay', 'other'] as const, 'Payment method');
  const type = raw?.type ? oneOf(raw.type, ['payment', 'refund'] as const, 'Type') : 'payment';
  if (type === 'refund') requirePermission(ctx, 'billing.payment.refund');

  const invoiceId: number | null = raw?.invoiceId ?? null;
  let patientId: number = reqInt(raw?.patientId, 'Patient', { min: 1 });

  if (invoiceId != null) {
    const inv = ctx.db.prepare('SELECT * FROM invoices WHERE id = ? AND deleted_at IS NULL').get(invoiceId) as InvoiceRow | undefined;
    if (!inv) throw notFound('Invoice not found.');
    if (inv.voided_at) throw conflict('Payments cannot be recorded against a voided invoice.');
    patientId = inv.patient_id;
    if (type === 'refund') {
      // Financial integrity: Total = Paid + Due must hold — a refund can never
      // exceed the net amount actually received on this invoice.
      const netPaid = paidNetFor(ctx.db, invoiceId);
      if (amount > netPaid) {
        throw validation(
          `Refund exceeds the net paid amount on this invoice (paid net ${(netPaid / 100).toFixed(2)} BDT, refund ${(amount / 100).toFixed(2)} BDT).`,
        );
      }
    }
  }

  // Full date validation (not just a prefix) + ISO normalization.
  let paidAt = nowISO();
  if (raw?.paidAt) {
    const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2})(?::(\d{2}))?)?/.exec(String(raw.paidAt));
    if (!m) throw validation('Payment date must be a valid date (YYYY-MM-DD).');
    const d = reqDate(m[1], 'Payment date');
    if (m[2] && !/^([01]\d|2[0-3]):[0-5]\d$/.test(m[2])) throw validation('Payment time must be a valid time (HH:MM).');
    const time = m[2] ? `${m[2]}:${m[3] ?? '00'}` : '00:00:00';
    paidAt = `${d}T${time}.000Z`;
  }

  const { paymentId, invoice } = tx(ctx.db, () => {
    const info = ctx.db
      .prepare(
        `INSERT INTO payments (invoice_id, patient_id, amount_paisa, method, reference, type, received_by, paid_at, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        invoiceId, patientId, amount, method,
        optString(raw.reference, 'Reference', { max: 120 }),
        type, ctx.session.userId, paidAt,
        optString(raw.note, 'Note', { max: 1000 }), nowISO(),
      );
    const pid = Number(info.lastInsertRowid);

    let invDto: InvoiceDTO | null = null;
    if (invoiceId != null) {
      const row = ctx.db.prepare(`${SELECT_INV} WHERE i.id = ?`).get(invoiceId) as InvoiceRow;
      const paidNet = paidNetFor(ctx.db, invoiceId);
      const status = computeStatus(row.total_paisa, paidNet, row.voided_at);
      ctx.db.prepare('UPDATE invoices SET status = ? WHERE id = ?').run(status, invoiceId);
      invDto = hydrate(ctx, row);
      if (type === 'payment' && paidNet > row.total_paisa) {
        audit(ctx, {
          action: 'payment.overage', entityType: 'invoice', entityId: invoiceId,
          summary: `Overpayment on ${row.number}: paid net exceeds total by ${((paidNet - row.total_paisa) / 100).toFixed(2)} BDT`,
        });
      }
    }
    audit(ctx, {
      action: type === 'refund' ? 'payment.refund' : 'payment.create',
      entityType: 'payment', entityId: pid,
      summary: `${type === 'refund' ? 'Refund' : 'Payment'} ${(amount / 100).toFixed(2)} BDT via ${method}${invoiceId ? ` (invoice #${invoiceId})` : ''}`,
      after: { amount, method, type, invoiceId },
    });
    return { paymentId: pid, invoice: invDto };
  });

  const row = ctx.db.prepare(`${SELECT_PAY} WHERE pay.id = ?`).get(paymentId) as any;
  return { payment: payDTO(row), invoice };
}
