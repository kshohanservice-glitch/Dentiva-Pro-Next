import type { PermissionKey } from './permissions';

/* ----------------------------- Session ----------------------------- */

export interface SessionUser {
  userId: number;
  username: string;
  displayName: string;
  roleName: string;
  roleKey: string;
  staffId: number | null;
  permissions: PermissionKey[];
}

/* ----------------------------- Common ------------------------------ */

export type Paged<T> = { items: T[]; total: number; page: number; pageSize: number };

export interface DateRange { from?: string; to?: string }

export interface AuditEntry {
  id: number; at: string; userId: number | null; username: string;
  action: string; entityType: string; entityId: string | null;
  summary: string; result: 'success' | 'denied' | 'error'; reason?: string | null;
}

/* ----------------------------- Patients ---------------------------- */

export interface PatientDTO {
  id: number; code: string; name: string; bengaliName: string | null;
  dob: string | null; ageYears: number | null; ageText: string | null;
  gender: string; bloodGroup: string | null; phone: string | null; phone2: string | null;
  emergencyContact: string | null; emergencyPhone: string | null;
  address: string | null; city: string | null;
  chiefComplaint: string | null; referredBy: string | null; preferredDentistId: number | null;
  status: 'active' | 'archived' | 'blocked'; tags: string[];
  registrationDate: string; createdAt: string; updatedAt: string;
  lastVisitAt: string | null; visitCount: number;
}

export interface PatientDetailDTO extends PatientDTO {
  bengaliNameFull?: string | null;
  previousProblems: string | null; allergies: string | null; medications: string | null;
  medicalHistory: string | null; dentalHistory: string | null; notes: string | null;
  preferredDentistName: string | null;
}

export interface PatientFilters {
  range?: 'today' | '7' | '30' | '90' | '365' | 'all' | 'custom';
  from?: string; to?: string; query?: string; status?: string; dentistId?: number;
  sort?: string; dir?: 'asc' | 'desc'; page?: number; pageSize?: number;
}

export interface DuplicateCandidate { id: number; code: string; name: string; phone: string | null; reason: string; score: number }

/* --------------------------- Visits / Chart ------------------------ */

export interface VisitTreatmentDTO {
  id: number;
  treatmentId: number | null;
  description: string;
  qty: number;
  unitPricePaisa: number;
  totalPaisa: number;
  tooth?: string | null;
}

export interface VisitDTO {
  id: number; patientId: number; patientName?: string; patientCode?: string;
  dentistId: number | null; dentistName: string | null; datetime: string;
  chiefComplaint: string | null; diagnosis: string | null; treatmentPlan: string | null;
  advice: string | null; followUpDate: string | null; status: 'open' | 'closed';
  invoiceId: number | null; createdBy: number; createdAt: string;
  examination: string | null; history: string | null; notes: string | null;
  treatments?: VisitTreatmentDTO[];
}

export interface ToothConditionDTO {
  id: number; tooth: string; condition: string; label: string; severity: string | null;
  visitId: number | null; note: string | null; recordedAt: string; supersededAt: string | null;
}

export interface ChartState { current: ToothConditionDTO[]; history: ToothConditionDTO[] }

/* -------------------------- Treatments ----------------------------- */

export interface TreatmentDTO {
  id: number; code: string; name: string; bengaliName: string | null;
  category: string | null; description: string | null;
  defaultPricePaisa: number; durationMin: number | null; active: boolean;
}

/* -------------------------- Prescriptions --------------------------- */

export interface PrescriptionItemDTO {
  id?: number; seq: number; medicineName: string; generic: string | null;
  form: string | null; strength: string | null; dosage: string | null;
  frequency: string | null; morning: boolean; afternoon: boolean; night: boolean;
  timing: 'before' | 'after' | 'na'; duration: string | null; qty: string | null;
  instruction: string | null; instructionBn: string | null; note: string | null;
}

export interface PrescriptionDTO {
  id: number; number: string; patientId: number; patientName: string; patientCode: string;
  visitId: number | null; dentistId: number; dentistName: string;
  date: string; cC: string | null; oE: string | null; rE: string | null;
  diagnosis: string | null; treatment: string | null; advice: string | null;
  followUp: string | null; items: PrescriptionItemDTO[]; createdAt: string;
}

/* -------------------------- Appointments ---------------------------- */

export type AppointmentStatus =
  | 'scheduled' | 'confirmed' | 'arrived' | 'in_queue' | 'in_treatment'
  | 'completed' | 'cancelled' | 'no_show' | 'rescheduled';

export interface AppointmentDTO {
  id: number; patientId: number; patientName: string; patientCode: string; phone: string | null;
  dentistId: number | null; dentistName: string | null;
  date: string; time: string; durationMin: number; type: string;
  status: AppointmentStatus; notes: string | null; createdBy: number;
  createdAt: string; visitId: number | null; queueNo: number | null;
}

export interface AppointmentInput {
  patientId: number; dentistId: number | null; date: string; time: string;
  durationMin: number; type: string; notes?: string | null; status?: AppointmentStatus;
  allowConflict?: boolean;
}

/* ----------------------------- Queue -------------------------------- */

export type QueueStatus = 'waiting' | 'called' | 'in_treatment' | 'paused' | 'completed' | 'cancelled';

export interface QueueEntryDTO {
  id: number; queueNo: number; patientId: number; patientName: string; patientCode: string;
  appointmentId: number | null; dentistId: number | null; dentistName: string | null;
  arrivedAt: string; waitingMin: number; status: QueueStatus; priority: number;
  startedAt: string | null; finishedAt: string | null;
}

/* ----------------------------- Billing ------------------------------ */

export interface InvoiceItemInput {
  description: string; treatmentId?: number | null; qty: number;
  unitPricePaisa: number; discountPaisa?: number;
}

export interface InvoiceItemDTO extends InvoiceItemInput { id: number; totalPaisa: number }

export interface InvoiceDTO {
  id: number; number: string; patientId: number; patientName: string; patientCode: string;
  date: string; status: 'draft' | 'unpaid' | 'partial' | 'paid' | 'voided';
  subtotalPaisa: number; discountPaisa: number; totalPaisa: number;
  paidPaisa: number; duePaisa: number; note: string | null;
  items: InvoiceItemDTO[]; createdAt: string; voidedAt: string | null; voidReason: string | null;
  visitId: number | null;
}

export interface InvoiceInput {
  patientId: number; date: string; items: InvoiceItemInput[];
  discountPaisa?: number; note?: string | null; visitId?: number | null;
}

export type PaymentMethod = 'cash' | 'bank' | 'card' | 'bkash' | 'nagad' | 'rocket' | 'upay' | 'other';

export interface PaymentDTO {
  id: number; invoiceId: number | null; invoiceNumber: string | null;
  patientId: number; patientName: string; amountPaisa: number; method: PaymentMethod;
  reference: string | null; receivedBy: number; receivedByName: string;
  paidAt: string; note: string | null; type: 'payment' | 'refund';
}

export interface PaymentInput {
  invoiceId?: number | null; patientId: number; amountPaisa: number;
  method: PaymentMethod; reference?: string | null; note?: string | null; paidAt?: string;
  type?: 'payment' | 'refund';
}

/* ---------------------------- Inventory ----------------------------- */

export interface InventoryItemDTO {
  id: number; code: string; name: string; categoryName: string | null; unit: string;
  minLevel: number; location: string | null; active: boolean;
  qtyAvailable: number; lowStock: boolean; nearestExpiry: string | null;
}

export interface InventoryBatchDTO {
  id: number; itemId: number; itemName: string; batchNo: string | null; expiryDate: string | null;
  qtyInitial: number; qtyAvailable: number; purchasePricePaisa: number;
  supplierName: string | null; purchasedAt: string | null; expired: boolean; nearExpiry: boolean;
}

export type InventoryTxnType = 'in' | 'out' | 'adjust' | 'damage' | 'expire' | 'return';

export interface StockInput {
  itemId: number; batchId?: number | null; type: InventoryTxnType; qty: number;
  batchNo?: string | null; expiryDate?: string | null; purchasePricePaisa?: number;
  supplierId?: number | null; reference?: string | null; note?: string | null;
}

/* ---------------------------- Accounting ---------------------------- */

export interface ExpenseDTO {
  id: number; date: string; categoryId: number; categoryName: string;
  amountPaisa: number; method: PaymentMethod | string; reference: string | null;
  note: string | null; attachmentPath: string | null; enteredBy: number; enteredByName: string;
}

export interface IncomeDTO {
  id: number; date: string; categoryId: number; categoryName: string;
  amountPaisa: number; method: PaymentMethod | string; reference: string | null;
  note: string | null; enteredBy: number; enteredByName: string;
}

export interface AccountEntryInput {
  date: string; categoryId: number; amountPaisa: number;
  method?: string; reference?: string | null; note?: string | null;
}

/* ------------------------------- Staff ------------------------------ */

export interface StaffDTO {
  id: number; name: string; bengaliName: string | null; gender: string | null;
  age: number | null; phone: string | null; emergencyContact: string | null;
  emergencyPhone: string | null; bloodGroup: string | null; idNumber: string | null;
  designation: string | null; department: string | null;
  salaryPaisa: number | null; joiningDate: string | null;
  status: 'active' | 'inactive'; address: string | null; notes: string | null;
  photoPath: string | null;
}

export interface DentistDTO {
  id: number; name: string; qualifications: string | null; designations: string | null;
  regNo: string | null; phone: string | null; email: string | null;
  signaturePath: string | null; photoPath: string | null; schedule: string | null;
  active: boolean;
}

/* ------------------------------ Users ------------------------------- */

export interface UserDTO {
  id: number; username: string; displayName: string; roleId: number; roleName: string;
  status: 'active' | 'locked' | 'disabled'; staffId: number | null;
  lastLoginAt: string | null; createdAt: string; mustChangePassword: boolean;
  permissions?: PermissionKey[];
}

export interface RoleDTO {
  id: number; key: string; name: string; description: string | null;
  builtin: boolean; permissions: PermissionKey[]; userCount: number;
}

/* ---------------------------- Attachments --------------------------- */

export interface AttachmentDTO {
  id: number; entityType: string; entityId: number; originalName: string;
  mime: string; size: number; uploadedAt: string; uploadedBy: number; uploadedByName: string;
  note: string | null;
}

/* --------------------------- Notifications -------------------------- */

export interface NotificationDTO {
  id: number; key: string; kind: string; severity: 'info' | 'warning' | 'danger' | 'success';
  title: string; body: string; entityType: string | null; entityId: string | null;
  createdAt: string; readAt: string | null;
}

/* ------------------------------ Dashboard --------------------------- */

export interface DashboardDTO {
  todayPatients: number; todayAppointments: number; waitingQueue: number;
  completedVisits: number; noShows: number; recentPatients: { id: number; name: string; code: string; at: string }[];
  upcomingAppointments: AppointmentDTO[];
  financial?: {
    todayRevenuePaisa: number; outstandingDuePaisa: number;
    recentPayments: PaymentDTO[]; outstandingInvoices: { id: number; number: string; patientName: string; duePaisa: number; date: string }[];
    dentistWorkload: { name: string; count: number }[];
    treatmentStats: { name: string; count: number }[];
  };
  inventory?: { lowStock: number; expiringSoon: number; expired: number };
  alerts: { severity: string; title: string; body: string; kind: string }[];
}

/* ------------------------------- Settings --------------------------- */

export interface ClinicSettings {
  clinicName: string; clinicNameBn?: string | null; logoPath?: string | null; logoDataUrl?: string | null;
  address: string | null; phone: string | null; email: string | null; website: string | null;
  operatingHours: string | null; visitingDays: string | null;
  currency: string; timezone?: string;
}

export interface PrintProfile {
  id: string; name: string; documentType: 'prescription' | 'invoice' | 'report' | 'receipt';
  printerName: string; paperSize: 'a4' | 'a5' | 'thermal' | 'custom';
  widthMm: number; heightMm: number; orientation: 'portrait' | 'landscape';
  margins: { top: number; right: number; bottom: number; left: number };
  scale: number; copies: number;
}

export interface SettingsDTO {
  clinic: ClinicSettings;
  prescription: {
    footerMessage: string | null; visitingHours: string | null;
    labels: { cc: string; oe: string; re: string; diagnosis: string; treatment: string; advice: string; followUp: string };
    signatureReserved: boolean;
  };
  invoice: { nextNumber: string; footerNote: string | null };
  security: { autoLockMinutes: number | null; minPasswordLength: number; maxFailedLogins: number };
  backup: { autoFrequencyDays: 7 | 15 | 30 | 0; destination: string | null; retention: number };
  appearance: { theme: 'light' | 'dark' | 'system'; density: 'comfortable' | 'compact'; animations: boolean; sidebarCollapsed: boolean };
  notifications: { appointments: boolean; lowStock: boolean; dues: boolean; backup: boolean };
  paymentMethods: string[];
  expenseCategories: string[];
  printProfiles: PrintProfile[];
}

/* ------------------------------- Reports ---------------------------- */

export interface ReportResult {
  title: string; scope: string;
  columns: { key: string; label: string; align?: 'left' | 'right' | 'center' }[];
  rows: Record<string, string | number>[];
  totals?: Record<string, string | number>;
  generatedAt: string;
}

/* ------------------------------- Search ----------------------------- */

export interface SearchHit {
  kind: 'patient' | 'appointment' | 'invoice' | 'payment' | 'prescription' | 'treatment' |
        'staff' | 'dentist' | 'inventory' | 'expense' | 'visit';
  id: number; title: string; subtitle: string; meta?: string;
}

/* ------------------------------ Activation -------------------------- */

export interface ActivationStatus { activated: boolean; state: 'unactivated' | 'activated' | 'invalid' }
