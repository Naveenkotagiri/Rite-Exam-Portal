import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { Check, Copy, Download, Lock, LockOpen, MonitorSmartphone, Pencil, Search, Send, TimerReset, Trash2 } from 'lucide-react';
import { adminApi } from '../api.js';
import { ATTEMPT_STATUS, Alert, Badge, DRIVE_STATUS, Modal, PageHeader, ShowMore, Spinner, StatusBadge, usePaging, fmtClock, fmtDate, fmtDateTime, fmtTime, fullName, ordinal } from '../ui.jsx';
import { useLoad } from './useLoad.js';
import DriveForm from './DriveForm.jsx';
import ResultsTab from './ResultsTab.jsx';

const TABS = [['monitor', 'Live monitor'], ['results', 'Results'], ['link', 'Link & QR code']];

export default function DriveDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'monitor';
  const { data: drive, error, loading, reload, setData } = useLoad(() => adminApi.get(`/api/admin/drives/${id}`), [id]);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState('');

  if (loading) return <main className="admin-main"><Spinner /></main>;
  if (error) return <main className="admin-main"><Alert>{error}</Alert></main>;

  const toggleOpen = async () => {
    try {
      setData(await adminApi.post(`/api/admin/drives/${id}/open`, { isOpen: !drive.is_open }));
    } catch (e) {
      setActionError(e.message);
    }
  };

  const remove = async () => {
    try {
      await adminApi.del(`/api/admin/drives/${id}`);
      navigate('/admin');
    } catch (e) {
      setActionError(e.message);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={<><Link to="/admin">Drives</Link> · {drive.college}</>}
        title={<>{drive.name} <StatusBadge map={DRIVE_STATUS} status={drive.status} /></>}
        sub={[drive.drive_date && fmtDate(drive.drive_date), drive.exam_title, `${drive.question_count} questions`, `${drive.duration_min} min`].filter(Boolean).join(' · ')}
      >
        <button className={`btn ${drive.is_open ? 'btn-secondary' : ''}`} onClick={toggleOpen}>
          {drive.is_open ? <Lock size={16} aria-hidden="true" /> : <LockOpen size={16} aria-hidden="true" />}
          {drive.is_open ? 'Close test' : 'Open test'}
        </button>
        <button className="btn btn-secondary" onClick={() => setEditing(true)}><Pencil size={16} aria-hidden="true" />Edit</button>
        <button className="btn btn-secondary danger-text" onClick={() => setConfirmDelete(true)}><Trash2 size={16} aria-hidden="true" />Delete</button>
      </PageHeader>
      <main className="admin-main">
        <Alert>{actionError}</Alert>
        <div className="tabs" role="tablist">
          {TABS.map(([key, label]) => (
            <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => setParams({ tab: key }, { replace: true })}>{label}</button>
          ))}
        </div>
        {tab === 'link' && <LinkTab drive={drive} />}
        {tab === 'monitor' && <MonitorTab drive={drive} />}
        {tab === 'results' && <ResultsTab drive={drive} onDriveChanged={reload} />}
      </main>

      {editing && <DriveForm drive={drive} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
      {confirmDelete && (
        <Modal
          title="Delete this drive?"
          onClose={() => setConfirmDelete(false)}
          actions={<><button className="btn btn-secondary" onClick={() => setConfirmDelete(false)}>Cancel</button><button className="btn btn-danger" onClick={remove}>Delete drive</button></>}
        >
          <p>This permanently deletes the drive and <b>all its candidates, answers, photos and results</b>. Export the results first if you need them.</p>
        </Modal>
      )}
    </>
  );
}

function LinkTab({ drive }) {
  const url = `${window.location.origin}/d/${drive.code}`;
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    QRCode.toDataURL(url, { width: 640, margin: 2, color: { dark: '#06211A' } }).then(setQr);
  }, [url]);

  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="grid-2 align-start">
      <div className="card">
        <h2>Student test link</h2>
        <p className="muted">Share this link in the college WhatsApp group, or show the QR code on the projector.</p>
        <div className="link-box">
          <code>{url}</code>
          <button className="btn btn-sm" onClick={copy}>
            {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}{copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <h3>Results link</h3>
        <p className="muted small">
          {drive.results_published_at
            ? 'Results are published. Students can also reach this page from the test link.'
            : 'Works once you publish results on the Results tab. Until then it says results are not out yet.'}
        </p>
        <div className="link-box"><code>{`${url}/result`}</code></div>
        <h3>Proctoring for this drive</h3>
        <ul className="plain-list">
          <li>Camera: {drive.camera_required ? `required, a photo about every ${drive.snapshot_interval_sec} seconds` : 'not required'}</li>
          <li>Full screen: {drive.require_fullscreen ? 'required' : 'not required'}</li>
          <li>Leaving the test window: {drive.max_violations > 0 ? `auto-submit on the ${ordinal(drive.max_violations)} time` : 'recorded only'}</li>
          <li>Question order: {drive.shuffle_questions ? 'shuffled per student' : 'same for everyone'}; options: {drive.shuffle_options ? 'shuffled' : 'fixed'}</li>
          <li>Safe Exam Browser: {drive.require_seb ? 'required' : 'not required'}</li>
          <li>Opens: {drive.opens_at ? fmtDateTime(drive.opens_at) : 'now'} · Closes: {drive.closes_at ? fmtDateTime(drive.closes_at) : 'when you close it'}</li>
        </ul>
        {drive.require_seb && (
          <>
            <h3>Safe Exam Browser setup (lab PCs)</h3>
            <ol className="plain-list numbered">
              <li>Install Safe Exam Browser from safeexambrowser.org on each lab PC.</li>
              <li>Open the SEB Config Tool and set the <b>Start URL</b> to the link above.</li>
              <li>Save the configuration as a .seb file and double-click it on each PC to start the test.</li>
            </ol>
          </>
        )}
      </div>
      <div className="card center">
        <h2>QR code</h2>
        {qr ? <img src={qr} alt={`QR code for ${url}`} className="qr" /> : <Spinner />}
        {qr && <p><a className="btn btn-secondary" href={qr} download={`${drive.code}-qr.png`}><Download size={16} aria-hidden="true" />Download QR code</a></p>}
      </div>
    </div>
  );
}

const REASON_TEXT = { student: 'Student', time_up: 'Time up', violations: 'Auto (left window)', coordinator: 'Coordinator' };

function useAttempts(driveId, intervalMs) {
  const { data, error, reload } = useLoad(() => adminApi.get(`/api/admin/drives/${driveId}/attempts`), [driveId]);
  useEffect(() => {
    if (!intervalMs) return undefined;
    const iv = setInterval(reload, intervalMs);
    return () => clearInterval(iv);
  }, [reload, intervalMs]);
  return { data, error, reload };
}

function MonitorTab({ drive }) {
  const { data, error, reload } = useAttempts(drive.id, 10_000);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState('');
  const [confirm, setConfirm] = useState(null);

  const offset = data ? new Date(data.serverNow).getTime() - Date.now() : 0;
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (data?.attempts || []).filter((a) => {
      if (filter === 'flagged' ? a.violations === 0 : filter !== 'all' && a.status !== filter) return false;
      return !s || `${fullName(a)} ${a.student_code} ${a.email} ${a.phone}`.toLowerCase().includes(s);
    });
  }, [data, filter, search]);
  const paging = usePaging(`${filter}|${search}`);

  if (!data) return error ? <Alert>{error}</Alert> : <Spinner />;
  const all = data.attempts;
  const stats = {
    all: all.length,
    registered: all.filter((a) => a.status === 'registered').length,
    in_progress: all.filter((a) => a.status === 'in_progress').length,
    submitted: all.filter((a) => a.status === 'submitted').length,
    flagged: all.filter((a) => a.violations > 0).length,
  };
  const pending = all.filter((a) => a.relogin_pending);

  const act = async (a, action) => {
    setBusy(a.id);
    setActionError('');
    try {
      if (action === 'extend') await adminApi.post(`/api/admin/attempts/${a.id}/extend`, { minutes: 5 });
      if (action === 'submit') await adminApi.post(`/api/admin/attempts/${a.id}/submit`);
      if (action === 'relogin') await adminApi.post(`/api/admin/attempts/${a.id}/allow-relogin`);
      await reload();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };

  return (
    <>
      <div className="stat-row">
        {[['all', 'Registered'], ['registered', 'Not started'], ['in_progress', 'Writing now'], ['submitted', 'Submitted'], ['flagged', 'Flagged']].map(([k, label]) => (
          <button key={k} className={`stat${filter === k ? ' active' : ''}${k === 'flagged' && stats.flagged ? ' warn' : ''}`} onClick={() => setFilter(k)}>
            <b>{stats[k]}</b><span>{label}</span>
          </button>
        ))}
      </div>
      <div className="toolbar">
        <div className="search-box">
          <Search size={16} aria-hidden="true" />
          <input placeholder="Search name, Student ID, email or phone" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search candidates" />
        </div>
        <span className="muted small">Refreshes every 10 seconds · last <span className="mono">{fmtTime(new Date())}</span></span>
      </div>
      <Alert>{actionError || error}</Alert>
      {pending.length > 0 && (
        <div className="alert alert-warn relogin-requests" role="alert">
          <div>
          <b>Waiting for your approval to continue on another device:</b>
          <ul>
            {pending.map((a) => (
              <li key={a.id}>
                {fullName(a)} ({a.student_code}), asked at {fmtTime(a.relogin_requested_at)}
                <button className="btn btn-sm" disabled={busy === a.id} onClick={() => setConfirm({ ...a, action: 'relogin' })}>Allow re-login</button>
              </li>
            ))}
          </ul>
          </div>
        </div>
      )}
      <div className="card table-card">
        <table className="table table-fit">
          <thead>
            <tr><th>Candidate</th><th>Status</th><th className="num">Answered</th><th className="num">Time left</th><th className="num" title="Times the candidate left the test window">Left</th><th className="num">Photos</th><th>Last active</th><th className="right">Actions</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan="8" className="empty">No candidates{filter !== 'all' || search ? ' match this filter' : ' yet'}.</td></tr>}
            {rows.slice(0, paging.limit).map((a) => {
              const left = a.status === 'in_progress' ? new Date(a.ends_at).getTime() - (Date.now() + offset) : null;
              const idle = a.status === 'in_progress' && a.last_seen_at && Date.now() + offset - new Date(a.last_seen_at).getTime() > 60_000;
              return (
                <tr key={a.id} className={a.violations > 0 || a.relogin_pending ? 'flag-row' : ''}>
                  <td className="cell-person">
                    <Link to={`/admin/attempts/${a.id}`}>{fullName(a)}</Link>
                    <span className="mono">{a.student_code}</span>
                  </td>
                  <td>
                    <StatusBadge map={ATTEMPT_STATUS} status={a.status} />
                    {a.status === 'submitted' && <div className="small muted">{REASON_TEXT[a.submit_reason]}</div>}
                    {a.relogin_pending && <div className="small danger-text">Wants another device</div>}
                  </td>
                  <td className="num">{a.status === 'registered' ? '—' : `${a.answered}/${a.total}`}</td>
                  <td className="num">{left !== null ? fmtClock(left) : '—'}</td>
                  <td className="num">{a.violations > 0 ? <b className="danger-text">{a.violations}</b> : 0}</td>
                  <td className="num">{a.snapshot_count}</td>
                  <td className="nowrap">
                    <span className="mono small">{fmtTime(a.last_seen_at)}</span>
                    {idle && <div><Badge tone="danger">Inactive</Badge></div>}
                  </td>
                  <td className="row-actions">
                    {a.status === 'in_progress' && (
                      <>
                        <button className="btn btn-sm btn-secondary" disabled={busy === a.id} onClick={() => act(a, 'extend')} aria-label="+5 min" title="Add 5 minutes">
                          <TimerReset size={15} aria-hidden="true" />+5
                        </button>
                        <button className="btn btn-sm btn-secondary btn-icon" disabled={busy === a.id} onClick={() => setConfirm({ ...a, action: 'submit' })} aria-label="Submit" title="Submit this test now">
                          <Send size={15} aria-hidden="true" />
                        </button>
                        {a.relogin_approved
                          ? <span title="Re-login allowed: valid once, for 10 minutes"><Badge tone="success" dot>Allowed</Badge></span>
                          : <button className={`btn btn-sm btn-icon ${a.relogin_pending ? '' : 'btn-secondary'}`} disabled={busy === a.id} onClick={() => setConfirm({ ...a, action: 'relogin' })} aria-label="Allow re-login" title="Allow re-login on another device">
                            <MonitorSmartphone size={15} aria-hidden="true" />
                          </button>}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ShowMore shown={Math.min(paging.limit, rows.length)} total={rows.length} paging={paging} />
      {confirm?.action === 'relogin' && (
        <Modal
          title="Allow re-login on another device?"
          onClose={() => setConfirm(null)}
          actions={<><button className="btn btn-secondary" onClick={() => setConfirm(null)}>Cancel</button><button className="btn" onClick={() => act(confirm, 'relogin')}>Allow re-login</button></>}
        >
          <p>First check that the person asking is really <b>{fullName(confirm)}</b> ({confirm.student_code}), for example against their college ID card.</p>
          <p>They then have 10 minutes to enter their details on the new device. Their test continues with the same answers and timer, and the old device is logged out.</p>
        </Modal>
      )}
      {confirm?.action === 'submit' && (
        <Modal
          title="Submit this test now?"
          onClose={() => setConfirm(null)}
          actions={<><button className="btn btn-secondary" onClick={() => setConfirm(null)}>Cancel</button><button className="btn btn-danger" onClick={() => act(confirm, 'submit')}>Submit test</button></>}
        >
          <p>{fullName(confirm)}'s test will be submitted and graded with the answers saved so far. They cannot continue afterwards.</p>
        </Modal>
      )}
    </>
  );
}

