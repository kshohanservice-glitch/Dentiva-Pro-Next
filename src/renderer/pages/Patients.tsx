import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, useAsync } from '../api';
import { useApp } from '../state/app-context';
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Modal, Pagination,
  Spinner, Tabs, useToast,
} from '../components/primitives';
import { Field, Input, Select, Textarea, useForm } from '../components/forms';
import { DataTable, TableToolbar, type Column } from '../components/table';
import { Icon } from '../components/shell';
import { ToothChart } from '../components/ToothChart';
import { bdt, formatDate, isoDate, localDateTime } from '../format';
import type { DuplicateCandidate, PatientDTO, PatientFilters, PatientDetailDTO, PrescriptionDTO, TreatmentDTO } from '../../shared/types';
import type { PatientInputPayload, ReferralRecord, ReferralInput } from '../../shared/ipc';

/* ================================ List ================================= */

type PatientFormValues = Omit<PatientInputPayload, 'dob' | 'ageYears'> & { dob: string; ageYears: string };

const EMPTY_FORM: PatientFormValues = {
  name: '', bengaliName: '', dob: '', ageYears: '', gender: '', bloodGroup: '',
  phone: '', phone2: '', emergencyContact: '', emergencyPhone: '',
  address: '', city: '', chiefComplaint: '', referredBy: '', preferredDentistId: null,
  status: 'active', tags: [], histories: {}, forceCreate: false,
};

function PatientFormModal(props: { open: boolean; initial?: (PatientDTO & Partial<PatientDetailDTO>) | null; onClose: () => void; onSaved: (id: number) => void }) {
  const { values, set, errors, setErrors, validate, reset } = useForm({ ...EMPTY_FORM });
  const [pending, setPending] = useState(false);
  const [dupes, setDupes] = useState<DuplicateCandidate[]>([]);
  const [forceAck, setForceAck] = useState(false);
  const { data: dentists } = useAsync(() => api['dentists/list'](true), []);
  const toast = useToast();

  useEffect(() => {
    if (!props.open) return;
    reset({
      ...EMPTY_FORM,
      ...(props.initial
        ? {
            name: props.initial.name, bengaliName: props.initial.bengaliName ?? '',
            dob: props.initial.dob ?? '', ageYears: props.initial.ageYears != null ? String(props.initial.ageYears) : '',
            gender: props.initial.gender, bloodGroup: props.initial.bloodGroup ?? '',
            phone: props.initial.phone ?? '', phone2: props.initial.phone2 ?? '',
            emergencyContact: props.initial.emergencyContact ?? '', emergencyPhone: props.initial.emergencyPhone ?? '',
            address: props.initial.address ?? '', city: props.initial.city ?? '',
            chiefComplaint: props.initial.chiefComplaint ?? '', referredBy: props.initial.referredBy ?? '',
            preferredDentistId: props.initial.preferredDentistId, status: props.initial.status, tags: props.initial.tags,
            histories: {
              allergies: props.initial.allergies ?? '',
              medications: props.initial.medications ?? '',
              previous: props.initial.previousProblems ?? '',
              medical: props.initial.medicalHistory ?? '',
              dental: props.initial.dentalHistory ?? '',
              notes: props.initial.notes ?? '',
            },
          }
        : {}),
    });
    setDupes([]);
    setForceAck(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, props.initial?.id]);

  useEffect(() => {
    if ((values.phone ?? '').replace(/\D/g, '').length >= 6 || values.name.trim().length >= 4) {
      const t = setTimeout(() => {
        api['patients/duplicates']({ name: values.name, phone: values.phone })
          .then(setDupes)
          .catch(() => setDupes([]));
      }, 400);
      return () => clearTimeout(t);
    }
    setDupes([]);
  }, [values.name, values.phone]);

  const submit = async () => {
    const ok = validate((v) => ({
      name: v.name.trim().length < 2 ? 'Patient name is required (at least 2 characters).' : '',
      gender: !v.gender ? 'Select a gender.' : '',
      phone: (v.phone ?? '') && !/^01[3-9]\d{8}$/.test((v.phone ?? '').replace(/\D/g, '')) && (v.phone ?? '').replace(/\D/g, '').length < 11
        ? 'Enter a valid Bangladeshi mobile number (01XXXXXXXXX).'
        : '',
      ageYears: v.ageYears && (Number(v.ageYears) < 0 || Number(v.ageYears) > 120) ? 'Age must be 0–120.' : '',
      dob: v.dob && new Date(v.dob).getTime() > Date.now() ? 'Date of birth cannot be in the future.' : '',
    }));
    if (!ok) return;
    const payload: PatientInputPayload = {
      ...values,
      dob: values.dob || null,
      ageYears: values.ageYears === '' ? null : Number(values.ageYears),
      preferredDentistId: values.preferredDentistId ?? null,
      forceCreate: forceAck,
    };
    setPending(true);
    setErrors({});
    try {
      const saved = props.initial
        ? await api['patients/update']({ id: props.initial.id, ...payload })
        : await api['patients/create'](payload);
      toast.success(props.initial ? 'Patient updated' : 'Patient registered', `${saved.name} · ${saved.code}`);
      props.onSaved(saved.id);
      props.onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed.';
      if (/duplicate|already exists/i.test(msg)) setErrors({ name: msg });
      else toast.error('Save failed', msg);
    } finally {
      setPending(false);
    }
  };

  if (!props.open) return null;
  return (
    <Modal
      title={props.initial ? `Edit patient — ${props.initial.name}` : 'Register new patient'}
      onClose={props.onClose}
      width="wide"
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={() => void submit()}>
            {props.initial ? 'Save changes' : 'Register patient'}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Full name" required error={errors.name} className="span-2">
          {(id) => <Input id={id} value={values.name} onChange={(v) => set('name', v)} placeholder="Patient name" invalid={!!errors.name} />}
        </Field>
        <Field label="নাম (Bengali)">
          {(id) => <Input id={id} value={values.bengaliName ?? ''} onChange={(v) => set('bengaliName', v)} placeholder="বাংলায় নাম" />}
        </Field>
        <Field label="Gender" required error={errors.gender}>
          {(id) => (
            <Select
              id={id}
              value={values.gender}
              onChange={(v) => set('gender', v)}
              placeholder="Select…"
              invalid={!!errors.gender}
              options={[
                { value: 'male', label: 'Male' },
                { value: 'female', label: 'Female' },
                { value: 'other', label: 'Other' },
              ]}
            />
          )}
        </Field>
        <Field label="Date of birth" error={errors.dob}>
          {(id) => <Input id={id} type="date" value={values.dob ?? ''} onChange={(v) => set('dob', v)} invalid={!!errors.dob} />}
        </Field>
        <Field label="Age (years)" hint="Alternative to DOB" error={errors.ageYears}>
          {(id) => <Input id={id} type="number" min={0} max={120} value={values.ageYears} onChange={(v) => set('ageYears', v)} invalid={!!errors.ageYears} />}
        </Field>
        <Field label="Blood group">
          {(id) => (
            <Select
              id={id}
              value={values.bloodGroup ?? ''}
              onChange={(v) => set('bloodGroup', v)}
              placeholder="Unknown"
              options={['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((b) => ({ value: b, label: b }))}
            />
          )}
        </Field>
        <Field label="Mobile number" hint="01XXXXXXXXX">
          {(id) => <Input id={id} value={values.phone ?? ''} onChange={(v) => set('phone', v)} placeholder="01XXXXXXXXX" />}
        </Field>
        <Field label="Alternate phone">
          {(id) => <Input id={id} value={values.phone2 ?? ''} onChange={(v) => set('phone2', v)} />}
        </Field>
        <Field label="City / area">
          {(id) => <Input id={id} value={values.city ?? ''} onChange={(v) => set('city', v)} placeholder="e.g. Dhanmondi, Dhaka" />}
        </Field>
        <Field label="Address" className="span-2">
          {(id) => <Textarea id={id} rows={2} value={values.address ?? ''} onChange={(v) => set('address', v)} />}
        </Field>
        <Field label="Emergency contact name">
          {(id) => <Input id={id} value={values.emergencyContact ?? ''} onChange={(v) => set('emergencyContact', v)} />}
        </Field>
        <Field label="Emergency phone">
          {(id) => <Input id={id} value={values.emergencyPhone ?? ''} onChange={(v) => set('emergencyPhone', v)} />}
        </Field>
        <Field label="Chief complaint (at registration)">
          {(id) => <Input id={id} value={values.chiefComplaint ?? ''} onChange={(v) => set('chiefComplaint', v)} placeholder="e.g. tooth pain" />}
        </Field>
        <Field label="Referred by">
          {(id) => <Input id={id} value={values.referredBy ?? ''} onChange={(v) => set('referredBy', v)} />}
        </Field>
        <Field label="Preferred dentist">
          {(id) => (
            <Select
              id={id}
              value={String(values.preferredDentistId ?? '')}
              onChange={(v) => set('preferredDentistId', v ? Number(v) : null)}
              placeholder="No preference"
              options={(dentists ?? []).filter((d) => d.active).map((d) => ({ value: String(d.id), label: d.name }))}
            />
          )}
        </Field>
        <Field label="Status">
          {(id) => (
            <Select
              id={id}
              value={values.status ?? 'active'}
              onChange={(v) => set('status', v)}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'blocked', label: 'Blocked' },
              ]}
            />
          )}
        </Field>
        <Field label="Allergies">
          {(id) => <Input id={id} value={values.histories?.allergies ?? ''} onChange={(v) => set('histories', { ...values.histories, allergies: v })} placeholder="e.g. Penicillin, Lidocaine" />}
        </Field>
        <Field label="Current medications">
          {(id) => <Input id={id} value={values.histories?.medications ?? ''} onChange={(v) => set('histories', { ...values.histories, medications: v })} placeholder="e.g. Metformin 500mg" />}
        </Field>
        <Field label="Medical history">
          {(id) => <Input id={id} value={values.histories?.medical ?? ''} onChange={(v) => set('histories', { ...values.histories, medical: v })} placeholder="e.g. Hypertension, Diabetes" />}
        </Field>
        <Field label="Dental history">
          {(id) => <Input id={id} value={values.histories?.dental ?? ''} onChange={(v) => set('histories', { ...values.histories, dental: v })} placeholder="Prior RCT, extractions, ortho" />}
        </Field>
        <Field label="Previous problems">
          {(id) => <Input id={id} value={values.histories?.previous ?? ''} onChange={(v) => set('histories', { ...values.histories, previous: v })} />}
        </Field>
        <Field label="Clinical notes">
          {(id) => <Input id={id} value={values.histories?.notes ?? ''} onChange={(v) => set('histories', { ...values.histories, notes: v })} />}
        </Field>
      </div>

      {dupes.length > 0 && (
        <div className="alert alert-warning mt-4">
          <div className="col" style={{ width: '100%', gap: 6 }}>
            <strong>Possible duplicate patient{dupes.length > 1 ? 's' : ''} found</strong>
            {dupes.map((d) => (
              <span key={d.id} className="small">
                {d.name} · <span className="mono">{d.code}</span> · {d.phone ?? 'no phone'} — {d.reason} ({Math.round(d.score * 100)}% match)
              </span>
            ))}
            {!props.initial && (
              <label className="checkbox mt-2">
                <input type="checkbox" checked={forceAck} onChange={(e) => setForceAck(e.target.checked)} />
                <span>I checked these records — create a separate record anyway</span>
              </label>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

export function PatientsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { can } = useApp();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [range, setRange] = useState('all');
  const [status, setStatus] = useState('active');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [formOpen, setFormOpen] = useState(params.get('new') === '1');
  const [visitOpen, setVisitOpen] = useState(params.get('newVisit') === '1');
  const [exporting, setExporting] = useState(false);
  const toast = useToast();

  const filters: PatientFilters = useMemo(
    () => ({ query: query || undefined, range: range as any, status: status || undefined, page, pageSize, sort: 'name', dir: 'asc' }),
    [query, range, status, page, pageSize],
  );

  const { data, loading, error, reload } = useAsync(() => api['patients/list'](filters), [JSON.stringify(filters)]);

  useEffect(() => {
    let changed = false;
    if (params.get('new') === '1') {
      setFormOpen(true);
      params.delete('new');
      changed = true;
    }
    if (params.get('newVisit') === '1') {
      setVisitOpen(true);
      params.delete('newVisit');
      changed = true;
    }
    if (changed) setParams(params, { replace: true });
  }, [params, setParams]);

  const doExport = async () => {
    setExporting(true);
    try {
      const res = await api['patients/export'](filters);
      if ('cancelled' in res) return;
      toast.success('Export complete', `${res.count} patients → ${res.path}`);
    } catch (err) {
      toast.fromError(err, 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const columns: Column<PatientDTO>[] = [
    {
      key: 'name', label: 'Patient', sortValue: (r) => r.name,
      render: (r) => (
        <div className="row" style={{ gap: 8 }}>
          <div className="avatar xs">{r.name.slice(0, 1).toUpperCase()}</div>
          <div>
            <strong>{r.name}</strong>
            {r.bengaliName && <div className="xsmall muted">{r.bengaliName}</div>}
            <div className="xsmall muted mono">{r.code}</div>
          </div>
        </div>
      ),
    },
    { key: 'phone', label: 'Phone', render: (r) => <span className="mono">{r.phone ?? '—'}</span> },
    { key: 'age', label: 'Age / Sex', sortValue: (r) => r.ageYears ?? 999, render: (r) => `${r.ageText ?? (r.ageYears != null ? `${r.ageYears}y` : '—')} · ${r.gender}` },
    { key: 'lastVisit', label: 'Last visit', sortValue: (r) => r.lastVisitAt ?? '', render: (r) => (r.lastVisitAt ? formatDate(r.lastVisitAt) : <span className="muted">never</span>) },
    { key: 'visits', label: 'Visits', align: 'right', sortValue: (r) => r.visitCount, render: (r) => <span className="num">{r.visitCount}</span> },
    { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'active' ? 'success' : r.status === 'blocked' ? 'danger' : 'neutral'}>{r.status}</Badge> },
    { key: 'city', label: 'Area', clip: true, render: (r) => r.city ?? r.address ?? '—' },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Patients</h1>
          <p className="page-subtitle">{data?.total ?? 0} records · unlimited, stored on this computer</p>
        </div>
        <div className="page-actions">
          {can('data.export') && <Button variant="secondary" loading={exporting} onClick={() => void doExport()}>Export CSV</Button>}
          {can('patients.create') && (
            <Button variant="primary" icon={Icon.plus} onClick={() => setFormOpen(true)}>Register patient</Button>
          )}
        </div>
      </div>

      <TableToolbar
        right={
          <Button variant="ghost" size="sm" icon={Icon.refresh} onClick={reload}>Refresh</Button>
        }
      >
        <div style={{ minWidth: 260, flex: '1 1 260px' }}>
          <Input value={query} onChange={(v) => { setQuery(v); setPage(1); }} placeholder="Search name, phone, patient ID, tag…" />
        </div>
        <Select
          value={range}
          onChange={(v) => { setRange(v); setPage(1); }}
          options={[
            { value: 'all', label: 'All time' }, { value: 'today', label: 'Today' },
            { value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' },
            { value: '90', label: 'Last 90 days' }, { value: '365', label: 'Last year' },
          ]}
        />
        <Select
          value={status}
          onChange={(v) => { setStatus(v); setPage(1); }}
          options={[
            { value: 'active', label: 'Active' }, { value: 'archived', label: 'Archived' },
            { value: 'blocked', label: 'Blocked' }, { value: '', label: 'Any status' },
          ]}
        />
      </TableToolbar>

      <Card pad={false}>
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(r) => r.id}
          loading={loading}
          error={error}
          onRetry={reload}
          onRowClick={(r) => navigate(`/patients/${r.id}`)}
          empty={{
            title: query ? `No patients match “${query}”` : 'No patients yet',
            body: query ? 'Try a different spelling, phone number or patient ID.' : 'Register your first patient to begin recording visits.',
            action: can('patients.create') ? <Button variant="primary" onClick={() => setFormOpen(true)}>Register patient</Button> : undefined,
          }}
        />
        {data && <Pagination page={page} pageSize={pageSize} total={data.total} onPage={setPage} />}
      </Card>

      <PatientFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={(id) => { reload(); navigate(`/patients/${id}`); }}
      />
      {visitOpen && (
        <VisitFormModal
          patientId={0}
          onClose={() => setVisitOpen(false)}
          onSaved={() => { setVisitOpen(false); reload(); }}
        />
      )}
    </div>
  );
}

/* ============================== Profile ================================ */

type ProfileTab = 'overview' | 'visits' | 'chart' | 'rx' | 'invoices' | 'referrals' | 'files' | 'history';

export function PatientProfilePage() {
  const { id } = useParams();
  const patientId = Number(id);
  const navigate = useNavigate();
  const { can } = useApp();
  const toast = useToast();
  const [tab, setTab] = useState<ProfileTab>('overview');
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [visitOpen, setVisitOpen] = useState(false);
  const [rxOpen, setRxOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [referralOpen, setReferralOpen] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const { data: patient, loading, error, reload } = useAsync(() => api['patients/get'](patientId), [patientId, refreshTick]);

  if (loading && !patient) return <Spinner label="Loading patient…" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!patient) return <EmptyState title="Patient not found" body="The record may have been deleted." />;

  const tabs = [
    { key: 'overview' as const, label: 'Overview' },
    { key: 'visits' as const, label: 'Visits' },
    { key: 'chart' as const, label: 'Dental chart' },
    { key: 'rx' as const, label: 'Prescriptions' },
    { key: 'invoices' as const, label: 'Invoices' },
    ...(can('clinical.view') ? [{ key: 'referrals' as const, label: 'Referrals' }] : []),
    { key: 'files' as const, label: 'Attachments' },
    { key: 'history' as const, label: 'History' },
  ];

  return (
    <div className="page">
      <div className="breadcrumbs">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/patients')}>← Patients</button>
        <span>/</span>
        <span>{patient.name}</span>
      </div>

      <div className="patient-header card card-pad">
        <div className="avatar lg">{patient.name.slice(0, 1).toUpperCase()}</div>
        <div className="flex-1">
          <div className="row gap-2 wrap">
            <h1 className="page-title" style={{ fontSize: 22 }}>{patient.name}</h1>
            <Badge tone={patient.status === 'active' ? 'success' : patient.status === 'blocked' ? 'danger' : 'neutral'}>{patient.status}</Badge>
            {patient.tags.map((t) => <Badge key={t} tone="brand">{t}</Badge>)}
          </div>
          <div className="patient-meta">
            <span className="mono">{patient.code}</span>
            <span>{patient.ageText ?? (patient.ageYears != null ? `${patient.ageYears} years` : 'age —')} · {patient.gender}</span>
            {patient.bloodGroup && <span>Blood {patient.bloodGroup}</span>}
            <span>{patient.phone ?? 'no phone'}</span>
            <span>{patient.city ?? patient.address ?? ''}</span>
            <span>Registered {formatDate(patient.registrationDate)}</span>
            <span>{patient.visitCount} visit{patient.visitCount === 1 ? '' : 's'}</span>
            {patient.preferredDentistName && <span>Preferred: {patient.preferredDentistName}</span>}
          </div>
        </div>
        <div className="col gap-2" style={{ alignItems: 'stretch' }}>
          {can('clinical.visit.create') && <Button variant="primary" onClick={() => setVisitOpen(true)}>New visit</Button>}
          {can('clinical.prescription.create') && <Button variant="secondary" onClick={() => setRxOpen(true)}>New prescription</Button>}
          {can('appointments.manage') && <Button variant="secondary" onClick={() => navigate(`/appointments?patient=${patient.id}&new=1`)}>Book appointment</Button>}
          {can('billing.invoice.create') && <Button variant="secondary" onClick={() => setInvoiceOpen(true)}>Create invoice</Button>}
          <div className="row gap-2">
            {can('patients.edit') && <Button variant="ghost" size="sm" onClick={() => setEditOpen(true)}>Edit</Button>}
            {can('patients.delete') && patient.status !== 'archived' && (
              <Button variant="ghost" size="sm" onClick={() => setArchiveOpen(true)}>Archive</Button>
            )}
            {can('patients.delete') && (
              <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(true)}>Delete</Button>
            )}
          </div>
        </div>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      <div className="mt-4">
        {tab === 'overview' && <OverviewTab patient={patient} onGoto={setTab} />}
        {tab === 'visits' && <VisitsTab patientId={patient.id} refreshKey={refreshTick} onCreate={() => setVisitOpen(true)} />}
        {tab === 'chart' && (
          <Card title="Odontogram" actions={<span className="xsmall muted">Click to select · double-click a tooth to clear · history preserved per visit</span>}>
            <ToothChart patientId={patient.id} editable={can('clinical.chart.edit')} />
          </Card>
        )}
        {tab === 'rx' && (
          <Card title="Prescriptions" actions={can('clinical.prescription.create') ? <Button size="sm" variant="primary" onClick={() => setRxOpen(true)}>New prescription</Button> : undefined}>
            <PrescriptionsForPatient patientId={patient.id} refreshKey={refreshTick} onPrint={(rxId) => void api['reports/print']({ type: 'prescription', id: rxId })} />
          </Card>
        )}
        {tab === 'invoices' && (
          <Card title="Invoices" actions={<Button size="sm" variant="primary" onClick={() => setInvoiceOpen(true)}>New invoice</Button>}>
            <InvoicesForPatient patientId={patient.id} refreshKey={refreshTick} onOpen={(invId) => navigate(`/invoices?invoice=${invId}`)} />
          </Card>
        )}
        {tab === 'referrals' && <ReferralsTab patientId={patient.id} canManage={can('clinical.referral.manage')} onCreate={() => setReferralOpen(true)} />}
        {tab === 'files' && <AttachmentsTab entityType="patient" entityId={patient.id} />}
        {tab === 'history' && <TimelineTab patientId={patient.id} refreshKey={refreshTick} />}
      </div>

      <PatientFormModal open={editOpen} initial={patient} onClose={() => setEditOpen(false)} onSaved={() => reload()} />

      {archiveOpen && (
        <ConfirmDialog
          title="Archive patient?"
          body={`${patient.name} (${patient.code}) will be hidden from active lists. Their visits, invoices and history remain intact and searchable via the Archived filter.`}
          confirmLabel="Archive"
          danger
          onConfirm={async () => {
            try {
              await api['patients/archive'](patient.id);
              toast.success('Patient archived');
              setArchiveOpen(false);
              reload();
            } catch (err) {
              toast.fromError(err, 'Archive failed');
            }
          }}
          onCancel={() => setArchiveOpen(false)}
        />
      )}

      {deleteOpen && (
        <ConfirmDialog
          title="Delete patient record?"
          body={`${patient.name} (${patient.code}) will be removed from active patient records. Clinical, invoice, payment and audit history will be preserved.`}
          confirmLabel="Delete patient"
          danger
          onConfirm={async () => {
            try {
              await api['patients/delete'](patient.id);
              toast.success('Patient deleted');
              setDeleteOpen(false);
              navigate('/patients');
            } catch (err) {
              toast.fromError(err, 'Delete failed');
            }
          }}
          onCancel={() => setDeleteOpen(false)}
        />
      )}

      {visitOpen && <VisitFormModal patientId={patient.id} onClose={() => setVisitOpen(false)} onSaved={() => { setVisitOpen(false); setRefreshTick((n) => n + 1); setTab('visits'); }} />}
      {rxOpen && <RxFormModal patientId={patient.id} onClose={() => setRxOpen(false)} onSaved={() => { setRxOpen(false); setRefreshTick((n) => n + 1); setTab('rx'); }} />}
      {referralOpen && <ReferralFormModal patientId={patient.id} onClose={() => setReferralOpen(false)} onSaved={() => { setReferralOpen(false); setRefreshTick((n) => n + 1); setTab('referrals'); }} />}
      {invoiceOpen && <InvoiceFormModal patientId={patient.id} onClose={() => setInvoiceOpen(false)} onSaved={(invId) => { setInvoiceOpen(false); setRefreshTick((n) => n + 1); setTab('invoices'); navigate(`/invoices?invoice=${invId}`); }} />}
    </div>
  );
}

function ReferralsTab(props: { patientId: number; canManage: boolean; onCreate: () => void }) {
  const { data, loading, error, reload } = useAsync(() => api['referrals/list'](props.patientId), [props.patientId]);
  const [editing, setEditing] = useState<ReferralRecord | null>(null);
  if (loading && !data) return <Card title="Referrals"><Spinner label="Loading referrals…" /></Card>;
  if (error) return <Card title="Referrals"><ErrorState error={error} onRetry={reload} /></Card>;
  const rows = data ?? [];
  return (
    <>
      <Card title="Referrals" actions={props.canManage ? <Button size="sm" variant="primary" onClick={props.onCreate}>New referral</Button> : undefined}>
        {rows.length === 0 ? <EmptyState title="No referrals" body="Referral records for this patient will appear here." /> : (
          <div className="list">
            {rows.map((r) => (
              <div key={r.id} className="list-row">
                <div className="flex-1">
                  <div className="row gap-2"><strong>{r.direction === 'out' ? 'Outgoing' : 'Incoming'}</strong><Badge tone={r.status === 'completed' ? 'success' : r.status === 'cancelled' ? 'danger' : 'warning'}>{r.status}</Badge></div>
                  <div className="small">{r.person || r.clinic || 'Referral'}{r.specialty ? ' · ' + r.specialty : ''}</div>
                  <div className="xsmall muted">{formatDate(r.date)}{r.reason ? ' · ' + r.reason : ''}{r.follow_up ? ' · Follow-up ' + formatDate(r.follow_up) : ''}</div>
                </div>
                {props.canManage && <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Edit</Button>}
              </div>
            ))}
          </div>
        )}
      </Card>
      {editing && <ReferralFormModal patientId={props.patientId} initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </>
  );
}

function ReferralFormModal(props: { patientId: number; initial?: ReferralRecord | null; onClose: () => void; onSaved: (id: number) => void }) {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [values, setValues] = useState<ReferralInput>(() => ({
    patientId: props.patientId, direction: props.initial?.direction ?? 'out', person: props.initial?.person ?? '',
    clinic: props.initial?.clinic ?? '', specialty: props.initial?.specialty ?? '', reason: props.initial?.reason ?? '',
    date: props.initial?.date ?? isoDate(new Date()), status: props.initial?.status ?? 'open',
    followUp: props.initial?.follow_up ?? '', note: props.initial?.note ?? '',
    ...(props.initial?.id ? { id: props.initial.id } : {}),
  }));
  const set = (key: keyof ReferralInput, value: unknown) => setValues((v) => ({ ...v, [key]: value }));
  const submit = async () => {
    if (!values.date) { toast.warning('Date required', 'Choose the referral date.'); return; }
    setPending(true);
    try {
      const saved = await api['referrals/save']({ ...values, patientId: props.patientId });
      toast.success(props.initial ? 'Referral updated' : 'Referral recorded');
      props.onSaved(saved.id);
    } catch (err) {
      toast.fromError(err, props.initial ? 'Could not update referral' : 'Could not save referral');
    } finally { setPending(false); }
  };
  return (
    <Modal title={props.initial ? 'Edit referral' : 'New referral'} onClose={props.onClose} width="wide" footer={<><Button variant="secondary" onClick={props.onClose}>Cancel</Button><Button variant="primary" loading={pending} onClick={() => void submit()}>Save referral</Button></>}>
      <div className="form-grid">
        <Field label="Direction">{(id) => <Select id={id} value={values.direction ?? 'out'} onChange={(v) => set('direction', v)} options={[{ value: 'out', label: 'Outgoing — refer this patient' }, { value: 'in', label: 'Incoming — referred to us' }]} />}</Field>
        <Field label="Date" required>{(id) => <Input id={id} type="date" value={values.date} onChange={(v) => set('date', v)} />}</Field>
        <Field label="Person">{(id) => <Input id={id} value={values.person ?? ''} onChange={(v) => set('person', v)} placeholder="Doctor / contact person" />}</Field>
        <Field label="Clinic / hospital">{(id) => <Input id={id} value={values.clinic ?? ''} onChange={(v) => set('clinic', v)} />}</Field>
        <Field label="Specialty">{(id) => <Input id={id} value={values.specialty ?? ''} onChange={(v) => set('specialty', v)} placeholder="Orthodontics, Oral Surgery…" />}</Field>
        <Field label="Status">{(id) => <Select id={id} value={values.status ?? 'open'} onChange={(v) => set('status', v)} options={[{ value: 'open', label: 'Open' }, { value: 'completed', label: 'Completed' }, { value: 'cancelled', label: 'Cancelled' }]} />}</Field>
        <Field label="Reason" className="span-2">{(id) => <Textarea id={id} rows={3} value={values.reason ?? ''} onChange={(v) => set('reason', v)} />}</Field>
        <Field label="Follow-up date">{(id) => <Input id={id} type="date" value={values.followUp ?? ''} onChange={(v) => set('followUp', v)} />}</Field>
        <Field label="Note" className="span-2">{(id) => <Textarea id={id} rows={3} value={values.note ?? ''} onChange={(v) => set('note', v)} />}</Field>
      </div>
    </Modal>
  );
}
function OverviewTab(props: { patient: PatientDetailDTO; onGoto: (t: ProfileTab) => void }) {
  const p = props.patient;
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <Card title="Medical & dental history">
        <div className="kv-list">
          <div className="kv"><span className="k">Allergies</span><span className="v">{p.allergies || 'None recorded'}</span></div>
          <div className="kv"><span className="k">Current medications</span><span className="v">{p.medications || '—'}</span></div>
          <div className="kv"><span className="k">Previous problems</span><span className="v">{p.previousProblems || '—'}</span></div>
          <div className="kv"><span className="k">Medical history</span><span className="v">{p.medicalHistory || '—'}</span></div>
          <div className="kv"><span className="k">Dental history</span><span className="v">{p.dentalHistory || '—'}</span></div>
          <div className="kv"><span className="k">Notes</span><span className="v">{p.notes || '—'}</span></div>
        </div>
      </Card>
      <Card title="Contact & registration">
        <div className="kv-list">
          <div className="kv"><span className="k">Phone</span><span className="v mono">{p.phone || '—'}</span></div>
          <div className="kv"><span className="k">Alternate</span><span className="v mono">{p.phone2 || '—'}</span></div>
          <div className="kv"><span className="k">Address</span><span className="v">{p.address || '—'}</span></div>
          <div className="kv"><span className="k">Emergency</span><span className="v">{p.emergencyContact ? `${p.emergencyContact} (${p.emergencyPhone ?? ''})` : '—'}</span></div>
          <div className="kv"><span className="k">Referred by</span><span className="v">{p.referredBy || '—'}</span></div>
          <div className="kv"><span className="k">Chief complaint</span><span className="v">{p.chiefComplaint || '—'}</span></div>
        </div>
      </Card>
      <Card title="Latest chart findings" className="span-2">
        <div className="row gap-2 wrap">
          <span className="small muted">Dentition hint: {p.ageYears != null && p.ageYears < 13 ? 'likely pediatric/mixed' : 'permanent'}</span>
          <Button size="sm" variant="ghost" onClick={() => props.onGoto('chart')}>Open full chart →</Button>
        </div>
        <ToothChart patientId={p.id} dentition={p.ageYears != null && p.ageYears < 13 ? 'mixed' : 'permanent'} editable={false} />
      </Card>
    </div>
  );
}

function VisitsTab(props: { patientId: number; refreshKey?: number; onCreate: () => void }) {
  const { can } = useApp();
  const { data, loading, error, reload } = useAsync(() => api['visits/list']({ patientId: props.patientId, pageSize: 100 }), [props.patientId, props.refreshKey]);
  const toast = useToast();

  const printSummary = async (visitId: number) => {
    try {
      await api['reports/print']({ type: 'visit-summary', id: visitId } as any);
    } catch (err) {
      toast.fromError(err, 'Could not open print preview');
    }
  };

  if (loading && !data) return <Spinner label="Loading visits…" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const items = data?.items ?? [];
  return (
    <>
      <div className="row between mb-4">
        <span className="small muted">{items.length} visit{items.length === 1 ? '' : 's'} on record</span>
        <Button size="sm" variant="primary" onClick={props.onCreate}>New visit</Button>
      </div>
      {items.length === 0 ? (
        <EmptyState title="No visits recorded" body="Record the first visit to start this patient's clinical history." action={<Button variant="primary" onClick={props.onCreate}>New visit</Button>} />
      ) : (
        items.map((v) => (
          <div className="mini-visit" key={v.id}>
            <div className="row between wrap">
              <div>
                <strong>{new Date(v.datetime).toLocaleString()}</strong>{' '}
                <Badge tone={v.status === 'open' ? 'warning' : 'neutral'}>{v.status}</Badge>
                <div className="small muted">{v.dentistName ?? 'Any dentist'} · {v.chiefComplaint || 'no complaint recorded'}</div>
              </div>
              <div className="row gap-2">
                {v.status === 'open' && can('clinical.visit.edit') && (
                  <Button size="sm" variant="ghost" onClick={() => {
                    void api['visits/update']({ id: v.id, status: 'closed' } as any)
                      .then(() => { toast.success('Visit completed'); reload(); })
                      .catch((err) => toast.fromError(err, 'Could not complete visit'));
                  }}>Complete visit</Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => void printSummary(v.id)}>Print summary</Button>
              </div>
            </div>
            {v.diagnosis && <div className="small mt-2"><strong>Diagnosis:</strong> {v.diagnosis}</div>}
            {v.treatmentPlan && <div className="small"><strong>Plan:</strong> {v.treatmentPlan}</div>}
            {v.advice && <div className="small"><strong>Advice:</strong> {v.advice}</div>}
            {v.followUpDate && <div className="xsmall muted">Follow-up: {formatDate(v.followUpDate)}</div>}
          </div>
        ))
      )}
    </>
  );
}

export function RxDetailModal(props: { rx: PrescriptionDTO; onClose: () => void; onDeleted?: () => void }) {
  const { rx } = props;
  const { can } = useApp();
  const toast = useToast();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const print = async (kind: 'prescription' | 'prescription-duplicate') => {
    try {
      await api['reports/print']({ type: kind, id: rx.id } as any);
    } catch (err) {
      toast.fromError(err, 'Could not open print preview');
    }
  };
  return (
    <Modal
      title={`Prescription ${rx.number}`}
      onClose={props.onClose}
      width="wide"
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose}>Close</Button>
          {can('data.delete') && <Button variant="ghost" onClick={() => setDeleteOpen(true)}>Delete</Button>}
          <Button variant="secondary" onClick={() => void print('prescription-duplicate')}>Print duplicate (watermarked)</Button>
          <Button variant="primary" icon={Icon.print} onClick={() => void print('prescription')}>Print</Button>
        </>
      }
    >
      <div className="kv-list mb-4">
        <div className="kv"><span className="k">Patient</span><span className="v">{rx.patientName} ({rx.patientCode})</span></div>
        <div className="kv"><span className="k">Date</span><span className="v">{formatDate(rx.date)}</span></div>
        <div className="kv"><span className="k">Dentist</span><span className="v">{rx.dentistName}</span></div>
        {rx.diagnosis && <div className="kv"><span className="k">Diagnosis</span><span className="v">{rx.diagnosis}</span></div>}
        {rx.cC && <div className="kv"><span className="k">C/C</span><span className="v">{rx.cC}</span></div>}
        {rx.oE && <div className="kv"><span className="k">O/E</span><span className="v">{rx.oE}</span></div>}
        {rx.rE && <div className="kv"><span className="k">R/E</span><span className="v">{rx.rE}</span></div>}
        {rx.treatment && <div className="kv"><span className="k">Treatment</span><span className="v">{rx.treatment}</span></div>}
        {rx.advice && <div className="kv"><span className="k">Advice</span><span className="v">{rx.advice}</span></div>}
        {rx.followUp && <div className="kv"><span className="k">Follow-up</span><span className="v">{formatDate(rx.followUp)}</span></div>}
      </div>
      <table className="table">
        <thead>
          <tr><th>#</th><th>Medicine</th><th>Dosage</th><th>Frequency</th><th>Duration</th></tr>
        </thead>
        <tbody>
          {rx.items.map((it, i) => (
            <tr key={i}>
              <td className="num">{i + 1}</td>
              <td>
                <strong>{it.medicineName}</strong>
                {it.strength && <span className="muted"> ({it.strength})</span>}
                {it.generic && <div className="xsmall muted">{it.generic}</div>}
              </td>
              <td>{it.dosage ?? '—'}</td>
              <td>{it.frequency ?? '—'}</td>
              <td>{it.duration ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {deleteOpen && <ConfirmDialog
        title="Delete prescription?"
        body={`Prescription ${rx.number} will be hidden from the records and cannot be restored from the app.`}
        confirmLabel="Delete prescription"
        danger
        onCancel={() => setDeleteOpen(false)}
        onConfirm={async () => {
          try {
            await api['prescriptions/delete'](rx.id);
            toast.success('Prescription deleted', rx.number);
            setDeleteOpen(false);
            props.onDeleted?.();
          } catch (err) {
            toast.fromError(err, 'Could not delete prescription');
          }
        }}
      />}
    </Modal>
  );
}

function PrescriptionsForPatient(props: { patientId: number; refreshKey?: number; onPrint: (id: number) => void }) {
  const { data, loading, error, reload } = useAsync(() => api['prescriptions/list']({ patientId: props.patientId, pageSize: 100 }), [props.patientId, props.refreshKey]);
  const [detail, setDetail] = useState<PrescriptionDTO | null>(null);
  if (loading && !data) return <Spinner label="Loading prescriptions…" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const items = data?.items ?? [];
  if (items.length === 0) return <EmptyState title="No prescriptions" body="Create a prescription from the New visit flow or the button above." />;
  return (
    <>
      <div className="list">
        {items.map((rx) => (
          <div className="list-row clickable" key={rx.id} onClick={() => setDetail(rx)}>
            <span className="flex-1">
              <strong className="mono">{rx.number}</strong>
              <div className="xsmall muted">
                {formatDate(rx.date)} · {rx.dentistName} · {rx.items.length} medicine{rx.items.length === 1 ? '' : 's'}
              </div>
            </span>
            <span className="small muted truncate" style={{ maxWidth: 320 }}>
              {rx.items.map((i) => i.medicineName).join(', ')}
            </span>
            <div className="row gap-2" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" variant="ghost" onClick={() => setDetail(rx)}>View</Button>
              <Button size="sm" variant="secondary" onClick={() => props.onPrint(rx.id)}>Print</Button>
            </div>
          </div>
        ))}
      </div>
      {detail && <RxDetailModal rx={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

function InvoicesForPatient(props: { patientId: number; refreshKey?: number; onOpen: (id: number) => void }) {
  const { data, loading, error, reload } = useAsync(() => api['invoices/list']({ patientId: props.patientId, pageSize: 100 }), [props.patientId, props.refreshKey]);
  if (loading && !data) return <Spinner label="Loading invoices…" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const items = data?.items ?? [];
  if (items.length === 0) return <EmptyState title="No invoices" body="Billing history for this patient will appear here." />;
  return (
    <div className="list">
      {items.map((inv) => (
        <div className="list-row clickable" key={inv.id} onClick={() => props.onOpen(inv.id)}>
          <span className="mono strong">{inv.number}</span>
          <span className="flex-1 xsmall muted">{formatDate(inv.date)} · {inv.items.length} line(s)</span>
          <span className="num small">{bdt(inv.totalPaisa)}</span>
          <Badge tone={inv.status === 'paid' ? 'success' : inv.status === 'voided' ? 'danger' : inv.status === 'partial' ? 'warning' : 'info'}>{inv.status}</Badge>
        </div>
      ))}
    </div>
  );
}

function AttachmentsTab(props: { entityType: string; entityId: number }) {
  const { data, loading, reload } = useAsync(
    () => api['attachments/list']({ entityType: props.entityType, entityId: props.entityId }),
    [props.entityType, props.entityId],
  );
  const toast = useToast();
  const { can } = useApp();

  const add = async () => {
    try {
      const res = await api['attachments/add']({ entityType: props.entityType, entityId: props.entityId });
      if ('cancelled' in res) return;
      toast.success('Attachment added', res.originalName);
      reload();
    } catch (err) {
      toast.fromError(err, 'Attachment failed');
    }
  };

  return (
    <Card
      title="Attachments"
      actions={can('patients.edit') ? <Button size="sm" variant="secondary" onClick={() => void add()}>Add file</Button> : undefined}
    >
      {loading && !data ? (
        <Spinner label="Loading files…" />
      ) : (data ?? []).length === 0 ? (
        <EmptyState title="No attachments" body="X-rays, photos and reports can be attached to this patient." action={can('patients.edit') ? <Button variant="secondary" onClick={() => void add()}>Add file</Button> : undefined} />
      ) : (
        <div className="list">
          {data!.map((a) => (
            <div className="list-row" key={a.id}>
              <span className="flex-1">
                <strong>{a.originalName}</strong>
                <div className="xsmall muted">{a.mime} · {(a.size / 1024).toFixed(0)} KB · {new Date(a.uploadedAt).toLocaleString()} · by {a.uploadedByName}</div>
              </span>
              <Button size="sm" variant="ghost" onClick={() => void api['attachments/open'](a.id).catch(() => undefined)}>Open</Button>
              <Button size="sm" variant="ghost" onClick={() => void api['attachments/export'](a.id).catch(() => undefined)}>Save a copy</Button>
              {can('patients.edit') && (
                <Button size="sm" variant="ghost" onClick={() => {
                  void api['attachments/remove'](a.id).then(() => { toast.success('Attachment removed'); reload(); }).catch((e) => toast.fromError(e));
                }}>Remove</Button>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function TimelineTab(props: { patientId: number; refreshKey?: number }) {
  const { data, loading, error, reload } = useAsync(() => api['patients/timeline'](props.patientId), [props.patientId, props.refreshKey]);
  if (loading && !data) return <Spinner label="Loading history…" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const items = data ?? [];
  if (items.length === 0) return <EmptyState title="No history yet" body="Visits, invoices, prescriptions and chart changes appear here chronologically." />;
  return (
    <div className="timeline">
      {items.map((ev, i) => (
        <div className={`timeline-item ${ev.type === 'payment' || ev.type === 'invoice' ? 'financial' : ''}`} key={i}>
          <div className="timeline-dot" />
          <div className="timeline-card">
            <div className="timeline-head">
              <span className="timeline-title">{ev.title}</span>
              <span className="timeline-time">{new Date(ev.at).toLocaleString()}</span>
            </div>
            {ev.summary && <div className="timeline-summary">{ev.summary}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------- shared form modals -------------------------- */

export function VisitFormModal(props: { patientId: number; onClose: () => void; onSaved: (id: number) => void }) {
  const { values, set, validate, errors } = useForm({
    dentistId: '', datetime: localDateTime(new Date()), chiefComplaint: '', history: '',
    examination: '', diagnosis: '', treatmentPlan: '', advice: '', followUpDate: '', notes: '',
    treatments: [] as { treatmentId: number; qty: number; unitPricePaisa: number }[],
  });
  const { data: dentists } = useAsync(() => api['dentists/list'](), []);
  const { data: treatments } = useAsync(() => api['treatments/list'](), []);
  const [pending, setPending] = useState(false);
  const toast = useToast();
  const [patientQuery, setPatientQuery] = useState('');
  const [chosenPatient, setChosenPatient] = useState<{ id: number; name: string; code: string } | null>(
    props.patientId ? { id: props.patientId, name: '', code: '' } : null,
  );
  const [patientMatches, setPatientMatches] = useState<{ id: number; name: string; code: string }[]>([]);

  React.useEffect(() => {
    if (props.patientId) return;
    if (patientQuery.trim().length < 2) { setPatientMatches([]); return; }
    const t = setTimeout(() => {
      api['patients/list']({ query: patientQuery, pageSize: 8, status: 'active' })
        .then((res) => setPatientMatches(res.items.map((p) => ({ id: p.id, name: p.name, code: p.code }))))
        .catch(() => setPatientMatches([]));
    }, 200);
    return () => clearTimeout(t);
  }, [patientQuery, props.patientId]);

  const submit = async () => {
    const ok = validate((v) => ({
      datetime: !v.datetime ? 'Date & time required.' : '',
      dentistId: !v.dentistId ? 'Select the treating dentist.' : '',
    }));
    if (!ok) return;
    if (!props.patientId && !chosenPatient) {
      toast.warning('Select a patient', 'Search and choose the patient first.');
      return;
    }
    setPending(true);
    try {
      const visit = await api['visits/create']({
        patientId: props.patientId || chosenPatient!.id,
        dentistId: Number(values.dentistId),
        datetime: values.datetime,
        chiefComplaint: values.chiefComplaint || null,
        history: values.history || null,
        examination: values.examination || null,
        diagnosis: values.diagnosis || null,
        treatmentPlan: values.treatmentPlan || null,
        advice: values.advice || null,
        notes: values.notes || null,
        followUpDate: values.followUpDate || null,
        treatments: values.treatments,
      });
      toast.success('Visit recorded', `Visit #${visit.id}`);
      props.onSaved(visit.id);
    } catch (err) {
      toast.fromError(err, 'Could not save visit');
    } finally {
      setPending(false);
    }
  };

  const addTreatment = (t: TreatmentDTO): void => {
    set('treatments', [
      ...values.treatments.filter((x) => x.treatmentId !== t.id),
      { treatmentId: t.id, qty: 1, unitPricePaisa: t.defaultPricePaisa },
    ]);
  };

  return (
    <Modal
      title="Record visit"
      onClose={props.onClose}
      width="wide"
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={() => void submit()}>Save visit</Button>
        </>
      }
    >
      {!props.patientId && (
        <div className="field mb-4">
          <label>Patient <span className="req">*</span></label>
          <Input
            value={chosenPatient ? `${chosenPatient.name} · ${chosenPatient.code}` : patientQuery}
            onChange={(v) => { setChosenPatient(null); setPatientQuery(v); }}
            placeholder="Search patient by name, phone or ID…"
            autoFocus
          />
          {!chosenPatient && patientMatches.length > 0 && (
            <div className="list" style={{ border: '1px solid var(--line)', borderRadius: 6, marginTop: 6, maxHeight: 150, overflowY: 'auto' }}>
              {patientMatches.map((m) => (
                <div key={m.id} className="list-row clickable" style={{ padding: '8px 10px' }}
                  onClick={() => { setChosenPatient(m); setPatientQuery(m.name); }}>
                  <strong className="flex-1">{m.name}</strong>
                  <span className="xsmall muted mono">{m.code}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="form-grid">
        <Field label="Date & time" required error={errors.datetime}>
          {(id) => <Input id={id} type="datetime-local" value={values.datetime} onChange={(v) => set('datetime', v)} invalid={!!errors.datetime} />}
        </Field>
        <Field label="Dentist" required error={errors.dentistId}>
          {(id) => (
            <Select
              id={id}
              value={values.dentistId}
              onChange={(v) => set('dentistId', v)}
              placeholder="Select dentist…"
              invalid={!!errors.dentistId}
              options={(dentists ?? []).filter((d) => d.active).map((d) => ({ value: String(d.id), label: `${d.name}${d.qualifications ? ` (${d.qualifications})` : ''}` }))}
            />
          )}
        </Field>
        <Field label="Chief complaint" className="span-2">
          {(id) => <Input id={id} value={values.chiefComplaint} onChange={(v) => set('chiefComplaint', v)} placeholder="e.g. pain in lower right molar" />}
        </Field>
        <Field label="History" className="span-2">
          {(id) => <Textarea id={id} rows={2} value={values.history} onChange={(v) => set('history', v)} />}
        </Field>
        <Field label="Examination" className="span-2">
          {(id) => <Textarea id={id} rows={2} value={values.examination} onChange={(v) => set('examination', v)} />}
        </Field>
        <Field label="Diagnosis" className="span-2">
          {(id) => <Input id={id} value={values.diagnosis} onChange={(v) => set('diagnosis', v)} />}
        </Field>
        <Field label="Treatment plan" className="span-2">
          {(id) => <Textarea id={id} rows={2} value={values.treatmentPlan} onChange={(v) => set('treatmentPlan', v)} />}
        </Field>
        <Field label="Advice" className="span-2">
          {(id) => <Input id={id} value={values.advice} onChange={(v) => set('advice', v)} />}
        </Field>
        <Field label="Follow-up date">
          {(id) => <Input id={id} type="date" value={values.followUpDate} onChange={(v) => set('followUpDate', v)} />}
        </Field>
        <Field label="Notes (internal)">
          {(id) => <Input id={id} value={values.notes} onChange={(v) => set('notes', v)} />}
        </Field>
      </div>

      <div className="form-section mt-4">
        <h4>Procedures this visit</h4>
        <div className="preset-chips mb-4">
          {(treatments ?? []).filter((t) => t.active).map((t) => (
            <button
              key={t.id}
              type="button"
              className="preset-chip"
              onClick={() => addTreatment(t)}
              title={`${t.description ?? t.name} · ${bdt(t.defaultPricePaisa)}`}
            >
              + {t.name} <span className="muted">{bdt(t.defaultPricePaisa)}</span>
            </button>
          ))}
        </div>
        {values.treatments.length > 0 ? (
          <div className="list">
            {values.treatments.map((sel) => {
              const t = treatments?.find((x) => x.id === sel.treatmentId);
              return (
                <div className="list-row" key={sel.treatmentId}>
                  <span className="flex-1">{t?.name ?? `Treatment #${sel.treatmentId}`}</span>
                  <Input value={String(sel.qty)} onChange={(v) => set('treatments', values.treatments.map((x) => x.treatmentId === sel.treatmentId ? { ...x, qty: Math.max(1, Number(v) || 1) } : x))} type="number" />
                  <span className="num small">{bdt(sel.qty * sel.unitPricePaisa)}</span>
                  <Button size="sm" variant="ghost" onClick={() => set('treatments', values.treatments.filter((x) => x.treatmentId !== sel.treatmentId))}>✕</Button>
                </div>
              );
            })}
            <div className="row between mt-2">
              <strong>Total</strong>
              <strong className="num">{bdt(values.treatments.reduce((s, x) => s + x.qty * x.unitPricePaisa, 0))}</strong>
            </div>
          </div>
        ) : (
          <p className="small muted">No procedures selected — click treatments above to add them.</p>
        )}
      </div>
    </Modal>
  );
}

export function RxFormModal(props: { patientId: number; visitId?: number | null; onClose: () => void; onSaved: (id: number) => void }) {
  const patientId = props.patientId;
  const { values, set, validate, errors } = useForm({
    dentistId: '', date: isoDate(new Date()), cC: '', oE: '', rE: '', diagnosis: '', treatment: '', advice: '', followUp: '',
    ccOther: '', oeOther: '',
    items: [{ medicineName: '', strength: '', dosage: '', frequency: '', duration: '', generic: '', form: '', qty: '', instruction: '' }] as {
      medicineName: string; strength: string; dosage: string; frequency: string; duration: string; generic: string; form: string; qty: string; instruction: string;
    }[],
    saveAsTemplate: '',
  });
  const { data: dentists } = useAsync(() => api['dentists/list'](), []);
  const { data: templates } = useAsync(() => api['prescriptions/templates'](), []);
  const [pending, setPending] = useState(false);
  const toast = useToast();
  const [patientQuery, setPatientQuery] = useState('');
  const [chosenPatient, setChosenPatient] = useState<{ id: number; name: string; code: string } | null>(
    patientId ? { id: patientId, name: '', code: '' } : null,
  );
  const [patientMatches, setPatientMatches] = useState<{ id: number; name: string; code: string }[]>([]);

  React.useEffect(() => {
    if (patientId) return;
    if (patientQuery.trim().length < 2) { setPatientMatches([]); return; }
    const t = setTimeout(() => {
      api['patients/list']({ query: patientQuery, pageSize: 8, status: 'active' })
        .then((res) => setPatientMatches(res.items.map((p) => ({ id: p.id, name: p.name, code: p.code }))))
        .catch(() => setPatientMatches([]));
    }, 200);
    return () => clearTimeout(t);
  }, [patientQuery, patientId]);

  const setItem = (i: number, patch: Partial<typeof values.items[0]>): void => {
    set('items', values.items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  };

  const applyTemplate = (tplId: string): void => {
    const tpl = (templates ?? []).find((t) => String(t.id) === tplId);
    if (!tpl) return;
    set('items', (tpl.items as any[]).map((it) => ({
      medicineName: it.medicineName ?? '', strength: it.strength ?? '', dosage: it.dosage ?? '',
      frequency: it.frequency ?? '', duration: it.duration ?? '', generic: it.generic ?? '',
      form: it.form ?? '', qty: it.qty ?? '', instruction: it.instruction ?? '',
    })));
    toast.success('Template applied', tpl.name);
  };

  const submit = async () => {
    const ok = validate((v) => ({
      dentistId: !v.dentistId ? 'Select the prescribing dentist.' : '',
      items: v.items.some((i) => !i.medicineName.trim()) ? 'Every medicine row needs a name.' : '',
    }));
    if (!ok) return;
    if (!patientId && !chosenPatient) { toast.warning('Select a patient', 'Search and choose the patient first.'); return; }
    setPending(true);
    try {
      const rx = await api['prescriptions/create']({
        patientId: patientId || chosenPatient!.id,
        visitId: props.visitId ?? null,
        dentistId: Number(values.dentistId),
        date: values.date,
        cC: (values.cC === 'Other' ? values.ccOther : values.cC) || null,
        oE: (values.oE === 'Other' ? values.oeOther : values.oE) || null, rE: values.rE || null,
        diagnosis: values.diagnosis || null, treatment: values.treatment || null,
        advice: values.advice || null, followUp: values.followUp || null,
        items: values.items.filter((i) => i.medicineName.trim()),
        saveAsTemplate: values.saveAsTemplate || null,
      });
      toast.success('Prescription created', rx.number);
      props.onSaved(rx.id);
    } catch (err) {
      toast.fromError(err, 'Could not save prescription');
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      title="New prescription"
      onClose={props.onClose}
      width="wide"
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={() => void submit()}>Save prescription</Button>
        </>
      }
    >
      {!patientId && (
        <div className="field mb-4">
          <label>Patient <span className="req">*</span></label>
          <Input
            value={chosenPatient ? `${chosenPatient.name} · ${chosenPatient.code}` : patientQuery}
            onChange={(v) => { setChosenPatient(null); setPatientQuery(v); }}
            placeholder="Search patient by name, phone or ID…"
            autoFocus
          />
          {!chosenPatient && patientMatches.length > 0 && (
            <div className="list" style={{ border: '1px solid var(--line)', borderRadius: 6, marginTop: 6, maxHeight: 150, overflowY: 'auto' }}>
              {patientMatches.map((m) => (
                <div key={m.id} className="list-row clickable" style={{ padding: '8px 10px' }}
                  onClick={() => { setChosenPatient(m); setPatientQuery(m.name); }}>
                  <strong className="flex-1">{m.name}</strong>
                  <span className="xsmall muted mono">{m.code}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="form-grid">
        <Field label="Prescribing dentist" required error={errors.dentistId}>
          {(id) => (
            <Select id={id} value={values.dentistId} onChange={(v) => set('dentistId', v)} placeholder="Select…"
              options={(dentists ?? []).filter((d) => d.active).map((d) => ({ value: String(d.id), label: d.name }))} />
          )}
        </Field>
        <Field label="Date" required>
          {(id) => <Input id={id} type="date" value={values.date} onChange={(v) => set('date', v)} />}
        </Field>
        <Field label="Apply saved template" className="span-2">
          {(id) => (
            <Select id={id} value="" onChange={applyTemplate} placeholder="Choose a template…"
              options={(templates ?? []).map((t) => ({ value: String(t.id), label: t.name }))} />
          )}
        </Field>
        <Field label={<>C/C <span className="muted">(chief complaint)</span></>} className="span-2">
          {(id) => (
            <Select
              id={id}
              value={values.cC}
              onChange={(v) => set('cC', v)}
              placeholder="Select chief complaint…"
              options={[
                { value: 'Pain On', label: 'Pain On' },
                { value: 'G. Carries', label: 'G. Carries' },
                { value: 'Swelling', label: 'Swelling' },
                { value: 'Gum Bleeding', label: 'Gum Bleeding' },
                { value: 'Bad Breath', label: 'Bad Breath' },
                { value: 'Sensitivity', label: 'Sensitivity' },
                { value: 'Other', label: 'Other' },
              ]}
            />
          )}
        </Field>
        {values.cC === 'Other' && (
          <Field label="C/C — Other" className="span-2">
            {(id) => <Input id={id} value={values.ccOther} onChange={(v) => set('ccOther', v)} placeholder="Write the chief complaint…" />}
          </Field>
        )}
        <Field label={<>O/E <span className="muted">(on examination)</span></>} className="span-2">
          {(id) => (
            <Select
              id={id}
              value={values.oE}
              onChange={(v) => set('oE', v)}
              placeholder="Select examination finding…"
              options={[
                { value: 'Carries/G.Carries', label: 'Carries/G.Carries' },
                { value: 'BDR/BDC', label: 'BDR/BDC' },
                { value: 'Gingivitis', label: 'Gingivitis' },
                { value: 'Parodental Pocket', label: 'Parodental Pocket' },
                { value: 'Perio Dontitis', label: 'Perio Dontitis' },
                { value: 'Plupitis', label: 'Plupitis' },
                { value: 'Impected Teeth', label: 'Impected Teeth' },
                { value: 'Dry Socket', label: 'Dry Socket' },
                { value: 'Attrition/Errosion', label: 'Attrition/Errosion' },
                { value: 'Other', label: 'Other' },
              ]}
            />
          )}
        </Field>
        {values.oE === 'Other' && (
          <Field label="O/E — Other" className="span-2">
            {(id) => <Input id={id} value={values.oeOther} onChange={(v) => set('oeOther', v)} placeholder="Write the examination finding…" />}
          </Field>
        )}
        <Field label={<>R/E <span className="muted">(radiographic examination)</span></>} className="span-2">
          {(id) => <Textarea id={id} rows={2} value={values.rE} onChange={(v) => set('rE', v)} />}
        </Field>
        <Field label="Diagnosis">
          {(id) => <Input id={id} value={values.diagnosis} onChange={(v) => set('diagnosis', v)} />}
        </Field>
        <Field label="Treatment">
          {(id) => <Input id={id} value={values.treatment} onChange={(v) => set('treatment', v)} />}
        </Field>
        <Field label="Advice">
          {(id) => <Input id={id} value={values.advice} onChange={(v) => set('advice', v)} />}
        </Field>
        <Field label="Follow-up date">
          {(id) => <Input id={id} type="date" value={values.followUp} onChange={(v) => set('followUp', v)} />}
        </Field>
      </div>

      <div className="form-section mt-4">
        <div className="row between">
          <h4>Medicines</h4>
          <Button size="sm" variant="secondary" onClick={() => set('items', [...values.items, { medicineName: '', strength: '', dosage: '', frequency: '', duration: '', generic: '', form: '', qty: '', instruction: '' }])}>+ Add medicine</Button>
        </div>
        {errors.items && <div className="error" role="alert">{errors.items}</div>}
        {values.items.map((it, i) => (
          <div className="rx-item" key={i}>
            <div className="row between mb-4">
              <strong className="small">#{i + 1}</strong>
              {values.items.length > 1 && (
                <Button size="sm" variant="ghost" onClick={() => set('items', values.items.filter((_, j) => j !== i))}>Remove</Button>
              )}
            </div>
            <div className="rx-grid">
              <Field label="Medicine name *">
                {(id) => <Input id={id} value={it.medicineName} onChange={(v) => setItem(i, { medicineName: v })} placeholder="e.g. Amoxicillin" invalid={!it.medicineName && !!errors.items} />}
              </Field>
              <Field label="Generic">
                {(id) => <Input id={id} value={it.generic} onChange={(v) => setItem(i, { generic: v })} />}
              </Field>
              <Field label="Strength">
                {(id) => <Input id={id} value={it.strength} onChange={(v) => setItem(i, { strength: v })} placeholder="500mg" />}
              </Field>
              <Field label="Dosage">
                {(id) => <Input id={id} value={it.dosage} onChange={(v) => setItem(i, { dosage: v })} placeholder="1 tab" />}
              </Field>
              <Field label="Frequency">
                {(id) => <Input id={id} value={it.frequency} onChange={(v) => setItem(i, { frequency: v })} placeholder="3× daily" />}
              </Field>
              <Field label="Duration">
                {(id) => <Input id={id} value={it.duration} onChange={(v) => setItem(i, { duration: v })} placeholder="5 days" />}
              </Field>
              <Field label="Quantity">
                {(id) => <Input id={id} value={it.qty} onChange={(v) => setItem(i, { qty: v })} />}
              </Field>
              <Field label="Instruction">
                {(id) => <Input id={id} value={it.instruction} onChange={(v) => setItem(i, { instruction: v })} placeholder="after meals" />}
              </Field>
            </div>
          </div>
        ))}
        <Field label="Save as template (optional name)" className="mt-4">
          {(id) => <Input id={id} value={values.saveAsTemplate} onChange={(v) => set('saveAsTemplate', v)} placeholder="e.g. Standard post-extraction" />}
        </Field>
      </div>
    </Modal>
  );
}

export function InvoiceFormModal(props: { patientId: number; visitId?: number | null; onClose: () => void; onSaved: (id: number) => void }) {
  const { values, set, validate, errors } = useForm({
    date: isoDate(new Date()),
    discountPaisa: 0,
    note: '',
    items: [{ description: '', qty: 1, unitPricePaisa: 0, treatmentId: null as number | null }] as {
      description: string; qty: number; unitPricePaisa: number; treatmentId: number | null;
    }[],
  });
  const { data: treatments } = useAsync(() => api['treatments/list'](), []);
  const [pending, setPending] = useState(false);
  const toast = useToast();
  const [patientQuery, setPatientQuery] = useState('');
  const [chosenPatient, setChosenPatient] = useState<{ id: number; name: string; code: string } | null>(
    props.patientId ? { id: props.patientId, name: '', code: '' } : null,
  );
  const [patientMatches, setPatientMatches] = useState<{ id: number; name: string; code: string }[]>([]);

  React.useEffect(() => {
    if (props.patientId) return;
    if (patientQuery.trim().length < 2) { setPatientMatches([]); return; }
    const t = setTimeout(() => {
      api['patients/list']({ query: patientQuery, pageSize: 8, status: 'active' })
        .then((res) => setPatientMatches(res.items.map((p) => ({ id: p.id, name: p.name, code: p.code }))))
        .catch(() => setPatientMatches([]));
    }, 200);
    return () => clearTimeout(t);
  }, [patientQuery, props.patientId]);

  const setItem = (i: number, patch: Partial<typeof values.items[0]>): void => {
    set('items', values.items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  };

  const subtotal = values.items.reduce((s, l) => s + l.qty * l.unitPricePaisa, 0);
  const total = Math.max(0, subtotal - values.discountPaisa);

  const submit = async () => {
    const ok = validate((v) => ({
      items: v.items.some((i) => !i.description.trim() || i.unitPricePaisa <= 0)
        ? 'Each line needs a description and a price above zero.'
        : v.items.length === 0 ? 'Add at least one line.' : '',
      discountPaisa: v.discountPaisa > subtotal ? 'Discount cannot exceed the subtotal.' : '',
    }));
    if (!ok) return;
    if (!props.patientId && !chosenPatient) { toast.warning('Select a patient', 'Search and choose the patient first.'); return; }
    setPending(true);
    try {
      const inv = await api['invoices/create']({
        patientId: props.patientId || chosenPatient!.id,
        date: values.date,
        discountPaisa: values.discountPaisa || undefined,
        note: values.note || null,
        visitId: props.visitId ?? null,
        items: values.items.filter((i) => i.description.trim()).map((i) => ({
          description: i.description,
          treatmentId: i.treatmentId,
          qty: i.qty,
          unitPricePaisa: i.unitPricePaisa,
        })),
      });
      toast.success('Invoice created', inv.number);
      props.onSaved(inv.id);
    } catch (err) {
      toast.fromError(err, 'Could not create invoice');
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      title="Create invoice"
      onClose={props.onClose}
      width="wide"
      footer={
        <>
          <span className="small muted" style={{ marginRight: 'auto' }}>Total: <strong className="num">{bdt(total)}</strong></span>
          <Button variant="secondary" onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={() => void submit()}>Create invoice</Button>
        </>
      }
    >
      {!props.patientId && (
        <div className="field mb-4">
          <label>Patient <span className="req">*</span></label>
          <Input
            value={chosenPatient ? `${chosenPatient.name} · ${chosenPatient.code}` : patientQuery}
            onChange={(v) => { setChosenPatient(null); setPatientQuery(v); }}
            placeholder="Search patient by name, phone or ID…"
            autoFocus
          />
          {!chosenPatient && patientMatches.length > 0 && (
            <div className="list" style={{ border: '1px solid var(--line)', borderRadius: 6, marginTop: 6, maxHeight: 150, overflowY: 'auto' }}>
              {patientMatches.map((m) => (
                <div key={m.id} className="list-row clickable" style={{ padding: '8px 10px' }}
                  onClick={() => { setChosenPatient(m); setPatientQuery(m.name); }}>
                  <strong className="flex-1">{m.name}</strong>
                  <span className="xsmall muted mono">{m.code}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="form-grid">
        <Field label="Invoice date" required>
          {(id) => <Input id={id} type="date" value={values.date} onChange={(v) => set('date', v)} />}
        </Field>
        <Field label="Discount (৳)" error={errors.discountPaisa}>
          {(id) => (
            <Input
              id={id} type="number" min={0}
              value={String(values.discountPaisa / 100)}
              onChange={(v) => set('discountPaisa', Math.max(0, Math.round((Number(v) || 0) * 100)))}
              invalid={!!errors.discountPaisa}
            />
          )}
        </Field>
        <Field label="Note (printed)" className="span-2">
          {(id) => <Input id={id} value={values.note} onChange={(v) => set('note', v)} placeholder="optional footer note" />}
        </Field>
      </div>

      <div className="form-section mt-4">
        <div className="row between">
          <h4>Invoice lines</h4>
          <Button size="sm" variant="secondary" onClick={() => set('items', [...values.items, { description: '', qty: 1, unitPricePaisa: 0, treatmentId: null }])}>+ Add line</Button>
        </div>
        {errors.items && <div className="error" role="alert">{errors.items}</div>}
        <div className="preset-chips mb-4">
          {(treatments ?? []).filter((t) => t.active).map((t) => (
            <button key={t.id} type="button" className="preset-chip" onClick={() => {
              set('items', [...values.items, { description: t.name, qty: 1, unitPricePaisa: t.defaultPricePaisa, treatmentId: t.id }]);
            }}>
              + {t.name} <span className="muted">{bdt(t.defaultPricePaisa)}</span>
            </button>
          ))}
        </div>
        {values.items.map((line, i) => (
          <div className="invoice-line" key={i}>
            <Field label="Description">
              {(id) => <Input id={id} value={line.description} onChange={(v) => setItem(i, { description: v })} placeholder="Treatment or item" />}
            </Field>
            <Field label="Qty">
              {(id) => <Input id={id} type="number" min={1} value={String(line.qty)} onChange={(v) => setItem(i, { qty: Math.max(1, Number(v) || 1) })} />}
            </Field>
            <Field label="Unit price (৳)">
              {(id) => <Input id={id} type="number" min={0} step="0.01" value={String(line.unitPricePaisa / 100)} onChange={(v) => setItem(i, { unitPricePaisa: Math.round((Number(v) || 0) * 100) })} />}
            </Field>
            <Field label="Total">
              {(id) => <Input id={id} value={bdt(line.qty * line.unitPricePaisa)} onChange={() => undefined} disabled />}
            </Field>
            <Button variant="ghost" size="sm" onClick={() => set('items', values.items.filter((_, j) => j !== i))} title="Remove line">✕</Button>
          </div>
        ))}
        <div className="row between mt-4">
          <span className="small muted">Subtotal {bdt(subtotal)} · Discount {bdt(values.discountPaisa)}</span>
          <strong>Payable: {bdt(total)}</strong>
        </div>
      </div>
    </Modal>
  );
}
