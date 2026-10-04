import { useEffect, useState } from 'react';
import { api, useAsync, useInterval } from '../api';
import { useApp } from '../state/app-context';
import { Badge, Button, Card, EmptyState, ErrorState, Modal, Spinner, useToast } from '../components/primitives';
import { Field, Input, Select } from '../components/forms';
import { Icon } from '../components/shell';
import { isoDate } from '../format';
import type { QueueEntryDTO, QueueStatus } from '../../shared/types';

const STATUS_LABEL: Record<QueueStatus, string> = {
  waiting: 'Waiting', called: 'Called', in_treatment: 'In treatment',
  paused: 'Paused', completed: 'Completed', cancelled: 'Cancelled',
};

const STATUS_TONE: Record<QueueStatus, 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand'> = {
  waiting: 'info', called: 'brand', in_treatment: 'warning', paused: 'neutral',
  completed: 'success', cancelled: 'danger',
};

function AddToQueueModal(props: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const [query, setQuery] = useState('');
  const [patientId, setPatientId] = useState<number | null>(null);
  const [matches, setMatches] = useState<{ id: number; name: string; code: string; phone: string | null }[]>([]);
  const { data: dentists } = useAsync(() => api['dentists/list'](), []);
  const [dentistId, setDentistId] = useState('');
  const [priority, setPriority] = useState('0');
  const [pending, setPending] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!props.open) { setQuery(''); setPatientId(null); setMatches([]); }
  }, [props.open]);

  useEffect(() => {
    if (query.trim().length < 2) { setMatches([]); return; }
    const t = setTimeout(() => {
      api['patients/list']({ query, pageSize: 8, status: 'active' })
        .then((res) => setMatches(res.items.map((p) => ({ id: p.id, name: p.name, code: p.code, phone: p.phone }))))
        .catch(() => setMatches([]));
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  const submit = async () => {
    if (!patientId) { toast.warning('Select a patient first'); return; }
    setPending(true);
    try {
      const entry = await api['queue/add']({
        patientId,
        dentistId: dentistId ? Number(dentistId) : null,
        priority: Number(priority) || 0,
      });
      toast.success('Added to queue', `Token #${entry.queueNo}`);
      props.onAdded();
      props.onClose();
    } catch (err) {
      toast.fromError(err, 'Could not add to queue');
    } finally {
      setPending(false);
    }
  };

  if (!props.open) return null;
  return (
    <Modal
      title="Add patient to queue"
      onClose={props.onClose}
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={() => void submit()}>Add to queue</Button>
        </>
      }
    >
      <Field label="Patient" required>
        {() => (
          <div className="col" style={{ gap: 6 }}>
            <Input value={query} onChange={(v) => { setQuery(v); setPatientId(null); }} placeholder="Search name, phone or patient ID…" autoFocus />
            {matches.length > 0 && !patientId && (
              <div className="list" style={{ border: '1px solid var(--line)', borderRadius: 6, maxHeight: 170, overflowY: 'auto' }}>
                {matches.map((m) => (
                  <div key={m.id} className="list-row clickable" style={{ padding: '8px 10px' }}
                    onClick={() => { setPatientId(m.id); setQuery(`${m.name} · ${m.code}`); }}>
                    <span className="flex-1"><strong>{m.name}</strong> <span className="xsmall muted mono">{m.code}</span></span>
                    <span className="xsmall muted mono">{m.phone ?? ''}</span>
                  </div>
                ))}
              </div>
            )}
            {patientId && <div className="xsmall success-text">Selected patient #{patientId}</div>}
          </div>
        )}
      </Field>
      <div className="form-grid mt-4">
        <Field label="Assigned dentist">
          {(id) => (
            <Select id={id} value={dentistId} onChange={setDentistId} placeholder="Unassigned"
              options={(dentists ?? []).filter((d) => d.active).map((d) => ({ value: String(d.id), label: d.name }))} />
          )}
        </Field>
        <Field label="Priority boost" hint="Higher priority jumps the line">
          {(id) => (
            <Select id={id} value={priority} onChange={setPriority}
              options={[
                { value: '0', label: 'Normal' }, { value: '1', label: 'Priority +1' },
                { value: '2', label: 'Priority +2 (emergency)' },
              ]} />
          )}
        </Field>
      </div>
    </Modal>
  );
}

export function QueuePage() {
  const { can } = useApp();
  const toast = useToast();
  const [date, setDate] = useState(isoDate(new Date()));
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState<QueueEntryDTO | null>(null);

  const { data, loading, error, reload } = useAsync(() => api['queue/list'](date), [date]);
  useInterval(() => reload(), 20_000);

  const entries = data ?? [];
  const waiting = entries.filter((e) => e.status === 'waiting' || e.status === 'called' || e.status === 'paused');
  const inTreatment = entries.filter((e) => e.status === 'in_treatment');
  const done = entries.filter((e) => e.status === 'completed' || e.status === 'cancelled');
  const maxWait = waiting.reduce((m, e) => Math.max(m, e.waitingMin), 0);
  const avgWait = waiting.length ? Math.round(waiting.reduce((s, e) => s + e.waitingMin, 0) / waiting.length) : 0;

  const action = async (entry: QueueEntryDTO, act: string, payload?: { dentistId?: number }) => {
    try {
      await api['queue/action']({ id: entry.id, action: act, payload });
      toast.success(`Token #${entry.queueNo} — ${act.replace('_', ' ')}`);
      reload();
    } catch (err) {
      toast.fromError(err, 'Queue action failed');
    }
  };

  const row = (e: QueueEntryDTO) => {
    const overdue = e.status === 'waiting' && e.waitingMin > 30;
    return (
      <div
        key={e.id}
        className={`list-row ${overdue ? 'queue-row-long' : ''}`}
        onClick={() => setSelected(e)}
        style={{ cursor: 'pointer' }}
      >
        <span className="queue-num">#{e.queueNo}</span>
        <span className="flex-1">
          <strong>{e.patientName}</strong>
          <div className="xsmall muted mono">{e.patientCode} · {e.dentistName ?? 'unassigned'}</div>
        </span>
        <Badge tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</Badge>
        {e.status === 'waiting' && (
          <span className={`num small ${overdue ? 'danger-text strong' : 'muted'}`}>{e.waitingMin}m waiting</span>
        )}
        {e.priority > 0 && <Badge tone="warning">P+{e.priority}</Badge>}
        <div className="queue-actions" onClick={(ev) => ev.stopPropagation()}>
          {can('queue.manage') && e.status === 'waiting' && (
            <Button size="sm" variant="primary" onClick={() => void action(e, 'call_next')}>Call next</Button>
          )}
          {can('queue.manage') && e.status === 'called' && (
            <Button size="sm" variant="primary" onClick={() => void action(e, 'start', { dentistId: e.dentistId ?? undefined })}>Start treatment</Button>
          )}
          {can('queue.manage') && e.status === 'in_treatment' && (
            <>
              <Button size="sm" variant="ghost" onClick={() => void action(e, 'pause')}>Pause</Button>
              <Button size="sm" variant="secondary" onClick={() => void action(e, 'complete')}>Complete</Button>
            </>
          )}
          {can('queue.manage') && (e.status === 'waiting' || e.status === 'called') && (
            <>
              <Button size="sm" variant="ghost" onClick={() => void action(e, 'pause')}>Pause</Button>
              <Button size="sm" variant="ghost" onClick={() => void action(e, 'cancel')}>Remove</Button>
            </>
          )}
          {can('queue.manage') && e.status === 'paused' && (
            <>
              <Button size="sm" variant="secondary" onClick={() => void action(e, 'resume')}>Resume</Button>
              <Button size="sm" variant="ghost" onClick={() => void action(e, 'cancel')}>Remove</Button>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Queue</h1>
          <p className="page-subtitle">
            Token-based waiting list · avg wait <strong className="num">{avgWait}m</strong> · longest <strong className="num">{maxWait}m</strong>
          </p>
        </div>
        <div className="page-actions">
          <input className="input" style={{ width: 160 }} type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Queue date" />
          <Button variant="ghost" icon={Icon.refresh} onClick={reload}>Refresh</Button>
          {can('queue.manage') && <Button variant="primary" icon={Icon.plus} onClick={() => setAddOpen(true)}>Add to queue</Button>}
        </div>
      </div>

      {loading && !data && <Spinner label="Loading queue…" />}
      {error && <ErrorState error={error} onRetry={reload} />}

      {!loading && !error && (
        <div className="grid gap-4" style={{ gridTemplateColumns: '1.3fr 1fr' }}>
          <div className="col gap-4">
            <Card title={`Now serving (${inTreatment.length})`} actions={<span className="xsmall muted">in treatment</span>}>
              {inTreatment.length === 0 ? (
                <EmptyState title="No one in treatment" body="Call the next patient when the dentist is ready." />
              ) : (
                <div className="list">{inTreatment.map((e) => row(e))}</div>
              )}
            </Card>
            <Card title={`Waiting (${waiting.length})`} actions={<span className="xsmall muted">sorted by priority then token</span>}>
              {waiting.length === 0 ? (
                <EmptyState title="Queue is empty" body="Add walk-ins or arrive patients from the appointment schedule." />
              ) : (
                <div className="list">
                  {[...waiting]
                    .sort((a, b) => b.priority - a.priority || a.queueNo - b.queueNo)
                    .map((e) => row(e))}
                </div>
              )}
            </Card>
          </div>
          <div className="col gap-4">
            <Card title="Queue stats">
              <div className="stat-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="stat-card"><div className="stat-label">Waiting</div><div className="stat-value">{waiting.length}</div></div>
                <div className="stat-card"><div className="stat-label">Completed</div><div className="stat-value">{done.filter((d) => d.status === 'completed').length}</div></div>
                <div className="stat-card"><div className="stat-label">Avg wait</div><div className="stat-value">{avgWait}m</div></div>
                <div className="stat-card"><div className="stat-label">No-shows</div><div className="stat-value">{done.filter((d) => d.status === 'cancelled').length}</div></div>
              </div>
            </Card>
            <Card title="Completed & removed">
              {done.length === 0 ? (
                <p className="small muted">Completed visits will be listed here for the day.</p>
              ) : (
                <div className="list">{done.map((e) => row(e))}</div>
              )}
            </Card>
          </div>
        </div>
      )}

      <AddToQueueModal open={addOpen} onClose={() => setAddOpen(false)} onAdded={reload} />

      {selected && (
        <Modal
          title={`Token #${selected.queueNo} — ${selected.patientName}`}
          onClose={() => setSelected(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setSelected(null)}>Close</Button>
              {can('queue.manage') && selected.status === 'waiting' && (
                <Button variant="primary" onClick={() => { void action(selected, 'call_next'); setSelected(null); }}>Call next</Button>
              )}
            </>
          }
        >
          <div className="kv-list">
            <div className="kv"><span className="k">Patient</span><span className="v">{selected.patientName} ({selected.patientCode})</span></div>
            <div className="kv"><span className="k">Arrived</span><span className="v">{new Date(selected.arrivedAt).toLocaleTimeString()}</span></div>
            <div className="kv"><span className="k">Waiting</span><span className="v">{selected.waitingMin} min</span></div>
            <div className="kv"><span className="k">Dentist</span><span className="v">{selected.dentistName ?? 'unassigned'}</span></div>
            <div className="kv"><span className="k">Status</span><span className="v">{STATUS_LABEL[selected.status]}</span></div>
            <div className="kv"><span className="k">Priority</span><span className="v">{selected.priority > 0 ? `+${selected.priority}` : 'normal'}</span></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
