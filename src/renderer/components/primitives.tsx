import React, { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';

/* ------------------------------- Button ------------------------------- */

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'default';

export function Button(props: {
  variant?: BtnVariant; size?: 'sm' | 'md' | 'lg'; loading?: boolean; block?: boolean;
  icon?: React.ReactNode; children?: React.ReactNode;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  type?: 'button' | 'submit'; disabled?: boolean; title?: string; id?: string; autoFocus?: boolean;
}) {
  const { variant = 'default', size = 'md', loading, block, icon, children, onClick, type = 'button', disabled, title, id, autoFocus } = props;
  const cls = [
    'btn',
    variant !== 'default' ? `btn-${variant}` : '',
    size !== 'md' ? `btn-${size}` : '',
    block ? 'btn-block' : '',
    !children ? 'btn-icon' : '',
  ].filter(Boolean).join(' ');
  return (
    <button id={id} className={cls} type={type} disabled={disabled || loading} onClick={onClick} title={title} autoFocus={autoFocus}>
      {loading ? <span className="spinner" style={{ width: 14, height: 14, borderColor: 'rgba(255,255,255,0.4)', borderTopColor: '#fff' }} /> : icon}
      {children}
    </button>
  );
}

export function IconButton(props: { icon: React.ReactNode; title: string; onClick?: () => void; variant?: BtnVariant; size?: 'sm' | 'md'; disabled?: boolean; badge?: number }) {
  return (
    <span className="popover-anchor">
      <Button variant={props.variant ?? 'ghost'} size={props.size ?? 'md'} onClick={props.onClick} title={props.title} disabled={props.disabled}>
        {props.icon}
      </Button>
      {props.badge != null && props.badge > 0 && (
        <span style={{
          position: 'absolute', top: 2, right: 2, background: 'var(--danger)', color: '#fff',
          borderRadius: 999, fontSize: 10, fontWeight: 700, minWidth: 16, height: 16,
          display: 'grid', placeItems: 'center', padding: '0 4px', pointerEvents: 'none',
        }}>{props.badge > 99 ? '99+' : props.badge}</span>
      )}
    </span>
  );
}

/* ------------------------------ Badges/Chip ---------------------------- */

export function Badge(props: { tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand'; children: React.ReactNode; dot?: boolean; title?: string }) {
  const tone = props.tone ?? 'neutral';
  const cls = tone === 'neutral' ? 'badge' : `badge badge-${tone}${props.dot ? ' badge-dot' : ''}`;
  return <span className={cls} title={props.title}>{props.children}</span>;
}

export function Chip(props: { label: string; onRemove?: () => void }) {
  return (
    <span className="chip">
      {props.label}
      {props.onRemove && <button onClick={props.onRemove} title="Remove">✕</button>}
    </span>
  );
}

/* ------------------------------- States -------------------------------- */

export function Spinner({ label }: { label?: string }) {
  return <div className="loading-inline"><span className="spinner" /> {label ?? 'Loading…'}</div>;
}

export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <div style={{ padding: 8 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton skeleton-row" style={{ opacity: 1 - i * 0.1 }} />
      ))}
    </div>
  );
}

export function EmptyState(props: { icon?: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <div className="glyph">{props.icon ?? '○'}</div>
      <h4>{props.title}</h4>
      {props.body && <p>{props.body}</p>}
      {props.action}
    </div>
  );
}

export function ErrorState(props: { title?: string; error: unknown; onRetry?: () => void }) {
  const msg = props.error instanceof Error ? props.error.message : String(props.error ?? 'Unknown error');
  return (
    <div className="error-state">
      <div className="glyph">!</div>
      <h4>{props.title ?? 'Something went wrong'}</h4>
      <p>{msg}</p>
      {props.onRetry && <Button variant="secondary" onClick={props.onRetry}>Retry</Button>}
    </div>
  );
}

export function PermissionDenied({ permission }: { permission?: string }) {
  return (
    <EmptyState
      icon="⛨"
      title="Permission required"
      body={`Your role does not include ${permission ? `"${permission}"` : 'access to this area'}. Contact an administrator if you need access.`}
    />
  );
}

/* -------------------------------- Cards -------------------------------- */

export function Card(props: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; pad?: boolean }) {
  return (
    <div className={`card ${props.className ?? ''}`}>
      {(props.title || props.actions) && (
        <div className="card-header">
          <div className="card-title">{props.title}</div>
          {props.actions}
        </div>
      )}
      <div className={props.pad === false ? '' : 'card-body'}>{props.children}</div>
    </div>
  );
}

export function StatCard(props: { label: string; value: React.ReactNode; foot?: React.ReactNode; tone?: 'accent' | 'warning' | 'danger' | 'success'; onClick?: () => void }) {
  return (
    <div className={`stat-card ${props.tone ?? ''}`} onClick={props.onClick} style={props.onClick ? { cursor: 'pointer' } : undefined}>
      <div className="stat-label">{props.label}</div>
      <div className="stat-value">{props.value}</div>
      {props.foot && <div className="stat-foot">{props.foot}</div>}
    </div>
  );
}

/* --------------------------------- Tabs -------------------------------- */

export function Tabs<T extends string>(props: {
  tabs: { key: T; label: string; count?: number }[];
  active: T;
  onChange: (key: T) => void;
  id?: string;
}) {
  const onKeyDown = (e: React.KeyboardEvent) => {
    const idx = props.tabs.findIndex((t) => t.key === props.active);
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      props.onChange(props.tabs[(idx + 1) % props.tabs.length].key);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      props.onChange(props.tabs[(idx - 1 + props.tabs.length) % props.tabs.length].key);
    }
  };
  return (
    <div className="tabs" role="tablist" onKeyDown={onKeyDown} id={props.id}>
      {props.tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={t.key === props.active}
          className={`tab ${t.key === props.active ? 'active' : ''}`}
          onClick={() => props.onChange(t.key)}
          type="button"
        >
          {t.label}
          {t.count != null && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------ Pagination ----------------------------- */

export function Pagination(props: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(props.total / props.pageSize));
  if (props.total <= props.pageSize) {
    return <div className="pagination"><span>{props.total} record{props.total === 1 ? '' : 's'}</span></div>;
  }
  return (
    <div className="pagination">
      <span className="num">
        Page {props.page} of {pages} · {props.total} records
      </span>
      <div className="pages">
        <Button size="sm" variant="secondary" disabled={props.page <= 1} onClick={() => props.onPage(props.page - 1)}>← Prev</Button>
        <Button size="sm" variant="secondary" disabled={props.page >= pages} onClick={() => props.onPage(props.page + 1)}>Next →</Button>
      </div>
    </div>
  );
}

/* ------------------------------ Toasts --------------------------------- */

export interface ToastItem { id: number; kind: 'success' | 'error' | 'warning' | 'info'; title: string; message?: string }

interface ToastApi {
  push: (t: Omit<ToastItem, 'id'>) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  fromError: (err: unknown, fallbackTitle?: string) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);
export const useToast = (): ToastApi => {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('Toast provider missing');
  return ctx;
};

export function ToastProvider(props: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const push = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = nextId.current++;
    setItems((prev) => [...prev.slice(-4), { ...t, id }]);
    setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== id)), t.kind === 'error' ? 8000 : 4500);
  }, []);

  const api: ToastApi = {
    push,
    success: (title, message) => push({ kind: 'success', title, message }),
    error: (title, message) => push({ kind: 'error', title, message }),
    warning: (title, message) => push({ kind: 'warning', title, message }),
    fromError: (err, fallbackTitle = 'Operation failed') =>
      push({ kind: 'error', title: fallbackTitle, message: err instanceof Error ? err.message : String(err) }),
  };

  return (
    <ToastCtx.Provider value={api}>
      {props.children}
      <div className="toast-stack" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <div className="toast-body">
              <div className="toast-title">{t.title}</div>
              {t.message && <div className="toast-msg">{t.message}</div>}
            </div>
            <button className="close" onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))} aria-label="Dismiss">✕</button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* -------------------------------- Modal -------------------------------- */

export function Modal(props: {
  title: React.ReactNode; onClose: () => void; children: React.ReactNode;
  footer?: React.ReactNode; width?: 'default' | 'wide' | 'xwide'; closeOnBackdrop?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;
  const titleId = useId();

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusable = () =>
      node ? Array.from(node.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((el) => !el.hasAttribute('disabled')) : [];
    const firstField = node?.querySelector<HTMLElement>('.modal-body input:not([disabled]), .modal-body select:not([disabled]), .modal-body textarea:not([disabled])');
    (firstField ?? focusable()[0])?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      } else if (e.key === 'Tab') {
        const els = focusable();
        if (els.length === 0) return;
        const first = els[0];
        const last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      previous?.focus?.();
    };
  }, []);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (props.closeOnBackdrop !== false && e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className={`modal ${props.width === 'wide' ? 'wide' : props.width === 'xwide' ? 'xwide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className="modal-header">
          <div className="modal-title" id={titleId}>{props.title}</div>
          <IconButton icon="✕" title="Close" onClick={props.onClose} />
        </div>
        <div className="modal-body">{props.children}</div>
        {props.footer && <div className="modal-footer">{props.footer}</div>}
      </div>
    </div>
  );
}

/* --------------------------- Confirm dialogs --------------------------- */

export function ConfirmDialog(props: {
  title: string; body: React.ReactNode; confirmLabel?: string; danger?: boolean;
  onConfirm: () => void | Promise<void>; onCancel: () => void; pending?: boolean;
}) {
  return (
    <Modal
      title={props.title}
      onClose={props.onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={props.onCancel}>Cancel</Button>
          <Button variant={props.danger ? 'danger' : 'primary'} loading={props.pending} onClick={() => void props.onConfirm()}>
            {props.confirmLabel ?? 'Confirm'}
          </Button>
        </>
      }
    >
      <div className="small" style={{ color: 'var(--text-2)', lineHeight: 1.6 }}>{props.body}</div>
    </Modal>
  );
}

export function TypedConfirmDialog(props: {
  title: string; body: React.ReactNode; phrase: string; confirmLabel?: string;
  onConfirm: () => void | Promise<void>; onCancel: () => void; pending?: boolean;
}) {
  const [typed, setTyped] = useState('');
  const ok = typed.trim() === props.phrase;
  return (
    <Modal
      title={props.title}
      onClose={props.onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={props.onCancel}>Cancel</Button>
          <Button variant="danger" disabled={!ok} loading={props.pending} onClick={() => void props.onConfirm()}>
            {props.confirmLabel ?? 'Confirm'}
          </Button>
        </>
      }
    >
      <div className="col">
        <div className="small" style={{ color: 'var(--text-2)', lineHeight: 1.6 }}>{props.body}</div>
        <div className="field">
          <label>
            Type <strong className="num">{props.phrase}</strong> to confirm
            <span className="req">*</span>
          </label>
          <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------- Global short hint --------------------------- */

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd>{children}</kbd>;
}
