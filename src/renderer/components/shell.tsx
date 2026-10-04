import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api, useAsync } from '../api';
import { useApp } from '../state/app-context';
import { Badge, Button, ErrorState, IconButton, Kbd, Spinner, useToast } from './primitives';
import { Input } from './forms';
import type { NotificationDTO, SearchHit } from '../../shared/types';

/* ------------------------------ Icons ------------------------------ */
/* Minimal line icons drawn inline (no external icon assets, offline-safe). */
const I = { size: 18 };
export const Icon = {
  dashboard: <svg width={I.size} height={I.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" /></svg>,
  patients: <svg width={I.size} height={I.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-3.5 3.6-6 8-6s8 2.5 8 6" /></svg>,
  appointments: <svg width={I.size} height={I.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v4M16 3v4" /></svg>,
  queue: <svg width={I.size} height={I.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 6h16M4 12h10M4 18h7" /><circle cx="18" cy="15" r="3.5" /></svg>,
  treatments: <svg width={I.size} height={I.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3c3 0 6 2 6 6 0 3-1.5 5-2.5 8-.6 1.8-1.4 4-3.5 4s-2.9-2.2-3.5-4C7.5 14 6 12 6 9c0-4 3-6 6-6z" /></svg>,
  prescriptions: <svg width={I.size} height={I.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></svg>,
  invoice: <svg width={I.size} height={I.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z" /><path d="M9 8h6M9 12h6" /></svg>,
  payments: <svg width={I.size} height={I.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18" /></svg>,
  inventory: <svg width={I.size} height={I.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 8l9-5 9 5v8l-9 5-9-5V8z" /><path d="M3 8l9 5 9-5M12 13v8" /></svg>,
  accounting: <svg width={I.size} height={I.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7h8M8 11h3M8 15h3M15 11v6M13 14h4" /></svg>,
  staff: <svg width={I.size} height={I.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="9" cy="8" r="3.2" /><circle cx="17" cy="9" r="2.4" /><path d="M3 19c0-3 2.7-5 6-5s6 2 6 5M15.5 14.5c2.6.3 4.5 2 4.5 4.5" /></svg>,
  backup: <svg width={I.size} height={I.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z" /><path d="M4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></svg>,
  settings: <svg width={I.size} height={I.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1-1.6 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.6-1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3h.1a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5h.1a1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9v.1a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></svg>,
  reports: <svg width={I.size} height={I.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 20V10M10 20V4M16 20v-8M22 20H2" /></svg>,
  audit: <svg width={I.size} height={I.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="M9 12l2 2 4-4" /></svg>,
  users: <svg width={I.size} height={I.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="3.5" /><path d="M5 20c0-3.3 3-6 7-6s7 2.7 7 6" /></svg>,
  about: <svg width={I.size} height={I.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></svg>,
  search: <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>,
  bell: <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 8a6 6 0 10-12 0c0 7-3 8-3 8h18s-3-1-3-8M13.7 21a2 2 0 01-3.4 0" /></svg>,
  lock: <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 118 0v4" /></svg>,
  chevronL: <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 6l-6 6 6 6" /></svg>,
  chevronR: <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 6l6 6-6 6" /></svg>,
  back: <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>,
  forward: <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>,

  plus: <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 5v14M5 12h14" /></svg>,
  refresh: <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 11-3-6.7M21 4v5h-5" /></svg>,
  print: <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 9V3h12v6M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" /><rect x="6" y="14" width="12" height="7" /></svg>,
  edit: <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M17 3a2.8 2.8 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>,
  trash: <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /></svg>,
  eye: <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" /><circle cx="12" cy="12" r="3" /></svg>,
};

/* --------------------------- Nav structure -------------------------- */

interface NavEntry { to: string; label: string; icon: React.ReactNode; permission?: string }
interface NavGroup { title: string; entries: NavEntry[] }

const NAV: NavGroup[] = [
  {
    title: 'Practice',
    entries: [
      { to: '/', label: 'Dashboard', icon: Icon.dashboard, permission: 'dashboard.view' },
      { to: '/patients', label: 'Patients', icon: Icon.patients, permission: 'patients.view' },
      { to: '/appointments', label: 'Appointments', icon: Icon.appointments, permission: 'appointments.view' },
      { to: '/queue', label: 'Queue', icon: Icon.queue, permission: 'queue.view' },
    ],
  },
  {
    title: 'Clinical',
    entries: [
      { to: '/treatments', label: 'Treatments', icon: Icon.treatments, permission: 'treatments.view' },
      { to: '/prescriptions', label: 'Prescriptions', icon: Icon.prescriptions, permission: 'clinical.view' },
    ],
  },
  {
    title: 'Billing',
    entries: [
      { to: '/invoices', label: 'Invoice', icon: Icon.invoice, permission: 'billing.invoice.view' },
      { to: '/payments', label: 'Payments', icon: Icon.payments, permission: 'billing.payment.view' },
      { to: '/inventory', label: 'Inventory', icon: Icon.inventory, permission: 'inventory.view' },
      { to: '/accounting', label: 'Accounting', icon: Icon.accounting, permission: 'accounting.view' },
    ],
  },
  {
    title: 'Administration',
    entries: [
      { to: '/staff', label: 'Staff', icon: Icon.staff, permission: 'staff.view' },
      { to: '/users', label: 'Users & Roles', icon: Icon.users, permission: 'users.manage' },
      { to: '/audit', label: 'Audit Log', icon: Icon.audit, permission: 'audit.view' },
      { to: '/backup', label: 'Backup & Restore', icon: Icon.backup, permission: 'backup.create' },
      { to: '/reports', label: 'Reports', icon: Icon.reports, permission: 'patients.view' },
      { to: '/settings', label: 'Settings', icon: Icon.settings, permission: 'settings.manage' },
      { to: '/about', label: 'About', icon: Icon.about },
    ],
  },
];

/* ------------------------------ Search ------------------------------- */

function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setHits([]);
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      api['search/global'](query)
        .then((res) => {
          if (!cancelled) {
            setHits(res);
            setSelected(0);
          }
        })
        .catch(() => { if (!cancelled) setHits([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, open]);

  const go = useCallback(
    (hit: SearchHit) => {
      onClose();
      const map: Record<SearchHit['kind'], string> = {
        patient: `/patients/${hit.id}`,
        appointment: '/appointments',
        invoice: `/invoices?invoice=${hit.id}`,
        payment: '/payments',
        prescription: `/prescriptions?rx=${hit.id}`,
        treatment: '/treatments',
        staff: '/staff',
        dentist: '/staff?tab=dentists',
        inventory: '/inventory',
        expense: '/accounting',
        visit: '/patients',
      };
      navigate(map[hit.kind] ?? '/');
    },
    [navigate, onClose],
  );

  if (!open) return null;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal search-modal" role="dialog" aria-label="Global search">
        <div className="search-input-wrap">
          {Icon.search}
          <input
            ref={inputRef}
            value={query}
            placeholder="Search patients, invoices, prescriptions, staff…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, hits.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); }
              else if (e.key === 'Enter' && hits[selected]) go(hits[selected]);
            }}
          />
          {loading && <span className="spinner" />}
        </div>
        <div className="search-results">
          {query.trim().length >= 2 && hits.length === 0 && !loading && (
            <div className="empty-state" style={{ padding: 24 }}>
              <p>No results for “{query}”. Try a name, phone, code or number.</p>
            </div>
          )}
          {hits.map((h, i) => (
            <button key={`${h.kind}-${h.id}`} className={`search-hit ${i === selected ? 'selected' : ''}`} onClick={() => go(h)} type="button">
              <span className="kind">{h.kind}</span>
              <span className="flex-1">
                <span className="title">{h.title}</span>
                <div className="sub">{h.subtitle}{h.meta ? ` · ${h.meta}` : ''}</div>
              </span>
            </button>
          ))}
        </div>
        <div className="search-footer">
          <span><Kbd>↑↓</Kbd> navigate</span>
          <span><Kbd>Enter</Kbd> open</span>
          <span><Kbd>Esc</Kbd> close</span>
        </div>
      </div>
    </div>
  );
}

/* --------------------------- Notifications --------------------------- */

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data: items, reload } = useAsync(() => api['notifications/list'](), [], { immediate: true });
  const unread = (items ?? []).filter((n) => !n.readAt).length;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const markAll = async () => {
    await api['notifications/mark-read']();
    reload();
  };

  const sevIcon = (s: NotificationDTO['severity']) =>
    s === 'danger' ? '⛔' : s === 'warning' ? '⚠' : s === 'success' ? '✔' : 'ℹ';

  return (
    <div className="popover-anchor" ref={ref}>
      <IconButton icon={Icon.bell} title="Notifications" badge={unread} onClick={() => setOpen((o) => !o)} />
      {open && (
        <div className="notif-panel">
          <div className="card-header" style={{ position: 'sticky', top: 0, background: 'var(--surface-1)', zIndex: 2 }}>
            <div className="card-title" style={{ fontSize: 15 }}>Notifications</div>
            <Button size="sm" variant="ghost" onClick={() => void markAll()}>Mark all read</Button>
          </div>
          {(items ?? []).length === 0 && (
            <div className="empty-state" style={{ padding: 24 }}>
              <p>You’re all caught up. Alerts for appointments, stock and backups appear here.</p>
            </div>
          )}
          {(items ?? []).map((n) => (
            <div key={n.id} className={`notif-item ${n.readAt ? '' : 'unread'}`}>
              <span className="sev">{sevIcon(n.severity)}</span>
              <div className="flex-1">
                <div className="title">{n.title}</div>
                <div className="body">{n.body}</div>
                <div className="time">{new Date(n.createdAt).toLocaleString()}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------- Lock overlay --------------------------- */

export function LockOverlay() {
  const { user, unlock } = useApp();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const toast = useToast();

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!password) return;
    setPending(true);
    setError(null);
    const ok = await unlock(password);
    setPending(false);
    if (ok) {
      setPassword('');
      toast.success('Unlocked');
    } else {
      setError('Incorrect password.');
    }
  };

  return (
    <div className="lock-overlay">
      <form className="lock-card" onSubmit={submit}>
        <div className="brand-mark" style={{ width: 52, height: 52, fontSize: 24, borderRadius: 16 }}>D</div>
        <div>
          <h3>Application locked</h3>
          <p className="small muted mt-2">
            Signed in as <strong>{user?.displayName}</strong> ({user?.roleName}).<br />
            Enter your password to continue.
          </p>
        </div>
        <div className="col" style={{ width: '100%' }}>
          <Input value={password} onChange={setPassword} type="password" placeholder="Password" autoFocus autoComplete="current-password" />
          {error && <div className="auth-error" role="alert">{error}</div>}
          <Button type="submit" variant="primary" block loading={pending} onClick={() => void submit()}>Unlock</Button>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------ App shell ----------------------------- */

export function AppShell() {
  const { user, settings, system, lock, logout, can } = useApp();
  const demo = !!system?.demo;
  const [collapsed, setCollapsed] = useState(() => settings?.appearance.sidebarCollapsed ?? false);
  const [searchOpen, setSearchOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (settings) setCollapsed(!!settings.appearance.sidebarCollapsed);
  }, [settings]);

  // Global shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        lock();
        return;
      }
      if (typing) return;
      if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
        const map: Record<string, string> = {
          n: '/appointments', v: '/patients?newVisit=1', p: '/prescriptions?new=1', i: '/invoices?new=1',
        };
        const k = e.key.toLowerCase();
        if (map[k]) {
          e.preventDefault();
          navigate(map[k]);
          return;
        }
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        navigate('/patients?new=1');
        return;
      }
      if (e.altKey && /^[1-9]$/.test(e.key)) {
        const entries = NAV.flatMap((g) => g.entries).filter((en) => !en.permission || can(en.permission));
        const entry = entries[Number(e.key) - 1];
        if (entry) {
          e.preventDefault();
          navigate(entry.to);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lock, navigate, can]);

  const now = new Date();
  const visibleGroups = useMemo(
    () =>
      NAV.map((g) => ({
        ...g,
        entries: g.entries.filter((en) => !en.permission || can(en.permission)),
      })).filter((g) => g.entries.length > 0),
    [can],
  );

  const clinicName = demo ? 'BrightSmile Dental Clinic — Demo' : (settings?.clinic.clinicName || 'Your clinic');

  const persistCollapse = async (next: boolean) => {
    setCollapsed(next);
    try {
      await api['settings/save']({ appearance: { ...settings!.appearance, sidebarCollapsed: next } });
    } catch {
      /* visual state only — non-critical */
    }
  };

  return (
    <div className="shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">D</div>
          <div style={{ minWidth: 0 }}>
            <div className="brand-name">Dentiva Pro</div>
            <div className="brand-clinic" title={clinicName}>{clinicName}</div>
          </div>
        </div>

        <div className="header-nav-controls" aria-label="Page navigation">
          <IconButton icon={Icon.back} title="Back" onClick={() => { if (window.history.length > 1) navigate(-1); else navigate('/'); }} />
          <IconButton icon={Icon.forward} title="Forward" onClick={() => navigate(1)} />
        </div>

        <div className="header-center">
          <button className="searchbox" onClick={() => setSearchOpen(true)} type="button">
            {Icon.search}
            <span>Search patients, invoices, prescriptions…</span>
            <span className="kbd"><Kbd>Ctrl K</Kbd></span>
          </button>
        </div>

        <div className="header-right">
          <div className="header-date">
            <div>{now.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}</div>
            <div className="num">{now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</div>
          </div>
          <NotificationBell />
          {!demo && <IconButton icon={Icon.lock} title="Lock application (Ctrl+L)" onClick={lock} />}
          <div className="row gap-2" style={{ paddingLeft: 4, borderLeft: '1px solid var(--line)' }}>
            <div className="avatar sm" title={user?.displayName}>{(user?.displayName ?? '?').slice(0, 1).toUpperCase()}</div>
            <div style={{ lineHeight: 1.15 }}>
              <div className="small strong">{user?.displayName}</div>
              <Badge tone="brand">{user?.roleName}</Badge>
            </div>
            <div className="popover-anchor">
              <DropdownUserMenu demo={demo} onSettings={() => navigate('/settings')} onAbout={() => navigate('/about')} onPassword={() => navigate('/settings?tab=security')} onLogout={() => void logout()} canSettings={can('settings.manage')} />
            </div>
          </div>
        </div>
      </header>

      <nav className={`sidebar ${collapsed ? 'collapsed' : ''}`} aria-label="Main navigation">
        {visibleGroups.map((g) => (
          <div className="nav-section" key={g.title}>
            <div className="nav-section-title">{g.title}</div>
            {g.entries.map((en) => (
              <NavLink
                key={en.to}
                to={en.to}
                end={en.to === '/'}
                className={({ isActive }) => `nav-item ${isActive || (en.to !== '/' && location.pathname.startsWith(en.to)) ? 'active' : ''}`}
                title={collapsed ? en.label : undefined}
              >
                <span className="icon">{en.icon}</span>
                <span className="label">{en.label}</span>
              </NavLink>
            ))}
          </div>
        ))}
        <div className="sidebar-footer">
          <button className="nav-item" onClick={() => void persistCollapse(!collapsed)} type="button" title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            <span className="icon">{collapsed ? Icon.chevronR : Icon.chevronL}</span>
            <span className="label">Collapse</span>
          </button>
          <div className="xsmall muted" style={{ textAlign: 'center', marginTop: 6 }}>
            v{system?.version ?? '—'} · schema {system?.schemaVersion ?? '—'}
          </div>
        </div>
      </nav>

      <main className="main" id="main-content">
        {demo && <div className="demo-banner" role="status" style={{ margin: '0 0 14px', padding: '10px 14px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--line)', display: 'flex', gap: 10, alignItems: 'center' }}><strong>DEMO MODE</strong><span className="muted">Read-only showcase — all displayed data is fictional and cannot be changed.</span></div>}
        <Outlet />
      </main>

      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}

function DropdownUserMenu(props: { demo?: boolean; onSettings: () => void; onAbout: () => void; onPassword: () => void; onLogout: () => void; canSettings: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="popover-anchor" ref={ref}>
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen((o) => !o)} type="button" aria-haspopup="menu" aria-expanded={open}>▾</button>
      {open && (
        <div className="dropdown" style={{ right: 0, top: 40 }} role="menu">
          {!props.demo && <button className="dropdown-item" onClick={() => { setOpen(false); props.onPassword(); }} type="button">Change password</button>}
          {props.canSettings && (
            <button className="dropdown-item" onClick={() => { setOpen(false); props.onSettings(); }} type="button">Settings</button>
          )}
          <button className="dropdown-item" onClick={() => { setOpen(false); props.onAbout(); }} type="button">About Dentiva Pro</button>
          {!props.demo && <><div className="dropdown-sep" /><button className="dropdown-item danger" onClick={() => { setOpen(false); props.onLogout(); }} type="button">Sign out</button></>}
        </div>
      )}
    </div>
  );
}

/* ------------------------------- Splash ------------------------------ */

export function BootSplash() {
  return (
    <div className="auth-screen">
      <div className="auth-card" style={{ textAlign: 'center' }}>
        <div className="auth-brand">
          <div className="brand-mark" style={{ width: 52, height: 52, fontSize: 24, borderRadius: 16 }}>D</div>
          <div className="auth-title">Dentiva Pro</div>
        </div>
        <Spinner label="Starting…" />
      </div>
    </div>
  );
}

export function FatalBoot({ error }: { error: unknown }) {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <ErrorState title="Dentiva Pro could not start" error={error} />
        <div className="center mt-4">
          <Button variant="secondary" onClick={() => window.location.reload()}>Reload</Button>
        </div>
      </div>
    </div>
  );
}
