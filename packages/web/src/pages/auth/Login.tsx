// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/card';
import { ApiError, auth, setToken, setUser } from '../../api/client';
import crMyLogo from '../../assets/crmy-logo.png';
import { X, Check, Sun, Moon, ChevronDown, Eye, EyeOff } from 'lucide-react';
import { useAppStore } from '../../store/appStore';

const TAGLINE = 'Operational customer context for AI agents.';
const RELEASE_NOTES_URL = 'https://github.com/crmy-ai/crmy#release';
const APP_VERSION = __CRMY_WEB_VERSION__;
const DEMO_PASSWORD = 'crmy-demo-123';
const DEMO_ACCOUNTS = [
  { label: 'Admin', email: 'sample.admin@crmy.local' },
  { label: 'Manager', email: 'sample.manager@crmy.local' },
  { label: 'Rep', email: 'sample.rep@crmy.local' },
] as const;

const PASSWORD_RULES = [
  { label: 'At least 12 characters', test: (p: string) => p.length >= 12 },
  { label: 'One uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'One number', test: (p: string) => /\d/.test(p) },
  { label: 'One special character', test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function isValidPassword(password: string) {
  return PASSWORD_RULES.every((r) => r.test(password));
}

function loginErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message === 'Unauthorized') {
    return 'Email or password did not match. Check the email address and try again.';
  }
  if (err instanceof ApiError) {
    if (err.status === 422) return 'Enter a valid email address.';
    if (err.status === 429) return 'Too many login attempts. Please wait a bit and try again.';
    if (err.status === 409 && err.body.type === 'https://crmy.ai/errors/workspace_required') {
      return 'This email belongs to more than one workspace. Enter the workspace slug and try again.';
    }
    return (err.body.detail as string | undefined) ?? 'Authentication failed. Please try again.';
  }
  return err instanceof Error ? err.message : 'Authentication failed. Please try again.';
}


export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { darkVariant } = useAppStore();
  const isCharcoal = darkVariant === 'charcoal';

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenantSlug, setTenantSlug] = useState('');
  const [name, setName] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));
  const [showPassword, setShowPassword] = useState(false);
  const [dbStatus, setDbStatus] = useState<{
    status: 'ok' | 'db_error' | 'api_error' | 'loading';
    environment?: string;
    setup?: {
      has_users: boolean;
      bootstrap_required: boolean;
      public_registration_enabled: boolean;
      registration_open: boolean;
      demo_accounts_available?: boolean;
    };
    tenant?: {
      name?: string;
      slug?: string;
    };
    version?: string;
  }>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5_000);
    fetch('/health', { signal: controller.signal })
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!d) {
          setDbStatus({ status: 'api_error' });
          return;
        }
        setDbStatus({
          status: d.db === 'ok' ? 'ok' : 'db_error',
          environment: d.environment,
          setup: d.setup,
          tenant: d.tenant,
          version: d.version,
        });
      })
      .catch(() => setDbStatus({ status: 'api_error' }))
      .finally(() => window.clearTimeout(timeout));
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (mode === 'register' && dbStatus.status === 'ok' && dbStatus.setup?.registration_open === false) {
      setMode('login');
      setTouched({});
      setError('');
    }
  }, [dbStatus.setup?.registration_open, dbStatus.status, mode]);

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

  const normalizedEmail = email.trim();
  const emailError = touched.email && !isValidEmail(normalizedEmail) ? 'Enter a valid email address' : '';
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
    setEmail(normalizedEmail);

    if (!isValidEmail(normalizedEmail)) return;
    if (!password) return;
    if (mode === 'register') {
      if (!isValidPassword(password) || !name.trim() || !tenantName.trim()) return;
    }

    setError('');
    setLoading(true);
    try {
      const result =
        mode === 'login'
          ? await auth.login(normalizedEmail, password, tenantSlug)
          : await auth.register({ email: normalizedEmail, password, name: name.trim(), tenant_name: tenantName.trim() });
      setToken(result.token);
      setUser(result.user);
      await queryClient.invalidateQueries({ queryKey: ['agent-config'] });
      navigate('/');
    } catch (err) {
      setError(loginErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (next: 'login' | 'register') => {
    setMode(next);
    setTouched({});
    setError('');
  };

  const fillDemoAccount = (emailAddress: string) => {
    setMode('login');
    setEmail(emailAddress);
    setPassword(DEMO_PASSWORD);
    setTouched({});
    setError('');
  };

  // Card wrapper: in dark mode render as dark panel variant; in light mode use default light styles
  const cardClass = isDark ? (isCharcoal ? 'dark charcoal' : 'dark') : '';
  const registrationOpen = dbStatus.status === 'ok' && dbStatus.setup?.registration_open === true;
  const isFirstRun = dbStatus.status === 'ok' && dbStatus.setup?.bootstrap_required === true;
  const statusLabel =
    dbStatus.status === 'loading'
      ? 'Checking CRMy server...'
      : dbStatus.status === 'ok'
        ? 'Server ready'
        : dbStatus.status === 'db_error'
          ? 'Database unavailable'
          : 'Server unreachable';
  const databaseLabel =
    dbStatus.status === 'loading'
      ? 'Checking'
      : dbStatus.status === 'ok'
        ? 'Connected'
        : dbStatus.status === 'db_error'
          ? 'Unavailable'
          : 'Unknown';
  const setupLabel = dbStatus.status === 'ok'
    ? isFirstRun
      ? 'First workspace setup open'
      : registrationOpen
        ? 'Public registration enabled'
        : 'Sign-in only'
    : 'Unavailable';
  const showPasswordHelp = mode === 'login' && Boolean(error) && !registrationOpen;
  const showWorkspaceField = mode === 'login' && (
    tenantSlug.trim().length > 0 ||
    error.includes('more than one workspace') ||
    dbStatus.setup?.public_registration_enabled === true
  );
  const showDemoAccounts = mode === 'login' && dbStatus.status === 'ok' && dbStatus.setup?.demo_accounts_available === true;
  const workspaceName = dbStatus.tenant?.name?.trim() || 'CRMy Workspace';
  const displayVersion = APP_VERSION !== 'unknown' ? APP_VERSION : dbStatus.version;
  const serverVersionDiffers = Boolean(displayVersion && dbStatus.version && dbStatus.version !== displayVersion);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(124,58,237,0.14),transparent_34rem)]" />
      <button
        onClick={toggleTheme}
        className="fixed right-4 top-4 z-10 rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Toggle theme"
      >
        {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
      </button>
      <div className={`${cardClass} relative flex w-full max-w-md flex-col items-center`}>
      <img
        src={crMyLogo}
        alt="CRMy"
        className="-mb-2 h-32 w-32 object-contain sm:-mb-3 sm:h-40 sm:w-40"
      />
      <Card className="w-full border-border/80 shadow-xl shadow-black/5">
        <CardHeader className="relative items-center text-center">
          {mode === 'register' && (
            <button
              onClick={() => switchMode('login')}
              className="absolute right-5 top-5 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Back to sign in"
            >
              <X className="w-5 h-5" />
            </button>
          )}
          <div className="space-y-1">
            <CardTitle className="font-brand text-2xl font-bold tracking-normal">
              {mode === 'login' ? (
                <>Sign in to <span className="text-primary">CRMy</span></>
              ) : (
                <>{isFirstRun ? 'Create your workspace' : 'Create your account'}</>
              )}
            </CardTitle>
            <CardDescription>{TAGLINE}</CardDescription>
            {dbStatus.status === 'ok' && (
              <p className="text-xs text-muted-foreground/75">{workspaceName}</p>
            )}
          </div>
          {mode === 'login' && isFirstRun && (
            <p className="pt-2 text-xs text-muted-foreground">
              First local setup? Create the owner account for this workspace.
            </p>
          )}
          {mode === 'register' && (
            <p className="pt-2 text-xs text-muted-foreground">
              {isFirstRun
                ? 'Set up the first workspace and owner account.'
                : 'Create a new workspace and owner account.'}
            </p>
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
              <label className="sr-only">Email</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => { setEmail((value) => value.trim()); touch('email'); }}
                autoComplete="email"
                placeholder="Email"
                aria-invalid={!!emailError}
              />
              {emailError && <p className="mt-1 text-xs text-destructive">{emailError}</p>}
            </div>
            <div>
              <label className="sr-only">Password</label>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onBlur={() => touch('password')}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  placeholder="Password"
                  aria-invalid={!!passwordError}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
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
            {showWorkspaceField && (
              <div>
                <label className="sr-only">Workspace slug</label>
                <Input
                  value={tenantSlug}
                  onChange={(e) => setTenantSlug(e.target.value)}
                  onBlur={() => setTenantSlug((value) => value.trim())}
                  autoComplete="organization"
                  placeholder="Workspace slug"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Only needed when the same email belongs to more than one workspace.
                </p>
              </div>
            )}
            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <p>{error}</p>
                {showPasswordHelp && (
                  <p className="mt-1 text-xs text-destructive/80">
                    Forgot your password? Ask an admin to reset it, or run <code className="font-mono">crmy reset-password</code> on the server.
                  </p>
                )}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}
            </Button>
          </form>
          <div className="mt-4 text-center text-sm text-muted-foreground">
            {mode === 'login' ? (
              registrationOpen ? (
                <>
                  {isFirstRun ? 'New self-hosted install? ' : "Don't have an account? "}
                  <button className="text-primary hover:underline" onClick={() => switchMode('register')}>
                    {isFirstRun ? 'Create workspace' : 'Register'}
                  </button>
                </>
              ) : (
                <span>Need access? Ask an admin to invite or create your account.</span>
              )
            ) : (
              <>
                Already have an account?{' '}
                <button className="text-primary hover:underline" onClick={() => switchMode('login')}>
                  Sign in
                </button>
              </>
            )}
          </div>
          {showDemoAccounts && (
            <details className="mt-3 rounded-lg border border-border/60 bg-muted/15 px-3 py-2 text-xs text-muted-foreground">
              <summary className="cursor-pointer list-none font-medium text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
                Try demo accounts
              </summary>
              <div className="mt-2 grid gap-1.5">
                {DEMO_ACCOUNTS.map((account) => (
                  <button
                    key={account.email}
                    type="button"
                    onClick={() => fillDemoAccount(account.email)}
                    className="rounded-md px-2 py-1 text-left text-sky-500 transition-colors hover:bg-sky-500/10 hover:text-sky-400"
                  >
                    <span className="font-semibold text-foreground">{account.label}:</span>{' '}
                    <span>{account.email}</span>
                    <span className="text-muted-foreground"> / {DEMO_PASSWORD}</span>
                  </button>
                ))}
              </div>
            </details>
          )}
          <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
            <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              dbStatus.status === 'ok' ? 'bg-green-500' : dbStatus.status === 'loading' ? 'bg-gray-400' : 'bg-red-500'
            }`} />
            {dbStatus.status === 'loading' && <span>Checking CRMy server…</span>}
            {dbStatus.status === 'ok' && (
              <span className="truncate">Server ready</span>
            )}
            {dbStatus.status === 'db_error' && (
              <span className="text-destructive">
                Database unavailable
                <span className="text-muted-foreground"> — check Postgres, then refresh.</span>
              </span>
            )}
            {dbStatus.status === 'api_error' && (
              <span className="text-destructive">
                Server unreachable
                <span className="text-muted-foreground"> — start CRMy, then refresh.</span>
              </span>
            )}
            {displayVersion && (
              <a
                href={RELEASE_NOTES_URL}
                target="_blank"
                rel="noreferrer"
                className="ml-auto flex-shrink-0 text-inherit hover:underline"
              >
                v{displayVersion}
              </a>
            )}
          </div>
          <details className="group -mb-4 mt-1 text-xs text-muted-foreground">
            <summary className="mx-auto flex h-4 w-8 cursor-pointer list-none items-center justify-center rounded-b-md text-muted-foreground/60 transition-colors hover:text-muted-foreground [&::-webkit-details-marker]:hidden">
              <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
              <span className="sr-only">System details</span>
            </summary>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 rounded-lg bg-muted/20 px-3 py-2">
              <dt>Server</dt>
              <dd className={dbStatus.status === 'ok' ? 'text-success' : dbStatus.status === 'loading' ? '' : 'text-destructive'}>
                {statusLabel}
              </dd>
              <dt>Database</dt>
              <dd className={dbStatus.status === 'ok' ? 'text-success' : dbStatus.status === 'db_error' ? 'text-destructive' : ''}>
                {databaseLabel}
              </dd>
              <dt>Setup</dt>
              <dd>{setupLabel}</dd>
              {dbStatus.tenant?.slug && (
                <>
                  <dt>Workspace</dt>
                  <dd>{workspaceName} <span className="text-muted-foreground/60">({dbStatus.tenant.slug})</span></dd>
                </>
              )}
              {dbStatus.environment && (
                <>
                  <dt>Environment</dt>
                  <dd>{dbStatus.environment}</dd>
                </>
              )}
              {displayVersion && (
                <>
                  <dt>App version</dt>
                  <dd>v{displayVersion}</dd>
                </>
              )}
              {serverVersionDiffers && (
                <>
                  <dt>Server version</dt>
                  <dd>v{dbStatus.version}</dd>
                </>
              )}
            </dl>
          </details>
        </CardContent>
      </Card>
      <p className="mt-3 max-w-sm text-center text-[11px] leading-5 text-muted-foreground/60">
        All customer context stays safely in this CRMy workspace.
      </p>
      </div>
    </div>
  );
}
