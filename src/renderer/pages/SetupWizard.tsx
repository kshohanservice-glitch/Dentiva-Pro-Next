import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../state/app-context';
import { Button, useToast } from '../components/primitives';
import { Field, Input, Textarea } from '../components/forms';

type Step = 'activate' | 'clinic' | 'dentists' | 'admin' | 'prefs';

const STEP_LABELS: { key: Step; label: string }[] = [
  { key: 'activate', label: 'Activation' },
  { key: 'clinic', label: 'Clinic' },
  { key: 'dentists', label: 'Dentists' },
  { key: 'admin', label: 'Administrator' },
  { key: 'prefs', label: 'Preferences' },
];

interface DentistDraft { name: string; qualifications: string; designations: string; phone: string; email: string; regNo: string }

export function SetupWizard() {
  const { activation, refresh, completeSetup } = useApp();
  const toast = useToast();
  const navigate = useNavigate();

  const [activated, setActivated] = useState(!!activation?.activated);
  const [step, setStep] = useState<Step>(activation?.activated ? 'clinic' : 'activate');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Activation
  const [code, setCode] = useState('');

  // Clinic
  const [clinicName, setClinicName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  // Dentists
  const [dentists, setDentists] = useState<DentistDraft[]>([
    { name: '', qualifications: '', designations: '', phone: '', email: '', regNo: '' },
  ]);

  // Admin
  const [adminUser, setAdminUser] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminPass, setAdminPass] = useState('');
  const [adminPass2, setAdminPass2] = useState('');

  // Prefs
  const [hours, setHours] = useState('10:00 – 20:00');
  const [autoLock, setAutoLock] = useState('10');

  const idx = STEP_LABELS.findIndex((s) => s.key === step);

  const goNext = (): void => {
    setError(null);
    if (step === 'activate') return;
    if (step === 'clinic') {
      if (clinicName.trim().length < 2) return setError('Enter the clinic or dental care name.');
      if (!phone.trim() && !address.trim()) return setError('Provide at least a phone number or address.');
      setStep('dentists');
    } else if (step === 'dentists') {
      const named = dentists.filter((d) => d.name.trim());
      if (named.length === 0) return setError('At least one dentist is required.');
      setStep('admin');
    } else if (step === 'admin') {
      if (!/^[A-Za-z0-9._-]{3,40}$/.test(adminUser)) return setError('Username: 3–40 characters (letters, numbers, dot, dash, underscore).');
      if (adminPass.length < 8 || !/[A-Za-z]/.test(adminPass) || !/\d/.test(adminPass)) return setError('Password must be at least 8 characters and include letters and numbers.');
      if (adminPass !== adminPass2) return setError('Password confirmation does not match.');
      setStep('prefs');
    } else if (step === 'prefs') {
      void submit();
    }
  };

  const goBack = (): void => {
    setError(null);
    const prev = STEP_LABELS[idx - 1]?.key;
    if (prev === 'activate' && activated) return;
    if (prev) setStep(prev);
  };

  const doActivate = async () => {
    if (!code.trim()) return setError('Enter your activation code.');
    setPending(true);
    setError(null);
    try {
      const res = await api['activation/verify'](code.trim());
      if (res.activated) {
        setActivated(true);
        setStep('clinic');
        toast.success('Activation complete', 'Dentiva Pro is activated on this computer.');
      } else {
        setError('Invalid activation code. Check the code and try again.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Activation failed.');
    } finally {
      setPending(false);
    }
  };

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      await api['setup/complete']({
        clinic: { clinicName: clinicName.trim(), address: address.trim() || null, phone: phone.trim() || null, email: email.trim() || null },
        dentists: dentists
          .filter((d) => d.name.trim())
          .map((d) => ({
            name: d.name.trim(),
            qualifications: d.qualifications.trim() || null,
            designations: d.designations.trim() || null,
            phone: d.phone.trim() || null,
            email: d.email.trim() || null,
            regNo: d.regNo.trim() || null,
          })),
        admin: {
          username: adminUser.trim(),
          password: adminPass,
          passwordConfirm: adminPass2,
          displayName: adminName.trim() || adminUser.trim(),
        },
        preferences: { operatingHours: hours, autoLockMinutes: Number(autoLock) },
      });
      await refresh();
      await completeSetup();
      toast.success('Setup complete', 'Sign in with your administrator account.');
      navigate('/login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed.');
    } finally {
      setPending(false);
    }
  };

  const setDentist = (i: number, patch: Partial<DentistDraft>): void => {
    setDentists((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  };

  return (
    <div className="setup-screen">
      <div className="setup-wrap">
        <div className="auth-brand" style={{ marginBottom: 8 }}>
          <div className="brand-mark" style={{ width: 52, height: 52, fontSize: 24, borderRadius: 16 }}>D</div>
          <div>
            <div className="auth-title">Welcome to Dentiva Pro</div>
            <div className="auth-sub">One-time offline setup — takes about two minutes.</div>
          </div>
        </div>

        <div className="setup-steps">
          {STEP_LABELS.map((s, i) => (
            <div key={s.key} className={`setup-step ${step === s.key ? 'active' : ''} ${i < idx || (s.key === 'activate' && activated) ? 'done' : ''}`}>
              <span className="n">{i + 1}</span>
              <span>{s.label}</span>
            </div>
          ))}
        </div>

        <div className="card card-pad">
          {error && <div className="auth-error mb-4" role="alert">{error}</div>}

          {step === 'activate' && (
            <div className="col">
              <h3>Activate your license</h3>
              <p className="small muted">
                Enter the activation code provided with your Dentiva Pro license. Activation runs entirely offline —
                no internet connection is required or used.
              </p>
              <Field label="Activation code" required hint="Found on your license card or purchase receipt.">
                {(id) => (
                  <Input
                    id={id}
                    value={code}
                    onChange={setCode}
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="Enter activation code"
                    onKeyDown={(e) => { if (e.key === 'Enter') void doActivate(); }}
                  />
                )}
              </Field>
              <Button variant="primary" loading={pending} onClick={() => void doActivate()}>
                Activate
              </Button>
            </div>
          )}

          {step === 'clinic' && (
            <div className="col">
              <h3>Clinic information</h3>
              <p className="small muted">This appears on prescriptions, invoices and reports.</p>
              <div className="form-grid">
                <Field label="Clinic / dental care name" required className="span-2">
                  {(id) => <Input id={id} value={clinicName} onChange={setClinicName} placeholder="e.g. Smile Dental Care" autoFocus />}
                </Field>
                <Field label="Phone">
                  {(id) => <Input id={id} value={phone} onChange={setPhone} placeholder="01XXXXXXXXX" />}
                </Field>
                <Field label="Email">
                  {(id) => <Input id={id} value={email} onChange={setEmail} type="email" placeholder="clinic@example.com" />}
                </Field>
                <Field label="Address" className="span-2">
                  {(id) => <Textarea id={id} value={address} onChange={setAddress} rows={2} placeholder="Street, area, city" />}
                </Field>
              </div>
            </div>
          )}

          {step === 'dentists' && (
            <div className="col">
              <h3>Dentist profiles</h3>
              <p className="small muted">Add the dentists who practised at this clinic. You can add more later in Staff.</p>
              {dentists.map((d, i) => (
                <div className="form-section" key={i}>
                  <div className="row between mb-4">
                    <h4>Dentist {i + 1}</h4>
                    {dentists.length > 1 && (
                      <Button size="sm" variant="ghost" onClick={() => setDentists((ds) => ds.filter((_, j) => j !== i))}>Remove</Button>
                    )}
                  </div>
                  <div className="form-grid">
                    <Field label="Full name" required>
                      {(id) => <Input id={id} value={d.name} onChange={(v) => setDentist(i, { name: v })} placeholder="Dr. …" />}
                    </Field>
                    <Field label="Qualifications">
                      {(id) => <Input id={id} value={d.qualifications} onChange={(v) => setDentist(i, { qualifications: v })} placeholder="BDS, FCPS…" />}
                    </Field>
                    <Field label="Designation(s)">
                      {(id) => <Input id={id} value={d.designations} onChange={(v) => setDentist(i, { designations: v })} placeholder="Senior Consultant" />}
                    </Field>
                    <Field label="Phone">
                      {(id) => <Input id={id} value={d.phone} onChange={(v) => setDentist(i, { phone: v })} />}
                    </Field>
                    <Field label="Email">
                      {(id) => <Input id={id} value={d.email} onChange={(v) => setDentist(i, { email: v })} />}
                    </Field>
                    <Field label="Registration no.">
                      {(id) => <Input id={id} value={d.regNo} onChange={(v) => setDentist(i, { regNo: v })} />}
                    </Field>
                  </div>
                </div>
              ))}
              <div>
                <Button variant="secondary" icon="＋" onClick={() => setDentists((ds) => [...ds, { name: '', qualifications: '', designations: '', phone: '', email: '', regNo: '' }])}>
                  Add another dentist
                </Button>
              </div>
            </div>
          )}

          {step === 'admin' && (
            <div className="col">
              <h3>Administrator account</h3>
              <p className="small muted">This account owns the clinic data and manages users, permissions and backups.</p>
              <div className="form-grid">
                <Field label="Username" required hint="Used to sign in.">
                  {(id) => <Input id={id} value={adminUser} onChange={setAdminUser} autoComplete="username" placeholder="admin" />}
                </Field>
                <Field label="Display name">
                  {(id) => <Input id={id} value={adminName} onChange={setAdminName} placeholder="Full name" />}
                </Field>
                <Field label="Password" required>
                  {(id) => <Input id={id} value={adminPass} onChange={setAdminPass} type="password" autoComplete="new-password" />}
                </Field>
                <Field label="Confirm password" required>
                  {(id) => <Input id={id} value={adminPass2} onChange={setAdminPass2} type="password" autoComplete="new-password" />}
                </Field>
              </div>
            </div>
          )}

          {step === 'prefs' && (
            <div className="col">
              <h3>Clinic preferences</h3>
              <div className="form-grid">
                <Field label="Operating hours">
                  {(id) => <Input id={id} value={hours} onChange={setHours} placeholder="10:00 – 20:00" />}
                </Field>
                <Field label="Auto-lock" hint="Locks the app after inactivity.">
                  {(id) => (
                    <select id={id} className="select" value={autoLock} onChange={(e) => setAutoLock(e.target.value)}>
                      <option value="5">5 minutes</option>
                      <option value="10">10 minutes</option>
                      <option value="15">15 minutes</option>
                      <option value="30">30 minutes</option>
                    </select>
                  )}
                </Field>
              </div>
              <div className="form-section" style={{ background: 'var(--brand-50)', borderColor: 'var(--brand-100)' }}>
                <h4 style={{ marginBottom: 8 }}>Review</h4>
                <div className="kv-list">
                  <div className="kv"><span className="k">Clinic</span><span className="v">{clinicName}</span></div>
                  <div className="kv"><span className="k">Phone</span><span className="v">{phone || '—'}</span></div>
                  <div className="kv"><span className="k">Dentists</span><span className="v">{dentists.filter((d) => d.name.trim()).map((d) => d.name).join(', ')}</span></div>
                  <div className="kv"><span className="k">Admin</span><span className="v">{adminUser}</span></div>
                </div>
              </div>
            </div>
          )}

          <div className="row between mt-4">
            <div>
              {step !== 'activate' && idx > (activated ? 1 : 0) && (
                <Button variant="secondary" onClick={goBack} disabled={pending}>Back</Button>
              )}
            </div>
            <div className="row gap-2">
              {step !== 'prefs' && step !== 'activate' && (
                <Button variant="primary" onClick={goNext}>Continue</Button>
              )}
              {step === 'prefs' && (
                <Button variant="primary" loading={pending} onClick={() => void submit()}>Finish setup</Button>
              )}
            </div>
          </div>
        </div>

        <div className="center mt-4 xsmall muted" style={{ textAlign: 'center' }}>
          Dentiva Pro · offline dental clinic management · your data stays on this computer
        </div>
      </div>
    </div>
  );
}
