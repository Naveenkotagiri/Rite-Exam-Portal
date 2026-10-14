import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, Check, Download, FileDown, Plus, Upload } from 'lucide-react';
import { adminApi } from '../api.js';
import { Alert, Badge, Field, Modal, PageHeader, Spinner, LETTERS } from '../ui.jsx';
import { useLoad } from './useLoad.js';

export default function ExamEditor() {
  const { id } = useParams();
  const { data: exam, error, loading, reload } = useLoad(() => adminApi.get(`/api/admin/exams/${id}`), [id]);
  const [editing, setEditing] = useState(null); // { kind: 'question'|'section'|'passage', item? }
  const [actionError, setActionError] = useState('');

  if (loading) return <main className="admin-main"><Spinner /></main>;
  if (error) return <main className="admin-main"><Alert>{error}</Alert></main>;

  const run = async (fn) => {
    setActionError('');
    try {
      await fn();
      await reload();
    } catch (e) {
      setActionError(e.message);
    }
  };
  const confirmRun = (msg, fn) => window.confirm(msg) && run(fn);

  const bySection = exam.sections.map((s) => ({ ...s, questions: exam.questions.filter((q) => q.section_id === s.id) }));
  const passageTitle = new Map(exam.passages.map((p) => [p.id, p.title]));
  const totalMarks = exam.questions.reduce((t, q) => t + q.marks, 0);
  let n = 0;

  return (
    <>
      <PageHeader
        eyebrow={<><Link to="/admin/exams">Exams</Link> · Question paper</>}
        title={<>{exam.title} {exam.locked && <Badge tone="warning" dot>Taken by students</Badge>}</>}
        sub={`${exam.questions.length} questions · ${totalMarks} marks · ${exam.duration_min} minutes`}
      />
      <main className="admin-main">
      {exam.locked && <Alert kind="warn">Students have already taken this exam. You can fix question wording and correct answers (then use Re-grade on the drive&apos;s Results tab), but not add or remove questions. To make a changed paper, duplicate this exam from the Exams list.</Alert>}
      <Alert>{actionError}</Alert>

      <div className="grid-2 align-start">
        <ExamSettings exam={exam} onSaved={reload} />
        <ImportPanel exam={exam} onImported={reload} />
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Sections</h2>
          <button className="btn btn-sm" onClick={() => setEditing({ kind: 'section' })} disabled={exam.locked}><Plus size={15} aria-hidden="true" />Add section</button>
        </div>
        {exam.sections.length === 0 ? <p className="muted">No sections yet. Add one, or upload questions from Excel.</p> : (
          <table className="table compact">
            <tbody>
              {bySection.map((s, i) => (
                <tr key={s.id}>
                  <td><b>{s.name}</b> {s.hint && <span className="muted">— {s.hint}</span>}</td>
                  <td className="num">{s.questions.length} questions</td>
                  <td className="row-actions">
                    <button className="btn btn-sm btn-secondary" disabled={i === 0} onClick={() => run(() => adminApi.post(`/api/admin/sections/${s.id}/move`, { direction: 'up' }))} aria-label="Move up"><ArrowUp size={15} /></button>
                    <button className="btn btn-sm btn-secondary" disabled={i === bySection.length - 1} onClick={() => run(() => adminApi.post(`/api/admin/sections/${s.id}/move`, { direction: 'down' }))} aria-label="Move down"><ArrowDown size={15} /></button>
                    <button className="btn btn-sm btn-secondary" onClick={() => setEditing({ kind: 'section', item: s })}>Edit</button>
                    <button className="btn btn-sm btn-secondary danger-text" disabled={exam.locked} onClick={() => confirmRun(`Delete section "${s.name}" and its ${s.questions.length} questions?`, () => adminApi.del(`/api/admin/sections/${s.id}`))}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Reading passages</h2>
          <button className="btn btn-sm" onClick={() => setEditing({ kind: 'passage' })}><Plus size={15} aria-hidden="true" />Add passage</button>
        </div>
        {exam.passages.length === 0 ? <p className="muted">No passages. Only needed for reading comprehension questions.</p> : (
          <table className="table compact">
            <tbody>
              {exam.passages.map((p) => (
                <tr key={p.id}>
                  <td><b>{p.title}</b> <span className="muted">{p.body.slice(0, 120)}{p.body.length > 120 ? '…' : ''}</span></td>
                  <td className="row-actions">
                    <button className="btn btn-sm btn-secondary" onClick={() => setEditing({ kind: 'passage', item: p })}>Edit</button>
                    <button className="btn btn-sm btn-secondary danger-text" onClick={() => confirmRun(`Delete passage "${p.title}"? Its questions stay, without the passage.`, () => adminApi.del(`/api/admin/passages/${p.id}`))}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Questions</h2>
          <button className="btn btn-sm" onClick={() => setEditing({ kind: 'question' })} disabled={exam.locked || exam.sections.length === 0}><Plus size={15} aria-hidden="true" />Add question</button>
        </div>
        {exam.questions.length === 0 && <p className="muted">No questions yet.</p>}
        {bySection.filter((s) => s.questions.length).map((s) => (
          <div key={s.id} className="q-group">
            <h3>{s.name}</h3>
            {s.questions.map((q) => {
              n++;
              return (
                <div key={q.id} className="q-item">
                  <div className="q-item-head">
                    <div>
                      <b className="mono">Q{n}.</b> {q.text}
                      {q.passage_id && <> <Badge tone="info">Passage: {passageTitle.get(q.passage_id)}</Badge></>}
                      <span className="muted small"> · {q.marks} mark{q.marks === 1 ? '' : 's'}</span>
                    </div>
                    <div className="row-actions">
                      <button className="btn btn-sm btn-secondary" onClick={() => setEditing({ kind: 'question', item: q })}>Edit</button>
                      <button className="btn btn-sm btn-secondary danger-text" disabled={exam.locked} onClick={() => confirmRun(`Delete Q${n}?`, () => adminApi.del(`/api/admin/questions/${q.id}`))}>Delete</button>
                    </div>
                  </div>
                  <ol className="q-options">
                    {q.options.map((o, i) => <li key={i} className={i === q.correct_index ? 'correct' : ''}><b>{LETTERS[i]}.</b> {o} {i === q.correct_index && <Check size={14} aria-label="correct answer" style={{ verticalAlign: '-2px' }} />}</li>)}
                  </ol>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      </main>

      {editing?.kind === 'section' && <SectionForm exam={exam} item={editing.item} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {editing?.kind === 'passage' && <PassageForm exam={exam} item={editing.item} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {editing?.kind === 'question' && <QuestionForm exam={exam} item={editing.item} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </>
  );
}

function useSave(fn, onSaved) {
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e?.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const r = await fn();
      setErrors({});
      onSaved(r);
    } catch (err) {
      setErrors(err.data?.fields || {});
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  };
  return { errors, message, busy, save };
}

function ExamSettings({ exam, onSaved }) {
  const [v, setV] = useState({ title: exam.title, durationMin: exam.duration_min, negativeMarks: exam.negative_marks, instructions: exam.instructions });
  const [saved, setSaved] = useState(false);
  const s = useSave(() => adminApi.put(`/api/admin/exams/${exam.id}`, v), () => { setSaved(true); onSaved(); setTimeout(() => setSaved(false), 2000); });
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form className="card" onSubmit={s.save}>
      <h2>Exam settings</h2>
      <Field label="Title" required error={s.errors.title}>{(id) => <input id={id} value={v.title} onChange={set('title')} />}</Field>
      <div className="grid-2">
        <Field label="Duration (minutes)" required error={s.errors.durationMin}>{(id) => <input id={id} type="number" min="1" max="600" value={v.durationMin} onChange={set('durationMin')} />}</Field>
        <Field label="Negative marks per wrong answer" error={s.errors.negativeMarks} hint="0 = no negative marking">{(id) => <input id={id} type="number" min="0" max="10" step="0.25" value={v.negativeMarks} onChange={set('negativeMarks')} />}</Field>
      </div>
      <Field label="Instructions shown to students" error={s.errors.instructions} hint="One instruction per line.">
        {(id) => <textarea id={id} rows="5" value={v.instructions} onChange={set('instructions')} />}
      </Field>
      <Alert>{s.message}</Alert>
      <div className="actions"><button className="btn" disabled={s.busy}>{saved ? 'Saved ✔' : 'Save settings'}</button></div>
    </form>
  );
}

function ImportPanel({ exam, onImported }) {
  const fileRef = useRef(null);
  const [mode, setMode] = useState('append');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const download = (url, name) => adminApi.download(url, name).catch((e) => setError({ message: e.message }));

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return setError({ message: 'Choose an Excel (.xlsx) file first.' });
    if (mode === 'replace' && exam.questions.length && !window.confirm(`Replace all ${exam.questions.length} existing questions with the questions in this file?`)) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await adminApi.upload(`/api/admin/exams/${exam.id}/import?mode=${mode}`, file));
      fileRef.current.value = '';
      onImported();
    } catch (e) {
      setError({ message: e.message, rows: e.data?.rowErrors });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Upload questions from Excel</h2>
      <ol className="plain-list numbered">
        <li>Download the template and fill one row per question (see the &quot;How to fill&quot; sheet).</li>
        <li>Upload it here. If anything is wrong, nothing is imported and the row numbers are listed.</li>
      </ol>
      <div className="btn-row">
        <button className="btn btn-secondary btn-sm" onClick={() => download('/api/admin/question-template.xlsx', 'question-template.xlsx')}><Download size={15} aria-hidden="true" />Download template</button>
        {exam.questions.length > 0 && (
          <button className="btn btn-secondary btn-sm" onClick={() => download(`/api/admin/exams/${exam.id}/questions.xlsx`, `${exam.title}-questions.xlsx`.replace(/[^\w.-]+/g, '_'))}><FileDown size={15} aria-hidden="true" />Export current questions</button>
        )}
      </div>
      {exam.locked && (
        <Alert kind="warn">
          Uploading is turned off because students have already taken this exam. To upload a new paper,
          go to <Link to="/admin/exams">Exams</Link> and click <b>New exam</b> (or <b>Duplicate</b> this one).
        </Alert>
      )}
      <div className="upload-row">
        <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={exam.locked} />
        <select value={mode} onChange={(e) => setMode(e.target.value)} disabled={exam.locked} aria-label="Import mode">
          <option value="append">Add to existing questions</option>
          <option value="replace">Replace all questions</option>
        </select>
        <button className="btn" onClick={upload} disabled={busy || exam.locked}><Upload size={16} aria-hidden="true" />{busy ? 'Uploading…' : 'Upload'}</button>
      </div>
      {result && <Alert kind="success">Imported {result.questions} questions{result.sections ? `, ${result.sections} new sections` : ''}{result.passages ? `, ${result.passages} passages` : ''}.</Alert>}
      {error && (
        <Alert>
          {error.message}
          {error.rows?.length > 0 && (
            <ul className="row-errors">{error.rows.map((r, i) => <li key={i}>{r.row ? `Row ${r.row}: ` : ''}{r.message}</li>)}</ul>
          )}
        </Alert>
      )}
    </div>
  );
}

function SectionForm({ exam, item, onClose, onSaved }) {
  const [name, setName] = useState(item?.name || '');
  const [hint, setHint] = useState(item?.hint || '');
  const s = useSave(() => (item ? adminApi.put(`/api/admin/sections/${item.id}`, { name, hint }) : adminApi.post(`/api/admin/exams/${exam.id}/sections`, { name, hint })), onSaved);
  return (
    <Modal title={item ? 'Edit section' : 'Add section'} onClose={onClose}
      actions={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn" form="section-form" disabled={s.busy}>Save</button></>}>
      <form id="section-form" onSubmit={s.save}>
        <Field label="Section name" required error={s.errors.name}>{(id) => <input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Synonyms" autoFocus />}</Field>
        <Field label="Hint for students" error={s.errors.hint}>{(id) => <input id={id} value={hint} onChange={(e) => setHint(e.target.value)} placeholder="e.g. Choose the word closest in meaning" />}</Field>
        <Alert>{s.message}</Alert>
      </form>
    </Modal>
  );
}

function PassageForm({ exam, item, onClose, onSaved }) {
  const [title, setTitle] = useState(item?.title || '');
  const [body, setBody] = useState(item?.body || '');
  const s = useSave(() => (item ? adminApi.put(`/api/admin/passages/${item.id}`, { title, body }) : adminApi.post(`/api/admin/exams/${exam.id}/passages`, { title, body })), onSaved);
  return (
    <Modal wide title={item ? 'Edit passage' : 'Add passage'} onClose={onClose}
      actions={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn" form="passage-form" disabled={s.busy}>Save</button></>}>
      <form id="passage-form" onSubmit={s.save}>
        <Field label="Title" required error={s.errors.title} hint="Short name to pick it from a list, e.g. Hybrid Work">{(id) => <input id={id} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />}</Field>
        <Field label="Passage text" required error={s.errors.body}>{(id) => <textarea id={id} rows="10" value={body} onChange={(e) => setBody(e.target.value)} />}</Field>
        <Alert>{s.message}</Alert>
      </form>
    </Modal>
  );
}

function QuestionForm({ exam, item, onClose, onSaved }) {
  const [v, setV] = useState(() => ({
    sectionId: item?.section_id || exam.sections[exam.sections.length - 1]?.id || '',
    passageId: item?.passage_id || '',
    text: item?.text || '',
    options: [...(item?.options || ['', '', '', '']), '', '', '', '', ''].slice(0, 5),
    correctIndex: item?.correct_index ?? null,
    marks: item?.marks ?? 1,
  }));
  const s = useSave(() => {
    const body = { ...v, passageId: v.passageId || null };
    return item ? adminApi.put(`/api/admin/questions/${item.id}`, body) : adminApi.post(`/api/admin/exams/${exam.id}/questions`, body);
  }, onSaved);
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
  const setOption = (i) => (e) => setV((x) => ({ ...x, options: x.options.map((o, j) => (j === i ? e.target.value : o)) }));

  return (
    <Modal wide title={item ? 'Edit question' : 'Add question'} onClose={onClose}
      actions={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn" form="question-form" disabled={s.busy}>Save question</button></>}>
      <form id="question-form" onSubmit={s.save}>
        <div className="grid-3">
          <Field label="Section" required error={s.errors.sectionId}>
            {(id) => <select id={id} value={v.sectionId} onChange={set('sectionId')}>{exam.sections.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}
          </Field>
          <Field label="Passage" error={s.errors.passageId}>
            {(id) => (
              <select id={id} value={v.passageId} onChange={set('passageId')}>
                <option value="">None</option>
                {exam.passages.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            )}
          </Field>
          <Field label="Marks" error={s.errors.marks}>{(id) => <input id={id} type="number" min="0.25" step="0.25" value={v.marks} onChange={set('marks')} />}</Field>
        </div>
        <Field label="Question" required error={s.errors.text}>{(id) => <textarea id={id} rows="3" value={v.text} onChange={set('text')} autoFocus />}</Field>
        <fieldset className="options-edit">
          <legend>Options <span className="muted small">(select the correct one; leave unused options empty)</span></legend>
          {v.options.map((o, i) => (
            <label key={i} className={`option-edit${v.correctIndex === i ? ' correct' : ''}`}>
              <input type="radio" name="correct" checked={v.correctIndex === i} onChange={() => setV((x) => ({ ...x, correctIndex: i }))} aria-label={`Option ${LETTERS[i]} is correct`} />
              <b>{LETTERS[i]}</b>
              <input value={o} onChange={setOption(i)} placeholder={i < 2 ? 'Required' : 'Optional'} />
            </label>
          ))}
          <div className="field-error">{s.errors.options || s.errors.correctIndex}</div>
        </fieldset>
        <Alert>{s.message}</Alert>
      </form>
    </Modal>
  );
}
