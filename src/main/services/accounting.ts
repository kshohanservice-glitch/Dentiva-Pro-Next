import type { Ctx } from '../core/context';
import type { AccountEntryInput, ExpenseDTO, IncomeDTO, Paged } from '../../shared/types';
import { notFound, validation } from '../errors';
import { audit, requirePermission, tx } from '../core/context';
import { nowISO, dateRangeFor } from '../../shared/currency';
import { optString, pageParams, reqDate, reqInt } from '../core/validate';

const SELECT_EXP = `
  SELECT e.*, c.name category_name, u.display_name entered_by_name
  FROM expenses e JOIN account_categories c ON c.id = e.category_id
  JOIN users u ON u.id = e.entered_by`;

const SELECT_INC = `
  SELECT n.*, c.name category_name, u.display_name entered_by_name
  FROM incomes n JOIN account_categories c ON c.id = n.category_id
  JOIN users u ON u.id = n.entered_by`;

function expDTO(r: any): ExpenseDTO {
  return {
    id: r.id, date: r.date, categoryId: r.category_id, categoryName: r.category_name,
    amountPaisa: r.amount_paisa, method: r.method, reference: r.reference, note: r.note,
    attachmentPath: r.attachment_path, enteredBy: r.entered_by, enteredByName: r.entered_by_name,
  };
}

function incDTO(r: any): IncomeDTO {
  return {
    id: r.id, date: r.date, categoryId: r.category_id, categoryName: r.category_name,
    amountPaisa: r.amount_paisa, method: r.method, reference: r.reference, note: r.note,
    enteredBy: r.entered_by, enteredByName: r.entered_by_name,
  };
}

export function listExpenses(ctx: Ctx, filter: { from?: string; to?: string; categoryId?: number; page?: number; pageSize?: number }): Paged<ExpenseDTO> {
  requirePermission(ctx, 'accounting.view');
  const { page, pageSize, offset } = pageParams(filter.page, filter.pageSize);
  const where = ['e.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (filter.from) { where.push('e.date >= ?'); params.push(filter.from); }
  if (filter.to) { where.push('e.date <= ?'); params.push(filter.to); }
  if (filter.categoryId) { where.push('e.category_id = ?'); params.push(filter.categoryId); }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const total = Number(ctx.db.prepare(`SELECT COUNT(*) c FROM expenses e ${whereSql}`).get(...params as any[])!['c']);
  const rows = ctx.db.prepare(`${SELECT_EXP} ${whereSql} ORDER BY e.date DESC, e.id DESC LIMIT ? OFFSET ?`)
    .all(...params as any[], pageSize, offset) as any[];
  return { items: rows.map(expDTO), total, page, pageSize };
}

export function addExpense(ctx: Ctx, raw: AccountEntryInput): ExpenseDTO {
  requirePermission(ctx, 'accounting.manage');
  const date = reqDate(raw?.date, 'Date');
  const amount = reqInt(raw?.amountPaisa, 'Amount', { min: 1, max: 100_000_000_00 });
  const categoryId = reqInt(raw?.categoryId, 'Category', { min: 1 });
  const cat = ctx.db.prepare("SELECT id FROM account_categories WHERE id = ? AND kind = 'expense'").get(categoryId);
  if (!cat) throw validation('Select a valid expense category.');

  const id = tx(ctx.db, () => {
    const info = ctx.db
      .prepare('INSERT INTO expenses (date, category_id, amount_paisa, method, reference, note, entered_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(date, categoryId, amount,
        optString(raw.method, 'Method', { max: 30 }) ?? 'cash',
        optString(raw.reference, 'Reference', { max: 120 }),
        optString(raw.note, 'Note', { max: 1000 }),
        ctx.session.userId, nowISO());
    const rowId = Number(info.lastInsertRowid);
    audit(ctx, { action: 'accounting.expense_add', entityType: 'expense', entityId: rowId, summary: `Expense ${(amount / 100).toFixed(2)} BDT on ${date}`, after: { amount, categoryId } });
    return rowId;
  });
  const row = ctx.db.prepare(`${SELECT_EXP} WHERE e.id = ?`).get(id) as any;
  return expDTO(row);
}

export function deleteExpense(ctx: Ctx, id: number): { ok: boolean } {
  requirePermission(ctx, 'accounting.manage');
  const row = ctx.db.prepare('SELECT * FROM expenses WHERE id = ? AND deleted_at IS NULL').get(id) as any;
  if (!row) throw notFound('Expense not found.');
  tx(ctx.db, () => {
    ctx.db.prepare('UPDATE expenses SET deleted_at = ? WHERE id = ?').run(nowISO(), id);
    audit(ctx, { action: 'accounting.expense_delete', entityType: 'expense', entityId: id, summary: `Deleted expense entry #${id}`, before: { amount: row.amount_paisa, date: row.date } });
  });
  return { ok: true };
}

export function listIncomes(ctx: Ctx, filter: { from?: string; to?: string; page?: number; pageSize?: number }): Paged<IncomeDTO> {
  requirePermission(ctx, 'accounting.view');
  const { page, pageSize, offset } = pageParams(filter.page, filter.pageSize);
  const where = ['n.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (filter.from) { where.push('n.date >= ?'); params.push(filter.from); }
  if (filter.to) { where.push('n.date <= ?'); params.push(filter.to); }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const total = Number(ctx.db.prepare(`SELECT COUNT(*) c FROM incomes n ${whereSql}`).get(...params as any[])!['c']);
  const rows = ctx.db.prepare(`${SELECT_INC} ${whereSql} ORDER BY n.date DESC, n.id DESC LIMIT ? OFFSET ?`)
    .all(...params as any[], pageSize, offset) as any[];
  return { items: rows.map(incDTO), total, page, pageSize };
}

export function addIncome(ctx: Ctx, raw: AccountEntryInput): IncomeDTO {
  requirePermission(ctx, 'accounting.manage');
  const date = reqDate(raw?.date, 'Date');
  const amount = reqInt(raw?.amountPaisa, 'Amount', { min: 1, max: 100_000_000_00 });
  const categoryId = reqInt(raw?.categoryId, 'Category', { min: 1 });
  const cat = ctx.db.prepare("SELECT id FROM account_categories WHERE id = ? AND kind = 'income'").get(categoryId);
  if (!cat) throw validation('Select a valid income category.');

  const id = tx(ctx.db, () => {
    const info = ctx.db
      .prepare('INSERT INTO incomes (date, category_id, amount_paisa, method, reference, note, entered_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(date, categoryId, amount,
        optString(raw.method, 'Method', { max: 30 }) ?? 'cash',
        optString(raw.reference, 'Reference', { max: 120 }),
        optString(raw.note, 'Note', { max: 1000 }),
        ctx.session.userId, nowISO());
    const rowId = Number(info.lastInsertRowid);
    audit(ctx, { action: 'accounting.income_add', entityType: 'income', entityId: rowId, summary: `Other income ${(amount / 100).toFixed(2)} BDT on ${date}` });
    return rowId;
  });
  const row = ctx.db.prepare(`${SELECT_INC} WHERE n.id = ?`).get(id) as any;
  return incDTO(row);
}

export function listCategories(ctx: Ctx): { id: number; name: string; kind: 'expense' | 'income' }[] {
  requirePermission(ctx, 'accounting.view');
  return ctx.db.prepare('SELECT id, name, kind FROM account_categories ORDER BY kind, name').all() as any;
}

export function saveCategory(ctx: Ctx, input: { kind: 'expense' | 'income'; name: string; id?: number }): { id: number } {
  requirePermission(ctx, 'accounting.manage');
  const kind = input.kind === 'income' ? 'income' : input.kind === 'expense' ? 'expense' : null;
  if (!kind) throw validation('Category kind must be expense or income.');
  const name = String(input.name ?? '').trim();
  if (!name) throw validation('Category name is required.');
  if (input.id) {
    ctx.db.prepare('UPDATE account_categories SET name = ? WHERE id = ?').run(name, input.id);
    audit(ctx, { action: 'accounting.category_update', entityType: 'account_category', entityId: input.id, summary: `Renamed ${kind} category to ${name}` });
    return { id: input.id };
  }
  try {
    const info = ctx.db.prepare('INSERT INTO account_categories (kind, name) VALUES (?, ?)').run(kind, name);
    const id = Number(info.lastInsertRowid);
    audit(ctx, { action: 'accounting.category_create', entityType: 'account_category', entityId: id, summary: `Created ${kind} category ${name}` });
    return { id };
  } catch {
    throw validation(`A ${kind} category named "${name}" already exists.`);
  }
}

/** Convenience: default range = today (spec §38). */
export function defaultRange() {
  return dateRangeFor('today');
}
