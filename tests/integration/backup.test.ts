import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import unzipper from 'unzipper';
import { cleanupEnv, createTestEnv, ownerCtx, sessionWith, type TestEnv } from '../helpers';
import { createBackupService, type DbHolder } from '../../src/main/services/backup';
import { openDatabase, fullIntegrityCheck, type DB } from '../../src/main/db/database';
import { createPatient, listPatients } from '../../src/main/services/patients';
import type { BackupRecordDTO } from '../../src/shared/ipc';
import type { Ctx } from '../../src/main/core/context';

let env: TestEnv;
let holder: DbHolder;
let notifications: { title: string }[];
let service: ReturnType<typeof createBackupService>;
let ctx: Ctx;
let dest: string;

beforeEach(() => {
  env = createTestEnv('backup');
  holder = {
    get: () => env.db,
    set: (db: DB) => {
      env.db = db;
    },
  };
  notifications = [];
  dest = path.join(env.dir, 'backup-dest');
  fs.mkdirSync(dest, { recursive: true });
  service = createBackupService({
    paths: env.paths,
    holder,
    appVersion: '1.0.0-test',
    notify: (n) => notifications.push({ title: n.title }),
  });
  ctx = ownerCtx(env);
});

afterEach(() => {
  cleanupEnv(env);
});

describe('backup engine', () => {
  it('creates a verified .dpv with manifest + database + attachments', async () => {
    createPatient(ctx, { name: 'Backup Patient', gender: 'male', ageYears: 30, phone: '01811111111' });
    fs.writeFileSync(path.join(env.paths.attachmentsDir, 'note.txt'), 'attachment payload');

    const rec = await service.runBackup(ctx, dest);
    expect(rec.status).toBe('ok');
    expect(rec.filename).toMatch(/^DentivaPro_Backup_.*\.dpv$/);
    expect(rec.sizeBytes).toBeGreaterThan(0);
    expect(rec.schemaVersion).toBe(1);
    expect(rec.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.existsSync(rec.path)).toBe(true);

    const zip = await unzipper.Open.file(rec.path);
    const paths = zip.files.map((f) => f.path.replace(/\\/g, '/'));
    expect(paths).toContain('manifest.json');
    expect(paths).toContain('database/dentiva.db');
    expect(paths).toContain('attachments/note.txt');

    const manifest = JSON.parse((await zip.files.find((f) => f.path === 'manifest.json')!.buffer()).toString('utf8'));
    expect(manifest.format).toBe('dentiva-backup');
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.dbSha256).toBe(rec.checksum);
    expect(manifest.counts.patients).toBe(1);
  });

  it('lists backups and requires backup.create permission', async () => {
    await service.runBackup(ctx, dest);
    const rows = service.listBackups(ctx);
    expect(rows.length).toBe(1);
    const limited = { ...ctx, session: sessionWith(['patients.view']) };
    expect(() => service.listBackups(limited as Ctx)).toThrow(/backup\.create/);
  });

  it('refuses an unwritable destination', async () => {
    // Destination must be a folder; a plain file at that path makes it unwritable.
    const blocked = path.join(env.dir, 'blocked-dest');
    fs.writeFileSync(blocked, 'i am a file, not a folder');
    await expect(service.runBackup(ctx, blocked)).rejects.toThrow(/writable|failed/i);
  });
});

describe('restore engine', () => {
  async function snapshotAndMutate(): Promise<BackupRecordDTO> {
    createPatient(ctx, { name: 'Pre Backup', gender: 'male', ageYears: 35, phone: '01844444444' });
    const rec = await service.runBackup(ctx, dest);
    expect(rec.status).toBe('ok');
    // mutate live data after the snapshot
    createPatient(ctx, { name: 'After Backup', gender: 'female', ageYears: 22, phone: '01822222222', forceCreate: true });
    expect(listPatients(ctx, {}).total).toBe(2);
    return rec;
  }

  it('restores the database, takes a pre-restore backup, and swaps atomically', async () => {
    const rec = await snapshotAndMutate();
    const before = fullIntegrityCheck(env.paths.dbFile);
    expect(before.ok).toBe(true);

    const res = await service.restoreBackup(ctx, rec.path, 'RESTORE');
    expect(res.ok).toBe(true);

    // The restore swapped the DB handle (holder.set) — rebind ctx to the live one.
    ctx = ownerCtx(env);
    const after = listPatients(ctx, {});
    expect(after.total).toBe(1);
    expect(after.items[0].name).toBe('Pre Backup');

    // pre-restore safety copy of the replaced state exists
    const preRestores = env.db
      .prepare(`SELECT kind, status FROM backups WHERE kind = 'pre_restore'`)
      .all<{ kind: string; status: string }>();
    expect(preRestores.length).toBeGreaterThanOrEqual(1);
    expect(preRestores[0].status).toBe('ok');

    expect(notifications.some((n) => /restor/i.test(n.title))).toBe(true);
  });

  it('rejects corrupt and foreign files without touching live data', async () => {
    const good = await snapshotAndMutate();

    // 1. not a zip at all
    const garbage = path.join(dest, 'garbage.dpv');
    fs.writeFileSync(garbage, 'this is definitely not a backup');
    await expect(service.restoreBackup(ctx, garbage, 'RESTORE')).rejects.toThrow(/readable|backup/i);

    // 2. zip without manifest
    const emptyZip = path.join(dest, 'empty.zip');
    const archiver = (await import('archiver')).default;
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(emptyZip);
      const a = archiver('zip');
      out.on('close', () => resolve());
      a.on('error', reject);
      a.pipe(out);
      a.append('hello', { name: 'unrelated.txt' });
      void a.finalize();
    });
    await expect(service.restoreBackup(ctx, emptyZip, 'RESTORE')).rejects.toThrow(/manifest/i);

    // 3. typed confirm required
    await expect(service.restoreBackup(ctx, good.path, 'restore')).rejects.toThrow(/RESTORE/);

    // 4. permission gate
    const limited = { ...ctx, session: sessionWith(['backup.create']) };
    await expect(service.restoreBackup(limited as Ctx, good.path, 'RESTORE')).rejects.toThrow(/backup\.restore/);

    // live data untouched by all the failures above
    expect(listPatients(ctx, {}).total).toBe(2);
    expect(fullIntegrityCheck(env.paths.dbFile).ok).toBe(true);
  });

  it('rejects a database entry that fails integrity after extraction', async () => {
    createPatient(ctx, { name: 'Integrity Patient', gender: 'male', ageYears: 41, phone: '01833333333' });
    const rec = await service.runBackup(ctx, dest);
    // craft a zip whose manifest is fine but database file is garbage
    const evil = path.join(dest, 'evil.dpv');
    const archiver = (await import('archiver')).default;
    const manifest = JSON.stringify({
      format: 'dentiva-backup', formatVersion: 1, appVersion: '1.0.0-test',
      schemaVersion: 1, createdAt: new Date().toISOString(), kind: 'manual',
      dbSha256: 'x', counts: { patients: 0, visits: 0, invoices: 0 },
    });
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(evil);
      const a = archiver('zip');
      out.on('close', () => resolve());
      a.on('error', reject);
      a.pipe(out);
      a.append(manifest, { name: 'manifest.json' });
      a.append(Buffer.from('not a sqlite database at all'), { name: 'database/dentiva.db' });
      void a.finalize();
    });
    await expect(service.restoreBackup(ctx, evil, 'RESTORE')).rejects.toThrow();
    expect(fullIntegrityCheck(env.paths.dbFile).ok).toBe(true);
    expect(listPatients(ctx, {}).total).toBe(1);
    expect(rec.status).toBe('ok');
    // db still the same file we started with
    const reopened = openDatabase(env.paths.dbFile, { runMigrations: false });
    expect(reopened.schemaVersion).toBe(1);
    reopened.db.close();
  });
});
