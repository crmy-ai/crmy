// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Loader2, Lock } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface SetupInfo {
  token_type: 'invite' | 'password_reset';
  expires_at: string;
  tenant_name: string;
  user: { email: string; name: string; role: string };
}

async function authRequest<T>(path: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw new Error('Setup request timed out. Check server health and try again.');
    throw err;
  } finally {
    window.clearTimeout(timeout);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || 'Setup link failed');
  return data as T;
}

export function SetupPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [info, setInfo] = useState<SetupInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    authRequest<SetupInfo>(`/auth/setup/${encodeURIComponent(token)}`)
      .then(setInfo)
      .catch(err => toast({ title: 'Invalid setup link', description: err instanceof Error ? err.message : 'Please request a new link.', variant: 'destructive' }))
      .finally(() => setLoading(false));
  }, [token]);

  const submit = async () => {
    if (password.length < 12) {
      toast({ title: 'Password too short', description: 'Use at least 12 characters.', variant: 'destructive' });
      return;
    }
    if (password !== confirmPassword) {
      toast({ title: 'Passwords do not match', variant: 'destructive' });
      return;
    }
    try {
      await authRequest(`/auth/setup/${encodeURIComponent(token)}`, { password });
      setComplete(true);
      toast({ title: 'Password saved' });
      setTimeout(() => navigate('/login'), 1200);
    } catch (err) {
      toast({ title: 'Could not save password', description: err instanceof Error ? err.message : 'Please request a new link.', variant: 'destructive' });
    }
  };

  const title = info?.token_type === 'password_reset' ? 'Reset password' : 'Set up your account';
  const inputCls = 'w-full h-11 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold text-foreground">{title}</h1>
            <p className="text-sm text-muted-foreground">{info?.tenant_name ?? 'CRMy'}</p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Validating link...
          </div>
        ) : !info ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">This setup link is invalid or expired.</p>
            <Link to="/login" className="text-sm font-semibold text-primary hover:underline">Back to login</Link>
          </div>
        ) : complete ? (
          <div className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="h-4 w-4" /> Password saved. Redirecting to login...
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-muted/30 p-3">
              <p className="text-sm font-semibold text-foreground">{info.user.name}</p>
              <p className="text-xs text-muted-foreground">{info.user.email}</p>
              <p className="mt-1 text-xs text-muted-foreground">Expires {new Date(info.expires_at).toLocaleString()}</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} className={inputCls} placeholder="Min. 12 characters" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Confirm Password</label>
              <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} className={inputCls} placeholder="Repeat password" />
            </div>
            <button onClick={submit} className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
              Save password
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
