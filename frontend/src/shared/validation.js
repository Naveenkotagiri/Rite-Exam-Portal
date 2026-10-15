// Student registration rules, shared by the browser form and the API so both agree.

const NAME = /^[A-Za-z][A-Za-z .'-]{0,49}$/;

export const STUDENT_FIELDS = [
  { name: 'firstName', label: 'First Name', required: true, autoComplete: 'given-name' },
  { name: 'middleName', label: 'Middle Name', required: false, autoComplete: 'additional-name' },
  { name: 'lastName', label: 'Last Name', required: true, autoComplete: 'family-name' },
  { name: 'studentId', label: 'Student ID', required: true, placeholder: 'As on your college ID card' },
  { name: 'email', label: 'Email', required: true, type: 'email', autoComplete: 'email', placeholder: 'name@example.com' },
  { name: 'phone', label: 'Phone Number', required: true, type: 'tel', autoComplete: 'tel', placeholder: '10-digit mobile number' },
];

const clean = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');

export function normalizeStudent(raw = {}) {
  let phone = String(raw.phone ?? '').replace(/\D/g, '');
  if (phone.length === 12 && phone.startsWith('91')) phone = phone.slice(2);
  if (phone.length === 11 && phone.startsWith('0')) phone = phone.slice(1);
  return {
    firstName: clean(raw.firstName),
    middleName: clean(raw.middleName),
    lastName: clean(raw.lastName),
    studentId: clean(raw.studentId).replace(/\s/g, '').toUpperCase(),
    email: clean(raw.email).toLowerCase(),
    phone,
  };
}

/** Returns { fieldName: message } for every invalid field; empty object when valid. */
export function validateStudent(s) {
  const e = {};
  if (!NAME.test(s.firstName)) e.firstName = 'Enter your first name (letters only).';
  if (s.middleName && !NAME.test(s.middleName)) e.middleName = 'Letters only.';
  if (!NAME.test(s.lastName)) e.lastName = 'Enter your last name (letters only).';
  if (!/^[A-Z0-9/-]{3,30}$/.test(s.studentId)) e.studentId = 'Enter your Student ID (3–30 letters or digits).';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.email) || s.email.length > 254) e.email = 'Enter a valid email address.';
  if (!/^[6-9]\d{9}$/.test(s.phone)) e.phone = 'Enter a valid 10-digit mobile number.';
  return e;
}
