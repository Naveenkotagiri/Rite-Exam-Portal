import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Clock, Search } from 'lucide-react';
import { studentApi } from '../api.js';
import { Alert, Eyebrow, Field, Spinner } from '../ui.jsx';
import { StudentShell } from './StudentDrive.jsx';

/** Students look up their published result with Student ID + phone. Shows the status and HR's message, never marks. */
export default function StudentResult() {
  const { code } = useParams();
  const [drive, setDrive] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [studentId, setStudentId] = useState('');
  const [phone, setPhone] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    studentApi.drive(code).then(setDrive).catch((e) => setLoadError(e.message));
  }, [code]);

  async function check(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setResult(await studentApi.result(code, studentId, phone));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <StudentShell><div className="card narrow"><Alert>{loadError}</Alert></div></StudentShell>;
  if (!drive) return <StudentShell><Spinner /></StudentShell>;

  const back = <Link to={`/d/${code}`} className="btn btn-ghost btn-sm"><ArrowLeft size={16} aria-hidden="true" />Back</Link>;

  if (!drive.resultsPublished) {
    return (
      <StudentShell drive={drive}>
        <div className="card narrow center" style={{ padding: 40, marginTop: 24 }}>
          <span className="result-plate" aria-hidden="true"><Clock size={30} /></span>
          <h1>Results are not out yet</h1>
          <p className="muted" style={{ marginTop: 12 }}>Results for this drive have not been published yet. Please check this page again later.</p>
          {back}
        </div>
      </StudentShell>
    );
  }

  if (result) {
    const shortlisted = result.status === 'shortlisted';
    return (
      <StudentShell drive={drive}>
        <div className="card narrow center" style={{ padding: 40, marginTop: 24, maxWidth: 560 }}>
          {shortlisted
            ? <span className="done-icon" aria-hidden="true"><Check size={34} strokeWidth={2.5} /></span>
            : <span className="result-plate" aria-hidden="true"><Clock size={30} /></span>}
          <Eyebrow>{drive.examTitle}</Eyebrow>
          {shortlisted && <h1>Congratulations, {result.firstName}. You are shortlisted.</h1>}
          {result.status === 'not_selected' && <h1>Thank you, {result.firstName}.</h1>}
          {result.status === 'not_submitted' && <h1>No submitted test found</h1>}
          {result.status === 'not_submitted'
            ? <p className="muted" style={{ marginTop: 12 }}>You registered, {result.firstName}, but your test was not submitted, so there is no result.</p>
            : result.message && (
              <div className="result-message">
                {shortlisted && <div className="eyebrow">Next steps</div>}
                {result.message}
              </div>
            )}
          <button className="btn btn-secondary" onClick={() => { setResult(null); setStudentId(''); setPhone(''); }}>Check another result</button>
        </div>
      </StudentShell>
    );
  }

  return (
    <StudentShell drive={drive}>
      <div className="card narrow" style={{ padding: 32, marginTop: 24 }}>
        <Eyebrow>Results · {drive.college}</Eyebrow>
        <h1 className="rite-underline">Check my result</h1>
        <p className="muted">Enter the Student ID and phone number you registered with.</p>
        <form onSubmit={check} style={{ marginTop: 16 }}>
          <Field label="Student ID" required>
            {(id) => <input id={id} value={studentId} onChange={(e) => setStudentId(e.target.value)} autoComplete="off" required />}
          </Field>
          <Field label="Phone Number" required>
            {(id) => <input id={id} type="tel" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" required />}
          </Field>
          <Alert>{error}</Alert>
          <div className="actions" style={{ justifyContent: 'space-between' }}>
            {back}
            <button className="btn" disabled={busy}><Search size={16} aria-hidden="true" />{busy ? 'Checking…' : 'Check result'}</button>
          </div>
        </form>
      </div>
    </StudentShell>
  );
}
