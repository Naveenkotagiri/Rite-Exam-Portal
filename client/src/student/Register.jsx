import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { studentApi } from '../api.js';
import { Alert, Eyebrow, Field, fmtDate, fmtDateTime } from '../ui.jsx';
import { STUDENT_FIELDS, normalizeStudent, validateStudent } from '../../../shared/validation.js';

const EMPTY = Object.fromEntries(STUDENT_FIELDS.map((f) => [f.name, '']));

export default function Register({ drive, code, notice, onRegistered }) {
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (name) => (e) => {
    setValues((v) => ({ ...v, [name]: e.target.value }));
    if (errors[name]) setErrors(({ [name]: _, ...rest }) => rest);
  };

  async function submit(e) {
    e.preventDefault();
    const s = normalizeStudent(values);
    const fieldErrors = validateStudent(s);
    setErrors(fieldErrors);
    setMessage('');
    if (Object.keys(fieldErrors).length) {
      document.querySelector(`[name="${Object.keys(fieldErrors)[0]}"]`)?.focus();
      return;
    }
    setBusy(true);
    try {
      const res = await studentApi.register(code, s);
      await onRegistered(res.token);
    } catch (err) {
      setErrors(err.data?.fields || {});
      setMessage(err.message);
      setBusy(false);
    }
  }

  const closedMsg = drive.status === 'not_started'
    ? `This test opens at ${fmtDateTime(drive.opensAt)}. If you already started it on another device, enter the same details to continue.`
    : drive.status === 'closed'
      ? 'This test is closed for new candidates. If you already started it, enter the same details you registered with to continue.'
      : '';

  return (
    <div className="hero-split">
      <section className="hero-panel">
        <img className="watermark" src="/brand/rite-mark.png" alt="" />
        <div>
          <Eyebrow onDark>Campus drive · {drive.college}</Eyebrow>
          <h1 className="rite-underline">{drive.examTitle}</h1>
          <p>Register with your details to begin. Keep your college ID card with you during the test.</p>
        </div>
        <div className="hero-stats">
          <div><b>{drive.durationMin}</b><span>minutes</span></div>
          <div><b>{drive.questionCount}</b><span>questions</span></div>
          {drive.driveDate && <div><b className="mono" style={{ fontSize: 20, lineHeight: '30px' }}>{fmtDate(drive.driveDate)}</b><span>drive date</span></div>}
        </div>
      </section>

      <section className="card register" style={{ margin: 0 }}>
        <Eyebrow>Step 1 of 2</Eyebrow>
        <h1>Candidate Registration</h1>
        <p className="muted" style={{ marginTop: 6 }}>Enter your details exactly as they appear on your college ID card.</p>
        {drive.resultsPublished && (
          <Alert kind="success">
            <b>Results for this drive are out.</b> Already took the test? <Link to={`/d/${code}/result`}>Check my result</Link>
          </Alert>
        )}
        <Alert kind="info">{notice}</Alert>
        <Alert kind="warn">{drive.resultsPublished ? '' : closedMsg}</Alert>
        <form onSubmit={submit} noValidate style={{ marginTop: 20 }}>
          <div className="grid-3">
            {STUDENT_FIELDS.map((f) => (
              <Field key={f.name} label={f.label} required={f.required} error={errors[f.name]}>
                {(id) => (
                  <input
                    id={id}
                    name={f.name}
                    type={f.type || 'text'}
                    inputMode={f.type === 'tel' ? 'numeric' : undefined}
                    autoComplete={f.autoComplete || 'off'}
                    placeholder={f.placeholder}
                    value={values[f.name]}
                    onChange={set(f.name)}
                    aria-invalid={Boolean(errors[f.name])}
                  />
                )}
              </Field>
            ))}
          </div>
          <Alert>{message}</Alert>
          <div className="actions">
            <button className="btn btn-lg" type="submit" disabled={busy}>
              {busy ? 'Please wait…' : 'Register & Continue'}
              {!busy && <ArrowRight size={18} aria-hidden="true" />}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
