/**
 * Dentiva Pro — granular permission catalog.
 * Single source of truth used by: DB seeding, service-layer enforcement,
 * renderer UI gating (cosmetic only), and the permission matrix tests.
 */
export const PERMISSION_GROUPS = {
  roles: 'Roles',
  dashboard: 'Dashboard',
  patients: 'Patients',
  clinical: 'Clinical',
  treatments: 'Treatments',
  appointments: 'Appointments',
  queue: 'Queue',
  billing: 'Billing & Payments',
  finance: 'Finance',
  inventory: 'Inventory',
  accounting: 'Accounting',
  staff: 'Staff',
  users: 'Users & Roles',
  settings: 'Settings',
  backup: 'Backup & Restore',
  audit: 'Audit',
  data: 'Data Operations',
} as const;

export const ALL_PERMISSIONS = [
  // Dashboard
  'dashboard.view',
  'dashboard.finance',
  // Patients
  'patients.view',
  'patients.create',
  'patients.edit',
  'patients.delete',
  'patients.sensitive', // medical history / allergies / attachments visibility extras
  // Clinical
  'clinical.view',
  'clinical.visit.create',
  'clinical.visit.edit',
  'clinical.chart.edit',
  'clinical.prescription.create',
  'clinical.prescription.print',
  'clinical.referral.manage',
  // Treatments
  'treatments.view',
  'treatments.manage',
  // Appointments
  'appointments.view',
  'appointments.manage',
  'appointments.override', // double-booking override
  // Queue
  'queue.view',
  'queue.manage',
  // Billing
  'billing.invoice.view',
  'billing.invoice.create',
  'billing.invoice.edit',
  'billing.invoice.void',
  'billing.payment.view',
  'billing.payment.create',
  'billing.payment.refund',
  // Finance aggregates & financial reports
  'finance.view',
  // Inventory
  'inventory.view',
  'inventory.manage',
  // Accounting
  'accounting.view',
  'accounting.manage',
  // Staff
  'staff.view',
  'staff.manage',
  'staff.salary.view',
  // Users & roles
  'users.manage',
  'roles.manage',
  // Settings
  'settings.manage',
  // Backup & restore
  'backup.create',
  'backup.restore',
  // Audit
  'audit.view',
  // Data operations
  'data.export',
  'data.delete',
] as const;

export type PermissionKey = (typeof ALL_PERMISSIONS)[number];

export function isPermissionKey(value: string): value is PermissionKey {
  return (ALL_PERMISSIONS as readonly string[]).includes(value);
}

/** Built-in roles and their permission grants. */
export const BUILTIN_ROLES: Record<string, { name: string; description: string; permissions: PermissionKey[] }> = {
  owner: {
    name: 'Owner',
    description: 'Full access to every module including finance, salaries, backup and destructive operations.',
    permissions: [...ALL_PERMISSIONS],
  },
  administrator: {
    name: 'Administrator',
    description: 'Manages day-to-day clinic operations, users and settings. Includes finance and backup.',
    permissions: [
      'dashboard.view', 'dashboard.finance',
      'patients.view', 'patients.create', 'patients.edit', 'patients.delete', 'patients.sensitive',
      'clinical.view', 'clinical.visit.create', 'clinical.visit.edit', 'clinical.chart.edit',
      'clinical.prescription.create', 'clinical.prescription.print', 'clinical.referral.manage',
      'treatments.view', 'treatments.manage',
      'appointments.view', 'appointments.manage', 'appointments.override',
      'queue.view', 'queue.manage',
      'billing.invoice.view', 'billing.invoice.create', 'billing.invoice.edit', 'billing.invoice.void',
      'billing.payment.view', 'billing.payment.create', 'billing.payment.refund',
      'finance.view',
      'inventory.view', 'inventory.manage',
      'accounting.view', 'accounting.manage',
      'staff.view', 'staff.manage', 'staff.salary.view',
      'users.manage', 'roles.manage',
      'settings.manage',
      'backup.create', 'backup.restore',
      'audit.view',
      'data.export', 'data.delete',
    ],
  },
  dentist: {
    name: 'Dentist',
    description: 'Clinical workflows: patients, visits, charts, prescriptions, appointments. No financial access.',
    permissions: [
      'dashboard.view',
      'patients.view', 'patients.create', 'patients.edit', 'patients.sensitive',
      'clinical.view', 'clinical.visit.create', 'clinical.visit.edit', 'clinical.chart.edit',
      'clinical.prescription.create', 'clinical.prescription.print', 'clinical.referral.manage',
      'treatments.view',
      'appointments.view', 'appointments.manage',
      'queue.view',
      'billing.invoice.view',
      'billing.payment.view',
      'data.export',
    ],
  },
  assistant: {
    name: 'Dental Assistant',
    description: 'Supports clinical flow: patients, visits, queue, chart entries with dentist supervision.',
    permissions: [
      'dashboard.view',
      'patients.view', 'patients.create', 'patients.edit',
      'clinical.view', 'clinical.visit.create', 'clinical.chart.edit',
      'clinical.prescription.print',
      'treatments.view',
      'appointments.view', 'appointments.manage',
      'queue.view', 'queue.manage',
      'inventory.view',
      'data.export',
    ],
  },
  receptionist: {
    name: 'Receptionist',
    description: 'Registration, appointments, queue, invoicing and payment collection. No clinical notes, no accounting.',
    permissions: [
      'dashboard.view', 'dashboard.finance',
      'patients.view', 'patients.create', 'patients.edit', 'patients.sensitive',
      'clinical.view',
      'treatments.view',
      'appointments.view', 'appointments.manage', 'appointments.override',
      'queue.view', 'queue.manage',
      'billing.invoice.view', 'billing.invoice.create', 'billing.invoice.edit',
      'billing.payment.view', 'billing.payment.create',
      'finance.view',
      'data.export',
    ],
  },
  accountant: {
    name: 'Accountant',
    description: 'Financial records, expenses, payment reports and dues. No clinical record access beyond invoice links.',
    permissions: [
      'dashboard.view', 'dashboard.finance',
      'patients.view',
      'billing.invoice.view', 'billing.invoice.void',
      'billing.payment.view', 'billing.payment.create', 'billing.payment.refund',
      'finance.view',
      'accounting.view', 'accounting.manage',
      'inventory.view',
      'staff.view',
      'data.export',
    ],
  },
  inventory_manager: {
    name: 'Inventory Manager',
    description: 'Stock, suppliers, batches and expiry management.',
    permissions: [
      'dashboard.view',
      'patients.view',
      'treatments.view',
      'inventory.view', 'inventory.manage',
      'accounting.view',
      'staff.view',
      'data.export',
    ],
  },
};

export const DEFAULT_ROLE_KEYS = ['owner', 'administrator', 'dentist', 'assistant', 'receptionist', 'accountant', 'inventory_manager'];
