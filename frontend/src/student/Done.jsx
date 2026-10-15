import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Check, UserPlus } from 'lucide-react';
import { StudentShell } from './StudentDrive.jsx';
import { stopCamera, exitFullscreen } from './camera.js';

const REASON = {
  time_up: 'Time is up, so your test was submitted automatically.',
  violations: 'Your test was submitted automatically because you left the test window too many times.',
  coordinator: 'Your test was submitted by the coordinator.',
  server: 'Your test has been submitted.',
};

export default function Done({ state, onNextCandidate }) {
  useEffect(() => {
    stopCamera();
    exitFullscreen();
  }, []);

  return (
    <StudentShell drive={state.drive}>
      <div className="card narrow center" style={{ padding: 40, marginTop: 24 }}>
        <span className="done-icon" aria-hidden="true"><Check size={34} strokeWidth={2.5} /></span>
        <h1>Test submitted</h1>
        {REASON[state.submitReason] && <p style={{ marginTop: 12 }}>{REASON[state.submitReason]}</p>}
        <p style={{ marginTop: 12 }}>Thank you, {state.student.firstName}. Your answers have been recorded.</p>
        {state.drive.resultsPublished ? (
          <p><Link className="btn" to={`/d/${state.drive.code}/result`}>Check my result</Link></p>
        ) : (
          <p className="muted">Results will be published on this same test link. Come back later and click <b>Check my result</b> with your Student ID and phone number. You can close this window now.</p>
        )}
        <hr className="divider" />
        <p className="muted small">Sharing this computer (for example in a college lab)? The next candidate can start here.</p>
        <button className="btn btn-secondary" onClick={onNextCandidate}><UserPlus size={16} aria-hidden="true" />Next candidate: start a new registration</button>
      </div>
    </StudentShell>
  );
}
