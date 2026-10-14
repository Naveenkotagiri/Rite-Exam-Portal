import { useEffect, useId, useState } from 'react';
import { CircleCheck, Info, OctagonAlert, TriangleAlert } from 'lucide-react';

/** Rite logo. `variant`: 'lockup' (on light backgrounds) or 'white' (on dark backgrounds). */
export function Logo({ variant = 'lockup', height = 32 }) {
  const src = variant === 'white' ? '/brand/rite-lockup-white.png' : '/brand/rite-lockup.png';
  return <img className="logo" src={src} alt="Rite" style={{ height, width: 'auto', display: 'block', flex: 'none' }} />;
}

export function Eyebrow({ children, onDark }) {
  return <div className={`eyebrow${onDark ? ' on-dark' : ''}`}>{children}</div>;
}

export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="spinner-wrap" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

const ALERT_ICON = { error: OctagonAlert, warn: TriangleAlert, info: Info, success: CircleCheck };

export function Alert({ kind = 'error', children }) {
  if (!children) return null;
  const Icon = ALERT_ICON[kind] || Info;
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon size={18} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

/** Status pill. tone: neutral | success | warning | danger | info | brand */
export function Badge({ tone = 'neutral', dot = false, children }) {
  return <span className={`badge badge-${tone}${dot ? ' dot' : ''}`}>{children}</span>;
}

export const DRIVE_STATUS = {
  open: ['success', 'Open'],
  not_started: ['warning', 'Not open yet'],
  closed: ['neutral', 'Closed'],
};
export const ATTEMPT_STATUS = {
  registered: ['neutral', 'Not started'],
  in_progress: ['info', 'Writing'],
  submitted: ['success', 'Submitted'],
};
export function StatusBadge({ map, status }) {
  const [tone, label] = map[status] || ['neutral', status];
  return <Badge tone={tone} dot>{label}</Badge>;
}

/** The sticky header at the top of each admin page: eyebrow, title, one line, actions. */
export function PageHeader({ eyebrow, title, sub, children }) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h1>{title}</h1>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {children && <div className="btn-row">{children}</div>}
    </header>
  );
}

/** Big tables draw 100 rows at a time; drawing thousands of rows (every 10 s on the monitor) freezes the page. */
const PAGE_SIZE = 100;

export function usePaging(resetKey) {
  const [limit, setLimit] = useState(PAGE_SIZE);
  useEffect(() => setLimit(PAGE_SIZE), [resetKey]);
  return { limit, more: () => setLimit((l) => l + PAGE_SIZE), all: () => setLimit(Infinity) };
}

export function ShowMore({ shown, total, paging }) {
  if (shown >= total) return null;
  return (
    <div className="show-more">
      <span className="muted small">Showing {shown} of {total}</span>
      <button className="btn btn-sm btn-secondary" onClick={paging.more}>Show {Math.min(PAGE_SIZE, total - shown)} more</button>
      <button className="btn btn-sm btn-ghost" onClick={paging.all}>Show all</button>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children }) {
  return (
    <div className="empty-state">
      {Icon && <span className="plate"><Icon size={24} aria-hidden="true" /></span>}
      {title && <h3>{title}</h3>}
      {children && <p>{children}</p>}
    </div>
  );
}

export function Field({ label, required, error, hint, children }) {
  const id = useId();
  const child = typeof children === 'function' ? children(id) : children;
  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>
        {label}{required && <span className="req" aria-hidden="true">*</span>}
      </label>
      {child}
      {hint && !error && <div className="field-hint">{hint}</div>}
      <div className="field-error">{error}</div>
    </div>
  );
}

export function Modal({ title, onClose, children, actions, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal${wide ? ' modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <div className="modal-body">{children}</div>
        {actions && <div className="actions">{actions}</div>}
      </div>
    </div>
  );
}

export function Checkbox({ checked, onChange, children }) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

const IST = { timeZone: 'Asia/Kolkata' };

export const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString('en-IN', { ...IST, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

export const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString('en-IN', { ...IST, hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');

export const fmtDate = (d) =>
  d ? new Date(String(d).length === 10 ? `${d}T00:00:00` : d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export function fmtClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export const fullName = (s) => [s.firstName ?? s.first_name, s.middleName ?? s.middle_name, s.lastName ?? s.last_name].filter(Boolean).join(' ');

export const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

export const LETTERS = ['A', 'B', 'C', 'D', 'E'];

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
