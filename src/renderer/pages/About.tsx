import React from 'react';
import { api, useAsync } from '../api';
import { useApp } from '../state/app-context';
import { Badge, Card, Spinner } from '../components/primitives';
import { Kbd } from '../components/primitives';

export function AboutPage() {
  const { system, activation, user, settings } = useApp();
  const { data: printers } = useAsync(() => api['printers/list'](), []);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">About Dentiva Pro</h1>
          <p className="page-subtitle">Offline dental clinic management for Bangladesh</p>
        </div>
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: '1.2fr 1fr', alignItems: 'start' }}>
        <Card>
          <div className="row gap-3" style={{ alignItems: 'flex-start' }}>
            <div className="brand-mark" style={{ width: 64, height: 64, fontSize: 30, borderRadius: 18 }}>D</div>
            <div>
              <h2 style={{ margin: '0 0 4px' }}>Dentiva Pro</h2>
              <div className="small muted">Version {system?.version ?? '—'} · database schema v{system?.schemaVersion ?? '—'}</div>
              <div className="row gap-2 mt-2">
                <Badge tone={activation?.activated ? 'success' : 'warning'}>
                  {activation?.activated ? 'Activated' : 'Not activated'}
                </Badge>
                <Badge tone="brand">Offline</Badge>
                <Badge tone="neutral">BDT ৳</Badge>
              </div>
            </div>
          </div>

          <div className="divider" />
          <p className="small" style={{ lineHeight: 1.7, color: 'var(--text-2)' }}>
            Dentiva Pro manages patients, dental charting, appointments, queue, treatments, prescriptions, billing,
            inventory, accounting and staff for dental clinics — entirely on your computer. No internet connection is
            required or used at runtime; patient data never leaves this machine.
          </p>

          <div className="divider" />
          <div className="kv-list">
            <div className="kv"><span className="k">Data folder</span><span className="v mono" style={{ fontSize: 12 }}>{system?.dataDir ?? '—'}</span></div>
            <div className="kv"><span className="k">Platform</span><span className="v">{system?.platform ?? '—'}</span></div>
            <div className="kv"><span className="k">Clinic</span><span className="v">{settings?.clinic.clinicName ?? '—'}</span></div>
            <div className="kv"><span className="k">Signed in</span><span className="v">{user?.displayName ?? '—'}</span></div>
            <div className="kv"><span className="k">Printers detected</span><span className="v">{printers ? printers.length : <Spinner label="…" />}</span></div>
          </div>
        </Card>

        <div className="col gap-4">
          <Card title="Development & support">
            <div className="kv-list">
              <div className="kv"><span className="k">Developer</span><span className="v">Shohan Khan</span></div>
              <div className="kv"><span className="k">Email</span><span className="v"><a href="mailto:helloiamshohan@gmail.com">helloiamshohan@gmail.com</a></span></div>
              <div className="kv"><span className="k">Support</span><span className="v">Email support — no telemetry is sent</span></div>
            </div>
          </Card>

          <Card title="Keyboard shortcuts">
            {[
              ['Search everything', <><Kbd>Ctrl</Kbd> <Kbd>K</Kbd></>],
              ['Lock app', <><Kbd>Ctrl</Kbd> <Kbd>L</Kbd></>],
              ['New patient', <><Kbd>Ctrl</Kbd> <Kbd>N</Kbd></>],
              ['Module shortcuts', <><Kbd>Alt</Kbd> <Kbd>1–9</Kbd></>],
            ].map(([label, keys], i) => (
              <div className="shortcut-row" key={i}>
                <span className="small">{label as string}</span>
                <span>{keys as React.ReactNode}</span>
              </div>
            ))}
          </Card>

          <Card title="License">
            <p className="small" style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>
              Licensed for use by a single clinic on the computers it was activated for. Activation is verified offline
              using a one-way cryptographic derivation — the activation code is never stored, displayed or transmitted.
            </p>
            <p className="xsmall muted">
              © {new Date().getFullYear()} Dentiva Pro. All rights reserved.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
