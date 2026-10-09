import { ApiError, authHeaders } from './client';

export function getSupportStatus() {
  return fetch('/api/support/status', { headers: authHeaders() }).then((r) => (r.ok ? r.json() : { configured: false }));
}

export async function sendSupportReport({ text, page, files = [] }) {
  const form = new FormData();
  form.set('text', text);
  form.set('page', page || '');
  for (const f of files) form.append('files', f, f.name);
  const r = await fetch('/api/support/report', { method: 'POST', headers: authHeaders(), body: form });
  if (!r.ok) {
    let detail = '';
    try {
      const data = await r.json();
      detail = Array.isArray(data?.message) ? data.message.join('. ') : data?.message || '';
    } catch {
      detail = '';
    }
    throw new ApiError(r.status, detail || `Ошибка ${r.status}`);
  }
  return r.json();
}
