class ApiError extends Error {
  constructor(message, status, data = {}) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function request(method, url, { body, token, raw, contentType } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (raw !== undefined) {
    payload = raw;
    headers['Content-Type'] = contentType || 'application/octet-stream';
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  let res;
  try {
    res = await fetch(url, { method, headers, body: payload });
  } catch {
    throw new ApiError('Cannot reach the server. Please check your internet connection.', 0);
  }
  if (res.status === 204) return null;
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status}).`, res.status, data || {});
  return data;
}

/** localStorage that never throws (private mode, blocked storage). */
export const local = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  },
  del(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
};

// ---- Student ----

const code = (c) => encodeURIComponent(c);

export const studentApi = {
  drive: (c) => request('GET', `/api/drives/${code(c)}`),
  register: (c, student) => request('POST', `/api/drives/${code(c)}/register`, { body: student }),
  result: (c, studentId, phone) => request('POST', `/api/drives/${code(c)}/result`, { body: { studentId, phone } }),
  state: (token) => request('GET', '/api/attempt', { token }),
  clock: (token) => request('GET', '/api/attempt/clock', { token }),
  start: (token) => request('POST', '/api/attempt/start', { token }),
  saveAnswers: (token, answers) => request('POST', '/api/attempt/answers', { token, body: { answers } }),
  event: (token, type, detail = '') => request('POST', '/api/attempt/events', { token, body: { type, detail } }),
  snapshot: (token, blob) => request('POST', '/api/attempt/snapshot', { token, raw: blob, contentType: 'image/jpeg' }),
  submit: (token) => request('POST', '/api/attempt/submit', { token }),
};

// ---- Admin ----

const ADMIN_KEY = 'rite_admin_session';

export const adminSession = {
  get: () => local.get(ADMIN_KEY),
  set: (s) => local.set(ADMIN_KEY, s),
  clear: () => local.del(ADMIN_KEY),
};

async function adminRequest(method, url, opts = {}) {
  try {
    return await request(method, url, { ...opts, token: adminSession.get()?.token });
  } catch (e) {
    if (e.status === 401) {
      adminSession.clear();
      window.location.assign(`/admin/login?next=${encodeURIComponent(window.location.pathname)}`);
    }
    throw e;
  }
}

async function adminFetchBlob(url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${adminSession.get()?.token}` } });
  if (!res.ok) throw new ApiError(`Download failed (${res.status}).`, res.status);
  return res.blob();
}

export const adminApi = {
  login: (email, password) => request('POST', '/api/admin/login', { body: { email, password } }),
  get: (url) => adminRequest('GET', url),
  post: (url, body) => adminRequest('POST', url, { body: body ?? {} }),
  put: (url, body) => adminRequest('PUT', url, { body }),
  del: (url) => adminRequest('DELETE', url),
  upload: (url, file) => adminRequest('POST', url, { raw: file }),
  blob: adminFetchBlob,
  async download(url, filename) {
    const blob = await adminFetchBlob(url);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  },
};
