# Dentiva Pro — Backup & Restore

## Backup container

File: `DentivaPro_Backup_YYYY-MM-DD_HH-mm-ss.dpv` (`.dpv` = ZIP) containing:

```
manifest.json   # format: "dentiva-backup", formatVersion, appVersion, schemaVersion,
                # createdAt, kind (manual|auto|pre_restore), dbSha256, counts{...}
database/dentiva.db         # consistent snapshot via better-sqlite3 db.backup() (online, safe)
attachments/                 # copy of application-managed attachment tree
```

- Timestamped names; **never overwrite** an existing backup (suffix `-2`, `-3`… if collision).
- Success recorded only after: snapshot finished + zip closed + checksum computed.
  Result written to `backups` table and notification center (failure → red alert, never silent).

## Manual backup

Settings → Backup → choose destination folder (native dialog) → progress → result dialog
showing path, size, elapsed; failure shows the real OS error.

## Automatic backup

Setting: frequency 7 / 15 / 30 days (or off), destination folder, retention count
(default keep last 10). Checked at app startup and daily: if due → runs in background,
records success/failure; failures raise persistent notification.

## Restore

1. Select `.dpv` file.
2. **Validate**: zip readable → manifest present & formatVersion supported → schemaVersion
   ≤ current (forward compat check) → extract to temp → db file present →
   `PRAGMA integrity_check` on extracted DB (fail ⇒ abort, current DB untouched) →
   `dbSha256` matches manifest.
3. **Pre-restore backup** of the *current* state (kind=pre_restore) — mandatory; if it
   fails ⇒ abort restore.
4. Confirmation dialog with typed confirmation (`RESTORE`) + data-loss warning.
5. Close DB → atomically swap main DB file → copy attachments → run pending migrations →
   reopen → integrity re-check.
6. On any failure: **rollback** previous DB from the pre-restore copy; report actual state.
7. App prompts restart-safe reload; audit records start/finish/failure of restore.

Multiple backups: restore applies one selected snapshot (full replace); the pre-restore
copy allows undoing the restore itself.

## Failure matrix (tested)

| Scenario | Behavior |
|---|---|
| Destination missing / read-only / full / locked | Error surfaced; no "success" claimed; partial files cleaned |
| Backup interrupted | Temp file discarded; DB untouched; failure recorded |
| Corrupt/incomplete/wrong zip | Validation aborts before any swap |
| Corrupt DB inside backup | integrity_check fails ⇒ abort, original intact |
| Interrupted restore | Rollback from pre-restore backup; explicit report |
| Schema too new | Refused with message |
