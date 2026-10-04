/**
 * End-to-end smoke of the real Dentiva Pro application.
 *
 * Runs against the dev build (`npm run test:e2e` = build + playwright test):
 * activation → first-run setup → login → dashboard → patient registration →
 * invoice + payment → about → backup. The packaged installer is validated
 * separately by scripts/smoke-installed.mjs in CI.
 *
 * The activation code is reconstructed from factors — the literal code must
 * never appear in this repository.
 */
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const ACTIVATION_CODE = [3, 3, 5, 317, 106315593061].reduce((acc, n) => acc * n, 1).toString();
const PASSWORD = 'Passw0rd123';

let app: ElectronApplication;
let page: Page;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  // Dev mode stores data in <repo>/.dentiva-data — start from a clean slate.
  fs.rmSync(path.resolve('.dentiva-data'), { recursive: true, force: true });
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, DENTIVA_DEV: '1' },
    timeout: 90_000,
  });
  page = await app.firstWindow({ timeout: 60_000 });
  // Forward renderer diagnostics to stdout so CI annotations can show them.
  page.on('console', (m) => console.log(`[renderer ${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.stack ?? e.message}`));
  await page.waitForLoadState('domcontentloaded');
});

/** Dump whatever the window actually shows — used when a selector never appears. */
async function dumpWindowState(label: string): Promise<void> {
  try {
    console.log(`[diag:${label}] title=${await page.title()}`);
    console.log(`[diag:${label}] url=${page.url()}`);
    const html = await page.content();
    console.log(`[diag:${label}] html=${html.slice(0, 2500)}`);
    const text = await page.locator('body').innerText();
    console.log(`[diag:${label}] bodyText=${text.slice(0, 1200)}`);
  } catch (err) {
    console.log(`[diag:${label}] dump failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

test.afterAll(async () => {
  await app?.close();
});

test('activates offline and completes first-run setup', async () => {
  const code = page.locator('input[placeholder="Enter activation code"]');
  try {
    await expect(code).toBeVisible({ timeout: 60_000 });
  } catch (err) {
    await dumpWindowState('activation');
    throw err;
  }

  await code.fill(ACTIVATION_CODE);
  await page.getByRole('button', { name: 'Activate' }).click();
  try {
    await expect(page.getByRole('heading', { name: 'Clinic information' })).toBeVisible();
  } catch (err) {
    await dumpWindowState('post-activate');
    throw err;
  }

  await page.locator('input[placeholder="e.g. Smile Dental Care"]').fill('E2E Test Dental');
  await page.locator('input[placeholder="01XXXXXXXXX"]').fill('01711111111');
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.locator('input[placeholder="Dr. …"]').fill('Dr. E2E Dentist');
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.locator('input[placeholder="admin"]').fill('e2eowner');
  const pwFields = page.locator('input[type="password"][autocomplete="new-password"]');
  await pwFields.first().fill(PASSWORD);
  await pwFields.nth(1).fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByRole('button', { name: 'Finish setup' }).click();
  // Setup ends on the sign-in screen.
  await expect(page.getByPlaceholder('e.g. admin')).toBeVisible({ timeout: 60_000 });
});

test('signs in and renders the dashboard', async () => {
  await page.getByPlaceholder('e.g. admin').fill('e2eowner');
  await page.getByPlaceholder('Your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Backup now' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('link', { name: 'Patients' })).toBeVisible();
});

test('registers a patient with Bengali-capable data entry', async () => {
  await page.getByRole('link', { name: 'Patients' }).click();
  await expect(page.getByRole('heading', { name: 'Patients', level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'Register patient' }).first().click();
  const modal = page.locator('.modal[role="dialog"]');
  await expect(modal).toBeVisible();
  await modal.getByPlaceholder('Patient name').fill('E2E Test Patient');
  await modal.getByPlaceholder('বাংলায় নাম').fill('ইউটিই টেস্ট রোগী');
  await modal.getByLabel('Gender').selectOption('male');
  await modal.getByLabel('Age (years)').fill('34');
  await modal.getByPlaceholder('01XXXXXXXXX').fill('01799999999');
  await modal.getByRole('button', { name: 'Register patient' }).click();

  // Saved → navigated to the patient profile.
  await expect(page.getByRole('heading', { name: 'E2E Test Patient' })).toBeVisible({ timeout: 30_000 });

  // Search finds them from the list too.
  await page.getByRole('link', { name: 'Patients' }).click();
  await page.getByPlaceholder('Search name, phone, patient ID, tag…').fill('E2E Test Patient');
  await expect(page.getByRole('cell', { name: 'E2E Test Patient' })).toBeVisible();
});

test('selects and updates the dental chart reliably', async () => {
  await page.getByRole('link', { name: 'Patients' }).click();
  await page.getByPlaceholder('Search name, phone, patient ID, tag…').fill('E2E Test Patient');
  await page.getByRole('cell', { name: 'E2E Test Patient' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Test Patient' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('tab', { name: 'Dental chart', exact: true }).click();

  const chart = page.locator('.tooth-chart');
  await expect(chart).toBeVisible({ timeout: 30_000 });
  const tooth = chart.locator('.tooth-body', { hasText: '11' }).first();
  await tooth.click();
  await expect(tooth).toHaveAttribute('aria-pressed', 'true');
  await expect(chart.getByText('11', { exact: false }).first()).toBeVisible();

  await chart.getByRole('button', { name: /Apply “Caries”/ }).click();
  await expect(page.locator('.toast-title', { hasText: 'Chart updated' })).toBeVisible({ timeout: 30_000 });
  await expect(tooth).toHaveClass(/marked/);
});

test('creates an invoice and receives full payment', async () => {
  await page.getByRole('link', { name: 'Invoice', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Invoices', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'New invoice' }).first().click();

  const modal = page.locator('.modal[role="dialog"]', { hasText: 'Create invoice' });
  await expect(modal).toBeVisible();
  await modal.getByPlaceholder('Search patient by name, phone or ID…').fill('E2E Test Patient');
  await modal.locator('.list-row', { hasText: 'E2E Test Patient' }).first().click();

  // The form starts with one empty line.
  await modal.getByPlaceholder('Treatment or item').fill('Scaling and polishing');
  await modal.getByLabel('Unit price (৳)').fill('500');
  await modal.getByRole('button', { name: 'Create invoice' }).click();

  // onSaved opens the invoice detail modal.
  const detail = page.locator('.modal[role="dialog"]', { hasText: 'Invoice INV-' });
  await expect(detail).toBeVisible({ timeout: 30_000 });
  await expect(detail.getByText('৳500.00').first()).toBeVisible();

  await detail.getByRole('button', { name: 'Receive payment' }).click();
  const pay = page.locator('.modal[role="dialog"]', { hasText: 'Receive payment' }).last();
  await expect(pay).toBeVisible();
  await pay.getByLabel('Method').selectOption('cash');
  await pay.getByRole('button', { name: 'Record payment' }).click();

  await expect(page.locator('.toast-title', { hasText: 'Payment recorded' })).toBeVisible({ timeout: 30_000 });
  await expect(detail.getByText('paid', { exact: true })).toBeVisible();
  await detail.getByRole('button', { name: 'Close' }).click();

  await expect(page.getByRole('cell', { name: 'INV-', exact: false }).first()).toBeVisible();

  // Dashboard is live: the same payment must be reflected without a manual refresh.
  await page.getByRole('link', { name: 'Dashboard' }).click();
  const paidCard = page.locator('.stat-card', { hasText: 'Paid Today' });
  await expect(paidCard).toContainText('৳500.00', { timeout: 10_000 });
});

test('shows developer credit on the About page', async () => {
  await page.getByRole('link', { name: 'About' }).click();
  await expect(page.getByText('Shohan Khan')).toBeVisible();
  await expect(page.getByText('helloiamshohan@gmail.com')).toBeVisible();
});

test('runs a manual backup from the dashboard', async () => {
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await page.getByRole('button', { name: 'Backup now' }).click();
  await expect(page.locator('.toast-title', { hasText: 'Backup created' })).toBeVisible({ timeout: 60_000 });
});

/* ---------------------------------------------------------------------------
 * Phase B journey expansion (ISS-005): appointment lifecycle + queue,
 * prescription → print window, and the Reports UI contract (ISS-020 guard).
 * --------------------------------------------------------------------------- */

test('books an appointment and walks the patient through the queue to completion', async () => {
  const today = new Date().toISOString().slice(0, 10);
  await page.getByRole('link', { name: 'Appointments' }).click();
  await expect(page.getByRole('heading', { name: 'Appointments', level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'New appointment' }).first().click();
  const modal = page.locator('.modal[role="dialog"]', { hasText: 'New appointment' });
  await expect(modal).toBeVisible();
  await modal.getByPlaceholder('Search by name, phone or patient ID…').fill('E2E Test Patient');
  await modal.locator('.list-row', { hasText: 'E2E Test Patient' }).first().click();
  await modal.getByLabel('Dentist').selectOption({ label: 'Dr. E2E Dentist' });
  await modal.getByLabel('Date').fill(today);
  await modal.getByLabel('Time').fill('15:30');
  await modal.getByRole('button', { name: 'Book appointment' }).click();
  await expect(page.locator('.toast-title', { hasText: 'Appointment booked' })).toBeVisible({ timeout: 30_000 });

  // Patient arrives → enters the queue.
  await page.getByRole('button', { name: 'Arrive → queue' }).first().click();
  await expect(page.locator('.toast-title', { hasText: 'Patient arrived' })).toBeVisible({ timeout: 30_000 });

  // Queue: call → start → complete.
  await page.getByRole('link', { name: 'Queue' }).click();
  await expect(page.getByRole('heading', { name: 'Queue', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Call next' }).first().click();
  await expect(page.locator('.toast-title', { hasText: '— call' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Start treatment' }).first().click();
  await expect(page.locator('.toast-title', { hasText: '— start' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Complete' }).first().click();
  await expect(page.locator('.toast-title', { hasText: '— complete' })).toBeVisible({ timeout: 30_000 });
  // The finished entry lands in the completed section for the day.
  await expect(page.getByText('Completed & removed')).toBeVisible();
  await expect(page.locator('.card, .Card, section', { hasText: 'Completed & removed' }).getByText('E2E Test Patient').first()).toBeVisible({ timeout: 30_000 });
});

test('blocks double-booking with a conflict alert and honours override permission', async () => {
  const today = new Date().toISOString().slice(0, 10);
  await page.getByRole('link', { name: 'Appointments' }).click();

  // First book an active scheduled appointment at 16:00 (the earlier 15:30 slot was completed in the queue test).
  await page.getByRole('button', { name: 'New appointment' }).first().click();
  const firstModal = page.locator('.modal[role="dialog"]', { hasText: 'New appointment' });
  await expect(firstModal).toBeVisible();
  await firstModal.getByPlaceholder('Search by name, phone or patient ID…').fill('E2E Test Patient');
  await firstModal.locator('.list-row', { hasText: 'E2E Test Patient' }).first().click();
  await firstModal.getByLabel('Dentist').selectOption({ label: 'Dr. E2E Dentist' });
  await firstModal.getByLabel('Date').fill(today);
  await firstModal.getByLabel('Time').fill('16:00');
  await firstModal.getByRole('button', { name: 'Book appointment' }).click();
  await expect(page.locator('.toast-title', { hasText: 'Appointment booked' }).last()).toBeVisible({ timeout: 30_000 });

  // Now attempt an overlapping appointment at 16:15 for the same dentist.
  await page.getByRole('button', { name: 'New appointment' }).first().click();
  const modal = page.locator('.modal[role="dialog"]', { hasText: 'New appointment' });
  await expect(modal).toBeVisible();
  await modal.getByPlaceholder('Search by name, phone or patient ID…').fill('E2E Test Patient');
  await modal.locator('.list-row', { hasText: 'E2E Test Patient' }).first().click();
  await modal.getByLabel('Dentist').selectOption({ label: 'Dr. E2E Dentist' });
  await modal.getByLabel('Date').fill(today);
  await modal.getByLabel('Time').fill('16:15'); // overlaps the 16:00 appointment
  await modal.getByRole('button', { name: 'Book appointment' }).click();
  // Conflict detected (owner holds appointments.override → inline alert, not a silent double-book).
  await expect(modal.getByText('Scheduling conflict')).toBeVisible({ timeout: 30_000 });
  await modal.getByRole('button', { name: 'Book anyway (override)' }).click();
  await expect(page.locator('.toast-title', { hasText: 'Appointment booked' }).last()).toBeVisible({ timeout: 30_000 });
});

test('creates a prescription and opens the print window', async () => {
  await page.getByRole('link', { name: 'Patients' }).click();
  await page.getByPlaceholder('Search name, phone, patient ID, tag…').fill('E2E Test Patient');
  await page.getByRole('cell', { name: 'E2E Test Patient' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Test Patient' })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'New prescription' }).first().click();
  const rxModal = page.locator('.modal[role="dialog"]', { hasText: 'Save prescription' });
  await expect(rxModal).toBeVisible();
  await page.getByLabel('Prescribing dentist').selectOption({ label: 'Dr. E2E Dentist' });
  await page.getByPlaceholder('e.g. Amoxicillin').first().fill('Amoxicillin 500 mg');
  await page.getByRole('button', { name: 'Save prescription' }).click();
  await expect(page.getByText('Amoxicillin 500 mg').first()).toBeVisible({ timeout: 30_000 });

  // Open the saved prescription and print — a separate sandboxed print window must open.
  await page.getByText('Amoxicillin 500 mg').first().click();
  const detail = page.locator('.modal[role="dialog"]', { hasText: 'Patient' }).last();
  await expect(detail.getByRole('button', { name: 'Print', exact: true })).toBeVisible({ timeout: 30_000 });
  const [printWin] = await Promise.all([
    app.waitForEvent('window', { timeout: 60_000 }),
    detail.getByRole('button', { name: 'Print', exact: true }).click(),
  ]);
  await printWin.waitForLoadState('domcontentloaded');
  expect(printWin.url()).toContain('#print/prescription');
  await expect(printWin.getByText('Amoxicillin 500 mg').first()).toBeVisible({ timeout: 60_000 });
  await printWin.close();
  await detail.getByRole('button', { name: 'Close' }).click();
  await expect(detail).toBeHidden();
});

test('switches invoice output from A4 to 80mm thermal without overflow and closes with Back', async () => {
  await page.getByRole('link', { name: 'Invoice', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Invoices', level: 1 })).toBeVisible();
  const row = page.getByRole('cell', { name: 'INV-', exact: false }).first();
  await row.click();
  const detail = page.locator('.modal[role="dialog"]', { hasText: 'Invoice INV-' }).last();
  await expect(detail).toBeVisible({ timeout: 30_000 });

  const [printWin] = await Promise.all([
    app.waitForEvent('window', { timeout: 60_000 }),
    detail.getByRole('button', { name: 'Print invoice', exact: true }).click(),
  ]);
  await printWin.waitForLoadState('domcontentloaded');
  const profile = printWin.getByRole('combobox', { name: 'Print profile' });
  await expect(profile).toHaveValue('inv-a4');
  await expect(printWin.locator('.print-doc .doc-title', { hasText: 'Invoice' })).toBeVisible({ timeout: 60_000 });

  // Switching from A4 to thermal must replace the document geometry, not merely squeeze A4.
  await profile.selectOption('inv-thermal');
  await expect(printWin.locator('.print-doc.thermal80 .thermal-title', { hasText: 'INVOICE' })).toBeVisible({ timeout: 30_000 });

  const overflow = await printWin.evaluate(() => {
    const root = document.documentElement;
    const paper = document.querySelector('.print-doc') as HTMLElement | null;
    return {
      document: root.scrollWidth - root.clientWidth,
      paper: paper ? paper.scrollWidth - paper.clientWidth : 999,
    };
  });
  expect(overflow.document).toBeLessThanOrEqual(1);
  expect(overflow.paper).toBeLessThanOrEqual(1);

  await Promise.all([
    printWin.waitForEvent('close'),
    printWin.getByRole('button', { name: 'Back', exact: true }).click(),
  ]);
  await detail.getByRole('button', { name: 'Close' }).click();
});

test('runs reports from the UI — the full catalogue contract (ISS-020 guard)', async () => {
  await page.getByRole('link', { name: 'Reports' }).click();
  await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();

  // Daily summary (default selection).
  await page.getByRole('button', { name: 'Run report' }).click();
  await expect(page.getByText('Collections (net)')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.toast-title', { hasText: 'Unknown report' })).toHaveCount(0);

  // Range report with totals.
  await page.getByText('Collection report', { exact: true }).click();
  await page.getByRole('button', { name: 'Run report' }).click();
  await expect(page.getByText('By method')).toBeVisible({ timeout: 30_000 });

  // Profit & loss.
  await page.getByText('Profit & loss', { exact: true }).click();
  await page.getByRole('button', { name: 'Run report' }).click();
  await expect(page.getByText('Net', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.toast-title', { hasText: 'Unknown report' })).toHaveCount(0);
});

test('completes a patient visit from the profile and supports patient deletion', async () => {
  await page.getByRole('link', { name: 'Patients' }).click();
  await page.getByPlaceholder('Search name, phone, patient ID, tag…').fill('E2E Test Patient');
  await page.getByRole('cell', { name: 'E2E Test Patient' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Test Patient' })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'New visit', exact: true }).first().click();
  const visit = page.locator('.modal[role="dialog"]', { hasText: 'Record visit' });
  await expect(visit).toBeVisible();
  await visit.getByLabel('Dentist').selectOption({ label: 'Dr. E2E Dentist' });
  await visit.getByLabel('Chief complaint').fill('E2E completion check');
  await visit.getByRole('button', { name: 'Save visit' }).click();
  await expect(page.locator('.toast-title', { hasText: 'Visit recorded' })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('tab', { name: 'Visits', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Complete visit', exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Complete visit', exact: true }).click();
  await expect(page.locator('.toast-title', { hasText: 'Visit completed' })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const confirm = page.locator('.modal[role="dialog"]', { hasText: 'Delete patient record?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Delete patient', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Patients', level: 1 })).toBeVisible({ timeout: 30_000 });
});

test('adapts cleanly across 1280×720 and 1920×1080 viewports without horizontal overflow', async () => {
  for (const size of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(size);
    for (const nav of ['Dashboard', 'Patients', 'Appointments', 'Queue', 'Invoice', 'Inventory', 'Settings']) {
      await page.getByRole('link', { name: nav, exact: true }).click();
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return doc.scrollWidth - doc.clientWidth;
      });
      expect(overflow).toBeLessThanOrEqual(2);
    }
  }
});
