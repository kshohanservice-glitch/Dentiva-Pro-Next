import React, { useEffect, useId, useRef, useState } from 'react';

export function Field(props: {
  label?: React.ReactNode; required?: boolean; hint?: string; error?: string | null;
  children: (id: string) => React.ReactNode; className?: string;
}) {
  const id = useId();
  return (
    <div className={`field ${props.className ?? ''}`}>
      {props.label && (
        <label htmlFor={id}>
          {props.label}
          {props.required && <span className="req" aria-hidden>*</span>}
        </label>
      )}
      {props.children(id)}
      {props.hint && !props.error && <div className="hint">{props.hint}</div>}
      {props.error && <div className="error" role="alert">{props.error}</div>}
    </div>
  );
}

export const Input = React.forwardRef<HTMLInputElement, {
  value: string; onChange: (v: string) => void; type?: string; placeholder?: string;
  invalid?: boolean; disabled?: boolean; autoFocus?: boolean; id?: string; name?: string;
  min?: string | number; max?: string | number; step?: string | number; autoComplete?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  inputMode?: 'none' | 'text' | 'tel' | 'url' | 'email' | 'numeric' | 'decimal' | 'search';
  spellCheck?: boolean; style?: React.CSSProperties; readOnly?: boolean;
}>(function Input(props, ref) {
  return (
    <input
      ref={ref}
      id={props.id}
      name={props.name}
      className={`input ${props.invalid ? 'invalid' : ''}`}
      type={props.type ?? 'text'}
      value={props.value}
      placeholder={props.placeholder}
      disabled={props.disabled}
      autoFocus={props.autoFocus}
      min={props.min}
      max={props.max}
      step={props.step}
      autoComplete={props.autoComplete}
      onKeyDown={props.onKeyDown}
      inputMode={props.inputMode}
      spellCheck={props.spellCheck}
      readOnly={props.readOnly}
      style={props.style}
      onChange={(e) => props.onChange(e.target.value)}
    />
  );
});

export function Select(props: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
  invalid?: boolean; disabled?: boolean; id?: string; placeholder?: string;
}) {
  return (
    <select
      id={props.id}
      className={`select ${props.invalid ? 'invalid' : ''}`}
      value={props.value}
      disabled={props.disabled}
      onChange={(e) => props.onChange(e.target.value)}
    >
      {props.placeholder && <option value="">{props.placeholder}</option>}
      {props.options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
      ))}
    </select>
  );
}

export function Textarea(props: {
  value: string; onChange: (v: string) => void; rows?: number; placeholder?: string;
  invalid?: boolean; disabled?: boolean; id?: string; monospace?: boolean;
}) {
  return (
    <textarea
      id={props.id}
      className={`textarea ${props.invalid ? 'invalid' : ''}`}
      rows={props.rows ?? 3}
      placeholder={props.placeholder}
      disabled={props.disabled}
      value={props.value}
      spellCheck={false}
      style={props.monospace ? { fontFamily: 'ui-monospace, monospace' } : undefined}
      onChange={(e) => props.onChange(e.target.value)}
    />
  );
}

export function Checkbox(props: { checked: boolean; onChange: (v: boolean) => void; label: React.ReactNode; disabled?: boolean }) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange(e.target.checked)} />
      <span>{props.label}</span>
    </label>
  );
}

export function RadioGroup<T extends string>(props: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; name?: string;
}) {
  const name = useId();
  return (
    <div className="row wrap gap-2" role="radiogroup">
      {props.options.map((o) => (
        <label key={o.value} className="radio">
          <input
            type="radio"
            name={props.name ?? name}
            checked={props.value === o.value}
            onChange={() => props.onChange(o.value)}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

/* ------------------------- form state helpers -------------------------- */

export type FormErrors<T> = Partial<Record<keyof T, string>>;

export function useForm<T extends Record<string, any>>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const [errors, setErrors] = useState<FormErrors<T>>({});
  const set = <K extends keyof T>(key: K, value: T[K]): void => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  };
  const setMany = (patch: Partial<T>): void => {
    setValues((v) => ({ ...v, ...patch }));
  };
  const reset = (next?: T): void => {
    setValues(next ?? initial);
    setErrors({});
  };
  const validate = (fn: (v: T) => FormErrors<T>): boolean => {
    const errs = fn(values);
    const cleaned: FormErrors<T> = {};
    for (const [k, v] of Object.entries(errs)) {
      if (v) cleaned[k as keyof T] = v;
    }
    setErrors(cleaned);
    return Object.keys(cleaned).length === 0;
  };
  return { values, set, setMany, reset, errors, setErrors, validate };
}

export function required(v: unknown): boolean {
  return v === null || v === undefined || String(v).trim() === '';
}

/* ------------------------------ Dropdown ------------------------------- */

export function Dropdown(props: {
  trigger: (open: boolean) => React.ReactNode;
  items: ({ label: React.ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean } | 'sep')[];
  align?: 'left' | 'right';
  header?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  return (
    <div className="popover-anchor" ref={ref}>
      <span onClick={() => setOpen((o) => !o)} style={{ display: 'inline-flex', cursor: 'pointer' }} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((o) => !o); } }}>
        {props.trigger(open)}
      </span>
      {open && (
        <div className="dropdown" style={{ [props.align === 'left' ? 'left' : 'right']: 0, top: 44 } as React.CSSProperties}>
          {props.header}
          {props.items.map((it, i) =>
            it === 'sep' ? (
              <div key={i} className="dropdown-sep" />
            ) : (
              <button
                key={i}
                className={`dropdown-item ${it.danger ? 'danger' : ''}`}
                disabled={it.disabled}
                onClick={() => { setOpen(false); it.onClick(); }}
                type="button"
              >
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
