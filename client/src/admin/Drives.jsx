import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarPlus, Plus } from 'lucide-react';
import { adminApi } from '../api.js';
import { Alert, DRIVE_STATUS, EmptyState, PageHeader, Spinner, StatusBadge, fmtDate } from '../ui.jsx';
import { useLoad } from './useLoad.js';
import DriveForm from './DriveForm.jsx';

export default function Drives() {
  const { data: drives, error, loading } = useLoad(() => adminApi.get('/api/admin/drives'));
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  return (
    <>
      <PageHeader eyebrow="Campus hiring" title="Campus drives" sub="One drive per college visit. Each drive has its own test link.">
        <button className="btn" onClick={() => setCreating(true)}><Plus size={18} aria-hidden="true" />New drive</button>
      </PageHeader>
      <main className="admin-main">
        <Alert>{error}</Alert>
        {loading ? <Spinner /> : drives?.length === 0 ? (
          <div className="card">
            <EmptyState icon={CalendarPlus} title="No drives yet">
              First add your questions under <Link to="/admin/exams">Exams</Link>, then create a drive for each college visit.
            </EmptyState>
          </div>
        ) : (
          <div className="card table-card">
            <table className="table">
              <thead>
                <tr><th>Drive</th><th>College</th><th>Date</th><th>Exam</th><th>Status</th><th className="num">Registered</th><th className="num">Writing</th><th className="num">Submitted</th></tr>
              </thead>
              <tbody>
                {drives?.map((d) => (
                  <tr key={d.id} className="clickable" onClick={() => navigate(`/admin/drives/${d.id}`)}>
                    <td><Link to={`/admin/drives/${d.id}`}>{d.name}</Link></td>
                    <td>{d.college}</td>
                    <td className="mono small">{fmtDate(d.drive_date)}</td>
                    <td>{d.exam_title}</td>
                    <td><StatusBadge map={DRIVE_STATUS} status={d.status} /></td>
                    <td className="num">{d.registered}</td>
                    <td className="num">{d.in_progress}</td>
                    <td className="num">{d.submitted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
      {creating && <DriveForm onClose={() => setCreating(false)} onSaved={(d) => navigate(`/admin/drives/${d.id}`)} />}
    </>
  );
}
