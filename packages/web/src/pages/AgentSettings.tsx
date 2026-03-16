// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, KeyRound, Users, LayoutGrid, TriangleAlert, Eye, EyeOff, Bot, X } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/hooks/use-toast';
import { useAgentSettings } from '@/contexts/AgentSettingsContext';
import { AnimatePresence, motion } from 'framer-motion';

// ─── Types ───────────────────────────────────────────────────────────────────

type Provider = 'anthropic' | 'openai' | 'openrouter' | 'ollama' | 'custom';
type ActorType = 'human' | 'agent';
type ActorStatus = 'active' | 'idle';

interface Actor {
  id: string;
  type: ActorType;
  name: string;
  detail: string;
  status: ActorStatus;
}

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

const defaultSettings = {
  provider: 'anthropic' as Provider,
  baseUrl: 'https://api.anthropic.com/v1',
  apiKey: 'sk-ant-api03-••••••••••••••••••••••••••••••••',
  model: 'claude-sonnet-4-20250514',
  historyRetentionDays: 90,
  systemPrompt: `You are a CRMy AI agent helping [User Name] manage their real estate/mortgage/insurance pipeline. You have access to their contacts, accounts, opportunities, use cases, and activity history via MCP tools. Be concise, accurate, and always confirm before making changes to CRM objects.`,
  maxTokensPerTurn: 4000,
  canCreateAssignments: true,
  canLogActivities: true,
  canWriteObjects: false,
};

const mockActors: Actor[] = [
  { id: '1', type: 'human', name: 'Cody Harris', detail: 'cody@crmy.ai', status: 'active' },
  { id: '2', type: 'agent', name: 'Outreach Bot', detail: 'custom/outreach-bot · claude-sonnet-4-20250514', status: 'active' },
  { id: '3', type: 'agent', name: 'Research Agent', detail: 'custom/research-v1 · last seen 8 days ago', status: 'idle' },
];

// ─── Shared style constants ───────────────────────────────────────────────────

const inputCls = 'w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';
const selectCls = `${inputCls} cursor-pointer`;
const primaryBtn = 'px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40';
const ghostBtn = 'px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors';
const dangerBtn = 'px-3 py-1.5 rounded-lg bg-destructive text-destructive-foreground text-xs font-semibold hover:bg-destructive/90 transition-colors';

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AgentSettings() {
  const { enabled, setEnabled } = useAgentSettings();

  // Section 2 — Provider & Model
  const [provider, setProvider] = useState<Provider>(defaultSettings.provider);
  const [baseUrl, setBaseUrl] = useState(defaultSettings.baseUrl);
  const [apiKey, setApiKey] = useState(defaultSettings.apiKey);
  const [showApiKey, setShowApiKey] = useState(false);
  const [model, setModel] = useState(defaultSettings.model);
  const [customModel, setCustomModel] = useState('');
  const [testingConn, setTestingConn] = useState(false);
  const [savingProvider, setSavingProvider] = useState(false);
  const [saveProviderDone, setSaveProviderDone] = useState(false);

  // Section 3 — Per-User Behaviour
  const [historyRetention, setHistoryRetention] = useState(defaultSettings.historyRetentionDays);
  const [systemPrompt, setSystemPrompt] = useState(defaultSettings.systemPrompt);
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [promptDraft, setPromptDraft] = useState(defaultSettings.systemPrompt);
  const [maxTokens, setMaxTokens] = useState(defaultSettings.maxTokensPerTurn);
  const [canCreateAssignments, setCanCreateAssignments] = useState(defaultSettings.canCreateAssignments);
  const [canLogActivities, setCanLogActivities] = useState(defaultSettings.canLogActivities);
  const [canWriteObjects, setCanWriteObjects] = useState(defaultSettings.canWriteObjects);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Section 4 — Actors
  const [actors, setActors] = useState<Actor[]>(mockActors);
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [newActorName, setNewActorName] = useState('');
  const [newActorEmail, setNewActorEmail] = useState('');
  const [revokeConfirmId, setRevokeConfirmId] = useState<string | null>(null);

  // Section 5 — Danger Zone
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearConfirmText, setClearConfirmText] = useState('');
  const [showRevokeAllConfirm, setShowRevokeAllConfirm] = useState(false);

  // Focus textarea when prompt editor opens
  useEffect(() => {
    if (editingPrompt && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [editingPrompt]);

  // Provider change — update URL and model
  const handleProviderChange = (p: Provider) => {
    setProvider(p);
    setBaseUrl(providerUrls[p]);
    const models = providerModels[p];
    setModel(models[0] ?? '');
    setCustomModel('');
    setSaveProviderDone(false);
  };

  // Test connection
  const handleTestConnection = async () => {
    setTestingConn(true);
    await new Promise(r => setTimeout(r, 1200));
    setTestingConn(false);
    if (Math.random() > 0.3) {
      toast({ title: 'Connection successful', description: `Connected to ${provider} at ${baseUrl}` });
    } else {
      toast({ title: 'Connection failed', description: 'Could not reach the provider. Check your API key and base URL.', variant: 'destructive' });
    }
  };

  // Save provider settings
  const handleSaveProvider = async () => {
    setSavingProvider(true);
    await new Promise(r => setTimeout(r, 1500));
    setSavingProvider(false);
    setSaveProviderDone(true);
    toast({ title: 'Settings saved', description: 'Provider configuration updated.' });
    setTimeout(() => setSaveProviderDone(false), 3000);
  };

  // Register actor
  const handleRegisterActor = () => {
    if (!newActorName.trim() || !newActorEmail.trim()) return;
    const newActor: Actor = {
      id: Date.now().toString(),
      type: 'human',
      name: newActorName.trim(),
      detail: newActorEmail.trim(),
      status: 'active',
    };
    setActors(prev => [newActor, ...prev]);
    setShowRegisterForm(false);
    setNewActorName('');
    setNewActorEmail('');
    toast({ title: 'Actor registered', description: `${newActor.name} has been registered.` });
  };

  // Revoke actor
  const handleRevokeActor = (id: string) => {
    setActors(prev => prev.filter(a => a.id !== id));
    setRevokeConfirmId(null);
    toast({ title: 'Actor revoked' });
  };

  // Clear all histories
  const handleClearAll = () => {
    setShowClearConfirm(false);
    setClearConfirmText('');
    toast({ title: 'Chat histories cleared', description: 'All agent chat histories have been deleted.' });
  };

  // Revoke all actors
  const handleRevokeAll = () => {
    setActors([]);
    setShowRevokeAllConfirm(false);
    toast({ title: 'All actors revoked', description: 'All actor registrations have been removed.' });
  };

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
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-muted text-muted-foreground border-border">
              Coming soon
            </span>
            <Switch
              checked={false}
              onCheckedChange={() => {}}
              disabled
              aria-label="Enable In-App AI agent"
            />
          </div>
        </div>

        {/* Info banner */}
        <div className="px-5 py-3 bg-muted/40 border-b border-border">
          <p className="text-xs text-muted-foreground">
            Backend support for the AI agent is not yet available. This toggle will be enabled once the agent service is configured and deployed.
          </p>
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
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-xs text-muted-foreground">Connected</span>
          </div>
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
              disabled={testingConn}
              className={ghostBtn + ' disabled:opacity-40'}
            >
              {testingConn ? 'Testing…' : 'Test connection'}
            </button>
            <button
              onClick={handleSaveProvider}
              disabled={savingProvider}
              className={primaryBtn}
            >
              {savingProvider ? 'Saving…' : saveProviderDone ? 'Saved ✓' : 'Save changes'}
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
                Edit prompt →
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

      {/* ── SECTION 4: Registered Actors ───────────────────────────────────── */}
      <div className={`rounded-xl border border-border bg-card overflow-hidden transition-opacity ${dimCls}`} aria-disabled={!enabled}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <LayoutGrid className="w-4 h-4 text-blue-500" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Registered actors</h3>
              <p className="text-xs text-muted-foreground">Humans and agents with access to the AI context engine</p>
            </div>
          </div>
          <button
            onClick={() => setShowRegisterForm(v => !v)}
            className={primaryBtn}
          >
            + Register human
          </button>
        </div>

        <div className="px-5">
          {/* Inline register form */}
          <AnimatePresence>
            {showRegisterForm && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="py-4 border-b border-border space-y-3"
              >
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">New actor</p>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={newActorName}
                    onChange={e => setNewActorName(e.target.value)}
                    placeholder="Full name"
                    className={inputCls}
                  />
                  <input
                    value={newActorEmail}
                    onChange={e => setNewActorEmail(e.target.value)}
                    placeholder="Email address"
                    className={inputCls}
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleRegisterActor}
                    disabled={!newActorName.trim() || !newActorEmail.trim()}
                    className={primaryBtn}
                  >
                    Register →
                  </button>
                  <button onClick={() => { setShowRegisterForm(false); setNewActorName(''); setNewActorEmail(''); }} className={ghostBtn}>
                    Cancel
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Actors list */}
          <div className="divide-y divide-border">
            <AnimatePresence>
              {actors.map(actor => (
                <motion.div
                  key={actor.id}
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0, marginTop: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <div className="flex items-center gap-3 py-3">
                    {/* Avatar */}
                    {actor.type === 'human' ? (
                      <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                        <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400">
                          {actor.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                        </span>
                      </div>
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                        <Bot className="w-3.5 h-3.5 text-blue-500" />
                      </div>
                    )}
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-foreground truncate">{actor.name}</p>
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-muted text-muted-foreground border-border capitalize">{actor.type}</span>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${actor.status === 'active' ? 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30' : 'bg-muted text-muted-foreground border-border'}`}>
                          {actor.status}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{actor.detail}</p>
                    </div>
                    {/* Revoke */}
                    <button
                      onClick={() => setRevokeConfirmId(actor.id === revokeConfirmId ? null : actor.id)}
                      className="px-2.5 py-1 rounded-lg border border-border text-[11px] font-semibold text-muted-foreground hover:text-destructive hover:border-destructive/30 transition-colors flex-shrink-0"
                    >
                      Revoke
                    </button>
                  </div>

                  {/* Inline revoke confirm */}
                  <AnimatePresence>
                    {revokeConfirmId === actor.id && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="pb-3 flex items-center gap-2 flex-wrap">
                          <p className="text-xs text-muted-foreground flex-1">Remove <strong className="text-foreground">{actor.name}</strong> from registered actors?</p>
                          <button onClick={() => handleRevokeActor(actor.id)} className={dangerBtn}>Confirm revoke</button>
                          <button onClick={() => setRevokeConfirmId(null)} className={ghostBtn}>Cancel</button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
            </AnimatePresence>

            {actors.length === 0 && (
              <p className="py-6 text-sm text-muted-foreground text-center">No registered actors.</p>
            )}
          </div>
        </div>
      </div>

      {/* ── SECTION 5: Danger Zone ─────────────────────────────────────────── */}
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

          {/* Revoke all actors */}
          <div className="flex items-center justify-between py-3 gap-4">
            <div>
              <p className="text-sm font-medium text-foreground">Revoke all actor registrations</p>
              <p className="text-xs text-muted-foreground">Remove all registered humans and agents from the context engine</p>
            </div>
            <button onClick={() => setShowRevokeAllConfirm(true)} className={dangerBtn + ' whitespace-nowrap'}>
              Revoke all actors
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
              <button
                onClick={() => setEditingPrompt(false)}
                className={ghostBtn}
              >
                Cancel
              </button>
              <button
                onClick={() => { setSystemPrompt(promptDraft); setEditingPrompt(false); toast({ title: 'System prompt saved' }); }}
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

      {/* ── Revoke All Actors Modal ─────────────────────────────────────────── */}
      {showRevokeAllConfirm && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-xl p-6 max-w-sm w-full mx-4 shadow-xl space-y-4">
            <h3 className="font-semibold text-foreground">Revoke all actor registrations?</h3>
            <p className="text-sm text-muted-foreground">
              This will remove all registered humans and agents from the context engine. This action cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowRevokeAllConfirm(false)} className={ghostBtn}>Cancel</button>
              <button onClick={handleRevokeAll} className={dangerBtn}>Revoke all actors</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
