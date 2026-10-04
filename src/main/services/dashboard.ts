import type { Ctx } from '../core/context';
import type { DashboardDTO } from '../../shared/types';
import { hasPermission, requirePermission } from '../core/context';
import { todayISO } from '../../shared/currency';

function readSetting<T>(ctx: Ctx, key: string, fallback: T): T {
  const row = ctx.db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as { value_json: string } | undefined;
  if (!row) return fallback;
  try { return JSON.parse(row.value_json) as T; } catch { return fallback; }
}

export function getDashboard(ctx: Ctx): DashboardDTO {
  requirePermission(ctx, 'dashboard.view');
  const today = todayISO();
  const canFinance = hasPermission(ctx, 'dashboard.finance') && hasPermission(ctx, 'finance.view');
  const canQueue = hasPermission(ctx, 'queue.view');
  const canClinical = hasPermission(ctx, 'clinical.view');
  const canAppts = hasPermission(ctx, 'appointments.view');
  const canInventory = hasPermission(ctx, 'inventory.view');

  const scalar = (sql: string, ...params: any[]): number =>
    Number((ctx.db.prepare(sql).get(...params) as any)?.n ?? 0);

  const todayPatients = scalar(
    `SELECT COUNT(*) n FROM (
       SELECT patient_id id FROM visits WHERE date(datetime, 'localtime') = ? AND deleted_at IS NULL
       UNION
       SELECT id FROM patients WHERE registration_date = ? AND deleted_at IS NULL
     )`,
    today,
    today,
  );

  const todayAppointments = canAppts
    ? scalar(`SELECT COUNT(*) n FROM appointments WHERE date = ? AND deleted_at IS NULL AND status NOT IN ('cancelled','no_show')`, today)
    : 0;
  const waitingQueue = canQueue
    ? scalar(`SELECT COUNT(*) n FROM queue_entries WHERE day = ? AND status IN ('waiting','called','paused','in_treatment')`, today)
    : 0;
  const completedVisits = canClinical
    ? scalar(`SELECT COUNT(*) n FROM visits WHERE date(datetime, 'localtime') = ? AND deleted_at IS NULL AND status = 'closed'`, today)
    : 0;
  const noShows = canAppts
    ? scalar(`SELECT COUNT(*) n FROM appointments WHERE date = ? AND deleted_at IS NULL AND status = 'no_show'`, today)
    : 0;

  const recentPatients = ctx.db
    .prepare(
      `SELECT id, name, code, created_at FROM patients WHERE deleted_at IS NULL
       ORDER BY created_at DESC LIMIT 8`,
    )
    .all() as { id: number; name: string; code: string; created_at: string }[];

  const upcomingAppointments = canAppts
    ? (ctx.db
        .prepare(
          `SELECT a.*, p.name patient_name, p.code patient_code, p.phone phone, d.name dentist_name,
             (SELECT q.queue_no FROM queue_entries q WHERE q.appointment_id = a.id AND q.status NOT IN ('completed','cancelled')) queue_no
           FROM appointments a JOIN patients p ON p.id = a.patient_id
           LEFT JOIN dentists d ON d.id = a.dentist_id
           WHERE a.deleted_at IS NULL AND a.date >= ? AND a.status IN ('scheduled','confirmed','arrived','in_queue')
           ORDER BY a.date, a.time LIMIT 8`,
        )
        .all(today) as any[])
    : [];

  let financial: DashboardDTO['financial'];
  if (canFinance) {
    const todayRevenue = scalar(
      `SELECT COALESCE(SUM(CASE WHEN type='payment' THEN amount_paisa ELSE -amount_paisa END), 0) n
       FROM payments WHERE date(paid_at, 'localtime') = ?`,
      today,
    );
    const outstandingDue = scalar(
      `SELECT COALESCE(SUM(MAX(i.total_paisa - COALESCE((
           SELECT SUM(CASE WHEN p.type='payment' THEN p.amount_paisa ELSE -p.amount_paisa END)
           FROM payments p WHERE p.invoice_id = i.id), 0), 0)), 0) n
       FROM invoices i WHERE i.deleted_at IS NULL AND i.voided_at IS NULL AND i.status != 'draft'`,
    );
    const recentPayments = (ctx.db
      .prepare(
        `SELECT pay.*, pt.name patient_name, inv.number invoice_number, u.display_name received_by_name
         FROM payments pay JOIN patients pt ON pt.id = pay.patient_id
         LEFT JOIN invoices inv ON inv.id = pay.invoice_id
         JOIN users u ON u.id = pay.received_by
         ORDER BY pay.paid_at DESC LIMIT 6`,
      )
      .all() as any[])
      .map((r) => ({
        id: r.id, invoiceId: r.invoice_id, invoiceNumber: r.invoice_number,
        patientId: r.patient_id, patientName: r.patient_name, amountPaisa: r.amount_paisa,
        method: r.method, reference: r.reference, receivedBy: r.received_by,
        receivedByName: r.received_by_name, paidAt: r.paid_at, note: r.note, type: r.type,
      }));

    const outstandingInvoices = (ctx.db
      .prepare(
        `SELECT i.id, i.number, p.name patient_name, i.date,
           MAX(i.total_paisa - COALESCE((
             SELECT SUM(CASE WHEN pay.type='payment' THEN pay.amount_paisa ELSE -pay.amount_paisa END)
             FROM payments pay WHERE pay.invoice_id = i.id), 0), 0) due
         FROM invoices i JOIN patients p ON p.id = i.patient_id
         WHERE i.deleted_at IS NULL AND i.voided_at IS NULL AND i.status IN ('unpaid','partial')
         ORDER BY i.date DESC LIMIT 8`,
      )
      .all() as any[])
      .map((r) => ({ id: r.id, number: r.number, patientName: r.patient_name, duePaisa: r.due, date: r.date }));

    const dentistWorkload = (ctx.db
      .prepare(
        `SELECT COALESCE(d.name, 'Unassigned') name, COUNT(*) count
         FROM visits v LEFT JOIN dentists d ON d.id = v.dentist_id
         WHERE v.deleted_at IS NULL AND v.datetime >= datetime('now','-30 days')
         GROUP BY d.name ORDER BY count DESC LIMIT 6`,
      )
      .all() as { name: string; count: number }[]);

    const treatmentStats = (ctx.db
      .prepare(
        `SELECT vt.description name, SUM(vt.qty) count
         FROM visit_treatments vt JOIN visits v ON v.id = vt.visit_id
         WHERE v.deleted_at IS NULL AND v.datetime >= datetime('now','-30 days')
         GROUP BY vt.description ORDER BY count DESC LIMIT 6`,
      )
      .all() as { name: string; count: number }[]);

    financial = { todayRevenuePaisa: todayRevenue, outstandingDuePaisa: outstandingDue, recentPayments, outstandingInvoices, dentistWorkload, treatmentStats };
  }

  let inventory: DashboardDTO['inventory'];
  if (canInventory) {
    inventory = {
      lowStock: scalar(
        `SELECT COUNT(*) n FROM (SELECT i.id FROM inventory_items i LEFT JOIN inventory_batches b ON b.item_id = i.id
         WHERE i.deleted_at IS NULL AND i.active = 1 GROUP BY i.id HAVING COALESCE(SUM(b.qty_available),0) <= i.min_level)`,
      ),
      expiringSoon: scalar(
        `SELECT COUNT(*) n FROM inventory_batches b JOIN inventory_items i ON i.id = b.item_id
         WHERE b.qty_available > 0 AND b.expiry_date IS NOT NULL AND b.expiry_date >= ? AND b.expiry_date <= date(?, '+30 days')
           AND i.deleted_at IS NULL`,
        today, today,
      ),
      expired: scalar(
        `SELECT COUNT(*) n FROM inventory_batches b JOIN inventory_items i ON i.id = b.item_id
         WHERE b.qty_available > 0 AND b.expiry_date IS NOT NULL AND b.expiry_date < ? AND i.deleted_at IS NULL`,
        today,
      ),
    };
  }

  const notifSettings = readSetting(ctx, 'notifications', { lowStock: true, dues: true, backup: true, appointments: true });

  const alerts: DashboardDTO['alerts'] = [];
  if (inventory && notifSettings.lowStock !== false) {
    if (inventory.lowStock > 0) alerts.push({ severity: 'warning', kind: 'inventory', title: `${inventory.lowStock} item(s) low on stock`, body: 'Open Inventory to review and reorder.' });
    if (inventory.expired > 0) alerts.push({ severity: 'danger', kind: 'inventory', title: `${inventory.expired} expired batch(es)`, body: 'Remove or write off expired stock.' });
    else if (inventory.expiringSoon > 0) alerts.push({ severity: 'warning', kind: 'inventory', title: `${inventory.expiringSoon} batch(es) expiring within 30 days`, body: 'Review expiry dates.' });
  }
  if (waitingQueue > 0 && notifSettings.appointments !== false) {
    alerts.push({ severity: 'info', kind: 'queue', title: `${waitingQueue} patient(s) in queue`, body: 'Open Queue to manage flow.' });
  }
  if (canFinance && financial && financial.outstandingDuePaisa > 0 && notifSettings.dues !== false) {
    alerts.push({ severity: 'warning', kind: 'billing', title: 'Outstanding dues', body: 'Some invoices have unpaid balances.' });
  }
  const failedBackups = hasPermission(ctx, 'backup.create') && notifSettings.backup !== false
    ? scalar(`SELECT COUNT(*) n FROM backups WHERE status = 'failed' AND created_at >= datetime('now','-1 day')`)
    : 0;
  if (failedBackups > 0) alerts.push({ severity: 'danger', kind: 'backup', title: 'Recent backup failure', body: 'A backup failed in the last 24 hours. Check Settings → Backup.' });

  return {
    todayPatients, todayAppointments, waitingQueue, completedVisits, noShows,
    recentPatients: recentPatients.map((p) => ({ id: p.id, name: p.name, code: p.code, at: p.created_at })),
    upcomingAppointments: upcomingAppointments.map((r) => ({
      id: r.id, patientId: r.patient_id, patientName: r.patient_name, patientCode: r.patient_code,
      phone: r.phone, dentistId: r.dentist_id, dentistName: r.dentist_name,
      date: r.date, time: r.time, durationMin: r.duration_min, type: r.type,
      status: r.status, notes: r.notes, createdBy: r.created_by, createdAt: r.created_at,
      visitId: r.visit_id, queueNo: r.queue_no,
    })),
    financial,
    inventory,
    alerts,
  };
}
