import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, useAsync, useInterval } from '../api';
import { useApp } from '../state/app-context';
import { Badge, Button, Card, ConfirmDialog, Modal, useToast } from '../components/primitives';
import { Field, Input, Select, Textarea } from '../components/forms';
import { DataTable, TableToolbar, type Column } from '../components/table';
import { Icon } from '../components/shell';
import { isoDate } from '../format';
import type { AppointmentDTO } from '../../shared/types';

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand'> = {
  scheduled: 'info', confirmed: 'brand', arrived: 'warning', in_queue: 'warning',
  in_treatment: 'warning', completed: 'success', cancelled: 'danger', no_show: 'danger', rescheduled: 'neutral',
};

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/* ------------------------- appointment form --------------------------- */

function AppointmentFormModal(props: {
  open: boolean;
  initial?: AppointmentDTO | null;
  defaultDate?: string;
  defaultPatientId?: number;
  onClose: () => void;
  onSaved: (a: AppointmentDTO) => void;
}) {
  const { values, set, validate, errors } = useFormState(props);
  const { data: dentists } = useAsync(() => api['dentists/list'](), []);
  const [patientQuery, setPatientQuery] = useState('');
  const [patientId, setPatientId] = useState<number | null>(props.defaultPatientId ?? null);
  const [patientName, setPatientName] = useState('');
  const [matches, setMatches] = useState<{ id: number; name: string; code: string; phone: string | null }[]>([]);
  const [conflict, setConflict] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!props.open) return;
    setConflict(null);
    setPatientId(props.defaultPatientId ?? (props.initial?.patientId ?? null));
    setPatientName(props.initial?.patientName ?? '');
    if (props.initial?.patientId) {
      setPatientQuery(props.initial.patientName);
      setShowAll(true);
    } else {
      setPatientQuery('');
      setShowAll(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, props.initial?.id, props.defaultPatientId]);

  useEffect(() => {
    if (!showAll && patientQuery.trim().length < 2) { setMatches([]); return; }
    const t = setTimeout(() => {
      api['patients/list']({ query: showAll ? undefined : patientQuery, pageSize: showAll ? 50 : 8, status: 'active' })
        .then((res) => setMatches(res.items.map((p) => ({ id: p.id, name: p.name, code: p.code, phone: p.phone }))))
        .catch(() => setMatches([]));
    }, 220);
    return () => clearTimeout(t);
  }, [patientQuery, showAll]);

  const submit = async () => {
    const ok = validate((v) => ({
      date: !v.date ? 'Choose a date.' : '',
      time: !v.time ? 'Choose a time.' : '',
      durationMin: v.durationMin < 5 || v.durationMin > 480 ? 'Duration must be 5–480 minutes.' : '',
    }));
    if (!ok || !patientId) {
      if (!patientId) setConflict((c) => c);
      if (!patientId) toast.warning('Select a patient', 'Search and choose the patient this appointment is for.');
      return;
    }
    setPending(true);
    setConflict(null);
    try {
      const payload = {
        patientId,
        dentistId: values.dentistId ? Number(values.dentistId) : null,
        date: values.date,
        time: values.time,
        durationMin: Number(values.durationMin),
        type: values.type,
        notes: values.notes || null,
      };
      const created = props.initial
        ? await api['appointments/update']({ id: props.initial.id, ...payload })
        : await api['appointments/create'](payload);
      toast.success(props.initial ? 'Appointment updated' : 'Appointment booked', `${created.date} ${created.time}`);
      props.onSaved(created);
      props.onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Booking failed.';
      if (/conflict|overlap|already booked|double/i.test(msg)) {
        setConflict(msg);
      } else {
        toast.error('Booking failed', msg);
      }
    } finally {
      setPending(false);
    }
  };

  const bookAnyway = async () => {
    if (!patientId) return;
    setPending(true);
    try {
      const payload = {
        patientId,
        dentistId: values.dentistId ? Number(values.dentistId) : null,
        date: values.date,
        time: values.time,
        durationMin: Number(values.durationMin),
        type: values.type,
        notes: values.notes || null,
        allowConflict: true,
      };
      const created = props.initial
        ? await api['appointments/update']({ id: props.initial.id, ...payload })
        : await api['appointments/create'](payload);
      toast.warning(
        props.initial ? 'Appointment updated (conflict override)' : 'Appointment booked (conflict override)',
        `${created.date} ${created.time} — dentist may be double-booked.`,
      );
      props.onSaved(created);
      props.onClose();
    } catch (err) {
      toast.fromError(err, 'Booking failed');
    } finally {
      setPending(false);
    }
  };

  if (!props.open) return null;

  return (
    <Modal
      title={props.initial ? 'Reschedule appointment' : 'New appointment'}
      onClose={props.onClose}
      width="wide"
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={() => void submit()}>
            {props.initial ? 'Save changes' : 'Book appointment'}
          </Button>
        </>
      }
    >
      {conflict && (
        <div className="alert alert-warning mb-4">
          <div className="col" style={{ width: '100%', gap: 8 }}>
            <strong>Scheduling conflict</strong>
            <span className="small">{conflict}</span>
            <div className="row gap-2">
              <Button size="sm" variant="secondary" onClick={() => setConflict(null)}>Change time instead</Button>
              <Button size="sm" variant="danger" loading={pending} onClick={() => void bookAnyway()}>Book anyway (override)</Button>
            </div>
          </div>
        </div>
      )}

      <div className="form-grid">
        <Field label="Patient" required className="span-2">
          {() => (
            <div className="col" style={{ gap: 6 }}>
              <Input
                value={patientQuery}
                onChange={(v) => { setPatientQuery(v); setPatientId(null); setPatientName(''); }}
                placeholder="Search by name, phone or patient ID…"
                disabled={!!props.initial || !!props.defaultPatientId}
              />
              {!props.initial && !props.defaultPatientId && matches.length > 0 && !patientId && (
                <div className="list" style={{ border: '1px solid var(--line)', borderRadius: 6, maxHeight: 160, overflowY: 'auto' }}>
                  {matches.map((m) => (
                    <div
                      key={m.id}
                      className="list-row clickable"
                      style={{ padding: '8px 10px' }}
                      onClick={() => { setPatientId(m.id); setPatientName(m.name); setPatientQuery(`${m.name} · ${m.code}`); }}
                    >
                      <span className="flex-1"><strong>{m.name}</strong> <span className="xsmall muted mono">{m.code}</span></span>
                      <span className="xsmall muted mono">{m.phone ?? ''}</span>
                    </div>
                  ))}
                </div>
              )}
              {patientId && <div className="xsmall success-text">Selected: {patientName || `patient #${patientId}`}</div>}
              <label className="checkbox">
                <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
                <span>Browse active patients</span>
              </label>
            </div>
          )}
        </Field>
        <Field label="Dentist">
          {(id) => (
            <Select
              id={id}
              value={values.dentistId}
              onChange={(v) => set('dentistId', v)}
              placeholder="Any dentist"
              options={(dentists ?? []).filter((d) => d.active).map((d) => ({ value: String(d.id), label: d.name }))}
            />
          )}
        </Field>
        <Field label="Appointment type">
          {(id) => (
            <Select
              id={id}
              value={values.type}
              onChange={(v) => set('type', v)}
              options={[
                { value: 'Consultation', label: 'Consultation' },
                { value: 'Check-up', label: 'Check-up' },
                { value: 'Cleaning', label: 'Cleaning' },
                { value: 'Filling', label: 'Filling' },
                { value: 'Extraction', label: 'Extraction' },
                { value: 'Root canal', label: 'Root canal' },
                { value: 'Orthodontics', label: 'Orthodontics' },
                { value: 'Surgery', label: 'Surgery' },
                { value: 'Follow-up', label: 'Follow-up' },
                { value: 'Emergency', label: 'Emergency' },
              ]}
            />
          )}
        </Field>
        <Field label="Date" required error={errors.date}>
          {(id) => <Input id={id} type="date" value={values.date} onChange={(v) => set('date', v)} invalid={!!errors.date} />}
        </Field>
        <Field label="Time" required error={errors.time}>
          {(id) => <Input id={id} type="time" value={values.time} onChange={(v) => set('time', v)} invalid={!!errors.time} />}
        </Field>
        <Field label="Duration (minutes)" error={errors.durationMin}>
          {(id) => <Input id={id} type="number" min={5} max={480} step={5} value={String(values.durationMin)} onChange={(v) => set('durationMin', Number(v) || 15)} />}
        </Field>
        <Field label="Notes" className="span-2">
          {(id) => <Textarea id={id} rows={2} value={values.notes} onChange={(v) => set('notes', v)} />}
        </Field>
      </div>
    </Modal>
  );
}

function useFormState(props: { open: boolean; initial?: AppointmentDTO | null; defaultDate?: string }) {
  const [values, setValues] = useState({
    dentistId: '',
    date: isoDate(new Date()),
    time: '10:00',
    durationMin: 30,
    type: 'Consultation',
    notes: '',
  });
  const [errors, setErrors] = useState<{ [k: string]: string }>({});

  useEffect(() => {
    if (!props.open) return;
    setErrors({});
    setValues({
      dentistId: props.initial?.dentistId ? String(props.initial.dentistId) : '',
      date: props.initial?.date ?? props.defaultDate ?? isoDate(new Date()),
      time: props.initial?.time ?? '10:00',
      durationMin: props.initial?.durationMin ?? 30,
      type: props.initial?.type || 'Consultation',
      notes: props.initial?.notes ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, props.initial?.id, props.defaultDate]);

  const set = <K extends keyof typeof values>(k: K, v: (typeof values)[K]): void => {
    setValues((prev) => ({ ...prev, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };
  const validate = (fn: (v: typeof values) => { [k: string]: string }): boolean => {
    const errs = fn(values);
    const cleaned: { [k: string]: string } = {};
    for (const [k, v] of Object.entries(errs)) if (v) cleaned[k] = v;
    setErrors(cleaned);
    return Object.keys(cleaned).length === 0;
  };
  return { values, set, errors, validate };
}

/* ------------------------------ page ---------------------------------- */

export function AppointmentsPage() {
  const [params, setParams] = useSearchParams();
  const { can } = useApp();
  const toast = useToast();
  const today = new Date();
  const [view, setView] = useState<'day' | 'list'>('day');
  const [date, setDate] = useState(params.get('date') ?? isoDate(today));
  const [dentistId, setDentistId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [formOpen, setFormOpen] = useState(params.get('new') === '1');
  const [editing, setEditing] = useState<AppointmentDTO | null>(null);
  const [cancelTarget, setCancelTarget] = useState<AppointmentDTO | null>(null);
  const [selected, setSelected] = useState<AppointmentDTO | null>(null);

  const { data: dentists } = useAsync(() => api['dentists/list'](), []);

  const from = view === 'day' ? date : isoDate(addDays(new Date(date), -7));
  const to = view === 'day' ? date : isoDate(addDays(new Date(date), 7));
  const filter = useMemo(
    () => ({ from, to, dentistId: dentistId ? Number(dentistId) : undefined, status: statusFilter || undefined }),
    [from, to, dentistId, statusFilter],
  );
  const { data, loading, error, reload } = useAsync(() => api['appointments/list'](filter), [JSON.stringify(filter)]);

  useEffect(() => {
    if (params.get('new') === '1') {
      setFormOpen(true);
      params.delete('new');
      setParams(params, { replace: true });
    }
    if (params.get('date')) setDate(params.get('date')!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useInterval(() => reload(), 60_000);

  const arrive = async (a: AppointmentDTO) => {
    try {
      await api['appointments/arrive'](a.id);
      toast.success('Patient arrived', `${a.patientName} added to the queue.`);
      reload();
    } catch (err) {
      toast.fromError(err, 'Could not update appointment');
    }
  };

  const statusAction = async (a: AppointmentDTO, action: 'complete' | 'noshow' | 'confirm') => {
    try {
      if (action === 'noshow') await api['appointments/no-show'](a.id);
      else if (action === 'confirm') await api['appointments/update']({ id: a.id, status: 'confirmed' });
      else await api['appointments/update']({ id: a.id, status: 'completed' });
      toast.success(`Appointment ${action === 'complete' ? 'completed' : action === 'noshow' ? 'marked no-show' : 'confirmed'}`);
      reload();
    } catch (err) {
      toast.fromError(err, 'Update failed');
    }
  };

  const columns: Column<AppointmentDTO>[] = [
    {
      key: 'time', label: 'Time', sortValue: (r) => r.time,
      render: (r) => (
        <div>
          <strong className="num">{r.time}</strong>
          <div className="xsmall muted">{r.durationMin}m</div>
        </div>
      ),
    },
    {
      key: 'patient', label: 'Patient',
      render: (r) => (
        <div>
          <strong>{r.patientName}</strong>
          <div className="xsmall muted mono">{r.patientCode} · {r.phone ?? ''}</div>
        </div>
      ),
    },
    { key: 'dentist', label: 'Dentist', render: (r) => r.dentistName ?? <span className="muted">Any</span> },
    { key: 'type', label: 'Type', render: (r) => r.type || 'Consultation' },
    { key: 'status', label: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status.replace('_', ' ')}</Badge> },
    {
      key: 'actions', label: 'Actions', align: 'right',
      render: (r) => (
        <div className="row gap-2 end" onClick={(e) => e.stopPropagation()}>
          {(r.status === 'scheduled' || r.status === 'confirmed') && can('appointments.manage') && (
            <Button size="sm" variant="primary" onClick={() => void arrive(r)}>Arrive → queue</Button>
          )}
          {r.status === 'arrived' && can('queue.manage') && <Badge tone="warning">in arrival</Badge>}
          {can('appointments.manage') && (r.status === 'scheduled' || r.status === 'confirmed' || r.status === 'arrived') && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Edit</Button>
          )}
          {can('appointments.manage') && (r.status === 'scheduled' || r.status === 'confirmed') && (
            <>
              <Button size="sm" variant="ghost" onClick={() => void statusAction(r, 'confirm')}>Confirm</Button>
              <Button size="sm" variant="ghost" onClick={() => void statusAction(r, 'noshow')}>No-show</Button>
              <Button size="sm" variant="ghost" onClick={() => setCancelTarget(r)}>Cancel</Button>
            </>
          )}
          {can('appointments.manage') && r.status === 'in_treatment' && (
            <Button size="sm" variant="secondary" onClick={() => void statusAction(r, 'complete')}>Complete</Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => void api['reports/print']({ type: 'appointment-card', id: r.id })} title="Print appointment card">Print</Button>
        </div>
      ),
    },
  ];

  const days = useMemo(() => {
    const base = new Date(date);
    return Array.from({ length: 7 }, (_, i) => addDays(base, i - 3));
  }, [date]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Appointments</h1>
          <p className="page-subtitle">{data?.length ?? 0} in range · conflicts are blocked unless explicitly overridden</p>
        </div>
        <div className="page-actions">
          <Button variant="ghost" icon={Icon.refresh} onClick={reload}>Refresh</Button>
          {can('appointments.manage') && (
            <Button variant="primary" icon={Icon.plus} onClick={() => { setEditing(null); setFormOpen(true); }}>New appointment</Button>
          )}
        </div>
      </div>

      <Card>
        <div className="cal-strip mb-4">
          {days.map((d) => {
            const key = isoDate(d);
            return (
              <button key={key} className={`cal-day ${key === date ? 'active' : ''}`} onClick={() => { setDate(key); setView('day'); }} type="button">
                <div className="dow">{d.toLocaleDateString(undefined, { weekday: 'short' })}</div>
                <div className="dnum">{d.getDate()}</div>
                <div className="cnt">{d.getMonth() === new Date(date).getMonth() ? '' : d.toLocaleDateString(undefined, { month: 'short' })}</div>
              </button>
            );
          })}
        </div>

        <TableToolbar>
          <div className="seg">
            <button className={view === 'day' ? 'active' : ''} onClick={() => setView('day')} type="button">Day</button>
            <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} type="button">±7 days</button>
          </div>
          <input className="input" style={{ width: 160 }} type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
          <Select
            value={dentistId}
            onChange={setDentistId}
            placeholder="All dentists"
            options={(dentists ?? []).map((d) => ({ value: String(d.id), label: d.name }))}
          />
          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            placeholder="Any status"
            options={[
              { value: 'scheduled', label: 'Scheduled' }, { value: 'confirmed', label: 'Confirmed' },
              { value: 'arrived', label: 'Arrived' }, { value: 'completed', label: 'Completed' },
              { value: 'cancelled', label: 'Cancelled' }, { value: 'no_show', label: 'No-show' },
            ]}
          />
          <Button variant="ghost" size="sm" onClick={() => setDate(isoDate(new Date()))}>Today</Button>
        </TableToolbar>

        <DataTable
          columns={columns}
          rows={data ?? []}
          rowKey={(r) => r.id}
          loading={loading}
          error={error}
          onRetry={reload}
          onRowClick={(r) => setSelected(r)}
          empty={{
            title: 'No appointments in this range',
            body: 'Book an appointment or browse another day.',
            action: can('appointments.manage') ? <Button variant="primary" onClick={() => setFormOpen(true)}>New appointment</Button> : undefined,
          }}
          initialSort={{ key: 'time', dir: 'asc' }}
        />
      </Card>

      <AppointmentFormModal
        open={formOpen || !!editing}
        initial={editing}
        defaultDate={date}
        defaultPatientId={Number(params.get('patient')) || undefined}
        onClose={() => { setFormOpen(false); setEditing(null); params.delete('patient'); setParams(params, { replace: true }); }}
        onSaved={() => reload()}
      />

      {cancelTarget && (
        <ConfirmDialog
          title="Cancel appointment?"
          body={`${cancelTarget.patientName} · ${cancelTarget.date} ${cancelTarget.time}. The patient will see this as cancelled in history.`}
          confirmLabel="Cancel appointment"
          danger
          onConfirm={async () => {
            try {
              await api['appointments/cancel']({ id: cancelTarget.id, reason: 'Cancelled from schedule' });
              toast.success('Appointment cancelled');
              setCancelTarget(null);
              reload();
            } catch (err) {
              toast.fromError(err, 'Cancel failed');
            }
          }}
          onCancel={() => setCancelTarget(null)}
        />
      )}

      {selected && (
        <Modal title={`Appointment #${selected.id}`} onClose={() => setSelected(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setSelected(null)}>Close</Button>
              {can('appointments.manage') && <Button variant="primary" onClick={() => { setEditing(selected); setSelected(null); }}>Edit</Button>}
            </>
          }>
          <div className="kv-list">
            <div className="kv"><span className="k">Patient</span><span className="v">{selected.patientName} ({selected.patientCode})</span></div>
            <div className="kv"><span className="k">When</span><span className="v">{selected.date} {selected.time} · {selected.durationMin} min</span></div>
            <div className="kv"><span className="k">Dentist</span><span className="v">{selected.dentistName ?? 'Any'}</span></div>
            <div className="kv"><span className="k">Type</span><span className="v">{selected.type}</span></div>
            <div className="kv"><span className="k">Status</span><span className="v">{selected.status}</span></div>
            <div className="kv"><span className="k">Notes</span><span className="v">{selected.notes ?? '—'}</span></div>
          </div>
          {selected.visitId && <div className="small muted mt-4">Linked visit #{selected.visitId}</div>}
        </Modal>
      )}
    </div>
  );
}
