import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { studentApi, local } from '../api.js';
import { Alert, Logo, Spinner } from '../ui.jsx';
import Register from './Register.jsx';
import Instructions from './Instructions.jsx';
import Exam from './Exam.jsx';
import Done from './Done.jsx';
import { exitFullscreen, stopCamera } from './camera.js';

export function StudentShell({ drive, right, children }) {
  return (
    <div className="student">
      <header className="topbar">
        <Logo height={32} />
        <span className="topbar-sep" aria-hidden="true" />
        <div className="topbar-title">
          <strong>{drive?.name || 'Rite Exam Portal'}</strong>
          {drive?.college && <span>{drive.college}</span>}
        </div>
        <div className="topbar-right">{right}</div>
      </header>
      <main className="student-main">{children}</main>
    </div>
  );
}

export default function StudentDrive() {
  const { code } = useParams();
  const tokenKey = `rite_exam_token_${code.toLowerCase()}`;
  const [token, setToken] = useState(() => local.get(tokenKey));
  const [drive, setDrive] = useState(null);
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await studentApi.drive(code);
        if (cancelled) return;
        setDrive(d);
        if (token) {
          try {
            const s = await studentApi.state(token);
            if (!cancelled) setState(s);
          } catch (e) {
            if (e.status !== 401) throw e;
            local.del(tokenKey);
            setToken(null);
          }
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const onRegistered = useCallback(async (t) => {
    local.set(tokenKey, t);
    setToken(t);
    setState(await studentApi.state(t));
  }, [tokenKey]);

  const onSessionLost = useCallback(() => {
    // The test continues on another device: release this device's camera and full screen.
    stopCamera();
    exitFullscreen();
    local.del(tokenKey);
    setToken(null);
    setState(null);
    setNotice('This test was opened on another device or browser. To continue here, enter the same details you registered with.');
  }, [tokenKey]);

  // A shared lab PC: forget the previous candidate so the next one can register.
  const onNextCandidate = useCallback(() => {
    local.del(tokenKey);
    setToken(null);
    setState(null);
    setNotice('');
  }, [tokenKey]);

  const onSubmitted = useCallback((reason) => setState((s) => ({ ...s, status: 'submitted', submitReason: reason })), []);

  if (loading) return <StudentShell><Spinner /></StudentShell>;
  if (error) {
    return (
      <StudentShell>
        <div className="card narrow"><h1>Cannot open this test</h1><Alert>{error}</Alert></div>
      </StudentShell>
    );
  }
  if (!state) {
    return (
      <StudentShell drive={drive}>
        <Register drive={drive} code={code} notice={notice} onRegistered={onRegistered} />
      </StudentShell>
    );
  }
  if (state.status === 'registered') return <Instructions state={state} token={token} onStarted={setState} onSessionLost={onSessionLost} />;
  if (state.status === 'in_progress') return <Exam state={state} token={token} onSubmitted={onSubmitted} onSessionLost={onSessionLost} />;
  return <Done state={state} onNextCandidate={onNextCandidate} />;
}
