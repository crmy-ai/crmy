// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from '@/hooks/use-toast';
import {
  useEmailProvider, useUpdateEmailProvider,
  useMessagingChannels, useCreateMessagingChannel,
  useUpdateMessagingChannel, useDeleteMessagingChannel,
  useInboundEmailConfig, useGenerateInboundSecret,
} from '@/api/hooks';
import {
  Mail, MessageSquare, Plus, Trash2, Pencil,
  Power, PowerOff, Star, Eye, EyeOff, X, Send, CheckCircle2, Download, RefreshCw, Copy,
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

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {fields.map((f) => {
        const val = getNestedValue(values, f.key);
        if (f.type === 'boolean') {
          return (
            <label key={f.key} className="flex items-center gap-2 col-span-1 cursor-pointer">
              <input
                type="checkbox"
                checked={!!val}
                onChange={(e) => onChange(setNestedValue(values, f.key, e.target.checked))}
                className="rounded border-border"
              />
              <span className="text-sm text-foreground">{f.label}</span>
            </label>
          );
        }
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
  );
}

// ─── Email Provider Section ──────────────────────────────────────────────────

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
          <h3 className="text-sm font-semibold text-foreground">Email Provider</h3>
          <p className="text-xs text-muted-foreground">Configure outbound email delivery for CRM emails and sequences.</p>
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
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">From Name</label>
              <input
                type="text"
                value={fromName}
                placeholder="CRMy"
                onChange={(e) => { setFromName(e.target.value); setDirty(true); }}
                className={inputCls}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">From Email</label>
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
              {updateProvider.isPending ? 'Saving...' : 'Save Email Provider'}
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

// ─── Main Component ──────────────────────────────────────────────────────────

export default function MessagingSettings() {
  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h2 className="font-display font-bold text-lg text-foreground mb-1">Messaging</h2>
        <p className="text-sm text-muted-foreground">Configure email delivery and notification channels for your CRM.</p>
      </div>

      <EmailProviderSection />

      <div className="border-t border-border" />

      <InboundEmailSection />

      <div className="border-t border-border" />

      <MessagingChannelsSection />
    </div>
  );
}
