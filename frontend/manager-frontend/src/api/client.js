const BASE_URL = import.meta.env.VITE_API_URL ?? '';
const TOKEN_KEY = 'nastya_manager_token';
const REFRESH_KEY = 'nastya_manager_refresh';

export class ApiError extends Error {
  constructor(status, detail) {
    super(detail || `HTTP ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getToken() {
  return storage()?.getItem(TOKEN_KEY) ?? '';
}

export function setTokens(tokens) {
  const s = storage();
  if (!s) return;
  if (!tokens) {
    s.removeItem(TOKEN_KEY);
    s.removeItem(REFRESH_KEY);
    return;
  }
  s.setItem(TOKEN_KEY, tokens.accessToken);
  if (tokens.refreshToken) s.setItem(REFRESH_KEY, tokens.refreshToken);
}

export function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function errorDetail(res) {
  try {
    const data = await res.json();
    const m = data?.message ?? data?.detail;
    if (Array.isArray(m)) return m.join('; ');
    return typeof m === 'string' ? m : '';
  } catch {
    return res.statusText;
  }
}

let refreshing = null;

async function tryRefresh() {
  const refresh = storage()?.getItem(REFRESH_KEY);
  if (!refresh) return false;
  if (!refreshing) {
    refreshing = fetch(`${BASE_URL}/auth/token/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refresh }),
    })
      .then(async (r) => {
        if (!r.ok) return false;
        const data = await r.json();
        setTokens(data.tokens);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

async function request(path, { method = 'GET', body, headers, retry = true } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (res.status === 401 && retry && path !== '/auth/login' && path !== '/auth/token/refresh') {
    if (await tryRefresh()) return request(path, { method, body, headers, retry: false });
    setTokens(null);
  }
  if (!res.ok) {
    throw new ApiError(res.status, await errorDetail(res));
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  delete: (path) => request(path, { method: 'DELETE' }),
};
