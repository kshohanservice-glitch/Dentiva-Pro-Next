import { BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions, type SaveDialogOptions } from 'electron';
import fs from 'node:fs';
import { IPC } from '../../shared/ipc';
import type { SessionUser } from '../../shared/types';
import { AppError, toWireError } from '../errors';
import { logger } from '../logger';
import type { Ctx } from '../core/context';
import { audit } from '../core/context';
import type { SessionManager } from '../core/session';
import type { ActivationStore } from '../core/activation';
import { changePassword, completeSetup, needsSetup, type SetupInputInternal } from '../services/auth';
import * as patients from '../services/patients';
import * as visits from '../services/visits';
import * as chart from '../services/chart';
import * as treatments from '../services/treatments';
import * as prescriptions from '../services/prescriptions';
import * as appointments from '../services/appointments';
import * as queueSvc from '../services/queue';
import * as billing from '../services/billing';
import * as inventory from '../services/inventory';
import * as accounting from '../services/accounting';
import * as staffSvc from '../services/staff';
import * as usersSvc from '../services/users';
import * as attachmentsSvc from '../services/attachments';
import * as settingsSvc from '../services/settings';
import * as dashboardSvc from '../services/dashboard';
import * as notificationsSvc from '../services/notifications';
import * as searchSvc from '../services/search';
import * as reportsSvc from '../services/reports';
import * as referralsSvc from '../services/referrals';
import type { BackupService } from '../services/backup';
import { closePrintWindow, executePrint, listPrinters, openPrintWindow, saveAsPdf } from '../print';
import { toCsv } from '../../shared/csv';
import type { AppPaths } from '../paths';
import { getDb } from '../app';

export interface RouterDeps {
  paths: () => AppPaths;
  session: SessionManager;
  activation: ActivationStore;
  backup: BackupService;
  securityPolicy: () => { maxFailedLogins: number; minPasswordLength: number };
  appVersion: string;
  schemaVersion: () => number;
  refreshNotifications: () => void;
  demo: boolean;
}

type Result<T> = { ok: true; data: T } | { ok: false; error: ReturnType<typeof toWireError> };


const activeWindow = (): BrowserWindow | undefined =>
  BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());

async function showOpen(opts: OpenDialogOptions): Promise<string | null> {
  const win = activeWindow();
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  if (res.canceled || res.filePaths.length === 0) return null;
  return res.filePaths[0];
}

async function showSave(opts: SaveDialogOptions): Promise<string | null> {
  const win = activeWindow();
  const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  if (res.canceled || !res.filePath) return null;
  return res.filePath;
}

async function pickDirectory(title: string, defaultPath?: string): Promise<string | null> {
  return showOpen({ title, defaultPath, properties: ['openDirectory', 'createDirectory'] });
}

async function pickFile(title: string, filters: Electron.FileFilter[]): Promise<string | null> {
  return showOpen({ title, properties: ['openFile'], filters });
}

export function registerRouter(deps: RouterDeps): void {
    const demoBlocked: Set<string> = new Set([
    IPC.activationVerify, IPC.authLogout, IPC.authChangePassword, IPC.authUnlock, IPC.setupComplete, IPC.systemLock,
    IPC.patientsCreate, IPC.patientsUpdate, IPC.patientsArchive, IPC.patientsDelete,
    IPC.visitsCreate, IPC.visitsUpdate, IPC.chartSet,
    IPC.treatmentsSave, IPC.treatmentsSetActive,
    IPC.prescriptionsCreate, IPC.prescriptionsDelete, IPC.prescriptionsSaveTemplate,
    IPC.appointmentsCreate, IPC.appointmentsUpdate, IPC.appointmentsCancel, IPC.appointmentsNoShow, IPC.appointmentsArrive,
    IPC.queueAdd, IPC.queueAction, IPC.queueReorder,
    IPC.invoicesCreate, IPC.invoicesVoid, IPC.invoicesDelete, IPC.paymentsCreate,
    IPC.inventorySaveItem, IPC.inventoryStock, IPC.inventorySaveSupplier,
    IPC.accountingAddExpense, IPC.accountingDeleteExpense, IPC.accountingAddIncome, IPC.accountingSaveCategory,
    IPC.staffSave, IPC.dentistsSave,
    IPC.usersSave, IPC.usersResetPassword, IPC.rolesSave, IPC.rolesRemove,
    IPC.attachmentsAdd, IPC.attachmentsRename, IPC.attachmentsRemove,
    IPC.backupRun, IPC.backupRestore, IPC.backupSetAuto,
    IPC.settingsSave, IPC.settingsUploadLogo, IPC.settingsResetBusiness,
    IPC.notificationsMarkRead, IPC.referralsSave,
  ]);
  const handle = (channel: string, opts: { auth: boolean; fn: (payload: any, ctx: Ctx | null) => any | Promise<any> }) => {
    ipcMain.handle(channel, async (_event, payload): Promise<Result<any>> => {
      try {
        if (deps.demo && demoBlocked.has(channel)) {
          throw new AppError('PERMISSION', 'Demo mode is read-only. This demo cannot be modified.');
        }
        let ctx: Ctx | null = null;
        if (opts.auth) {
          const session: SessionUser = deps.session.require();
          ctx = { db: getDb(), paths: deps.paths(), session };
        }
        const data = await opts.fn(payload, ctx);
        return { ok: true, data };
      } catch (err) {
        const correlationId = Math.random().toString(36).slice(2, 10);
        const wire = toWireError(err, correlationId);
        if (wire.code === 'AUTH') {
          for (const w of BrowserWindow.getAllWindows()) {
            if (!w.isDestroyed()) w.webContents.send(IPC.onSessionExpired, wire.message ?? 'Session ended');
          }
        }
        const level = wire.code === 'PERMISSION' || wire.code === 'AUTH' ? 'warn' : 'error';
        logger[level](`[${channel}] ${wire.message}`, {
          correlationId,
          code: wire.code,
          detail: err instanceof Error ? err.message : String(err),
        });
        return { ok: false, error: wire };
      }
    });
  };

  /* --------------------------- unauthenticated -------------------------- */
  handle(IPC.systemInfo, { auth: false, fn: () => ({
    version: deps.appVersion,
    schemaVersion: deps.schemaVersion(),
    dataDir: deps.paths().root,
    platform: process.platform,
    demo: deps.demo,
  }) });

  handle(IPC.systemActivity, { auth: false, fn: () => { deps.session.touch(); return null; } });

  handle(IPC.activationStatus, { auth: false, fn: () => deps.demo ? { activated: true, state: 'activated' as const } : deps.activation.getStatus() });
  handle(IPC.activationVerify, { auth: false, fn: (code: string) => {
    const result = deps.activation.activate(String(code ?? ''));
    if (result.activated) {
      audit({ db: getDb() }, { action: 'activation.verify', entityType: 'system', entityId: null, summary: 'Offline activation completed' });
    } else {
      // Record the attempt (never the entered value) for security visibility.
      audit({ db: getDb() }, {
        action: 'activation.verify', entityType: 'system', entityId: null,
        summary: 'Activation attempt rejected', result: 'denied',
      });
    }
    return result;
  } });

  handle(IPC.authLogin, { auth: false, fn: async (p: any) => deps.session.signIn(String(p?.username ?? ''), String(p?.password ?? '')) });
  handle(IPC.authSession, { auth: false, fn: () => deps.session.current() });
  handle(IPC.authLogout, { auth: false, fn: async () => {
    const current = deps.session.current();
    if (current) {
      audit({ db: getDb(), session: current }, { action: 'auth.logout', entityType: 'user', entityId: current.userId, summary: 'Signed out' });
    }
    deps.session.signOut();
    return null;
  } });
  handle(IPC.setupStatus, { auth: false, fn: () => ({ needsSetup: deps.demo ? false : needsSetup(getDb()) }) });
  handle(IPC.setupComplete, { auth: false, fn: async (p: any) => {
    const status = deps.activation.getStatus();
    if (!status.activated) throw new AppError('ACTIVATION', 'Complete activation before setup.');
    await completeSetup(getDb(), deps.paths(), p as SetupInputInternal);
    return { ok: true as const };
  } });

  handle(IPC.settingsGet, { auth: false, fn: () => {
    const db = getDb();
    const ctx = { db, paths: deps.paths(), session: null as any } as unknown as Ctx;
    const full = settingsSvc.getSettings(ctx);
    if (deps.demo) {
      full.clinic = { ...full.clinic, clinicName: full.clinic.clinicName || 'BrightSmile Dental Clinic — Demo' };
    }
    if (deps.session.current()) return full;
    // Unauthenticated (login/setup screens): expose branding only.
    return { clinic: full.clinic, prescription: { labels: full.prescription.labels } } as any;
  } });

  handle(IPC.systemLock, { auth: false, fn: () => { deps.session.lock(); return null; } });
  handle(IPC.onSessionExpired, { auth: false, fn: () => null });

  /* ------------------------------ patients ------------------------------ */
  handle(IPC.patientsList, { auth: true, fn: (p, ctx) => patients.listPatients(ctx!, p) });
  handle(IPC.patientsGet, { auth: true, fn: (p, ctx) => patients.getPatient(ctx!, Number(p)) });
  handle(IPC.patientsCreate, { auth: true, fn: (p, ctx) => patients.createPatient(ctx!, p) });
  handle(IPC.patientsUpdate, { auth: true, fn: (p, ctx) => patients.updatePatient(ctx!, Number(p?.id), p) });
  handle(IPC.patientsArchive, { auth: true, fn: (p, ctx) => patients.archivePatient(ctx!, Number(p)) });
  handle(IPC.patientsDelete, { auth: true, fn: (p, ctx) => patients.deletePatient(ctx!, Number(p)) });
  handle(IPC.patientsDuplicates, { auth: true, fn: (p, ctx) => patients.checkDuplicates(ctx!, p) });
  handle(IPC.patientsTimeline, { auth: true, fn: (p, ctx) => patients.patientTimeline(ctx!, Number(p)) });
  handle(IPC.patientsExport, { auth: true, fn: async (p, ctx) => {
    const target = await showSave({
      title: 'Export patients', defaultPath: `patients-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (!target) return { cancelled: true as const };
    const { header, rows } = patients.patientCsvRows(ctx!, p);
    fs.writeFileSync(target, '\uFEFF' + toCsv(header, rows), 'utf8');
    audit(ctx!, { action: 'export.patients', entityType: 'patient', entityId: null, summary: `Exported ${rows.length} patients to CSV` });
    return { path: target, count: rows.length };
  } });

  /* -------------------------- visits & chart --------------------------- */
  handle(IPC.visitsList, { auth: true, fn: (p, ctx) => visits.listVisits(ctx!, p) });
  handle(IPC.visitsGet, { auth: true, fn: (p, ctx) => visits.getVisit(ctx!, Number(p)) });
  handle(IPC.visitsCreate, { auth: true, fn: (p, ctx) => visits.createVisit(ctx!, p) });
  handle(IPC.visitsUpdate, { auth: true, fn: (p, ctx) => visits.updateVisit(ctx!, Number(p?.id), p) });

  handle(IPC.chartGet, { auth: true, fn: (p, ctx) => chart.getChart(ctx!, Number(p)) });
  handle(IPC.chartSet, { auth: true, fn: (p, ctx) => chart.setChart(ctx!, Number(p?.patientId), p) });

  /* --------------------------- treatments ------------------------------ */
  handle(IPC.treatmentsList, { auth: true, fn: (p, ctx) => treatments.listTreatments(ctx!, !!p) });
  handle(IPC.treatmentsSave, { auth: true, fn: (p, ctx) => treatments.saveTreatment(ctx!, p) });
  handle(IPC.treatmentsSetActive, { auth: true, fn: (p, ctx) => treatments.setTreatmentActive(ctx!, Number(p?.id), !!p?.active) });

  /* -------------------------- prescriptions ---------------------------- */
  handle(IPC.prescriptionsList, { auth: true, fn: (p, ctx) => prescriptions.listPrescriptions(ctx!, p) });
  handle(IPC.prescriptionsGet, { auth: true, fn: (p, ctx) => prescriptions.getPrescription(ctx!, Number(p)) });
  handle(IPC.prescriptionsCreate, { auth: true, fn: (p, ctx) => prescriptions.createPrescription(ctx!, p) });
  handle(IPC.prescriptionsDelete, { auth: true, fn: (p, ctx) => prescriptions.deletePrescription(ctx!, Number(p)) });
  handle(IPC.prescriptionsTemplates, { auth: true, fn: (_p, ctx) => prescriptions.listTemplates(ctx!) });
  handle(IPC.prescriptionsSaveTemplate, { auth: true, fn: (p, ctx) => prescriptions.saveTemplate(ctx!, String(p?.name), p?.items) });

  /* -------------------------- appointments ----------------------------- */
  handle(IPC.appointmentsList, { auth: true, fn: (p, ctx) => appointments.listAppointments(ctx!, p) });
  handle(IPC.appointmentsCreate, { auth: true, fn: (p, ctx) => appointments.createAppointment(ctx!, p) });
  handle(IPC.appointmentsUpdate, { auth: true, fn: (p, ctx) => appointments.updateAppointment(ctx!, Number(p?.id), p) });
  handle(IPC.appointmentsCancel, { auth: true, fn: (p, ctx) => appointments.cancelAppointment(ctx!, Number(p?.id), p?.reason) });
  handle(IPC.appointmentsNoShow, { auth: true, fn: (p, ctx) => appointments.markNoShow(ctx!, Number(p)) });
  handle(IPC.appointmentsArrive, { auth: true, fn: (p, ctx) => appointments.arriveAppointment(ctx!, Number(p)) });

  /* ------------------------------- queue -------------------------------- */
  handle(IPC.queueList, { auth: true, fn: (p, ctx) => queueSvc.listQueue(ctx!, String(p)) });
  handle(IPC.queueAdd, { auth: true, fn: (p, ctx) => queueSvc.addQueueEntry(ctx!, p) });
  handle(IPC.queueAction, { auth: true, fn: (p, ctx) => queueSvc.performQueueAction(ctx!, p?.id != null ? Number(p.id) : null, p?.action, p?.payload) });
  handle(IPC.queueReorder, { auth: true, fn: (p, ctx) => queueSvc.reorderQueue(ctx!, p) });

  /* ------------------------------ billing ------------------------------ */
  handle(IPC.invoicesList, { auth: true, fn: (p, ctx) => billing.listInvoices(ctx!, p) });
  handle(IPC.invoicesGet, { auth: true, fn: (p, ctx) => billing.getInvoice(ctx!, Number(p)) });
  handle(IPC.invoicesCreate, { auth: true, fn: (p, ctx) => billing.createInvoice(ctx!, p) });
  handle(IPC.invoicesVoid, { auth: true, fn: (p, ctx) => billing.voidInvoice(ctx!, Number(p?.id), p?.reason) });
  handle(IPC.invoicesDelete, { auth: true, fn: (p, ctx) => billing.deleteInvoice(ctx!, Number(p)) });
  handle(IPC.paymentsList, { auth: true, fn: (p, ctx) => billing.listPayments(ctx!, p) });
  handle(IPC.paymentsCreate, { auth: true, fn: (p, ctx) => billing.createPayment(ctx!, p) });

  /* ----------------------------- inventory ------------------------------ */
  handle(IPC.inventoryItems, { auth: true, fn: (p, ctx) => inventory.listItems(ctx!, p ?? {}) });
  handle(IPC.inventoryBatches, { auth: true, fn: (p, ctx) => inventory.listBatches(ctx!, p ?? {}) });
  handle(IPC.inventorySaveItem, { auth: true, fn: (p, ctx) => inventory.saveItem(ctx!, p) });
  handle(IPC.inventoryStock, { auth: true, fn: (p, ctx) => inventory.stockOperation(ctx!, p) });
  handle(IPC.inventorySuppliers, { auth: true, fn: (_p, ctx) => inventory.listSuppliers(ctx!) });
  handle(IPC.inventorySaveSupplier, { auth: true, fn: (p, ctx) => inventory.saveSupplier(ctx!, p) });

  /* ----------------------------- accounting ----------------------------- */
  handle(IPC.accountingExpenses, { auth: true, fn: (p, ctx) => accounting.listExpenses(ctx!, p ?? {}) });
  handle(IPC.accountingAddExpense, { auth: true, fn: (p, ctx) => accounting.addExpense(ctx!, p) });
  handle(IPC.accountingDeleteExpense, { auth: true, fn: (p, ctx) => accounting.deleteExpense(ctx!, Number(p)) });
  handle(IPC.accountingIncomes, { auth: true, fn: (p, ctx) => accounting.listIncomes(ctx!, p ?? {}) });
  handle(IPC.accountingAddIncome, { auth: true, fn: (p, ctx) => accounting.addIncome(ctx!, p) });
  handle(IPC.accountingCategories, { auth: true, fn: (_p, ctx) => accounting.listCategories(ctx!) });
  handle(IPC.accountingSaveCategory, { auth: true, fn: (p, ctx) => accounting.saveCategory(ctx!, p) });

  /* --------------------------- staff & dentists -------------------------- */
  handle(IPC.staffList, { auth: true, fn: (_p, ctx) => staffSvc.listStaff(ctx!) });
  handle(IPC.staffSave, { auth: true, fn: (p, ctx) => staffSvc.saveStaff(ctx!, p) });
  handle(IPC.dentistsList, { auth: true, fn: (p, ctx) => staffSvc.listDentists(ctx!, !!p) });
  handle(IPC.dentistsSave, { auth: true, fn: (p, ctx) => staffSvc.saveDentist(ctx!, p) });

  /* ------------------------ users, roles, audit -------------------------- */
  handle(IPC.usersList, { auth: true, fn: (_p, ctx) => usersSvc.listUsers(ctx!) });
  handle(IPC.usersSave, { auth: true, fn: (p, ctx) => usersSvc.saveUser(ctx!, p) });
  handle(IPC.usersResetPassword, { auth: true, fn: (p, ctx) => usersSvc.resetPassword(ctx!, Number(p?.id), p?.password) });
  handle(IPC.rolesList, { auth: true, fn: (_p, ctx) => usersSvc.listRoles(ctx!) });
  handle(IPC.rolesSave, { auth: true, fn: (p, ctx) => usersSvc.saveRole(ctx!, p) });
  handle(IPC.rolesRemove, { auth: true, fn: (p, ctx) => usersSvc.removeRole(ctx!, Number(p)) });
  handle(IPC.auditList, { auth: true, fn: (p, ctx) => usersSvc.listAudit(ctx!, p ?? {}) });

  /* ---------------------------- attachments ------------------------------ */
  handle(IPC.attachmentsList, { auth: true, fn: (p, ctx) => attachmentsSvc.listAttachments(ctx!, String(p?.entityType), Number(p?.entityId)) });
  handle(IPC.attachmentsAdd, { auth: true, fn: async (p, ctx) => {
    const file = await pickFile('Attach file', [
      { name: 'Supported files', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'csv', 'rtf', 'odt', 'ods'] },
      { name: 'All files', extensions: ['*'] },
    ]);
    if (!file) return { cancelled: true };
    return attachmentsSvc.addAttachment(ctx!, String(p?.entityType), Number(p?.entityId), file);
  } });
  handle(IPC.attachmentsRename, { auth: true, fn: (p, ctx) => attachmentsSvc.renameAttachment(ctx!, Number(p?.id), p?.name) });
  handle(IPC.attachmentsRemove, { auth: true, fn: (p, ctx) => attachmentsSvc.removeAttachment(ctx!, Number(p)) });
  handle(IPC.attachmentsOpen, { auth: true, async fn(p, ctx) {
    const { abs } = attachmentsSvc.attachmentPath(ctx!, Number(p));
    const err = await shell.openPath(abs);
    if (err) throw new AppError('FILE', `Could not open file: ${err}`);
    return { ok: true };
  } });
  handle(IPC.attachmentsExport, { auth: true, fn: async (p, ctx) => {
    const { abs, originalName } = attachmentsSvc.attachmentPath(ctx!, Number(p));
    const target = await showSave({ title: 'Export attachment', defaultPath: originalName });
    if (!target) return { cancelled: true as const };
    fs.copyFileSync(abs, target);
    audit(ctx!, { action: 'attachment.export', entityType: 'attachment', entityId: Number(p), summary: `Exported "${originalName}"` });
    return { path: target };
  } });

  /* ----------------------------- backup/restore -------------------------- */
  handle(IPC.backupRun, { auth: true, fn: async (p, ctx) => {
    // One-click backup: use the caller's destination, else the configured
    // auto-backup destination, else the app's backups folder. Never blocks on
    // a native folder dialog — destination changes happen in Backup settings.
    let destination = String(p ?? '');
    if (!destination) {
      const configured = deps.backup.readBackupSetting().destination;
      destination = configured && configured.trim() ? configured : deps.paths().backupsDir;
    }
    return deps.backup.runBackup(ctx!, destination, 'manual');
  } });
  handle(IPC.backupList, { auth: true, fn: (_p, ctx) => deps.backup.listBackups(ctx!) });
  handle(IPC.backupRestore, { auth: true, fn: async (p, ctx) => {
    let filePath = String(p?.filePath ?? '');
    if (!filePath) {
      const picked = await pickFile('Select Dentiva Pro backup', [
        { name: 'Dentiva Pro backup', extensions: ['dpv'] }, { name: 'All files', extensions: ['*'] },
      ]);
      if (!picked) return { cancelled: true };
      filePath = picked;
    }
    return deps.backup.restoreBackup(ctx!, filePath, String(p?.typedConfirm ?? ''));
  } });
  handle(IPC.backupSetAuto, { auth: true, fn: async (p, ctx) => {
    let destination = p?.destination ? String(p.destination) : null;
    if (!destination) {
      destination = await pickDirectory('Choose automatic backup destination');
      if (!destination) return { cancelled: true };
    }
    settingsSvc.saveSettings(ctx!, { backup: { autoFrequencyDays: p?.frequencyDays, destination, retention: p?.retention } as any });
    return { ok: true as const, destination };
  } });

  /* ------------------------------- settings ------------------------------ */
  handle(IPC.settingsSave, { auth: true, fn: (p, ctx) => settingsSvc.saveSettings(ctx!, p) });
  handle(IPC.settingsUploadLogo, { auth: true, fn: async (_p, ctx) => {
    const file = await pickFile('Choose clinic logo', [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] },
    ]);
    if (!file) return { cancelled: true };
    return settingsSvc.uploadLogo(ctx!, file);
  } });
  handle(IPC.settingsResetBusiness, { auth: true, fn: async (p, ctx) =>
    settingsSvc.resetBusiness(ctx!, p, async () => {
      const rec = await deps.backup.runBackup({ db: getDb() }, deps.paths().backupsDir, 'pre_restore');
      return rec.path;
    }) });

  /* ------------------- dashboard, notifications, search ------------------- */
  handle(IPC.dashboardGet, { auth: true, fn: (_p, ctx) => {
    deps.refreshNotifications();
    return dashboardSvc.getDashboard(ctx!);
  } });
  handle(IPC.notificationsList, { auth: true, fn: (_p, ctx) => notificationsSvc.listNotifications(ctx!) });
  handle(IPC.notificationsMarkRead, { auth: true, fn: (p, ctx) => notificationsSvc.markNotificationsRead(ctx!, p != null ? Number(p) : undefined) });
  handle(IPC.searchGlobal, { auth: true, fn: (p, ctx) => searchSvc.globalSearch(ctx!, String(p ?? '')) });

  /* ------------------------------- reports -------------------------------- */
  handle(IPC.reportsRun, { auth: true, fn: (p, ctx) => reportsSvc.runReport(ctx!, String(p?.name), p?.params ?? {}) });
  handle(IPC.reportsExport, { auth: true, fn: async (p, ctx) => {
    const { header, rows } = reportsSvc.reportCsv(ctx!, String(p?.name), p?.params ?? {});
    const target = await showSave({
      title: 'Export report',
      defaultPath: `${String(p?.name)}-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (!target) return { cancelled: true as const };
    fs.writeFileSync(target, '\uFEFF' + toCsv(header, rows), 'utf8');
    audit(ctx!, { action: 'export.report', entityType: 'report', entityId: String(p?.name), summary: `Exported report "${p?.name}" (${rows.length} rows)` });
    return { path: target, rows: rows.length };
  } });
  handle(IPC.reportsPrint, { auth: true, fn: (p) => {
    openPrintWindow({ type: p?.type ?? 'report', id: Number(p?.id ?? 0), reportName: p?.reportName, profileId: p?.profileId, params: p?.params });
    return { ok: true };
  } });
  handle(IPC.reportsSavePdf, { auth: true, fn: (p) => {
    openPrintWindow({ type: p?.type ?? 'report', id: Number(p?.id ?? 0), reportName: p?.reportName, profileId: p?.profileId, params: p?.params });
    return { ok: true };
  } });
  handle(IPC.printersList, { auth: true, async fn() {
    const win = activeWindow();
    if (!win) return [];
    return listPrinters(win.webContents);
  } });

  /* -------------------------------- print --------------------------------- */
  handle(IPC.printClose, { auth: true, fn: () => { closePrintWindow(); return { ok: true }; } });
  handle(IPC.printExecute, { auth: true, fn: async (p) => executePrint(p ?? {}) });
  handle(IPC.printPdf, { auth: true, fn: async (p) => saveAsPdf(p ?? {}) });

  /* ------------------------------ referrals -------------------------------- */
  handle(IPC.referralsList, { auth: true, fn: (p, ctx) => referralsSvc.listReferrals(ctx!, Number(p)) });
  handle(IPC.referralsSave, { auth: true, fn: (p, ctx) => referralsSvc.saveReferral(ctx!, p) });

  handle(IPC.authUnlock, { auth: false, fn: async (p) => {
    const ok = await deps.session.unlock(String(p ?? ''));
    return ok ? { ok: true } : { ok: false, error: 'Incorrect password.' };
  } });

  /* -------------------------- change password ----------------------------- */
  handle(IPC.authChangePassword, { auth: true, fn: async (p, ctx) => {
    await changePassword(ctx!.db, ctx!.session, String(p?.oldPassword ?? ''), String(p?.newPassword ?? ''), deps.securityPolicy().minPasswordLength);
    return { ok: true };
  } });
}
