import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Camera, CameraOff, CircleCheck, Clock, CloudOff, Eraser, Flag, LoaderCircle, Maximize, Send } from 'lucide-react';
import { studentApi } from '../api.js';
import { Alert, Modal, fmtClock, fullName, LETTERS } from '../ui.jsx';
import { StudentShell } from './StudentDrive.jsx';
import CameraPreview from './CameraPreview.jsx';
import { useProctoring } from './useProctoring.js';
import { useAnswerSaver } from './useAnswerSaver.js';

const SAVE_LABEL = { saved: 'All answers saved', saving: 'Saving…', offline: 'Offline – will save when connected' };
const SAVE_ICON = {
  saved: <CircleCheck size={14} aria-hidden="true" />,
  saving: <LoaderCircle size={14} aria-hidden="true" style={{ animation: 'rite-spin .9s linear infinite' }} />,
  offline: <CloudOff size={14} aria-hidden="true" />,
};

export default function Exam({ state, token, onSubmitted, onSessionLost }) {
  const { drive, questions, student } = state;
  const saver = useAnswerSaver(token, { onSubmitted, onSessionLost });
  const [answers, setAnswers] = useState(() => ({ ...state.answers, ...saver.unsaved() }));
  const [idx, setIdx] = useState(() => Math.max(0, questions.findIndex((q) => answers[q.id]?.selected == null)));
  const [violations, setViolations] = useState(state.violations);
  const [warning, setWarning] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const submitted = useRef(false);

  // Server-synchronised countdown. The server clock is re-read every 15 s, so extra time added by a
  // coordinator, or a coordinator's submit, reaches this page without a reload.
  const [clock, setClock] = useState(() => ({
    offset: new Date(state.serverNow).getTime() - Date.now(),
    endsAt: new Date(state.endsAt).getTime(),
  }));
  const [now, setNow] = useState(() => Date.now() + clock.offset);
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now() + clock.offset), 500);
    return () => clearInterval(iv);
  }, [clock.offset]);
  const remaining = clock.endsAt - now;

  const syncClock = useCallback(async () => {
    const c = await studentApi.clock(token);
    if (c.status === 'submitted') {
      submitted.current = true;
      onSubmitted(c.submitReason || 'server');
      return null;
    }
    const next = { offset: new Date(c.serverNow).getTime() - Date.now(), endsAt: new Date(c.endsAt).getTime() };
    setClock(next);
    return next;
  }, [token, onSubmitted]);

  useEffect(() => {
    const iv = setInterval(() => { if (!submitted.current) syncClock().catch(() => {}); }, 15_000);
    return () => clearInterval(iv);
  }, [syncClock]);

  const finish = useCallback(async (reason) => {
    if (submitted.current) return;
    submitted.current = true;
    setSubmitting(true);
    setSubmitError('');
    try {
      await saver.flush();
      await studentApi.submit(token);
      onSubmitted(reason);
    } catch (e) {
      if (e.status === 409 && e.data?.submitted) return onSubmitted(reason);
      if (e.status === 401) return onSessionLost();
      submitted.current = false;
      setSubmitting(false);
      setSubmitError('Could not submit because the connection dropped. Your answers are safe on this device. Retrying…');
      setTimeout(() => finish(reason), 4000);
    }
  }, [saver, token, onSubmitted, onSessionLost]);

  // Time up: ask the server first, in case a coordinator added time moments ago.
  const checkingTime = useRef(false);
  useEffect(() => {
    if (remaining > 0 || checkingTime.current || submitted.current) return;
    checkingTime.current = true;
    syncClock()
      .then((c) => {
        if (c && c.endsAt - (Date.now() + c.offset) > 1000) return; // more time was given
        if (c) finish('time_up');
      })
      .catch(() => finish('time_up'))
      .finally(() => { checkingTime.current = false; });
  }, [remaining, syncClock, finish]);

  const proctor = useProctoring({
    token,
    proctoring: drive.proctoring,
    active: !submitting,
    onViolation: (r) => {
      setViolations(r.violations);
      if (r.submitted) {
        submitted.current = true;
        onSubmitted('violations');
        return;
      }
      setWarning(
        r.maxViolations > 0
          ? `Warning ${r.violations} of ${r.maxViolations - 1}: you left the test window. This has been recorded. ` +
            (r.maxViolations - r.violations === 1 ? 'If it happens again, your test will be submitted automatically.' : '')
          : `You left the test window (${r.violations} times). This has been recorded and reported.`,
      );
    },
  });

  const q = questions[idx];
  const sections = useMemo(() => {
    const out = [];
    questions.forEach((x, i) => {
      if (!out.length || out[out.length - 1].name !== x.section) out.push({ name: x.section, items: [] });
      out[out.length - 1].items.push(i);
    });
    return out;
  }, [questions]);

  const update = (question, patch) => {
    const next = { selected: null, review: false, ...answers[question.id], ...patch };
    setAnswers((a) => ({ ...a, [question.id]: next }));
    saver.queue(question.id, next);
  };

  const go = (i) => {
    setIdx(Math.min(questions.length - 1, Math.max(0, i)));
    document.querySelector('.question-card')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  const counts = questions.reduce(
    (c, x) => {
      const a = answers[x.id];
      if (a?.selected != null) c.answered++;
      if (a?.review) c.review++;
      return c;
    },
    { answered: 0, review: 0 },
  );

  const blocked = proctor.cameraBlocked || proctor.fsNeeded;

  return (
    <StudentShell
      drive={drive}
      right={
        <>
          <span className="who hide-sm">{fullName(student)}<small>{student.studentId}</small></span>
          <span className={`timer${remaining < 5 * 60_000 ? ' low' : ''}${remaining < 60_000 ? ' critical' : ''}`} aria-live="off" title="Time left">
            <Clock size={18} aria-hidden="true" />{fmtClock(remaining)}
          </span>
        </>
      }
    >
      <div className={`exam-layout no-select${blocked ? ' is-blocked' : ''}`}>
        <section className="card question-card" aria-live="polite">
          <Alert kind="warn">{warning && <>{warning} <button className="link" onClick={() => setWarning('')}>Dismiss</button></>}</Alert>
          <div className="q-meta">
            <span className="section-tag">{q.section}</span>
            {q.sectionHint && <span className="muted">{q.sectionHint}</span>}
            <span className="q-marks">{q.marks} {q.marks === 1 ? 'mark' : 'marks'}</span>
          </div>
          {q.passage && (
            <div className="passage">
              <div className="passage-title">Passage{q.passage.title ? `: ${q.passage.title}` : ''}</div>
              {q.passage.body.split(/\n+/).map((para, i) => <p key={i}>{para}</p>)}
            </div>
          )}
          <h2 className="q-text">
            <span className="q-num">Q{q.n}.</span> {q.text}
          </h2>
          <div className="options" role="radiogroup" aria-label={`Question ${q.n} options`}>
            {q.options.map((o, i) => {
              const selected = answers[q.id]?.selected === o.key;
              return (
                <button
                  key={o.key}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`option${selected ? ' selected' : ''}`}
                  onClick={() => update(q, { selected: o.key })}
                >
                  <span className="option-key">{LETTERS[i]}</span>
                  <span>{o.text}</span>
                </button>
              );
            })}
          </div>
          <div className="q-nav">
            <button className="btn btn-secondary" onClick={() => go(idx - 1)} disabled={idx === 0}><ArrowLeft size={18} aria-hidden="true" />Previous</button>
            <div className="q-nav-mid">
              <button className="btn btn-secondary" onClick={() => update(q, { review: !answers[q.id]?.review })}>
                <Flag size={16} aria-hidden="true" />{answers[q.id]?.review ? 'Unmark review' : 'Mark for review'}
              </button>
              <button className="btn btn-secondary" onClick={() => update(q, { selected: null })} disabled={answers[q.id]?.selected == null}>
                <Eraser size={16} aria-hidden="true" />Clear answer
              </button>
            </div>
            {idx < questions.length - 1
              ? <button className="btn" onClick={() => go(idx + 1)}>Next<ArrowRight size={18} aria-hidden="true" /></button>
              : <button className="btn" onClick={() => setConfirming(true)}><Send size={16} aria-hidden="true" />Finish test</button>}
          </div>
        </section>

        <aside className="card side-card">
          {drive.proctoring.cameraRequired && (
            <div className="cam-box">
              <CameraPreview stream={proctor.stream} />
              <span className="cam-badge">Camera on</span>
            </div>
          )}
          <div className={`save-status ${saver.status}`}>{SAVE_ICON[saver.status]}{SAVE_LABEL[saver.status]}</div>
          {violations > 0 && <div className="violations">Left the test window: {violations}{drive.proctoring.maxViolations > 0 && ` / ${drive.proctoring.maxViolations}`}</div>}
          {sections.map((s) => (
            <div key={s.name} className="palette-section">
              <div className="palette-title">{s.name}</div>
              <div className="palette">
                {s.items.map((i) => {
                  const a = answers[questions[i].id];
                  const cls = [a?.selected != null && 'answered', a?.review && 'review', i === idx && 'current'].filter(Boolean).join(' ');
                  return (
                    <button key={i} className={cls} onClick={() => go(i)} aria-label={`Question ${i + 1}`}>{i + 1}</button>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="legend">
            <span className="l-answered">Answered ({counts.answered})</span>
            <span className="l-review">Marked for review ({counts.review})</span>
            <span className="l-none">Not answered ({questions.length - counts.answered})</span>
          </div>
          <button className="btn btn-block" onClick={() => setConfirming(true)} disabled={submitting}><Send size={16} aria-hidden="true" />Submit Test</button>
        </aside>
      </div>

      {confirming && !submitting && (
        <Modal
          title="Submit your test?"
          onClose={() => setConfirming(false)}
          actions={
            <>
              <button className="btn btn-secondary" onClick={() => setConfirming(false)}>Keep working</button>
              <button className="btn" onClick={() => { setConfirming(false); finish('student'); }}>Submit</button>
            </>
          }
        >
          <p>You have answered <b>{counts.answered}</b> of <b>{questions.length}</b> questions{counts.review ? `, and ${counts.review} are marked for review` : ''}.</p>
          <p>You cannot change your answers after submitting.</p>
        </Modal>
      )}

      {submitting && (
        <div className="overlay">
          <div className="overlay-box">
            <span className="spinner" style={{ display: 'inline-block', width: 40, height: 40, borderWidth: 3, marginBottom: 16 }} aria-hidden="true" />
            <h2>Submitting your test…</h2>
            <p>Please do not close this window.</p>
            <Alert>{submitError}</Alert>
          </div>
        </div>
      )}

      {!submitting && proctor.cameraBlocked && (
        <div className="overlay">
          <div className="overlay-box">
            <span className="overlay-icon"><CameraOff size={26} aria-hidden="true" /></span>
            <h2>Camera is off</h2>
            <p>Your camera must stay on during the test. The timer is still running.</p>
            <Alert>{proctor.camError}</Alert>
            <button className="btn btn-lg" onClick={proctor.restartCamera}><Camera size={18} aria-hidden="true" />Turn camera back on</button>
          </div>
        </div>
      )}

      {!submitting && !proctor.cameraBlocked && proctor.fsNeeded && (
        <div className="overlay">
          <div className="overlay-box">
            <span className="overlay-icon"><Maximize size={26} aria-hidden="true" /></span>
            <h2>Return to full screen</h2>
            <p>The test must be taken in full-screen mode. Leaving full screen has been recorded. The timer is still running.</p>
            <button className="btn btn-lg" onClick={proctor.returnToFullscreen}><Maximize size={18} aria-hidden="true" />Return to full screen</button>
          </div>
        </div>
      )}
    </StudentShell>
  );
}
