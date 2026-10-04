import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, useAsync } from '../api';
import { useApp } from '../state/app-context';
import { Badge, Button, Card, Kbd, Modal, Spinner, Tabs, useToast } from '../components/primitives';
import { Field, Input, Select, Textarea } from '../components/forms';

type SetTab = 'clinic' | 'security' | 'appearance' | 'notifications' | 'billing' | 'prescription' | 'print' | 'data' | 'shortcuts';

export function SettingsPage() {
  const { settings, refreshSettings, refresh, user, logout } = useApp();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<SetTab>((params.get('tab') as SetTab) ?? 'clinic');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const [form, setForm] = useState<any>(null);

  useEffect(() => {
    if (settings && !form) {
      setForm(JSON.parse(JSON.stringify(settings)));
    }
  }, [settings, form]);

  useEffect(() => {
    if (params.get('tab')) {
      setTab(params.get('tab') as SetTab);
      params.delete('tab');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  if (!settings || !form) return <Spinner label="Loading settings…" />;

  const set = (path: string[], value: unknown): void => {
    setForm((f: any) => {
      const next = JSON.parse(JSON.stringify(f));
      let node = next;
      for (let i = 0; i < path.length - 1; i++) node = node[path[i]];
      node[path[path.length - 1]] = value;
      return next;
    });
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api['settings/save'](form);
      await refreshSettings();
      setDirty(false);
      toast.success('Settings saved');
    } catch (err) {
      toast.fromError(err, 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const tabs: { key: SetTab; label: string }[] = [
    { key: 'clinic', label: 'Clinic' },
    { key: 'security', label: 'Security' },
    { key: 'appearance', label: 'Appearance' },
    { key: 'notifications', label: 'Notifications' },
    { key: 'billing', label: 'Billing' },
    { key: 'prescription', label: 'Prescription' },
    { key: 'print', label: 'Printing' },
    { key: 'data', label: 'Data' },
    { key: 'shortcuts', label: 'Shortcuts' },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Stored locally · takes effect immediately across the app</p>
        </div>
        <div className="page-actions">
          {dirty && <Badge tone="warning">unsaved changes</Badge>}
          <Button variant="primary" loading={saving} disabled={!dirty} onClick={() => void save()}>Save changes</Button>
        </div>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      <div className="mt-4 col gap-4">
        {tab === 'clinic' && (
          <Card title="Clinic information">
            <div className="form-grid">
              <Field label="Clinic name" className="span-2">
                {() => <Input value={form.clinic.clinicName} onChange={(v) => set(['clinic', 'clinicName'], v)} />}
              </Field>
              <Field label="Bengali name">{() => <Input value={form.clinic.clinicNameBn ?? ''} onChange={(v) => set(['clinic', 'clinicNameBn'], v)} />}</Field>
              <Field label="Phone">{() => <Input value={form.clinic.phone ?? ''} onChange={(v) => set(['clinic', 'phone'], v)} />}</Field>
              <Field label="Email">{() => <Input value={form.clinic.email ?? ''} onChange={(v) => set(['clinic', 'email'], v)} />}</Field>
              <Field label="Website">{() => <Input value={form.clinic.website ?? ''} onChange={(v) => set(['clinic', 'website'], v)} />}</Field>
              <Field label="Address" className="span-2">{() => <Textarea rows={2} value={form.clinic.address ?? ''} onChange={(v) => set(['clinic', 'address'], v)} />}</Field>
              <Field label="Operating hours">{() => <Input value={form.clinic.operatingHours ?? ''} onChange={(v) => set(['clinic', 'operatingHours'], v)} placeholder="10:00 – 20:00" />}</Field>
              <Field label="Visiting days">{() => <Input value={form.clinic.visitingDays ?? ''} onChange={(v) => set(['clinic', 'visitingDays'], v)} placeholder="Sat – Thu" />}</Field>
              <Field label="Logo" hint="Shown on printed documents">
                {() => (
                  <div className="row gap-2">
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        try {
                          const res = await api['settings/upload-logo']();
                          if (typeof res !== 'string') return;
                          set(['clinic', 'logoPath'], res);
                          toast.success('Logo updated');
                        } catch (err) {
                          toast.fromError(err, 'Logo upload failed');
                        }
                      }}
                    >Upload logo…</Button>
                    {form.clinic.logoPath && (
                      <Button variant="ghost" onClick={() => set(['clinic', 'logoPath'], null)}>Remove</Button>
                    )}
                  </div>
                )}
              </Field>
            </div>
          </Card>
        )}

        {tab === 'security' && <SecurityTab form={form} set={set} user={user} onLogout={logout} refresh={refresh} />}

        {tab === 'appearance' && (
          <Card title="Appearance">
            <div className="form-grid">
              <Field label="Theme">
                {(id) => (
                  <Select id={id} value={form.appearance.theme} onChange={(v) => set(['appearance', 'theme'], v)}
                    options={[
                      { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'Follow system' },
                    ]} />
                )}
              </Field>
              <Field label="Density">
                {(id) => (
                  <Select id={id} value={form.appearance.density} onChange={(v) => set(['appearance', 'density'], v)}
                    options={[
                      { value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' },
                    ]} />
                )}
              </Field>
              <Field label="Animations">
                {() => (
                  <label className="checkbox">
                    <input type="checkbox" checked={form.appearance.animations} onChange={(e) => set(['appearance', 'animations'], e.target.checked)} />
                    <span>Enable interface animations</span>
                  </label>
                )}
              </Field>
              <Field label="Sidebar">
                {() => (
                  <label className="checkbox">
                    <input type="checkbox" checked={form.appearance.sidebarCollapsed} onChange={(e) => set(['appearance', 'sidebarCollapsed'], e.target.checked)} />
                    <span>Start collapsed</span>
                  </label>
                )}
              </Field>
            </div>
          </Card>
        )}

        {tab === 'notifications' && (
          <Card title="Notification preferences">
            <div className="col">
              {([
                ['appointments', 'Appointment reminders'],
                ['lowStock', 'Low stock & expiry alerts'],
                ['dues', 'Payment due reminders'],
                ['backup', 'Backup due / failed alerts'],
              ] as const).map(([key, label]) => (
                <label className="checkbox" key={key}>
                  <input
                    type="checkbox"
                    checked={form.notifications[key]}
                    onChange={(e) => set(['notifications', key], e.target.checked)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <p className="xsmall muted mt-4">Notifications are generated locally — nothing is sent over the internet.</p>
          </Card>
        )}

        {tab === 'billing' && (
          <>
            <Card title="Invoice numbering">
              <div className="form-grid">
                <Field label="Next invoice number" hint="Format INV-YYYY-00001 · auto-advances after each invoice">
                  {(id) => <Input id={id} value={form.invoice.nextNumber} onChange={(v) => set(['invoice', 'nextNumber'], v)} />}
                </Field>
                <Field label="Invoice footer note">
                  {(id) => <Input id={id} value={form.invoice.footerNote ?? ''} onChange={(v) => set(['invoice', 'footerNote'], v)} />}
                </Field>
              </div>
            </Card>
            <Card title="Accepted payment methods">
              <div className="row wrap gap-2">
                {['cash', 'bkash', 'nagad', 'rocket', 'upay', 'card', 'bank', 'other'].map((m) => {
                  const on = form.paymentMethods.includes(m);
                  return (
                    <button
                      key={m}
                      type="button"
                      className={`btn btn-sm ${on ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => set(['paymentMethods'], on ? form.paymentMethods.filter((x: string) => x !== m) : [...form.paymentMethods, m])}
                    >
                      {m.toUpperCase()}
                    </button>
                  );
                })}
              </div>
            </Card>
          </>
        )}

        {tab === 'prescription' && (
          <Card title="Prescription defaults">
            <div className="form-grid">
              <Field label="Visiting hours line">{(id) => <Input id={id} value={form.prescription.visitingHours ?? ''} onChange={(v) => set(['prescription', 'visitingHours'], v)} />}</Field>
              <Field label="Footer message">{(id) => <Input id={id} value={form.prescription.footerMessage ?? ''} onChange={(v) => set(['prescription', 'footerMessage'], v)} />}</Field>
              <Field label="Signature area reserved" >
                {() => (
                  <label className="checkbox">
                    <input type="checkbox" checked={form.prescription.signatureReserved} onChange={(e) => set(['prescription', 'signatureReserved'], e.target.checked)} />
                    <span>Leave blank space for signature &amp; seal</span>
                  </label>
                )}
              </Field>
            </div>
            <div className="divider" />
            <h4 className="small">Form labels</h4>
            <div className="form-grid mt-2">
              {(Object.keys(form.prescription.labels) as string[]).map((k) => (
                <Field key={k} label={k.toUpperCase()}>
                  {(id) => <Input id={id} value={form.prescription.labels[k]} onChange={(v) => set(['prescription', 'labels', k], v)} />}
                </Field>
              ))}
            </div>
          </Card>
        )}

        {tab === 'print' && <PrintTab form={form} set={set} />}

        {tab === 'data' && <DataTab />}

        {tab === 'shortcuts' && (
          <Card title="Keyboard shortcuts">
            {[
              ['Global search', <><Kbd>Ctrl</Kbd> <Kbd>K</Kbd></>],
              ['Lock application', <><Kbd>Ctrl</Kbd> <Kbd>L</Kbd></>],
              ['New patient', <><Kbd>Ctrl</Kbd> <Kbd>N</Kbd></>],
              ['New appointment', <><Kbd>Ctrl</Kbd> <Kbd>Shift</Kbd> <Kbd>N</Kbd></>],
              ['New visit', <><Kbd>Ctrl</Kbd> <Kbd>Shift</Kbd> <Kbd>V</Kbd></>],
              ['New prescription', <><Kbd>Ctrl</Kbd> <Kbd>Shift</Kbd> <Kbd>P</Kbd></>],
              ['New invoice', <><Kbd>Ctrl</Kbd> <Kbd>Shift</Kbd> <Kbd>I</Kbd></>],
              ['Jump to modules 1–9', <><Kbd>Alt</Kbd> <Kbd>1…9</Kbd></>],
              ['Close dialog', <Kbd>Esc</Kbd>],
              ['Navigate search results', <><Kbd>↑</Kbd> <Kbd>↓</Kbd> <Kbd>Enter</Kbd></>],
            ].map(([label, keys], i) => (
              <div className="shortcut-row" key={i}>
                <span className="small">{label as string}</span>
                <span>{keys as React.ReactNode}</span>
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}

function SecurityTab(props: { form: any; set: (path: string[], v: unknown) => void; user: any; onLogout: () => Promise<void>; refresh: () => Promise<void> }) {
  const toast = useToast();
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [pwPending, setPwPending] = useState(false);
  const { form, set } = props;

  return (
    <>
      <Card title="Auto-lock">
        <div className="form-grid">
          <Field label="Lock after inactivity" hint="Locks the whole app; requires password to resume.">
            {(id) => (
              <Select id={id} value={String(form.security.autoLockMinutes ?? '')} onChange={(v) => set(['security', 'autoLockMinutes'], v ? Number(v) : null)}
                options={[
                  { value: '', label: 'Never (not recommended)' },
                  { value: '5', label: '5 minutes' }, { value: '10', label: '10 minutes' },
                  { value: '15', label: '15 minutes' }, { value: '30', label: '30 minutes' }, { value: '60', label: '1 hour' },
                  { value: '60', label: '1 hour' },
                ]} />
            )}
          </Field>
          <Field label="Max failed logins" hint="Account locks temporarily after this many failures.">
            {(id) => <Input id={id} type="number" min={3} max={20} value={form.security.maxFailedLogins} onChange={(v) => set(['security', 'maxFailedLogins'], Number(v) || 5)} />}
          </Field>
          <Field label="Minimum password length">
            {(id) => <Input id={id} type="number" min={8} max={64} value={form.security.minPasswordLength} onChange={(v) => set(['security', 'minPasswordLength'], Number(v) || 8)} />}
          </Field>
        </div>
      </Card>

      <Card title="Change your password">
        <div className="form-grid">
          <Field label="Current password" required>
            {(id) => <Input id={id} type="password" value={oldPw} onChange={setOldPw} autoComplete="current-password" />}
          </Field>
          <Field label="New password" required hint={`≥${Math.max(8, Number(form.security.minPasswordLength) || 8)} characters with letters and numbers`}>
            {(id) => <Input id={id} type="password" value={newPw} onChange={setNewPw} autoComplete="new-password" invalid={!!newPw && newPw.length < Math.max(8, Number(form.security.minPasswordLength) || 8)} />}
          </Field>
          <Field label="Confirm new password" required>
            {(id) => <Input id={id} type="password" value={newPw2} onChange={setNewPw2} autoComplete="new-password" invalid={!!newPw2 && newPw !== newPw2} />}
          </Field>
        </div>
        <div className="mt-4">
          <Button
            variant="primary"
            loading={pwPending}
            disabled={!oldPw || newPw.length < Math.max(8, Number(form.security.minPasswordLength) || 8) || newPw !== newPw2}
            onClick={async () => {
              setPwPending(true);
              try {
                await api['auth/change-password']({ oldPassword: oldPw, newPassword: newPw });
                toast.success('Password changed', 'Use your new password the next time you sign in.');
                setOldPw(''); setNewPw(''); setNewPw2('');
              } catch (err) {
                toast.fromError(err, 'Change failed');
              } finally {
                setPwPending(false);
              }
            }}
          >
            Change password
          </Button>
        </div>
      </Card>

      <Card title="Session">
        <p className="small muted">
          Signed in as <strong>{props.user?.displayName}</strong> ({props.user?.username}) with role{' '}
          <Badge tone="brand">{props.user?.roleName}</Badge> · {props.user?.permissions.length} permissions.
        </p>
        <div className="row gap-2 mt-4">
          <Button variant="secondary" onClick={() => void props.onLogout()}>Sign out</Button>
        </div>
      </Card>
    </>
  );
}

const PAPER_DEFAULT_MM: Record<string, [number, number]> = {
  a4: [210, 297],
  a5: [148, 210],
  thermal: [80, 200],
  custom: [210, 297],
};

function PrintTab(props: { form: any; set: (path: string[], v: unknown) => void }) {
  const toast = useToast();
  const [printers, setPrinters] = useState<{ name: string; displayName: string; description: string }[]>([]);
  const profiles: any[] = props.form.printProfiles ?? [];

  useEffect(() => {
    void api['printers/list']().then(setPrinters).catch(() => setPrinters([]));
  }, []);

  const updateProfile = (id: string, patch: Record<string, unknown>) => {
    props.set(
      ['printProfiles'],
      profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );
  };

  return (
    <>
      <Card title="Detected printers">
        {printers.length === 0 ? (
          <p className="small muted">No printers detected by the operating system yet.</p>
        ) : (
          <div className="list">
            {printers.map((p) => (
              <div className="list-row" key={p.name}>
                <span className="flex-1"><strong>{p.displayName}</strong><div className="xsmall muted mono">{p.name}{p.description ? ` — ${p.description}` : ''}</div></span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Print profiles" actions={<span className="xsmall muted">{profiles.length} profiles</span>}>
        <div className="table-wrap">
          <table className="table compact">
            <thead>
              <tr><th>Name</th><th>Document</th><th>Paper</th><th>Size</th><th>Orientation</th><th>Scale (%)</th><th>Copies</th></tr>
            </thead>
            <tbody>
              {profiles.map((p) => {
                const [defW, defH] = PAPER_DEFAULT_MM[String(p.paperSize).toLowerCase()] ?? [210, 297];
                const w = p.widthMm ?? defW;
                const h = p.heightMm ?? defH;
                const scalePct = Math.round(p.scale && p.scale <= 2 ? p.scale * 100 : (p.scale ?? 100));
                return (
                  <tr key={p.id}>
                    <td><strong>{p.name}</strong></td>
                    <td>{p.documentType ?? 'general'}</td>
                    <td>{p.paperSize}</td>
                    <td className="mono">{w}×{h}mm</td>
                    <td>
                      <select
                        className="select"
                        style={{ height: 30, fontSize: 12 }}
                        value={p.orientation}
                        onChange={(e) => updateProfile(p.id, { orientation: e.target.value })}
                      >
                        <option value="portrait">Portrait</option>
                        <option value="landscape">Landscape</option>
                      </select>
                    </td>
                    <td>
                      <input
                        className="input"
                        style={{ width: 72, height: 30, fontSize: 12 }}
                        type="number"
                        min={50}
                        max={200}
                        value={scalePct}
                        onChange={(e) => updateProfile(p.id, { scale: Math.min(200, Math.max(50, Number(e.target.value) || 100)) })}
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        style={{ width: 64, height: 30, fontSize: 12 }}
                        type="number"
                        min={1}
                        max={10}
                        value={p.copies ?? 1}
                        onChange={(e) => updateProfile(p.id, { copies: Math.min(10, Math.max(1, Number(e.target.value) || 1)) })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="xsmall muted mt-4">
          Profiles control paper size, margins and scaling for prescriptions, invoices and reports. You can also switch profiles inside the print preview window.
        </p>
        <div className="mt-4">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => { void api['printers/list']().then(setPrinters); toast.success('Printer list refreshed'); }}
          >Refresh printers</Button>
        </div>
      </Card>
    </>
  );
}

function DataTab() {
  const { can } = useApp();
  const toast = useToast();
  const [resetOpen, setResetOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const sysQ = useAsync(() => api['system/info'](), []);

  return (
    <>
      <Card title="Storage">
        <div className="kv-list">
          <div className="kv"><span className="k">Data folder</span><span className="v mono" style={{ fontSize: 12 }}>{sysQ.data?.dataDir ?? '—'}</span></div>
          <div className="kv"><span className="k">Schema version</span><span className="v num">{sysQ.data?.schemaVersion ?? '—'}</span></div>
          <div className="kv"><span className="k">App version</span><span className="v">{sysQ.data?.version ?? '—'}</span></div>
          <div className="kv"><span className="k">Currency</span><span className="v">BDT ৳ (integer paisa storage)</span></div>
        </div>
        <p className="xsmall muted mt-4">
          Everything lives in this folder: <span className="mono">data/dentiva.db</span>, <span className="mono">attachments/</span>,{' '}
          <span className="mono">backups/</span>, <span className="mono">logs/</span>. Copy the whole folder for a manual full export.
        </p>
      </Card>

      <div className="danger-zone">
        <h3 style={{ marginBottom: 6 }}>Danger zone</h3>
        <p className="small" style={{ color: 'var(--text-2)' }}>
          Reset business data wipes <strong>all</strong> patients, visits, billing, inventory, accounting and settings — keeping only
          users, roles and the audit log. This cannot be undone. Take a backup first.
        </p>
        <div className="row gap-2 mt-4">
          <Button variant="danger" disabled={!can('data.delete')} onClick={() => setResetOpen(true)}>
            Reset business data…
          </Button>
          {!can('data.delete') && <span className="xsmall muted">Requires the data.delete permission.</span>}
        </div>
      </div>

      {resetOpen && (
        <Modal
          title="Reset business data"
          onClose={() => setResetOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setResetOpen(false)}>Cancel</Button>
              <Button
                variant="danger"
                disabled={typed !== 'RESET' || !password}
                loading={pending}
                onClick={async () => {
                  setPending(true);
                  try {
                    await api['settings/reset-business']({ typedConfirm: typed, password });
                    toast.success('Business data reset', 'The app will refresh.');
                    setResetOpen(false);
                    setTimeout(() => window.location.reload(), 800);
                  } catch (err) {
                    toast.fromError(err, 'Reset failed');
                  } finally {
                    setPending(false);
                  }
                }}
              >
                Reset everything
              </Button>
            </>
          }
        >
          <div className="col">
            <div className="alert alert-danger">
              <strong>This permanently erases clinic data.</strong>
              <span>Users, roles and audit history remain. Backups you already made are untouched.</span>
            </div>
            <Field label="Your password" required>
              {(id) => <Input id={id} type="password" value={password} onChange={setPassword} autoComplete="current-password" />}
            </Field>
            <Field label="Type RESET to confirm" required>
              {(id) => <Input id={id} value={typed} onChange={setTyped} autoComplete="off" spellCheck={false} placeholder="RESET" />}
            </Field>
          </div>
        </Modal>
      )}
    </>
  );
}
