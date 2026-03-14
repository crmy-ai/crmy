// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { TopBar } from '@/components/layout/TopBar';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { CircleUser, Lock, Link2, ListFilter, Copy, Trash2, Plus, Palette } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useAppStore } from '@/store/appStore';
import { useApiKeys, useCreateApiKey, useRevokeApiKey, useWebhooks, useCreateWebhook, useDeleteWebhook, useCustomFields, useCreateCustomField, useDeleteCustomField } from '@/api/hooks';

const settingsNav = [
  { icon: CircleUser, label: 'Profile', path: '/settings' },
  { icon: Palette, label: 'Appearance', path: '/settings/appearance' },
  { icon: Lock, label: 'API Keys', path: '/settings/api-keys' },
  { icon: Link2, label: 'Webhooks', path: '/settings/webhooks' },
  { icon: ListFilter, label: 'Custom Fields', path: '/settings/custom-fields' },
];

function ProfileSettings() {
  return (
    <div>
      <h2 className="font-display font-bold text-lg text-foreground mb-6">Profile</h2>
      <div className="space-y-5 max-w-md">
        {[
          { label: 'Name', value: 'Admin' },
          { label: 'Role', value: 'Admin' },
        ].map((field) => (
          <div key={field.label} className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{field.label}</label>
            <div className="h-10 px-3 flex items-center rounded-lg border border-border bg-muted/50 text-sm text-foreground">
              {field.value}
            </div>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">Profile details are managed by your organization administrator.</p>
      </div>
    </div>
  );
}

function AppearanceSettings() {
  const { darkVariant, setDarkVariant } = useAppStore();
  const variants: { key: 'warm' | 'charcoal'; label: string; description: string; preview: string }[] = [
    { key: 'warm', label: 'Warm Brown', description: 'Dark theme with warm, earthy brown tones', preview: 'bg-[hsl(15,25%,7%)]' },
    { key: 'charcoal', label: 'Charcoal', description: 'Dark theme with cool, navy-charcoal tones', preview: 'bg-[hsl(220,16%,8%)]' },
  ];
  return (
    <div>
      <h2 className="font-display font-bold text-lg text-foreground mb-2">Appearance</h2>
      <p className="text-sm text-muted-foreground mb-6">Choose your preferred dark mode style.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md">
        {variants.map((v) => (
          <button key={v.key} onClick={() => setDarkVariant(v.key)}
            className={`flex flex-col gap-3 p-4 rounded-xl border-2 transition-all text-left ${darkVariant === v.key ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/30'}`}>
            <div className={`w-full h-16 rounded-lg ${v.preview} border border-border/30 flex items-end p-2`}>
              <div className="flex gap-1">
                <div className="w-6 h-2 rounded-full bg-[hsl(24,95%,53%)]" />
                <div className="w-4 h-2 rounded-full bg-white/20" />
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">{v.label}</p>
              <p className="text-xs text-muted-foreground">{v.description}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function ApiKeysSettings() {
  const { data, isLoading } = useApiKeys();
  const createKey = useCreateApiKey();
  const revokeKey = useRevokeApiKey();
  const [newKeyName, setNewKeyName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  const keys = (data as any)?.data ?? [];

  const handleCreate = async () => {
    if (!newKeyName.trim()) return;
    try {
      const result = await createKey.mutateAsync({ label: newKeyName.trim(), scopes: ['read', 'write'] });
      setRevealedKey((result as any).key ?? null);
      setNewKeyName('');
      setShowCreate(false);
      toast({ title: 'API key created', description: 'Copy and store it safely — it won\'t be shown again.' });
    } catch {
      toast({ title: 'Error', description: 'Failed to create API key.', variant: 'destructive' });
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      await revokeKey.mutateAsync(id);
      toast({ title: 'API key revoked' });
    } catch {
      toast({ title: 'Error', description: 'Failed to revoke key.', variant: 'destructive' });
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display font-bold text-lg text-foreground">API Keys</h2>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors">
          <Plus className="w-3.5 h-3.5" /> New Key
        </button>
      </div>

      {revealedKey && (
        <div className="mb-4 p-4 rounded-xl border border-success/30 bg-success/5">
          <p className="text-xs font-semibold text-success mb-2">Your new API key (copy it now — it won't be shown again):</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono bg-background rounded px-2 py-1.5 border border-border truncate">{revealedKey}</code>
            <button onClick={() => { navigator.clipboard.writeText(revealedKey); toast({ title: 'Copied!' }); }}
              className="p-1.5 rounded-lg hover:bg-muted transition-colors flex-shrink-0">
              <Copy className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>
          <button onClick={() => setRevealedKey(null)} className="mt-2 text-xs text-muted-foreground hover:text-foreground">Dismiss</button>
        </div>
      )}

      {showCreate && (
        <div className="mb-4 p-4 rounded-xl border border-border bg-muted/30 flex items-center gap-2 max-w-md">
          <input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="Key name (e.g. Production)"
            className="flex-1 h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()} />
          <button onClick={handleCreate} disabled={!newKeyName.trim() || createKey.isPending}
            className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors">
            Create
          </button>
          <button onClick={() => { setShowCreate(false); setNewKeyName(''); }} className="px-3 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-semibold">Cancel</button>
        </div>
      )}

      <div className="space-y-2 max-w-2xl">
        {isLoading ? (
          <div className="space-y-2">{[...Array(2)].map((_, i) => <div key={i} className="h-14 bg-muted/50 rounded-xl animate-pulse" />)}</div>
        ) : keys.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No API keys yet.</p>
        ) : keys.map((k: any) => (
          <div key={k.id} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">{k.label ?? k.name}</p>
              <p className="text-xs text-muted-foreground font-mono">{k.prefix ?? k.id.slice(0, 12) + '...'}</p>
            </div>
            <span className="text-xs text-muted-foreground hidden sm:block">
              {k.created_at ? new Date(k.created_at).toLocaleDateString() : k.createdAt}
            </span>
            <button onClick={() => handleRevoke(k.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function WebhooksSettings() {
  const { data, isLoading } = useWebhooks();
  const createWebhook = useCreateWebhook();
  const deleteWebhook = useDeleteWebhook();
  const [showCreate, setShowCreate] = useState(false);
  const [newUrl, setNewUrl] = useState('');

  const webhooks = (data as any)?.data ?? [];

  const handleCreate = async () => {
    if (!newUrl.trim()) return;
    try {
      await createWebhook.mutateAsync({ url: newUrl.trim(), events: ['contact.created', 'opportunity.updated'] });
      setNewUrl('');
      setShowCreate(false);
      toast({ title: 'Webhook created' });
    } catch {
      toast({ title: 'Error', description: 'Failed to create webhook.', variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteWebhook.mutateAsync(id);
      toast({ title: 'Webhook deleted' });
    } catch {
      toast({ title: 'Error', description: 'Failed to delete webhook.', variant: 'destructive' });
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display font-bold text-lg text-foreground">Webhooks</h2>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors">
          <Plus className="w-3.5 h-3.5" /> New Webhook
        </button>
      </div>

      {showCreate && (
        <div className="mb-4 p-4 rounded-xl border border-border bg-muted/30 flex items-center gap-2 max-w-lg">
          <input value={newUrl} onChange={(e) => setNewUrl(e.target.value)}
            placeholder="https://your-server.com/webhook"
            className="flex-1 h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()} />
          <button onClick={handleCreate} disabled={!newUrl.trim() || createWebhook.isPending}
            className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors">
            Create
          </button>
          <button onClick={() => { setShowCreate(false); setNewUrl(''); }} className="px-3 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-semibold">Cancel</button>
        </div>
      )}

      <div className="space-y-2 max-w-2xl">
        {isLoading ? (
          <div className="space-y-2">{[...Array(2)].map((_, i) => <div key={i} className="h-14 bg-muted/50 rounded-xl animate-pulse" />)}</div>
        ) : webhooks.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No webhooks configured.</p>
        ) : webhooks.map((wh: any) => (
          <div key={wh.id} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">{wh.url}</p>
              {wh.events && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {(wh.events as string[]).map((ev) => (
                    <span key={ev} className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-muted text-muted-foreground">{ev}</span>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => handleDelete(wh.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

const objectTypes = [
  { key: 'contact', label: 'Contact' },
  { key: 'account', label: 'Account' },
  { key: 'opportunity', label: 'Opportunity' },
  { key: 'activity', label: 'Activity' },
  { key: 'use_case', label: 'Use Case' },
];

const fieldTypes = ['Text', 'Number', 'Date', 'Dropdown', 'Checkbox', 'URL', 'Email'];

function CustomFieldsSettings() {
  const [activeTab, setActiveTab] = useState('contact');
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('Text');

  const { data, isLoading } = useCustomFields(activeTab);
  const createField = useCreateCustomField();
  const deleteField = useDeleteCustomField();

  const fields = (data as any)?.data ?? [];

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      await createField.mutateAsync({ label: newName.trim(), field_type: newType, object_type: activeTab });
      setNewName('');
      setNewType('Text');
      setShowCreate(false);
      toast({ title: 'Custom field created' });
    } catch {
      toast({ title: 'Error', description: 'Failed to create field.', variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteField.mutateAsync(id);
      toast({ title: 'Custom field deleted' });
    } catch {
      toast({ title: 'Error', description: 'Failed to delete field.', variant: 'destructive' });
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display font-bold text-lg text-foreground">Custom Fields</h2>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors">
          <Plus className="w-3.5 h-3.5" /> New Field
        </button>
      </div>

      <div className="flex gap-1 mb-5 overflow-x-auto no-scrollbar bg-muted rounded-xl p-0.5">
        {objectTypes.map((ot) => (
          <button key={ot.key} onClick={() => { setActiveTab(ot.key); setShowCreate(false); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${activeTab === ot.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            {ot.label}
          </button>
        ))}
      </div>

      {showCreate && (
        <div className="mb-5 p-4 rounded-xl border border-border bg-muted/30 space-y-3 max-w-md">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Field Name</label>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Preferred Language"
              className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Field Type</label>
            <div className="flex flex-wrap gap-1.5">
              {fieldTypes.map((ft) => (
                <button key={ft} onClick={() => setNewType(ft)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors border ${newType === ft ? 'bg-primary/15 border-primary/30 text-primary' : 'bg-muted/50 border-border text-muted-foreground hover:text-foreground'}`}>
                  {ft}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={!newName.trim() || createField.isPending} className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors">Create</button>
            <button onClick={() => { setShowCreate(false); setNewName(''); }} className="px-3 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-semibold">Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-2 max-w-2xl">
        {isLoading ? (
          <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-muted/50 rounded-xl animate-pulse" />)}</div>
        ) : fields.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No custom fields for this object type.</p>
        ) : fields.map((f: any) => (
          <div key={f.id} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">{f.label ?? f.name}</p>
              <p className="text-xs text-muted-foreground">{f.field_type ?? f.type}</p>
            </div>
            <button onClick={() => handleDelete(f.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Settings() {
  const location = useLocation();
  return (
    <div className="flex flex-col h-full">
      <TopBar title="Settings" />

      <div className="md:hidden flex gap-1 overflow-x-auto no-scrollbar px-4 pt-3 pb-1 border-b border-border">
        {settingsNav.map((item) => {
          const active = item.path === '/settings' ? location.pathname === '/settings' : location.pathname.startsWith(item.path);
          return (
            <Link key={item.path} to={item.path}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>
              <item.icon className="w-3.5 h-3.5" />
              {item.label}
            </Link>
          );
        })}
      </div>

      <div className="flex-1 flex overflow-hidden">
        <nav className="hidden md:flex flex-col w-48 border-r border-border p-2 gap-0.5">
          {settingsNav.map((item) => {
            const active = item.path === '/settings' ? location.pathname === '/settings' : location.pathname.startsWith(item.path);
            return (
              <Link key={item.path} to={item.path}
                className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${active ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex-1 overflow-y-auto p-6 pb-20 md:pb-6">
          <Routes>
            <Route index element={<ProfileSettings />} />
            <Route path="appearance" element={<AppearanceSettings />} />
            <Route path="api-keys" element={<ApiKeysSettings />} />
            <Route path="webhooks" element={<WebhooksSettings />} />
            <Route path="custom-fields" element={<CustomFieldsSettings />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
