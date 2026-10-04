/**
 * Single source of truth for the Reports catalogue (spec §127 reporting).
 *
 * V1.1 ISS-020: the renderer previously kept its own list of report names
 * while the service registered a different, disjoint set — every report
 * launched from the Reports page failed with `Unknown report`. The renderer
 * renders this list; the service must register a builder for every
 * `name` here (locked by tests/integration/phase-a-findings.test.ts).
 */

export interface ReportDef {
  name: string;
  label: string;
  group: 'Finance' | 'Clinical' | 'Operations' | 'Inventory';
  permission: string;
  needsRange?: boolean;
}

export const REPORT_DEFS: ReportDef[] = [
  { name: 'daily_summary', label: 'Daily summary', group: 'Operations', permission: 'dashboard.view' },
  { name: 'monthly_revenue', label: 'Monthly revenue', group: 'Finance', permission: 'finance.view', needsRange: true },
  { name: 'outstanding_dues', label: 'Outstanding dues', group: 'Finance', permission: 'finance.view' },
  { name: 'collection_report', label: 'Collection report', group: 'Finance', permission: 'billing.payment.view', needsRange: true },
  { name: 'payment_methods', label: 'Payment methods', group: 'Finance', permission: 'billing.payment.view', needsRange: true },
  { name: 'treatment_stats', label: 'Treatment statistics', group: 'Clinical', permission: 'finance.view', needsRange: true },
  { name: 'dentist_workload', label: 'Dentist workload', group: 'Clinical', permission: 'finance.view', needsRange: true },
  { name: 'appointment_no_shows', label: 'Appointment no-shows', group: 'Operations', permission: 'appointments.view', needsRange: true },
  { name: 'patient_registrations', label: 'Patient registrations', group: 'Operations', permission: 'patients.view', needsRange: true },
  { name: 'stock_on_hand', label: 'Stock on hand', group: 'Inventory', permission: 'inventory.view' },
  { name: 'low_stock', label: 'Low stock items', group: 'Inventory', permission: 'inventory.view' },
  { name: 'expiry_report', label: 'Expiry report', group: 'Inventory', permission: 'inventory.view' },
  { name: 'expense_summary', label: 'Expense summary', group: 'Finance', permission: 'accounting.view', needsRange: true },
  { name: 'profit_loss', label: 'Profit & loss', group: 'Finance', permission: 'accounting.view', needsRange: true },
];

export const UI_REPORT_NAMES: string[] = REPORT_DEFS.map((r) => r.name);
