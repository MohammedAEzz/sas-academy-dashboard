const JSON_HEADERS = { Accept: 'application/json', 'X-Requested-With': 'fetch' };

export function friendlyError(error) {
  if (!error || error.network) return 'The server could not be reached. Check your connection and try again.';
  if (error.status === 401 || error.code === 'UNAUTHORIZED') return 'Your session expired. Sign in again.';
  if (error.status === 429 || error.code === 'RATE_LIMITED') {
    return error.message || 'Too many sign-in attempts. Try again in 15 minutes.';
  }
  if (error.code === 'CONFIG') return error.message || 'The server is missing upload configuration.';
  return error.message || 'Something went wrong.';
}

export async function api(path, { method = 'GET', json, form } = {}) {
  const headers = { ...JSON_HEADERS };
  let body;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (form) {
    body = form;
  }
  let response;
  try {
    response = await fetch(path, { method, headers, body, credentials: 'same-origin' });
  } catch {
    const error = new Error('network');
    error.network = true;
    throw error;
  }
  const type = response.headers.get('content-type') || '';
  let payload = null;
  if (type.includes('json')) {
    try { payload = await response.json(); } catch { payload = null; }
  }
  if (!response.ok) {
    const error = new Error(payload?.error?.message || 'Request failed');
    error.status = response.status;
    error.code = payload?.error?.code || '';
    error.details = payload?.error?.details || null;
    throw error;
  }
  return payload;
}

export function session() {
  return api('/api/auth');
}

export function login(password) {
  return api('/api/auth?action=login', { method: 'POST', json: { password } });
}

export function logout() {
  return api('/api/auth?action=logout', { method: 'POST', json: {} });
}

export function previewImport({ dataset, file }) {
  const form = new FormData();
  form.append('dataset', dataset);
  form.append('file', file, file.name);
  return api('/api/imports?action=preview', { method: 'POST', form });
}

export function commitImport({ dataset, file, sha256, previewCounts }) {
  const form = new FormData();
  form.append('dataset', dataset);
  form.append('file', file, file.name);
  form.append('sha256', sha256);
  form.append('previewCounts', JSON.stringify(previewCounts));
  return api('/api/imports?action=commit', { method: 'POST', form });
}

export function importHistory() {
  return api('/api/imports?action=history');
}

export function revertImport(importId, reason) {
  return api('/api/imports?action=revert', { method: 'POST', json: { importId, reason } });
}
