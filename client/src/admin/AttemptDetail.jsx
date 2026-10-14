import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Check, Trash2, X } from 'lucide-react';
import { adminApi } from '../api.js';
import { ATTEMPT_STATUS, Alert, Modal, PageHeader, Spinner, StatusBadge, fmtDateTime, fmtTime, fullName, LETTERS } from '../ui.jsx';
import { useLoad } from './useLoad.js';

const EVENT_TEXT = {
  started: 'Started the test',
  resumed: 'Continued on a device (re-entered details)',
  relogin_blocked: 'Tried to continue on another device (blocked, needs approval)',
  relogin_allowed: 'Coordinator allowed re-login on another device',
  left_window: 'Left the test window',
  fullscreen_exit: 'Exited full screen',
  camera_off: 'Camera turned off',
  camera_on: 'Camera turned back on',
  time_extended: 'Time extended',
  result_changed: 'Result changed by hand',
  submitted: 'Test submitted',
};
const REASON_TEXT = { student: 'by the student', time_up: 'automatically (time up)', violations: 'automatically (left the window too often)', coordinator: 'by a coordinator' };

/** Short device description from a user-agent string, e.g. "Chrome on Android". */
function deviceName(ua) {
  const browser = /Edg\//.test(ua) ? 'Edge' : /SEB\//.test(ua) ? 'Safe Exam Browser' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'unknown device';
  return `${browser} on ${os}`;
}

function Snapshot({ id, at, onOpen }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let url = '';
    adminApi.blob(`/api/admin/snapshots/${id}`).then((b) => setSrc((url = URL.createObjectURL(b)))).catch(() => {});
    return () => url && URL.revokeObjectURL(url);
  }, [id]);
  return (
    <button className="snap" onClick={() => src && onOpen(src, at)}>
      {src ? <img src={src} alt={`Camera photo at ${fmtTime(at)}`} /> : <span className="snap-ph" />}
      <span>{fmtTime(at)}</span>
    </button>
  );
}

export default function AttemptDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, error, loading } = useLoad(() => adminApi.get(`/api/admin/attempts/${id}`), [id]);
  const [zoom, setZoom] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState('');

  if (loading) return <main className="admin-main"><Spinner /></main>;
  if (error) return <main className="admin-main"><Alert>{error}</Alert></main>;
  const { attempt: a, questions, events, snapshots } = data;

  const remove = async () => {
    try {
      await adminApi.del(`/api/admin/attempts/${id}`);
      navigate(`/admin/drives/${a.drive_id}`);
    } catch (e) {
      setActionError(e.message);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={<><Link to="/admin">Drives</Link> · <Link to={`/admin/drives/${a.drive_id}`}>{a.drive_name} – {a.college}</Link></>}
        title={<>{fullName(a)} <StatusBadge map={ATTEMPT_STATUS} status={a.status} /></>}
        sub={`${a.student_code} · ${a.email} · ${a.phone}`}
      >
        <button className="btn btn-secondary danger-text" onClick={() => setConfirmDelete(true)}><Trash2 size={16} aria-hidden="true" />Delete candidate</button>
      </PageHeader>
      <main className="admin-main">
      <Alert>{actionError}</Alert>

      <div className="tiles">
        <div><span>Score</span><b>{a.status === 'submitted' ? `${a.score} / ${a.max_score}` : '—'}</b></div>
        <div><span>Percentage</span><b>{a.status === 'submitted' && a.max_score ? `${((a.score / a.max_score) * 100).toFixed(1)}%` : '—'}</b></div>
        <div><span>Times left the window</span><b className={a.violations ? 'danger-text' : ''}>{a.violations}</b></div>
        <div><span>Camera photos</span><b>{snapshots.length}</b></div>
      </div>
      <p className="muted small">
        Registered {fmtDateTime(a.registered_at)} · Started {fmtDateTime(a.started_at)} · {a.submitted_at ? `Submitted ${fmtDateTime(a.submitted_at)} ${REASON_TEXT[a.submit_reason] || ''}` : ''}
        <br />Device: {a.user_agent || 'unknown'}
      </p>

      {a.section_scores && (
        <div className="card">
          <h2>Section scores</h2>
          <table className="table compact">
            <thead><tr><th>Section</th><th className="num">Score</th><th className="num">Correct</th><th className="num">Wrong</th><th className="num">Attempted</th></tr></thead>
            <tbody>
              {a.section_scores.map((s) => (
                <tr key={s.name}><td>{s.name}</td><td className="num">{s.score}/{s.max}</td><td className="num">{s.correct}</td><td className="num">{s.wrong}</td><td className="num">{s.attempted}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h2>Camera photos</h2>
        {snapshots.length === 0 ? <p className="muted">No photos.</p> : (
          <div className="snaps">{snapshots.map((s) => <Snapshot key={s.id} id={s.id} at={s.created_at} onOpen={(src, at) => setZoom({ src, at })} />)}</div>
        )}
      </div>

      <div className="grid-2 align-start">
        <div className="card">
          <h2>Activity log</h2>
          <ul className="timeline">
            {events.map((e, i) => (
              <li key={i} className={['left_window', 'camera_off', 'fullscreen_exit', 'relogin_blocked'].includes(e.type) ? 'warn' : ''}>
                <span className="t">{fmtTime(e.created_at)}</span>
                <span>
                  {EVENT_TEXT[e.type] || e.type}
                  {['time_extended', 'submitted', 'relogin_allowed', 'result_changed'].includes(e.type) && ` (${e.detail})`}
                  {['resumed', 'relogin_blocked', 'started'].includes(e.type) && e.detail && <small className="muted"> · {deviceName(e.detail)}</small>}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h2>Answers</h2>
          {questions.length === 0 ? <p className="muted">The test has not been started.</p> : (
            <ol className="answer-list">
              {questions.map((q) => {
                const right = q.selected === q.correctIndex;
                return (
                  <li key={q.id} className={q.selected == null ? 'is-skipped' : right ? 'is-right' : 'is-wrong'}>
                    <div className="answer-q"><b>Q{q.n}.</b> {q.text} <small className="muted">({q.section})</small></div>
                    <div className="answer-a">
                      {q.selected == null ? 'Not answered' : <>Answered: {LETTERS[q.selected]}. {q.options[q.selected]} {right
                        ? <Check size={14} aria-label="right" style={{ verticalAlign: '-2px', color: 'var(--status-success)' }} />
                        : <X size={14} aria-label="wrong" style={{ verticalAlign: '-2px', color: 'var(--status-danger)' }} />}</>}
                      {!right && <span className="muted"> · Correct: {LETTERS[q.correctIndex]}. {q.options[q.correctIndex]}</span>}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          <p className="muted small">Option letters follow the original exam order, not the shuffled order the student saw.</p>
        </div>
      </div>

      </main>
      {zoom && (
        <Modal title={`Photo at ${fmtTime(zoom.at)}`} onClose={() => setZoom(null)} actions={<button className="btn" onClick={() => setZoom(null)}>Close</button>}>
          <img src={zoom.src} alt="" className="zoom-img" />
        </Modal>
      )}
      {confirmDelete && (
        <Modal
          title="Delete this candidate?"
          onClose={() => setConfirmDelete(false)}
          actions={<><button className="btn btn-secondary" onClick={() => setConfirmDelete(false)}>Cancel</button><button className="btn btn-danger" onClick={remove}>Delete</button></>}
        >
          <p>This removes {fullName(a)}'s registration, answers, photos and result. They will be able to register and take the test again.</p>
        </Modal>
      )}
    </>
  );
}
