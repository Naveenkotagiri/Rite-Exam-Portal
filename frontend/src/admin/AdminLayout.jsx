import { useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { CalendarCheck, FileText, LogOut, ShieldCheck } from 'lucide-react';
import { adminSession } from '../api.js';
import { initials } from '../ui.jsx';

const NAV = [
  { to: '/admin', end: true, label: 'Drives', icon: CalendarCheck },
  { to: '/admin/exams', label: 'Exams', icon: FileText },
];

export default function AdminLayout() {
  const session = adminSession.get();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!session) navigate(`/admin/login?next=${encodeURIComponent(location.pathname)}`, { replace: true });
  }, [session, navigate, location.pathname]);
  if (!session) return null;

  const logout = () => {
    adminSession.clear();
    navigate('/admin/login');
  };

  return (
    <div className="admin">
      <nav className="sidenav" aria-label="Main">
        <div className="sidenav-head">
          <img src="/brand/rite-mark.png" alt="Rite" />
          <div className="sidenav-product">
            <b>Rite Exam Portal</b>
            <span>Campus hiring</span>
          </div>
        </div>
        <div className="sidenav-body">
          <div className="sidenav-label">Campus drives</div>
          {NAV.map(({ to, end, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={end} title={label}>
              <Icon size={18} aria-hidden="true" /><span>{label}</span>
            </NavLink>
          ))}
          <div className="sidenav-label" style={{ marginTop: 18 }}>Settings</div>
          <NavLink to="/admin/users" title="Admins">
            <ShieldCheck size={18} aria-hidden="true" /><span>Admins</span>
          </NavLink>
        </div>
        <div className="sidenav-foot">
          <span className="avatar" aria-hidden="true">{initials(session.admin.name)}</span>
          <div className="sidenav-user">
            <b>{session.admin.name}</b>
            <span>{session.admin.email}</span>
          </div>
          <button className="icon-btn" onClick={logout} title="Log out" aria-label="Log out">
            <LogOut size={17} />
          </button>
        </div>
      </nav>
      <div className="admin-content">
        <Outlet />
      </div>
    </div>
  );
}
