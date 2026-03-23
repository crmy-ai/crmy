// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useRef, useEffect } from 'react';
import { Sparkles, KeyRound, Users, TriangleAlert, Eye, EyeOff, X } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/hooks/use-toast';
import {
  useAgentConfig,
  useSaveAgentConfig,
  useTestAgentConnection,
  useClearAllAgentSessions,
} from '@/api/hooks';

// ─── Types ───────────────────────────────────────────────────────────────────

type Provider = 'anthropic' | 'openai' | 'openrouter' | 'ollama' | 'custom';

// ─── Constants ───────────────────────────────────────────────────────────────

const providerModels: Record<Provider, string[]> = {
  anthropic: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
  openrouter: ['openrouter/auto', 'anthropic/claude-sonnet-4', 'openai/gpt-4o', 'google/gemini-2.0-flash'],
  ollama: ['llama3.2', 'mistral', 'deepseek-r1'],
  custom: [],
};

const providerUrls: Record<Provider, string> = {
  anthropic: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  ollama: 'http://localhost:11434/v1',
  custom: 'https://your-gateway.example.com/v1',
};

const providerColors: Record<Provider, { dot: string; active: string }> = {
  anthropic: { dot: 'bg-amber-500', active: 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  openai: { dot: 'bg-green-500', active: 'border-green-500/50 bg-green-500/10 text-green-600 dark:text-green-400' },
  openrouter: { dot: 'bg-purple-500', active: 'border-purple-500/50 bg-purple-500/10 text-purple-600 dark:text-purple-400' },
  ollama: { dot: 'bg-blue-500', active: 'border-blue-500/50 bg-blue-500/10 text-blue-600 dark:text-blue-400' },
  custom: { dot: 'bg-gray-400', active: 'border-gray-400/50 bg-gray-400/10 text-gray-600 dark:text-gray-400' },
};

const tokenCosts: Record<number, string> = {
  1000: '~$0.002 / turn at current model pricing',
  4000: '~$0.006 / turn at current model pricing',
  8000: '~$0.012 / turn at current model pricing',
  16000: '~$0.024 / turn at current model pricing',
};

const defaultSystemPrompt = `You are a CRMy AI agent helping manage a CRM pipeline. You have access to contacts, accounts, opportunities, use cases, and activity history via tools. Be concise, accurate, and always confirm before making changes to CRM objects.`;

// ─── Shared style constants ───────────────────────────────────────────────────

const inputCls = 'w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';
const selectCls = `${inputCls} cursor-pointer`;
const primaryBtn = 'px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40';
const ghostBtn = 'px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors';
const dangerBtn = 'px-3 py-1.5 rounded-lg bg-destructive text-destructive-foreground text-xs font-semibold hover:bg-destructive/90 transition-colors';

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AgentSettings() {
  const { data: configData, isLoading } = useAgentConfig();
  const saveConfig = useSaveAgentConfig();
  const testConnection = useTestAgentConnection();
  const clearSessions = useClearAllAgentSessions();

  const config = configData?.data;

  // Section 1 — Enable
  const [enabled, setEnabled] = useState(false);

  // Section 2 — Provider & Model
  const [provider, setProvider] = useState<Provider>('anthropic');
  const [baseUrl, setBaseUrl] = useState(providerUrls.anthropic);
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [model, setModel] = useState('claude-sonnet-4-20250514');
  const [customModel, setCustomModel] = useState('');

  // Section 3 — Per-User Behaviour
  const [historyRetention, setHistoryRetention] = useState(90);
  const [systemPrompt, setSystemPrompt] = useState(defaultSystemPrompt);
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [promptDraft, setPromptDraft] = useState(defaultSystemPrompt);
  const [maxTokens, setMaxTokens] = useState(4000);
  const [canCreateAssignments, setCanCreateAssignments] = useState(true);
  const [canLogActivities, setCanLogActivities] = useState(true);
  const [canWriteObjects, setCanWriteObjects] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Section 4 — Danger Zone
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearConfirmText, setClearConfirmText] = useState('');

  // Hydrate state from API config
  useEffect(() => {
    if (!config) return;
    setEnabled(config.enabled);
    setProvider(config.provider);
    setBaseUrl(config.base_url);
    setModel(config.model);
    setApiKey(config.api_key_enc ?? '');
    setHistoryRetention(config.history_retention_days);
    setSystemPrompt(config.system_prompt ?? defaultSystemPrompt);
    setPromptDraft(config.system_prompt ?? defaultSystemPrompt);
    setMaxTokens(config.max_tokens_per_turn);
    setCanCreateAssignments(config.can_create_assignments);
    setCanLogActivities(config.can_log_activities);
    setCanWriteObjects(config.can_write_objects);
    // If model is not in known list, assume custom
    if (config.provider === 'custom' || (config.provider !== 'custom' && !providerModels[config.provider]?.includes(config.model))) {
      setCustomModel(config.model);
    }
  }, [config]);

  // Focus textarea when prompt editor opens
  useEffect(() => {
    if (editingPrompt && textareaRef.current) textareaRef.current.focus();
  }, [editingPrompt]);

  // Provider change — update URL and model
  const handleProviderChange = (p: Provider) => {
    setProvider(p);
    setBaseUrl(providerUrls[p]);
    const models = providerModels[p];
    setModel(models[0] ?? '');
    setCustomModel('');
  };

  // Handle enable toggle — immediately persist
  const handleToggleEnabled = async (val: boolean) => {
    setEnabled(val);
    try {
      await saveConfig.mutateAsync({ enabled: val });
      toast({ title: val ? 'Agent enabled' : 'Agent disabled' });
    } catch (err) {
      setEnabled(!val);
      toast({ title: 'Failed to update', variant: 'destructive' });
    }
  };

  // Test connection
  const handleTestConnection = async () => {
    // Save current provider config first, then test
    const result = await testConnection.mutateAsync();
    if (result.ok) {
      toast({ title: 'Connection successful', description: `Connected to ${provider} at ${baseUrl}` });
    } else {
      toast({ title: 'Connection failed', description: result.error ?? 'Check your API key and base URL.', variant: 'destructive' });
    }
  };

  // Save provider settings
  const handleSaveProvider = async () => {
    const payload: Record<string, unknown> = {
      provider,
      base_url: baseUrl,
      model: provider === 'custom' ? customModel : model,
      system_prompt: systemPrompt,
      max_tokens_per_turn: maxTokens,
      history_retention_days: historyRetention,
      can_write_objects: canWriteObjects,
      can_log_activities: canLogActivities,
      can_create_assignments: canCreateAssignments,
    };
    // Only send API key if user entered a new one (not masked)
    if (apiKey && !apiKey.startsWith('sk-')) {
      payload.api_key = apiKey;
    }
    try {
      await saveConfig.mutateAsync(payload);
      toast({ title: 'Settings saved', description: 'Agent configuration updated.' });
    } catch {
      toast({ title: 'Save failed', variant: 'destructive' });
    }
  };

  // Clear all histories
  const handleClearAll = async () => {
    setShowClearConfirm(false);
    setClearConfirmText('');
    try {
      await clearSessions.mutateAsync();
      toast({ title: 'Chat histories cleared', description: 'All agent chat histories have been deleted.' });
    } catch {
      toast({ title: 'Failed to clear histories', variant: 'destructive' });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-5 max-w-2xl">
        <div className="h-8 bg-muted rounded animate-pulse" />
        <div className="h-48 bg-muted rounded animate-pulse" />
      </div>
    );
  }

  const dimCls = !enabled ? 'opacity-40 pointer-events-none' : '';

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h2 className="font-display font-bold text-lg text-foreground mb-1">Local AI Agent</h2>
        <p className="text-sm text-muted-foreground">Configure the AI agent for your workspace.</p>
      </div>

      {/* ── SECTION 1: Enable AI Agent ─────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-amber-500" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Enable In-App AI agent</h3>
              <p className="text-xs text-muted-foreground">Toggle AI features on or off for this workspace</p>
            </div>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={handleToggleEnabled}
            aria-label="Enable In-App AI agent"
          />
        </div>

        {/* Feature tags */}
        {enabled && (
          <div className="px-5 py-3 flex flex-wrap gap-2">
            {[
              { icon: '✦', label: 'Sparkle column (tables)' },
              { icon: '💬', label: 'Chat button (object detail)' },
              { icon: '◎', label: 'Floating AI icon' },
              { icon: '✎', label: 'AI-assist on edit' },
            ].map((tag) => (
              <span key={tag.label} className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg bg-muted text-muted-foreground border border-border">
                <span>{tag.icon}</span> {tag.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── SECTION 2: Provider & Model ────────────────────────────────────── */}
      <div className={`rounded-xl border border-border bg-card overflow-hidden transition-opacity ${dimCls}`} aria-disabled={!enabled}>
        {/* Header */}
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
          {config?.api_key_enc && (
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              <span className="text-xs text-muted-foreground">Key configured</span>
            </div>
          )}
        </div>

        <div className="divide-y divide-border px-5">
          {/* Provider pills */}
          <div className="py-4 space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Provider</label>
            <div className="flex flex-wrap gap-2">
              {(['anthropic', 'openai', 'openrouter', 'ollama', 'custom'] as Provider[]).map((p) => {
                const isActive = provider === p;
                return (
                  <button
                    key={p}
                    onClick={() => handleProviderChange(p)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${isActive ? providerColors[p].active + ' border' : 'border-border text-muted-foreground hover:text-foreground bg-muted/40'}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${providerColors[p].dot}`} />
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Base URL */}
          <div className="py-4 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Base URL</label>
            <input
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              placeholder={providerUrls[provider]}
              className={inputCls}
            />
          </div>

          {/* API Key */}
          {provider !== 'ollama' ? (
            <div className="py-4 space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">API Key</label>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  className={inputCls + ' pr-10'}
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          ) : (
            <div className="py-4">
              <p className="text-xs text-muted-foreground italic">Ollama runs locally — no API key required.</p>
            </div>
          )}

          {/* Model */}
          <div className="py-4 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Model</label>
            {provider === 'custom' ? (
              <input
                value={customModel}
                onChange={e => setCustomModel(e.target.value)}
                placeholder="e.g. my-custom-model"
                className={inputCls}
              />
            ) : (
              <select
                value={model}
                onChange={e => setModel(e.target.value)}
                className={selectCls}
              >
                {providerModels[provider].map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            )}
          </div>

          {/* Actions */}
          <div className="py-4 flex items-center gap-2 flex-wrap">
            <button
              onClick={handleTestConnection}
              disabled={testConnection.isPending}
              className={ghostBtn + ' disabled:opacity-40'}
            >
              {testConnection.isPending ? 'Testing...' : 'Test connection'}
            </button>
            <button
              onClick={handleSaveProvider}
              disabled={saveConfig.isPending}
              className={primaryBtn}
            >
              {saveConfig.isPending ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>

      {/* ── SECTION 3: Per-User Agent Behaviour ────────────────────────────── */}
      <div className={`rounded-xl border border-border bg-card overflow-hidden transition-opacity ${dimCls}`} aria-disabled={!enabled}>
        {/* Header */}
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
              <div>
                <p className="text-sm font-medium text-foreground">Max tokens per turn</p>
              </div>
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
            <Switch checked={canCreateAssignments} onCheckedChange={setCanCreateAssignments} aria-label="Allow agent to create assignments" />
          </div>

          {/* Can log activities */}
          <div className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm font-medium text-foreground">Allow agent to log activities</p>
              <p className="text-xs text-muted-foreground">Agent can record calls, notes, and emails</p>
            </div>
            <Switch checked={canLogActivities} onCheckedChange={setCanLogActivities} aria-label="Allow agent to log activities" />
          </div>

          {/* Can write objects */}
          <div className="py-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Allow agent to write CRM objects</p>
                <p className="text-xs text-muted-foreground">Agent can create and edit contacts, accounts, and opportunities</p>
              </div>
              <Switch checked={canWriteObjects} onCheckedChange={setCanWriteObjects} aria-label="Allow agent to write CRM objects" />
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

      {/* ── SECTION 4: Danger Zone ─────────────────────────────────────────── */}
      <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-card overflow-hidden">
        {/* Header */}
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
          {/* Clear histories */}
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

      {/* ── System Prompt Editor Overlay ───────────────────────────────────── */}
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
                onClick={() => { setSystemPrompt(promptDraft); setEditingPrompt(false); toast({ title: 'System prompt updated' }); }}
                className={primaryBtn}
              >
                Save prompt
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Clear Confirm Modal ─────────────────────────────────────────────── */}
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
              <button onClick={() => { setShowClearConfirm(false); setClearConfirmText(''); }} className={ghostBtn}>Cancel</button>
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
