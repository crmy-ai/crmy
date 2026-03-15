// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/card';
import { auth, setToken, setUser } from '../../api/client';
import crMyLogo from '../../assets/crmy-logo.png';
import { X, Check, Sun, Moon } from 'lucide-react';

const PASSWORD_RULES = [
  { label: 'At least 8 characters', test: (p: string) => p.length >= 8 },
  { label: 'One uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'One number', test: (p: string) => /\d/.test(p) },
  { label: 'One special character', test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPassword(password: string) {
  return PASSWORD_RULES.every((r) => r.test(password));
}

export function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('crmy_theme', next ? 'dark' : 'light');
  };

  if (localStorage.getItem('crmy_token')) {
    return <Navigate to="/" replace />;
  }

  const touch = (field: string) => setTouched((t) => ({ ...t, [field]: true }));

  const emailError = touched.email && !isValidEmail(email) ? 'Enter a valid email address' : '';
  const passwordError =
    touched.password && mode === 'register' && !isValidPassword(password)
      ? 'Password does not meet requirements'
      : touched.password && !password
        ? 'Password is required'
        : '';
  const nameError = touched.name && mode === 'register' && !name.trim() ? 'Name is required' : '';
  const tenantError =
    touched.tenantName && mode === 'register' && !tenantName.trim() ? 'Organization name is required' : '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ email: true, password: true, name: true, tenantName: true });

    if (!isValidEmail(email)) return;
    if (!password) return;
    if (mode === 'register') {
      if (!isValidPassword(password) || !name.trim() || !tenantName.trim()) return;
    }

    setError('');
    setLoading(true);
    try {
      const result =
        mode === 'login'
          ? await auth.login(email, password)
          : await auth.register({ email, password, name, tenant_name: tenantName });
      setToken(result.token);
      setUser(result.user);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (next: 'login' | 'register') => {
    setMode(next);
    setTouched({});
    setError('');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <button
        onClick={toggleTheme}
        className="fixed top-4 right-4 p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        aria-label="Toggle theme"
      >
        {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
      </button>
      <div className="dark w-full max-w-md">
      <Card className="w-full">
        <CardHeader className="text-left">
          <div className="flex items-center gap-3 mb-1">
            <img src={crMyLogo} alt="CRMy" className="h-14 w-14 object-contain" />
            <CardTitle className="font-brand font-bold text-2xl flex-1">
              {mode === 'login' ? (
                <>Sign in to <span className="text-primary">CRMy</span></>
              ) : (
                <>Create your account</>
              )}
            </CardTitle>
            {mode === 'register' && (
              <button
                onClick={() => switchMode('login')}
                className="ml-auto p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                aria-label="Back to sign in"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
          {mode === 'register' && (
            <CardDescription className="text-center">Set up a new tenant and admin account</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {mode === 'register' && (
              <>
                <div>
                  <label className="mb-1 block text-sm font-medium">Your name <span className="text-destructive">*</span></label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => touch('name')}
                    aria-invalid={!!nameError}
                  />
                  {nameError && <p className="mt-1 text-xs text-destructive">{nameError}</p>}
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Organization name <span className="text-destructive">*</span></label>
                  <Input
                    value={tenantName}
                    onChange={(e) => setTenantName(e.target.value)}
                    onBlur={() => touch('tenantName')}
                    aria-invalid={!!tenantError}
                  />
                  {tenantError && <p className="mt-1 text-xs text-destructive">{tenantError}</p>}
                </div>
              </>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium">Email <span className="text-destructive">*</span></label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => touch('email')}
                aria-invalid={!!emailError}
              />
              {emailError && <p className="mt-1 text-xs text-destructive">{emailError}</p>}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Password <span className="text-destructive">*</span></label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => touch('password')}
                aria-invalid={!!passwordError}
              />
              {passwordError && mode !== 'register' && (
                <p className="mt-1 text-xs text-destructive">{passwordError}</p>
              )}
              {mode === 'register' && touched.password && (
                <ul className="mt-2 space-y-1">
                  {PASSWORD_RULES.map((rule) => {
                    const passing = rule.test(password);
                    return (
                      <li key={rule.label} className={`flex items-center gap-1.5 text-xs ${passing ? 'text-success' : 'text-muted-foreground'}`}>
                        <Check className={`w-3 h-3 ${passing ? 'opacity-100' : 'opacity-30'}`} />
                        {rule.label}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}
            </Button>
          </form>
          <div className="mt-4 text-center text-sm text-muted-foreground">
            {mode === 'login' ? (
              <>
                Don't have an account?{' '}
                <button className="text-primary hover:underline" onClick={() => switchMode('register')}>
                  Register
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button className="text-primary hover:underline" onClick={() => switchMode('login')}>
                  Sign in
                </button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
