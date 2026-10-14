import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Lock, Mail } from 'lucide-react';
import { adminApi, adminSession } from '../api.js';
import { Alert, Eyebrow, Field, Logo } from '../ui.jsx';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const [params] = useSearchParams();

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await adminApi.login(email, password);
      adminSession.set(res);
      const next = params.get('next');
      navigate(next && next.startsWith('/admin') && next !== '/admin/login' ? next : '/admin', { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="signin">
      <div className="signin-brand">
        <img className="watermark" src="/brand/rite-mark.png" alt="" />
        <Logo variant="white" height={34} />
        <div>
          <Eyebrow onDark>Rite Exam Portal · Campus hiring</Eyebrow>
          <h1 className="rite-underline">Written tests, without the paper.</h1>
          <p>Register candidates, run proctored tests on any device, and see every score the moment a test is submitted.</p>
        </div>
        <div className="hero-stats stats-hide">
          <div><b>6</b><span>details per candidate</span></div>
          <div><b>0</b><span>answer sheets to mark</span></div>
          <div><b>1</b><span>link per drive</span></div>
        </div>
      </div>
      <div className="signin-form">
        <form onSubmit={submit}>
          <h2>Admin login</h2>
          <p className="muted">For HR and placement coordinators.</p>
          <Field label="Email">
            {(id) => (
              <div className="search-box" style={{ flex: 'none' }}>
                <Mail size={16} aria-hidden="true" />
                <input id={id} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
            )}
          </Field>
          <Field label="Password">
            {(id) => (
              <div className="search-box" style={{ flex: 'none' }}>
                <Lock size={16} aria-hidden="true" />
                <input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
            )}
          </Field>
          <Alert>{error}</Alert>
          <button className="btn btn-lg btn-block" disabled={busy} style={{ marginTop: 8 }}>{busy ? 'Signing in…' : 'Log in'}</button>
          <p className="muted small center" style={{ marginTop: 20 }}>Forgotten your password? Ask another admin to reset it.</p>
        </form>
      </div>
    </div>
  );
}
