import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, useAsync } from '../api';
import { useApp } from '../state/app-context';
import { Badge, Button, Card, ErrorState, Modal, Spinner, Tabs, useToast } from '../components/primitives';
import { Field, Input, Select, Textarea } from '../components/forms';
import { DataTable, TableToolbar, type Column } from '../components/table';
import { Icon } from '../components/shell';
import { bdt } from '../format';
import type { DentistDTO, StaffDTO } from '../../shared/types';

function StaffModal(props: { open: boolean; initial?: StaffDTO | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({
    name: '', bengaliName: '', gender: '', phone: '', designation: '', department: '',
    salary: '', joiningDate: '', status: 'active', address: '', notes: '',
    emergencyContact: '', emergencyPhone: '', bloodGroup: '', idNumber: '', age: '',
  });
  const [errors, setErrors] = useState<{ [k: string]: string }>({});
  const [pending, setPending] = useState(false);
  const toast = useToast();

  React.useEffect(() => {
    if (!props.open) return;
    setErrors({});
    setV({
      name: props.initial?.name ?? '', bengaliName: props.initial?.bengaliName ?? '',
      gender: props.initial?.gender ?? '', phone: props.initial?.phone ?? '',
      designation: props.initial?.designation ?? '', department: props.initial?.department ?? '',
      salary: props.initial?.salaryPaisa != null ? String(props.initial.salaryPaisa / 100) : '',
      joiningDate: props.initial?.joiningDate ?? '', status: props.initial?.status ?? 'active',
      address: props.initial?.address ?? '', notes: props.initial?.notes ?? '',
      emergencyContact: props.initial?.emergencyContact ?? '', emergencyPhone: props.initial?.emergencyPhone ?? '',
      bloodGroup: props.initial?.bloodGroup ?? '', idNumber: props.initial?.idNumber ?? '',
      age: props.initial?.age != null ? String(props.initial.age) : '',
    });
  }, [props.open, props.initial]);

  if (!props.open) return null;
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]): void => setV((p) => ({ ...p, [k]: val }));

  const submit = async () => {
    const errs: { [k: string]: string } = {};
    if (v.name.trim().length < 2) errs.name = 'Name is required.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setPending(true);
    try {
      await api['staff/save']({
        id: props.initial?.id,
        name: v.name.trim(),
        bengaliName: v.bengaliName || null,
        gender: v.gender || null,
        age: v.age ? Number(v.age) : null,
        phone: v.phone || null,
        emergencyContact: v.emergencyContact || null,
        emergencyPhone: v.emergencyPhone || null,
        bloodGroup: v.bloodGroup || null,
        idNumber: v.idNumber || null,
        designation: v.designation || null,
        department: v.department || null,
        salaryPaisa: v.salary ? Math.round(Number(v.salary) * 100) : null,
        joiningDate: v.joiningDate || null,
        status: v.status as StaffDTO['status'],
        address: v.address || null,
        notes: v.notes || null,
      });
      toast.success(props.initial ? 'Staff updated' : 'Staff added', v.name);
      props.onSaved();
      props.onClose();
    } catch (err) {
      toast.fromError(err, 'Save failed');
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      title={props.initial ? `Edit staff — ${props.initial.name}` : 'Add staff member'}
      onClose={props.onClose}
      width="wide"
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={() => void submit()}>Save</Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Full name" required error={errors.name} className="span-2">
          {(id) => <Input id={id} value={v.name} onChange={(x) => set('name', x)} invalid={!!errors.name} />}
        </Field>
        <Field label="নাম (Bengali)">{(id) => <Input id={id} value={v.bengaliName} onChange={(x) => set('bengaliName', x)} />}</Field>
        <Field label="Gender">
          {(id) => (
            <Select id={id} value={v.gender} onChange={(x) => set('gender', x)} placeholder="Select…"
              options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }, { value: 'other', label: 'Other' }]} />
          )}
        </Field>
        <Field label="Age">{(id) => <Input id={id} type="number" min={0} max={120} value={v.age} onChange={(x) => set('age', x)} />}</Field>
        <Field label="Blood group">
          {(id) => (
            <Select id={id} value={v.bloodGroup} onChange={(x) => set('bloodGroup', x)} placeholder="Unknown"
              options={['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((b) => ({ value: b, label: b }))} />
          )}
        </Field>
        <Field label="Phone">{(id) => <Input id={id} value={v.phone} onChange={(x) => set('phone', x)} />}</Field>
        <Field label="Designation">{(id) => <Input id={id} value={v.designation} onChange={(x) => set('designation', x)} placeholder="e.g. Receptionist" />}</Field>
        <Field label="Department">{(id) => <Input id={id} value={v.department} onChange={(x) => set('department', x)} />}</Field>
        <Field label="Monthly salary (৳)" hint="Visible only with salary permission">
          {(id) => <Input id={id} type="number" min={0} value={v.salary} onChange={(x) => set('salary', x)} />}
        </Field>
        <Field label="Joining date">{(id) => <Input id={id} type="date" value={v.joiningDate} onChange={(x) => set('joiningDate', x)} />}</Field>
        <Field label="Status">
          {(id) => (
            <Select id={id} value={v.status} onChange={(x) => set('status', x)}
              options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
          )}
        </Field>
        <Field label="Emergency contact">{(id) => <Input id={id} value={v.emergencyContact} onChange={(x) => set('emergencyContact', x)} />}</Field>
        <Field label="Emergency phone">{(id) => <Input id={id} value={v.emergencyPhone} onChange={(x) => set('emergencyPhone', x)} />}</Field>
        <Field label="National ID / ID no.">{(id) => <Input id={id} value={v.idNumber} onChange={(x) => set('idNumber', x)} />}</Field>
        <Field label="Address" className="span-2">{(id) => <Textarea id={id} rows={2} value={v.address} onChange={(x) => set('address', x)} />}</Field>
        <Field label="Notes" className="span-2">{(id) => <Textarea id={id} rows={2} value={v.notes} onChange={(x) => set('notes', x)} />}</Field>
      </div>
    </Modal>
  );
}

function DentistModal(props: { open: boolean; initial?: DentistDTO | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({
    name: '', qualifications: '', designations: '', regNo: '', phone: '', email: '', schedule: '', active: true,
  });
  const [pending, setPending] = useState(false);
  const toast = useToast();

  React.useEffect(() => {
    if (!props.open) return;
    setV({
      name: props.initial?.name ?? '', qualifications: props.initial?.qualifications ?? '',
      designations: props.initial?.designations ?? '', regNo: props.initial?.regNo ?? '',
      phone: props.initial?.phone ?? '', email: props.initial?.email ?? '',
      schedule: props.initial?.schedule ?? '', active: props.initial ? props.initial.active : true,
    });
  }, [props.open, props.initial]);

  if (!props.open) return null;
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]): void => setV((p) => ({ ...p, [k]: val }));

  const submit = async () => {
    if (v.name.trim().length < 2) { toast.warning('Dentist name required'); return; }
    setPending(true);
    try {
      await api['dentists/save']({
        id: props.initial?.id,
        name: v.name.trim(),
        qualifications: v.qualifications || null,
        designations: v.designations || null,
        regNo: v.regNo || null,
        phone: v.phone || null,
        email: v.email || null,
        schedule: v.schedule || null,
        active: v.active,
      });
      toast.success(props.initial ? 'Dentist updated' : 'Dentist added', v.name);
      props.onSaved();
      props.onClose();
    } catch (err) {
      toast.fromError(err, 'Save failed');
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      title={props.initial ? `Edit dentist — ${props.initial.name}` : 'Add dentist'}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={() => void submit()}>Save</Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Full name" required className="span-2">{(id) => <Input id={id} value={v.name} onChange={(x) => set('name', x)} placeholder="Dr. …" autoFocus />}</Field>
        <Field label="Qualifications" hint="One qualification per line; comma-separated values are also supported.">
          {(id) => <Textarea id={id} rows={3} value={v.qualifications} onChange={(x) => set('qualifications', x)} placeholder={"BDS\nFCPS\nMS (Oral & Maxillofacial Surgery)"} />}
        </Field>
        <Field label="Designation(s)">{(id) => <Input id={id} value={v.designations} onChange={(x) => set('designations', x)} placeholder="Consultant" />}</Field>
        <Field label="Registration no.">{(id) => <Input id={id} value={v.regNo} onChange={(x) => set('regNo', x)} />}</Field>
        <Field label="Phone">{(id) => <Input id={id} value={v.phone} onChange={(x) => set('phone', x)} />}</Field>
        <Field label="Email">{(id) => <Input id={id} type="email" value={v.email} onChange={(x) => set('email', x)} />}</Field>
        <Field label="Weekly schedule" hint="e.g. Sat–Thu 10:00–20:00">{(id) => <Input id={id} value={v.schedule} onChange={(x) => set('schedule', x)} />}</Field>
        <Field label="Status">
          {(id) => (
            <label className="checkbox">
              <input id={id} type="checkbox" checked={v.active} onChange={(e) => set('active', e.target.checked)} />
              <span>Active (available for appointments)</span>
            </label>
          )}
        </Field>
      </div>
    </Modal>
  );
}

type StaffTab = 'staff' | 'dentists';

export function StaffPage() {
  const { can } = useApp();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<StaffTab>(params.get('tab') === 'dentists' ? 'dentists' : 'staff');
  const [query, setQuery] = useState('');
  const [staffModal, setStaffModal] = useState<{ open: boolean; initial: StaffDTO | null }>({ open: false, initial: null });
  const [dentistModal, setDentistModal] = useState<{ open: boolean; initial: DentistDTO | null }>({ open: false, initial: null });
  const [showInactive, setShowInactive] = useState(false);

  React.useEffect(() => {
    const reqTab = params.get('tab');
    if (reqTab === 'dentists' || reqTab === 'staff') {
      setTab(reqTab);
      params.delete('tab');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const staffQ = useAsync(() => api['staff/list'](), []);
  const dentistQ = useAsync(() => api['dentists/list'](true), []);

  const staffRows = (staffQ.data ?? []).filter((s) => !query || s.name.toLowerCase().includes(query.toLowerCase()) || (s.phone ?? '').includes(query));
  const dentistRows = (dentistQ.data ?? []).filter((d) => (showInactive || d.active) && (!query || d.name.toLowerCase().includes(query.toLowerCase())));

  const staffColumns: Column<StaffDTO>[] = [
    { key: 'name', label: 'Name', sortValue: (s) => s.name, render: (s) => (<div className="row" style={{ gap: 8 }}><div className="avatar xs">{s.name.slice(0, 1).toUpperCase()}</div><div><strong>{s.name}</strong>{s.bengaliName && <div className="xsmall muted">{s.bengaliName}</div>}</div></div>) },
    { key: 'designation', label: 'Designation', render: (s) => s.designation ?? '—' },
    { key: 'dept', label: 'Department', render: (s) => s.department ?? '—' },
    { key: 'phone', label: 'Phone', render: (s) => <span className="mono">{s.phone ?? '—'}</span> },
    { key: 'joining', label: 'Joined', render: (s) => (s.joiningDate ? new Date(s.joiningDate).toLocaleDateString() : '—') },
    ...(can('staff.salary.view') ? [{ key: 'salary', label: 'Salary', align: 'right' as const, render: (s: StaffDTO) => (s.salaryPaisa != null ? <span className="num">{bdt(s.salaryPaisa)}</span> : '—') }] : []),
    { key: 'status', label: 'Status', render: (s) => <Badge tone={s.status === 'active' ? 'success' : 'neutral'}>{s.status}</Badge> },
    {
      key: 'actions', label: '', align: 'right',
      render: (s) => (can('staff.manage') ? (
        <Button size="sm" variant="ghost" onClick={() => setStaffModal({ open: true, initial: s })}>Edit</Button>
      ) : null),
    },
  ];

  const dentistColumns: Column<DentistDTO>[] = [
    { key: 'name', label: 'Dentist', sortValue: (d) => d.name, render: (d) => (<div><strong>{d.name}</strong><div className="xsmall muted">{d.qualifications ? d.qualifications.split(/[\r\n,;]+/).map((q) => q.trim()).filter(Boolean).join(' · ') : ''}{d.regNo ? ` · Reg ${d.regNo}` : ''}</div></div>) },
    { key: 'desig', label: 'Designations', render: (d) => d.designations ?? '—' },
    { key: 'contact', label: 'Contact', render: (d) => (<div className="xsmall"><div className="mono">{d.phone ?? ''}</div><div className="muted">{d.email ?? ''}</div></div>) },
    { key: 'schedule', label: 'Schedule', render: (d) => d.schedule ?? '—' },
    { key: 'active', label: 'Status', render: (d) => <Badge tone={d.active ? 'success' : 'neutral'}>{d.active ? 'active' : 'inactive'}</Badge> },
    {
      key: 'actions', label: '', align: 'right',
      render: (d) => (can('staff.manage') ? (
        <Button size="sm" variant="ghost" onClick={() => setDentistModal({ open: true, initial: d })}>Edit</Button>
      ) : null),
    },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Staff &amp; users</h1>
          <p className="page-subtitle">Team records, dentist profiles and account administration</p>
        </div>
        <div className="page-actions">
          <Button variant="ghost" icon={Icon.refresh} onClick={() => { staffQ.reload(); dentistQ.reload(); }}>Refresh</Button>
          {can('staff.manage') && tab === 'staff' && (
            <Button variant="primary" icon={Icon.plus} onClick={() => setStaffModal({ open: true, initial: null })}>Add staff</Button>
          )}
          {can('staff.manage') && tab === 'dentists' && (
            <Button variant="primary" icon={Icon.plus} onClick={() => setDentistModal({ open: true, initial: null })}>Add dentist</Button>
          )}
        </div>
      </div>

      <Tabs
        tabs={[
          { key: 'staff' as const, label: 'Staff', count: staffQ.data?.length },
          { key: 'dentists' as const, label: 'Dentists', count: dentistRows.length },
          ...(can('users.manage') ? [{ key: 'users' as const, label: 'Users & roles' }] : []),
        ]}
        active={tab as any}
        onChange={(k) => {
          if (k === 'users') {
            window.location.hash = '#/users';
            return;
          }
          setTab(k as StaffTab);
        }}
      />

      <div className="mt-4">
        <TableToolbar
          right={
            tab === 'dentists' ? (
              <label className="checkbox">
                <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
                <span>Show inactive</span>
              </label>
            ) : undefined
          }
        >
          <div style={{ minWidth: 260, flex: '1 1 260px' }}>
            <Input value={query} onChange={setQuery} placeholder="Search name or phone…" />
          </div>
        </TableToolbar>

        {tab === 'staff' && (
          <Card pad={false}>
            {staffQ.loading && !staffQ.data ? <Spinner label="Loading staff…" />
              : staffQ.error ? <ErrorState error={staffQ.error} onRetry={staffQ.reload} />
              : (
                <DataTable
                  columns={staffColumns}
                  rows={staffRows}
                  rowKey={(s) => s.id}
                  empty={{
                    title: 'No staff records',
                    body: 'Add everyone who works at the clinic — receptionists, hygienists, assistants.',
                    action: can('staff.manage') ? <Button variant="primary" onClick={() => setStaffModal({ open: true, initial: null })}>Add staff</Button> : undefined,
                  }}
                />
              )}
          </Card>
        )}

        {tab === 'dentists' && (
          <Card pad={false}>
            {dentistQ.loading && !dentistQ.data ? <Spinner label="Loading dentists…" />
              : dentistQ.error ? <ErrorState error={dentistQ.error} onRetry={dentistQ.reload} />
              : (
                <DataTable
                  columns={dentistColumns}
                  rows={dentistRows}
                  rowKey={(d) => d.id}
                  empty={{
                    title: 'No dentists yet',
                    body: 'Dentist profiles power appointments, prescriptions and reports.',
                    action: can('staff.manage') ? <Button variant="primary" onClick={() => setDentistModal({ open: true, initial: null })}>Add dentist</Button> : undefined,
                  }}
                />
              )}
          </Card>
        )}
      </div>

      <StaffModal open={staffModal.open} initial={staffModal.initial} onClose={() => setStaffModal({ open: false, initial: null })} onSaved={staffQ.reload} />
      <DentistModal open={dentistModal.open} initial={dentistModal.initial} onClose={() => setDentistModal({ open: false, initial: null })} onSaved={dentistQ.reload} />
    </div>
  );
}
