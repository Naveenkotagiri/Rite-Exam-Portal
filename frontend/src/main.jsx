import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import '@fontsource/poppins/300.css';
import '@fontsource/poppins/400.css';
import '@fontsource/poppins/500.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import './styles.css';
import { Eyebrow, Logo } from './ui.jsx';
import StudentDrive from './student/StudentDrive.jsx';
import StudentResult from './student/StudentResult.jsx';
import AdminLayout from './admin/AdminLayout.jsx';
import Login from './admin/Login.jsx';
import Drives from './admin/Drives.jsx';
import DriveDetail from './admin/DriveDetail.jsx';
import AttemptDetail from './admin/AttemptDetail.jsx';
import Exams from './admin/Exams.jsx';
import ExamEditor from './admin/ExamEditor.jsx';
import Admins from './admin/Admins.jsx';

function Home() {
  return (
    <div className="center-page">
      <div className="card narrow">
        <Logo height={40} />
        <div style={{ marginTop: 28 }}>
          <Eyebrow>Campus hiring</Eyebrow>
          <h1 className="rite-underline">Rite Exam Portal</h1>
        </div>
        <p className="muted">Students: open the test link or scan the QR code shared by your placement coordinator.</p>
        <p><Link to="/admin">Admin login →</Link></p>
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="center-page">
      <div className="card narrow">
        <Logo height={32} />
        <h1 style={{ marginTop: 24 }}>Page not found</h1>
        <p className="muted">Check the link and try again.</p>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/d/:code" element={<StudentDrive />} />
        <Route path="/d/:code/result" element={<StudentResult />} />
        <Route path="/admin/login" element={<Login />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Drives />} />
          <Route path="drives/:id" element={<DriveDetail />} />
          <Route path="attempts/:id" element={<AttemptDetail />} />
          <Route path="exams" element={<Exams />} />
          <Route path="exams/:id" element={<ExamEditor />} />
          <Route path="users" element={<Admins />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
