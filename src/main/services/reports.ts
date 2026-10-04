import type { Ctx } from '../core/context';
import type { ReportResult } from '../../shared/types';
import { validation } from '../errors';
import { requirePermission } from '../core/context';
import { dateRangeFor, formatBdt, todayISO } from '../../shared/currency';

export interface ReportParams {
  from?: string; to?: string; range?: string; dentistId?: number; categoryId?: number;
}

type Builder = (ctx: Ctx, params: ReportParams) => ReportResult;

function scope(from?: string, to?: string): string {
  if (from && to) return `${from} → ${to}`;
  if (from) return `since ${from}`;
  if (to) return `until ${to}`;
  return 'all time';
}

function resolveRange(params: ReportParams, fallback: string = 'today'): { from?: string; to?: string } {
  if (params.from || params.to) return { from: params.from, to: params.to };
  if (params.range) return dateRangeFor(params.range as any);
  return dateRangeFor(fallback as any);
}

const paymentsReport: Builder = (ctx, params) => {
  requirePermission(ctx, 'billing.payment.view');
  requirePermission(ctx, 'finance.view');
  const { from, to } = resolveRange(params, 'today');
  const where: string[] = [];
  const args: unknown[] = [];
  if (from) { where.push('pay.paid_at >= ?'); args.push(`${from}T00:00:00.000Z`); }
  if (to) { where.push('pay.paid_at <= ?'); args.push(`${to}T23:59:59.999Z`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = (ctx.db
    .prepare(
      `SELECT pay.id, pay.paid_at, pay.amount_paisa, pay.method, pay.type, p.name patient_name, u.display_name received_by
       FROM payments pay JOIN patients p ON p.id = pay.patient_id JOIN users u ON u.id = pay.received_by
       ${whereSql} ORDER BY pay.paid_at DESC`,
    )
    .all(...args as any[]) as any[])
    .map((r) => ({
      time: r.paid_at.slice(0, 16).replace('T', ' '),
      patient: r.patient_name,
      method: r.method,
      type: r.type,
      amount: formatBdt(r.type === 'refund' ? -r.amount_paisa : r.amount_paisa),
      receivedBy: r.received_by,
    }));

  const total = (ctx.db
    .prepare(`SELECT COALESCE(SUM(CASE WHEN type='payment' THEN amount_paisa ELSE -amount_paisa END),0) n FROM payments pay ${whereSql}`)
    .get(...args as any[]) as any).n;
  // NET per method (payments − refunds): what the drawer/account actually
  // holds — a breakdown that ignores refunds misstates cash (ISS-029).
  const methods = (ctx.db
    .prepare(
      `SELECT method, COALESCE(SUM(CASE WHEN pay.type='payment' THEN pay.amount_paisa ELSE -pay.amount_paisa END),0) total
       FROM payments pay ${whereSql} GROUP BY method ORDER BY total DESC`,
    )
    .all(...args as any[]) as any[])
    .map((m) => `${m.method}: ${formatBdt(m.total)}`).join(' · ');

  return {
    title: 'Payment Report',
    scope: scope(from, to),
    columns: [
      { key: 'time', label: 'Date/Time' }, { key: 'patient', label: 'Patient' },
      { key: 'method', label: 'Method' }, { key: 'type', label: 'Type' },
      { key: 'amount', label: 'Amount', align: 'right' }, { key: 'receivedBy', label: 'Received by' },
    ],
    rows,
    totals: { 'Net collection': formatBdt(total), 'By method': methods || '—' },
    generatedAt: new Date().toISOString(),
  };
};

const duesReport: Builder = (ctx) => {
  requirePermission(ctx, 'finance.view');
  const rows = (ctx.db
    .prepare(
      `SELECT i.number, i.date, p.name patient_name, p.phone, i.total_paisa,
         COALESCE((SELECT SUM(CASE WHEN pay.type='payment' THEN pay.amount_paisa ELSE -pay.amount_paisa END)
                   FROM payments pay WHERE pay.invoice_id = i.id),0) paid
       FROM invoices i JOIN patients p ON p.id = i.patient_id
       WHERE i.deleted_at IS NULL AND i.voided_at IS NULL AND i.status IN ('unpaid','partial')
       ORDER BY i.date ASC`,
    )
    .all() as any[])
    .map((r) => ({
      invoice: r.number, date: r.date, patient: r.patient_name, phone: r.phone ?? '—',
      total: formatBdt(r.total_paisa), paid: formatBdt(r.paid),
      due: formatBdt(Math.max(0, r.total_paisa - r.paid)),
    }));
  const dueSum = (ctx.db
    .prepare(
      `SELECT COALESCE(SUM(MAX(i.total_paisa - COALESCE((SELECT SUM(CASE WHEN pay.type='payment' THEN pay.amount_paisa ELSE -pay.amount_paisa END)
         FROM payments pay WHERE pay.invoice_id = i.id),0),0)),0) n
       FROM invoices i WHERE i.deleted_at IS NULL AND i.voided_at IS NULL AND i.status IN ('unpaid','partial')`,
    )
    .get() as any).n;
  return {
    title: 'Outstanding Dues',
    scope: 'all unpaid invoices',
    columns: [
      { key: 'invoice', label: 'Invoice' }, { key: 'date', label: 'Date' },
      { key: 'patient', label: 'Patient' }, { key: 'phone', label: 'Phone' },
      { key: 'total', label: 'Total', align: 'right' }, { key: 'paid', label: 'Paid', align: 'right' },
      { key: 'due', label: 'Due', align: 'right' },
    ],
    rows,
    totals: { 'Total outstanding': formatBdt(dueSum) },
    generatedAt: new Date().toISOString(),
  };
};

const incomeExpenseReport: Builder = (ctx, params) => {
  requirePermission(ctx, 'finance.view');
  requirePermission(ctx, 'accounting.view');
  const { from, to } = resolveRange(params, 'today');
  const fromD = from ?? '0000-01-01';
  const toD = to ?? '9999-12-31';

  const collections = Number((ctx.db
    .prepare(`SELECT COALESCE(SUM(CASE WHEN type='payment' THEN amount_paisa ELSE -amount_paisa END),0) n FROM payments WHERE date(paid_at) BETWEEN ? AND ?`)
    .get(fromD, toD) as any).n);
  const otherIncome = Number((ctx.db
    .prepare(`SELECT COALESCE(SUM(amount_paisa),0) n FROM incomes WHERE deleted_at IS NULL AND date BETWEEN ? AND ?`)
    .get(fromD, toD) as any).n);
  const expenses = Number((ctx.db
    .prepare(`SELECT COALESCE(SUM(amount_paisa),0) n FROM expenses WHERE deleted_at IS NULL AND date BETWEEN ? AND ?`)
    .get(fromD, toD) as any).n);

  const byCategory = (ctx.db
    .prepare(
      `SELECT c.name, COALESCE(SUM(e.amount_paisa),0) total FROM expenses e JOIN account_categories c ON c.id = e.category_id
       WHERE e.deleted_at IS NULL AND e.date BETWEEN ? AND ? GROUP BY c.name ORDER BY total DESC`,
    )
    .all(fromD, toD) as any[])
    .map((r) => ({ category: r.name, amount: formatBdt(r.total) }));

  return {
    title: 'Income & Expense Summary',
    scope: scope(from, to),
    columns: [
      { key: 'metric', label: 'Metric' }, { key: 'amount', label: 'Amount', align: 'right' },
    ],
    rows: [
      { metric: 'Patient collections (payments)', amount: formatBdt(collections) },
      { metric: 'Other income', amount: formatBdt(otherIncome) },
      { metric: 'Expenses', amount: formatBdt(-expenses) },
      { metric: 'Net', amount: formatBdt(collections + otherIncome - expenses) },
      ...byCategory.map((c) => ({ metric: `  · ${c.category}`, amount: c.amount })),
    ],
    totals: { Net: formatBdt(collections + otherIncome - expenses) },
    generatedAt: new Date().toISOString(),
  };
};

const patientsReport: Builder = (ctx) => {
  requirePermission(ctx, 'patients.view');
  const rows = (ctx.db
    .prepare(
      `SELECT code, name, bengali_name, phone, gender, registration_date, status,
        (SELECT COUNT(*) FROM visits v WHERE v.patient_id = patients.id AND v.deleted_at IS NULL) visits
       FROM patients WHERE deleted_at IS NULL ORDER BY registration_date DESC`,
    )
    .all() as any[])
    .map((r) => ({
      code: r.code, name: r.name, bengaliName: r.bengali_name ?? '—',
      phone: r.phone ?? '—', gender: r.gender, registered: r.registration_date,
      status: r.status, visits: r.visits,
    }));
  return {
    title: 'Patient List', scope: 'all registered patients',
    columns: [
      { key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'bengaliName', label: 'বাংলা নাম' },
      { key: 'phone', label: 'Phone' }, { key: 'gender', label: 'Gender' },
      { key: 'registered', label: 'Registered' }, { key: 'status', label: 'Status' },
      { key: 'visits', label: 'Visits', align: 'right' },
    ],
    rows, totals: { Total: String(rows.length) },
    generatedAt: new Date().toISOString(),
  };
};

const appointmentsReport: Builder = (ctx, params) => {
  requirePermission(ctx, 'appointments.view');
  const { from, to } = resolveRange(params, 'today');
  const where: string[] = ['a.deleted_at IS NULL'];
  const args: unknown[] = [];
  if (from) { where.push('a.date >= ?'); args.push(from); }
  if (to) { where.push('a.date <= ?'); args.push(to); }
  const rows = (ctx.db
    .prepare(
      `SELECT a.date, a.time, a.type, a.status, p.name patient_name, COALESCE(d.name,'—') dentist
       FROM appointments a JOIN patients p ON p.id = a.patient_id LEFT JOIN dentists d ON d.id = a.dentist_id
       WHERE ${where.join(' AND ')} ORDER BY a.date, a.time`,
    )
    .all(...args as any[]) as any[])
    .map((r) => ({ date: r.date, time: r.time, patient: r.patient_name, dentist: r.dentist, type: r.type, status: r.status }));
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  return {
    title: 'Appointment Report', scope: scope(from, to),
    columns: [
      { key: 'date', label: 'Date' }, { key: 'time', label: 'Time' }, { key: 'patient', label: 'Patient' },
      { key: 'dentist', label: 'Dentist' }, { key: 'type', label: 'Type' }, { key: 'status', label: 'Status' },
    ],
    rows,
    totals: Object.fromEntries([...counts.entries()].map(([k, v]) => [k, v])),
    generatedAt: new Date().toISOString(),
  };
};

const visitsReport: Builder = (ctx, params) => {
  requirePermission(ctx, 'clinical.view');
  const { from, to } = resolveRange(params, 'all');
  const where: string[] = ['v.deleted_at IS NULL'];
  const args: unknown[] = [];
  if (from) { where.push('date(v.datetime) >= ?'); args.push(from); }
  if (to) { where.push('date(v.datetime) <= ?'); args.push(to); }
  const rows = (ctx.db
    .prepare(
      `SELECT v.datetime, p.name patient_name, COALESCE(d.name,'—') dentist, v.diagnosis, v.chief_complaint, v.status
       FROM visits v JOIN patients p ON p.id = v.patient_id LEFT JOIN dentists d ON d.id = v.dentist_id
       WHERE ${where.join(' AND ')} ORDER BY v.datetime DESC`,
    )
    .all(...args as any[]) as any[])
    .map((r) => ({
      datetime: r.datetime.slice(0, 16).replace('T', ' '), patient: r.patient_name,
      dentist: r.dentist, diagnosis: r.diagnosis ?? '—', complaint: r.chief_complaint ?? '—', status: r.status,
    }));
  return {
    title: 'Visit Report', scope: scope(from, to),
    columns: [
      { key: 'datetime', label: 'Date/Time' }, { key: 'patient', label: 'Patient' },
      { key: 'dentist', label: 'Dentist' }, { key: 'complaint', label: 'Chief complaint' },
      { key: 'diagnosis', label: 'Diagnosis' }, { key: 'status', label: 'Status' },
    ],
    rows, totals: { Visits: String(rows.length) },
    generatedAt: new Date().toISOString(),
  };
};

function inventoryRows(ctx: Ctx): { code: string; name: string; category: string; unit: string; qty: number; min: number; status: string; nearestExpiry: string }[] {
  return (ctx.db
    .prepare(
      `SELECT i.code, i.name, i.category, i.unit, i.min_level,
         COALESCE((SELECT SUM(b.qty_available) FROM inventory_batches b WHERE b.item_id = i.id),0) qty,
         (SELECT MIN(b.expiry_date) FROM inventory_batches b WHERE b.item_id = i.id AND b.qty_available > 0) expiry
       FROM inventory_items i WHERE i.deleted_at IS NULL AND i.active = 1 ORDER BY i.name`,
    )
    .all() as any[])
    .map((r) => ({
      code: r.code, name: r.name, category: r.category ?? '—', unit: r.unit,
      qty: r.qty, min: r.min_level,
      status: r.qty <= 0 ? 'Out of stock' : r.qty <= r.min_level ? 'Low stock' : 'OK',
      nearestExpiry: r.expiry ?? '—',
    }));
}

const inventoryReport: Builder = (ctx) => {
  requirePermission(ctx, 'inventory.view');
  const today = todayISO();
  const rows = inventoryRows(ctx);
  const low = rows.filter((r) => r.status !== 'OK').length;
  return {
    title: 'Inventory Report', scope: `as of ${today}`,
    columns: [
      { key: 'code', label: 'Code' }, { key: 'name', label: 'Item' }, { key: 'category', label: 'Category' },
      { key: 'qty', label: 'Qty', align: 'right' }, { key: 'min', label: 'Min', align: 'right' },
      { key: 'status', label: 'Status' }, { key: 'nearestExpiry', label: 'Nearest expiry' },
    ],
    rows, totals: { Items: String(rows.length), 'Low/Out': String(low) },
    generatedAt: new Date().toISOString(),
  };
};

const expiryReport: Builder = (ctx) => {
  requirePermission(ctx, 'inventory.view');
  const today = todayISO();
  const rows = (ctx.db
    .prepare(
      `SELECT b.batch_no, b.expiry_date, b.qty_available, i.name item_name
       FROM inventory_batches b JOIN inventory_items i ON i.id = b.item_id
       WHERE b.qty_available > 0 AND b.expiry_date IS NOT NULL AND b.expiry_date <= date(?, '+60 days')
         AND i.deleted_at IS NULL
       ORDER BY b.expiry_date`,
    )
    .all(today) as any[])
    .map((r) => ({
      item: r.item_name, batch: r.batch_no ?? '—', expiry: r.expiry_date, qty: r.qty_available,
      status: r.expiry_date < today ? 'EXPIRED' : 'Expiring',
    }));
  return {
    title: 'Expiry Report', scope: 'batches expiring within 60 days',
    columns: [
      { key: 'item', label: 'Item' }, { key: 'batch', label: 'Batch' },
      { key: 'expiry', label: 'Expiry' }, { key: 'qty', label: 'Qty', align: 'right' },
      { key: 'status', label: 'Status' },
    ],
    rows, totals: { Batches: String(rows.length) },
    generatedAt: new Date().toISOString(),
  };
};

const expenseCategoriesReport: Builder = (ctx, params) => {
  requirePermission(ctx, 'accounting.view');
  const { from, to } = resolveRange(params, 'today');
  const rows = (ctx.db
    .prepare(
      `SELECT c.name, COUNT(*) entries, COALESCE(SUM(e.amount_paisa),0) total
       FROM expenses e JOIN account_categories c ON c.id = e.category_id
       WHERE e.deleted_at IS NULL AND e.date BETWEEN ? AND ?
       GROUP BY c.name ORDER BY total DESC`,
    )
    .all(from ?? '0000-01-01', to ?? '9999-12-31') as any[])
    .map((r) => ({ category: r.name, entries: r.entries, amount: formatBdt(r.total) }));
  const sum = (ctx.db
    .prepare(`SELECT COALESCE(SUM(amount_paisa),0) n FROM expenses WHERE deleted_at IS NULL AND date BETWEEN ? AND ?`)
    .get(from ?? '0000-01-01', to ?? '9999-12-31') as any).n;
  return {
    title: 'Expense by Category', scope: scope(from, to),
    columns: [
      { key: 'category', label: 'Category' }, { key: 'entries', label: 'Entries', align: 'right' },
      { key: 'amount', label: 'Amount', align: 'right' },
    ],
    rows, totals: { 'Total expenses': formatBdt(sum) },
    generatedAt: new Date().toISOString(),
  };
};

const treatmentRevenueReport: Builder = (ctx, params) => {
  requirePermission(ctx, 'finance.view');
  const { from, to } = resolveRange(params, 'all');
  const where: string[] = ['i.deleted_at IS NULL', 'i.voided_at IS NULL'];
  const args: unknown[] = [];
  if (from) { where.push('i.date >= ?'); args.push(from); }
  if (to) { where.push('i.date <= ?'); args.push(to); }
  const rows = (ctx.db
    .prepare(
      `SELECT ii.description, SUM(ii.qty) qty, SUM(ii.total_paisa) total
       FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
       WHERE ${where.join(' AND ')} GROUP BY ii.description ORDER BY total DESC LIMIT 200`,
    )
    .all(...args as any[]) as any[])
    .map((r) => ({ treatment: r.description, qty: r.qty, revenue: formatBdt(r.total) }));
  const total = (ctx.db
    .prepare(
      `SELECT COALESCE(SUM(ii.total_paisa),0) n FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
       WHERE ${where.join(' AND ')}`,
    )
    .get(...args as any[]) as any).n;
  return {
    title: 'Treatment Revenue', scope: scope(from, to),
    columns: [
      { key: 'treatment', label: 'Treatment / service' }, { key: 'qty', label: 'Qty', align: 'right' },
      { key: 'revenue', label: 'Revenue', align: 'right' },
    ],
    rows, totals: { Revenue: formatBdt(total) },
    generatedAt: new Date().toISOString(),
  };
};

const auditReport: Builder = (ctx, params) => {
  requirePermission(ctx, 'audit.view');
  const { from, to } = resolveRange(params, '30');
  const where: string[] = [];
  const args: unknown[] = [];
  if (from) { where.push('at >= ?'); args.push(`${from}T00:00:00.000Z`); }
  if (to) { where.push('at <= ?'); args.push(`${to}T23:59:59.999Z`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = (ctx.db
    .prepare(`SELECT at, username, action, entity_type, summary, result FROM audit_log ${whereSql} ORDER BY at DESC LIMIT 5000`)
    .all(...args as any[]) as any[])
    .map((r) => ({ time: r.at.slice(0, 16).replace('T', ' '), user: r.username, action: r.action, entity: r.entity_type, summary: r.summary, result: r.result }));
  return {
    title: 'Audit Report', scope: scope(from, to),
    columns: [
      { key: 'time', label: 'Time' }, { key: 'user', label: 'User' }, { key: 'action', label: 'Action' },
      { key: 'entity', label: 'Entity' }, { key: 'summary', label: 'Summary' }, { key: 'result', label: 'Result' },
    ],
    rows, totals: { Entries: String(rows.length) },
    generatedAt: new Date().toISOString(),
  };
};

const staffReport: Builder = (ctx) => {
  requirePermission(ctx, 'staff.view');
  const withSalary = ctx.session.permissions.includes('staff.salary.view');
  const rows = (ctx.db
    .prepare(`SELECT name, designation, department, phone, status, joining_date, salary_paisa FROM staff WHERE deleted_at IS NULL ORDER BY name`)
    .all() as any[])
    .map((r) => ({
      name: r.name, designation: r.designation ?? '—', department: r.department ?? '—',
      phone: r.phone ?? '—', status: r.status, joined: r.joining_date ?? '—',
      ...(withSalary ? { salary: r.salary_paisa != null ? formatBdt(r.salary_paisa) : '—' } : {}),
    }));
  const columns = [
    { key: 'name', label: 'Name' }, { key: 'designation', label: 'Designation' },
    { key: 'department', label: 'Department' }, { key: 'phone', label: 'Phone' },
    { key: 'status', label: 'Status' }, { key: 'joined', label: 'Joined' },
    ...(withSalary ? [{ key: 'salary', label: 'Salary', align: 'right' as const }] : []),
  ];
  return {
    title: 'Staff Report', scope: 'all staff', columns, rows,
    totals: { Staff: String(rows.length) },
    generatedAt: new Date().toISOString(),
  };
};


/** UI: "Daily summary" — today (or range) at a glance. */
const dailySummaryReport: Builder = (ctx, params) => {
  requirePermission(ctx, 'dashboard.view');
  const { from, to } = resolveRange(params, 'today');
  const fromD = from ?? '0000-01-01';
  const toD = to ?? '9999-12-31';
  const n = (sql: string, ...a: unknown[]): number =>
    Number((ctx.db.prepare(sql).get(...a as any[]) as any).n);
  const collections = n(
    `SELECT COALESCE(SUM(CASE WHEN type='payment' THEN amount_paisa ELSE -amount_paisa END),0) n
     FROM payments WHERE date(paid_at) BETWEEN ? AND ?`, fromD, toD);
  const invoiced = n(
    `SELECT COALESCE(SUM(total_paisa),0) n FROM invoices
     WHERE deleted_at IS NULL AND voided_at IS NULL AND date BETWEEN ? AND ?`, fromD, toD);
  const visits = n(`SELECT COUNT(*) n FROM visits WHERE deleted_at IS NULL AND date(datetime) BETWEEN ? AND ?`, fromD, toD);
  const prescriptions = n(`SELECT COUNT(*) n FROM prescriptions WHERE deleted_at IS NULL AND date BETWEEN ? AND ?`, fromD, toD);
  const apptTotal = n(`SELECT COUNT(*) n FROM appointments WHERE deleted_at IS NULL AND date BETWEEN ? AND ?`, fromD, toD);
  const apptDone = n(`SELECT COUNT(*) n FROM appointments WHERE deleted_at IS NULL AND status = 'completed' AND date BETWEEN ? AND ?`, fromD, toD);
  const apptNoShow = n(`SELECT COUNT(*) n FROM appointments WHERE deleted_at IS NULL AND status = 'no_show' AND date BETWEEN ? AND ?`, fromD, toD);
  const newPatients = n(`SELECT COUNT(*) n FROM patients WHERE deleted_at IS NULL AND registration_date BETWEEN ? AND ?`, fromD, toD);
  return {
    title: 'Daily Summary',
    scope: scope(from, to),
    columns: [{ key: 'metric', label: 'Metric' }, { key: 'value', label: 'Value', align: 'right' }],
    rows: [
      { metric: 'Collections (net)', value: formatBdt(collections) },
      { metric: 'Invoiced (gross)', value: formatBdt(invoiced) },
      { metric: 'Visits', value: String(visits) },
      { metric: 'Prescriptions', value: String(prescriptions) },
      { metric: 'Appointments', value: String(apptTotal) },
      { metric: '  · completed', value: String(apptDone) },
      { metric: '  · no-show', value: String(apptNoShow) },
      { metric: 'New patients', value: String(newPatients) },
    ],
    totals: { 'Net collection': formatBdt(collections) },
    generatedAt: new Date().toISOString(),
  };
};

/** UI: "Monthly revenue" — invoiced vs collected, bucketed by month in range. */
const monthlyRevenueReport: Builder = (ctx, params) => {
  requirePermission(ctx, 'finance.view');
  const { from, to } = resolveRange(params, '30');
  const invConds = ['i.deleted_at IS NULL', 'i.voided_at IS NULL'];
  const payConds: string[] = [];
  const invArgs: unknown[] = [];
  const payArgs: unknown[] = [];
  if (from) { invConds.push('i.date >= ?'); invArgs.push(from); payConds.push('pay.paid_at >= ?'); payArgs.push(`${from}T00:00:00.000Z`); }
  if (to) { invConds.push('i.date <= ?'); invArgs.push(to); payConds.push('pay.paid_at <= ?'); payArgs.push(`${to}T23:59:59.999Z`); }
  const invByMonth = new Map<string, number>();
  for (const r of ctx.db
    .prepare(`SELECT substr(i.date,1,7) m, COALESCE(SUM(i.total_paisa),0) total FROM invoices i WHERE ${invConds.join(' AND ')} GROUP BY m`)
    .all(...invArgs as any[]) as { m: string; total: number }[]) invByMonth.set(r.m, r.total);
  const payByMonth = new Map<string, number>();
  for (const r of ctx.db
    .prepare(`SELECT substr(pay.paid_at,1,7) m, COALESCE(SUM(CASE WHEN pay.type='payment' THEN pay.amount_paisa ELSE -pay.amount_paisa END),0) total FROM payments pay WHERE ${payConds.join(' AND ')} GROUP BY m`)
    .all(...payArgs as any[]) as { m: string; total: number }[]) payByMonth.set(r.m, r.total);
  const months = [...new Set([...invByMonth.keys(), ...payByMonth.keys()])].sort().reverse().slice(0, 120);
  const rows = months.map((m) => ({
    month: m,
    invoiced: formatBdt(invByMonth.get(m) ?? 0),
    collected: formatBdt(payByMonth.get(m) ?? 0),
  }));
  const invSum = [...invByMonth.values()].reduce((a, b) => a + b, 0);
  const paySum = [...payByMonth.values()].reduce((a, b) => a + b, 0);
  return {
    title: 'Monthly Revenue',
    scope: scope(from, to),
    columns: [
      { key: 'month', label: 'Month' },
      { key: 'invoiced', label: 'Invoiced', align: 'right' },
      { key: 'collected', label: 'Collected (net)', align: 'right' },
    ],
    rows,
    totals: { Invoiced: formatBdt(invSum), Collected: formatBdt(paySum) },
    generatedAt: new Date().toISOString(),
  };
};

/** UI: "Payment methods" — net collected per method in range. */
const paymentMethodsReport: Builder = (ctx, params) => {
  requirePermission(ctx, 'billing.payment.view');
  const { from, to } = resolveRange(params, '30');
  const conds: string[] = [];
  const args: unknown[] = [];
  if (from) { conds.push('paid_at >= ?'); args.push(`${from}T00:00:00.000Z`); }
  if (to) { conds.push('paid_at <= ?'); args.push(`${to}T23:59:59.999Z`); }
  const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = (ctx.db
    .prepare(
      `SELECT method,
              COALESCE(SUM(CASE WHEN type='payment' THEN amount_paisa ELSE 0 END),0) paid,
              COALESCE(SUM(CASE WHEN type='refund' THEN amount_paisa ELSE 0 END),0) refunded,
              COUNT(*) entries
       FROM payments ${whereSql} GROUP BY method ORDER BY paid DESC`,
    )
    .all(...args as any[]) as any[])
    .map((r) => ({
      method: r.method, paid: formatBdt(r.paid), refunded: formatBdt(r.refunded),
      net: formatBdt(r.paid - r.refunded), entries: r.entries,
    }));
  const netTotal = Number((ctx.db
    .prepare(`SELECT COALESCE(SUM(CASE WHEN type='payment' THEN amount_paisa ELSE -amount_paisa END),0) n FROM payments ${whereSql}`)
    .get(...args as any[]) as any).n);
  return {
    title: 'Payment Methods',
    scope: scope(from, to),
    columns: [
      { key: 'method', label: 'Method' }, { key: 'paid', label: 'Paid', align: 'right' },
      { key: 'refunded', label: 'Refunded', align: 'right' }, { key: 'net', label: 'Net', align: 'right' },
      { key: 'entries', label: 'Entries', align: 'right' },
    ],
    rows,
    totals: { 'Net total': formatBdt(netTotal) },
    generatedAt: new Date().toISOString(),
  };
};

/** UI: "Dentist workload" — visits / prescriptions / completed appointments per dentist. */
const dentistWorkloadReport: Builder = (ctx, params) => {
  requirePermission(ctx, 'finance.view');
  const { from, to } = resolveRange(params, '30');
  const fromD = from ?? '0000-01-01';
  const toD = to ?? '9999-12-31';
  const dentists = ctx.db
    .prepare('SELECT id, name FROM dentists ORDER BY name')
    .all<{ id: number; name: string }>();
  const agg = (sql: string): Map<number, number> => {
    const m = new Map<number, number>();
    for (const r of ctx.db.prepare(sql).all(fromD, toD) as { dentist_id: number | null; c: number }[]) {
      if (r.dentist_id != null) m.set(r.dentist_id, r.c);
    }
    return m;
  };
  const visits = agg(`SELECT dentist_id, COUNT(*) c FROM visits WHERE deleted_at IS NULL AND date(datetime) BETWEEN ? AND ? GROUP BY dentist_id`);
  const rxs = agg(`SELECT dentist_id, COUNT(*) c FROM prescriptions WHERE deleted_at IS NULL AND date BETWEEN ? AND ? GROUP BY dentist_id`);
  const done = agg(`SELECT dentist_id, COUNT(*) c FROM appointments WHERE deleted_at IS NULL AND status = 'completed' AND date BETWEEN ? AND ? GROUP BY dentist_id`);
  const rows = dentists.map((d) => ({
    dentist: d.name,
    visits: visits.get(d.id) ?? 0,
    prescriptions: rxs.get(d.id) ?? 0,
    appointmentsDone: done.get(d.id) ?? 0,
  }));
  return {
    title: 'Dentist Workload',
    scope: scope(from, to),
    columns: [
      { key: 'dentist', label: 'Dentist' },
      { key: 'visits', label: 'Visits', align: 'right' },
      { key: 'prescriptions', label: 'Prescriptions', align: 'right' },
      { key: 'appointmentsDone', label: 'Completed appts', align: 'right' },
    ],
    rows,
    totals: {
      Visits: String([...visits.values()].reduce((a, b) => a + b, 0)),
      Prescriptions: String([...rxs.values()].reduce((a, b) => a + b, 0)),
    },
    generatedAt: new Date().toISOString(),
  };
};

/** UI: "Appointment no-shows" — no-show appointments in range. */
const noShowsReport: Builder = (ctx, params) => {
  requirePermission(ctx, 'appointments.view');
  const { from, to } = resolveRange(params, '30');
  const where = ['a.deleted_at IS NULL', "a.status = 'no_show'"];
  const args: unknown[] = [];
  if (from) { where.push('a.date >= ?'); args.push(from); }
  if (to) { where.push('a.date <= ?'); args.push(to); }
  const rows = (ctx.db
    .prepare(
      `SELECT a.date, a.time, a.type, p.name patient_name, COALESCE(d.name,'—') dentist
       FROM appointments a JOIN patients p ON p.id = a.patient_id LEFT JOIN dentists d ON d.id = a.dentist_id
       WHERE ${where.join(' AND ')} ORDER BY a.date DESC, a.time DESC`,
    )
    .all(...args as any[]) as any[])
    .map((r) => ({ date: r.date, time: r.time, patient: r.patient_name, dentist: r.dentist, type: r.type }));
  const totalWhere = ['a.deleted_at IS NULL'];
  const totalArgs: unknown[] = [];
  if (from) { totalWhere.push('a.date >= ?'); totalArgs.push(from); }
  if (to) { totalWhere.push('a.date <= ?'); totalArgs.push(to); }
  const total = Number((ctx.db
    .prepare(`SELECT COUNT(*) n FROM appointments a WHERE ${totalWhere.join(' AND ')}`)
    .get(...totalArgs as any[]) as any).n);
  return {
    title: 'Appointment No-shows',
    scope: scope(from, to),
    columns: [
      { key: 'date', label: 'Date' }, { key: 'time', label: 'Time' },
      { key: 'patient', label: 'Patient' }, { key: 'dentist', label: 'Dentist' }, { key: 'type', label: 'Type' },
    ],
    rows,
    totals: {
      'No-shows': String(rows.length),
      'All appointments': String(total),
      'No-show rate': total > 0 ? `${Math.round((rows.length / total) * 100)}%` : '—',
    },
    generatedAt: new Date().toISOString(),
  };
};

/** UI: "Patient registrations" — patients registered within the range. */
const patientRegistrationsReport: Builder = (ctx, params) => {
  requirePermission(ctx, 'patients.view');
  const { from, to } = resolveRange(params, '30');
  const where = ['deleted_at IS NULL'];
  const args: unknown[] = [];
  if (from) { where.push('registration_date >= ?'); args.push(from); }
  if (to) { where.push('registration_date <= ?'); args.push(to); }
  const rows = (ctx.db
    .prepare(
      `SELECT code, name, phone, gender, registration_date, status
       FROM patients WHERE ${where.join(' AND ')} ORDER BY registration_date DESC, id DESC`,
    )
    .all(...args as any[]) as any[])
    .map((r) => ({
      code: r.code, name: r.name, phone: r.phone ?? '—', gender: r.gender,
      registered: r.registration_date, status: r.status,
    }));
  return {
    title: 'Patient Registrations',
    scope: scope(from, to),
    columns: [
      { key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'phone', label: 'Phone' },
      { key: 'gender', label: 'Gender' }, { key: 'registered', label: 'Registered' }, { key: 'status', label: 'Status' },
    ],
    rows,
    totals: { Registered: String(rows.length) },
    generatedAt: new Date().toISOString(),
  };
};

/** UI: "Low stock items" — at-or-below min level (incl. out of stock). */
const lowStockReport: Builder = (ctx) => {
  requirePermission(ctx, 'inventory.view');
  const rows = inventoryRows(ctx).filter((r) => r.status !== 'OK');
  return {
    title: 'Low Stock Items',
    scope: 'at or below minimum level',
    columns: [
      { key: 'code', label: 'Code' }, { key: 'name', label: 'Item' }, { key: 'category', label: 'Category' },
      { key: 'qty', label: 'Qty', align: 'right' }, { key: 'min', label: 'Min', align: 'right' },
      { key: 'status', label: 'Status' }, { key: 'nearestExpiry', label: 'Nearest expiry' },
    ],
    rows,
    totals: { Items: String(rows.length) },
    generatedAt: new Date().toISOString(),
  };
};

const REPORTS: Record<string, Builder> = {
  // Canonical catalogue — MUST contain every name in src/shared/reports.ts
  // (UI list). Locked by tests/integration/phase-a-findings.test.ts (ISS-020).
  daily_summary: dailySummaryReport,
  monthly_revenue: monthlyRevenueReport,
  outstanding_dues: duesReport,
  collection_report: paymentsReport,
  payment_methods: paymentMethodsReport,
  treatment_stats: treatmentRevenueReport,
  dentist_workload: dentistWorkloadReport,
  appointment_no_shows: noShowsReport,
  patient_registrations: patientRegistrationsReport,
  stock_on_hand: inventoryReport,
  low_stock: lowStockReport,
  expiry_report: expiryReport,
  expense_summary: expenseCategoriesReport,
  profit_loss: incomeExpenseReport,
  // Service-level reports without a Reports-page entry (kept reachable + tested).
  patients: patientsReport,
  appointments: appointmentsReport,
  visits: visitsReport,
  audit: auditReport,
  staff: staffReport,
  // Legacy pre-V1.1 keys — same builders, kept for IPC/API stability.
  payments: paymentsReport,
  dues: duesReport,
  income_expense: incomeExpenseReport,
  inventory: inventoryReport,
  expiry: expiryReport,
  expense_categories: expenseCategoriesReport,
  treatment_revenue: treatmentRevenueReport,
};

export const REPORT_NAMES = Object.keys(REPORTS);

export function runReport(ctx: Ctx, name: string, params: ReportParams = {}): ReportResult {
  const builder = REPORTS[name];
  if (!builder) throw validation(`Unknown report "${name}".`);
  return builder(ctx, params);
}

export function reportCsv(ctx: Ctx, name: string, params: ReportParams = {}): { header: string[]; rows: string[][] } {
  requirePermission(ctx, 'data.export');
  const report = runReport(ctx, name, params);
  const header = report.columns.map((c) => c.label);
  const rows = report.rows.map((r) => report.columns.map((c) => String(r[c.key] ?? '')));
  return { header, rows };
}
