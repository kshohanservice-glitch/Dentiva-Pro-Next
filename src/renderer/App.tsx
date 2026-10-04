import React from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppProvider, useApp } from './state/app-context';
import { ToastProvider, useToast } from './components/primitives';
import { AppShell, BootSplash, LockOverlay } from './components/shell';
import { LoginPage } from './pages/Login';
import { SetupWizard } from './pages/SetupWizard';
import { DashboardPage } from './pages/Dashboard';
import { PatientsPage, PatientProfilePage } from './pages/Patients';
import { AppointmentsPage } from './pages/Appointments';
import { QueuePage } from './pages/Queue';
import { TreatmentsPage } from './pages/Treatments';
import { PrescriptionsPage } from './pages/Prescriptions';
import { InvoicesPage, PaymentsPage } from './pages/Invoices';
import { InventoryPage } from './pages/Inventory';
import { AccountingPage } from './pages/Accounting';
import { StaffPage } from './pages/Staff';
import { UsersPage } from './pages/Users';
import { BackupPage } from './pages/Backup';
import { SettingsPage } from './pages/Settings';
import { ReportsPage } from './pages/Reports';
import { AuditPage } from './pages/Audit';
import { AboutPage } from './pages/About';
import { PrintPage } from './pages/PrintPage';
import { PermissionDenied } from './components/primitives';
import type { PermissionKey } from '../shared/permissions';

function Guarded({ permission, children }: { permission?: PermissionKey; children: React.ReactNode }) {
  const { can } = useApp();
  if (permission && !can(permission)) return <PermissionDenied permission={permission} />;
  return <>{children}</>;
}

function NotFound() {
  const toast = useToast();
  React.useEffect(() => {
    toast.warning('Page not found', 'Returning to the dashboard.');
  }, [toast]);
  return <Navigate to="/" replace />;
}

function Root() {
  const { phase, locked } = useApp();
  const location = useLocation();

  // Print window route (opened by main process for print preview jobs)
  if (location.pathname.startsWith('/print/')) {
    return <PrintPage />;
  }

  if (phase === 'booting') return <BootSplash />;
  if (phase === 'activation' || phase === 'setup') return <SetupWizard />;

  return (
    <>
      <Routes>
        <Route path="/login" element={phase === 'auth' ? <LoginPage /> : <Navigate to="/" replace />} />
        <Route
          path="/"
          element={
            phase === 'auth' ? (
              <Navigate to="/login" replace />
            ) : (
              <AppShell />
            )
          }
        >
          <Route index element={<Guarded permission="dashboard.view"><DashboardPage /></Guarded>} />
          <Route path="patients" element={<Guarded permission="patients.view"><PatientsPage /></Guarded>} />
          <Route path="patients/:id" element={<Guarded permission="patients.view"><PatientProfilePage /></Guarded>} />
          <Route path="appointments" element={<Guarded permission="appointments.view"><AppointmentsPage /></Guarded>} />
          <Route path="queue" element={<Guarded permission="queue.view"><QueuePage /></Guarded>} />
          <Route path="treatments" element={<Guarded permission="treatments.view"><TreatmentsPage /></Guarded>} />
          <Route path="prescriptions" element={<Guarded permission="clinical.view"><PrescriptionsPage /></Guarded>} />
          <Route path="invoices" element={<Guarded permission="billing.invoice.view"><InvoicesPage /></Guarded>} />
          <Route path="payments" element={<Guarded permission="billing.payment.view"><PaymentsPage /></Guarded>} />
          <Route path="inventory" element={<Guarded permission="inventory.view"><InventoryPage /></Guarded>} />
          <Route path="accounting" element={<Guarded permission="accounting.view"><AccountingPage /></Guarded>} />
          <Route path="staff" element={<Guarded permission="staff.view"><StaffPage /></Guarded>} />
          <Route path="users" element={<Guarded permission="users.manage"><UsersPage /></Guarded>} />
          <Route path="backup" element={<Guarded permission="backup.create"><BackupPage /></Guarded>} />
          <Route path="settings" element={<Guarded permission="settings.manage"><SettingsPage /></Guarded>} />
          <Route path="reports" element={<Guarded><ReportsPage /></Guarded>} />
          <Route path="audit" element={<Guarded permission="audit.view"><AuditPage /></Guarded>} />
          <Route path="about" element={<AboutPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
      {locked && <LockOverlay />}
    </>
  );
}

export function App() {
  return (
    <ToastProvider>
      <HashRouter>
        <AppProvider>
          <Root />
        </AppProvider>
      </HashRouter>
    </ToastProvider>
  );
}
