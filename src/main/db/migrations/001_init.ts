import type { DB } from '../database';
import { ALL_PERMISSIONS, BUILTIN_ROLES } from '../../../shared/permissions';

function humanize(key: string): string {
  const parts = key.split('.');
  const action = parts[parts.length - 1];
  const verbMap: Record<string, string> = {
    view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete', manage: 'Manage',
    print: 'Print', void: 'Void', restore: 'Restore', override: 'Override', refund: 'Refund',
    sensitive: 'Sensitive data', export: 'Export', salary: 'Salaries',
  };
  const verb = verbMap[action] ?? action[0].toUpperCase() + action.slice(1);
  const entityMap: Record<string, string> = {
    dashboard: 'dashboard', patients: 'patients', clinical: 'clinical records',
    treatments: 'treatments', appointments: 'appointments', queue: 'queue',
    billing: '', finance: 'finance', inventory: 'inventory', accounting: 'accounting',
    staff: 'staff', users: 'user accounts', roles: 'roles', settings: 'settings',
    backup: 'backup', audit: 'audit log', data: 'data',
  };
  const scope = parts.length > 1 ? entityMap[parts[0]] ?? parts[0] : '';
  const nounMap: Record<string, string> = {
    invoice: 'invoices', payment: 'payments', visit: 'visits', prescription: 'prescriptions',
    chart: 'dental chart', referral: 'referrals',
  };
  const noun = nounMap[parts.length > 1 ? parts[parts.length - 2] : ''] ?? scope;
  return `${verb} ${noun}`.trim();
}

const DDL = `
---------------------------------------------------------------- identity
CREATE TABLE roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE permissions (
  key TEXT PRIMARY KEY,
  grp TEXT NOT NULL,
  label TEXT NOT NULL
);

CREATE TABLE role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_key)
);

---------------------------------------------------------------- staff & dentists
CREATE TABLE staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  bengali_name TEXT,
  gender TEXT,
  age INTEGER,
  address TEXT,
  phone TEXT,
  emergency_contact TEXT,
  emergency_phone TEXT,
  blood_group TEXT,
  id_number TEXT,
  designation TEXT,
  department TEXT,
  salary_paisa INTEGER,
  joining_date TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  notes TEXT,
  photo_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_staff_name ON staff(name);

CREATE TABLE dentists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  qualifications TEXT,
  designations TEXT,
  reg_no TEXT,
  phone TEXT,
  email TEXT,
  signature_path TEXT,
  photo_path TEXT,
  schedule TEXT,
  staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','locked','disabled')),
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE user_permission_overrides (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  is_grant INTEGER NOT NULL,
  PRIMARY KEY (user_id, permission_key)
);

---------------------------------------------------------------- patients
CREATE TABLE patients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  bengali_name TEXT,
  dob TEXT,
  age_years INTEGER,
  gender TEXT NOT NULL DEFAULT 'other' CHECK (gender IN ('male','female','other','unknown')),
  blood_group TEXT,
  phone TEXT,
  phone2 TEXT,
  emergency_contact TEXT,
  emergency_phone TEXT,
  address TEXT,
  city TEXT,
  chief_complaint TEXT,
  referred_by TEXT,
  preferred_dentist_id INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','blocked')),
  registration_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_patients_name ON patients(name);
CREATE INDEX idx_patients_phone ON patients(phone);
CREATE INDEX idx_patients_created ON patients(created_at);
CREATE INDEX idx_patients_status ON patients(status);

CREATE TABLE patient_histories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('chief','previous','allergies','medications','medical','dental','notes')),
  content TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(id)
);
CREATE UNIQUE INDEX ux_patient_history_kind ON patient_histories(patient_id, kind);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE patient_tags (
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (patient_id, tag_id)
);

---------------------------------------------------------------- treatments
CREATE TABLE treatments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  bengali_name TEXT,
  category TEXT,
  description TEXT,
  default_price_paisa INTEGER NOT NULL DEFAULT 0 CHECK (default_price_paisa >= 0),
  duration_min INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_treatments_active ON treatments(active);

---------------------------------------------------------------- dental chart reference
CREATE TABLE teeth (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  dentition TEXT NOT NULL CHECK (dentition IN ('adult','pediatric')),
  arch TEXT NOT NULL CHECK (arch IN ('upper','lower')),
  quadrant INTEGER NOT NULL,
  position INTEGER NOT NULL
);

---------------------------------------------------------------- visits & chart
CREATE TABLE visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  dentist_id INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
  datetime TEXT NOT NULL,
  chief_complaint TEXT,
  history TEXT,
  examination TEXT,
  diagnosis TEXT,
  treatment_plan TEXT,
  advice TEXT,
  notes TEXT,
  follow_up_date TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  invoice_id INTEGER,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_visits_patient ON visits(patient_id, datetime);
CREATE INDEX idx_visits_dentist ON visits(dentist_id, datetime);
CREATE INDEX idx_visits_date ON visits(datetime);

CREATE TABLE visit_treatments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  treatment_id INTEGER REFERENCES treatments(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit_price_paisa INTEGER NOT NULL CHECK (unit_price_paisa >= 0),
  total_paisa INTEGER NOT NULL
);
CREATE INDEX idx_visit_treatments ON visit_treatments(visit_id);

CREATE TABLE tooth_conditions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  tooth TEXT NOT NULL,
  condition TEXT NOT NULL,
  severity TEXT,
  visit_id INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  note TEXT,
  recorded_at TEXT NOT NULL,
  recorded_by INTEGER REFERENCES users(id),
  superseded_at TEXT
);
CREATE INDEX idx_tooth_current ON tooth_conditions(patient_id, tooth, superseded_at);
CREATE INDEX idx_tooth_visit ON tooth_conditions(visit_id);

CREATE TABLE referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  person TEXT,
  clinic TEXT,
  specialty TEXT,
  reason TEXT,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed','cancelled')),
  follow_up TEXT,
  note TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_referrals_patient ON referrals(patient_id, date);

---------------------------------------------------------------- appointments & queue
CREATE TABLE appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  dentist_id INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 30,
  type TEXT NOT NULL DEFAULT 'consultation',
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','confirmed','arrived','in_queue','in_treatment','completed','cancelled','no_show','rescheduled')),
  notes TEXT,
  reminder TEXT,
  visit_id INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  rescheduled_from_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_appt_dentist_date ON appointments(dentist_id, date, time);
CREATE INDEX idx_appt_patient_date ON appointments(patient_id, date);
CREATE INDEX idx_appt_status_date ON appointments(status, date);

CREATE TABLE queue_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  queue_no INTEGER NOT NULL,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  dentist_id INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
  arrived_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting','called','in_treatment','paused','completed','cancelled')),
  priority INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  finished_at TEXT,
  transferred_to INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
  reorder_index INTEGER,
  created_by INTEGER NOT NULL REFERENCES users(id)
);
CREATE INDEX idx_queue_day_status ON queue_entries(day, status);
CREATE UNIQUE INDEX ux_queue_day_no ON queue_entries(day, queue_no);

---------------------------------------------------------------- prescriptions
CREATE TABLE prescriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  visit_id INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  dentist_id INTEGER NOT NULL REFERENCES dentists(id),
  date TEXT NOT NULL,
  c_c TEXT, o_e TEXT, r_e TEXT,
  diagnosis TEXT,
  treatment TEXT,
  advice TEXT,
  follow_up TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_rx_patient ON prescriptions(patient_id, date);

CREATE TABLE prescription_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prescription_id INTEGER NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  medicine_name TEXT NOT NULL,
  generic TEXT,
  form TEXT,
  strength TEXT,
  dosage TEXT,
  frequency TEXT,
  morning INTEGER NOT NULL DEFAULT 0,
  afternoon INTEGER NOT NULL DEFAULT 0,
  night INTEGER NOT NULL DEFAULT 0,
  timing TEXT NOT NULL DEFAULT 'na' CHECK (timing IN ('before','after','na')),
  duration TEXT,
  qty TEXT,
  instruction TEXT,
  instruction_bn TEXT,
  note TEXT
);
CREATE INDEX idx_rx_items ON prescription_items(prescription_id, seq);

CREATE TABLE medicine_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  items_json TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);

---------------------------------------------------------------- billing
CREATE TABLE sequences (
  name TEXT NOT NULL,
  year INTEGER NOT NULL,
  last_value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (name, year)
);

CREATE TABLE invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  visit_id INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('draft','unpaid','partial','paid','voided')),
  subtotal_paisa INTEGER NOT NULL DEFAULT 0,
  discount_paisa INTEGER NOT NULL DEFAULT 0,
  total_paisa INTEGER NOT NULL DEFAULT 0 CHECK (total_paisa >= 0),
  note TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  voided_at TEXT,
  void_reason TEXT,
  deleted_at TEXT
);
CREATE INDEX idx_invoices_patient ON invoices(patient_id, date);
CREATE INDEX idx_invoices_status_date ON invoices(status, date);

CREATE TABLE invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  treatment_id INTEGER REFERENCES treatments(id) ON DELETE SET NULL,
  qty INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit_price_paisa INTEGER NOT NULL CHECK (unit_price_paisa >= 0),
  discount_paisa INTEGER NOT NULL DEFAULT 0 CHECK (discount_paisa >= 0),
  total_paisa INTEGER NOT NULL
);
CREATE INDEX idx_invoice_items ON invoice_items(invoice_id);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE RESTRICT,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  amount_paisa INTEGER NOT NULL CHECK (amount_paisa > 0),
  method TEXT NOT NULL CHECK (method IN ('cash','bank','card','bkash','nagad','rocket','upay','other')),
  reference TEXT,
  type TEXT NOT NULL DEFAULT 'payment' CHECK (type IN ('payment','refund')),
  received_by INTEGER NOT NULL REFERENCES users(id),
  paid_at TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_payments_at ON payments(paid_at);
CREATE INDEX idx_payments_patient ON payments(patient_id, paid_at);
CREATE INDEX idx_payments_invoice ON payments(invoice_id);

-- Immutable financial history: payments and invoice lines are append-only at
-- the database level (corrections happen via new rows — refunds / voids).
CREATE TRIGGER trg_payments_no_update BEFORE UPDATE ON payments
BEGIN SELECT RAISE(ABORT, 'payments are append-only'); END;
CREATE TRIGGER trg_payments_no_delete BEFORE DELETE ON payments
BEGIN SELECT RAISE(ABORT, 'payments are append-only'); END;
CREATE TRIGGER trg_invoice_items_no_update BEFORE UPDATE ON invoice_items
BEGIN SELECT RAISE(ABORT, 'invoice lines are immutable'); END;
CREATE TRIGGER trg_invoice_items_no_delete BEFORE DELETE ON invoice_items
BEGIN SELECT RAISE(ABORT, 'invoice lines are immutable'); END;

---------------------------------------------------------------- inventory
CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE inventory_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT,
  unit TEXT NOT NULL DEFAULT 'pcs',
  min_level INTEGER NOT NULL DEFAULT 0,
  location TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_inv_items_name ON inventory_items(name);

CREATE TABLE inventory_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  batch_no TEXT,
  expiry_date TEXT,
  qty_initial INTEGER NOT NULL CHECK (qty_initial >= 0),
  qty_available INTEGER NOT NULL CHECK (qty_available >= 0),
  purchase_price_paisa INTEGER NOT NULL DEFAULT 0,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  purchased_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_batches_item ON inventory_batches(item_id);
CREATE INDEX idx_batches_expiry ON inventory_batches(expiry_date);

CREATE TRIGGER trg_batches_qty_no_negative
BEFORE UPDATE OF qty_available ON inventory_batches
WHEN NEW.qty_available < 0
BEGIN
  SELECT RAISE(ABORT, 'quantity_available cannot be negative');
END;

CREATE TABLE inventory_txns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id),
  batch_id INTEGER REFERENCES inventory_batches(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('in','out','adjust','damage','expire','return')),
  qty INTEGER NOT NULL CHECK (qty > 0),
  reference TEXT,
  note TEXT,
  actor INTEGER NOT NULL REFERENCES users(id),
  at TEXT NOT NULL
);
CREATE INDEX idx_inv_txns_item ON inventory_txns(item_id, at);

---------------------------------------------------------------- accounting
CREATE TABLE account_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('expense','income')),
  name TEXT NOT NULL,
  UNIQUE (kind, name)
);

CREATE TABLE expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES account_categories(id),
  amount_paisa INTEGER NOT NULL CHECK (amount_paisa > 0),
  method TEXT NOT NULL DEFAULT 'cash',
  reference TEXT,
  note TEXT,
  attachment_path TEXT,
  entered_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_expenses_date ON expenses(date);

CREATE TABLE incomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES account_categories(id),
  amount_paisa INTEGER NOT NULL CHECK (amount_paisa > 0),
  method TEXT NOT NULL DEFAULT 'cash',
  reference TEXT,
  note TEXT,
  entered_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_incomes_date ON incomes(date);

---------------------------------------------------------------- ops
CREATE TABLE attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  stored_name TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  note TEXT,
  uploaded_by INTEGER REFERENCES users(id),
  uploaded_at TEXT NOT NULL
);
CREATE INDEX idx_attachments_entity ON attachments(entity_type, entity_id);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  user_id INTEGER,
  username TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  summary TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  result TEXT NOT NULL DEFAULT 'success' CHECK (result IN ('success','denied','error')),
  reason TEXT
);
CREATE INDEX idx_audit_at ON audit_log(at);
CREATE INDEX idx_audit_user ON audit_log(user_id, at);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);

CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','danger','success')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX idx_notifications_key ON notifications(key, read_at);
CREATE INDEX idx_notifications_created ON notifications(created_at);

CREATE TABLE backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  schema_version INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('manual','auto','pre_restore')),
  status TEXT NOT NULL CHECK (status IN ('running','ok','failed')),
  error TEXT,
  checksum TEXT
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by INTEGER
);
`;

function seed(db: DB): void {
  const now = new Date().toISOString();

  // Permissions catalog
  const insPerm = db.prepare('INSERT INTO permissions (key, grp, label) VALUES (?, ?, ?)');
  for (const key of ALL_PERMISSIONS) {
    const group = key.startsWith('roles.') ? 'users' : key.split('.')[0];
    insPerm.run(key, group, humanize(key));
  }

  // Built-in roles + grants
  const insRole = db.prepare('INSERT INTO roles (key, name, description, builtin, created_at) VALUES (?, ?, ?, 1, ?)');
  const insGrant = db.prepare('INSERT INTO role_permissions (role_id, permission_key) VALUES (?, ?)');
  for (const [roleKey, role] of Object.entries(BUILTIN_ROLES)) {
    const info = insRole.run(roleKey, role.name, role.description, now);
    for (const perm of role.permissions) insGrant.run(info.lastInsertRowid, perm);
  }

  // Teeth
  const insTooth = db.prepare(
    'INSERT INTO teeth (code, label, dentition, arch, quadrant, position) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const [code, dentition] of teethList()) {
    const q = Number(code[0]);
    const pos = Number(code[1]);
    const arch = q === 1 || q === 2 || q === 5 || q === 6 ? 'upper' : 'lower';
    insTooth.run(code, code, dentition, arch, q, pos);
  }

  // Account categories
  const insCat = db.prepare('INSERT INTO account_categories (kind, name) VALUES (?, ?)');
  for (const name of ['Rent', 'Electricity', 'Internet', 'Supplies', 'Dental accessories', 'Staff salary', 'Maintenance', 'Transportation', 'Miscellaneous']) {
    insCat.run('expense', name);
  }
  for (const name of ['Treatment revenue', 'Other income']) {
    insCat.run('income', name);
  }

  // Settings
  const insSetting = db.prepare('INSERT INTO settings (key, value_json, updated_at, updated_by) VALUES (?, ?, ?, NULL)');
  const set = (k: string, v: unknown) => insSetting.run(k, JSON.stringify(v), now);

  set('clinic', {
    clinicName: '', clinicNameBn: null, logoPath: null, address: null, phone: null,
    email: null, website: null, operatingHours: '10:00 – 20:00', visitingDays: 'Sat – Thu',
    currency: 'BDT',
  });
  set('prescription', {
    footerMessage: 'Wishing you a healthy smile.', visitingHours: null,
    labels: { cc: 'C/C', oe: 'O/E', re: 'R/E', diagnosis: 'Diagnosis', treatment: 'Treatment', advice: 'Advice', followUp: 'Follow-up' },
    signatureReserved: true,
  });
  set('invoice', { footerNote: 'Thank you for trusting Dentiva Pro clinic care.' });
  set('security', { autoLockMinutes: 10, minPasswordLength: 8, maxFailedLogins: 5 });
  set('backup', { autoFrequencyDays: 7, destination: null, retention: 10 });
  set('appearance', { theme: 'light', density: 'comfortable', animations: true, sidebarCollapsed: false });
  set('notifications', { appointments: true, lowStock: true, dues: true, backup: true });
  set('paymentMethods', ['cash', 'bank', 'card', 'bkash', 'nagad', 'rocket', 'upay', 'other']);
  set('printProfiles', [
    { id: 'rx-a4', name: 'Prescription A4', documentType: 'prescription', printerName: '', paperSize: 'a4', widthMm: 210, heightMm: 297, orientation: 'portrait', margins: { top: 12, right: 12, bottom: 12, left: 12 }, scale: 100, copies: 1 },
    { id: 'rx-a5', name: 'Prescription A5', documentType: 'prescription', printerName: '', paperSize: 'a5', widthMm: 148, heightMm: 210, orientation: 'portrait', margins: { top: 8, right: 8, bottom: 8, left: 8 }, scale: 100, copies: 1 },
    { id: 'inv-a4', name: 'Invoice A4', documentType: 'invoice', printerName: '', paperSize: 'a4', widthMm: 210, heightMm: 297, orientation: 'portrait', margins: { top: 12, right: 12, bottom: 12, left: 12 }, scale: 100, copies: 1 },
    { id: 'inv-thermal', name: 'Receipt Thermal 80mm', documentType: 'receipt', printerName: '', paperSize: 'thermal', widthMm: 80, heightMm: 200, orientation: 'portrait', margins: { top: 4, right: 4, bottom: 4, left: 4 }, scale: 100, copies: 1 },
  ]);
}

function teethList(): [string, 'adult' | 'pediatric'][] {
  const out: [string, 'adult' | 'pediatric'][] = [];
  const adult = ['18', '17', '16', '15', '14', '13', '12', '11', '21', '22', '23', '24', '25', '26', '27', '28',
    '48', '47', '46', '45', '44', '43', '42', '41', '31', '32', '33', '34', '35', '36', '37', '38'];
  const ped = ['55', '54', '53', '52', '51', '61', '62', '63', '64', '65', '85', '84', '83', '82', '81', '71', '72', '73', '74', '75'];
  for (const c of adult) out.push([c, 'adult']);
  for (const c of ped) out.push([c, 'pediatric']);
  return out;
}

export const migration001 = { version: 1, name: '001_init', ddl: DDL, seed };
