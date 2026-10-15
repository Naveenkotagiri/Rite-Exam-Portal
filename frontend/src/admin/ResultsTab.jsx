import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EyeOff, FileSpreadsheet, Megaphone, Pencil, RefreshCw, UserCheck, UserX } from 'lucide-react';
import { adminApi } from '../api.js';
import { Alert, Badge, Field, Modal, ShowMore, Spinner, fmtDateTime, fmtTime, fullName, usePaging } from '../ui.jsx';
import { useLoad } from './useLoad.js';

const REASON_TEXT = { student: 'Student', time_up: 'Time up', violations: 'Auto (left window)', coordinator: 'Coordinator' };
const DEFAULT_OTHER = 'Thank you for taking the test. You have not been shortlisted this time. We wish you the very best.';
const pct = (a) => (a.max_score ? (a.score / a.max_score) * 100 : 0);

export default function ResultsTab({ drive, onDriveChanged }) {
  const { data, error, reload } = useLoad(() => adminApi.get(`/api/admin/drives/${drive.id}/attempts`), [drive.id]);
  const published = Boolean(drive.results_published_at);
  const [cutoff, setCutoff] = useState(drive.results_cutoff_pct ?? '');
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setCutoff(drive.results_cutoff_pct ?? ''); }, [drive.results_cutoff_pct]);
  const paging = usePaging(`${cutoff}|${published}`);

  if (!data) return error ? <Alert>{error}</Alert> : <Spinner />;
  const submitted = data.attempts.filter((a) => a.status === 'submitted');
  const shown = cutoff === '' || published ? submitted : submitted.filter((a) => pct(a) >= Number(cutoff));
  const avg = submitted.length ? submitted.reduce((t, a) => t + pct(a), 0) / submitted.length : 0;
  const shortlisted = submitted.filter((a) => a.result_status === 'shortlisted').length;

  const run = async (fn) => {
    setBusy(true);
    setMessage('');
    try {
      await fn();
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  };

  const exportXlsx = () => run(() => adminApi.download(`/api/admin/drives/${drive.id}/results.xlsx`, `${drive.college}-${drive.name}-results.xlsx`.replace(/[^\w.-]+/g, '_')));
  const regrade = () => run(async () => {
    const r = await adminApi.post(`/api/admin/drives/${drive.id}/regrade`);
    setMessage(`Re-graded ${r.regraded} submitted tests with the current answer key.${published ? ' Click Update results so students see the new shortlist.' : ''}`);
    await reload();
  });
  const setResult = (a, status) => run(async () => {
    await adminApi.put(`/api/admin/attempts/${a.id}/result`, { status });
    await reload();
  });
  const unpublish = () => run(async () => {
    await adminApi.post(`/api/admin/drives/${drive.id}/unpublish`);
    await onDriveChanged();
  });

  return (
    <>
      <div className="stat-row">
        <div className="stat"><b>{submitted.length}</b><span>Submitted</span></div>
        <div className="stat"><b>{avg.toFixed(1)}%</b><span>Average score</span></div>
        {published
          ? <div className="stat"><b>{shortlisted}</b><span>Shortlisted (published)</span></div>
          : <div className="stat"><b>{shown.length}</b><span>{cutoff === '' ? 'Shown' : `Scored ≥ ${cutoff}%`}</span></div>}
      </div>

      {published && !editing ? (
        <div className="alert alert-success publish-bar" role="status">
          <Megaphone size={18} aria-hidden="true" />
          <div>
            <b>Results published {fmtDateTime(drive.results_published_at)}</b> · cutoff {drive.results_cutoff_pct}% · {shortlisted} shortlisted, {submitted.length - shortlisted} not selected.
            <div className="small">Students see Shortlisted or Not selected and your message on the drive link. Marks are not shown.</div>
          </div>
          <div className="btn-row">
            <button className="btn btn-sm btn-secondary" onClick={() => setEditing(true)} disabled={busy}><Pencil size={15} aria-hidden="true" />Update results</button>
            <button className="btn btn-sm btn-secondary" onClick={unpublish} disabled={busy}><EyeOff size={15} aria-hidden="true" />Unpublish</button>
          </div>
        </div>
      ) : (
        <PublishForm
          drive={drive} cutoff={cutoff} setCutoff={setCutoff} submitted={submitted} updating={published}
          notSubmitted={data.attempts.length - submitted.length} onRefresh={reload}
          onCancel={published ? () => setEditing(false) : null}
          onPublished={async () => { setEditing(false); await Promise.all([onDriveChanged(), reload()]); }}
        />
      )}

      <div className="toolbar">
        <span className="muted small">{published ? 'Use the buttons in the Result column to move a candidate in or out of the shortlist.' : 'Rows show candidates at or above the cutoff.'}</span>
        <div className="btn-row">
          <button className="btn btn-secondary" onClick={regrade} disabled={busy} title="Use after correcting an answer in the exam"><RefreshCw size={16} aria-hidden="true" />Re-grade</button>
          <button className="btn" onClick={exportXlsx} disabled={busy}><FileSpreadsheet size={16} aria-hidden="true" />Export to Excel</button>
        </div>
      </div>
      <Alert kind="info">{message}</Alert>

      <div className="card table-card">
        <table className="table table-fit">
          <thead>
            <tr>
              <th className="num">Rank</th><th>Candidate</th><th>Contact</th>
              <th className="num">Score</th><th className="num">%</th>
              {data.sections.map((s) => <th key={s} className="num">{s}</th>)}
              <th className="num" title="Times the candidate left the test window">Left</th><th>Submitted</th>
              {published && <th>Result</th>}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={8 + data.sections.length} className="empty">No submitted tests{cutoff !== '' && !published ? ' at this score' : ' yet'}.</td></tr>}
            {shown.slice(0, paging.limit).map((a) => {
              const secs = new Map((a.section_scores || []).map((s) => [s.name, s]));
              const isIn = a.result_status === 'shortlisted';
              return (
                <tr key={a.id}>
                  <td className="num">{a.rank}</td>
                  <td className="cell-person">
                    <Link to={`/admin/attempts/${a.id}`}>{fullName(a)}</Link>
                    <span className="mono">{a.student_code}</span>
                  </td>
                  <td className="cell-person">
                    <span className="contact">{a.email}</span>
                    <span className="mono">{a.phone}</span>
                  </td>
                  <td className="num"><b>{a.score}</b>/{a.max_score}</td>
                  <td className="num">{pct(a).toFixed(1)}</td>
                  {data.sections.map((s) => <td key={s} className="num">{secs.has(s) ? `${secs.get(s).score}/${secs.get(s).max}` : '—'}</td>)}
                  <td className="num">{a.violations > 0 ? <b className="danger-text">{a.violations}</b> : 0}</td>
                  <td className="nowrap"><span className="mono small">{fmtTime(a.submitted_at)}</span><div className="small muted">{REASON_TEXT[a.submit_reason]}</div></td>
                  {published && (
                    <td className="nowrap">
                      <Badge tone={isIn ? 'success' : 'neutral'} dot>{isIn ? 'Shortlisted' : 'Not selected'}</Badge>
                      <button
                        className="btn btn-sm btn-secondary btn-icon" style={{ marginLeft: 6 }} disabled={busy}
                        onClick={() => setResult(a, isIn ? 'not_selected' : 'shortlisted')}
                        aria-label={isIn ? 'Remove from shortlist' : 'Add to shortlist'} title={isIn ? 'Remove from shortlist' : 'Add to shortlist'}
                      >
                        {isIn ? <UserX size={15} aria-hidden="true" /> : <UserCheck size={15} aria-hidden="true" />}
                      </button>
                      {a.result_manual && <div className="small muted">changed by hand</div>}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ShowMore shown={Math.min(paging.limit, shown.length)} total={shown.length} paging={paging} />
    </>
  );
}

function PublishForm({ drive, cutoff, setCutoff, submitted, notSubmitted, updating, onRefresh, onCancel, onPublished }) {
  const [nextSteps, setNextSteps] = useState(drive.results_next_steps || '');
  const [other, setOther] = useState(drive.results_other_message || DEFAULT_OTHER);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  // Candidates changed by hand keep their result; everyone else follows the cutoff.
  const willShortlist = cutoff === '' ? 0 : submitted.filter((a) =>
    (a.result_manual ? a.result_status === 'shortlisted' : pct(a) >= Number(cutoff))).length;

  const check = async () => {
    const e = {};
    if (cutoff === '' || Number(cutoff) < 0 || Number(cutoff) > 100) e.cutoffPct = 'Enter a cutoff from 0 to 100.';
    if (!nextSteps.trim()) e.nextSteps = 'Tell shortlisted candidates what happens next.';
    setErrors(e);
    if (Object.keys(e).length) return;
    await onRefresh(); // the counts in the confirmation must include tests submitted since this page loaded
    setConfirming(true);
  };

  const publish = async () => {
    setBusy(true);
    setError('');
    try {
      await adminApi.post(`/api/admin/drives/${drive.id}/publish`, { cutoffPct: Number(cutoff), nextSteps, otherMessage: other });
      setConfirming(false);
      await onPublished();
    } catch (e) {
      setErrors(e.data?.fields || {});
      setError(e.message);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2>{updating ? 'Update published results' : 'Publish results to students'}</h2>
      </div>
      <p className="muted small">
        Students check their result on the drive link with their Student ID and phone number.
        They see only <b>Shortlisted</b> or <b>Not selected</b> and your message. Marks are not shown.
      </p>
      <div className="grid-3">
        <Field label="Shortlist: score at least (%)" required error={errors.cutoffPct} hint={`${willShortlist} of ${submitted.length} submitted would be shortlisted`}>
          {(id) => <input id={id} type="number" min="0" max="100" step="0.5" value={cutoff} onChange={(e) => setCutoff(e.target.value)} placeholder="e.g. 60" />}
        </Field>
      </div>
      <div className="grid-2">
        <Field label="Message for shortlisted candidates" required error={errors.nextSteps} hint="The next round: date, time, venue, what to bring.">
          {(id) => <textarea id={id} rows="4" value={nextSteps} onChange={(e) => setNextSteps(e.target.value)} placeholder="e.g. Your interview is on 20 Oct at 10:00 am at the Rite office, Hyderabad. Bring your college ID and resume." />}
        </Field>
        <Field label="Message for other candidates" error={errors.otherMessage}>
          {(id) => <textarea id={id} rows="4" value={other} onChange={(e) => setOther(e.target.value)} />}
        </Field>
      </div>
      <Alert>{error}</Alert>
      <div className="actions" style={{ marginTop: 0 }}>
        {onCancel && <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>}
        <button className="btn" onClick={check} disabled={busy}><Megaphone size={16} aria-hidden="true" />{updating ? 'Update results' : 'Publish results'}</button>
      </div>
      {confirming && (
        <Modal
          title={updating ? 'Update the published results?' : 'Publish results to students?'}
          onClose={() => setConfirming(false)}
          actions={<><button className="btn btn-secondary" onClick={() => setConfirming(false)}>Cancel</button><button className="btn" onClick={publish} disabled={busy}>{updating ? 'Update' : 'Publish'}</button></>}
        >
          <p><b>{willShortlist}</b> candidates will see <b>Shortlisted</b> and <b>{submitted.length - willShortlist}</b> will see <b>Not selected</b>.</p>
          {notSubmitted > 0 && (
            <Alert kind="warn"><b>{notSubmitted}</b> candidates have not submitted yet. When they submit, they get their result by the same cutoff.</Alert>
          )}
          <p>Students can check this on the drive link straight away. You can change or unpublish it later.</p>
        </Modal>
      )}
    </div>
  );
}
