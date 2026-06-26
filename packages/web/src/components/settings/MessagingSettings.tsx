// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from '@/hooks/use-toast';
import {
  useEmailProvider, useUpdateEmailProvider,
  useMessagingChannels, useCreateMessagingChannel,
  useUpdateMessagingChannel, useDeleteMessagingChannel,
  useInboundEmailConfig, useGenerateInboundSecret,
  useSourceFilters, useUpdateSourceFilters,
  useOAuthReadiness,
  useTenantOAuthApps, useUpsertTenantOAuthApp, useDeleteTenantOAuthApp,
  type OAuthReadinessItem, type TenantOAuthApp,
} from '@/api/hooks';
import {
  Mail, MessageSquare, Plus, Trash2, Pencil,
  Power, PowerOff, Star, Eye, EyeOff, X, Send, CheckCircle2, Download, RefreshCw, Copy,
  SlidersHorizontal, KeyRound, CalendarClock, AlertCircle, ExternalLink,
} from 'lucide-react';

// ─── Provider Config Registry ────────────────────────────────────────────────

interface ProviderField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'password' | 'boolean';
  placeholder?: string;
  required?: boolean;
}

interface ProviderConfig {
  label: string;
  icon: React.ElementType;
  fields: ProviderField[];
}

const EMAIL_PROVIDERS: Record<string, ProviderConfig> = {
  smtp: {
    label: 'SMTP',
    icon: Mail,
    fields: [
      { key: 'host', label: 'SMTP Host', type: 'text', placeholder: 'smtp.gmail.com', required: true },
      { key: 'port', label: 'Port', type: 'number', placeholder: '587', required: true },
      { key: 'secure', label: 'Use TLS/SSL', type: 'boolean' },
      { key: 'auth.user', label: 'Username', type: 'text', placeholder: 'user@example.com', required: true },
      { key: 'auth.pass', label: 'Password', type: 'password', placeholder: '********', required: true },
    ],
  },
  resend: {
    label: 'Resend',
    icon: Send,
    fields: [
      { key: 'api_key', label: 'API Key', type: 'password', placeholder: 're_...', required: true },
    ],
  },
  postmark: {
    label: 'Postmark',
    icon: Send,
    fields: [
      { key: 'server_token', label: 'Server Token', type: 'password', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', required: true },
      { key: 'message_stream', label: 'Message Stream', type: 'text', placeholder: 'outbound' },
    ],
  },
  sendgrid: {
    label: 'SendGrid',
    icon: Send,
    fields: [
      { key: 'api_key', label: 'API Key', type: 'password', placeholder: 'SG....', required: true },
    ],
  },
  ses: {
    label: 'Amazon SES',
    icon: Send,
    fields: [
      { key: 'region', label: 'AWS Region', type: 'text', placeholder: 'us-east-1', required: true },
      { key: 'access_key_id', label: 'Access Key ID', type: 'text', placeholder: 'AKIA...', required: true },
      { key: 'secret_access_key', label: 'Secret Access Key', type: 'password', placeholder: '••••••••', required: true },
    ],
  },
  mailgun: {
    label: 'Mailgun',
    icon: Send,
    fields: [
      { key: 'api_key', label: 'API Key', type: 'password', placeholder: 'key-...', required: true },
      { key: 'domain', label: 'Domain', type: 'text', placeholder: 'mg.example.com', required: true },
      { key: 'url', label: 'API URL', type: 'text', placeholder: 'https://api.mailgun.net' },
    ],
  },
};

const CHANNEL_PROVIDERS: Record<string, ProviderConfig> = {
  slack: {
    label: 'Slack',
    icon: MessageSquare,
    fields: [
      { key: 'webhook_url', label: 'Webhook URL', type: 'password', placeholder: 'https://hooks.slack.com/services/...', required: true },
      { key: 'channel', label: 'Default Channel', type: 'text', placeholder: '#general' },
    ],
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const inputCls = 'w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';
const btnPrimary = 'px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-40';
const btnOutline = 'px-3 py-1.5 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-muted';

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce((o: unknown, k) => (o as Record<string, unknown>)?.[k], obj);
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const clone = { ...obj };
  const keys = path.split('.');
  if (keys.length === 1) {
    clone[keys[0]] = value;
  } else {
    const [head, ...rest] = keys;
    clone[head] = setNestedValue(
      (clone[head] as Record<string, unknown>) ?? {},
      rest.join('.'),
      value,
    );
  }
  return clone;
}

function isRedacted(v: unknown): boolean {
  return typeof v === 'string' && /^\*+$/.test(v);
}

function csvToList(value: string): string[] {
  return value.split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
}

function listToCsv(value: unknown): string {
  return Array.isArray(value) ? value.join(', ') : '';
}

// ─── Dynamic Config Form ─────────────────────────────────────────────────────

function ConfigForm({
  fields,
  values,
  onChange,
}: {
  fields: ProviderField[];
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
}) {
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const valueFields = fields.filter(field => field.type !== 'boolean');
  const booleanFields = fields.filter(field => field.type === 'boolean');

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {valueFields.map((f) => {
          const val = getNestedValue(values, f.key);
          const isPassword = f.type === 'password';
          const show = revealed.has(f.key);
          return (
            <div key={f.key} className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{f.label}</label>
              <div className="relative">
                <input
                  type={isPassword && !show ? 'password' : f.type === 'number' ? 'number' : 'text'}
                  value={val != null ? String(val) : ''}
                  placeholder={f.placeholder}
                  onChange={(e) => {
                    const v = f.type === 'number' ? Number(e.target.value) || 0 : e.target.value;
                    onChange(setNestedValue(values, f.key, v));
                  }}
                  className={`${inputCls} ${isPassword ? 'pr-9' : ''}`}
                />
                {isPassword && (
                  <button
                    type="button"
                    onClick={() => setRevealed((s) => { const n = new Set(s); n.has(f.key) ? n.delete(f.key) : n.add(f.key); return n; })}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {booleanFields.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-muted/30 px-3 py-2">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Connection security</span>
          {booleanFields.map((f) => {
            const val = getNestedValue(values, f.key);
            return (
              <label key={f.key} className="inline-flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={!!val}
                  onChange={(e) => onChange(setNestedValue(values, f.key, e.target.checked))}
                  className="h-3.5 w-3.5 rounded border-border"
                />
                <span>{f.label}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Shared Email Provider Section ───────────────────────────────────────────

function EmailProviderSection() {
  const { data, isLoading } = useEmailProvider() as { data: Record<string, unknown> | undefined; isLoading: boolean };
  const updateProvider = useUpdateEmailProvider();

  const [provider, setProvider] = useState('smtp');
  const [fromName, setFromName] = useState('');
  const [fromEmail, setFromEmail] = useState('');
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [dirty, setDirty] = useState(false);

  // Track original redacted values to avoid sending them back
  const [originalConfig, setOriginalConfig] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (!data) return;
    const ep = (data as Record<string, unknown>).email_provider as Record<string, unknown> | undefined;
    if (ep) {
      setProvider((ep.provider as string) ?? 'smtp');
      setFromName((ep.from_name as string) ?? '');
      setFromEmail((ep.from_email as string) ?? '');
      const cfg = (ep.config as Record<string, unknown>) ?? {};
      setConfig(cfg);
      setOriginalConfig(cfg);
    }
  }, [data]);

  const handleSave = async () => {
    // Strip out any password fields that are still redacted (unchanged)
    const providerFields = EMAIL_PROVIDERS[provider]?.fields ?? [];
    let cleanConfig = { ...config };
    for (const f of providerFields) {
      if (f.type === 'password') {
        const val = getNestedValue(cleanConfig, f.key);
        const orig = getNestedValue(originalConfig, f.key);
        if (isRedacted(val) && isRedacted(orig)) {
          // Remove the field so backend keeps the existing value
          // For nested keys, we need to unset
          cleanConfig = setNestedValue(cleanConfig, f.key, undefined);
        }
      }
    }
    // Remove undefined leaves
    const pruneUndefined = (obj: Record<string, unknown>): Record<string, unknown> => {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (v === undefined) continue;
        if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
          const pruned = pruneUndefined(v as Record<string, unknown>);
          if (Object.keys(pruned).length > 0) result[k] = pruned;
        } else {
          result[k] = v;
        }
      }
      return result;
    };
    cleanConfig = pruneUndefined(cleanConfig);

    try {
      await updateProvider.mutateAsync({ provider, config: cleanConfig, from_name: fromName, from_email: fromEmail });
      setDirty(false);
      toast({ title: 'Email provider saved' });
    } catch (err: unknown) {
      toast({ title: 'Error', description: (err as Error).message ?? 'Failed to save.', variant: 'destructive' });
    }
  };

  const configured = !!(data as Record<string, unknown>)?.email_provider;
  const fields = EMAIL_PROVIDERS[provider]?.fields ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-blue-500/15 flex items-center justify-center">
          <Mail className="w-5 h-5 text-blue-500" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">Shared Email Provider</h3>
          <p className="text-xs text-muted-foreground">
            Fallback sender for customer emails when an actor mailbox is not available, plus sequence and system setup emails.
          </p>
        </div>
        <div className="ml-auto">
          {configured ? (
            <span className="flex items-center gap-1.5 text-xs text-emerald-500 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" /> Configured
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Not configured</span>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-4">Loading...</div>
      ) : (
        <div className="rounded-lg border border-border bg-card p-4 space-y-4">
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 text-sm">
            <p className="font-medium text-foreground">Actor mailboxes are preferred for customer outreach.</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              CRMy sends governed customer drafts from the actor's connected, send-enabled mailbox first. This shared provider is used when no actor mailbox sender is available, and for sequence or system-generated emails such as invites and password resets. Replies only become context when they arrive through a connected mailbox or inbound webhook.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Provider</label>
              <select
                value={provider}
                onChange={(e) => { setProvider(e.target.value); setConfig({}); setDirty(true); }}
                className={inputCls}
              >
                {Object.entries(EMAIL_PROVIDERS).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Shared From Name</label>
              <input
                type="text"
                value={fromName}
                placeholder="CRMy"
                onChange={(e) => { setFromName(e.target.value); setDirty(true); }}
                className={inputCls}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Shared From Email</label>
              <input
                type="email"
                value={fromEmail}
                placeholder="noreply@example.com"
                onChange={(e) => { setFromEmail(e.target.value); setDirty(true); }}
                className={inputCls}
              />
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Connection</p>
            <ConfigForm
              fields={fields}
              values={config}
              onChange={(v) => { setConfig(v); setDirty(true); }}
            />
          </div>

          <div className="flex justify-end pt-2">
            <button onClick={handleSave} disabled={updateProvider.isPending} className={btnPrimary}>
              {updateProvider.isPending ? 'Saving...' : 'Save Shared Provider'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Channel Row ─────────────────────────────────────────────────────────────

interface ChannelData {
  id: string;
  name: string;
  provider: string;
  config: Record<string, unknown>;
  is_active: boolean;
  is_default: boolean;
}

function ChannelRow({ channel, onDelete }: { channel: ChannelData; onDelete: () => void }) {
  const id = channel.id;
  const updateChannel = useUpdateMessagingChannel(id);
  const deleteChannel = useDeleteMessagingChannel(id);
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editConfig, setEditConfig] = useState<Record<string, unknown>>({});
  const [editName, setEditName] = useState('');

  const providerKey = channel.provider;
  const providerDef = CHANNEL_PROVIDERS[providerKey];
  const Icon = providerDef?.icon ?? MessageSquare;

  useEffect(() => {
    if (expanded) {
      setEditConfig(channel.config ?? {});
      setEditName(channel.name ?? '');
    }
  }, [expanded, channel]);

  const handleToggleActive = async () => {
    try {
      await updateChannel.mutateAsync({ is_active: !channel.is_active });
    } catch {
      toast({ title: 'Error', description: 'Failed to update channel.', variant: 'destructive' });
    }
  };

  const handleToggleDefault = async () => {
    try {
      await updateChannel.mutateAsync({ is_default: !channel.is_default });
    } catch {
      toast({ title: 'Error', description: 'Failed to update channel.', variant: 'destructive' });
    }
  };

  const handleSave = async () => {
    try {
      await updateChannel.mutateAsync({ name: editName, config: editConfig });
      setExpanded(false);
      toast({ title: 'Channel updated' });
    } catch {
      toast({ title: 'Error', description: 'Failed to update channel.', variant: 'destructive' });
    }
  };

  const handleDelete = async () => {
    try {
      await deleteChannel.mutateAsync();
      onDelete();
      toast({ title: 'Channel deleted' });
    } catch {
      toast({ title: 'Error', description: 'Failed to delete channel.', variant: 'destructive' });
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
          <Icon className="w-4 h-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground truncate">{channel.name}</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border uppercase">
              {providerDef?.label ?? providerKey}
            </span>
            {channel.is_default && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500 border border-amber-500/20 font-semibold">
                Default
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={handleToggleDefault} title={channel.is_default ? 'Remove as default' : 'Set as default'}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-amber-500 transition-colors">
            <Star className={`w-4 h-4 ${channel.is_default ? 'fill-amber-500 text-amber-500' : ''}`} />
          </button>
          <button onClick={handleToggleActive} title={channel.is_active ? 'Deactivate' : 'Activate'}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors">
            {channel.is_active
              ? <Power className="w-4 h-4 text-emerald-500" />
              : <PowerOff className="w-4 h-4 text-destructive" />
            }
          </button>
          <button onClick={() => setExpanded(!expanded)} title="Edit"
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <Pencil className="w-4 h-4" />
          </button>
          {!confirmDelete ? (
            <button onClick={() => setConfirmDelete(true)} title="Delete"
              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-destructive transition-colors">
              <Trash2 className="w-4 h-4" />
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <button onClick={handleDelete} className="text-xs font-semibold text-destructive hover:underline">Delete</button>
              <button onClick={() => setConfirmDelete(false)} className="p-1 text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 py-4 border-t border-border bg-muted/20 space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Channel Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className={inputCls}
                />
              </div>
              {providerDef && (
                <ConfigForm
                  fields={providerDef.fields}
                  values={editConfig}
                  onChange={setEditConfig}
                />
              )}
              <div className="flex justify-end gap-2">
                <button onClick={() => setExpanded(false)} className={btnOutline}>Cancel</button>
                <button onClick={handleSave} disabled={updateChannel.isPending} className={btnPrimary}>
                  {updateChannel.isPending ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Messaging Channels Section ──────────────────────────────────────────────

function MessagingChannelsSection() {
  const { data, isLoading } = useMessagingChannels() as { data: { data: ChannelData[] } | undefined; isLoading: boolean };
  const createChannel = useCreateMessagingChannel();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newProvider, setNewProvider] = useState('slack');
  const [newConfig, setNewConfig] = useState<Record<string, unknown>>({});
  const [newDefault, setNewDefault] = useState(false);

  const channels = data?.data ?? [];

  const handleCreate = async () => {
    try {
      await createChannel.mutateAsync({
        name: newName,
        provider: newProvider,
        config: newConfig,
        is_default: newDefault,
      });
      setShowCreate(false);
      setNewName('');
      setNewConfig({});
      setNewDefault(false);
      toast({ title: 'Channel created' });
    } catch (err: unknown) {
      toast({ title: 'Error', description: (err as Error).message ?? 'Failed to create channel.', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-purple-500/15 flex items-center justify-center">
          <Send className="w-5 h-5 text-purple-500" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-foreground">Notification Channels</h3>
          <p className="text-xs text-muted-foreground">Configure Slack, Teams, or other notification channels for workflows and alerts.</p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className={`${btnOutline} flex items-center gap-1.5`}
        >
          {showCreate ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showCreate ? 'Cancel' : 'Add Channel'}
        </button>
      </div>

      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-lg border border-primary/30 bg-card p-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Provider</label>
                  <select
                    value={newProvider}
                    onChange={(e) => { setNewProvider(e.target.value); setNewConfig({}); }}
                    className={inputCls}
                  >
                    {Object.entries(CHANNEL_PROVIDERS).map(([k, v]) => (
                      <option key={k} value={k}>{v.label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Channel Name</label>
                  <input
                    type="text"
                    value={newName}
                    placeholder="e.g. Slack - Sales Alerts"
                    onChange={(e) => setNewName(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer h-9">
                    <input
                      type="checkbox"
                      checked={newDefault}
                      onChange={(e) => setNewDefault(e.target.checked)}
                      className="rounded border-border"
                    />
                    <span className="text-sm text-foreground">Set as default</span>
                  </label>
                </div>
              </div>

              {CHANNEL_PROVIDERS[newProvider] && (
                <ConfigForm
                  fields={CHANNEL_PROVIDERS[newProvider].fields}
                  values={newConfig}
                  onChange={setNewConfig}
                />
              )}

              <div className="flex justify-end gap-2">
                <button onClick={() => setShowCreate(false)} className={btnOutline}>Cancel</button>
                <button
                  onClick={handleCreate}
                  disabled={createChannel.isPending || !newName.trim()}
                  className={btnPrimary}
                >
                  {createChannel.isPending ? 'Creating...' : 'Create Channel'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-4">Loading...</div>
      ) : channels.length === 0 && !showCreate ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <MessageSquare className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-sm font-semibold text-foreground mb-1">No channels configured</p>
          <p className="text-xs text-muted-foreground">Add a Slack or other notification channel to enable workflow notifications.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {channels.map((ch) => (
            <ChannelRow key={ch.id} channel={ch} onDelete={() => {}} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Email & Activity Source Filters ────────────────────────────────────────

function SourceFiltersSection() {
  const { data, isLoading } = useSourceFilters() as { data: { source_filters?: Record<string, unknown> } | undefined; isLoading: boolean };
  const update = useUpdateSourceFilters();
  const filters = data?.source_filters ?? {};
  const [internalDomains, setInternalDomains] = useState('');
  const [excludedDomains, setExcludedDomains] = useState('');
  const [excludedSenders, setExcludedSenders] = useState('');
  const [excludedLocalParts, setExcludedLocalParts] = useState('');
  const [excludedLabels, setExcludedLabels] = useState('');
  const [includeInternalCalendar, setIncludeInternalCalendar] = useState(false);

  useEffect(() => {
    setInternalDomains(listToCsv(filters.internal_domains));
    setExcludedDomains(listToCsv(filters.excluded_domains));
    setExcludedSenders(listToCsv(filters.excluded_senders));
    setExcludedLocalParts(listToCsv(filters.excluded_local_parts));
    setExcludedLabels(listToCsv(filters.excluded_mailbox_labels));
    setIncludeInternalCalendar(filters.include_internal_calendar === true);
  }, [filters]);

  const save = async () => {
    try {
      await update.mutateAsync({
        internal_domains: csvToList(internalDomains),
        excluded_domains: csvToList(excludedDomains),
        excluded_senders: csvToList(excludedSenders),
        excluded_local_parts: csvToList(excludedLocalParts),
        excluded_mailbox_labels: csvToList(excludedLabels),
        skip_spam_trash: true,
        skip_promotions: true,
        skip_newsletters: true,
        include_internal_calendar: includeInternalCalendar,
      });
      toast({ title: 'Source filters saved', description: 'CRMy will apply these filters before storing mailbox or calendar context.' });
    } catch (err) {
      toast({ title: 'Could not save source filters', description: err instanceof Error ? err.message : 'Try again.', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-blue-500/15 flex items-center justify-center">
          <SlidersHorizontal className="w-5 h-5 text-blue-500" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">Email & Activity Source Filters</h3>
          <p className="text-xs text-muted-foreground">Control what mailbox and calendar data CRMy is allowed to read before it becomes customer context.</p>
        </div>
      </div>
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/8 p-3">
          <p className="text-sm font-medium text-foreground">Default behavior</p>
          <p className="mt-1 text-xs text-muted-foreground">
            CRMy syncs customer-facing email and meetings, filters internal-only conversations, skips spam/trash/newsletters, and sends ambiguous customer items to review.
          </p>
        </div>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading source filters...</div>
        ) : (
          <div className="grid gap-3">
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Internal domains</span>
              <input value={internalDomains} onChange={(e) => setInternalDomains(e.target.value)} className={inputCls} placeholder="yourcompany.com, subsidiary.com" />
              <span className="text-xs text-muted-foreground">Internal-only email and meetings are ignored by default.</span>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Excluded domains</span>
              <input value={excludedDomains} onChange={(e) => setExcludedDomains(e.target.value)} className={inputCls} placeholder="vendor.com, alerts.example.com" />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Excluded senders</span>
              <input value={excludedSenders} onChange={(e) => setExcludedSenders(e.target.value)} className={inputCls} placeholder="alerts@example.com, bot@example.com" />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Automated sender names</span>
              <input value={excludedLocalParts} onChange={(e) => setExcludedLocalParts(e.target.value)} className={inputCls} placeholder="no-reply, notifications, postmaster" />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Mailbox labels/folders to exclude</span>
              <input value={excludedLabels} onChange={(e) => setExcludedLabels(e.target.value)} className={inputCls} placeholder="spam, trash, promotions" />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={includeInternalCalendar} onChange={(e) => setIncludeInternalCalendar(e.target.checked)} className="rounded border-border" />
              <span className="text-sm text-foreground">Allow internal-only calendar events to be stored for review</span>
            </label>
            <div className="flex justify-end">
              <button onClick={save} disabled={update.isPending} className={btnPrimary}>
                {update.isPending ? 'Saving...' : 'Save source filters'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Inbound Email Section ───────────────────────────────────────────────────

function InboundEmailSection() {
  const { data, isLoading } = useInboundEmailConfig();
  const generate = useGenerateInboundSecret();
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const inboundData = data as { configured?: boolean; inbound_enabled?: boolean; has_secret?: boolean } | undefined;
  const webhookUrl = `${window.location.origin}/api/v1/email/inbound`;

  const handleGenerate = async () => {
    try {
      const result = await generate.mutateAsync() as { secret: string };
      setNewSecret(result.secret);
    } catch (err: unknown) {
      toast({ title: 'Error', description: (err as Error).message ?? 'Failed to generate secret.', variant: 'destructive' });
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-violet-500/15 flex items-center justify-center">
          <Download className="w-5 h-5 text-violet-500" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">Inbound Email Webhook</h3>
          <p className="text-xs text-muted-foreground">Receive prospect replies automatically via your email provider's inbound parse webhook.</p>
        </div>
        <div className="ml-auto">
          {inboundData?.inbound_enabled ? (
            <span className="flex items-center gap-1.5 text-xs text-emerald-500 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" /> Active
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Not configured</span>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-4">Loading...</div>
      ) : (
        <div className="rounded-lg border border-border bg-card p-4 space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Webhook Endpoint</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-muted/50 border border-border rounded px-3 py-2 font-mono text-foreground truncate">
                {webhookUrl}
              </code>
              <button
                onClick={() => handleCopy(webhookUrl)}
                className="flex-shrink-0 flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-border bg-background hover:bg-muted text-foreground transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">Configure this URL as the inbound parse webhook in SendGrid, Postmark, or Mailgun.</p>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">HMAC Signing Secret</label>
            {newSecret ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-yellow-500/10 border border-yellow-500/30 rounded px-3 py-2 font-mono text-foreground truncate">
                    {newSecret}
                  </code>
                  <button
                    onClick={() => handleCopy(newSecret)}
                    className="flex-shrink-0 flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-border bg-background hover:bg-muted text-foreground transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Copy
                  </button>
                </div>
                <p className="text-xs text-yellow-600 dark:text-yellow-400 font-medium">Copy this secret now — it won't be shown again.</p>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  {inboundData?.has_secret ? '••••••••••••••••' : 'No secret configured'}
                </span>
                <button
                  onClick={handleGenerate}
                  disabled={generate.isPending}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-muted text-foreground transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${generate.isPending ? 'animate-spin' : ''}`} />
                  {inboundData?.has_secret ? 'Rotate Secret' : 'Generate Secret'}
                </button>
              </div>
            )}
            <p className="text-xs text-muted-foreground">Optional but recommended. Set as the HMAC signature secret in your email provider.</p>
          </div>

          <div className="border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">
              <strong className="text-foreground">Supported providers:</strong> SendGrid Inbound Parse, Postmark Inbound, Mailgun Routes.
              Inbound emails are automatically parsed, linked to matching contacts, and queued for context extraction.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function envList(groups: OAuthReadinessItem['accepted_env_vars']): string[] {
  return [...groups.client_id, ...groups.client_secret, ...groups.redirect_uri];
}

type OAuthProvider = 'google' | 'microsoft';

const OAUTH_PROVIDER_META: Record<OAuthProvider, {
  label: string;
  setupUrl: string;
  setupLabel: string;
}> = {
  google: {
    label: 'Google Workspace',
    setupUrl: 'https://console.cloud.google.com/apis/credentials',
    setupLabel: 'Google Cloud',
  },
  microsoft: {
    label: 'Microsoft 365',
    setupUrl: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
    setupLabel: 'Microsoft Entra',
  },
};

function readinessTone(ready: boolean) {
  return ready
    ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
    : 'border-amber-500/25 bg-amber-500/10 text-amber-200';
}

function oauthSourceLabel(source?: OAuthReadinessItem['app_source']) {
  switch (source) {
    case 'tenant_owned': return 'Tenant-owned app';
    case 'crmy_managed': return 'CRMy-managed app';
    case 'self_hosted_env': return 'Self-hosted env app';
    default: return 'Setup required';
  }
}

function OAuthPreflightPanel({
  items,
  providerLabel,
}: {
  items: OAuthReadinessItem[];
  providerLabel: string;
}) {
  const readyCount = items.filter(item => item.ready).length;
  const allReady = items.length > 0 && readyCount === items.length;
  const activeSource = items.find(item => item.ready)?.app_source ?? items[0]?.app_source ?? 'missing';
  const blockers = Array.from(new Set(items.flatMap(item => item.setup_blockers ?? [])));
  const statusText = allReady
    ? 'Ready for first user connection'
    : readyCount > 0
      ? `${readyCount} of ${items.length} capabilities ready`
      : 'Setup needed before users connect';

  return (
    <div className={`rounded-xl border p-4 shadow-sm ${allReady ? 'border-emerald-500/25 bg-emerald-500/8' : 'border-amber-500/25 bg-amber-500/8'}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${readinessTone(allReady)}`}>
              {statusText}
            </span>
            <span className="rounded-full border border-border bg-background px-2 py-0.5 text-xs font-semibold text-muted-foreground">
              Active source: {oauthSourceLabel(activeSource)}
            </span>
          </div>
          <h3 className="mt-2 text-sm font-semibold text-foreground">{providerLabel} connection preflight</h3>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Verify this before asking the first actor to connect. Once ready, users connect mailbox from Customer Email and calendar from Customer Activity.
          </p>
        </div>
        <div className="grid gap-2 text-xs sm:grid-cols-2 lg:min-w-80">
          {items.map(item => (
            <div key={`${item.kind}-${item.provider}-preflight`} className="rounded-lg border border-border bg-card px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-foreground">{item.kind === 'mailbox' ? 'Mailbox + Sender' : 'Calendar Context'}</span>
                <span className={item.ready ? 'text-emerald-300' : 'text-amber-200'}>{item.ready ? 'Ready' : 'Needs setup'}</span>
              </div>
              <p className="mt-1 line-clamp-2 text-muted-foreground">{item.ready ? item.user_action : item.admin_action}</p>
            </div>
          ))}
        </div>
      </div>

      {!allReady && blockers.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-500/25 bg-background/70 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-200">
            <AlertCircle className="h-3.5 w-3.5" /> Fix before first actor connection
          </p>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {blockers.map(blocker => <li key={blocker}>{blocker}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function TenantOAuthAppCard({
  provider,
  providerLabel,
  app,
  items,
}: {
  provider: OAuthProvider;
  providerLabel: string;
  app?: TenantOAuthApp;
  items: OAuthReadinessItem[];
}) {
  const upsert = useUpsertTenantOAuthApp();
  const reset = useDeleteTenantOAuthApp();
  const activeSource = items.find(item => item.ready)?.app_source ?? items[0]?.app_source ?? 'missing';
  const managedAvailable = items.some(item => item.crmy_managed_available);
  const selfHostedReady = items.some(item => item.self_hosted_env_configured);
  const hostedManagedEnabled = items.some(item => item.hosted_managed_enabled);
  const [clientId, setClientId] = useState(app?.client_id ?? '');
  const [clientSecret, setClientSecret] = useState('');
  const [microsoftTenantId, setMicrosoftTenantId] = useState(app?.microsoft_tenant_id ?? 'common');

  useEffect(() => {
    setClientId(app?.client_id ?? '');
    setClientSecret('');
    setMicrosoftTenantId(app?.microsoft_tenant_id ?? 'common');
  }, [app?.client_id, app?.microsoft_tenant_id, provider]);

  const save = async () => {
    try {
      await upsert.mutateAsync({
        provider,
        data: {
          client_id: clientId.trim(),
          client_secret: clientSecret.trim() || undefined,
          microsoft_tenant_id: provider === 'microsoft' ? microsoftTenantId.trim() || 'common' : undefined,
          enabled: true,
        },
      });
      toast({ title: 'Tenant-owned OAuth app saved', description: `${providerLabel} connections will use this app after users reconnect.` });
      setClientSecret('');
    } catch (err) {
      toast({
        title: 'Could not save OAuth app',
        description: err instanceof Error ? err.message : 'Check the client ID and secret, then try again.',
        variant: 'destructive',
      });
    }
  };

  const clear = async () => {
    try {
      await reset.mutateAsync(provider);
      toast({ title: 'Tenant-owned OAuth app removed', description: managedAvailable ? 'CRMy-managed OAuth is active again.' : 'Self-hosted env credentials will be used if configured.' });
    } catch (err) {
      toast({
        title: 'Could not remove OAuth app',
        description: err instanceof Error ? err.message : 'Refresh and try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">Enterprise App Credentials</h3>
            <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${readinessTone(activeSource !== 'missing')}`}>
              {oauthSourceLabel(activeSource)}
            </span>
            {app?.has_client_secret && (
              <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">Secret saved</span>
            )}
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Use this only if your tenant requires its own consent screen, publisher identity, security review, or domain app restrictions.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold lg:justify-end">
          <span className={`rounded-full border px-2 py-0.5 ${managedAvailable ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : 'border-border bg-background text-muted-foreground'}`}>
            CRMy-managed {managedAvailable ? 'available' : hostedManagedEnabled ? 'not configured' : 'off'}
          </span>
          <span className={`rounded-full border px-2 py-0.5 ${selfHostedReady ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : 'border-border bg-background text-muted-foreground'}`}>
            Self-hosted env {selfHostedReady ? 'ready' : 'not set'}
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Client ID</label>
            <input
              value={clientId}
              onChange={event => setClientId(event.target.value)}
              placeholder={provider === 'google' ? 'Google OAuth client ID' : 'Microsoft application client ID'}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Client Secret</label>
              {app?.has_client_secret && <span className="text-[11px] font-medium text-muted-foreground">Leave blank to keep current</span>}
            </div>
            <input
              type="password"
              value={clientSecret}
              onChange={event => setClientSecret(event.target.value)}
              placeholder={app?.has_client_secret ? 'Existing secret saved' : 'OAuth client secret'}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          {provider === 'microsoft' && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Microsoft tenant</label>
              <input
                value={microsoftTenantId}
                onChange={event => setMicrosoftTenantId(event.target.value)}
                placeholder="common or tenant id"
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <button
              type="button"
              onClick={save}
              disabled={!clientId.trim() || (!app?.has_client_secret && !clientSecret.trim()) || upsert.isPending}
              className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {upsert.isPending ? 'Saving...' : 'Save enterprise app'}
            </button>
            {app?.has_client_secret && (
              <button
                type="button"
                onClick={clear}
                disabled={reset.isPending}
                className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                {reset.isPending ? 'Removing...' : 'Use CRMy-managed app'}
              </button>
            )}
          </div>
      </div>
    </div>
  );
}

function OAuthRedirectUrisPanel({
  items,
  providerLabel,
  setupUrl,
  setupLabel,
}: {
  items: OAuthReadinessItem[];
  providerLabel: string;
  setupUrl: string;
  setupLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copy = (value: string) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setCopiedKey(value);
      setTimeout(() => setCopied(false), 1500);
      setTimeout(() => setCopiedKey(null), 1500);
    });
  };

  return (
    <div className="rounded-xl border border-primary/25 bg-primary/5 p-4 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Redirect URI</p>
          <h3 className="mt-1 text-sm font-semibold text-foreground">Paste these into {setupLabel}</h3>
          <div className="mt-3 space-y-2">
            {items.map(item => {
              const label = item.kind === 'mailbox' ? 'Mailbox + Sender' : 'Calendar Context';
              return (
                <div key={`${item.kind}-${item.provider}-redirect`} className="rounded-lg border border-border bg-background p-2.5">
                  <div className="mb-1 flex items-center gap-2">
                    {item.kind === 'calendar' ? <CalendarClock className="h-3.5 w-3.5 text-primary" /> : <Mail className="h-3.5 w-3.5 text-primary" />}
                    <span className="text-xs font-semibold text-foreground">{label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-card px-2 py-2 text-xs text-foreground">
                      {item.redirect_uri}
                    </code>
                    <button
                      type="button"
                      onClick={() => copy(item.redirect_uri)}
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs font-semibold text-foreground hover:bg-muted"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {copied && copiedKey === item.redirect_uri ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-3 lg:w-80">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">How to configure in {setupLabel}</p>
          <ol className="mt-2 space-y-1.5 text-xs text-muted-foreground">
            <li><span className="font-semibold text-foreground">1.</span> Create a {providerLabel} OAuth app.</li>
            <li><span className="font-semibold text-foreground">2.</span> Paste the redirect URI values shown here.</li>
            <li><span className="font-semibold text-foreground">3.</span> Add the client ID and secret below when using an enterprise app.</li>
            <li><span className="font-semibold text-foreground">4.</span> Save, then users connect from Email or Activity.</li>
          </ol>
          <a href={setupUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
            Open {setupLabel} <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </div>
  );
}

function OAuthCapabilityCard({ item }: { item: OAuthReadinessItem }) {
  const configured = item.ready;
  const title = item.kind === 'mailbox' ? 'Mailbox + Sender Identity' : 'Calendar Context';
  const destination = item.kind === 'mailbox' ? 'Customer Email -> Mailboxes & Senders' : 'Customer Activity -> Meeting Sources';
  const description = item.kind === 'mailbox'
    ? 'Users connect their work mailbox for customer email context, approved sends, and provider drafts when authorized.'
    : 'Users connect their work calendar so customer meetings can become activity context.';
  const setupReason = item.setup_blockers?.[0] ?? (item.app_source === 'missing'
    ? 'No OAuth app source is ready for this capability yet.'
    : `${oauthSourceLabel(item.app_source)} is selected, but this capability still needs setup.`);

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-lg bg-primary/10 p-1.5 text-primary">
              {item.kind === 'calendar' ? <CalendarClock className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
            </span>
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${readinessTone(configured)}`}>
              {configured ? 'Ready for users' : 'Missing setup'}
            </span>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
          <p className="text-xs text-muted-foreground">User-facing destination: <span className="font-medium text-foreground">{destination}</span></p>
        </div>
      </div>

      {!configured && (
        <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/8 p-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <AlertCircle className="h-4 w-4 text-amber-300" /> Setup needed before users can connect
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{setupReason}</p>
          {item.admin_action && <p className="mt-1 text-xs text-muted-foreground">{item.admin_action}</p>}
        </div>
      )}

      <details className="mt-3 rounded-lg border border-border bg-muted/20">
        <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-foreground">Advanced details</summary>
        <div className="space-y-3 border-t border-border px-3 py-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Environment variables</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {envList(item.accepted_env_vars).map(name => (
                <code key={`${item.kind}-${item.provider}-${name}`} className={`rounded border px-1.5 py-0.5 text-[11px] ${
                  item.configured_env_vars.includes(name) ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : 'border-border bg-background text-muted-foreground'
                }`}>
                  {name}
                </code>
              ))}
            </div>
            {!configured && item.missing_env_vars.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">Missing: {item.missing_env_vars.join(', ')}</p>
            )}
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Scopes requested</p>
            <div className="mt-1 space-y-1 text-xs text-muted-foreground">
              <p><span className="text-foreground">Context:</span> {item.scopes.context.join(', ')}</p>
              {item.scopes.send && <p><span className="text-foreground">Send:</span> {item.scopes.send.join(', ')}</p>}
              {item.scopes.drafts && <p><span className="text-foreground">Drafts:</span> {item.scopes.drafts.join(', ')}</p>}
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}

function GoogleOutlookOAuthSection() {
  const readinessQ = useOAuthReadiness();
  const tenantAppsQ = useTenantOAuthApps();
  const [selectedProvider, setSelectedProvider] = useState<OAuthProvider>('google');
  const readiness = readinessQ.data?.data ?? [];
  const tenantApps = tenantAppsQ.data?.data ?? [];
  const readinessByProvider = useMemo(() => ({
    google: readiness.filter(item => item.provider === 'google'),
    microsoft: readiness.filter(item => item.provider === 'microsoft'),
  }), [readiness]);
  const tenantAppByProvider = useMemo(() => ({
    google: tenantApps.find(app => app.provider === 'google'),
    microsoft: tenantApps.find(app => app.provider === 'microsoft'),
  }), [tenantApps]);
  const selectedItems = readinessByProvider[selectedProvider];
  const selectedMeta = OAUTH_PROVIDER_META[selectedProvider];
  const selectedReady = selectedItems.length > 0 && selectedItems.every(item => item.ready);
  const googleReady = readinessByProvider.google.some(item => item.ready);
  const microsoftReady = readinessByProvider.microsoft.some(item => item.ready);

  useEffect(() => {
    if (!readiness.length) return;
    if (!googleReady && microsoftReady) setSelectedProvider('microsoft');
  }, [googleReady, microsoftReady, readiness.length]);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/15 p-2">
              <KeyRound className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">{selectedMeta.label} OAuth setup</h3>
                {!readinessQ.isLoading && (
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${readinessTone(selectedReady)}`}>
                    {selectedReady ? 'Ready for users' : 'Setup required'}
                  </span>
                )}
              </div>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Prepare OAuth once. Hosted tenants can use CRMy-managed OAuth by default; self-hosted installs use environment credentials; enterprise tenants can bring their own provider app.
              </p>
            </div>
          </div>
          <div className="inline-flex w-full rounded-lg border border-border bg-background p-1 lg:w-auto">
            {(Object.keys(OAUTH_PROVIDER_META) as OAuthProvider[]).map(provider => (
              <button
                key={provider}
                type="button"
                onClick={() => setSelectedProvider(provider)}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors lg:flex-none ${
                  selectedProvider === provider
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {OAUTH_PROVIDER_META[provider].label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {readinessQ.isLoading || tenantAppsQ.isLoading ? (
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">Checking OAuth readiness...</div>
      ) : readinessQ.isError || tenantAppsQ.isError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">Could not load OAuth readiness</p>
              <p className="mt-1 text-xs text-muted-foreground">Retry after confirming your admin session is still active.</p>
            </div>
            <button
              type="button"
              onClick={() => { readinessQ.refetch(); tenantAppsQ.refetch(); }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {selectedItems.length > 0 ? (
            <>
              <OAuthPreflightPanel
                items={selectedItems}
                providerLabel={selectedMeta.label}
              />
              <OAuthRedirectUrisPanel
                items={selectedItems}
                providerLabel={selectedMeta.label}
                setupUrl={selectedMeta.setupUrl}
                setupLabel={selectedMeta.setupLabel}
              />
              <TenantOAuthAppCard
                provider={selectedProvider}
                providerLabel={selectedMeta.label}
                app={tenantAppByProvider[selectedProvider]}
                items={selectedItems}
              />
              {selectedItems.map(item => (
                <OAuthCapabilityCard
                  key={`${item.kind}-${item.provider}`}
                  item={item}
                />
              ))}
            </>
          ) : (
            <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
              OAuth readiness is not available for {selectedMeta.label}. Refresh or check the server logs.
            </div>
          )}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-400" />
          <div>
            <h3 className="text-sm font-semibold text-foreground">Shared Sender stays separate</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              The Shared Sender tab is for fallback, sequence, invite, password reset, and system delivery. User mailbox senders are configured by each actor from Customer Email after OAuth is ready.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

type MessagingTab = 'email-provider' | 'oauth' | 'source-filters' | 'inbound-email' | 'notifications';

function parseMessagingTab(value: string | null): MessagingTab | null {
  if (value === 'oauth' || value === 'email-provider' || value === 'source-filters' || value === 'inbound-email' || value === 'notifications') {
    return value;
  }
  return null;
}

export default function MessagingSettings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<MessagingTab>(() => parseMessagingTab(searchParams.get('tab')) ?? 'oauth');
  useEffect(() => {
    const next = parseMessagingTab(searchParams.get('tab'));
    if (next && next !== activeTab) setActiveTab(next);
  }, [activeTab, searchParams]);
  const selectTab = (tab: MessagingTab) => {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    if (tab === 'oauth') next.delete('tab');
    else next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };
  const tabs: { key: MessagingTab; label: string; description: string; Icon: React.ElementType }[] = [
    {
      key: 'oauth',
      label: 'OAuth',
      description: 'Prepare mailbox and calendar OAuth for users.',
      Icon: KeyRound,
    },
    {
      key: 'email-provider',
      label: 'Shared Sender',
      description: 'Fallback and system email delivery.',
      Icon: Mail,
    },
    {
      key: 'source-filters',
      label: 'Source Filters',
      description: 'Control what email and activity data CRMy can read.',
      Icon: SlidersHorizontal,
    },
    {
      key: 'notifications',
      label: 'Notifications',
      description: 'Route workflow and alert messages to channels like Slack.',
      Icon: MessageSquare,
    },
    {
      key: 'inbound-email',
      label: 'Inbound Webhook',
      description: 'Receive customer replies from inbound parse providers.',
      Icon: Download,
    },
  ];

  return (
    <div className="w-full space-y-5">
      <div>
        <h2 className="font-display font-bold text-lg text-foreground mb-1">Context Connectors</h2>
        <p className="text-sm text-muted-foreground">Configure provider OAuth, fallback sending, inbound email, source filters, and operational notifications.</p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border">
        {tabs.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => selectTab(key)}
            className={`inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
              activeTab === key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      <section className="space-y-4">
        {activeTab === 'email-provider' && <EmailProviderSection />}
        {activeTab === 'oauth' && <GoogleOutlookOAuthSection />}
        {activeTab === 'source-filters' && <SourceFiltersSection />}
        {activeTab === 'inbound-email' && <InboundEmailSection />}
        {activeTab === 'notifications' && <MessagingChannelsSection />}
      </section>
    </div>
  );
}
