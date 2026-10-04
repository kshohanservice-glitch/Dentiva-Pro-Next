import React, { useMemo, useState } from 'react';
import { api, useAsync } from '../api';
import { useApp } from '../state/app-context';
import { Badge, Button, Card, EmptyState, ErrorState, Modal, Spinner, Tabs, useToast } from '../components/primitives';
import { Field, Input, Select } from '../components/forms';
import { DataTable, TableToolbar, type Column } from '../components/table';
import { Icon } from '../components/shell';
import { ALL_PERMISSIONS, PERMISSION_GROUPS, type PermissionKey } from '../../shared/permissions';
import type { RoleDTO, UserDTO } from '../../shared/types';

function groupOf(p: PermissionKey): string {
  return PERMISSION_GROUPS[p.split('.')[0] as keyof typeof PERMISSION_GROUPS] ?? 'Other';
}

function PermissionMatrix(props: { selected: PermissionKey[]; onChange: (p: PermissionKey[]) => void; disabled?: boolean }) {
  const grouped = useMemo(() => {
    const map = new Map<string, PermissionKey[]>();
    for (const p of ALL_PERMISSIONS) {
      const g = groupOf(p);
      const arr = map.get(g) ?? [];
      arr.push(p);
      map.set(g, arr);
    }
    return [...map.entries()];
  }, []);

  const toggle = (p: PermissionKey): void => {
    if (props.disabled) return;
    props.onChange(props.selected.includes(p) ? props.selected.filter((x) => x !== p) : [...props.selected, p]);
  };

  return (
    <div className="perm-grid">
      {grouped.map(([group, perms]) => {
        const allOn = perms.every((p) => props.selected.includes(p));
        return (
          <div className="perm-group" key={group}>
            <div className="row between" style={{ marginBottom: 6 }}>
              <h5 style={{ margin: 0 }}>{group}</h5>
              {!props.disabled && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    props.onChange(allOn ? props.selected.filter((x) => !perms.includes(x)) : [...new Set([...props.selected, ...perms])]);
                  }}
                >
                  {allOn ? 'Clear' : 'All'}
                </button>
              )}
            </div>
            {perms.map((p) => (
              <label className="checkbox" key={p} style={{ marginBottom: 4 }}>
                <input type="checkbox" checked={props.selected.includes(p)} disabled={props.disabled} onChange={() => toggle(p)} />
                <span title={p}>{p.split('.')[1]}</span>
              </label>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function UserModal(props: {
  open: boolean;
  initial?: UserDTO | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [v, setV] = useState({ username: '', displayName: '', password: '', roleId: '', staffId: '', status: 'active', permissions: [] as PermissionKey[], customPerms: false });
  const [errors, setErrors] = useState<{ [k: string]: string }>({});
  const [pending, setPending] = useState(false);
  const toast = useToast();
  const { data: roles } = useAsync(() => api['roles/list'](), []);
  const { data: staff } = useAsync(() => api['staff/list'](), []);

  React.useEffect(() => {
    if (!props.open) return;
    setErrors({});
    setV({
      username: props.initial?.username ?? '',
      displayName: props.initial?.displayName ?? '',
      password: '',
      roleId: props.initial ? String(props.initial.roleId) : '',
      staffId: props.initial?.staffId != null ? String(props.initial.staffId) : '',
      status: props.initial?.status ?? 'active',
      permissions: props.initial?.permissions ?? [],
      customPerms: !!(props.initial?.permissions?.length),
    });
  }, [props.open, props.initial]);

  if (!props.open) return null;
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]): void => setV((p) => ({ ...p, [k]: val }));

  const submit = async () => {
    const errs: { [k: string]: string } = {};
    if (!/^[A-Za-z0-9._-]{3,40}$/.test(v.username)) errs.username = 'Username: 3–40 chars (letters, numbers, . _ -).';
    if (v.displayName.trim().length < 2) errs.displayName = 'Display name required.';
    if (!v.roleId) errs.roleId = 'Select a role.';
    if (!props.initial && (v.password.length < 8 || !/[A-Za-z]/.test(v.password) || !/\d/.test(v.password))) {
      errs.password = 'Password: at least 8 characters with letters and numbers.';
    }
    if (props.initial && v.password && v.password.length < 8) errs.password = 'New password too short.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setPending(true);
    try {
      await api['users/save']({
        id: props.initial?.id,
        username: v.username.trim(),
        displayName: v.displayName.trim(),
        password: v.password || undefined,
        roleId: Number(v.roleId),
        status: v.status as UserDTO['status'],
        staffId: v.staffId ? Number(v.staffId) : null,
        permissions: v.customPerms ? v.permissions : undefined,
      });
      toast.success(props.initial ? 'User updated' : 'User created', v.username);
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
      title={props.initial ? `Edit user — ${props.initial.username}` : 'Create user'}
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
        <Field label="Username" required error={errors.username}>
          {(id) => <Input id={id} value={v.username} onChange={(x) => set('username', x)} autoComplete="off" invalid={!!errors.username} />}
        </Field>
        <Field label="Display name" required error={errors.displayName}>
          {(id) => <Input id={id} value={v.displayName} onChange={(x) => set('displayName', x)} invalid={!!errors.displayName} />}
        </Field>
        <Field label={props.initial ? 'New password (blank = unchanged)' : 'Initial password'} required={!props.initial} error={errors.password}>
          {(id) => <Input id={id} type="password" value={v.password} onChange={(x) => set('password', x)} autoComplete="new-password" invalid={!!errors.password} />}
        </Field>
        <Field label="Role" required error={errors.roleId}>
          {(id) => (
            <Select id={id} value={v.roleId} onChange={(x) => set('roleId', x)} placeholder="Select role…" invalid={!!errors.roleId}
              options={(roles ?? []).map((r) => ({ value: String(r.id), label: `${r.name}${r.builtin ? ' (built-in)' : ''}` }))} />
          )}
        </Field>
        <Field label="Link to staff record">
          {(id) => (
            <Select id={id} value={v.staffId} onChange={(x) => set('staffId', x)} placeholder="None"
              options={(staff ?? []).map((s) => ({ value: String(s.id), label: s.name }))} />
          )}
        </Field>
        <Field label="Status">
          {(id) => (
            <Select id={id} value={v.status} onChange={(x) => set('status', x)}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'disabled', label: 'Disabled' },
                { value: 'locked', label: 'Locked' },
              ]} />
          )}
        </Field>
      </div>

      <div className="form-section mt-4">
        <label className="checkbox mb-4">
          <input type="checkbox" checked={v.customPerms} onChange={(e) => set('customPerms', e.target.checked)} />
          <span>Override role permissions for this user</span>
        </label>
        {v.customPerms ? (
          <PermissionMatrix selected={v.permissions} onChange={(p) => set('permissions', p)} />
        ) : (
          <p className="small muted">
            This user receives exactly the permissions of the selected role. Role edits by an administrator apply here automatically.
          </p>
        )}
      </div>
    </Modal>
  );
}

function RoleModal(props: { open: boolean; initial?: RoleDTO | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ name: '', key: '', description: '', permissions: [] as PermissionKey[] });
  const [pending, setPending] = useState(false);
  const toast = useToast();

  React.useEffect(() => {
    if (!props.open) return;
    setV({
      name: props.initial?.name ?? '',
      key: props.initial?.key ?? '',
      description: props.initial?.description ?? '',
      permissions: props.initial?.permissions ?? [],
    });
  }, [props.open, props.initial]);

  if (!props.open) return null;
  const readOnly = props.initial?.builtin;

  const submit = async () => {
    if (v.name.trim().length < 2) { toast.warning('Role name required'); return; }
    setPending(true);
    try {
      await api['roles/save']({
        id: props.initial?.id,
        key: v.key || undefined,
        name: v.name.trim(),
        description: v.description || undefined,
        permissions: v.permissions,
      });
      toast.success('Role saved', v.name);
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
      title={props.initial ? `Role — ${props.initial.name}` : 'New role'}
      onClose={props.onClose}
      width="xwide"
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose}>{readOnly ? 'Close' : 'Cancel'}</Button>
          {!readOnly && <Button variant="primary" loading={pending} onClick={() => void submit()}>Save role</Button>}
        </>
      }
    >
      <div className="form-grid">
        <Field label="Role name" required>{(id) => <Input id={id} value={v.name} onChange={(x) => setV((p) => ({ ...p, name: x }))} disabled={readOnly} />}</Field>
        <Field label="Key" hint="lowercase_with_underscores — required for new roles">
          {(id) => <Input id={id} value={v.key} onChange={(x) => setV((p) => ({ ...p, key: x }))} disabled={readOnly || props.initial?.builtin} />}
        </Field>
        <Field label="Description" className="span-2">
          {(id) => <Input id={id} value={v.description} onChange={(x) => setV((p) => ({ ...p, description: x }))} disabled={readOnly} />}
        </Field>
      </div>
      <div className="form-section mt-4">
        <div className="row between mb-4">
          <h4 style={{ margin: 0 }}>Permissions ({v.permissions.length} of {ALL_PERMISSIONS.length})</h4>
          {readOnly && <Badge tone="warning">built-in role — permissions fixed</Badge>}
        </div>
        <PermissionMatrix
          selected={v.permissions}
          onChange={(p) => setV((s) => ({ ...s, permissions: p }))}
          disabled={readOnly}
        />
      </div>
    </Modal>
  );
}

function ResetPasswordModal(props: { user: UserDTO; onClose: () => void; onSaved: () => void }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [pending, setPending] = useState(false);
  const toast = useToast();
  const ok = pw.length >= 8 && /[A-Za-z]/.test(pw) && /\d/.test(pw) && pw === pw2;
  return (
    <Modal
      title={`Reset password — ${props.user.username}`}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose}>Cancel</Button>
          <Button
            variant="danger" disabled={!ok} loading={pending}
            onClick={async () => {
              setPending(true);
              try {
                await api['users/reset-password']({ id: props.user.id, password: pw });
                toast.success('Password reset', props.user.username);
                props.onSaved();
                props.onClose();
              } catch (err) {
                toast.fromError(err, 'Reset failed');
              } finally {
                setPending(false);
              }
            }}
          >Reset password</Button>
        </>
      }
    >
      <p className="small muted">The user will be able to sign in immediately with the new password. Require them to keep it confidential.</p>
      <div className="form-grid mt-4">
        <Field label="New password" required hint="≥8 chars, letters + numbers">
          {(id) => <Input id={id} type="password" value={pw} onChange={setPw} autoComplete="new-password" invalid={!!pw && pw.length < 8} />}
        </Field>
        <Field label="Confirm password" required>
          {(id) => <Input id={id} type="password" value={pw2} onChange={setPw2} autoComplete="new-password" invalid={!!pw2 && pw !== pw2} />}
        </Field>
      </div>
    </Modal>
  );
}

type UsersTab = 'users' | 'roles';

export function UsersPage() {
  const { can, user } = useApp();
  const [tab, setTab] = useState<UsersTab>('users');
  const [userModal, setUserModal] = useState<{ open: boolean; initial: UserDTO | null }>({ open: false, initial: null });
  const [roleModal, setRoleModal] = useState<{ open: boolean; initial: RoleDTO | null }>({ open: false, initial: null });
  const [resetTarget, setResetTarget] = useState<UserDTO | null>(null);
  const [query, setQuery] = useState('');

  const usersQ = useAsync(() => api['users/list'](), []);
  const rolesQ = useAsync(() => api['roles/list'](), []);

  const users = (usersQ.data ?? []).filter((u) => !query || u.username.includes(query) || u.displayName.toLowerCase().includes(query.toLowerCase()));
  const roles = (rolesQ.data ?? []);

  const userColumns: Column<UserDTO>[] = [
    { key: 'username', label: 'Username', render: (u) => <span className="mono strong">{u.username}</span> },
    { key: 'display', label: 'Display name', render: (u) => u.displayName },
    { key: 'role', label: 'Role', render: (u) => <Badge tone="brand">{u.roleName}</Badge> },
    { key: 'status', label: 'Status', render: (u) => <Badge tone={u.status === 'active' ? 'success' : u.status === 'locked' ? 'warning' : 'danger'}>{u.status}</Badge> },
    { key: 'lastLogin', label: 'Last sign-in', render: (u) => (u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : <span className="muted">never</span>) },
    { key: 'mustPw', label: 'Flags', render: (u) => (u.mustChangePassword ? <Badge tone="warning">must change password</Badge> : null) },
    {
      key: 'actions', label: '', align: 'right',
      render: (u) => (can('users.manage') ? (
        <div className="row gap-2 end">
          <Button size="sm" variant="ghost" onClick={() => setUserModal({ open: true, initial: u })}>Edit</Button>
          <Button size="sm" variant="ghost" onClick={() => setResetTarget(u)}>Reset password</Button>
        </div>
      ) : null),
    },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Users &amp; roles</h1>
          <p className="page-subtitle">Granular RBAC · enforced in the service layer on every action</p>
        </div>
        <div className="page-actions">
          <Button variant="ghost" icon={Icon.refresh} onClick={() => { usersQ.reload(); rolesQ.reload(); }}>Refresh</Button>
          {can('users.manage') && <Button variant="primary" icon={Icon.plus} onClick={() => setUserModal({ open: true, initial: null })}>New user</Button>}
          {can('roles.manage') && <Button variant="secondary" onClick={() => setRoleModal({ open: true, initial: null })}>New role</Button>}
        </div>
      </div>

      <Tabs
        tabs={[
          { key: 'users' as const, label: 'Users', count: usersQ.data?.length },
          { key: 'roles' as const, label: 'Roles', count: rolesQ.data?.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="mt-4">
        {tab === 'users' && (
          <>
            <TableToolbar>
              <div style={{ minWidth: 260, flex: '1 1 260px' }}>
                <Input value={query} onChange={setQuery} placeholder="Search users…" />
              </div>
            </TableToolbar>
            <Card pad={false}>
              {usersQ.loading && !usersQ.data ? <Spinner label="Loading users…" />
                : usersQ.error ? <ErrorState error={usersQ.error} onRetry={usersQ.reload} />
                : (
                  <DataTable
                    columns={userColumns}
                    rows={users}
                    rowKey={(u) => u.id}
                    empty={{
                      title: 'No users match',
                      body: 'Every login account appears here.',
                      action: can('users.manage') ? <Button variant="primary" onClick={() => setUserModal({ open: true, initial: null })}>New user</Button> : undefined,
                    }}
                  />
                )}
            </Card>
            <p className="xsmall muted mt-4">
              Signed in as <strong>{user?.username}</strong>. Passwords are stored only as Argon2id hashes; lockouts clear automatically.
            </p>
          </>
        )}

        {tab === 'roles' && (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
            {roles.map((r) => (
              <Card
                key={r.id}
                title={<span>{r.name} {r.builtin && <Badge tone="neutral">built-in</Badge>}</span>}
                actions={<span className="xsmall muted">{r.permissions.length} perms</span>}
              >
                <p className="small muted">{r.description}</p>
                <div className="row between mt-2">
                  <span className="small">{r.userCount} user{r.userCount === 1 ? '' : 's'}</span>
                  <div className="row gap-2">
                    <span className="xsmall muted mono">{r.key}</span>
                    {can('roles.manage') && (
                      <Button size="sm" variant="secondary" onClick={() => setRoleModal({ open: true, initial: r })}>View / edit</Button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
            {roles.length === 0 && <EmptyState title="No roles" body="Built-in roles are seeded during setup." />}
          </div>
        )}
      </div>

      <UserModal open={userModal.open} initial={userModal.initial} onClose={() => setUserModal({ open: false, initial: null })} onSaved={usersQ.reload} />
      <RoleModal open={roleModal.open} initial={roleModal.initial} onClose={() => setRoleModal({ open: false, initial: null })} onSaved={rolesQ.reload} />
      {resetTarget && <ResetPasswordModal user={resetTarget} onClose={() => setResetTarget(null)} onSaved={usersQ.reload} />}
      {can('audit.view') && (
        <div className="mt-4">
          <Button variant="ghost" size="sm" onClick={() => { window.location.hash = '#/audit'; }}>Open full audit log →</Button>
        </div>
      )}
    </div>
  );
}
