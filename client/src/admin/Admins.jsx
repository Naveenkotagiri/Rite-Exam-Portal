import { useState } from 'react';
import { adminApi, adminSession } from '../api.js';
import { Alert, Field, PageHeader, Spinner, fmtDate, initials } from '../ui.jsx';
import { useLoad } from './useLoad.js';

export default function Admins() {
  const me = adminSession.get()?.admin;
  const { data: admins, error, loading, reload } = useLoad(() => adminApi.get('/api/admin/admins'));
  const [actionError, setActionError] = useState('');

  const remove = async (a) => {
    if (!window.confirm(`Remove admin access for ${a.name}?`)) return;
    try {
      await adminApi.del(`/api/admin/admins/${a.id}`);
      reload();
    } catch (e) {
      setActionError(e.message);
    }
  };

  return (
    <>
      <PageHeader eyebrow="Settings" title="Admins" sub="Everyone here can manage exams, drives and results." />
      <main className="admin-main">
      <Alert>{error || actionError}</Alert>
      <div className="grid-2 align-start">
        <div className="card table-card">
          {loading ? <Spinner /> : (
            <table className="table">
              <thead><tr><th>Name</th><th>Email</th><th>Added</th><th /></tr></thead>
              <tbody>
                {admins?.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                        <span className="avatar" aria-hidden="true">{initials(a.name)}</span>
                        <span>{a.name}{a.id === me?.id && <span className="muted"> (you)</span>}</span>
                      </span>
                    </td>
                    <td>{a.email}</td>
                    <td className="mono small">{fmtDate(a.created_at)}</td>
                    <td className="row-actions">{a.id !== me?.id && <button className="btn btn-sm btn-secondary danger-text" onClick={() => remove(a)}>Remove</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="stack">
          <AddAdmin onAdded={reload} />
          <ChangePassword />
        </div>
      </div>
      </main>
    </>
  );
}

function AddAdmin({ onAdded }) {
  const [v, setV] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [done, setDone] = useState('');
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    setMessage('');
    setDone('');
    try {
      await adminApi.post('/api/admin/admins', v);
      setDone(`${v.email} can now log in. Share the password with them securely.`);
      setV({ name: '', email: '', password: '' });
      setErrors({});
      onAdded();
    } catch (err) {
      setErrors(err.data?.fields || {});
      setMessage(err.message);
    }
  }

  return (
    <form className="card" onSubmit={save}>
      <h2>Add an admin</h2>
      <Field label="Name" required error={errors.name}>{(id) => <input id={id} value={v.name} onChange={set('name')} />}</Field>
      <Field label="Email" required error={errors.email}>{(id) => <input id={id} type="email" value={v.email} onChange={set('email')} autoComplete="off" />}</Field>
      <Field label="Temporary password" required error={errors.password} hint="At least 8 characters.">{(id) => <input id={id} type="text" value={v.password} onChange={set('password')} autoComplete="new-password" />}</Field>
      <Alert>{message}</Alert>
      <Alert kind="success">{done}</Alert>
      <div className="actions"><button className="btn">Add admin</button></div>
    </form>
  );
}

function ChangePassword() {
  const [v, setV] = useState({ currentPassword: '', newPassword: '' });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [done, setDone] = useState(false);
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    setMessage('');
    setDone(false);
    try {
      await adminApi.put('/api/admin/me/password', v);
      setDone(true);
      setV({ currentPassword: '', newPassword: '' });
      setErrors({});
    } catch (err) {
      setErrors(err.data?.fields || {});
      setMessage(err.message);
    }
  }

  return (
    <form className="card" onSubmit={save}>
      <h2>Change my password</h2>
      <Field label="Current password" error={errors.currentPassword}>{(id) => <input id={id} type="password" value={v.currentPassword} onChange={set('currentPassword')} autoComplete="current-password" />}</Field>
      <Field label="New password" error={errors.newPassword} hint="At least 8 characters.">{(id) => <input id={id} type="password" value={v.newPassword} onChange={set('newPassword')} autoComplete="new-password" />}</Field>
      <Alert>{message}</Alert>
      <Alert kind="success">{done && 'Password changed.'}</Alert>
      <div className="actions"><button className="btn">Change password</button></div>
    </form>
  );
}
