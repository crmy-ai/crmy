// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

const BASE = '/api/v1';

function getToken(): string | null {
  return localStorage.getItem('crmy_token');
}

export function setToken(token: string) {
  localStorage.setItem('crmy_token', token);
}

export function clearToken() {
  localStorage.removeItem('crmy_token');
  localStorage.removeItem('crmy_user');
}

export function getUser(): { id: string; email: string; name: string; role: string; tenant_id: string } | null {
  const raw = localStorage.getItem('crmy_user');
  return raw ? JSON.parse(raw) : null;
}

export function setUser(user: { id: string; email: string; name: string; role: string; tenant_id: string }) {
  localStorage.setItem('crmy_user', JSON.stringify(user));
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(path.startsWith('/') ? path : `${BASE}/${path}`, {
      ...opts,
      headers,
    });
  } catch {
    throw new Error('Unable to reach the server. Check your connection and try again.');
  }

  if (res.status === 401) {
    clearToken();
    // Only hard-redirect if not already on the login page to avoid refresh loops
    if (!window.location.pathname.endsWith('/login')) {
      window.location.href = '/app/login';
    }
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(body.detail || `HTTP ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// Auth endpoints (no /api/v1 prefix)
export const auth = {
  login: (email: string, password: string) =>
    request<{ token: string; user: { id: string; email: string; name: string; role: string; tenant_id: string } }>(
      '/auth/login',
      { method: 'POST', body: JSON.stringify({ email, password }) },
    ),
  register: (data: { email: string; password: string; name: string; tenant_name: string }) =>
    request<{ token: string; user: { id: string; email: string; name: string; role: string; tenant_id: string } }>(
      '/auth/register',
      { method: 'POST', body: JSON.stringify(data) },
    ),
};
