import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CopyPlus, FilePlus, Plus, Trash2 } from 'lucide-react';
import { adminApi } from '../api.js';
import { Alert, EmptyState, Field, Modal, PageHeader, Spinner, fmtDate } from '../ui.jsx';
import { useLoad } from './useLoad.js';

export default function Exams() {
  const { data: exams, error, loading, reload } = useLoad(() => adminApi.get('/api/admin/exams'));
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState('');
  const navigate = useNavigate();

  const duplicate = async (e) => {
    try {
      const copy = await adminApi.post(`/api/admin/exams/${e.id}/duplicate`);
      navigate(`/admin/exams/${copy.id}`);
    } catch (err) {
      setActionError(err.message);
    }
  };

  const remove = async (e) => {
    if (!window.confirm(`Delete "${e.title}" and all its questions?`)) return;
    try {
      await adminApi.del(`/api/admin/exams/${e.id}`);
      reload();
    } catch (err) {
      setActionError(err.message);
    }
  };

  return (
    <>
      <PageHeader eyebrow="Question papers" title="Exams" sub="An exam is a question paper. The same exam can be used for many drives.">
        <button className="btn" onClick={() => setCreating(true)}><Plus size={18} aria-hidden="true" />New exam</button>
      </PageHeader>
      <main className="admin-main">
        <Alert>{error || actionError}</Alert>
        {loading ? <Spinner /> : exams?.length === 0 ? (
          <div className="card">
            <EmptyState icon={FilePlus} title="No exams yet">Create one, then upload your questions from Excel.</EmptyState>
          </div>
        ) : (
          <div className="card table-card">
            <table className="table">
              <thead><tr><th>Title</th><th className="num">Questions</th><th className="num">Marks</th><th className="num">Minutes</th><th className="num">Drives</th><th>Created</th><th /></tr></thead>
              <tbody>
                {exams?.map((e) => (
                  <tr key={e.id}>
                    <td><Link to={`/admin/exams/${e.id}`}>{e.title}</Link></td>
                    <td className="num">{e.question_count}</td>
                    <td className="num">{e.total_marks}</td>
                    <td className="num">{e.duration_min}</td>
                    <td className="num">{e.drive_count}</td>
                    <td className="mono small">{fmtDate(e.created_at)}</td>
                    <td className="row-actions">
                      <button className="btn btn-sm btn-secondary" onClick={() => duplicate(e)}><CopyPlus size={15} aria-hidden="true" />Duplicate</button>
                      <button className="btn btn-sm btn-secondary danger-text" onClick={() => remove(e)} disabled={e.drive_count > 0} title={e.drive_count ? 'Used by a drive' : ''}><Trash2 size={15} aria-hidden="true" />Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
      {creating && <NewExam onClose={() => setCreating(false)} onCreated={(e) => navigate(`/admin/exams/${e.id}`)} />}
    </>
  );
}

function NewExam({ onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [durationMin, setDuration] = useState(60);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      onCreated(await adminApi.post('/api/admin/exams', {
        title, durationMin,
        instructions: 'Each question carries 1 mark.\nThere are no negative marks for a wrong answer.\nPlease mark only one answer for each question.',
      }));
    } catch (err) {
      setErrors(err.data?.fields || { title: err.message });
      setBusy(false);
    }
  }

  return (
    <Modal
      title="New exam"
      onClose={onClose}
      actions={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn" form="new-exam" disabled={busy}>Create</button></>}
    >
      <form id="new-exam" onSubmit={save}>
        <Field label="Title" required error={errors.title}>{(id) => <input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Written Test – IBS 2026" autoFocus />}</Field>
        <Field label="Duration (minutes)" required error={errors.durationMin}>{(id) => <input id={id} type="number" min="1" max="600" value={durationMin} onChange={(e) => setDuration(e.target.value)} />}</Field>
      </form>
    </Modal>
  );
}
