import { useEffect, useState } from 'react';
import { adminApi } from '../api.js';
import { Alert, Checkbox, Field, Modal } from '../ui.jsx';

const pad = (n) => String(n).padStart(2, '0');
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);

function initial(drive) {
  if (!drive) {
    return {
      name: 'Campus Placement Drive', college: '', examId: '', code: '', driveDate: new Date().toISOString().slice(0, 10),
      opensAt: '', closesAt: '', isOpen: true, cameraRequired: true, snapshotIntervalSec: 90, requireFullscreen: true,
      maxViolations: 3, requireSeb: false, shuffleQuestions: true, shuffleOptions: true,
    };
  }
  return {
    name: drive.name, college: drive.college, examId: drive.exam_id, code: drive.code, driveDate: drive.drive_date?.slice(0, 10) || '',
    opensAt: toLocalInput(drive.opens_at), closesAt: toLocalInput(drive.closes_at), isOpen: drive.is_open,
    cameraRequired: drive.camera_required, snapshotIntervalSec: drive.snapshot_interval_sec, requireFullscreen: drive.require_fullscreen,
    maxViolations: drive.max_violations, requireSeb: drive.require_seb, shuffleQuestions: drive.shuffle_questions, shuffleOptions: drive.shuffle_options,
  };
}

export default function DriveForm({ drive, onClose, onSaved }) {
  const [v, setV] = useState(() => initial(drive));
  const [exams, setExams] = useState([]);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    adminApi.get('/api/admin/exams').then(setExams).catch((e) => setMessage(e.message));
  }, []);

  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    const body = { ...v, opensAt: fromLocalInput(v.opensAt), closesAt: fromLocalInput(v.closesAt) };
    try {
      const saved = drive ? await adminApi.put(`/api/admin/drives/${drive.id}`, body) : await adminApi.post('/api/admin/drives', body);
      onSaved(saved);
    } catch (err) {
      setErrors(err.data?.fields || {});
      setMessage(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      wide
      title={drive ? 'Edit drive' : 'New drive'}
      onClose={onClose}
      actions={
        <>
          <button className="btn btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn" form="drive-form" disabled={busy}>{busy ? 'Saving…' : 'Save drive'}</button>
        </>
      }
    >
      <form id="drive-form" onSubmit={save}>
        <div className="grid-2">
          <Field label="Drive name" required error={errors.name}>{(id) => <input id={id} value={v.name} onChange={set('name')} />}</Field>
          <Field label="College" required error={errors.college}>{(id) => <input id={id} value={v.college} onChange={set('college')} placeholder="e.g. IBS Hyderabad" />}</Field>
          <Field label="Exam" required error={errors.examId}>
            {(id) => (
              <select id={id} value={v.examId} onChange={set('examId')}>
                <option value="">Choose an exam…</option>
                {exams.map((x) => <option key={x.id} value={x.id}>{x.title} ({x.question_count} questions, {x.duration_min} min)</option>)}
              </select>
            )}
          </Field>
          <Field label="Drive date" error={errors.driveDate}>{(id) => <input id={id} type="date" value={v.driveDate} onChange={set('driveDate')} />}</Field>
          <Field label="Opens at" error={errors.opensAt} hint="Optional. Leave empty to open now.">{(id) => <input id={id} type="datetime-local" value={v.opensAt} onChange={set('opensAt')} />}</Field>
          <Field label="Closes at" error={errors.closesAt} hint="Optional. No new starts after this time.">{(id) => <input id={id} type="datetime-local" value={v.closesAt} onChange={set('closesAt')} />}</Field>
          <Field label="Link code" error={errors.code} hint="Optional. Leave empty to generate one.">{(id) => <input id={id} value={v.code} onChange={set('code')} placeholder="e.g. ibs-hyd-oct26" />}</Field>
        </div>

        <h3>Proctoring</h3>
        <div className="grid-2">
          <div className="stack">
            <Checkbox checked={v.cameraRequired} onChange={set('cameraRequired')}>Camera must be on (photos taken during the test)</Checkbox>
            <Checkbox checked={v.requireFullscreen} onChange={set('requireFullscreen')}>Full-screen mode required</Checkbox>
            <Checkbox checked={v.requireSeb} onChange={set('requireSeb')}>Require Safe Exam Browser (college lab PCs)</Checkbox>
            <Checkbox checked={v.shuffleQuestions} onChange={set('shuffleQuestions')}>Shuffle question order for each student</Checkbox>
            <Checkbox checked={v.shuffleOptions} onChange={set('shuffleOptions')}>Shuffle answer options for each student</Checkbox>
          </div>
          <div>
            <Field label="Auto-submit when the student leaves the window this many times" error={errors.maxViolations} hint="0 = never auto-submit, only record.">
              {(id) => <input id={id} type="number" min="0" max="50" value={v.maxViolations} onChange={set('maxViolations')} />}
            </Field>
            <Field label="Average seconds between camera photos" error={errors.snapshotIntervalSec}>
              {(id) => <input id={id} type="number" min="30" max="600" value={v.snapshotIntervalSec} onChange={set('snapshotIntervalSec')} disabled={!v.cameraRequired} />}
            </Field>
          </div>
        </div>
        <Alert>{message}</Alert>
      </form>
    </Modal>
  );
}
