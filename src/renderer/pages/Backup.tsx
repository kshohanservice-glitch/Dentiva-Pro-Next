import { useState } from 'react';
import { api, useAsync } from '../api';
import { useApp } from '../state/app-context';
import { Badge, Button, Card, EmptyState, ErrorState, Modal, Spinner, TypedConfirmDialog, useToast } from '../components/primitives';
import { Field, Input, Select } from '../components/forms';
import { Icon } from '../components/shell';
import { formatBytes } from '../format';
import type { BackupRecordDTO } from '../../shared/ipc';

function RestoreDialog(props: { record: BackupRecordDTO | null; externalPath?: string | null; onClose: () => void; onDone: () => void }) {
  const [pending, setPending] = useState(false);
  const toast = useToast();
  const label = props.externalPath
    ? props.externalPath.split(/[\\/]/).pop()
    : props.record?.path.split(/[\\/]/).pop() ?? 'the selected .dpv backup file';

  const doRestore = async () => {
    setPending(true);
    try {
      const res = await api['backup/restore']({
        filePath: props.externalPath ?? props.record?.path,
        typedConfirm: 'RESTORE',
      });
      if ('cancelled' in res) return;
      toast.success('Restore complete', `Database restored from ${label}. A pre-restore safety backup was taken automatically.`);
      props.onDone();
      props.onClose();
    } catch (err) {
      toast.fromError(err, 'Restore failed');
    } finally {
      setPending(false);
    }
  };

  return (
    <TypedConfirmDialog
      title="Restore from backup?"
      phrase="RESTORE"
      confirmLabel="Restore now"
      pending={pending}
      onConfirm={doRestore}
      onCancel={props.onClose}
      body={
        <>
          Restoring <strong>{label}</strong> replaces <em>all current data</em> (patients, visits, invoices, settings) with the
          backup's contents. Attachments and the database are swapped atomically. A pre-restore backup is created first, and the
          app may restart to finish the restore. A corrupt or incompatible backup is rejected before anything is touched.
        </>
      }
    />
  );
}

export function BackupPage() {
  const { can, settings, refreshSettings } = useApp();
  const toast = useToast();
  const [running, setRunning] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<{ record: BackupRecordDTO | null; externalPath: string | null } | null>(null);
  const [autoOpen, setAutoOpen] = useState(false);
  const [autoFreq, setAutoFreq] = useState<7 | 15 | 30 | 0>(settings?.backup.autoFrequencyDays ?? 7);
  const [autoRetention, setAutoRetention] = useState(String(settings?.backup.retention ?? 10));
  const [autoPending, setAutoPending] = useState(false);

  const listQ = useAsync(() => api['backup/list'](), []);

  const runBackup = async () => {
    setRunning(true);
    try {
      const rec = await api['backup/run']();
      toast.success('Backup created', `${rec.path.split(/[\\/]/).pop()} · ${formatBytes(rec.sizeBytes)}`);
      listQ.reload();
    } catch (err) {
      toast.fromError(err, 'Backup failed');
    } finally {
      setRunning(false);
    }
  };

  const chooseAndRestore = () => {
    setRestoreTarget({ record: null, externalPath: null });
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Backup &amp; restore</h1>
          <p className="page-subtitle">
            Full <span className="mono">.dpv</span> backups (database + attachments) · integrity-checked · pre-restore safety copy
          </p>
        </div>
        <div className="page-actions">
          <Button variant="ghost" icon={Icon.refresh} onClick={listQ.reload}>Refresh</Button>
          <Button variant="secondary" onClick={() => setAutoOpen(true)}>Auto-backup settings</Button>
          <Button variant="primary" icon={Icon.backup} loading={running} onClick={() => void runBackup()}>
            Back up now
          </Button>
        </div>
      </div>

      <div className="grid stats-grid">
        <div className="stat-card">
          <div className="stat-label">Auto backup</div>
          <div className="stat-value" style={{ fontSize: 18 }}>
            {settings?.backup.autoFrequencyDays === 0 ? 'Off' : `Every ${settings?.backup.autoFrequencyDays ?? 7} days`}
          </div>
          <div className="stat-foot">retention {settings?.backup.retention ?? 10} copies</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Destination</div>
          <div className="stat-value" style={{ fontSize: 14 }} title={settings?.backup.destination ?? ''}>
            {settings?.backup.destination ? 'Custom folder' : 'Default (backups/)'}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Backups on file</div>
          <div className="stat-value">{listQ.data?.length ?? 0}</div>
        </div>
      </div>

      <div className="alert alert-info mb-4">
        <strong>Store copies off this computer.</strong>
        <span>
          A backup on the same disk as the database protects against mistakes, not disk failure. Export copies to a USB drive or
          external storage regularly. Never edit <span className="mono">.dpv</span> files.
        </span>
      </div>

      <Card
        title="Backup history"
        actions={
          <Button
            size="sm" variant="secondary"
            disabled={!can('backup.restore')}
            onClick={chooseAndRestore}
          >
            Restore from file…
          </Button>
        }
      >
        {listQ.loading && !listQ.data ? (
          <Spinner label="Loading backups…" />
        ) : listQ.error ? (
          <ErrorState error={listQ.error} onRetry={listQ.reload} />
        ) : (listQ.data ?? []).length === 0 ? (
          <EmptyState
            title="No backups yet"
            body="Create your first backup now — it takes a few seconds and protects everything."
            action={can('backup.create') ? <Button variant="primary" onClick={() => void runBackup()}>Back up now</Button> : undefined}
          />
        ) : (
          <div className="list">
            {listQ.data!.map((b) => (
              <div className="list-row" key={b.path + b.createdAt}>
                <span className="flex-1">
                  <strong className="mono">{b.path.split(/[\\/]/).pop()}</strong>
                  <div className="xsmall muted">
                    {new Date(b.createdAt).toLocaleString()} · {formatBytes(b.sizeBytes)} · schema v{b.schemaVersion}
                  </div>
                  {b.checksum && <div className="xsmall muted mono truncate" style={{ maxWidth: 520 }}>sha256: {b.checksum.slice(0, 24)}…</div>}
                </span>
                <Badge tone={b.status === 'ok' ? 'success' : 'danger'} title={b.error ?? undefined}>{b.status === 'ok' ? 'verified' : 'failed'}</Badge>
                <div className="row gap-2">
                  <Button
                    size="sm" variant="secondary"
                    disabled={!can('backup.restore')}
                    title={can('backup.restore') ? 'Restore this backup' : 'Requires backup.restore permission'}
                    onClick={() => setRestoreTarget({ record: b, externalPath: null })}
                  >
                    Restore
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="mt-4" title="Restore guidelines">
        <ol className="small" style={{ paddingLeft: 20, lineHeight: 1.8, color: 'var(--text-2)' }}>
          <li>Restore <strong>replaces all current data</strong> with the backup's contents.</li>
          <li>A pre-restore backup of the current state is taken automatically before any swap.</li>
          <li>Backups are validated (manifest, SHA-256, schema, integrity check) before anything is touched — corrupt files are rejected.</li>
          <li>Type <span className="mono">RESTORE</span> to confirm; the app may restart to complete the swap.</li>
        </ol>
      </Card>

      {restoreTarget && (
        <RestoreDialog
          record={restoreTarget.record}
          externalPath={restoreTarget.externalPath}
          onClose={() => setRestoreTarget(null)}
          onDone={listQ.reload}
        />
      )}

      {autoOpen && (
        <Modal
          title="Automatic backup"
          onClose={() => setAutoOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setAutoOpen(false)}>Cancel</Button>
              <Button
                variant="primary" loading={autoPending}
                onClick={async () => {
                  setAutoPending(true);
                  try {
                    const res = await api['backup/set-auto']({
                      frequencyDays: autoFreq,
                      retention: Math.max(1, Math.min(100, Number(autoRetention) || 10)),
                    });
                    if (res.cancelled) return;
                    await refreshSettings();
                    toast.success('Auto-backup updated', autoFreq === 0 ? 'Automatic backups disabled' : `Runs every ${autoFreq} days`);
                    setAutoOpen(false);
                  } catch (err) {
                    toast.fromError(err, 'Update failed');
                  } finally {
                    setAutoPending(false);
                  }
                }}
              >
                Save
              </Button>
            </>
          }
        >
          <div className="form-grid">
            <Field label="Frequency">
              {(id) => (
                <Select id={id} value={String(autoFreq)} onChange={(v) => setAutoFreq(Number(v) as 7 | 15 | 30 | 0)}
                  options={[
                    { value: '7', label: 'Every 7 days' },
                    { value: '15', label: 'Every 15 days' },
                    { value: '30', label: 'Every 30 days' },
                    { value: '0', label: 'Disabled' },
                  ]} />
              )}
            </Field>
            <Field label="Retention (copies kept)">
              {(id) => <Input id={id} type="number" min={1} max={100} value={autoRetention} onChange={setAutoRetention} />}
            </Field>
          </div>
          <p className="xsmall muted mt-4">
            Automatic backups run on app start and daily while running, writing to {settings?.backup.destination ?? 'the default backups folder'}.
          </p>
        </Modal>
      )}
    </div>
  );
}
