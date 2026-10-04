/**
 * IPC surface — every renderer→main call goes through one of these channels.
 * The preload script exposes a typed `api` built from this contract; the main
 * process router registers exactly one handler per channel with session +
 * permission enforcement (permissions are asserted inside service methods).
 */
import type {
  ActivationStatus, AppointmentDTO, AppointmentInput, AttachmentDTO, AuditEntry,
  ChartState, DentistDTO, DashboardDTO, DuplicateCandidate, ExpenseDTO, IncomeDTO,
  AccountEntryInput, InventoryBatchDTO, InventoryItemDTO, InvoiceDTO, InvoiceInput,
  NotificationDTO, Paged, PatientDetailDTO, PatientDTO, PatientFilters, PaymentDTO,
  PaymentInput, PrescriptionDTO, ReportResult, RoleDTO, SearchHit, SessionUser,
  SettingsDTO, StaffDTO, StockInput, TreatmentDTO, UserDTO, VisitDTO, QueueEntryDTO,
} from './types';
import type { PermissionKey } from './permissions';

export type LoginResult = { ok: true; user: SessionUser } | { ok: false; reason: 'bad_credentials' | 'locked' | 'disabled'; retryAfterMs?: number }

export interface BackupRecordDTO {
  id: number; filename: string; path: string; createdAt: string; sizeBytes: number;
  schemaVersion: number; kind: 'manual' | 'auto' | 'pre_restore'; status: 'ok' | 'failed' | 'missing';
  error: string | null; checksum: string | null;
}

export interface DentivaApi {
  /* system */
  'system/info'(): Promise<{ version: string; schemaVersion: number; dataDir: string; platform: string; demo: boolean }>;
  'system/activity'(): Promise<null>;
  'system/lock'(): Promise<null>;
  'system/onLock'(cb: () => void): () => void;
  'system/onSessionExpired'(cb: (reason: string) => void): () => void;

  /* activation + auth */
  'activation/status'(): Promise<ActivationStatus>;
  'activation/verify'(code: string): Promise<ActivationStatus>;
  'auth/login'(payload: { username: string; password: string }): Promise<LoginResult>;
  'auth/logout'(): Promise<null>;
  'auth/session'(): Promise<SessionUser | null>;
  'auth/change-password'(payload: { oldPassword: string; newPassword: string }): Promise<{ ok: boolean }>;
  'auth/unlock'(password: string): Promise<{ ok: boolean; error?: string }>;

  /* setup wizard */
  'setup/status'(): Promise<{ needsSetup: boolean }>;
  'setup/complete'(input: SetupInput): Promise<{ ok: true }>;

  /* patients */
  'patients/list'(filters: PatientFilters): Promise<Paged<PatientDTO>>;
  'patients/get'(id: number): Promise<PatientDetailDTO>;
  'patients/create'(input: PatientInputPayload): Promise<PatientDTO>;
  'patients/update'(payload: { id: number } & PatientInputPayload): Promise<PatientDTO>;
  'patients/archive'(id: number): Promise<{ ok: boolean }>;
  'patients/delete'(id: number): Promise<{ ok: boolean }>;
  'patients/duplicates'(input: Partial<PatientInputPayload>): Promise<DuplicateCandidate[]>;
  'patients/timeline'(patientId: number): Promise<PatientTimelineEvent[]>;
  'patients/export'(filters: PatientFilters): Promise<{ path: string; count: number } | { cancelled: true }>;

  /* visits */
  'visits/list'(filter: { patientId?: number; range?: string; page?: number; pageSize?: number }): Promise<Paged<VisitDTO>>;
  'visits/get'(id: number): Promise<VisitDTO>;
  'visits/create'(input: VisitInputPayload): Promise<VisitDTO>;
  'visits/update'(payload: { id: number } & VisitInputPayload): Promise<VisitDTO>;

  /* chart */
  'chart/get'(patientId: number): Promise<ChartState>;
  'chart/set'(payload: { patientId: number; visitId?: number | null; changes: { tooth: string; condition: string; note?: string | null; severity?: string | null; action: 'set' | 'clear' }[] }): Promise<ChartState>;

  /* treatments */
  'treatments/list'(includeInactive?: boolean): Promise<TreatmentDTO[]>;
  'treatments/save'(input: Partial<TreatmentDTO>): Promise<TreatmentDTO>;
  'treatments/set-active'(payload: { id: number; active: boolean }): Promise<TreatmentDTO>;

  /* prescriptions */
  'prescriptions/list'(filter: { patientId?: number; range?: string; page?: number; pageSize?: number }): Promise<Paged<PrescriptionDTO>>;
  'prescriptions/get'(id: number): Promise<PrescriptionDTO>;
  'prescriptions/create'(input: PrescriptionCreatePayload): Promise<PrescriptionDTO>;
  'prescriptions/delete'(id: number): Promise<{ ok: boolean }>;
  'prescriptions/templates'(): Promise<{ id: number; name: string; items: any[] }[]>;
  'prescriptions/save-template'(payload: { name: string; items: any[] }): Promise<{ id: number }>;

  /* appointments */
  'appointments/list'(filter: { from: string; to: string; dentistId?: number; status?: string }): Promise<AppointmentDTO[]>;
  'appointments/create'(input: AppointmentInput): Promise<AppointmentDTO>;
  'appointments/update'(payload: { id: number; status?: string; allowConflict?: boolean; reschedule?: { date: string; time: string; durationMin?: number }; dentistId?: number | null; date?: string; time?: string; durationMin?: number; notes?: string | null }): Promise<AppointmentDTO>;
  'appointments/cancel'(payload: { id: number; reason?: string }): Promise<AppointmentDTO>;
  'appointments/no-show'(id: number): Promise<AppointmentDTO>;
  'appointments/arrive'(id: number): Promise<{ appointment: AppointmentDTO; queue: QueueEntryDTO }>;

  /* queue */
  'queue/list'(date: string): Promise<QueueEntryDTO[]>;
  'queue/add'(input: { patientId: number; dentistId?: number | null; priority?: number; appointmentId?: number }): Promise<QueueEntryDTO>;
  'queue/action'(payload: { id: number | null; action: string; payload?: { dentistId?: number; priority?: number } }): Promise<QueueEntryDTO>;
  'queue/reorder'(orderedIds: number[]): Promise<{ ok: true }>;

  /* billing */
  'invoices/list'(filter: { patientId?: number; range?: string; status?: string; page?: number; pageSize?: number }): Promise<Paged<InvoiceDTO>>;
  'invoices/get'(id: number): Promise<InvoiceDTO>;
  'invoices/create'(input: InvoiceInput): Promise<InvoiceDTO>;
  'invoices/void'(payload: { id: number; reason: string }): Promise<InvoiceDTO>;
  'invoices/delete'(id: number): Promise<{ ok: boolean }>;
  'payments/list'(filter: { patientId?: number; invoiceId?: number; range?: string; method?: string; page?: number; pageSize?: number }): Promise<Paged<PaymentDTO>>;
  'payments/create'(input: PaymentInput): Promise<{ payment: PaymentDTO; invoice: InvoiceDTO | null }>;

  /* inventory */
  'inventory/items'(filter?: { query?: string; lowOnly?: boolean; includeInactive?: boolean }): Promise<InventoryItemDTO[]>;
  'inventory/batches'(filter?: { itemId?: number; expiringWithinDays?: number; expiredOnly?: boolean }): Promise<InventoryBatchDTO[]>;
  'inventory/save-item'(input: Partial<InventoryItemDTO>): Promise<InventoryItemDTO>;
  'inventory/stock'(input: StockInput): Promise<{ item: InventoryItemDTO; batches: InventoryBatchDTO[] }>;
  'inventory/suppliers'(): Promise<{ id: number; name: string; phone: string | null }[]>;
  'inventory/save-supplier'(input: { id?: number; name: string; phone?: string | null; address?: string | null }): Promise<{ id: number }>;

  /* accounting */
  'accounting/expenses'(filter: { from?: string; to?: string; categoryId?: number; page?: number; pageSize?: number }): Promise<Paged<ExpenseDTO>>;
  'accounting/add-expense'(input: AccountEntryInput): Promise<ExpenseDTO>;
  'accounting/delete-expense'(id: number): Promise<{ ok: boolean }>;
  'accounting/incomes'(filter: { from?: string; to?: string; page?: number; pageSize?: number }): Promise<Paged<IncomeDTO>>;
  'accounting/add-income'(input: AccountEntryInput): Promise<IncomeDTO>;
  'accounting/categories'(): Promise<{ id: number; name: string; kind: 'expense' | 'income' }[]>;
  'accounting/save-category'(input: { kind: 'expense' | 'income'; name: string; id?: number }): Promise<{ id: number }>;

  /* staff + dentists */
  'staff/list'(): Promise<StaffDTO[]>;
  'staff/save'(input: Partial<StaffDTO>): Promise<StaffDTO>;
  'dentists/list'(includeInactive?: boolean): Promise<DentistDTO[]>;
  'dentists/save'(input: Partial<DentistDTO>): Promise<DentistDTO>;

  /* users + roles + audit */
  'users/list'(): Promise<UserDTO[]>;
  'users/save'(input: UserSavePayload): Promise<UserDTO>;
  'users/reset-password'(payload: { id: number; password: string }): Promise<{ ok: boolean }>;
  'roles/list'(): Promise<RoleDTO[]>;
  'roles/save'(input: RoleSavePayload): Promise<RoleDTO>;
  'roles/remove'(id: number): Promise<{ ok: boolean }>;
  'audit/list'(filter: { page?: number; pageSize?: number; action?: string; userId?: number; from?: string; to?: string; query?: string }): Promise<Paged<AuditEntry>>;

  /* attachments */
  'attachments/list'(payload: { entityType: string; entityId: number }): Promise<AttachmentDTO[]>;
  'attachments/add'(payload: { entityType: string; entityId: number }): Promise<AttachmentDTO | { cancelled: true }>;
  'attachments/rename'(payload: { id: number; name: string }): Promise<AttachmentDTO>;
  'attachments/remove'(id: number): Promise<{ ok: boolean }>;
  'attachments/open'(id: number): Promise<{ ok: boolean }>;
  'attachments/export'(id: number): Promise<{ path: string } | { cancelled: true }>;

  /* backup / restore */
  'backup/run'(destination?: string): Promise<BackupRecordDTO>;
  'backup/list'(): Promise<BackupRecordDTO[]>;
  'backup/restore'(payload: { filePath?: string; typedConfirm: string }): Promise<{ ok: true; restoredAt: string } | { cancelled: true }>;
  'backup/set-auto'(input: { frequencyDays: 7 | 15 | 30 | 0; destination?: string; retention: number }): Promise<{ ok: true; destination?: string; cancelled?: boolean }>;

  /* settings */
  'settings/get'(): Promise<SettingsDTO | PublicSettings>;
  'settings/save'(patch: Partial<SettingsDTO>): Promise<SettingsDTO>;
  'settings/upload-logo'(): Promise<string | { cancelled: true }>;
  'settings/reset-business'(input: { typedConfirm: string; password: string }): Promise<{ ok: true }>;

  /* dashboard + notifications + search */
  'dashboard/get'(): Promise<DashboardDTO>;
  'notifications/list'(): Promise<NotificationDTO[]>;
  'notifications/mark-read'(id?: number): Promise<{ ok: true }>;
  'search/global'(query: string): Promise<SearchHit[]>;

  /* reports + print */
  'reports/run'(payload: { name: string; params?: Record<string, any> }): Promise<ReportResult>;
  'reports/export'(payload: { name: string; params?: Record<string, any> }): Promise<{ path: string; rows: number } | { cancelled: true }>;
  'reports/print'(doc: PrintDocRequest): Promise<{ ok: boolean }>;
  'reports/save-pdf'(doc: PrintDocRequest): Promise<{ ok: boolean }>;
  'printers/list'(): Promise<PrinterInfoDTO[]>;
  'print/execute'(opts: {
    printerName?: string | null;
    silent?: boolean;
    copies?: number;
    landscape?: boolean;
    color?: boolean;
    duplex?: 'simplex' | 'shortEdge' | 'longEdge';
    widthMm?: number;
    heightMm?: number;
    marginsMm?: { top: number; right: number; bottom: number; left: number };
    scale?: number;
  }): Promise<{ ok: boolean; cancelled?: boolean; error?: string }>;
  'print/close'(): Promise<{ ok: true }>;
  'print/pdf'(opts: {
    suggestedName: string;
    widthMm: number;
    heightMm: number;
    landscape?: boolean;
    marginsMm?: { top: number; right: number; bottom: number; left: number };
    scale?: number;
  }): Promise<{ ok: boolean; path?: string; cancelled?: boolean; error?: string }>;

  /* referrals */
  'referrals/list'(patientId: number): Promise<ReferralRecord[]>;
  'referrals/save'(input: ReferralInput): Promise<ReferralRecord>;
}

export interface PatientInputPayload {
  code?: string | null; name: string; bengaliName?: string | null;
  dob?: string | null; ageYears?: number | null; gender: string; bloodGroup?: string | null;
  phone?: string | null; phone2?: string | null; emergencyContact?: string | null;
  emergencyPhone?: string | null; address?: string | null; city?: string | null;
  chiefComplaint?: string | null; referredBy?: string | null; preferredDentistId?: number | null;
  status?: string; registrationDate?: string | null; tags?: string[];
  histories?: Record<string, string | null>;
  forceCreate?: boolean;
}

export interface VisitInputPayload {
  patientId?: number; dentistId?: number | null; datetime?: string;
  chiefComplaint?: string | null; history?: string | null; examination?: string | null;
  diagnosis?: string | null; treatmentPlan?: string | null; advice?: string | null;
  notes?: string | null; followUpDate?: string | null; status?: string;
  treatments?: { treatmentId: number; qty?: number; unitPricePaisa?: number }[];
}

export interface PrescriptionCreatePayload {
  patientId: number; visitId?: number | null; dentistId: number; date?: string;
  cC?: string | null; oE?: string | null; rE?: string | null;
  diagnosis?: string | null; treatment?: string | null; advice?: string | null; followUp?: string | null;
  items: Partial<PatientItemPayload>[];
  saveAsTemplate?: string | null;
}

export interface PatientItemPayload {
  seq?: number; medicineName: string; generic?: string | null; form?: string | null;
  strength?: string | null; dosage?: string | null; frequency?: string | null;
  morning?: boolean; afternoon?: boolean; night?: boolean; timing?: 'before' | 'after' | 'na';
  duration?: string | null; qty?: string | null; instruction?: string | null;
  instructionBn?: string | null; note?: string | null;
}

export interface UserSavePayload {
  id?: number; username: string; displayName: string; password?: string;
  roleId: number; status?: string; staffId?: number | null; permissions?: PermissionKey[];
}

export interface RoleSavePayload {
  id?: number; key?: string; name: string; description?: string; permissions: PermissionKey[];
}

export interface PatientTimelineEvent {
  at: string; type: string; title: string; summary: string;
  linkEntity: string | null; linkId: number | null; actor: string | null;
}

export interface ReferralRecord {
  id: number; patient_id: number; direction: 'in' | 'out'; person: string | null;
  clinic: string | null; specialty: string | null; reason: string | null; date: string;
  status: 'open' | 'completed' | 'cancelled'; follow_up: string | null; note: string | null;
  created_by: number; created_at: string; created_by_name?: string;
}

export interface ReferralInput {
  id?: number; patientId: number; direction?: 'in' | 'out'; person?: string | null;
  clinic?: string | null; specialty?: string | null; reason?: string | null; date: string;
  status?: 'open' | 'completed' | 'cancelled'; followUp?: string | null; note?: string | null;
}

export type PrintDocKind = 'invoice' | 'receipt' | 'prescription' | 'prescription-duplicate'
  | 'visit-summary' | 'appointment-card' | 'stock-labels' | 'report';

export interface PrintDocRequest {
  type: PrintDocKind;
  id: number;
  reportName?: string;
  profileId?: string;
  params?: Record<string, string>;
}

export interface PrinterInfoDTO {
  name: string; displayName: string; description: string; options: Record<string, string>;
}

export type PublicSettings = { clinic: SettingsDTO['clinic']; prescription: { labels: SettingsDTO['prescription']['labels'] } };

export interface SetupInput {
  clinic: { clinicName: string; address?: string | null; phone?: string | null; email?: string | null; logoPath?: string | null };
  dentists: { name: string; qualifications?: string | null; designations?: string | null; phone?: string | null; email?: string | null; regNo?: string | null }[];
  admin: { username: string; password: string; passwordConfirm: string; displayName?: string };
  preferences: { operatingHours?: string | null; autoLockMinutes?: number; backupDestination?: string | null };
}

export const IPC = {
  systemInfo: 'system/info',
  systemActivity: 'system/activity',
  systemLock: 'system/lock',
  onLock: 'event/lock',
  onSessionExpired: 'event/session-expired',

  activationStatus: 'activation/status',
  activationVerify: 'activation/verify',
  authLogin: 'auth/login',
  authLogout: 'auth/logout',
  authSession: 'auth/session',
  authChangePassword: 'auth/change-password',
  authUnlock: 'auth/unlock',

  setupStatus: 'setup/status',
  setupComplete: 'setup/complete',

  patientsList: 'patients/list',
  patientsGet: 'patients/get',
  patientsCreate: 'patients/create',
  patientsUpdate: 'patients/update',
  patientsArchive: 'patients/archive',
  patientsDelete: 'patients/delete',
  patientsDuplicates: 'patients/duplicates',
  patientsTimeline: 'patients/timeline',
  patientsExport: 'patients/export',

  visitsList: 'visits/list',
  visitsGet: 'visits/get',
  visitsCreate: 'visits/create',
  visitsUpdate: 'visits/update',

  chartGet: 'chart/get',
  chartSet: 'chart/set',

  treatmentsList: 'treatments/list',
  treatmentsSave: 'treatments/save',
  treatmentsSetActive: 'treatments/set-active',

  prescriptionsList: 'prescriptions/list',
  prescriptionsGet: 'prescriptions/get',
  prescriptionsCreate: 'prescriptions/create',
  prescriptionsDelete: 'prescriptions/delete',
  prescriptionsTemplates: 'prescriptions/templates',
  prescriptionsSaveTemplate: 'prescriptions/save-template',

  appointmentsList: 'appointments/list',
  appointmentsCreate: 'appointments/create',
  appointmentsUpdate: 'appointments/update',
  appointmentsCancel: 'appointments/cancel',
  appointmentsNoShow: 'appointments/no-show',
  appointmentsArrive: 'appointments/arrive',

  queueList: 'queue/list',
  queueAdd: 'queue/add',
  queueAction: 'queue/action',
  queueReorder: 'queue/reorder',

  invoicesList: 'invoices/list',
  invoicesGet: 'invoices/get',
  invoicesCreate: 'invoices/create',
  invoicesVoid: 'invoices/void',
  invoicesDelete: 'invoices/delete',
  paymentsList: 'payments/list',
  paymentsCreate: 'payments/create',

  inventoryItems: 'inventory/items',
  inventoryBatches: 'inventory/batches',
  inventorySaveItem: 'inventory/save-item',
  inventoryStock: 'inventory/stock',
  inventorySuppliers: 'inventory/suppliers',
  inventorySaveSupplier: 'inventory/save-supplier',

  accountingExpenses: 'accounting/expenses',
  accountingAddExpense: 'accounting/add-expense',
  accountingDeleteExpense: 'accounting/delete-expense',
  accountingIncomes: 'accounting/incomes',
  accountingAddIncome: 'accounting/add-income',
  accountingCategories: 'accounting/categories',
  accountingSaveCategory: 'accounting/save-category',

  staffList: 'staff/list',
  staffSave: 'staff/save',
  dentistsList: 'dentists/list',
  dentistsSave: 'dentists/save',

  usersList: 'users/list',
  usersSave: 'users/save',
  usersResetPassword: 'users/reset-password',
  rolesList: 'roles/list',
  rolesSave: 'roles/save',
  rolesRemove: 'roles/remove',
  auditList: 'audit/list',

  attachmentsList: 'attachments/list',
  attachmentsAdd: 'attachments/add',
  attachmentsRename: 'attachments/rename',
  attachmentsRemove: 'attachments/remove',
  attachmentsOpen: 'attachments/open',
  attachmentsExport: 'attachments/export',

  backupRun: 'backup/run',
  backupList: 'backup/list',
  backupRestore: 'backup/restore',
  backupSetAuto: 'backup/set-auto',

  settingsGet: 'settings/get',
  settingsSave: 'settings/save',
  settingsUploadLogo: 'settings/upload-logo',
  settingsResetBusiness: 'settings/reset-business',

  dashboardGet: 'dashboard/get',
  notificationsList: 'notifications/list',
  notificationsMarkRead: 'notifications/mark-read',
  searchGlobal: 'search/global',

  reportsRun: 'reports/run',
  reportsExport: 'reports/export',
  reportsPrint: 'reports/print',
  printExecute: 'print/execute',
  printPdf: 'print/pdf',
   printClose: 'print/close',
  reportsSavePdf: 'reports/save-pdf',
  printersList: 'printers/list',

  referralsList: 'referrals/list',
  referralsSave: 'referrals/save',
} as const;
