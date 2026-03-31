// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Sparkles, KeyRound, Users, TriangleAlert, Eye, EyeOff, X,
  ActivitySquare, ArrowRight, CheckCircle2, XCircle,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import {
  useAgentConfig,
  useSaveAgentConfig,
  useTestAgentConnection,
  useClearAllAgentSessions,
} from '@/api/hooks';
import {
  PROVIDERS,
  CUSTOM_MODEL_SENTINEL,
  getProvider,
  type ProviderId,
} from '@/lib/agentProviders';

// ─── Constants ───────────────────────────────────────────────────────────────

const tokenCosts: Record<number, string> = {
  1000:  '~$0.002 / turn at current model pricing',
  4000:  '~$0.006 / turn at current model pricing',
  8000:  '~$0.012 / turn at current model pricing',
  16000: '~$0.024 / turn at current model pricing',
};

const defaultSystemPrompt = `You are a CRMy workspace agent helping manage a CRM pipeline. You have access to contacts, accounts, opportunities, use cases, and activity history via tools. Be concise, accurate, and always confirm before making changes to CRM objects.`;

// ─── Shared style constants ───────────────────────────────────────────────────

const inputCls = 'w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';
const primaryBtn = 'px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const ghostBtn = 'px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const dangerBtn = 'px-3 py-1.5 rounded-lg bg-destructive text-destructive-foreground text-xs font-semibold hover:bg-destructive/90 transition-colors disabled:opacity-40';

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AgentSettings() {
  const { data: configData, isLoading } = useAgentConfig();
  const saveConfig       = useSaveAgentConfig();
  const testConnection   = useTestAgentConnection();
  const clearSessions    = useClearAllAgentSessions();

  const config = configData?.data;

  // ── Section 1 — Enable ───────────────────────────────────────────────────
  const [enabled, setEnabled] = useState(false);

  // ── Section 2 — Provider & Model ────────────────────────────────────────
  const [provider,    setProvider]    = useState<ProviderId>('anthropic');
  const [baseUrl,     setBaseUrl]     = useState(getProvider('anthropic').baseUrl);
  /** New key the user typed this session. Empty = no change to stored key. */
  const [newApiKey,   setNewApiKey]   = useState('');
  const [showApiKey,  setShowApiKey]  = useState(false);
  /** Last 4 chars of stored key returned from the server — for identification. */
  const [keyHint,     setKeyHint]     = useState<string | null>(null);
  const [keyConfigured, setKeyConfigured] = useState(false);
  /**
   * Selected model ID.  Value is CUSTOM_MODEL_SENTINEL when user chose "Custom…".
   */
  const [modelId,     setModelId]     = useState('');
  /** Free-text model name when modelId === CUSTOM_MODEL_SENTINEL or provider === 'custom'. */
  const [customModel, setCustomModel] = useState('');

  // ── Test status ──────────────────────────────────────────────────────────
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [testError,  setTestError]  = useState('');

  // ── Section 3 — Per-User Behaviour ──────────────────────────────────────
  const [historyRetention,    setHistoryRetention]    = useState(90);
  const [systemPrompt,        setSystemPrompt]        = useState(defaultSystemPrompt);
  const [editingPrompt,       setEditingPrompt]       = useState(false);
  const [promptDraft,         setPromptDraft]         = useState(defaultSystemPrompt);
  const [maxTokens,           setMaxTokens]           = useState(4000);
  const [canCreateAssignments, setCanCreateAssignments] = useState(true);
  const [canLogActivities,    setCanLogActivities]    = useState(true);
  const [canWriteObjects,     setCanWriteObjects]     = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Danger Zone ──────────────────────────────────────────────────────────
  const [showClearConfirm,  setShowClearConfirm]  = useState(false);
  const [clearConfirmText,  setClearConfirmText]  = useState('');

  // ── Hydrate from API ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!config) return;
    setEnabled(config.enabled);
    setProvider(config.provider as ProviderId);
    setBaseUrl(config.base_url);
    setKeyConfigured(config.api_key_configured ?? false);
    setKeyHint(config.api_key_hint ?? null);

    // Resolve model: check if it's in the known list for this provider
    const providerDef = getProvider(config.provider);
    const known = providerDef.models.find(m => m.id === config.model);
    if (known) {
      setModelId(config.model);
      setCustomModel('');
    } else {
      setModelId(CUSTOM_MODEL_SENTINEL);
      setCustomModel(config.model ?? '');
    }

    setHistoryRetention(config.history_retention_days);
    setSystemPrompt(config.system_prompt ?? defaultSystemPrompt);
    setPromptDraft(config.system_prompt ?? defaultSystemPrompt);
    setMaxTokens(config.max_tokens_per_turn);
    setCanCreateAssignments(config.can_create_assignments);
    setCanLogActivities(config.can_log_activities);
    setCanWriteObjects(config.can_write_objects);
  }, [config]);

  // Focus textarea when prompt editor opens
  useEffect(() => {
    if (editingPrompt && textareaRef.current) textareaRef.current.focus();
  }, [editingPrompt]);

  // ── Derived values ────────────────────────────────────────────────────────
  const providerDef = getProvider(provider);
  const isCustomModel = modelId === CUSTOM_MODEL_SENTINEL || provider === 'custom';
  /** The actual model string to send to the API. */
  const resolvedModel = isCustomModel ? customModel : modelId;

  /**
   * Whether the enable toggle is interactive.
   * Requires a stored key (or Ollama which needs no key) + a model + base URL.
   */
  const canEnable = !providerDef.requiresKey
    ? Boolean(resolvedModel && baseUrl)
    : Boolean(keyConfigured && resolvedModel && baseUrl);

  /** Reset test status whenever any config-sensitive field changes. */
  const resetTest = () => { setTestStatus('idle'); setTestError(''); };

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleProviderChange = (p: ProviderId) => {
    setProvider(p);
    const def = getProvider(p);
    setBaseUrl(def.baseUrl);
    const firstModel = def.models[0]?.id ?? '';
    setModelId(firstModel || CUSTOM_MODEL_SENTINEL);
    setCustomModel('');
    setNewApiKey('');
    resetTest();
  };

  const handleToggleEnabled = async (val: boolean) => {
    if (val && !canEnable) return; // guard
    setEnabled(val);
    try {
      await saveConfig.mutateAsync({ enabled: val });
      toast({ title: val ? 'Agent enabled' : 'Agent disabled' });
    } catch {
      setEnabled(!val);
      toast({ title: 'Failed to update', variant: 'destructive' });
    }
  };

  const handleTestConnection = async () => {
    setTestStatus('testing');
    setTestError('');
    try {
      const payload: Record<string, string> = {
        provider,
        base_url: baseUrl,
        model:    resolvedModel,
      };
      // Only send the key if the user typed a new one this session
      if (newApiKey.trim()) payload.api_key = newApiKey.trim();

      const result = await testConnection.mutateAsync(payload);
      if (result.ok) {
        setTestStatus('ok');
      } else {
        setTestStatus('fail');
        setTestError(result.error ?? 'Check your settings and try again.');
      }
    } catch (err) {
      setTestStatus('fail');
      setTestError(err instanceof Error ? err.message : 'Connection failed');
    }
  };

  const handleSaveProvider = async () => {
    const payload: Record<string, unknown> = {
      provider,
      base_url:               baseUrl,
      model:                  resolvedModel,
      system_prompt:          systemPrompt,
      max_tokens_per_turn:    maxTokens,
      history_retention_days: historyRetention,
      can_write_objects:      canWriteObjects,
      can_log_activities:     canLogActivities,
      can_create_assignments: canCreateAssignments,
    };
    // Only send api_key if the user entered a new one
    if (newApiKey.trim()) {
      payload.api_key = newApiKey.trim();
    }
    try {
      await saveConfig.mutateAsync(payload);
      // After save, the key is now stored — update hint state from response
      setNewApiKey('');  // clear the new-key input
      toast({ title: 'Settings saved', description: 'Agent configuration updated.' });
    } catch {
      toast({ title: 'Save failed', variant: 'destructive' });
    }
  };

  const handleClearAll = async () => {
    setShowClearConfirm(false);
    setClearConfirmText('');
    try {
      await clearSessions.mutateAsync({} as never);
      toast({ title: 'Chat histories cleared', description: 'All agent chat histories have been deleted.' });
    } catch {
      toast({ title: 'Failed to clear histories', variant: 'destructive' });
    }
  };

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-5 max-w-2xl">
        <div className="h-8 bg-muted rounded animate-pulse" />
        <div className="h-48 bg-muted rounded animate-pulse" />
      </div>
    );
  }

  const dimCls = !enabled ? 'opacity-40 pointer-events-none' : '';
  // Key placeholder shown when no new key typed but one is stored
  const keyPlaceholder = keyConfigured
    ? `••••••••${keyHint ?? '••••'}`
    : 'Paste your API key…';

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h2 className="font-display font-bold text-lg text-foreground mb-1">Local Agent</h2>
        <p className="text-sm text-muted-foreground">Configure the workspace agent for your team.</p>
      </div>

      {/* ── SECTION 1: Enable ────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-amber-500" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Enable Local Agent</h3>
              <p className="text-xs text-muted-foreground">Toggle AI features on or off for this workspace</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Switch
              checked={enabled}
              onCheckedChange={handleToggleEnabled}
              disabled={!canEnable && !enabled}
              aria-label="Enable Local Agent"
            />
            {!canEnable && !enabled && (
              <p className="text-[10px] text-muted-foreground text-right max-w-[160px]">
                Configure and test your provider first
              </p>
            )}
          </div>
        </div>

        {enabled && (
          <div className="px-5 py-3 flex flex-wrap gap-2">
            {[
              { icon: '✦', label: 'Sparkle column (tables)' },
              { icon: '💬', label: 'Chat button (object detail)' },
              { icon: '◎', label: 'Floating agent icon' },
              { icon: '✎', label: 'AI-assist on edit' },
            ].map((tag) => (
              <span key={tag.label} className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg bg-muted text-muted-foreground border border-border">
                <span>{tag.icon}</span> {tag.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── SECTION 2: Provider & Model ─────────────────────────────────── */}
      <div className={`rounded-xl border border-border bg-card overflow-hidden transition-opacity ${dimCls}`} aria-disabled={!enabled}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <KeyRound className="w-4 h-4 text-blue-500" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Provider &amp; model</h3>
              <p className="text-xs text-muted-foreground">Connect to an LLM gateway or direct provider</p>
            </div>
          </div>
          {keyConfigured && (
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              <span className="text-xs text-muted-foreground">
                Key configured{keyHint ? ` (…${keyHint})` : ''}
              </span>
            </div>
          )}
        </div>

        <div className="divide-y divide-border px-5">
          {/* Provider dropdown */}
          <div className="py-4 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Provider</label>
            <Select
              value={provider}
              onValueChange={(v) => handleProviderChange(v as ProviderId)}
            >
              <SelectTrigger className="w-full h-9 text-sm">
                <SelectValue placeholder="Select provider…" />
              </SelectTrigger>
              <SelectContent>
                {PROVIDERS.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    <span className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${p.dotColor}`} />
                      {p.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Base URL */}
          <div className="py-4 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Base URL</label>
            <input
              value={baseUrl}
              onChange={e => { setBaseUrl(e.target.value); resetTest(); }}
              placeholder={providerDef.baseUrl || 'https://…'}
              className={inputCls}
            />
          </div>

          {/* API Key (hidden for Ollama) */}
          {providerDef.requiresKey ? (
            <div className="py-4 space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">API Key</label>
                {keyConfigured && !newApiKey && (
                  <span className="text-[10px] text-muted-foreground">
                    Enter a new key to replace the stored one
                  </span>
                )}
              </div>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={newApiKey}
                  onChange={e => { setNewApiKey(e.target.value); resetTest(); }}
                  placeholder={keyPlaceholder}
                  className={inputCls + ' pr-10'}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                >
                  {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          ) : (
            <div className="py-4">
              <p className="text-xs text-muted-foreground italic">
                {provider === 'ollama'
                  ? 'Ollama runs locally — no API key required.'
                  : 'No API key required for this provider.'}
              </p>
            </div>
          )}

          {/* Model */}
          <div className="py-4 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Model</label>
            {provider === 'custom' ? (
              <input
                value={customModel}
                onChange={e => { setCustomModel(e.target.value); resetTest(); }}
                placeholder="e.g. my-custom-model"
                className={inputCls}
              />
            ) : (
              <div className="space-y-2">
                <Select
                  value={modelId}
                  onValueChange={v => { setModelId(v); if (v !== CUSTOM_MODEL_SENTINEL) setCustomModel(''); resetTest(); }}
                >
                  <SelectTrigger className="w-full h-9 text-sm">
                    <SelectValue placeholder="Select model…" />
                  </SelectTrigger>
                  <SelectContent>
                    {providerDef.models.map(m => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.label}
                      </SelectItem>
                    ))}
                    <SelectItem value={CUSTOM_MODEL_SENTINEL}>
                      <span className="text-muted-foreground italic">Custom model ID…</span>
                    </SelectItem>
                  </SelectContent>
                </Select>
                {isCustomModel && (
                  <input
                    value={customModel}
                    onChange={e => { setCustomModel(e.target.value); resetTest(); }}
                    placeholder="Enter model ID exactly as required by the API"
                    className={inputCls}
                    autoFocus
                  />
                )}
              </div>
            )}
          </div>

          {/* Actions + inline test status */}
          <div className="py-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handleTestConnection}
                disabled={testStatus === 'testing' || (!resolvedModel) || (!baseUrl)}
                className={ghostBtn}
              >
                {testStatus === 'testing' ? 'Testing…' : 'Test connection'}
              </button>
              <button
                onClick={handleSaveProvider}
                disabled={testStatus !== 'ok' || saveConfig.isPending}
                className={primaryBtn}
                title={testStatus !== 'ok' ? 'Run a successful test first' : undefined}
              >
                {saveConfig.isPending ? 'Saving…' : 'Save changes'}
              </button>
            </div>

            {/* Inline test feedback */}
            {testStatus === 'ok' && (
              <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Connected successfully — you can now save.</span>
              </div>
            )}
            {testStatus === 'fail' && (
              <div className="flex items-start gap-1.5 text-xs text-destructive">
                <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>{testError || 'Connection failed. Check your key, URL, and model.'}</span>
              </div>
            )}
            {testStatus === 'idle' && testStatus !== 'ok' && (
              <p className="text-[10px] text-muted-foreground">
                Test your connection before saving to confirm the key works.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── SECTION 3: Per-User Agent Behaviour ─────────────────────────── */}
      <div className={`rounded-xl border border-border bg-card overflow-hidden transition-opacity ${dimCls}`} aria-disabled={!enabled}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <div className="w-9 h-9 rounded-xl bg-purple-500/10 flex items-center justify-center">
            <Users className="w-4 h-4 text-purple-500" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Per-user agent behaviour</h3>
            <p className="text-xs text-muted-foreground">Fine-tune how the agent behaves for this workspace</p>
          </div>
        </div>

        <div className="divide-y divide-border px-5">
          {/* History retention */}
          <div className="flex items-center justify-between py-3 gap-4">
            <div>
              <p className="text-sm font-medium text-foreground">Chat history retention</p>
              <p className="text-xs text-muted-foreground">How long to keep conversation history</p>
            </div>
            <select
              value={historyRetention}
              onChange={e => setHistoryRetention(Number(e.target.value))}
              className="h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:ring-1 focus:ring-ring cursor-pointer"
            >
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={180}>180 days</option>
              <option value={0}>Forever</option>
            </select>
          </div>

          {/* System prompt */}
          <div className="py-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">System prompt</p>
                <p className="text-xs text-muted-foreground">Instructions sent to the agent at the start of every conversation</p>
              </div>
              <button
                onClick={() => { setPromptDraft(systemPrompt); setEditingPrompt(true); }}
                className="text-xs font-semibold text-primary hover:underline whitespace-nowrap"
              >
                Edit prompt &rarr;
              </button>
            </div>
            <div className="p-3 rounded-lg bg-muted/30 border border-border">
              <p className="text-xs text-muted-foreground font-mono leading-relaxed line-clamp-2">{systemPrompt}</p>
            </div>
          </div>

          {/* Max tokens */}
          <div className="py-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-foreground">Max tokens per turn</p>
              <select
                value={maxTokens}
                onChange={e => setMaxTokens(Number(e.target.value))}
                className="h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:ring-1 focus:ring-ring cursor-pointer"
              >
                <option value={1000}>1,000</option>
                <option value={4000}>4,000</option>
                <option value={8000}>8,000</option>
                <option value={16000}>16,000</option>
              </select>
            </div>
            <p className="text-xs text-muted-foreground">{tokenCosts[maxTokens]}</p>
          </div>

          {/* Can create assignments */}
          <div className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm font-medium text-foreground">Allow agent to create assignments</p>
              <p className="text-xs text-muted-foreground">Agent can assign tasks to users and actors</p>
            </div>
            <Switch
              checked={canCreateAssignments}
              onCheckedChange={setCanCreateAssignments}
              aria-label="Allow agent to create assignments"
            />
          </div>

          {/* Can log activities */}
          <div className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm font-medium text-foreground">Allow agent to log activities</p>
              <p className="text-xs text-muted-foreground">Agent can record calls, notes, and emails</p>
            </div>
            <Switch
              checked={canLogActivities}
              onCheckedChange={setCanLogActivities}
              aria-label="Allow agent to log activities"
            />
          </div>

          {/* Can write objects */}
          <div className="py-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Allow agent to write CRM objects</p>
                <p className="text-xs text-muted-foreground">Agent can create and edit contacts, accounts, and opportunities</p>
              </div>
              <Switch
                checked={canWriteObjects}
                onCheckedChange={setCanWriteObjects}
                aria-label="Allow agent to write CRM objects"
              />
            </div>
            {canWriteObjects && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <TriangleAlert className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Granting write access means the agent can modify CRM records autonomously. Review agent actions regularly.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── SECTION 4: Observability ─────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <ActivitySquare className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Observability</h3>
            <p className="text-xs text-muted-foreground">Review what the agent has been doing across the workspace</p>
          </div>
        </div>
        <div className="px-5 py-3">
          <Link to="/agent/activity" className="flex items-center justify-between py-1 group">
            <div>
              <p className="text-sm font-medium text-foreground">Agent activity log</p>
              <p className="text-xs text-muted-foreground">Browse every tool call the agent has made — with arguments, results, session, and timing</p>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0 ml-4" />
          </Link>
        </div>
      </div>

      {/* ── SECTION 5: Danger Zone ───────────────────────────────────────── */}
      <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-card overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-red-200 dark:border-red-900/50">
          <div className="w-9 h-9 rounded-xl bg-red-500/10 flex items-center justify-center">
            <TriangleAlert className="w-4 h-4 text-red-500" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-red-600 dark:text-red-400">Danger zone</h3>
            <p className="text-xs text-muted-foreground">Irreversible actions — proceed with care</p>
          </div>
        </div>
        <div className="divide-y divide-red-100 dark:divide-red-900/30 px-5">
          <div className="flex items-center justify-between py-3 gap-4">
            <div>
              <p className="text-sm font-medium text-foreground">Clear all chat histories</p>
              <p className="text-xs text-muted-foreground">Permanently delete all agent conversation history for this workspace</p>
            </div>
            <button onClick={() => setShowClearConfirm(true)} className={dangerBtn + ' whitespace-nowrap'}>
              Clear all histories
            </button>
          </div>
        </div>
      </div>

      {/* ── System Prompt Editor Overlay ─────────────────────────────────── */}
      {editingPrompt && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-xl p-6 max-w-2xl w-full mx-4 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-foreground">Edit system prompt</h3>
              <button onClick={() => setEditingPrompt(false)} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <textarea
              ref={textareaRef}
              value={promptDraft}
              onChange={e => setPromptDraft(e.target.value)}
              rows={10}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring font-mono resize-none"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditingPrompt(false)} className={ghostBtn}>Cancel</button>
              <button
                onClick={() => {
                  setSystemPrompt(promptDraft);
                  setEditingPrompt(false);
                  toast({ title: 'System prompt updated' });
                }}
                className={primaryBtn}
              >
                Save prompt
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Clear Confirm Modal ──────────────────────────────────────────── */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-xl p-6 max-w-sm w-full mx-4 shadow-xl space-y-4">
            <h3 className="font-semibold text-foreground">Clear all chat histories?</h3>
            <p className="text-sm text-muted-foreground">
              This is irreversible. Type <code className="font-mono bg-muted px-1 rounded">CLEAR</code> to confirm.
            </p>
            <input
              value={clearConfirmText}
              onChange={e => setClearConfirmText(e.target.value)}
              placeholder="CLEAR"
              className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm font-mono outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setShowClearConfirm(false); setClearConfirmText(''); }}
                className={ghostBtn}
              >
                Cancel
              </button>
              <button
                disabled={clearConfirmText !== 'CLEAR'}
                onClick={handleClearAll}
                className={dangerBtn + ' disabled:opacity-40'}
              >
                Clear histories
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
