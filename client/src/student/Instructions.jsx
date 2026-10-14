import { useState } from 'react';
import { studentApi } from '../api.js';
import { ArrowRight, Camera, CircleCheck } from 'lucide-react';
import { Alert, Checkbox, Eyebrow, fullName, ordinal } from '../ui.jsx';
import { StudentShell } from './StudentDrive.jsx';
import CameraPreview from './CameraPreview.jsx';
import { startCamera, cameraErrorMessage, cameraLive, getStream, enterFullscreen, fullscreenSupported } from './camera.js';

export default function Instructions({ state, token, onStarted, onSessionLost }) {
  const { drive, student } = state;
  const p = drive.proctoring;
  const [stream, setStream] = useState(() => (cameraLive() ? getStream() : null));
  const [camError, setCamError] = useState('');
  const [camBusy, setCamBusy] = useState(false);
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const needsSeb = p.requireSeb && !navigator.userAgent.includes('SEB/');
  const cameraOk = !p.cameraRequired || Boolean(stream);
  const examRules = drive.instructions.split('\n').map((l) => l.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);

  const proctorRules = [
    p.cameraRequired && 'Your camera stays on for the whole test and photos are taken at random times. Keep your face clearly visible.',
    p.requireFullscreen && fullscreenSupported() && 'The test runs in full-screen mode. If you leave full screen, the test is paused until you return.',
    p.maxViolations > 0
      ? `Do not switch tabs, open other apps or leave this window. Each time is recorded; on the ${ordinal(p.maxViolations)} time your test is submitted automatically.`
      : 'Do not switch tabs, open other apps or leave this window. Each time is recorded and reported.',
    'Copy, paste and right-click are disabled.',
    'Your answers are saved automatically. If the page closes or the internet drops, just reopen the same link on this device to continue.',
    'Once started, the test can only be taken on this device. If your device stops working, tell the coordinator, who can let you continue on another one.',
    'The test is submitted automatically when the timer reaches zero.',
  ].filter(Boolean);

  async function turnOnCamera() {
    setCamBusy(true);
    setCamError('');
    try {
      setStream(await startCamera());
    } catch (e) {
      setCamError(cameraErrorMessage(e));
    } finally {
      setCamBusy(false);
    }
  }

  async function start() {
    setBusy(true);
    setError('');
    if (p.requireFullscreen) await enterFullscreen();
    try {
      onStarted(await studentApi.start(token));
    } catch (e) {
      if (e.status === 401) return onSessionLost();
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <StudentShell drive={drive} right={<span className="who">{fullName(student)}<small>{student.studentId}</small></span>}>
      <div className="card" style={{ padding: 32 }}>
        <Eyebrow>Step 2 of 2 · Before you start</Eyebrow>
        <h1 className="rite-underline">{drive.examTitle}</h1>
        <p className="muted">Welcome, {student.firstName}. Read the instructions carefully before you start.</p>
        <div className="tiles">
          <div><span>Duration</span><b>{drive.durationMin} min</b></div>
          <div><span>Questions</span><b>{drive.questionCount}</b></div>
          <div><span>Total marks</span><b>{drive.totalMarks}</b></div>
          <div><span>Negative marking</span><b>{drive.negativeMarks > 0 ? `−${drive.negativeMarks} per wrong` : 'None'}</b></div>
        </div>

        {examRules.length > 0 && (
          <>
            <h2>Instructions</h2>
            <ol className="rules">{examRules.map((r, i) => <li key={i}>{r}</li>)}</ol>
          </>
        )}
        <h2>Exam rules</h2>
        <ol className="rules">{proctorRules.map((r, i) => <li key={i}>{r}</li>)}</ol>

        {p.cameraRequired && (
          <div className="camera-check">
            <div>
              <h2>Camera check</h2>
              {stream ? (
                <p className="ok-text"><CircleCheck size={18} aria-hidden="true" />Camera is working. Make sure your face is clearly visible and well lit.</p>
              ) : (
                <>
                  <p>Your camera must be on to take this test. When the browser asks, choose <b>Allow</b>.</p>
                  <button className="btn" type="button" onClick={turnOnCamera} disabled={camBusy}>
                    <Camera size={18} aria-hidden="true" />{camBusy ? 'Starting camera…' : 'Turn on camera'}
                  </button>
                </>
              )}
              <Alert>{camError}</Alert>
            </div>
            <CameraPreview stream={stream} className="large" />
          </div>
        )}

        {needsSeb && (
          <Alert>This test must be taken in Safe Exam Browser. Please ask the coordinator to open it for you.</Alert>
        )}

        <div className="agree">
          <Checkbox checked={agree} onChange={setAgree}>
            I have read the instructions and rules, and I will follow them.
          </Checkbox>
        </div>
        <Alert>{error}</Alert>
        <div className="actions">
          <button className="btn btn-lg" onClick={start} disabled={!agree || !cameraOk || needsSeb || busy}>
            {busy ? 'Starting…' : 'Start Test'}{!busy && <ArrowRight size={18} aria-hidden="true" />}
          </button>
        </div>
        {!cameraOk && <p className="muted right">Turn on your camera to enable Start Test.</p>}
      </div>
    </StudentShell>
  );
}
