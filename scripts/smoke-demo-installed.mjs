import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const exePath = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Dentiva Pro Demo', 'Dentiva Pro Demo.exe');
if (!fs.existsSync(exePath)) throw new Error(`Demo executable not found: ${exePath}`);
fs.rmSync(path.join(os.homedir(), 'AppData', 'Roaming', 'Dentiva Pro Demo'), { recursive: true, force: true });

const app = await electron.launch({ executablePath: exePath, args: [], timeout: 120_000 });
try {
  const page = await app.firstWindow({ timeout: 90_000 });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(5000);
  console.log('DEMO PAGE URL:', page.url());
  console.log('DEMO PAGE TITLE:', await page.title());
  console.log('DEMO BODY:', (await page.locator('body').innerText()).slice(0, 4000));
  await page.getByText('BrightSmile Dental Clinic — Demo').first().waitFor({ state: 'visible', timeout: 90_000 });
  await page.getByText('Arif Hossain').first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.evaluate(() => { window.location.hash = '#/patients'; });
  await page.getByText('Nabila Sultana').first().waitFor({ state: 'visible', timeout: 30_000 });
  const mutation = await page.evaluate(async () => {
    try {
      await window.dentiva['patients/create']({ name: 'SHOULD NOT SAVE', gender: 'unknown' });
      return 'allowed';
    } catch (e) {
      return String(e?.message ?? e);
    }
  });
  if (!/demo|read.?only/i.test(mutation)) throw new Error(`Demo mutation was not blocked: ${mutation}`);
  console.log('SMOKE OK: demo opens directly, contains showcase data, and blocks patient creation.');
} finally {
  await app.close().catch(() => undefined);
}
