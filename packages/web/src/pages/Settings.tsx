// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { TopBar } from '@/components/layout/TopBar';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { CircleUser, Lock, Link2, ListFilter, Copy, Trash2, Plus, Database, CheckCircle2, XCircle, Users, Pencil, Eye, EyeOff, LayoutGrid, List, ListOrdered, ChevronUp, ChevronDown, ChevronRight, Bot, Key, Search, X, Tags, Settings as SettingsIcon, MessageSquare, ShieldCheck, Sparkles, Info, Globe, Terminal, Server, AlertTriangle, RefreshCw, Zap } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useAppStore } from '@/store/appStore';
import { ListToolbar, type FilterConfig, type SortOption } from '@/components/crm/ListToolbar';
import { PaginationBar } from '@/components/crm/PaginationBar';
import { motion, AnimatePresence } from 'framer-motion';
import { useIsMobile } from '@/hooks/use-mobile';
import { getUser } from '@/api/client';
import { useApiKeys, useCreateApiKey, useUpdateApiKey, useRevokeApiKey, useActors, useUpdateProfile, useWebhooks, useCreateWebhook, useUpdateWebhook, useDeleteWebhook, useWebhookDeliveries, useCustomFields, useCreateCustomField, useUpdateCustomField, useDeleteCustomField, useDbConfig, useTestDbConfig, useSaveDbConfig, useSeedSampleData, useUsers, useCreateUser, useUpdateUser, useDeleteUser, useContextTypes, useCreateContextType, useDeleteContextType, useActivityTypes, useCreateActivityType, useDeleteActivityType, useMeetingClassifications, useCreateMeetingClassification, useUpdateMeetingClassification, useDeleteMeetingClassification, useSystemsOfRecord, useCreateSystemOfRecord, useUpdateSystemOfRecord, useDeleteSystemOfRecord, useTestSystemOfRecord, useRunSystemSync, useDiscoverSystemOfRecord, useSystemMappings, useUpsertSystemMapping, useDeleteSystemMapping, useSystemSyncRuns, useSystemConflicts, useResolveSystemConflict, useSystemWritebacks, usePreviewSystemWriteback, useRequestSystemWriteback, useExecuteSystemWriteback, useReviewSystemWriteback } from '@/api/hooks';
import type { SystemMapping, SystemOfRecord } from '@/api/hooks';
import { useAgentSettings } from '@/contexts/AgentSettingsContext';
import AgentSettings from '@/pages/AgentSettings';
import ActorsSettings from '@/components/settings/ActorsSettings';
import MessagingSettings from '@/components/settings/MessagingSettings';
import HITLRulesSettings from '@/components/settings/HITLRulesSettings';

type NavRole = 'member' | 'manager' | 'admin' | 'owner';

const settingsNavConfig: { icon: React.ElementType; label: string; path: string; roles: NavRole[]; group: string }[] = [
  { icon: CircleUser, label: 'Profile',       path: '/settings',              roles: ['member', 'manager', 'admin', 'owner'], group: 'Personal' },
  { icon: Lock,       label: 'API Keys',      path: '/settings/api-keys',     roles: ['member', 'manager', 'admin', 'owner'], group: 'Personal' },
  { icon: Sparkles,   label: 'Model Settings', path: '/settings/model',       roles: ['admin', 'owner'], group: 'Agent & Memory' },
  { icon: Users,      label: 'Actors',        path: '/settings/actors',       roles: ['admin', 'owner'], group: 'Agent & Memory' },
  { icon: Tags,       label: 'Registries',    path: '/settings/registries',   roles: ['admin', 'owner'], group: 'Agent & Memory' },
  { icon: ListFilter, label: 'Custom Fields', path: '/settings/custom-fields',roles: ['admin', 'owner'], group: 'Agent & Memory' },
  { icon: Server,     label: 'Systems of Record', path: '/settings/systems', roles: ['admin', 'owner'], group: 'Sources & Systems' },
  { icon: MessageSquare, label: 'Messaging', path: '/settings/messaging',     roles: ['admin', 'owner'], group: 'Sources & Systems' },
  { icon: Database,   label: 'Database',      path: '/settings/database',     roles: ['admin', 'owner'], group: 'Sources & Systems' },
  { icon: ShieldCheck, label: 'Action Policies', path: '/settings/hitl-rules', roles: ['admin', 'owner'], group: 'Governance' },
  { icon: Link2,      label: 'Webhooks',      path: '/settings/webhooks',     roles: ['admin', 'owner'], group: 'Automations' },
  { icon: Zap,        label: 'Automations',   path: '/settings/advanced',     roles: ['admin', 'owner'], group: 'Automations' },
];

const settingsGroupOrder = ['Personal', 'Agent & Memory', 'Sources & Systems', 'Governance', 'Automations'];

function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
      <Lock className="w-8 h-8 opacity-25" />
      <p className="text-sm font-semibold text-foreground">Access restricted</p>
      <p className="text-xs">You don't have permission to view this section.</p>
    </div>
  );
}

function RequireRole({ roles, children }: { roles: NavRole[]; children: React.ReactNode }) {
  const user = getUser();
  if (!user || !roles.includes(user.role as NavRole)) return <AccessDenied />;
  return <>{children}</>;
}

function SettingsHealthDot({ tone, className = '' }: { tone: 'ok' | 'warn' | 'error' | 'muted'; className?: string }) {
  const color = tone === 'ok'
    ? 'bg-success'
    : tone === 'warn'
    ? 'bg-warning'
    : tone === 'error'
    ? 'bg-destructive'
    : 'bg-muted-foreground/40';
  return <span className={`w-2 h-2 rounded-full ${color} ${className}`} />;
}

function ModelSettingsDot({ className = '' }: { className?: string }) {
  const { enabled, connectivity } = useAgentSettings();
  const tone = enabled && connectivity === 'online'
    ? 'ok'
    : enabled && connectivity === 'offline'
    ? 'error'
    : enabled
    ? 'warn'
    : 'muted';
  return <SettingsHealthDot tone={tone} className={className} />;
}

function DatabaseSettingsDot({ className = '' }: { className?: string }) {
  const { data, isLoading, isError } = useDbConfig();
  const dbInfo = data as { host?: string; database?: string } | undefined;
  const tone = isError
    ? 'error'
    : isLoading
    ? 'muted'
    : dbInfo?.host && dbInfo?.database
    ? 'ok'
    : 'warn';
  return <SettingsHealthDot tone={tone} className={className} />;
}

function SystemsSettingsDot({ className = '' }: { className?: string }) {
  const { data, isLoading, isError } = useSystemsOfRecord({ limit: 50 }) as any;
  const systems: SystemOfRecord[] = data?.data ?? [];
  const hasError = systems.some(system => system.status === 'error' || system.status === 'failed');
  const allConnected = systems.length > 0 && systems.every(system => system.status === 'connected');
  const tone = isError
    ? 'error'
    : isLoading
    ? 'muted'
    : hasError
    ? 'error'
    : allConnected
    ? 'ok'
    : systems.length > 0
    ? 'warn'
    : 'muted';
  return <SettingsHealthDot tone={tone} className={className} />;
}

function SettingsNavHealthDot({ path, className = '' }: { path: string; className?: string }) {
  if (path === '/settings/model') return <ModelSettingsDot className={className} />;
  if (path === '/settings/database') return <DatabaseSettingsDot className={className} />;
  if (path === '/settings/systems') return <SystemsSettingsDot className={className} />;
  return null;
}

function ProfileSettings() {
  const user = getUser();
  const updateProfile = useUpdateProfile();

  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [saved, setSaved] = useState(false);

  const isOwner = user?.role === 'owner';
  const isAdmin = user?.role === 'admin' || isOwner;

  const inputCls = 'w-full h-10 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring transition-colors';
  const readonlyCls = 'w-full h-10 px-3 flex items-center rounded-lg border border-border bg-muted/50 text-sm text-foreground';

  const handleSave = async () => {
    if (newPassword && newPassword !== confirmPassword) {
      toast({ title: 'Passwords do not match', variant: 'destructive' });
      return;
    }
    if (newPassword && newPassword.length < 8) {
      toast({ title: 'Password too short', description: 'Must be at least 8 characters.', variant: 'destructive' });
      return;
    }
    try {
      const payload: { name?: string; email?: string; current_password?: string; new_password?: string } = {};
      if (name.trim() && name.trim() !== user?.name) payload.name = name.trim();
      if (email.trim() && email.trim() !== user?.email) payload.email = email.trim();
      if (newPassword) { payload.current_password = currentPassword; payload.new_password = newPassword; }
      if (Object.keys(payload).length === 0) {
        toast({ title: 'No changes to save' });
        return;
      }
      const updated = await updateProfile.mutateAsync(payload);
      // Update localStorage so the topbar reflects changes immediately
      const stored = localStorage.getItem('crmy_user');
      if (stored) {
        const parsed = JSON.parse(stored);
        localStorage.setItem('crmy_user', JSON.stringify({ ...parsed, name: updated.name, email: updated.email }));
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      toast({ title: 'Profile updated' });
    } catch (err) {
      toast({ title: 'Failed to update profile', description: err instanceof Error ? err.message : 'Please try again.', variant: 'destructive' });
    }
  };

  const roleBadge: Record<string, string> = {
    owner: 'bg-accent/15 text-accent border-accent/30',
    admin: 'bg-primary/15 text-primary border-primary/30',
    member: 'bg-muted text-muted-foreground border-border',
  };

  return (
    <div className="max-w-2xl">
      <h2 className="font-display font-bold text-lg text-foreground mb-1">Profile</h2>
      <p className="text-sm text-muted-foreground mb-6">Update your name, email, password, and preferred appearance.</p>

      <div className="space-y-5 max-w-lg">
        {/* Read-only: Role */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Role</label>
          <div className={readonlyCls}>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border capitalize ${roleBadge[user?.role ?? 'member'] ?? roleBadge.member}`}>
              {user?.role ?? '—'}
            </span>
          </div>
        </div>

        {/* Editable: Name */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Name</label>
          <input value={name} onChange={e => setName(e.target.value)} className={inputCls} placeholder="Your full name" />
        </div>

        {/* Editable: Email (admin/owner only) */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            Email
            {!isAdmin && <span className="text-xs text-muted-foreground/60 normal-case font-normal">contact an admin to change</span>}
          </label>
          {isAdmin ? (
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCls} placeholder="you@example.com" />
          ) : (
            <div className={readonlyCls}>{user?.email}</div>
          )}
        </div>

        {/* Password change */}
        <div className="pt-2 border-t border-border space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">Change Password</p>
            <button onClick={() => setShowPasswords(p => !p)} className="text-xs text-primary hover:underline">
              {showPasswords ? 'Cancel' : 'Change'}
            </button>
          </div>
          {showPasswords && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Current Password</label>
                <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} className={inputCls} placeholder="Enter current password" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">New Password</label>
                <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className={inputCls} placeholder="Min. 8 characters" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Confirm New Password</label>
                <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className={inputCls} placeholder="Repeat new password"
                  onKeyDown={e => e.key === 'Enter' && handleSave()} />
                {newPassword && confirmPassword && newPassword !== confirmPassword && (
                  <p className="text-xs text-destructive mt-1">Passwords do not match</p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button onClick={handleSave} disabled={updateProfile.isPending}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors">
            {updateProfile.isPending ? 'Saving…' : 'Save Changes'}
          </button>
          {saved && <span className="text-xs text-success flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Saved</span>}
        </div>
      </div>

      <div className="mt-8 pt-6 border-t border-border">
        <AppearanceSettings />
      </div>
    </div>
  );
}

function AppearanceSettings() {
  const { darkVariant, setDarkVariant } = useAppStore();
  const variants: { key: 'warm' | 'charcoal'; label: string; description: string; preview: string }[] = [
    { key: 'charcoal', label: 'Charcoal', description: 'Dark theme with cool, navy-charcoal tones', preview: 'bg-[hsl(220,16%,8%)]' },
    { key: 'warm', label: 'Warm Brown', description: 'Dark theme with warm, earthy brown tones', preview: 'bg-[hsl(15,25%,7%)]' },
  ];
  return (
    <div>
      <div className="mb-6">
        <h2 className="font-display font-bold text-lg text-foreground">Appearance</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Choose your preferred dark mode style.</p>
      </div>
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

const API_KEY_SCOPE_GROUPS = [
  { label: 'General', scopes: [
    { value: 'read', label: 'Read all' },
    { value: 'write', label: 'Write all' },
  ]},
  { label: 'Contacts', scopes: [
    { value: 'contacts:read', label: 'Read' },
    { value: 'contacts:write', label: 'Write' },
  ]},
  { label: 'Accounts', scopes: [
    { value: 'accounts:read', label: 'Read' },
    { value: 'accounts:write', label: 'Write' },
  ]},
  { label: 'Opportunities', scopes: [
    { value: 'opportunities:read', label: 'Read' },
    { value: 'opportunities:write', label: 'Write' },
  ]},
  { label: 'Activities', scopes: [
    { value: 'activities:read', label: 'Read' },
    { value: 'activities:write', label: 'Write' },
  ]},
  { label: 'Assignments', scopes: [
    { value: 'assignments:read', label: 'Read' },
    { value: 'assignments:write', label: 'Write' },
  ]},
  { label: 'Context', scopes: [
    { value: 'context:read', label: 'Read' },
    { value: 'context:write', label: 'Write' },
  ]},
  { label: 'HITL', scopes: [
    { value: 'hitl:read', label: 'Read' },
    { value: 'hitl:write', label: 'Write' },
    { value: 'hitl:admin', label: 'Policy admin' },
  ]},
  { label: 'Systems', scopes: [
    { value: 'systems:read', label: 'Read' },
    { value: 'systems:write', label: 'Sync/writeback' },
    { value: 'systems:admin', label: 'Connection admin' },
  ]},
  { label: 'Admin Setup', scopes: [
    { value: 'api_keys:admin', label: 'API keys' },
    { value: 'email_provider:admin', label: 'Inbound email' },
  ]},
  { label: 'Agent', scopes: [
    { value: 'agent:read', label: 'Read' },
    { value: 'agent:write', label: 'Write' },
  ]},
  { label: 'Workflows', scopes: [
    { value: 'workflows:read', label: 'Read' },
    { value: 'workflows:write', label: 'Write' },
  ]},
  { label: 'Messaging', scopes: [
    { value: 'messaging:read', label: 'Read' },
    { value: 'messaging:write', label: 'Write' },
  ]},
  { label: 'Operations', scopes: [
    { value: 'ops:read', label: 'Read' },
    { value: 'ops:write', label: 'Write' },
    { value: 'privacy:read', label: 'Privacy read' },
    { value: 'privacy:write', label: 'Privacy write' },
  ]},
];

const ALL_SCOPES = API_KEY_SCOPE_GROUPS.flatMap(g => g.scopes);

const SCOPE_TEMPLATES = [
  {
    label: 'Read-only analyst',
    description: 'Can inspect customers, context, briefings, audit surfaces, and tool results.',
    scopes: ['read', 'ops:read'],
  },
  {
    label: 'Research agent',
    description: 'Can read revenue state and write customer context, without changing deals or sending messages.',
    scopes: ['read', 'context:write', 'agent:read', 'agent:write'],
  },
  {
    label: 'Outreach agent',
    description: 'Can brief, write context, create activities, and request human approval before sends.',
    scopes: ['read', 'activities:write', 'context:write', 'hitl:read', 'hitl:write', 'agent:read', 'agent:write'],
  },
  {
    label: 'Workflow operator',
    description: 'Can inspect and run workflows, assignments, messaging, HITL, and operational queues.',
    scopes: ['read', 'workflows:read', 'workflows:write', 'assignments:read', 'assignments:write', 'messaging:read', 'messaging:write', 'hitl:read', 'hitl:write', 'ops:read'],
  },
  {
    label: 'Admin operator',
    description: 'Broad access for trusted operators during setup, migration, or incident response.',
    scopes: [
      'read',
      'write',
      'systems:read',
      'systems:write',
      'systems:admin',
      'api_keys:admin',
      'email_provider:admin',
      'hitl:admin',
      'ops:read',
      'ops:write',
      'privacy:read',
      'privacy:write',
      'webhooks:read',
      'webhooks:write',
      'workflows:read',
      'workflows:write',
      'messaging:read',
      'messaging:write',
    ],
  },
];

function McpSetupCard({
  icon,
  title,
  status,
  body,
  snippet,
  onCopy,
}: {
  icon: React.ReactNode;
  title: string;
  status: string;
  body: string;
  snippet: string;
  onCopy: (text: string) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">{icon}</span>
          <div>
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="text-xs text-success mt-0.5">{status}</p>
          </div>
        </div>
        <button onClick={() => onCopy(snippet)} className="p-1.5 rounded-lg hover:bg-muted transition-colors" title="Copy">
          <Copy className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>
      <p className="text-xs text-muted-foreground mt-3">{body}</p>
      <code className="block mt-3 rounded-lg border border-border bg-background px-3 py-2 text-xs font-mono text-foreground overflow-x-auto whitespace-nowrap">{snippet}</code>
    </div>
  );
}

function ApiKeysSettings() {
  const { data, isLoading } = useApiKeys();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: actorsData } = useActors({ is_active: true, limit: 100 }) as any;
  const createKey = useCreateApiKey();
  const updateKey = useUpdateApiKey();
  const revokeKey = useRevokeApiKey();

  const [view, setView] = useState<'table' | 'card'>('table');
  const [search, setSearch] = useState('');
  const [scopeFilter, setScopeFilter] = useState('');
  const [usageFilter, setUsageFilter] = useState<'all' | 'used' | 'never'>('all');
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'created_at', dir: 'desc' });
  const [page, setPage] = useState(1);

  const [showCreate, setShowCreate] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['read', 'write']);
  const [newActorId, setNewActorId] = useState('');
  const [newExpiresAt, setNewExpiresAt] = useState('');

  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [expandedKeyId, setExpandedKeyId] = useState<string | null>(null);
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editActorId, setEditActorId] = useState('');
  const [editExpiresAt, setEditExpiresAt] = useState('');
  const [editScopes, setEditScopes] = useState<string[]>([]);
  const [editingScopes, setEditingScopes] = useState<string | null>(null); // keyId whose scopes panel is in edit mode

  const PAGE_SIZE = 10;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const keys: any[] = (data as any)?.data ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actors: any[] = actorsData?.data ?? [];

  const filtered = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let result: any[] = [...keys];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(k => k.label?.toLowerCase().includes(q) || k.actor_name?.toLowerCase().includes(q));
    }
    if (scopeFilter) result = result.filter(k => k.scopes?.includes(scopeFilter));
    if (usageFilter === 'used') result = result.filter(k => !!k.last_used_at);
    if (usageFilter === 'never') result = result.filter(k => !k.last_used_at);
    result.sort((a, b) => {
      const va: string = sort.key === 'label' ? (a.label ?? '') : (a[sort.key] ?? '');
      const vb: string = sort.key === 'label' ? (b.label ?? '') : (b[sort.key] ?? '');
      return sort.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    });
    return result;
  }, [keys, search, scopeFilter, usageFilter, sort]);

  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const resetCreate = () => { setShowCreate(false); setNewLabel(''); setSelectedScopes(['read', 'write']); setNewActorId(''); setNewExpiresAt(''); };

  const handleCreate = async () => {
    if (!newLabel.trim() || selectedScopes.length === 0) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload: any = { label: newLabel.trim(), scopes: selectedScopes };
      if (newActorId) payload.actor_id = newActorId;
      if (newExpiresAt) payload.expires_at = new Date(newExpiresAt).toISOString();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await createKey.mutateAsync(payload) as any;
      setRevealedKey(result.key ?? null);
      resetCreate();
      toast({ title: 'API key created', description: "Copy and store it safely — it won't be shown again." });
    } catch (err) {
      toast({ title: 'Failed to create API key', description: err instanceof Error ? err.message : 'Please try again.', variant: 'destructive' });
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      await revokeKey.mutateAsync(id);
      setRevokeId(null);
      toast({ title: 'API key revoked' });
    } catch (err) {
      toast({ title: 'Failed to revoke key', description: err instanceof Error ? err.message : 'Please try again.', variant: 'destructive' });
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const startEdit = (k: any) => {
    setEditingKeyId(k.id);
    setEditLabel(k.label ?? '');
    setEditActorId(k.actor_id ?? '');
    setEditExpiresAt(k.expires_at ? new Date(k.expires_at).toISOString().slice(0, 10) : '');
    setExpandedKeyId(null);
  };

  const cancelEdit = () => { setEditingKeyId(null); };

  const handleUpdate = async () => {
    if (!editingKeyId || !editLabel.trim()) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload: any = { id: editingKeyId, label: editLabel.trim() };
      payload.actor_id = editActorId || null;
      payload.expires_at = editExpiresAt ? new Date(editExpiresAt).toISOString() : null;
      await updateKey.mutateAsync(payload);
      setEditingKeyId(null);
      toast({ title: 'API key updated' });
    } catch (err) {
      toast({ title: 'Failed to update API key', description: err instanceof Error ? err.message : 'Please try again.', variant: 'destructive' });
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const startEditScopes = (k: any) => {
    setEditingScopes(k.id);
    setEditScopes(k.scopes ?? []);
  };

  const handleSaveScopes = async (keyId: string) => {
    try {
      await updateKey.mutateAsync({ id: keyId, scopes: editScopes });
      setEditingScopes(null);
      toast({ title: 'Scopes updated' });
    } catch (err) {
      toast({ title: 'Failed to update scopes', description: err instanceof Error ? err.message : 'Please try again.', variant: 'destructive' });
    }
  };

  const toggleScope = (scope: string) =>
    setSelectedScopes(prev => prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope]);

  const toggleEditScope = (scope: string) =>
    setEditScopes(prev => prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope]);

  const fmtDate = (d?: string) => d ? new Date(d).toLocaleDateString() : null;
  const fmtLastUsed = (d?: string) => {
    if (!d) return 'Never used';
    const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
    if (days === 0) return 'Used today';
    if (days === 1) return 'Used yesterday';
    if (days < 30) return `Used ${days}d ago`;
    return `Used ${fmtDate(d)}`;
  };

  const SortBtn = ({ sk, label }: { sk: string; label: string }) => (
    <button
      onClick={() => { setSort(s => s.key === sk ? { key: sk, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: sk, dir: 'desc' }); setPage(1); }}
      className="flex items-center gap-1 text-xs font-mono text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
    >
      {label}
      {sort.key === sk && (sort.dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
    </button>
  );

  const ActorBadge = ({ name, type }: { name: string; type: string }) => (
    <div className="flex items-center gap-1.5">
      <span className="text-sm text-foreground truncate">{name}</span>
      <span className={`text-xs px-1.5 py-0.5 rounded border capitalize flex-shrink-0 ${type === 'agent' ? 'bg-blue-500/10 text-blue-500 border-blue-500/30' : 'bg-amber-500/10 text-amber-600 border-amber-500/30'}`}>{type}</span>
    </div>
  );

  const applyTemplate = (scopes: string[]) => setSelectedScopes(scopes);
  const applyEditTemplate = (scopes: string[]) => setEditScopes(scopes);
  const hasBroadWrite = (scopes: string[]) => scopes.includes('write');
  const copySnippet = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copied' });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="font-display font-bold text-lg text-foreground">API Keys</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Manage access tokens for the CRMy REST API and MCP server.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <McpSetupCard
          icon={<Terminal className="w-4 h-4" />}
          title="Local stdio MCP"
          status="Uses crmy init config"
          body="Best for local IDEs and desktop agents. The CLI reads the config created by init."
          snippet="claude mcp add crmy -- npx @crmy/cli mcp"
          onCopy={copySnippet}
        />
        <McpSetupCard
          icon={<Server className="w-4 h-4" />}
          title="HTTP MCP"
          status="Requires scoped API key"
          body="Best for remote agents. Send Authorization: Bearer <API key> to the server MCP endpoint."
          snippet={`curl -H "Authorization: Bearer $CRMY_API_KEY" http://localhost:3000/mcp`}
          onCopy={copySnippet}
        />
      </div>

      {/* Revealed key banner */}
      {revealedKey && (
        <div className="p-4 rounded-xl border border-success/30 bg-success/5">
          <p className="text-xs font-semibold text-success mb-2">Your new API key — copy it now, it won't be shown again:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono bg-background rounded px-2 py-1.5 border border-border truncate">{revealedKey}</code>
            <button onClick={() => { navigator.clipboard.writeText(revealedKey!); toast({ title: 'Copied!' }); }} className="p-1.5 rounded-lg hover:bg-muted transition-colors flex-shrink-0">
              <Copy className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>
          <button onClick={() => setRevealedKey(null)} className="mt-2 text-xs text-muted-foreground hover:text-foreground">Dismiss</button>
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="p-5 rounded-xl border border-border bg-card space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Create new API key</h3>
            <button onClick={resetCreate} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors"><X className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Label <span className="text-destructive">*</span></label>
              <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="e.g. Production, CI/CD"
                className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
                onKeyDown={e => e.key === 'Enter' && handleCreate()} autoFocus />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Bind to Actor (optional)</label>
              <select value={newActorId} onChange={e => setNewActorId(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:ring-1 focus:ring-ring">
                <option value="">No actor binding</option>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {actors.map((a: any) => <option key={a.id} value={a.id}>{a.display_name} ({a.actor_type})</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Expires (optional)</label>
              <input type="date" value={newExpiresAt} onChange={e => setNewExpiresAt(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:ring-1 focus:ring-ring" />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Scopes <span className="text-destructive">*</span></label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
              {SCOPE_TEMPLATES.map(template => (
                <button key={template.label} onClick={() => applyTemplate(template.scopes)}
                  className="p-2 rounded-lg border border-border bg-background text-left hover:border-primary/40 hover:bg-primary/5 transition-colors">
                  <p className="text-xs font-semibold text-foreground">{template.label}</p>
                  <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{template.description}</p>
                </button>
              ))}
            </div>
            {hasBroadWrite(selectedScopes) && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>Broad write grants write access across all write-scoped tools. Prefer a narrower template for production agents.</span>
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3">
              {API_KEY_SCOPE_GROUPS.map(group => (
                <div key={group.label} className="space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground">{group.label}</p>
                  {group.scopes.map(scope => (
                    <label key={scope.value} className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={selectedScopes.includes(scope.value)} onChange={() => toggleScope(scope.value)}
                        className="w-3.5 h-3.5 rounded border-border accent-primary" />
                      <span className="text-xs text-foreground">{scope.label}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={handleCreate} disabled={!newLabel.trim() || selectedScopes.length === 0 || createKey.isPending}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors">
              {createKey.isPending ? 'Creating…' : 'Create Key'}
            </button>
            <button onClick={resetCreate} className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-0 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search keys…"
            className="w-full h-9 pl-9 pr-3 rounded-xl border border-border bg-card text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/30 transition-all" />
        </div>
        <select value={scopeFilter} onChange={e => { setScopeFilter(e.target.value); setPage(1); }}
          className="h-9 px-3 rounded-xl border border-border bg-card text-sm text-muted-foreground outline-none focus:ring-2 focus:ring-primary/30 flex-shrink-0">
          <option value="">All scopes</option>
          {ALL_SCOPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select value={usageFilter} onChange={e => { setUsageFilter(e.target.value as 'all' | 'used' | 'never'); setPage(1); }}
          className="h-9 px-3 rounded-xl border border-border bg-card text-sm text-muted-foreground outline-none focus:ring-2 focus:ring-primary/30 flex-shrink-0">
          <option value="all">All usage</option>
          <option value="used">Used</option>
          <option value="never">Never used</option>
        </select>
        <select value={`${sort.key}_${sort.dir}`} onChange={e => { const [k, d] = e.target.value.split('_'); setSort({ key: k, dir: d as 'asc' | 'desc' }); setPage(1); }}
          className="h-9 px-3 rounded-xl border border-border bg-card text-sm text-muted-foreground outline-none focus:ring-2 focus:ring-primary/30 flex-shrink-0">
          <option value="created_at_desc">Newest first</option>
          <option value="created_at_asc">Oldest first</option>
          <option value="label_asc">Label A–Z</option>
          <option value="label_desc">Label Z–A</option>
          <option value="last_used_at_desc">Recently used</option>
          <option value="last_used_at_asc">Least used</option>
        </select>
        <div className="flex items-center border border-border rounded-xl overflow-hidden flex-shrink-0">
          <button onClick={() => setView('table')} className={`p-2 transition-colors ${view === 'table' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50'}`}><List className="w-4 h-4" /></button>
          <button onClick={() => setView('card')} className={`p-2 transition-colors ${view === 'card' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50'}`}><LayoutGrid className="w-4 h-4" /></button>
        </div>
        <button onClick={() => setShowCreate(true)} disabled={showCreate}
          className="h-9 px-4 flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-primary to-primary/80 text-primary-foreground text-sm font-semibold hover:shadow-md transition-all flex-shrink-0 press-scale disabled:opacity-50">
          <Plus className="w-4 h-4" /> New Key
        </button>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-muted/50 rounded-2xl animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-14 text-center">
          <Key className="w-8 h-8 text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">{keys.length === 0 ? 'No API keys yet. Create one to get started.' : 'No keys match your filters.'}</p>
          {keys.length === 0 && <button onClick={() => setShowCreate(true)} className="mt-3 text-xs text-primary hover:underline">Create your first key</button>}
        </div>
      ) : view === 'table' ? (
        <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-sunken/50">
                <th className="text-left px-4 py-3 text-xs font-display font-semibold text-muted-foreground"><SortBtn sk="label" label="Label" /></th>
                <th className="text-left px-4 py-3 hidden md:table-cell text-xs font-display font-semibold text-muted-foreground">Scopes</th>
                <th className="text-left px-4 py-3 hidden lg:table-cell text-xs font-display font-semibold text-muted-foreground">Actor</th>
                <th className="text-left px-4 py-3 hidden sm:table-cell text-xs font-display font-semibold text-muted-foreground"><SortBtn sk="last_used_at" label="Last Used" /></th>
                <th className="text-left px-4 py-3 hidden lg:table-cell text-xs font-display font-semibold text-muted-foreground"><SortBtn sk="created_at" label="Created" /></th>
                <th className="px-2 py-3 w-20" />
              </tr>
            </thead>
            <tbody>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {paginated.map((k: any, i: number) => (
                <React.Fragment key={k.id}>
                  {editingKeyId === k.id ? (
                    /* ── Inline edit row ── */
                    <tr className="border-b border-border">
                      <td colSpan={6} className="p-4 bg-muted/20">
                        <p className="text-xs font-display font-semibold text-muted-foreground uppercase tracking-wider mb-3">Edit API Key</p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Label <span className="text-destructive">*</span></label>
                            <input value={editLabel} onChange={e => setEditLabel(e.target.value)}
                              className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
                              autoFocus />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Bind to Actor</label>
                            <select value={editActorId} onChange={e => setEditActorId(e.target.value)}
                              className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:ring-1 focus:ring-ring">
                              <option value="">No actor binding</option>
                              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                              {actors.map((a: any) => <option key={a.id} value={a.id}>{a.display_name} ({a.actor_type})</option>)}
                            </select>
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Expires</label>
                            <input type="date" value={editExpiresAt} onChange={e => setEditExpiresAt(e.target.value)}
                              className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:ring-1 focus:ring-ring" />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={handleUpdate} disabled={!editLabel.trim() || updateKey.isPending}
                            className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors">
                            {updateKey.isPending ? 'Saving…' : 'Save Changes'}
                          </button>
                          <button onClick={cancelEdit}
                            className="px-3 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-semibold hover:bg-muted/80 transition-colors">
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <>
                      <tr
                        className={`border-b border-border last:border-0 hover:bg-primary/5 transition-colors group cursor-pointer ${i % 2 === 1 ? 'bg-surface-sunken/30' : ''}`}
                        onClick={() => { setExpandedKeyId(prev => prev === k.id ? null : k.id); setEditingScopes(null); }}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                              <Key className="w-3.5 h-3.5 text-primary" />
                            </div>
                            <div>
                              <p className="font-semibold text-foreground">{k.label}</p>
                              <p className="text-xs font-mono text-muted-foreground">{k.id.slice(0, 14)}…</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => { setExpandedKeyId(prev => prev === k.id ? null : k.id); setEditingScopes(null); }}
                            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
                          >
                            <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border font-mono">
                              {(k.scopes ?? []).length} scope{(k.scopes ?? []).length !== 1 ? 's' : ''}
                            </span>
                            <ChevronRight className={`w-3 h-3 text-muted-foreground transition-transform ${expandedKeyId === k.id ? 'rotate-90' : ''}`} />
                          </button>
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          {k.actor_name ? <ActorBadge name={k.actor_name} type={k.actor_type} /> : <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <span className={`text-xs ${k.last_used_at ? 'text-foreground' : 'text-muted-foreground'}`}>{fmtLastUsed(k.last_used_at)}</span>
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          <span className="text-xs text-muted-foreground">{fmtDate(k.created_at)}</span>
                          {k.expires_at && <p className={`text-xs mt-0.5 ${new Date(k.expires_at) < new Date() ? 'text-destructive' : 'text-muted-foreground'}`}>Exp: {fmtDate(k.expires_at)}</p>}
                        </td>
                        <td className="px-2 py-3" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center gap-1 justify-end">
                            {revokeId === k.id ? (
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-muted-foreground">Revoke?</span>
                                <button onClick={() => handleRevoke(k.id)} className="px-2 py-1 rounded bg-destructive text-destructive-foreground text-xs font-semibold hover:bg-destructive/90 transition-colors">Yes</button>
                                <button onClick={() => setRevokeId(null)} className="px-2 py-1 rounded bg-muted text-muted-foreground text-xs hover:bg-muted/80 transition-colors">No</button>
                              </div>
                            ) : (
                              <>
                                <button onClick={() => startEdit(k)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors opacity-0 group-hover:opacity-100" title="Edit">
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => setRevokeId(k.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100" title="Revoke">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                            <button
                              onClick={() => { setExpandedKeyId(prev => prev === k.id ? null : k.id); setEditingScopes(null); }}
                              className={`p-1.5 rounded-lg transition-colors ${expandedKeyId === k.id ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
                            >
                              <ChevronRight className={`w-3.5 h-3.5 transition-transform ${expandedKeyId === k.id ? 'rotate-90' : ''}`} />
                            </button>
                          </div>
                        </td>
                      </tr>
                      <AnimatePresence>
                        {expandedKeyId === k.id && (
                          <tr>
                            <td colSpan={6} className="p-0 border-b border-border last:border-0">
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                className="overflow-hidden"
                              >
                                <div className="px-4 py-4 bg-muted/20">
                                  <div className="rounded-lg border border-border bg-card overflow-hidden">
                                    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm font-semibold text-foreground">Scopes</span>
                                        <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                                          {(k.scopes ?? []).length}
                                        </span>
                                      </div>
                                      {editingScopes !== k.id ? (
                                        <button onClick={() => startEditScopes(k)} className="text-xs font-semibold text-primary hover:underline">Edit</button>
                                      ) : (
                                        <div className="flex gap-2">
                                          <button onClick={() => handleSaveScopes(k.id)} disabled={updateKey.isPending}
                                            className="px-2.5 py-1 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-40">
                                            {updateKey.isPending ? 'Saving…' : 'Save'}
                                          </button>
                                          <button onClick={() => setEditingScopes(null)}
                                            className="px-2.5 py-1 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:text-foreground">
                                            Cancel
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                    <div className="px-4 py-3">
                                      {editingScopes === k.id ? (
                                        <div className="space-y-3">
                                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                                            {SCOPE_TEMPLATES.map(template => (
                                              <button key={template.label} onClick={() => applyEditTemplate(template.scopes)}
                                                className="p-2 rounded-lg border border-border bg-background text-left hover:border-primary/40 hover:bg-primary/5 transition-colors">
                                                <p className="text-xs font-semibold text-foreground">{template.label}</p>
                                                <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{template.description}</p>
                                              </button>
                                            ))}
                                          </div>
                                          {hasBroadWrite(editScopes) && (
                                            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
                                              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                              <span>Broad write grants write access across all write-scoped tools. Prefer a narrower template for production agents.</span>
                                            </div>
                                          )}
                                          {API_KEY_SCOPE_GROUPS.map(group => (
                                            <div key={group.label}>
                                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{group.label}</p>
                                              <div className="flex flex-wrap gap-1.5">
                                                {group.scopes.map(s => {
                                                  const active = editScopes.includes(s.value);
                                                  return (
                                                    <button key={s.value} onClick={() => toggleEditScope(s.value)}
                                                      className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${active ? 'bg-primary/10 text-primary border-primary/30' : 'bg-muted/50 border-border text-muted-foreground hover:text-foreground'}`}>
                                                      {s.label}
                                                    </button>
                                                  );
                                                })}
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      ) : (
                                        <div className="flex flex-wrap gap-1.5">
                                          {(k.scopes ?? []).length === 0 ? (
                                            <p className="text-xs text-muted-foreground">No scopes assigned.</p>
                                          ) : (
                                            (k.scopes ?? []).map((s: string) => (
                                              <span key={s} className="px-2 py-0.5 rounded-md text-xs font-medium bg-primary/10 text-primary border border-primary/20">{s}</span>
                                            ))
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </motion.div>
                            </td>
                          </tr>
                        )}
                      </AnimatePresence>
                    </>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {paginated.map((k: any) => (
            <div key={k.id} className="bg-card border border-border rounded-xl p-4 space-y-3 hover:shadow-md transition-shadow group">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Key className="w-4 h-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{k.label}</p>
                    <p className="text-xs font-mono text-muted-foreground">{k.id.slice(0, 14)}…</p>
                  </div>
                </div>
                {revokeId === k.id ? (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => handleRevoke(k.id)} className="px-2 py-0.5 rounded bg-destructive text-destructive-foreground text-xs font-semibold">Revoke</button>
                    <button onClick={() => setRevokeId(null)} className="px-2 py-0.5 rounded bg-muted text-muted-foreground text-xs">✕</button>
                  </div>
                ) : (
                  <button onClick={() => setRevokeId(k.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {(k.scopes ?? []).map((s: string) => (
                  <span key={s} className="px-1.5 py-0.5 rounded text-xs font-mono bg-muted text-muted-foreground border border-border">{s}</span>
                ))}
              </div>
              <div className="space-y-1.5 pt-2 border-t border-border">
                {k.actor_name && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground w-16 flex-shrink-0">Actor</span>
                    <ActorBadge name={k.actor_name} type={k.actor_type} />
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground w-16 flex-shrink-0">Last used</span>
                  <span className={`text-xs ${k.last_used_at ? 'text-foreground' : 'text-muted-foreground'}`}>{fmtLastUsed(k.last_used_at)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground w-16 flex-shrink-0">Created</span>
                  <span className="text-xs text-muted-foreground">{fmtDate(k.created_at)}</span>
                </div>
                {k.expires_at && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground w-16 flex-shrink-0">Expires</span>
                    <span className={`text-xs ${new Date(k.expires_at) < new Date() ? 'text-destructive font-medium' : 'text-foreground'}`}>{fmtDate(k.expires_at)}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <PaginationBar page={page} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} />
    </div>
  );
}

function WebhookDeliveryLog({ webhookId }: { webhookId: string }) {
  const { data, isLoading } = useWebhookDeliveries(webhookId, { limit: 10 });
  const deliveries = (data as any)?.data ?? [];

  if (isLoading) return <div className="py-2 pl-4"><div className="h-6 w-32 bg-muted/50 rounded animate-pulse" /></div>;
  if (deliveries.length === 0) return <p className="text-xs text-muted-foreground py-2 pl-4">No deliveries yet.</p>;

  return (
    <div className="pl-4 space-y-1 py-2">
      {deliveries.map((d: any) => {
        const ok = d.status_code >= 200 && d.status_code < 300;
        const failed = d.status === 'failed';
        return (
          <div key={d.id} className="flex items-center gap-2 text-xs">
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded font-semibold ${ok ? 'bg-emerald-500/15 text-emerald-500' : failed ? 'bg-destructive/15 text-destructive' : 'bg-warning/15 text-warning'}`}>
              {d.status_code ?? d.status}
            </span>
            <span className="text-muted-foreground font-mono">{d.event_type ?? d.event ?? '—'}</span>
            {d.duration_ms != null && <span className="text-muted-foreground">{d.duration_ms}ms</span>}
            <span className="text-muted-foreground ml-auto">{d.created_at ? new Date(d.created_at).toLocaleString() : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

const WEBHOOK_EVENT_GROUPS = [
  { label: 'Contacts', events: [
    { value: 'contact.created', label: 'Created' },
    { value: 'contact.updated', label: 'Updated' },
    { value: 'contact.deleted', label: 'Deleted' },
    { value: 'contact.merged', label: 'Merged' },
    { value: 'contact.lifecycle_changed', label: 'Lifecycle changed' },
  ]},
  { label: 'Accounts', events: [
    { value: 'account.created', label: 'Created' },
    { value: 'account.updated', label: 'Updated' },
    { value: 'account.deleted', label: 'Deleted' },
  ]},
  { label: 'Opportunities', events: [
    { value: 'opportunity.created', label: 'Created' },
    { value: 'opportunity.updated', label: 'Updated' },
    { value: 'opportunity.stage_changed', label: 'Stage changed' },
    { value: 'opportunity.deleted', label: 'Deleted' },
  ]},
  { label: 'Activities', events: [
    { value: 'activity.created', label: 'Created' },
    { value: 'activity.updated', label: 'Updated' },
    { value: 'activity.completed', label: 'Completed' },
  ]},
  { label: 'Assignments', events: [
    { value: 'assignment.created', label: 'Created' },
    { value: 'assignment.accepted', label: 'Accepted' },
    { value: 'assignment.completed', label: 'Completed' },
    { value: 'assignment.declined', label: 'Declined' },
  ]},
  { label: 'Sequences', events: [
    { value: 'sequence.enrolled', label: 'Contact enrolled' },
    { value: 'sequence.completed', label: 'Contact completed' },
    { value: 'sequence.unenrolled', label: 'Contact unenrolled' },
    { value: 'sequence.step_sent', label: 'Step sent' },
  ]},
  { label: 'Email', events: [
    { value: 'email.received', label: 'Received' },
    { value: 'email.sent', label: 'Sent' },
  ]},
  { label: 'Context', events: [
    { value: 'context.created', label: 'Entry created' },
    { value: 'context.updated', label: 'Entry updated' },
  ]},
  { label: 'Use Cases', events: [
    { value: 'use_case.created', label: 'Created' },
    { value: 'use_case.updated', label: 'Updated' },
    { value: 'use_case.stage_changed', label: 'Stage changed' },
  ]},
];

const ALL_WEBHOOK_EVENTS = WEBHOOK_EVENT_GROUPS.flatMap(g => g.events);

function WebhookEventCheckboxes({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (events: string[]) => void;
}) {
  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter(e => e !== value) : [...selected, value]);
  };
  const toggleGroup = (groupEvents: { value: string; label: string }[]) => {
    const values = groupEvents.map(e => e.value);
    const allSelected = values.every(v => selected.includes(v));
    if (allSelected) {
      onChange(selected.filter(v => !values.includes(v)));
    } else {
      onChange([...new Set([...selected, ...values])]);
    }
  };
  return (
    <div className="space-y-3">
      {WEBHOOK_EVENT_GROUPS.map((group) => {
        const groupValues = group.events.map(e => e.value);
        const allSelected = groupValues.every(v => selected.includes(v));
        const someSelected = groupValues.some(v => selected.includes(v));
        return (
          <div key={group.label}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">{group.label}</span>
              <button
                type="button"
                onClick={() => toggleGroup(group.events)}
                className="text-[10px] text-primary hover:underline ml-1"
              >
                {allSelected ? 'None' : someSelected ? 'All' : 'All'}
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
              {group.events.map((ev) => (
                <label key={ev.value} className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={selected.includes(ev.value)}
                    onChange={() => toggle(ev.value)}
                    className="w-3.5 h-3.5 rounded border-border accent-primary"
                  />
                  <span className="text-xs text-foreground group-hover:text-foreground/80 select-none">{ev.label}</span>
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WebhooksSettings() {
  const { data, isLoading } = useWebhooks();
  const createWebhook = useCreateWebhook();
  const updateWebhook = useUpdateWebhook();
  const deleteWebhook = useDeleteWebhook();

  const [showCreate, setShowCreate] = useState(false);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'created_at', dir: 'desc' });
  const [page, setPage] = useState(1);

  const [newUrl, setNewUrl] = useState('');
  const [newEvents, setNewEvents] = useState<string[]>(['contact.created', 'opportunity.updated']);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editingEventsId, setEditingEventsId] = useState<string | null>(null);
  const [editEvents, setEditEvents] = useState<string[]>([]);

  const PAGE_SIZE = 10;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webhooks: any[] = (data as any)?.data ?? [];

  const filtered = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let result: any[] = [...webhooks];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(wh => wh.url?.toLowerCase().includes(q));
    }
    if (statusFilter === 'active') result = result.filter(wh => wh.is_active !== false);
    if (statusFilter === 'inactive') result = result.filter(wh => wh.is_active === false);
    if (categoryFilter) {
      const group = WEBHOOK_EVENT_GROUPS.find(g => g.label === categoryFilter);
      if (group) {
        const vals = group.events.map(e => e.value);
        result = result.filter(wh => (wh.events ?? []).some((ev: string) => vals.includes(ev)));
      }
    }
    result.sort((a, b) => {
      const va: string = sort.key === 'url' ? (a.url ?? '') : (a[sort.key] ?? '');
      const vb: string = sort.key === 'url' ? (b.url ?? '') : (b[sort.key] ?? '');
      return sort.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    });
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webhooks, search, statusFilter, categoryFilter, sort]);

  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const resetCreate = () => {
    setShowCreate(false);
    setNewUrl('');
    setNewEvents(['contact.created', 'opportunity.updated']);
  };

  const handleCreate = async () => {
    if (!newUrl.trim() || newEvents.length === 0) return;
    try {
      await createWebhook.mutateAsync({ url: newUrl.trim(), events: newEvents });
      resetCreate();
      toast({ title: 'Webhook created' });
    } catch (err) {
      toast({
        title: 'Could not create webhook',
        description: err instanceof Error ? err.message : 'Check the endpoint URL and selected events, then try again.',
        variant: 'destructive',
      });
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const startEditEvents = (wh: any) => {
    setEditingEventsId(wh.id);
    setEditEvents(wh.events ?? []);
    setExpandedId(wh.id);
  };

  const handleSaveEvents = async (id: string) => {
    try {
      await updateWebhook.mutateAsync({ id, data: { events: editEvents } });
      setEditingEventsId(null);
      toast({ title: 'Webhook updated' });
    } catch (err) {
      toast({
        title: 'Could not update webhook',
        description: err instanceof Error ? err.message : 'Check the selected events and try again.',
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteWebhook.mutateAsync(id);
      setDeleteId(null);
      if (expandedId === id) setExpandedId(null);
      toast({ title: 'Webhook deleted' });
    } catch (err) {
      toast({
        title: 'Could not delete webhook',
        description: err instanceof Error ? err.message : 'Refresh the list and try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="font-display font-bold text-lg text-foreground">Webhooks</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Receive real-time HTTP POST notifications when operational events occur. Register a URL and choose which events to subscribe to.{' '}
          <button
            onClick={() => setShowHowItWorks(v => !v)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          >
            <Info className="w-3 h-3" />
            <span>{showHowItWorks ? 'Hide details' : 'How it works'}</span>
          </button>
        </p>

        {/* How it works — inline table */}
        {showHowItWorks && (
          <div className="mt-3 bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-sunken/50">
                  <th className="text-left px-4 py-2.5 text-xs font-display font-semibold text-muted-foreground w-36">Concept</th>
                  <th className="text-left px-4 py-2.5 text-xs font-display font-semibold text-muted-foreground">Detail</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { concept: 'Method', detail: <><code className="px-1 py-0.5 rounded bg-muted text-xs font-mono">POST</code> with a JSON body to your endpoint URL</> },
                  { concept: 'Timeout', detail: <>Your server must respond <code className="px-1 py-0.5 rounded bg-muted text-xs font-mono">2xx</code> within 10 seconds; failed deliveries appear in the log</> },
                  { concept: 'Payload fields', detail: <><code className="px-1 py-0.5 rounded bg-muted text-xs font-mono">event</code>, <code className="px-1 py-0.5 rounded bg-muted text-xs font-mono">timestamp</code>, <code className="px-1 py-0.5 rounded bg-muted text-xs font-mono">tenant_id</code>, <code className="px-1 py-0.5 rounded bg-muted text-xs font-mono">data</code> (the full object)</> },
                  { concept: 'Signature', detail: <><code className="px-1 py-0.5 rounded bg-muted text-xs font-mono">X-CRMy-Signature</code> header — HMAC-SHA256 of the raw body signed with your webhook secret</> },
                  { concept: 'Verification', detail: <pre className="text-[10px] font-mono bg-muted/60 rounded p-1.5 overflow-x-auto inline-block">{`crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex')`}</pre> },
                ].map(({ concept, detail }, i) => (
                  <tr key={concept} className={`border-b border-border last:border-0 ${i % 2 === 1 ? 'bg-surface-sunken/30' : ''}`}>
                    <td className="px-4 py-2.5 text-xs font-semibold text-muted-foreground align-top">{concept}</td>
                    <td className="px-4 py-2.5 text-xs text-foreground/80 align-top">{detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="p-5 rounded-xl border border-border bg-card space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Create new webhook</h3>
            <button onClick={resetCreate} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors"><X className="w-4 h-4" /></button>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Endpoint URL <span className="text-destructive">*</span></label>
            <input
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://your-server.com/webhook"
              className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Events <span className="text-destructive">*</span></label>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setNewEvents(ALL_WEBHOOK_EVENTS.map(e => e.value))} className="text-[10px] text-primary hover:underline">Select all</button>
                <button type="button" onClick={() => setNewEvents([])} className="text-[10px] text-muted-foreground hover:underline">Clear</button>
              </div>
            </div>
            <WebhookEventCheckboxes selected={newEvents} onChange={setNewEvents} />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleCreate}
              disabled={!newUrl.trim() || newEvents.length === 0 || createWebhook.isPending}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors"
            >
              {createWebhook.isPending ? 'Creating…' : 'Create Webhook'}
            </button>
            <button onClick={resetCreate} className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-0 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search webhooks…"
            className="w-full h-9 pl-9 pr-3 rounded-xl border border-border bg-card text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/30 transition-all" />
        </div>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value as 'all' | 'active' | 'inactive'); setPage(1); }}
          className="h-9 px-3 rounded-xl border border-border bg-card text-sm text-muted-foreground outline-none focus:ring-2 focus:ring-primary/30 flex-shrink-0">
          <option value="all">All status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <select value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(1); }}
          className="h-9 px-3 rounded-xl border border-border bg-card text-sm text-muted-foreground outline-none focus:ring-2 focus:ring-primary/30 flex-shrink-0">
          <option value="">All events</option>
          {WEBHOOK_EVENT_GROUPS.map(g => <option key={g.label} value={g.label}>{g.label}</option>)}
        </select>
        <select value={`${sort.key}_${sort.dir}`} onChange={e => { const [k, ...rest] = e.target.value.split('_'); setSort({ key: k, dir: rest.join('_') as 'asc' | 'desc' }); setPage(1); }}
          className="h-9 px-3 rounded-xl border border-border bg-card text-sm text-muted-foreground outline-none focus:ring-2 focus:ring-primary/30 flex-shrink-0">
          <option value="created_at_desc">Newest first</option>
          <option value="created_at_asc">Oldest first</option>
          <option value="url_asc">URL A–Z</option>
          <option value="url_desc">URL Z–A</option>
        </select>
        <button onClick={() => setShowCreate(true)} disabled={showCreate}
          className="h-9 px-4 flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-primary to-primary/80 text-primary-foreground text-sm font-semibold hover:shadow-md transition-all flex-shrink-0 press-scale disabled:opacity-50">
          <Plus className="w-4 h-4" /> New Webhook
        </button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">{[...Array(2)].map((_, i) => <div key={i} className="h-14 bg-muted/50 rounded-2xl animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-14 text-center">
          <Globe className="w-8 h-8 text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">{webhooks.length === 0 ? 'No webhooks configured yet.' : 'No webhooks match your filters.'}</p>
          {webhooks.length === 0 && <button onClick={() => setShowCreate(true)} className="mt-3 text-xs text-primary hover:underline">Create your first webhook</button>}
        </div>
      ) : (
        <>
          <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-sunken/50">
                    <th className="text-left px-4 py-3 text-xs font-display font-semibold text-muted-foreground">Endpoint</th>
                    <th className="text-left px-4 py-3 hidden md:table-cell text-xs font-display font-semibold text-muted-foreground">Events</th>
                    <th className="text-left px-4 py-3 hidden sm:table-cell text-xs font-display font-semibold text-muted-foreground">Status</th>
                    <th className="px-2 py-3 w-24" />
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((wh: any, i: number) => (
                    <React.Fragment key={wh.id}>
                      <tr
                        className={`border-b border-border last:border-0 hover:bg-primary/5 transition-colors group cursor-pointer ${i % 2 === 1 ? 'bg-surface-sunken/30' : ''}`}
                        onClick={() => { setExpandedId(prev => prev === wh.id ? null : wh.id); if (editingEventsId === wh.id) setEditingEventsId(null); }}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                              <Globe className="w-3.5 h-3.5 text-primary" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-foreground font-mono truncate">{wh.url}</p>
                              <p className="text-xs font-mono text-muted-foreground">{wh.id.slice(0, 14)}…</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => { setExpandedId(prev => prev === wh.id ? null : wh.id); if (editingEventsId === wh.id) setEditingEventsId(null); }}
                            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
                          >
                            <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border font-mono">
                              {(wh.events ?? []).length} event{(wh.events ?? []).length !== 1 ? 's' : ''}
                            </span>
                            <ChevronRight className={`w-3 h-3 text-muted-foreground transition-transform ${expandedId === wh.id ? 'rotate-90' : ''}`} />
                          </button>
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <span className={`inline-flex items-center gap-1.5 text-xs ${wh.is_active !== false ? 'text-emerald-500' : 'text-muted-foreground'}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${wh.is_active !== false ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
                            {wh.is_active !== false ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-2 py-3" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center gap-1 justify-end">
                            {deleteId === wh.id ? (
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-muted-foreground">Delete?</span>
                                <button onClick={() => handleDelete(wh.id)} className="px-2 py-1 rounded bg-destructive text-destructive-foreground text-xs font-semibold hover:bg-destructive/90 transition-colors">Yes</button>
                                <button onClick={() => setDeleteId(null)} className="px-2 py-1 rounded bg-muted text-muted-foreground text-xs hover:bg-muted/80 transition-colors">No</button>
                              </div>
                            ) : (
                              <>
                                <button onClick={() => startEditEvents(wh)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors opacity-0 group-hover:opacity-100" title="Edit events">
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => setDeleteId(wh.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100" title="Delete">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                            <button
                              onClick={() => { setExpandedId(prev => prev === wh.id ? null : wh.id); if (editingEventsId === wh.id) setEditingEventsId(null); }}
                              className={`p-1.5 rounded-lg transition-colors ${expandedId === wh.id ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
                            >
                              <ChevronRight className={`w-3.5 h-3.5 transition-transform ${expandedId === wh.id ? 'rotate-90' : ''}`} />
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expanded row */}
                      {expandedId === wh.id && (
                        <tr>
                          <td colSpan={4} className="p-0 border-b border-border last:border-0">
                            <div className="bg-muted/10">
                              {editingEventsId === wh.id ? (
                                <div className="p-4 space-y-3">
                                  <div className="flex items-center justify-between">
                                    <p className="text-xs font-display font-semibold text-muted-foreground uppercase tracking-wider">Edit subscribed events</p>
                                    <div className="flex gap-3">
                                      <button type="button" onClick={() => setEditEvents(ALL_WEBHOOK_EVENTS.map(e => e.value))} className="text-[10px] text-primary hover:underline">Select all</button>
                                      <button type="button" onClick={() => setEditEvents([])} className="text-[10px] text-muted-foreground hover:underline">Clear</button>
                                    </div>
                                  </div>
                                  <WebhookEventCheckboxes selected={editEvents} onChange={setEditEvents} />
                                  <div className="flex gap-2">
                                    <button onClick={() => handleSaveEvents(wh.id)} disabled={editEvents.length === 0 || updateWebhook.isPending}
                                      className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors">
                                      {updateWebhook.isPending ? 'Saving…' : 'Save Changes'}
                                    </button>
                                    <button onClick={() => setEditingEventsId(null)}
                                      className="px-3 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-semibold hover:bg-muted/80 transition-colors">
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div>
                                  <p className="text-xs font-display font-semibold text-muted-foreground uppercase tracking-wider px-4 pt-3 pb-1">Recent deliveries</p>
                                  <WebhookDeliveryLog webhookId={wh.id} />
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {filtered.length > PAGE_SIZE && (
            <PaginationBar page={page} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} />
          )}
        </>
      )}
    </div>
  );
}

const objectTypes = [
  { key: 'contact', label: 'Contact' },
  { key: 'account', label: 'Account' },
  { key: 'opportunity', label: 'Opportunity' },
  { key: 'use_case', label: 'Use Case' },
  { key: 'activity', label: 'Activity' },
];

const FIELD_TYPE_OPTIONS: { value: string; label: string; color: string }[] = [
  { value: 'text',         label: 'Text',         color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  { value: 'number',       label: 'Number',        color: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
  { value: 'boolean',      label: 'Checkbox',      color: 'bg-green-500/10 text-green-400 border-green-500/20' },
  { value: 'date',         label: 'Date',          color: 'bg-orange-500/10 text-orange-400 border-orange-500/20' },
  { value: 'select',       label: 'Dropdown',      color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' },
  { value: 'multi_select', label: 'Multi-select',  color: 'bg-pink-500/10 text-pink-400 border-pink-500/20' },
];

function fieldTypeColor(type: string) {
  return FIELD_TYPE_OPTIONS.find(o => o.value === type)?.color ?? 'bg-muted text-muted-foreground border-border';
}
function fieldTypeLabel(type: string) {
  return FIELD_TYPE_OPTIONS.find(o => o.value === type)?.label ?? type;
}
function toFieldKey(label: string) {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function CustomFieldsSettings() {
  const [activeTab, setActiveTab] = useState('contact');
  const [showCreate, setShowCreate] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newType, setNewType] = useState('text');
  const [newRequired, setNewRequired] = useState(false);
  const [newOptions, setNewOptions] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editRequired, setEditRequired] = useState(false);
  const [editOptions, setEditOptions] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const { data, isLoading } = useCustomFields(activeTab);
  const createField = useCreateCustomField();
  const updateField = useUpdateCustomField();
  const deleteField = useDeleteCustomField();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fields: any[] = (data as any)?.fields ?? [];

  const handleCreate = async () => {
    if (!newLabel.trim()) return;
    try {
      const needsOptions = newType === 'select' || newType === 'multi_select';
      const options = needsOptions && newOptions.trim()
        ? newOptions.split(',').map(o => o.trim()).filter(Boolean)
        : undefined;
      await createField.mutateAsync({
        label: newLabel.trim(),
        field_name: toFieldKey(newLabel),
        field_type: newType,
        object_type: activeTab,
        required: newRequired,
        ...(options ? { options } : {}),
      });
      setNewLabel(''); setNewType('text'); setNewRequired(false); setNewOptions('');
      setShowCreate(false);
      toast({ title: 'Custom field created' });
    } catch (err) {
      toast({
        title: 'Could not create custom field',
        description: err instanceof Error ? err.message : 'Check the label, type, and options, then try again.',
        variant: 'destructive',
      });
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const startEdit = (f: any) => {
    setEditingId(f.id);
    setEditLabel(f.label ?? '');
    setEditRequired(f.is_required ?? false);
    setEditOptions(Array.isArray(f.options) ? f.options.join(', ') : '');
    setShowCreate(false);
  };

  const handleUpdate = async () => {
    if (!editingId || !editLabel.trim()) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const field = fields.find((f: any) => f.id === editingId);
      const needsOptions = field?.field_type === 'select' || field?.field_type === 'multi_select';
      const options = needsOptions && editOptions.trim()
        ? editOptions.split(',').map(o => o.trim()).filter(Boolean)
        : undefined;
      await updateField.mutateAsync({
        id: editingId,
        label: editLabel.trim(),
        required: editRequired,
        ...(options !== undefined ? { options } : {}),
      });
      setEditingId(null);
      toast({ title: 'Custom field updated' });
    } catch (err) {
      toast({
        title: 'Could not update custom field',
        description: err instanceof Error ? err.message : 'Check the field settings and try again.',
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteField.mutateAsync(id);
      setConfirmDeleteId(null);
      toast({ title: 'Custom field deleted' });
    } catch (err) {
      toast({
        title: 'Could not delete custom field',
        description: err instanceof Error ? err.message : 'Refresh the list and try again.',
        variant: 'destructive',
      });
    }
  };

  const inputCls = 'w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display font-bold text-lg text-foreground">Custom Fields</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Define custom fields per object type. Values are type-checked and required fields are enforced by the server.
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1 overflow-x-auto no-scrollbar bg-muted rounded-xl p-0.5 flex-1 min-w-[220px]">
          {objectTypes.map((ot) => (
            <button key={ot.key} onClick={() => { setActiveTab(ot.key); setShowCreate(false); setEditingId(null); setConfirmDeleteId(null); }}
              className={`h-8 px-3 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${activeTab === ot.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
              {ot.label}
            </button>
          ))}
        </div>
        <button onClick={() => { setShowCreate(true); setEditingId(null); setConfirmDeleteId(null); }}
          disabled={showCreate}
          className="h-9 px-4 flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-primary to-primary/80 text-primary-foreground text-sm font-semibold hover:shadow-md transition-all flex-shrink-0 press-scale disabled:opacity-50">
          <Plus className="w-4 h-4" /> New Field
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="p-5 rounded-xl border border-border bg-card space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Create new field</h3>
            <button onClick={() => { setShowCreate(false); setNewLabel(''); setNewRequired(false); setNewOptions(''); }}
              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Label <span className="text-destructive">*</span></label>
            <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="e.g. Preferred Language"
              className={inputCls} onKeyDown={e => e.key === 'Enter' && handleCreate()} />
            {newLabel.trim() && (
              <p className="text-xs text-muted-foreground font-mono">key: {toFieldKey(newLabel)}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Type</label>
            <div className="flex flex-wrap gap-1.5">
              {FIELD_TYPE_OPTIONS.map(ft => (
                <button key={ft.value} onClick={() => setNewType(ft.value)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${newType === ft.value ? ft.color : 'bg-muted/50 border-border text-muted-foreground hover:text-foreground'}`}>
                  {ft.label}
                </button>
              ))}
            </div>
          </div>
          {(newType === 'select' || newType === 'multi_select') && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Options <span className="text-muted-foreground font-normal">(comma-separated)</span></label>
              <input value={newOptions} onChange={e => setNewOptions(e.target.value)} placeholder="Option A, Option B, Option C"
                className={inputCls} />
            </div>
          )}
          <button
            type="button"
            onClick={() => setNewRequired(!newRequired)}
            className={`h-9 flex items-center gap-2 px-3 rounded-lg border text-sm font-semibold transition-all ${
              newRequired
                ? 'bg-primary/10 border-primary/40 text-primary'
                : 'bg-muted border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            <span className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center flex-shrink-0 transition-all ${
              newRequired ? 'bg-primary border-primary' : 'border-border'
            }`}>
              {newRequired && <svg viewBox="0 0 10 8" className="w-2.5 h-2.5 fill-none stroke-white stroke-[1.5]"><polyline points="1,4 4,7 9,1"/></svg>}
            </span>
            Required field
          </button>
          <div className="flex gap-2 pt-1">
            <button onClick={handleCreate} disabled={!newLabel.trim() || createField.isPending}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors">
              {createField.isPending ? 'Creating…' : 'Create Field'}
            </button>
            <button onClick={() => { setShowCreate(false); setNewLabel(''); setNewRequired(false); setNewOptions(''); }}
              className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Fields list */}
      <div className="space-y-2">
        {isLoading ? (
          <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-muted/50 rounded-xl animate-pulse" />)}</div>
        ) : fields.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No custom fields for this object type yet.</p>
        ) : fields.map((f: any) => (
          <div key={f.id} className="rounded-xl border border-border bg-card overflow-hidden">
            {editingId === f.id ? (
              <div className="p-4 space-y-3">
                <p className="text-xs font-display font-semibold text-muted-foreground uppercase tracking-wider">Edit Field</p>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Label</label>
                  <input value={editLabel} onChange={e => setEditLabel(e.target.value)} className={inputCls} />
                </div>
                {(f.field_type === 'select' || f.field_type === 'multi_select') && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Options <span className="text-muted-foreground font-normal">(comma-separated)</span></label>
                    <input value={editOptions} onChange={e => setEditOptions(e.target.value)} placeholder="Option A, Option B" className={inputCls} />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setEditRequired(!editRequired)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                    editRequired
                      ? 'bg-primary/10 border-primary/40 text-primary'
                      : 'bg-muted border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <span className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center flex-shrink-0 transition-all ${
                    editRequired ? 'bg-primary border-primary' : 'border-border'
                  }`}>
                    {editRequired && <svg viewBox="0 0 10 8" className="w-2.5 h-2.5 fill-none stroke-white stroke-[1.5]"><polyline points="1,4 4,7 9,1"/></svg>}
                  </span>
                  Required field
                </button>
                <div className="flex gap-2">
                  <button onClick={handleUpdate} disabled={!editLabel.trim() || updateField.isPending}
                    className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors">
                    {updateField.isPending ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => setEditingId(null)} className="px-3 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-semibold hover:bg-muted/80 transition-colors">Cancel</button>
                </div>
              </div>
            ) : confirmDeleteId === f.id ? (
              <div className="p-4 flex items-center gap-3 flex-wrap">
                <p className="text-sm text-foreground flex-1">Delete <strong>{f.label}</strong>? Existing values will remain but won't be validated.</p>
                <button onClick={() => handleDelete(f.id)} disabled={deleteField.isPending}
                  className="px-3 py-1.5 rounded-lg bg-destructive text-destructive-foreground text-xs font-semibold hover:bg-destructive/90 disabled:opacity-40 transition-colors">
                  {deleteField.isPending ? 'Deleting…' : 'Confirm Delete'}
                </button>
                <button onClick={() => setConfirmDeleteId(null)} className="px-3 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-semibold">Cancel</button>
              </div>
            ) : (
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-foreground">{f.label}</p>
                    {f.is_required && (
                      <span className="text-xs px-1.5 py-0.5 rounded border bg-destructive/10 text-destructive border-destructive/20 font-semibold">Required</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className={`text-xs px-1.5 py-0.5 rounded border font-mono font-medium ${fieldTypeColor(f.field_type)}`}>
                      {fieldTypeLabel(f.field_type)}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">{f.field_key}</span>
                    {Array.isArray(f.options) && f.options.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {f.options.slice(0, 3).join(', ')}{f.options.length > 3 ? ` +${f.options.length - 3}` : ''}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => { startEdit(f); setConfirmDeleteId(null); }}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => { setConfirmDeleteId(f.id); setEditingId(null); }}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const PASSWORD_RULES = [
  { label: 'At least 8 characters', test: (p: string) => p.length >= 8 },
  { label: 'One uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'One number', test: (p: string) => /\d/.test(p) },
  { label: 'One special character', test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];
const ROLES = ['member', 'manager', 'admin', 'owner'] as const;
type Role = typeof ROLES[number];
const roleLabels: Record<Role, string> = { member: 'Member', manager: 'Manager', admin: 'Admin', owner: 'Owner' };

function isValidEmail(email: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function isStrongPassword(p: string) { return PASSWORD_RULES.every(r => r.test(p)); }

type UserRow = { id: string; email: string; name: string; role: string; manager_id?: string | null; created_at: string };

interface UserFormState {
  name: string; email: string; password: string; role: Role; manager_id?: string;
  showPassword: boolean; touched: Record<string, boolean>;
}

function initForm(defaults?: Partial<UserFormState>): UserFormState {
  return { name: '', email: '', password: '', role: 'member', showPassword: false, touched: {}, ...defaults };
}

function UserForm({
  form, onChange, onTouch, isEdit, currentUserRole, users = [],
}: {
  form: UserFormState;
  onChange: (patch: Partial<UserFormState>) => void;
  onTouch: (field: string) => void;
  isEdit: boolean;
  currentUserRole: string;
  users?: UserRow[];
}) {
  const nameErr = form.touched.name && !form.name.trim() ? 'Name is required' : '';
  const emailErr = form.touched.email && !isValidEmail(form.email) ? 'Enter a valid email address' : '';
  const passwordErr = form.touched.password && !isEdit && !isStrongPassword(form.password)
    ? 'Password does not meet requirements'
    : form.touched.password && !isEdit && !form.password ? 'Password is required' : '';
  const optionalPasswordErr = isEdit && form.password && !isStrongPassword(form.password)
    ? 'Password does not meet requirements' : '';

  const fieldCls = (err: string) =>
    `w-full h-9 px-3 rounded-lg border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring transition-colors ${err ? 'border-destructive focus:ring-destructive' : 'border-border'}`;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Name <span className="text-destructive">*</span></label>
          <input value={form.name} onChange={e => onChange({ name: e.target.value })} onBlur={() => onTouch('name')}
            placeholder="Jane Smith" className={fieldCls(nameErr)} />
          {nameErr && <p className="text-xs text-destructive">{nameErr}</p>}
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Email <span className="text-destructive">*</span></label>
          <input type="email" value={form.email} onChange={e => onChange({ email: e.target.value })} onBlur={() => onTouch('email')}
            placeholder="jane@company.com" className={fieldCls(emailErr)} />
          {emailErr && <p className="text-xs text-destructive">{emailErr}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Password {isEdit ? <span className="text-muted-foreground font-normal">(leave blank to keep)</span> : <span className="text-destructive">*</span>}
          </label>
          <div className="relative">
            <input type={form.showPassword ? 'text' : 'password'} value={form.password}
              onChange={e => onChange({ password: e.target.value })} onBlur={() => onTouch('password')}
              placeholder={isEdit ? '••••••••' : 'Min. 8 characters'} className={`${fieldCls(passwordErr || optionalPasswordErr)} pr-9`} />
            <button type="button" onClick={() => onChange({ showPassword: !form.showPassword })}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              {form.showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
          {(form.touched.password || form.password) && (
            <ul className="space-y-0.5 mt-1">
              {PASSWORD_RULES.map(rule => {
                const ok = rule.test(form.password);
                return (
                  <li key={rule.label} className={`flex items-center gap-1 text-xs ${ok ? 'text-success' : 'text-muted-foreground'}`}>
                    <CheckCircle2 className={`w-3 h-3 ${ok ? 'opacity-100' : 'opacity-30'}`} /> {rule.label}
                  </li>
                );
              })}
            </ul>
          )}
          {passwordErr && <p className="text-xs text-destructive">{passwordErr}</p>}
          {optionalPasswordErr && <p className="text-xs text-destructive">{optionalPasswordErr}</p>}
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Role <span className="text-destructive">*</span></label>
          <select value={form.role} onChange={e => onChange({ role: e.target.value as Role })}
            className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:ring-1 focus:ring-ring appearance-none">
            {ROLES.filter(r => r !== 'owner' || currentUserRole === 'owner').map(r => (
              <option key={r} value={r}>{roleLabels[r]}</option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            {form.role === 'owner' ? 'Full access including billing and account deletion' : form.role === 'admin' ? 'Can manage users, settings, and all data' : form.role === 'manager' ? 'Can see their own book plus reporting users' : 'Can access owned records only'}
          </p>
          {form.role === 'member' && (
            <div className="pt-2 space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Manager</label>
              <select
                value={form.manager_id ?? ''}
                onChange={e => onChange({ manager_id: e.target.value || undefined })}
                className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:ring-1 focus:ring-ring appearance-none"
              >
                <option value="">No manager</option>
                {users.filter(u => ['manager', 'admin', 'owner'].includes(u.role)).map(u => (
                  <option key={u.id} value={u.id}>{u.name} ({roleLabels[u.role as Role] ?? u.role})</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function UserAvatar({ name, size = 'sm' }: { name: string; size?: 'sm' | 'lg' }) {
  const initials = name.trim().split(/\s+/).map(n => n[0]).slice(0, 2).join('').toUpperCase() || '?';
  const sz = size === 'lg' ? 'w-10 h-10 text-sm' : 'w-8 h-8 text-xs';
  return (
    <div className={`${sz} rounded-xl bg-primary/15 flex items-center justify-center flex-shrink-0`}>
      <span className="font-display font-bold text-primary">{initials}</span>
    </div>
  );
}

function UsersSettings() {
  const currentUser = getUser();
  const currentUserRole = currentUser?.role ?? 'member';
  const { data, isLoading } = useUsers();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();

  const isMobile = useIsMobile();
  const [view, setView] = useState<'table' | 'cards'>('table');
  const effectiveView = isMobile ? 'cards' : view;

  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({});
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<UserFormState>(initForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<UserFormState>(initForm());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const allUsers: UserRow[] = (data as { data: UserRow[] } | undefined)?.data ?? [];

  const filtered = useMemo(() => {
    let result = [...allUsers];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
    }
    if (activeFilters.role?.length) result = result.filter(u => activeFilters.role.includes(u.role));
    if (sort) {
      result.sort((a, b) => {
        const aVal = String(a[sort.key as keyof UserRow] ?? '');
        const bVal = String(b[sort.key as keyof UserRow] ?? '');
        return sort.dir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      });
    }
    return result;
  }, [allUsers, search, activeFilters, sort]);

  useEffect(() => { setPage(1); }, [search, activeFilters, sort]);
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  const filterConfigs: FilterConfig[] = [
    {
      key: 'role', label: 'Role', options: [
        { value: 'owner', label: 'Owner' },
        { value: 'admin', label: 'Admin' },
        { value: 'manager', label: 'Manager' },
        { value: 'member', label: 'Member' },
      ],
    },
  ];

  const sortOptions: SortOption[] = [
    { key: 'name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'role', label: 'Role' },
    { key: 'created_at', label: 'Joined' },
  ];

  const handleFilterChange = (key: string, values: string[]) => {
    setActiveFilters(prev => { const next = { ...prev }; if (values.length === 0) delete next[key]; else next[key] = values; return next; });
  };
  const handleSortChange = (key: string) => {
    setSort(prev => prev?.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  };

  const touchAll = (form: UserFormState): UserFormState => ({
    ...form, touched: { name: true, email: true, password: true },
  });

  const handleCreate = async () => {
    const f = touchAll(createForm);
    setCreateForm(f);
    if (!f.name.trim() || !isValidEmail(f.email) || !isStrongPassword(f.password)) return;
    try {
      await createUser.mutateAsync({ name: f.name.trim(), email: f.email.trim(), password: f.password, role: f.role, manager_id: f.manager_id || null });
      setShowCreate(false);
      setCreateForm(initForm());
      toast({ title: 'User created' });
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed to create user', variant: 'destructive' });
    }
  };

  const startEdit = (u: UserRow) => {
    setEditingId(u.id);
    setEditForm(initForm({ name: u.name, email: u.email, role: u.role as Role, manager_id: u.manager_id ?? undefined }));
  };

  const handleUpdate = async () => {
    const f = touchAll(editForm);
    setEditForm(f);
    if (!f.name.trim() || !isValidEmail(f.email)) return;
    if (f.password && !isStrongPassword(f.password)) return;
    try {
      await updateUser.mutateAsync({
        id: editingId!,
        name: f.name.trim(),
        email: f.email.trim(),
        role: f.role,
        manager_id: f.manager_id || null,
        ...(f.password ? { password: f.password } : {}),
      });
      setEditingId(null);
      toast({ title: 'User updated' });
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed to update user', variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteUser.mutateAsync(id);
      setConfirmDeleteId(null);
      toast({ title: 'User deleted' });
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed to delete user', variant: 'destructive' });
    }
  };

  const rolePillCls: Record<string, string> = {
    owner: 'bg-accent/15 text-accent border-accent/30',
    admin: 'bg-primary/15 text-primary border-primary/30',
    manager: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    member: 'bg-muted text-muted-foreground border-border',
  };

  const SortHeader = ({ label, sortKey }: { label: string; sortKey: string }) => (
    <th
      onClick={() => handleSortChange(sortKey)}
      className="text-left px-4 py-3 text-xs font-display font-semibold text-muted-foreground cursor-pointer hover:text-foreground transition-colors select-none"
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sort?.key === sortKey ? (sort.dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : null}
      </span>
    </th>
  );

  const InlineEditActions = ({ onSave, onCancel, isPending }: { onSave: () => void; onCancel: () => void; isPending: boolean }) => (
    <div className="flex gap-2 pt-2">
      <button onClick={onSave} disabled={isPending}
        className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors">
        {isPending ? 'Saving…' : 'Save Changes'}
      </button>
      <button onClick={onCancel}
        className="px-3 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-semibold hover:bg-muted/80 transition-colors">
        Cancel
      </button>
    </div>
  );

  return (
    <div className="-mx-6 -my-6 flex flex-col">
      {/* Page header */}
      <div className="flex items-start justify-between px-6 pt-6 pb-3">
        <div>
          <h2 className="font-display font-bold text-lg text-foreground">Team Members</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Manage who has access to your CRMy workspace.</p>
        </div>
        <div className="hidden md:flex items-center gap-1 bg-muted rounded-xl p-0.5 mt-0.5">
          <button
            onClick={() => setView('table')}
            className={`p-1.5 rounded-lg text-sm transition-all ${view === 'table' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <List className="w-4 h-4" />
          </button>
          <button
            onClick={() => setView('cards')}
            className={`p-1.5 rounded-lg text-sm transition-all ${view === 'cards' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <ListToolbar
        searchValue={search} onSearchChange={setSearch} searchPlaceholder="Search users..."
        filters={filterConfigs} activeFilters={activeFilters} onFilterChange={handleFilterChange}
        onClearFilters={() => setActiveFilters({})} sortOptions={sortOptions} currentSort={sort}
        onSortChange={handleSortChange}
        onAdd={() => { setShowCreate(true); setEditingId(null); setConfirmDeleteId(null); }}
        addLabel="New User" entityType="users"
      />

      <div className="px-4 md:px-6 pb-8 space-y-3 mt-1">
        {/* Create form */}
        {showCreate && (
          <div className="p-4 rounded-xl border border-border bg-muted/30 space-y-4">
            <p className="text-xs font-display font-semibold text-muted-foreground uppercase tracking-wider">New User</p>
            <UserForm
              form={createForm} onChange={p => setCreateForm(f => ({ ...f, ...p }))}
              onTouch={field => setCreateForm(f => ({ ...f, touched: { ...f.touched, [field]: true } }))}
              isEdit={false} currentUserRole={currentUserRole} users={allUsers}
            />
            <div className="flex gap-2 pt-1">
              <button onClick={handleCreate} disabled={createUser.isPending}
                className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors">
                {createUser.isPending ? 'Creating...' : 'Create User'}
              </button>
              <button onClick={() => { setShowCreate(false); setCreateForm(initForm()); }}
                className="px-3 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-semibold hover:bg-muted/80 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Content */}
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => <div key={i} className="h-14 bg-muted/50 rounded-xl animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Users className="w-8 h-8 mb-3 opacity-30" />
            <p className="text-sm">No users found.</p>
            {(search || Object.keys(activeFilters).length > 0) && (
              <button
                onClick={() => { setSearch(''); setActiveFilters({}); }}
                className="mt-2 text-xs text-primary font-semibold hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : effectiveView === 'table' ? (
          /* ── Table view ── */
          <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-sunken/50">
                    <SortHeader label="Name" sortKey="name" />
                    <SortHeader label="Email" sortKey="email" />
                    <SortHeader label="Role" sortKey="role" />
                    <SortHeader label="Joined" sortKey="created_at" />
                    <th className="px-2 py-3 w-20" />
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((u, i) => (
                    <React.Fragment key={u.id}>
                      {editingId === u.id ? (
                        <tr>
                          <td colSpan={5} className="p-4 bg-muted/20 border-b border-border last:border-0">
                            <p className="text-xs font-display font-semibold text-muted-foreground uppercase tracking-wider mb-3">Edit User</p>
                            <UserForm
                              form={editForm} onChange={p => setEditForm(f => ({ ...f, ...p }))}
                              onTouch={field => setEditForm(f => ({ ...f, touched: { ...f.touched, [field]: true } }))}
                              isEdit={true} currentUserRole={currentUserRole} users={allUsers.filter(user => user.id !== editingId)}
                            />
                            <InlineEditActions onSave={handleUpdate} onCancel={() => setEditingId(null)} isPending={updateUser.isPending} />
                          </td>
                        </tr>
                      ) : confirmDeleteId === u.id ? (
                        <tr className={`border-b border-border last:border-0 ${i % 2 === 1 ? 'bg-surface-sunken/30' : ''}`}>
                          <td colSpan={5} className="px-4 py-3">
                            <div className="flex items-center gap-3 flex-wrap">
                              <p className="text-sm text-foreground flex-1">Delete <strong>{u.name}</strong>? This cannot be undone.</p>
                              <button onClick={() => handleDelete(u.id)} disabled={deleteUser.isPending}
                                className="px-3 py-1.5 rounded-lg bg-destructive text-destructive-foreground text-xs font-semibold hover:bg-destructive/90 disabled:opacity-40 transition-colors">
                                {deleteUser.isPending ? 'Deleting...' : 'Confirm Delete'}
                              </button>
                              <button onClick={() => setConfirmDeleteId(null)}
                                className="px-3 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-semibold hover:bg-muted/80 transition-colors">
                                Cancel
                              </button>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        <tr className={`border-b border-border last:border-0 hover:bg-primary/5 transition-colors group ${i % 2 === 1 ? 'bg-surface-sunken/30' : ''}`}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <UserAvatar name={u.name} />
                              <div>
                                <div className="flex items-center gap-1.5">
                                  <span className="font-semibold text-foreground">{u.name}</span>
                                  {u.id === currentUser?.id && (
                                    <span className="text-xs font-mono bg-muted text-muted-foreground px-1.5 py-0.5 rounded">you</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${rolePillCls[u.role] ?? rolePillCls.member}`}>
                              {roleLabels[u.role as Role] ?? u.role}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
                          </td>
                          <td className="px-2 py-3">
                            <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-all">
                              <button
                                onClick={() => { startEdit(u); setConfirmDeleteId(null); }}
                                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                disabled={u.id === currentUser?.id}
                                onClick={() => { setConfirmDeleteId(u.id); setEditingId(null); }}
                                className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <PaginationBar page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={setPageSize} className="px-4" />
          </div>
        ) : (
          /* ── Card view ── */
          <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {paginated.map((u, i) => (
              editingId === u.id ? (
                <motion.div
                  key={u.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className="col-span-full bg-card border border-border rounded-2xl p-4 space-y-4"
                >
                  <p className="text-xs font-display font-semibold text-muted-foreground uppercase tracking-wider">Edit User</p>
                  <UserForm
                    form={editForm} onChange={p => setEditForm(f => ({ ...f, ...p }))}
                    onTouch={field => setEditForm(f => ({ ...f, touched: { ...f.touched, [field]: true } }))}
                    isEdit={true} currentUserRole={currentUserRole} users={allUsers.filter(user => user.id !== editingId)}
                  />
                  <InlineEditActions onSave={handleUpdate} onCancel={() => setEditingId(null)} isPending={updateUser.isPending} />
                </motion.div>
              ) : confirmDeleteId === u.id ? (
                <motion.div
                  key={u.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className="bg-card border border-destructive/30 rounded-2xl p-4"
                >
                  <p className="text-sm text-foreground mb-3">Delete <strong>{u.name}</strong>? This cannot be undone.</p>
                  <div className="flex gap-2">
                    <button onClick={() => handleDelete(u.id)} disabled={deleteUser.isPending}
                      className="px-3 py-1.5 rounded-lg bg-destructive text-destructive-foreground text-xs font-semibold hover:bg-destructive/90 disabled:opacity-40 transition-colors">
                      {deleteUser.isPending ? 'Deleting...' : 'Confirm Delete'}
                    </button>
                    <button onClick={() => setConfirmDeleteId(null)}
                      className="px-3 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-semibold hover:bg-muted/80 transition-colors">
                      Cancel
                    </button>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key={u.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
                  className="bg-card border border-border rounded-2xl p-4 hover:shadow-md hover:border-primary/20 transition-all group relative"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <UserAvatar name={u.name} size="lg" />
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="font-display font-bold text-foreground">{u.name}</p>
                          {u.id === currentUser?.id && (
                            <span className="text-xs font-mono bg-muted text-muted-foreground px-1.5 py-0.5 rounded">you</span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{u.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0 md:opacity-0 md:group-hover:opacity-100 transition-all">
                      <button
                        onClick={() => { startEdit(u); setConfirmDeleteId(null); }}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        disabled={u.id === currentUser?.id}
                        onClick={() => { setConfirmDeleteId(u.id); setEditingId(null); }}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${rolePillCls[u.role] ?? rolePillCls.member}`}>
                      {roleLabels[u.role as Role] ?? u.role}
                    </span>
                    {u.created_at && (
                      <span className="text-xs text-muted-foreground">
                        {new Date(u.created_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </motion.div>
              )
            ))}
          </div>
          <PaginationBar page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </>
        )}
      </div>
    </div>
  );
}

function SystemsOfRecordSettings() {
  const location = useLocation();
  const { data: systemsData, isLoading: systemsLoading } = useSystemsOfRecord({ limit: 50 });
  const { data: mappingsData } = useSystemMappings({ limit: 100 });
  const { data: runsData } = useSystemSyncRuns({ limit: 20 });
  const { data: conflictsData } = useSystemConflicts({ limit: 20 });
  const { data: writebacksData } = useSystemWritebacks({ limit: 20 });
  const createSystem = useCreateSystemOfRecord();
  const updateSystem = useUpdateSystemOfRecord();
  const deleteSystem = useDeleteSystemOfRecord();
  const testSystem = useTestSystemOfRecord();
  const runSync = useRunSystemSync();
  const upsertMapping = useUpsertSystemMapping();
  const deleteMapping = useDeleteSystemMapping();
  const resolveConflict = useResolveSystemConflict();
  const previewWriteback = usePreviewSystemWriteback();
  const requestWriteback = useRequestSystemWriteback();
  const executeWriteback = useExecuteSystemWriteback();
  const reviewWriteback = useReviewSystemWriteback();

  const [tab, setTab] = useState<'systems' | 'mappings' | 'activity' | 'advanced'>('systems');
  const [addWizardStep, setAddWizardStep] = useState(0);
  const [setupReadObjects, setSetupReadObjects] = useState<string[]>(['account', 'contact', 'opportunity']);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [systemType, setSystemType] = useState('');
  const [authType, setAuthType] = useState('');
  const [credentialInput, setCredentialInput] = useState('');
  const [hubSpotAppId, setHubSpotAppId] = useState('');
  const [hubSpotClientId, setHubSpotClientId] = useState('');
  const [hubSpotClientSecret, setHubSpotClientSecret] = useState('');
  const [hubSpotInstallUrl, setHubSpotInstallUrl] = useState('');
  const [configInput, setConfigInput] = useState('{}');
  const [syncInput, setSyncInput] = useState('{"default_limit":100}');
  const [editingSystemId, setEditingSystemId] = useState('');
  const [editName, setEditName] = useState('');
  const [editAuthType, setEditAuthType] = useState('oauth_app');
  const [editCredentialInput, setEditCredentialInput] = useState('');
  const [editHubSpotAppId, setEditHubSpotAppId] = useState('');
  const [editHubSpotClientId, setEditHubSpotClientId] = useState('');
  const [editHubSpotClientSecret, setEditHubSpotClientSecret] = useState('');
  const [editHubSpotInstallUrl, setEditHubSpotInstallUrl] = useState('');
  const [editHubSpotRedirectOrCode, setEditHubSpotRedirectOrCode] = useState('');
  const [editConfigInput, setEditConfigInput] = useState('{}');
  const [editSyncInput, setEditSyncInput] = useState('{}');

  const [mappingSystemId, setMappingSystemId] = useState('');
  const [mappingObjectType, setMappingObjectType] = useState('contact');
  const [mappingExternalObject, setMappingExternalObject] = useState('contacts');
  const [mappingIdField, setMappingIdField] = useState('id');
  const [mappingWatermarkField, setMappingWatermarkField] = useState('updatedAt');
  const [mappingFieldJson, setMappingFieldJson] = useState('{\n  "email": "email",\n  "first_name": "firstname",\n  "last_name": "lastname"\n}');
  const [mappingCrmyField, setMappingCrmyField] = useState('email');
  const [mappingExternalField, setMappingExternalField] = useState('');
  const [mappingReadableFields, setMappingReadableFields] = useState('');
  const [mappingWritableFields, setMappingWritableFields] = useState('');
  const [mappingSourceAuthority, setMappingSourceAuthority] = useState('external');
  const [mappingWritebackMode, setMappingWritebackMode] = useState('');
  const [mappingWritebackConfigJson, setMappingWritebackConfigJson] = useState('{}');
  const [mappingAllowSourceLoop, setMappingAllowSourceLoop] = useState(false);
  const [mappingIsActive, setMappingIsActive] = useState(true);
  const [editingMappingId, setEditingMappingId] = useState('');
  const [confirmDeleteMappingId, setConfirmDeleteMappingId] = useState('');
  const [discoveryMode, setDiscoveryMode] = useState<'objects' | 'fields' | ''>('');
  const [discoveryObjectName, setDiscoveryObjectName] = useState('');
  const [writebackSystemId, setWritebackSystemId] = useState('');
  const [writebackMappingId, setWritebackMappingId] = useState('');
  const [writebackObjectType, setWritebackObjectType] = useState('contact');
  const [writebackObjectId, setWritebackObjectId] = useState('');
  const [writebackExternalObject, setWritebackExternalObject] = useState('contacts');
  const [writebackExternalRecordId, setWritebackExternalRecordId] = useState('');
  const [writebackOperation, setWritebackOperation] = useState('update');
  const [writebackMode, setWritebackMode] = useState('mapped_upsert');
  const [writebackRequireApproval, setWritebackRequireApproval] = useState(true);
  const [writebackPayloadJson, setWritebackPayloadJson] = useState('{\n  "email": "customer@example.com"\n}');
  const [writebackPreview, setWritebackPreview] = useState<Record<string, unknown> | null>(null);
  const processedHubSpotOAuthCode = useRef('');

  const systems = systemsData?.data ?? [];
  const mappings = mappingsData?.data ?? [];
  const runs = (runsData?.data ?? []) as Array<Record<string, unknown>>;
  const conflicts = (conflictsData?.data ?? []) as Array<Record<string, unknown>>;
  const writebacks = (writebacksData?.data ?? []) as Array<Record<string, unknown>>;
  const discovery = useDiscoverSystemOfRecord(
    discoveryMode ? mappingSystemId : undefined,
    discoveryMode === 'fields' ? discoveryObjectName : undefined,
  );
  const discoveryItems = Array.isArray((discovery.data as { data?: unknown[] } | undefined)?.data)
    ? (discovery.data as { data: Array<Record<string, unknown>> }).data
    : [];
  const mappingFieldOptions = useMemo(() => {
    const common = [
      { value: 'external_id', label: 'External ID' },
      { value: 'name', label: 'Name' },
    ];
    const byObject: Record<string, Array<{ value: string; label: string }>> = {
      contact: [
        { value: 'first_name', label: 'First name' },
        { value: 'last_name', label: 'Last name' },
        { value: 'email', label: 'Email' },
        { value: 'phone', label: 'Phone' },
        { value: 'title', label: 'Title' },
        { value: 'company_name', label: 'Account name' },
        { value: 'lifecycle_stage', label: 'Lifecycle stage' },
        { value: 'lead_score', label: 'Lead score' },
      ],
      account: [
        { value: 'name', label: 'Account name' },
        { value: 'domain', label: 'Domain' },
        { value: 'industry', label: 'Industry' },
        { value: 'annual_revenue', label: 'Annual revenue' },
        { value: 'employee_count', label: 'Employee count' },
        { value: 'health_score', label: 'Health score' },
      ],
      opportunity: [
        { value: 'name', label: 'Opportunity name' },
        { value: 'amount', label: 'Amount' },
        { value: 'stage', label: 'Stage' },
        { value: 'probability', label: 'Probability' },
        { value: 'close_date', label: 'Close date' },
        { value: 'health_score', label: 'Health score' },
      ],
      activity: [
        { value: 'type', label: 'Activity type' },
        { value: 'description', label: 'Description' },
        { value: 'occurred_at', label: 'Occurred at' },
        { value: 'actor_name', label: 'Actor name' },
      ],
      context_entry: [
        { value: 'content', label: 'Content' },
        { value: 'source', label: 'Source' },
        { value: 'confidence', label: 'Confidence' },
        { value: 'expires_at', label: 'Expires at' },
      ],
    };
    return byObject[mappingObjectType] ?? common;
  }, [mappingObjectType]);

  useEffect(() => {
    if (!mappingSystemId && systems[0]?.id) setMappingSystemId(systems[0].id);
  }, [mappingSystemId, systems]);

  useEffect(() => {
    if (!writebackSystemId && systems[0]?.id) setWritebackSystemId(systems[0].id);
  }, [writebackSystemId, systems]);

  useEffect(() => {
    setDiscoveryMode('');
    setDiscoveryObjectName('');
  }, [mappingSystemId]);

  useEffect(() => {
    setMappingCrmyField(mappingFieldOptions[0]?.value ?? 'name');
  }, [mappingFieldOptions]);

  const writebackMappings = useMemo(
    () => mappings.filter(mapping => !writebackSystemId || mapping.system_id === writebackSystemId),
    [mappings, writebackSystemId],
  );

  const hubSpotRedirectOrigin = typeof window !== 'undefined'
    ? ['127.0.0.1', '::1'].includes(window.location.hostname)
      ? `${window.location.protocol}//localhost${window.location.port ? `:${window.location.port}` : ''}`
      : window.location.origin
    : '';
  const recommendedHubSpotRedirectUri = hubSpotRedirectOrigin
    ? `${hubSpotRedirectOrigin}/app/settings/systems/oauth/hubspot/callback`
    : '/app/settings/systems/oauth/hubspot/callback';
  const currentOriginMatchesHubSpotRedirect = typeof window === 'undefined'
    || window.location.origin === hubSpotRedirectOrigin;

  const parseJson = (label: string, value: string) => {
    try {
      return value.trim() ? JSON.parse(value) as Record<string, unknown> : {};
    } catch {
      throw new Error(`${label} must be valid JSON.`);
    }
  };
  const parseCsvList = (value: string) =>
    value.split(',').map(item => item.trim()).filter(Boolean);
  const csvList = (value?: string[]) => (value ?? []).join(', ');

  const systemLabel = (type: string) => {
    if (type === 'hubspot') return 'HubSpot';
    if (type === 'salesforce') return 'Salesforce';
    if (type === 'databricks') return 'Databricks';
    if (type === 'snowflake') return 'Snowflake';
    if (type === 'other') return 'Custom API / MCP';
    return 'System';
  };

  const connectorOptions = [
    { type: 'hubspot', label: 'HubSpot', fit: 'CRM contacts, accounts, deals, and activity notes.', auth: 'OAuth app recommended' },
    { type: 'salesforce', label: 'Salesforce', fit: 'CRM accounts, contacts, opportunities, and tasks.', auth: 'Connected app OAuth' },
    { type: 'databricks', label: 'Databricks', fit: 'Warehouse tables and governed SQL templates.', auth: 'SQL Warehouse token' },
    { type: 'snowflake', label: 'Snowflake', fit: 'Warehouse views, tables, and controlled write templates.', auth: 'SQL API token' },
    { type: 'other', label: 'Custom API / MCP', fit: 'Use scoped API keys, REST, CLI, or MCP tools for custom connectors today.', auth: 'API key + MCP tools' },
  ];

  const objectOptions = [
    { key: 'account', label: 'Accounts', description: 'Companies or customer organizations.' },
    { key: 'contact', label: 'Contacts', description: 'People tied to customer work.' },
    { key: 'opportunity', label: 'Opportunities', description: 'Deals, renewals, expansions, or pipeline.' },
    { key: 'activity', label: 'Activities', description: 'Notes, tasks, calls, emails, or events.' },
    { key: 'use_case', label: 'Use Cases', description: 'Customer outcomes and adoption work.', limited: true },
  ];

  const selectedReadOptions = objectOptions.filter(option => setupReadObjects.includes(option.key));

  const mappingFieldPairs = useMemo(() => {
    try {
      return Object.entries(parseJson('Field mapping', mappingFieldJson))
        .map(([crmyField, externalField]) => [crmyField, String(externalField)] as const)
        .filter(([, externalField]) => externalField.trim());
    } catch {
      return [] as Array<readonly [string, string]>;
    }
  }, [mappingFieldJson]);

  const writableFieldSet = useMemo(() => new Set(parseCsvList(mappingWritableFields)), [mappingWritableFields]);

  const toggleReadObject = (key: string) => {
    setSetupReadObjects(current => current.includes(key)
      ? current.filter(item => item !== key)
      : [...current, key]);
  };

  const setCsvValue = (value: string, nextItem: string, checked: boolean) => {
    const current = new Set(parseCsvList(value));
    if (checked) current.add(nextItem);
    else current.delete(nextItem);
    return Array.from(current).join(', ');
  };

  const toggleWritableField = (externalField: string, checked: boolean) => {
    setMappingWritableFields(current => setCsvValue(current, externalField, checked));
    if (checked && !mappingWritebackMode) setMappingWritebackMode('mapped_upsert');
  };

  const updateMappedField = (crmyField: string, externalField: string) => {
    try {
      const current = parseJson('Field mapping', mappingFieldJson);
      setMappingFieldJson(JSON.stringify({ ...current, [crmyField]: externalField }, null, 2));
    } catch (err) {
      toast({ title: 'Fix field mapping first', description: err instanceof Error ? err.message : 'Mapping JSON must be valid.', variant: 'destructive' });
    }
  };

  const removeMappedField = (crmyField: string) => {
    try {
      const current = parseJson('Field mapping', mappingFieldJson);
      delete current[crmyField];
      setMappingFieldJson(JSON.stringify(current, null, 2));
    } catch (err) {
      toast({ title: 'Fix field mapping first', description: err instanceof Error ? err.message : 'Mapping JSON must be valid.', variant: 'destructive' });
    }
  };

  const credentialPlaceholder = (type: string) => {
    if (type === 'salesforce') {
      return '{\n  "instance_url": "https://your-domain.my.salesforce.com",\n  "refresh_token": "...",\n  "client_id": "...",\n  "client_secret": "..."\n}';
    }
    if (type === 'databricks') {
      return '{\n  "host": "https://adb-...cloud.databricks.com",\n  "token": "...",\n  "warehouse_id": "..."\n}';
    }
    if (type === 'snowflake') {
      return '{\n  "account_url": "https://org-account.snowflakecomputing.com",\n  "token": "..."\n}';
    }
    return '{\n  "token": "..."\n}';
  };

  const isHubSpotOAuthIncomplete = (value?: unknown) =>
    typeof value === 'string' && /hubspot oauth install is not complete|sample install url|test url|install code/i.test(value);

  const hubSpotOAuthConfig = (system?: SystemOfRecord): Record<string, unknown> => {
    const raw = system?.config?.hubspot_oauth;
    return raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  };

  const mergeHubSpotOAuthConfig = (base: Record<string, unknown>, values: Record<string, string>) => {
    const existing = base.hubspot_oauth && typeof base.hubspot_oauth === 'object'
      ? base.hubspot_oauth as Record<string, unknown>
      : {};
    const next = { ...existing };
    for (const [key, value] of Object.entries(values)) {
      if (value.trim()) next[key] = value.trim();
    }
    return Object.keys(next).length ? { ...base, hubspot_oauth: next } : base;
  };

  const hubSpotInstallHref = (system: SystemOfRecord) => {
    const raw = hubSpotOAuthConfig(system).sample_install_url;
    if (typeof raw !== 'string' || !raw.trim()) return '';
    try {
      const url = new URL(raw);
      url.searchParams.set('redirect_uri', recommendedHubSpotRedirectUri);
      url.searchParams.set('state', system.id);
      return url.toString();
    } catch {
      return raw;
    }
  };

  const copyToClipboard = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `${label} copied` });
    } catch {
      toast({ title: `Could not copy ${label.toLowerCase()}`, description: value, variant: 'destructive' });
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    const error = params.get('error');
    const state = params.get('state');
    if (error) {
      const key = `error:${error}`;
      if (processedHubSpotOAuthCode.current !== key) {
        processedHubSpotOAuthCode.current = key;
        toast({
          title: 'HubSpot install was not completed',
          description: params.get('error_description') || error,
          variant: 'destructive',
        });
      }
      return;
    }
    if (!code || systems.length === 0) return;
    const callbackKey = `${state ?? 'unknown'}:${code}`;
    if (processedHubSpotOAuthCode.current === callbackKey) return;

    const candidates = systems.filter(system => system.system_type === 'hubspot' && system.auth_type === 'oauth_app');
    const target = candidates.find(system => system.id === state)
      ?? candidates.find(system => isHubSpotOAuthIncomplete(system.last_error))
      ?? (candidates.length === 1 ? candidates[0] : undefined);

    if (!target) {
      processedHubSpotOAuthCode.current = callbackKey;
      toast({
        title: 'Could not match HubSpot callback',
        description: 'Open the HubSpot connection, choose Edit, and paste the redirected browser URL to finish OAuth.',
        variant: 'destructive',
      });
      return;
    }

    processedHubSpotOAuthCode.current = callbackKey;
    const callbackUrl = `${window.location.origin}${location.pathname}${location.search}`;
    updateSystem.mutateAsync({
      id: target.id,
      patch: {
        auth_type: 'oauth_app',
        credentials: { authorization_code_or_redirect_url: callbackUrl },
        status: 'disconnected',
      },
    }).then(() => testSystem.mutateAsync(target.id)).then(result => {
      const response = result as { ok?: boolean; message?: string };
      if (response.ok === false) {
        toast({
          title: 'HubSpot OAuth saved, validation failed',
          description: response.message ?? 'Review scopes and try the connection test again.',
          variant: 'destructive',
        });
        return;
      }
      toast({ title: 'HubSpot connection verified', description: response.message ?? 'CRMy exchanged the install code and validated HubSpot CRM access.' });
      window.history.replaceState(null, '', '/app/settings/systems');
    }).catch(err => {
      toast({
        title: 'Could not finish HubSpot OAuth',
        description: err instanceof Error ? err.message : 'Paste the redirected browser URL in the connection edit panel.',
        variant: 'destructive',
      });
    });
  }, [location.pathname, location.search, systems, updateSystem]);

  const credentialsFromInput = () => {
    if (systemType === 'hubspot' && authType === 'oauth_app') {
      return {
        app_id: hubSpotAppId.trim(),
        client_id: hubSpotClientId.trim(),
        client_secret: hubSpotClientSecret.trim(),
        sample_install_url: hubSpotInstallUrl.trim(),
        redirect_uri: recommendedHubSpotRedirectUri,
      };
    }

    const trimmed = credentialInput.trim();
    if (!trimmed) return {};
    if (trimmed.startsWith('{')) return parseJson('Credentials', trimmed);
    if (systemType === 'hubspot') return { access_token: trimmed };
    throw new Error(`${systemLabel(systemType)} credentials must be entered as JSON so CRMy has the host/account, auth token, and required connection metadata.`);
  };

  const handleCreateSystem = async () => {
    try {
      if (!systemType) {
        throw new Error('Choose the system of record you want to connect.');
      }
      if (systemType === 'hubspot' && authType === 'private_app_token' && !credentialInput.trim()) {
        throw new Error('Paste a HubSpot private app access token, or switch the HubSpot auth path to OAuth app credentials.');
      }
      if (systemType === 'hubspot' && authType === 'oauth_app') {
        if (!hubSpotAppId.trim() || !hubSpotClientId.trim() || !hubSpotClientSecret.trim()) {
          throw new Error('Enter the HubSpot App ID, Client ID, and Client Secret. The Sample install URL is optional but recommended.');
        }
      }
      if (systemType !== 'hubspot' && !credentialInput.trim()) {
        throw new Error(`Enter ${systemLabel(systemType)} credentials JSON before creating the connection.`);
      }
      const created = await createSystem.mutateAsync({
        name: name.trim(),
        system_type: systemType,
        auth_type: authType,
        credentials: credentialsFromInput(),
        config: systemType === 'hubspot' && authType === 'oauth_app'
          ? mergeHubSpotOAuthConfig(parseJson('Config', configInput), {
            app_id: hubSpotAppId,
            client_id: hubSpotClientId,
            sample_install_url: hubSpotInstallUrl,
            redirect_uri: recommendedHubSpotRedirectUri,
          })
          : parseJson('Config', configInput),
        sync_settings: parseJson('Sync settings', syncInput),
      });
      const createdSystem = ((created as { system?: SystemOfRecord }).system ?? created) as SystemOfRecord;
      const createdSystemId = createdSystem?.id;
      const presetMappings = createdSystemId
        ? connectorPresetMappings(systemType, createdSystemId).filter(preset => setupReadObjects.includes(preset.object_type))
        : [];
      for (const preset of presetMappings) {
        await upsertMapping.mutateAsync(preset);
      }
      setShowCreate(false);
      setAddWizardStep(0);
      setName('');
      setCredentialInput('');
      setHubSpotAppId('');
      setHubSpotClientId('');
      setHubSpotClientSecret('');
      setHubSpotInstallUrl('');
      setTab(presetMappings.length > 0 ? 'mappings' : 'systems');
      toast({
        title: authType === 'oauth_app' ? 'HubSpot OAuth app saved' : 'System added',
        description: authType === 'oauth_app'
          ? `OAuth app credentials were encrypted${presetMappings.length ? ` and ${presetMappings.length} read mapping${presetMappings.length !== 1 ? 's' : ''} were added` : ''}. Next, install the app from the system card.`
          : `Credentials were encrypted before storage${presetMappings.length ? ` and ${presetMappings.length} read mapping${presetMappings.length !== 1 ? 's' : ''} were added.` : '.'}`,
      });
    } catch (err) {
      toast({ title: 'Could not create system', description: err instanceof Error ? err.message : 'Check the connection fields and try again.', variant: 'destructive' });
    }
  };

  const handleUpsertMapping = async () => {
    try {
      await upsertMapping.mutateAsync({
        ...(editingMappingId ? { id: editingMappingId } : {}),
        system_id: mappingSystemId,
        object_type: mappingObjectType,
        external_object: mappingExternalObject,
        external_id_field: mappingIdField,
        watermark_field: mappingWatermarkField || undefined,
        field_mapping: parseJson('Field mapping', mappingFieldJson),
        readable_fields: parseCsvList(mappingReadableFields),
        writable_fields: parseCsvList(mappingWritableFields),
        source_authority: mappingSourceAuthority,
        writeback_mode: mappingWritebackMode || undefined,
        writeback_config: parseJson('Writeback config', mappingWritebackConfigJson),
        allow_source_loop: mappingAllowSourceLoop,
        is_active: mappingIsActive,
      });
      setEditingMappingId('');
      toast({ title: editingMappingId ? 'Mapping updated' : 'Mapping saved', description: 'Future sync runs will use this mapping.' });
    } catch (err) {
      toast({ title: 'Could not save mapping', description: err instanceof Error ? err.message : 'Review the mapping and try again.', variant: 'destructive' });
    }
  };

  const resetMappingForm = () => {
    setEditingMappingId('');
    setMappingObjectType('contact');
    setMappingExternalObject('contacts');
    setMappingIdField('id');
    setMappingWatermarkField('updatedAt');
    setMappingFieldJson('{\n  "email": "email",\n  "first_name": "firstname",\n  "last_name": "lastname"\n}');
    setMappingCrmyField('email');
    setMappingExternalField('');
    setMappingReadableFields('');
    setMappingWritableFields('');
    setMappingSourceAuthority('external');
    setMappingWritebackMode('');
    setMappingWritebackConfigJson('{}');
    setMappingAllowSourceLoop(false);
    setMappingIsActive(true);
    setDiscoveryMode('');
    setDiscoveryObjectName('');
  };

  const discoverExternalObjects = () => {
    if (!mappingSystemId) {
      toast({ title: 'Choose a connection first', description: 'Select a system of record before discovering schema.', variant: 'destructive' });
      return;
    }
    setDiscoveryObjectName('');
    setDiscoveryMode('objects');
  };

  const discoverExternalFields = () => {
    if (!mappingSystemId) {
      toast({ title: 'Choose a connection first', description: 'Select a system of record before discovering fields.', variant: 'destructive' });
      return;
    }
    if (!mappingExternalObject.trim()) {
      toast({ title: 'Enter an external object', description: 'Choose or type the external object/table before discovering fields.', variant: 'destructive' });
      return;
    }
    setDiscoveryObjectName(mappingExternalObject.trim());
    setDiscoveryMode('fields');
  };

  const addFieldMapping = (externalField = mappingExternalField.trim()) => {
    const crmyField = mappingCrmyField.trim();
    if (!crmyField || !externalField.trim()) {
      toast({
        title: 'Choose both fields',
        description: 'Select a CRMy field and enter or choose the external field to map.',
        variant: 'destructive',
      });
      return;
    }
    try {
      const current = parseJson('Field mapping', mappingFieldJson);
      const next = { ...current, [crmyField]: externalField.trim() };
      setMappingFieldJson(JSON.stringify(next, null, 2));
      setMappingExternalField('');
      toast({ title: 'Field added to mapping', description: `${crmyField} now maps to ${externalField.trim()}.` });
    } catch (err) {
      toast({
        title: 'Could not update field mapping',
        description: err instanceof Error ? err.message : 'Fix the mapping JSON and try again.',
        variant: 'destructive',
      });
    }
  };

  const startEditMapping = (mapping: SystemMapping) => {
    setEditingMappingId(mapping.id);
    setConfirmDeleteMappingId('');
    setMappingSystemId(mapping.system_id);
    setMappingObjectType(mapping.object_type);
    setMappingExternalObject(mapping.external_object);
    setMappingIdField(mapping.external_id_field || 'id');
    setMappingWatermarkField(mapping.watermark_field || '');
    setMappingFieldJson(JSON.stringify(mapping.field_mapping ?? {}, null, 2));
    const firstMappedField = Object.keys(mapping.field_mapping ?? {})[0];
    setMappingCrmyField(firstMappedField || 'name');
    setMappingExternalField('');
    setMappingReadableFields(csvList(mapping.readable_fields));
    setMappingWritableFields(csvList(mapping.writable_fields));
    setMappingSourceAuthority(mapping.source_authority || 'external');
    setMappingWritebackMode(mapping.writeback_mode || '');
    setMappingWritebackConfigJson(JSON.stringify(mapping.writeback_config ?? {}, null, 2));
    setMappingAllowSourceLoop(Boolean(mapping.allow_source_loop));
    setMappingIsActive(mapping.is_active !== false);
  };

  const handleDeleteMapping = async (mapping: SystemMapping) => {
    try {
      await deleteMapping.mutateAsync(mapping.id);
      if (editingMappingId === mapping.id) resetMappingForm();
      setConfirmDeleteMappingId('');
      toast({ title: 'Mapping deleted', description: `${mapping.object_type.replace('_', ' ')} mapping was removed.` });
    } catch (err) {
      toast({ title: 'Could not delete mapping', description: err instanceof Error ? err.message : 'Try again or check permissions.', variant: 'destructive' });
    }
  };

  const handleResolveConflict = async (id: string, resolution: 'resolved_external' | 'resolved_local' | 'ignored') => {
    try {
      await resolveConflict.mutateAsync({
        id,
        resolution,
        note: resolution === 'resolved_external'
          ? 'Applied external value from Systems of Record settings'
          : resolution === 'resolved_local'
            ? 'Kept CRMy value from Systems of Record settings'
            : 'Ignored from Systems of Record settings',
      });
      toast({
        title: resolution === 'resolved_external' ? 'External value applied' : resolution === 'resolved_local' ? 'Local value kept' : 'Conflict ignored',
        description: resolution === 'resolved_external'
          ? 'CRMy updated the linked record where the conflict was safely actionable.'
          : 'The conflict was closed without changing the CRMy record.',
      });
    } catch (err) {
      toast({
        title: 'Could not resolve conflict',
        description: err instanceof Error ? err.message : 'Review the conflict details and try again.',
        variant: 'destructive',
      });
    }
  };

  const handleReviewWriteback = async (id: string, decision: 'approved' | 'rejected') => {
    try {
      await reviewWriteback.mutateAsync({
        id,
        decision,
        note: decision === 'approved' ? 'Approved from Systems of Record settings' : 'Rejected from Systems of Record settings',
      });
      toast({
        title: decision === 'approved' ? 'Writeback approved' : 'Writeback rejected',
        description: decision === 'approved'
          ? 'The request can now be executed through its configured connector.'
          : 'The request was closed without writing to the external system.',
      });
    } catch (err) {
      toast({
        title: 'Could not review writeback',
        description: err instanceof Error ? err.message : 'Review the writeback and try again.',
        variant: 'destructive',
      });
    }
  };

  const applyWritebackMapping = (mappingId: string) => {
    setWritebackMappingId(mappingId);
    setWritebackPreview(null);
    const mapping = mappings.find(item => item.id === mappingId);
    if (!mapping) return;
    setWritebackSystemId(mapping.system_id);
    setWritebackObjectType(mapping.object_type);
    setWritebackExternalObject(mapping.external_object);
    setWritebackMode(mapping.writeback_mode || 'mapped_upsert');
  };

  const buildWritebackInput = () => {
    if (!writebackSystemId) throw new Error('Choose a system of record first.');
    if (!writebackExternalObject.trim()) throw new Error('Enter the external object or table.');
    const payload = parseJson('Writeback payload', writebackPayloadJson);
    return {
      system_id: writebackSystemId,
      mapping_id: writebackMappingId || undefined,
      object_type: writebackObjectType,
      object_id: writebackObjectId.trim() || undefined,
      external_object: writebackExternalObject.trim(),
      external_record_id: writebackExternalRecordId.trim() || undefined,
      operation: writebackOperation,
      writeback_mode: writebackMode,
      payload,
    };
  };

  const handlePreviewWriteback = async () => {
    try {
      const result = await previewWriteback.mutateAsync(buildWritebackInput());
      const preview = (result as { preview?: Record<string, unknown> }).preview ?? result as Record<string, unknown>;
      setWritebackPreview(preview);
      const allowed = preview.allowed !== false;
      toast({
        title: allowed ? 'Writeback preview ready' : 'Writeback blocked by policy',
        description: allowed
          ? 'Review the diff and approval requirement before creating a request.'
          : 'Fix the payload or mapping before requesting this writeback.',
        variant: allowed ? undefined : 'destructive',
      });
    } catch (err) {
      toast({
        title: 'Could not preview writeback',
        description: err instanceof Error ? err.message : 'Review the payload and mapping.',
        variant: 'destructive',
      });
    }
  };

  const handleRequestWriteback = async () => {
    try {
      const input = { ...buildWritebackInput(), require_approval: writebackRequireApproval };
      const result = await requestWriteback.mutateAsync(input);
      const writeback = (result as { writeback?: Record<string, unknown> }).writeback;
      setWritebackPreview((writeback?.preview as Record<string, unknown> | undefined) ?? writebackPreview);
      toast({
        title: 'Writeback request created',
        description: writeback?.status === 'approved'
          ? 'Policy allowed this request. It is ready to execute.'
          : 'The request is waiting for review before external execution.',
      });
    } catch (err) {
      toast({
        title: 'Could not request writeback',
        description: err instanceof Error ? err.message : 'Preview the request and try again.',
        variant: 'destructive',
      });
    }
  };

  const hubSpotPresetMappings = (systemId: string) => [
    {
      system_id: systemId,
      object_type: 'contact',
      external_object: 'contacts',
      external_id_field: 'id',
      watermark_field: 'hs_lastmodifieddate',
      field_mapping: {
        first_name: 'firstname',
        last_name: 'lastname',
        email: 'email',
        phone: 'phone',
        title: 'jobtitle',
        company_name: 'company',
        lifecycle_stage: 'lifecyclestage',
      },
      readable_fields: ['hs_lastmodifieddate'],
      writable_fields: [],
      source_authority: 'external',
      writeback_mode: undefined,
    },
    {
      system_id: systemId,
      object_type: 'account',
      external_object: 'companies',
      external_id_field: 'id',
      watermark_field: 'hs_lastmodifieddate',
      field_mapping: {
        name: 'name',
        domain: 'domain',
        industry: 'industry',
        employee_count: 'numberofemployees',
        annual_revenue: 'annualrevenue',
        website: 'website',
      },
      readable_fields: ['hs_lastmodifieddate'],
      writable_fields: [],
      source_authority: 'external',
      writeback_mode: undefined,
    },
    {
      system_id: systemId,
      object_type: 'opportunity',
      external_object: 'deals',
      external_id_field: 'id',
      watermark_field: 'hs_lastmodifieddate',
      field_mapping: {
        name: 'dealname',
        amount: 'amount',
        stage: 'dealstage',
        close_date: 'closedate',
      },
      readable_fields: ['pipeline', 'dealtype', 'hs_lastmodifieddate'],
      writable_fields: [],
      source_authority: 'external',
      writeback_mode: undefined,
    },
    {
      system_id: systemId,
      object_type: 'activity',
      external_object: 'notes',
      external_id_field: 'id',
      watermark_field: 'hs_lastmodifieddate',
      field_mapping: {
        subject: 'hs_note_body',
        body: 'hs_note_body',
      },
      readable_fields: ['hs_timestamp', 'hs_lastmodifieddate'],
      writable_fields: [],
      source_authority: 'external',
      writeback_mode: undefined,
    },
  ];

  const salesforcePresetMappings = (systemId: string) => [
    {
      system_id: systemId,
      object_type: 'contact',
      external_object: 'Contact',
      external_id_field: 'Id',
      watermark_field: 'LastModifiedDate',
      field_mapping: {
        first_name: 'FirstName',
        last_name: 'LastName',
        email: 'Email',
        phone: 'Phone',
        title: 'Title',
        company_name: 'Account.Name',
      },
      readable_fields: ['LastModifiedDate', 'AccountId'],
      writable_fields: [],
      source_authority: 'external',
      writeback_mode: undefined,
    },
    {
      system_id: systemId,
      object_type: 'account',
      external_object: 'Account',
      external_id_field: 'Id',
      watermark_field: 'LastModifiedDate',
      field_mapping: {
        name: 'Name',
        domain: 'Website',
        industry: 'Industry',
        annual_revenue: 'AnnualRevenue',
        employee_count: 'NumberOfEmployees',
      },
      readable_fields: ['LastModifiedDate', 'OwnerId'],
      writable_fields: [],
      source_authority: 'external',
      writeback_mode: undefined,
    },
    {
      system_id: systemId,
      object_type: 'opportunity',
      external_object: 'Opportunity',
      external_id_field: 'Id',
      watermark_field: 'LastModifiedDate',
      field_mapping: {
        name: 'Name',
        amount: 'Amount',
        stage: 'StageName',
        probability: 'Probability',
        close_date: 'CloseDate',
      },
      readable_fields: ['LastModifiedDate', 'AccountId'],
      writable_fields: [],
      source_authority: 'external',
      writeback_mode: undefined,
    },
    {
      system_id: systemId,
      object_type: 'activity',
      external_object: 'Task',
      external_id_field: 'Id',
      watermark_field: 'LastModifiedDate',
      field_mapping: {
        subject: 'Subject',
        body: 'Description',
        occurred_at: 'ActivityDate',
      },
      readable_fields: ['LastModifiedDate', 'WhoId', 'WhatId'],
      writable_fields: [],
      source_authority: 'external',
      writeback_mode: undefined,
    },
  ];

  const connectorPresetMappings = (type: string, systemId: string) => {
    if (type === 'hubspot') return hubSpotPresetMappings(systemId);
    if (type === 'salesforce') return salesforcePresetMappings(systemId);
    return [];
  };

  const setupPreviewRows = selectedReadOptions.map(option => {
    const preset = connectorPresetMappings(systemType, '__preview__').find(item => item.object_type === option.key);
    const sampleFields = Object.entries(preset?.field_mapping ?? {})
      .slice(0, 3)
      .map(([crmyField, externalField]) => `${externalField} -> ${crmyField.replace(/_/g, ' ')}`);
    const crmyRecord = option.key === 'activity'
      ? 'Activity'
      : option.key === 'use_case'
        ? 'Use Case'
        : option.label.replace(/s$/, '');
    return {
      key: option.key,
      crmyRecord,
      externalObject: preset?.external_object ?? 'Choose in Mappings',
      matchField: preset?.external_id_field ?? 'Choose ID field',
      fields: sampleFields.length ? sampleFields.join(', ') : 'Configure after saving',
      writes: 'Disabled',
    };
  });

  const handleApplyHubSpotPresets = async (systemId: string) => {
    try {
      for (const preset of hubSpotPresetMappings(systemId)) {
        await upsertMapping.mutateAsync(preset);
      }
      setTab('mappings');
      toast({ title: 'HubSpot read mappings added', description: 'Contacts, accounts, deals, and notes are ready to sync. Writeback stays disabled until you choose writable fields.' });
    } catch (err) {
      toast({ title: 'Could not apply presets', description: err instanceof Error ? err.message : 'Review the connection and try again.', variant: 'destructive' });
    }
  };

  const statusClass = (status?: string) => {
    if (status === 'connected' || status === 'completed' || status === 'resolved' || status === 'approved') return 'bg-success/10 text-success border-success/30';
    if (status === 'error' || status === 'failed' || status === 'rejected') return 'bg-destructive/10 text-destructive border-destructive/30';
    if (status === 'running' || status === 'approval_required' || status === 'pending') return 'bg-warning/10 text-warning border-warning/30';
    return 'bg-muted text-muted-foreground border-border';
  };

  const syncRunSummary = (run: Record<string, unknown>) => [
    `Seen ${String(run.records_seen ?? 0)}`,
    `Created ${String(run.records_created ?? 0)}`,
    `Updated ${String(run.records_updated ?? 0)}`,
    Number(run.conflicts_created ?? 0) > 0 ? `Conflicts ${String(run.conflicts_created)}` : '',
    Number(run.records_skipped ?? 0) > 0 ? `Skipped ${String(run.records_skipped)}` : '',
  ].filter(Boolean).join(' • ');

  const systemHealth = (system: SystemOfRecord) => system.health && typeof system.health === 'object' ? system.health : {};

  const systemActionState = (system: SystemOfRecord, mappedCount: number) => {
    const health = systemHealth(system);
    const hubSpotNeedsInstall = system.system_type === 'hubspot'
      && system.auth_type === 'oauth_app'
      && system.status !== 'connected'
      && (system.status !== 'error' || isHubSpotOAuthIncomplete(system.last_error));
    if (hubSpotNeedsInstall) {
      return {
        tone: 'warning',
        title: 'Finish OAuth install',
        description: 'Install the HubSpot app from this connection so CRMy can exchange the code and validate access.',
      };
    }
    if (system.status === 'error') {
      return {
        tone: 'destructive',
        title: 'Connection needs attention',
        description: system.last_error || 'Test the connection to see the exact recovery step.',
      };
    }
    if (system.status !== 'connected') {
      return {
        tone: 'muted',
        title: 'Test connection',
        description: 'Validate credentials before running sync or writeback.',
      };
    }
    if (mappedCount === 0) {
      return {
        tone: 'warning',
        title: 'Add mappings',
        description: 'Choose which external objects should become CRMy records before syncing.',
      };
    }
    return {
      tone: 'success',
      title: 'Ready to sync',
      description: typeof health.message === 'string' ? health.message : 'Connection and mappings are ready.',
    };
  };

  const actionStateClass = (tone: string) => {
    if (tone === 'success') return 'border-success/30 bg-success/10 text-success';
    if (tone === 'destructive') return 'border-destructive/30 bg-destructive/10 text-destructive';
    if (tone === 'warning') return 'border-warning/30 bg-warning/10 text-warning';
    return 'border-border bg-muted/50 text-muted-foreground';
  };

  const tokenHealthLabel = (system: SystemOfRecord) => {
    const expiresAt = systemHealth(system).token_expires_at;
    if (typeof expiresAt !== 'string') return null;
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (!Number.isFinite(ms)) return null;
    if (ms <= 0) return 'OAuth token refresh due';
    const minutes = Math.round(ms / 60000);
    if (minutes < 90) return `OAuth token refreshes soon (${minutes} min)`;
    return `OAuth token valid until ${fmtDate(expiresAt)}`;
  };

  const readinessIconClass = (tone: 'ready' | 'action' | 'error' | 'muted') => {
    if (tone === 'ready') return 'bg-success/10 text-success';
    if (tone === 'error') return 'bg-destructive/10 text-destructive';
    if (tone === 'action') return 'bg-warning/10 text-warning';
    return 'bg-muted text-muted-foreground';
  };

  const latestRunForSystem = (systemId: string) =>
    runs.find(run => String(run.system_id ?? '') === systemId);

  const systemReadinessItems = (
    system: SystemOfRecord,
    systemMappings: SystemMapping[],
    writeLabel: string,
    latestRun?: Record<string, unknown>,
  ) => {
    const mappedCount = systemMappings.length;
    const syncStatus = String(latestRun?.status ?? '').toLowerCase();
    const syncFailing = ['failed', 'error'].includes(syncStatus);
    const connected = system.status === 'connected';
    return [
      {
        label: connected ? 'Connected' : system.status === 'error' ? 'Connection failing' : 'Test connection',
        detail: connected ? 'Credentials are valid.' : system.last_error || 'Validate credentials before sync.',
        tone: connected ? 'ready' as const : system.status === 'error' ? 'error' as const : 'action' as const,
      },
      {
        label: mappedCount > 0 ? 'Mappings ready' : 'Mappings incomplete',
        detail: mappedCount > 0
          ? `${mappedCount} mapped record type${mappedCount === 1 ? '' : 's'}.`
          : 'Choose the external objects CRMy should read.',
        tone: mappedCount > 0 ? 'ready' as const : 'action' as const,
      },
      {
        label: writeLabel === 'Disabled' ? 'Read-only' : `Writeback ${writeLabel.toLowerCase()}`,
        detail: writeLabel === 'Disabled'
          ? 'CRMy can read records, but cannot update the external system.'
          : 'External updates require configured fields and governed review.',
        tone: writeLabel === 'Disabled' ? 'muted' as const : 'action' as const,
      },
      {
        label: syncFailing ? 'Sync failing' : system.last_sync_at ? 'Sync current' : 'Run first sync',
        detail: syncFailing
          ? String(latestRun?.error ?? latestRun?.message ?? 'Review the latest sync error.')
          : system.last_sync_at
            ? `Last sync ${fmtDate(system.last_sync_at)}.`
            : connected && mappedCount > 0
              ? 'Run sync to bring customer records into CRMy.'
              : 'Sync starts after connection and mappings are ready.',
        tone: syncFailing ? 'error' as const : system.last_sync_at ? 'ready' as const : connected && mappedCount > 0 ? 'action' as const : 'muted' as const,
      },
    ];
  };

  const fmtDate = (value?: unknown) => typeof value === 'string' ? new Date(value).toLocaleString() : '—';
  const asObject = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const writebackReceipt = (writeback: Record<string, unknown>) => asObject(writeback.execution_result);
  const writebackReference = (writeback: Record<string, unknown>) => asObject(writebackReceipt(writeback).reference);
  const asStringList = (value: unknown): string[] =>
    Array.isArray(value) ? value.map(item => String(item)).filter(Boolean) : [];
  const actionPolicyFrom = (value: unknown): Record<string, unknown> => {
    const root = asObject(value);
    const policy = asObject(root.policy);
    const nestedPolicy = asObject(policy.action_policy);
    if (Object.keys(nestedPolicy).length > 0) return nestedPolicy;
    const directPolicy = asObject(root.action_policy);
    const directNested = asObject(directPolicy.action_policy);
    if (Object.keys(directNested).length > 0) return directNested;
    return directPolicy;
  };
  const writebackDecisionLabel = (value: Record<string, unknown>, actionPolicy = actionPolicyFrom(value)) => {
    if (value.allowed === false || actionPolicy.decision === 'blocked') return 'Blocked';
    if (value.requires_approval === true || actionPolicy.decision === 'approval_required') return 'Approval required';
    if (actionPolicy.decision === 'draft_only') return 'Draft only';
    return 'Allowed';
  };
  const writebackDecisionClass = (label: string) => {
    if (label === 'Blocked') return statusClass('failed');
    if (label === 'Approval required' || label === 'Draft only') return statusClass('pending');
    return statusClass('completed');
  };
  const writebackReasonList = (value: Record<string, unknown>, actionPolicy = actionPolicyFrom(value)) => [
    ...asStringList(value.warnings),
    ...asStringList(actionPolicy.reasons).filter(reason => reason !== 'Policy allows this action.'),
  ];
  const writebackFieldList = (preview: Record<string, unknown>, fallbackPayload?: unknown) => {
    const diff = asObject(preview.diff);
    const payload = asObject(diff.payload ?? fallbackPayload);
    return Object.keys(payload);
  };
  const runSystemSyncFor = (system: SystemOfRecord, mappedCount: number) => {
    if (system.status !== 'connected') {
      toast({
        title: 'Test connection first',
        description: 'CRMy needs a verified connection before it can sync records safely.',
        variant: 'destructive',
      });
      return;
    }
    if (mappedCount === 0) {
      setTab('mappings');
      setMappingSystemId(system.id);
      toast({
        title: 'Add a mapping before syncing',
        description: 'Mappings tell CRMy which external records become typed revenue objects.',
        variant: 'destructive',
      });
      return;
    }
    runSync.mutate(
      { id: system.id, mode: 'incremental' },
      {
        onSuccess: result => {
          const run = result as Record<string, unknown>;
          toast({
            title: run.status === 'failed' ? 'Sync failed' : 'Sync completed',
            description: run.status === 'failed'
              ? String(run.error ?? 'Open Sync Runs for the latest error.')
              : syncRunSummary(run),
            variant: run.status === 'failed' ? 'destructive' : undefined,
          });
          setTab('activity');
        },
        onError: err => toast({
          title: 'Sync failed',
          description: err instanceof Error ? err.message : 'Check mappings and try again.',
          variant: 'destructive',
        }),
      },
    );
  };
  const cardCls = 'rounded-xl border border-border bg-card p-4';
  const inputCls = 'h-10 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring transition-colors';
  const textAreaCls = 'w-full min-h-24 px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring font-mono';

  const tabs = [
    { key: 'systems', label: 'Systems', count: systems.length },
    { key: 'mappings', label: 'Mappings', count: mappings.length },
    { key: 'activity', label: 'Activity', count: runs.length + conflicts.length + writebacks.length },
    { key: 'advanced', label: 'Advanced', count: writebacks.length },
  ] as const;

  const hubSpotScopes = [
    'crm.objects.contacts.read',
    'crm.objects.contacts.write',
    'crm.objects.companies.read',
    'crm.objects.companies.write',
    'crm.objects.deals.read',
    'crm.objects.deals.write',
    'crm.schemas.contacts.read',
    'crm.schemas.companies.read',
    'crm.schemas.deals.read',
  ];

  const handleSystemTypeChange = (nextType: string) => {
    setSystemType(nextType);
    setAuthType(nextType === 'hubspot' ? 'oauth_app' : nextType === 'salesforce' ? 'oauth' : nextType ? 'token' : '');
    setCredentialInput('');
    setHubSpotAppId('');
    setHubSpotClientId('');
    setHubSpotClientSecret('');
    setHubSpotInstallUrl('');
  };

  const startEditSystem = (system: SystemOfRecord) => {
    setEditingSystemId(system.id);
    setEditName(system.name);
    setEditAuthType(system.auth_type || (system.system_type === 'hubspot' ? 'oauth_app' : 'token'));
    setEditCredentialInput('');
    setEditHubSpotAppId('');
    setEditHubSpotClientId('');
    setEditHubSpotClientSecret('');
    setEditHubSpotInstallUrl('');
    setEditHubSpotRedirectOrCode('');
    const oauthConfig = hubSpotOAuthConfig(system);
    setEditHubSpotAppId(typeof oauthConfig.app_id === 'string' ? oauthConfig.app_id : '');
    setEditHubSpotClientId(typeof oauthConfig.client_id === 'string' ? oauthConfig.client_id : '');
    setEditHubSpotInstallUrl(typeof oauthConfig.sample_install_url === 'string' ? oauthConfig.sample_install_url : '');
    setEditConfigInput(JSON.stringify(system.config ?? {}, null, 2));
    setEditSyncInput(JSON.stringify(system.sync_settings ?? {}, null, 2));
  };

  const cancelEditSystem = () => {
    setEditingSystemId('');
    setEditName('');
    setEditCredentialInput('');
    setEditHubSpotAppId('');
    setEditHubSpotClientId('');
    setEditHubSpotClientSecret('');
    setEditHubSpotInstallUrl('');
    setEditHubSpotRedirectOrCode('');
  };

  const editCredentialsFromInput = (system: SystemOfRecord): Record<string, unknown> | undefined => {
    if (system.system_type === 'hubspot' && editAuthType === 'oauth_app') {
      const hasOauthInput = Boolean(
        editHubSpotAppId.trim()
        || editHubSpotClientId.trim()
        || editHubSpotClientSecret.trim()
        || editHubSpotInstallUrl.trim()
        || editHubSpotRedirectOrCode.trim(),
      );
      if (!hasOauthInput) {
        if (system.auth_type !== editAuthType || !system.has_credentials) {
          throw new Error('Enter the HubSpot App ID, Client ID, and Client Secret to switch this connection to OAuth app credentials.');
        }
        return undefined;
      }
      if (!system.has_credentials && (!editHubSpotAppId.trim() || !editHubSpotClientId.trim() || !editHubSpotClientSecret.trim())) {
        throw new Error('Enter the HubSpot App ID, Client ID, and Client Secret to save OAuth credentials.');
      }
      const credentials: Record<string, unknown> = {};
      if (editHubSpotAppId.trim()) credentials.app_id = editHubSpotAppId.trim();
      if (editHubSpotClientId.trim()) credentials.client_id = editHubSpotClientId.trim();
      if (editHubSpotClientSecret.trim()) credentials.client_secret = editHubSpotClientSecret.trim();
      if (editHubSpotInstallUrl.trim()) credentials.sample_install_url = editHubSpotInstallUrl.trim();
      credentials.redirect_uri = recommendedHubSpotRedirectUri;
      if (editHubSpotRedirectOrCode.trim()) credentials.authorization_code_or_redirect_url = editHubSpotRedirectOrCode.trim();
      return credentials;
    }

    const trimmed = editCredentialInput.trim();
    if (!trimmed) {
      if (system.auth_type !== editAuthType || !system.has_credentials) {
        throw new Error(system.system_type === 'hubspot'
          ? 'Paste a HubSpot private app access token to switch this connection to live sync.'
          : `Paste ${systemLabel(system.system_type)} credentials JSON before changing this connection auth type.`);
      }
      return undefined;
    }
    if (trimmed.startsWith('{')) return parseJson('Credentials', trimmed);
    if (system.system_type === 'hubspot') return { access_token: trimmed };
    throw new Error(`${systemLabel(system.system_type)} credentials must be entered as JSON so CRMy has the host/account, auth token, and required connection metadata.`);
  };

  const handleUpdateSystem = async (system: SystemOfRecord) => {
    try {
      const credentials = editCredentialsFromInput(system);
      const patch: Record<string, unknown> = {
        name: editName.trim(),
        auth_type: editAuthType,
        config: system.system_type === 'hubspot' && editAuthType === 'oauth_app'
          ? mergeHubSpotOAuthConfig(parseJson('Config', editConfigInput), {
            app_id: editHubSpotAppId,
            client_id: editHubSpotClientId,
            sample_install_url: editHubSpotInstallUrl,
            redirect_uri: recommendedHubSpotRedirectUri,
          })
          : parseJson('Config', editConfigInput),
        sync_settings: parseJson('Sync settings', editSyncInput),
        status: 'disconnected',
      };
      if (credentials !== undefined) patch.credentials = credentials;
      await updateSystem.mutateAsync({ id: system.id, patch });
      cancelEditSystem();
      if (credentials && system.system_type === 'hubspot' && editAuthType === 'oauth_app' && editHubSpotRedirectOrCode.trim()) {
        const result = await testSystem.mutateAsync(system.id);
        const response = result as { ok?: boolean; message?: string };
        if (response.ok === false) {
          toast({
            title: 'HubSpot OAuth saved, validation failed',
            description: response.message ?? 'Review scopes and try again.',
            variant: 'destructive',
          });
          return;
        }
        toast({ title: 'HubSpot connection verified', description: response.message ?? 'CRMy exchanged the install code and validated HubSpot CRM access.' });
        return;
      }
      toast({
        title: 'Connection updated',
        description: credentials ? 'Credentials were encrypted before storage. Run Test when you are ready.' : 'Settings were updated. Existing encrypted credentials were kept.',
      });
    } catch (err) {
      toast({ title: 'Could not update connection', description: err instanceof Error ? err.message : 'Review the connection fields and try again.', variant: 'destructive' });
    }
  };

  const renderAuthTypeField = () => {
    if (!systemType) return null;
    if (systemType === 'hubspot') {
      return (
        <select value={authType} onChange={e => setAuthType(e.target.value)} className={inputCls}>
          <option value="oauth_app">HubSpot OAuth app (recommended)</option>
          <option value="private_app_token">Private app token (advanced)</option>
        </select>
      );
    }

    return (
      <input value={authType} onChange={e => setAuthType(e.target.value)} placeholder="Auth type" className={inputCls} />
    );
  };

  const renderEditAuthTypeField = (system: SystemOfRecord) => {
    if (system.system_type === 'hubspot') {
      return (
        <select value={editAuthType} onChange={e => setEditAuthType(e.target.value)} className={inputCls}>
          <option value="oauth_app">HubSpot OAuth app (recommended)</option>
          <option value="private_app_token">Private app token (advanced)</option>
        </select>
      );
    }

    return (
      <input value={editAuthType} onChange={e => setEditAuthType(e.target.value)} placeholder="Auth type" className={inputCls} />
    );
  };

  const renderEditCredentialFields = (system: SystemOfRecord) => {
    if (system.system_type === 'hubspot' && editAuthType === 'oauth_app') {
      return (
        <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Copy from HubSpot Auth settings</p>
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">App ID</label>
            <input value={editHubSpotAppId} onChange={e => setEditHubSpotAppId(e.target.value)} placeholder={system.has_credentials ? 'Leave blank to keep existing' : 'HubSpot App ID'} className={`${inputCls} w-full mt-1`} />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Client ID</label>
            <input value={editHubSpotClientId} onChange={e => setEditHubSpotClientId(e.target.value)} placeholder={system.has_credentials ? 'Leave blank to keep existing' : 'OAuth Client ID'} className={`${inputCls} w-full mt-1`} />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Client Secret</label>
            <input value={editHubSpotClientSecret} onChange={e => setEditHubSpotClientSecret(e.target.value)} placeholder={system.has_credentials ? 'Leave blank to keep existing' : 'OAuth Client Secret'} className={`${inputCls} w-full mt-1`} type="password" />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Sample install URL / Test URL</label>
            <input value={editHubSpotInstallUrl} onChange={e => setEditHubSpotInstallUrl(e.target.value)} placeholder={system.has_credentials ? 'Leave blank to keep existing' : 'https://app.hubspot.com/oauth/authorize?...'} className={`${inputCls} w-full mt-1`} />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">OAuth callback URL</label>
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
              <code className="text-xs text-foreground flex-1 overflow-x-auto">{recommendedHubSpotRedirectUri}</code>
              <button
                type="button"
                onClick={() => copyToClipboard(recommendedHubSpotRedirectUri, 'OAuth callback URL')}
                className="h-7 px-2 rounded-md border border-border text-xs font-semibold hover:bg-muted inline-flex items-center gap-1.5"
              >
                <Copy className="w-3 h-3" /> Copy
              </button>
            </div>
          </div>
          <div className="md:col-span-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Finish OAuth after install</p>
            <label className="sr-only">URL after HubSpot redirects back</label>
            <input
              value={editHubSpotRedirectOrCode}
              onChange={e => setEditHubSpotRedirectOrCode(e.target.value)}
              placeholder="After clicking the Sample install URL, paste the browser URL HubSpot sends you back to"
              className={`${inputCls} w-full mt-1`}
            />
            <p className="text-xs text-muted-foreground mt-1">This fallback value is not shown on the HubSpot Auth settings screen. It appears only after you approve the app install.</p>
          </div>
        </div>
      );
    }

    return (
      <div className="md:col-span-2">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Credentials JSON</label>
        <textarea
          value={editCredentialInput}
          onChange={e => setEditCredentialInput(e.target.value)}
          placeholder={system.has_credentials ? 'Leave blank to keep existing encrypted credentials' : credentialPlaceholder(system.system_type)}
          className={`${textAreaCls} mt-1`}
        />
      </div>
    );
  };

  const renderCredentialFields = () => {
    if (!systemType) return null;
    if (systemType === 'hubspot' && authType === 'oauth_app') {
      return (
        <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Copy from HubSpot Auth settings</p>
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">App ID</label>
            <input value={hubSpotAppId} onChange={e => setHubSpotAppId(e.target.value)} placeholder="HubSpot App ID" className={`${inputCls} w-full mt-1`} />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Client ID</label>
            <input value={hubSpotClientId} onChange={e => setHubSpotClientId(e.target.value)} placeholder="OAuth Client ID" className={`${inputCls} w-full mt-1`} />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Client Secret</label>
            <input value={hubSpotClientSecret} onChange={e => setHubSpotClientSecret(e.target.value)} placeholder="OAuth Client Secret" className={`${inputCls} w-full mt-1`} type="password" />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Sample install URL / Test URL</label>
            <input value={hubSpotInstallUrl} onChange={e => setHubSpotInstallUrl(e.target.value)} placeholder="https://app.hubspot.com/oauth/authorize?..." className={`${inputCls} w-full mt-1`} />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">OAuth callback URL</label>
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
              <code className="text-xs text-foreground flex-1 overflow-x-auto">{recommendedHubSpotRedirectUri}</code>
              <button
                type="button"
                onClick={() => copyToClipboard(recommendedHubSpotRedirectUri, 'OAuth callback URL')}
                className="h-7 px-2 rounded-md border border-border text-xs font-semibold hover:bg-muted inline-flex items-center gap-1.5"
              >
                <Copy className="w-3 h-3" /> Copy
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Use this exact callback URL in HubSpot. It returns to Systems of Record after CRMy verifies the install.</p>
          </div>
        </div>
      );
    }

    return (
      <div className="md:col-span-2">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Credentials JSON</label>
        <textarea
          value={credentialInput}
          onChange={e => setCredentialInput(e.target.value)}
          placeholder={systemType === 'hubspot' ? 'HubSpot private app access token' : credentialPlaceholder(systemType)}
          className={`${textAreaCls} mt-1`}
        />
      </div>
    );
  };

  const HubSpotGuide = () => (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Info className="w-4 h-4" />
        </span>
        <div>
          <p className="text-sm font-semibold text-foreground">HubSpot OAuth setup</p>
          <p className="text-sm text-muted-foreground mt-0.5">
            Start by copying the fields HubSpot shows on this Auth settings page. After saving, open the Sample install URL/Test URL, approve access, then finish OAuth from the connection card.
          </p>
        </div>
      </div>
      {!currentOriginMatchesHubSpotRedirect && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-foreground">Use localhost for HubSpot OAuth</p>
            <p className="text-sm text-muted-foreground mt-1">
              HubSpot local OAuth supports <span className="font-medium text-foreground">localhost</span>. You are viewing CRMy on {typeof window !== 'undefined' ? window.location.origin : 'this origin'}, so open Systems of Record on the localhost URL before installing.
            </p>
            <a href={`${hubSpotRedirectOrigin}/app/settings/systems`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline mt-2">
              Open localhost Settings <Globe className="w-3 h-3" />
            </a>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3">
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="text-sm font-semibold text-foreground">OAuth app credentials: app setup</p>
          <p className="text-sm text-muted-foreground mt-2">
            Copy the App ID, Client ID, Client Secret, Sample install URL, and Redirect URL from this HubSpot screen. HubSpot does not show the install code here; it appears only after you approve the install URL.
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            For local CRMy, set HubSpot's Redirect URL to <code className="px-1.5 py-0.5 rounded bg-muted text-foreground">{recommendedHubSpotRedirectUri}</code> so CRMy can finish OAuth automatically.
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Do not paste the Client Secret into the private app token field; it is not an access token.
          </p>
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Recommended scopes</p>
        <div className="flex flex-wrap gap-1.5">
          {hubSpotScopes.map(scope => (
            <code key={scope} className="px-2 py-1 rounded-md border border-border bg-background text-xs text-foreground">{scope}</code>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Add note scopes too if they appear in your HubSpot portal and you want CRMy to sync notes as activities.
        </p>
      </div>
      <a
        href="https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/oauth"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
      >
        HubSpot OAuth docs <Globe className="w-3 h-3" />
      </a>
    </div>
  );

  const ConnectorGuide = () => {
    if (systemType === 'hubspot') return null;
    const guide: Record<string, { title: string; body: string; bullets: string[] }> = {
      salesforce: {
        title: 'Salesforce OAuth credentials',
        body: 'Use a connected app with refresh token access. CRMy refreshes the encrypted access token before sync, discovery, and writeback operations.',
        bullets: [
          'Required: instance_url plus either access_token, or refresh_token with client_id and client_secret.',
          'Recommended: refresh_token, client_id, and client_secret so long-running sync does not expire.',
          'Use your My Domain URL for instance_url, not the setup page URL.',
        ],
      },
      databricks: {
        title: 'Databricks SQL Warehouse credentials',
        body: 'Use a personal access token or service credential with access to the selected SQL warehouse.',
        bullets: [
          'Required: host, token, and warehouse_id.',
          'Mappings should point to approved tables or views.',
          'Writebacks require admin-defined SQL templates; agents cannot generate arbitrary SQL writes.',
        ],
      },
      snowflake: {
        title: 'Snowflake SQL API credentials',
        body: 'Use a scoped SQL API token and configure warehouse/database/schema in connection config.',
        bullets: [
          'Required credentials: account_url and token.',
          'Recommended config: warehouse, database, schema, and role.',
          'Writebacks require admin-defined SQL templates; agents cannot generate arbitrary SQL writes.',
        ],
      },
    };
    const current = guide[systemType];
    if (!current) return null;
    return (
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
        <div className="flex items-start gap-3">
          <span className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Info className="w-4 h-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">{current.title}</p>
            <p className="text-sm text-muted-foreground mt-0.5">{current.body}</p>
            <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
              {current.bullets.map(item => <li key={item}>• {item}</li>)}
            </ul>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display font-bold text-lg text-foreground">Systems of Record</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Give agents trusted customer records to reason from, then govern what can be updated back to your CRM or warehouse.</p>
        </div>
        <button
          onClick={() => { setShowCreate(true); setAddWizardStep(0); }}
          className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors inline-flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> Add System
        </button>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex justify-end bg-background/70 backdrop-blur-sm">
          <div className="h-full w-full max-w-3xl border-l border-border bg-card shadow-2xl flex flex-col">
            <div className="border-b border-border px-5 py-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold text-primary uppercase tracking-wider">Guided setup</p>
                <h3 className="font-display font-bold text-lg text-foreground">Add System of Record</h3>
                <p className="text-sm text-muted-foreground mt-0.5">Bring trusted customer records into CRMy so agents can brief, detect changes, and request safe updates back to the source.</p>
              </div>
              <button aria-label="Close add system" onClick={() => setShowCreate(false)} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="border-b border-border px-5 py-3">
              <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                {['Choose', 'Connect', 'Read', 'Map', 'Write', 'Activate'].map((label, index) => (
                  <button
                    key={label}
                    onClick={() => setAddWizardStep(index)}
                    className={`rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${addWizardStep === index ? 'border-primary bg-primary/10 text-primary' : index < addWizardStep ? 'border-success/30 bg-success/10 text-success' : 'border-border bg-background text-muted-foreground hover:text-foreground'}`}
                  >
                    <span className="block text-[10px] opacity-70">Step {index + 1}</span>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {addWizardStep === 0 && (
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Choose the system that owns this data</p>
                    <p className="text-sm text-muted-foreground mt-1">Choose the system agents should use as trusted customer context before they brief, coordinate, or request updates.</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {connectorOptions.map(option => {
                      if (option.type === 'other') {
                        return (
                          <div
                            key={option.type}
                            className="text-left rounded-xl border border-border bg-muted/20 p-4"
                          >
                            <div className="flex h-full flex-col">
                              <p className="text-sm font-semibold text-foreground">{option.label}</p>
                              <p className="text-sm text-muted-foreground mt-1">{option.fit}</p>
                              <div className="mt-4 flex items-center justify-between gap-2 border-t border-border/70 pt-3 text-xs text-muted-foreground">
                                <span className="font-medium">Setup</span>
                                <span className="truncate">{option.auth}</span>
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <Link to="/settings/api-keys" className="h-7 px-2 rounded-md border border-border bg-background text-xs font-semibold text-foreground hover:bg-muted">
                                  API keys
                                </Link>
                                <a href="https://github.com/crmy-ai/crmy/blob/main/docs/mcp-tools.md" target="_blank" rel="noreferrer" className="h-7 px-2 rounded-md border border-border bg-background text-xs font-semibold text-foreground hover:bg-muted">
                                  MCP tools
                                </a>
                              </div>
                            </div>
                          </div>
                        );
                      }
                      return (
                        <button
                          key={option.type}
                          type="button"
                          onClick={() => { handleSystemTypeChange(option.type); if (!name.trim()) setName(`${option.label} connection`); setAddWizardStep(1); }}
                          className={`text-left rounded-xl border p-4 transition-colors ${systemType === option.type ? 'border-primary bg-primary/10' : 'border-border bg-background hover:border-primary/40'}`}
                        >
                          <div className="flex h-full flex-col">
                            <p className="text-sm font-semibold text-foreground">{option.label}</p>
                            <p className="text-sm text-muted-foreground mt-1">{option.fit}</p>
                            <div className="mt-4 flex items-center justify-between gap-2 border-t border-border/70 pt-3 text-xs text-muted-foreground">
                              <span className="font-medium">Setup</span>
                              <span className="truncate">{option.auth}</span>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {addWizardStep === 1 && (
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Connect securely</p>
                    <p className="text-sm text-muted-foreground mt-1">Credentials are encrypted. OAuth is preferred where the external system supports it.</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="Connection name" className={inputCls} />
                    <select value={systemType} onChange={e => handleSystemTypeChange(e.target.value)} className={inputCls}>
                      <option value="">Choose system type</option>
                      <option value="hubspot">HubSpot</option>
                      <option value="salesforce">Salesforce</option>
                      <option value="databricks">Databricks</option>
                      <option value="snowflake">Snowflake</option>
                    </select>
                    {renderAuthTypeField()}
                    {renderCredentialFields()}
                  </div>
                  {systemType && (
                    <details className="rounded-xl border border-border bg-muted/20">
                      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-foreground flex items-center justify-between gap-3">
                        Setup help for {systemLabel(systemType)}
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      </summary>
                      <div className="px-4 pb-4">
                        {systemType === 'hubspot' ? <HubSpotGuide /> : <ConnectorGuide />}
                      </div>
                    </details>
                  )}
                  <details className="rounded-xl border border-border bg-muted/20">
                    <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-foreground flex items-center justify-between gap-3">
                      Advanced connection settings
                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    </summary>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 px-4 pb-4">
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Config JSON</label>
                        <textarea value={configInput} onChange={e => setConfigInput(e.target.value)} className={textAreaCls} />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Sync Settings JSON</label>
                        <textarea value={syncInput} onChange={e => setSyncInput(e.target.value)} className={textAreaCls} />
                      </div>
                    </div>
                  </details>
                </div>
              )}

              {addWizardStep === 2 && (
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Choose what CRMy should read</p>
                    <p className="text-sm text-muted-foreground mt-1">These choices create conservative read mappings when presets exist. Use Cases remain review-only until a typed adapter is available.</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {objectOptions.map(option => (
                      <label key={option.key} className={`rounded-xl border p-4 cursor-pointer transition-colors ${setupReadObjects.includes(option.key) ? 'border-primary bg-primary/10' : 'border-border bg-background hover:border-primary/40'}`}>
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={setupReadObjects.includes(option.key)}
                            onChange={() => toggleReadObject(option.key)}
                            className="mt-1 h-4 w-4 rounded border-border"
                          />
                          <div>
                            <p className="text-sm font-semibold text-foreground">{option.label}</p>
                            <p className="text-sm text-muted-foreground mt-1">{option.description}</p>
                            {option.limited && <p className="text-xs text-warning mt-2">Visible for review; direct sync requires a follow-up adapter.</p>}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {addWizardStep === 3 && (
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Map fields without writing anything yet</p>
                    <p className="text-sm text-muted-foreground mt-1">Preset mappings read common fields. You can refine exact fields in the Mappings tab after saving.</p>
                  </div>
                  <div className="rounded-xl border border-border bg-background p-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Selected read mappings</p>
                    <div className="space-y-2">
                      {selectedReadOptions.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No record types selected yet.</p>
                      ) : selectedReadOptions.map(option => (
                        <div key={option.key} className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2">
                          <div>
                            <p className="text-sm font-semibold text-foreground">{option.label}</p>
                            <p className="text-xs text-muted-foreground">Read fields from {systemType ? systemLabel(systemType) : 'the system'} into typed CRMy records.</p>
                          </div>
                          <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">Read only</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {addWizardStep === 4 && (
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Review write access</p>
                    <p className="text-sm text-muted-foreground mt-1">New mappings are read-only. Enable writeback later per object and field after reviewing policy.</p>
                  </div>
                  <div className="rounded-xl border border-success/30 bg-success/10 p-4 flex items-start gap-3">
                    <ShieldCheck className="w-5 h-5 text-success shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-foreground">Writeback disabled by default</p>
                      <p className="text-sm text-muted-foreground mt-1">Agents and Automations can request governed writebacks only after you choose writable fields and approval behavior in Mappings.</p>
                    </div>
                  </div>
                </div>
              )}

              {addWizardStep === 5 && (
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Test and activate</p>
                    <p className="text-sm text-muted-foreground mt-1">Save the system, then test the connection and run the first sync from the system card.</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="rounded-xl border border-border bg-background p-3">
                      <p className="text-xs text-muted-foreground">System</p>
                      <p className="text-sm font-semibold text-foreground mt-1">{systemType ? systemLabel(systemType) : 'Not selected'}</p>
                    </div>
                    <div className="rounded-xl border border-border bg-background p-3">
                      <p className="text-xs text-muted-foreground">Reads</p>
                      <p className="text-sm font-semibold text-foreground mt-1">{selectedReadOptions.length ? selectedReadOptions.map(item => item.label).join(', ') : 'None selected'}</p>
                    </div>
                    <div className="rounded-xl border border-border bg-background p-3">
                      <p className="text-xs text-muted-foreground">Writes</p>
                      <p className="text-sm font-semibold text-foreground mt-1">Disabled</p>
                    </div>
                  </div>
                  <div className="overflow-hidden rounded-xl border border-border bg-background">
                    <div className="border-b border-border px-4 py-3">
                      <p className="text-sm font-semibold text-foreground">Activation preview</p>
                      <p className="text-xs text-muted-foreground mt-0.5">CRMy will create read-only mappings first. You can refine fields or enable governed writeback later.</p>
                    </div>
                    {setupPreviewRows.length === 0 ? (
                      <p className="px-4 py-4 text-sm text-muted-foreground">Choose at least one record type to preview the mappings CRMy will create.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-muted/40 text-xs text-muted-foreground">
                            <tr>
                              <th className="px-4 py-2 font-medium">External object</th>
                              <th className="px-4 py-2 font-medium">CRMy record</th>
                              <th className="px-4 py-2 font-medium">Match by</th>
                              <th className="px-4 py-2 font-medium">Example fields</th>
                              <th className="px-4 py-2 font-medium">Writeback</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {setupPreviewRows.map(row => (
                              <tr key={row.key}>
                                <td className="px-4 py-2 font-medium text-foreground">{row.externalObject}</td>
                                <td className="px-4 py-2 text-muted-foreground">{row.crmyRecord}</td>
                                <td className="px-4 py-2 text-muted-foreground">{row.matchField}</td>
                                <td className="max-w-[260px] px-4 py-2 text-muted-foreground">{row.fields}</td>
                                <td className="px-4 py-2">
                                  <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs font-semibold text-muted-foreground">{row.writes}</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="border-t border-border p-4 flex items-center justify-between gap-3">
              <button
                onClick={() => addWizardStep === 0 ? setShowCreate(false) : setAddWizardStep(step => Math.max(0, step - 1))}
                className="h-9 px-3 rounded-lg border border-border text-sm font-semibold hover:bg-muted transition-colors"
              >
                {addWizardStep === 0 ? 'Cancel' : 'Back'}
              </button>
              <div className="flex items-center gap-2">
                {addWizardStep < 5 ? (
                  <button
                    onClick={() => setAddWizardStep(step => Math.min(5, step + 1))}
                    disabled={addWizardStep === 0 && !systemType}
                    className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-40"
                  >
                    Continue
                  </button>
                ) : (
                  <button onClick={handleCreateSystem} disabled={!name.trim() || !systemType || createSystem.isPending || upsertMapping.isPending} className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors">
                    {createSystem.isPending || upsertMapping.isPending ? 'Saving...' : 'Save System'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1 border-b border-border">
        {tabs.map(item => (
          <button
            key={item.key}
            onClick={() => setTab(item.key)}
            className={`px-3 py-2 text-sm font-semibold border-b-2 transition-colors ${tab === item.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {item.label} <span className="text-xs opacity-70">{item.count}</span>
          </button>
        ))}
      </div>

      {tab === 'systems' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {systemsLoading ? <div className="h-28 rounded-xl bg-muted/50 animate-pulse" /> : systems.length === 0 ? (
            <div className={`${cardCls} xl:col-span-2 text-center py-10`}>
              <Server className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground">No systems connected</p>
              <p className="text-sm text-muted-foreground mt-1">Connect the CRM or warehouse that owns customer data. CRMy reads mapped records first; writeback stays explicit and governed.</p>
              <p className="text-xs text-muted-foreground mt-2">
                Building a custom connector? Use <Link to="/settings/api-keys" className="text-primary hover:underline">API keys</Link> with REST, CLI, or MCP tools.
              </p>
              <button
                onClick={() => { setShowCreate(true); setAddWizardStep(0); }}
                className="mt-4 h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 inline-flex items-center gap-2 mx-auto"
              >
                <Plus className="w-4 h-4" /> Add System
              </button>
            </div>
          ) : systems.map(system => {
            const systemMappings = mappings.filter(m => m.system_id === system.id);
            const mappedCount = systemMappings.length;
            const conflictCount = conflicts.filter(c => c.system_id === system.id && c.status === 'open').length;
            const writebackCount = writebacks.filter(w => w.system_id === system.id && w.status === 'approval_required').length;
            const readLabels = systemMappings.map(mapping => mapping.object_type.replace('_', ' '));
            const writableMappings = systemMappings.filter(mapping => mapping.writeback_mode && (mapping.writable_fields ?? []).length > 0);
            const writeLabel = writableMappings.length === 0
              ? 'Disabled'
              : writableMappings.every(mapping => mapping.source_authority === 'approval_required')
                ? 'Approval required'
                : 'Selected fields only';
            const installUrl = hubSpotInstallHref(system);
            const actionState = systemActionState(system, mappedCount);
            const oauthIncomplete = system.system_type === 'hubspot'
              && system.auth_type === 'oauth_app'
              && system.status !== 'connected'
              && (system.status !== 'error' || isHubSpotOAuthIncomplete(system.last_error));
            const tokenLabel = tokenHealthLabel(system);
            const latestRun = latestRunForSystem(system.id);
            const readinessItems = systemReadinessItems(system, systemMappings, writeLabel, latestRun);
            return (
              <div key={system.id} className={cardCls}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0"><Server className="w-5 h-5" /></span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{system.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">{system.system_type} • {system.auth_type}</p>
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${statusClass(system.status)}`}>{system.status}</span>
                </div>
                <div className="mt-4 rounded-xl border border-border bg-muted/20 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground">
                    <span className="rounded-md bg-background px-2 py-1">{systemLabel(system.system_type)}</span>
                    <span>→</span>
                    <span className="rounded-md bg-background px-2 py-1">CRMy records</span>
                    <span>→</span>
                    <span className="rounded-md bg-background px-2 py-1">Signals & Memory</span>
                    <span>→</span>
                    <span className="rounded-md bg-background px-2 py-1">Handoffs / Automations</span>
                    <span>→</span>
                    <span className="rounded-md bg-background px-2 py-1">Governed writeback</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                      Reads: {readLabels.length ? readLabels.join(', ') : 'Not mapped yet'}
                    </span>
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${writeLabel === 'Disabled' ? 'border-border bg-background text-muted-foreground' : 'border-warning/30 bg-warning/10 text-warning'}`}>
                      Writes: {writeLabel}
                    </span>
                    <span className="rounded-full border border-border bg-background px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                      When: Manual sync
                    </span>
                    {writeLabel !== 'Disabled' && (
                      <span className="rounded-full border border-border bg-background px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                        When: Approved handoff or Automation request
                      </span>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                  <div className="rounded-lg bg-muted/50 p-2"><p className="text-sm font-semibold">{mappedCount}</p><p className="text-xs text-muted-foreground">Mappings</p></div>
                  <div className="rounded-lg bg-muted/50 p-2"><p className="text-sm font-semibold">{conflictCount}</p><p className="text-xs text-muted-foreground">Conflicts</p></div>
                  <div className="rounded-lg bg-muted/50 p-2"><p className="text-sm font-semibold">{writebackCount}</p><p className="text-xs text-muted-foreground">Needs review</p></div>
                </div>
                <div className="mt-3 rounded-xl border border-border bg-background/70 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Readiness</p>
                  <div className="mt-2 grid grid-cols-1 gap-2">
                    {readinessItems.map(item => (
                      <div key={item.label} className="flex items-start gap-2 rounded-lg bg-muted/30 px-2.5 py-2">
                        <span className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full ${readinessIconClass(item.tone)}`}>
                          {item.tone === 'ready' ? <CheckCircle2 className="h-3.5 w-3.5" /> : item.tone === 'error' ? <XCircle className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground">{item.label}</p>
                          <p className="text-xs text-muted-foreground">{item.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className={`mt-3 rounded-xl border p-3 ${actionStateClass(actionState.tone)}`}>
                  <div className="flex items-start gap-2">
                    {actionState.tone === 'success'
                      ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                      : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">{actionState.title}</p>
                      <p className="text-sm text-muted-foreground mt-0.5">{actionState.description}</p>
                      {tokenLabel && <p className="text-xs text-muted-foreground mt-1">{tokenLabel}</p>}
                    </div>
                  </div>
                </div>
                {oauthIncomplete && (
                  <div className="mt-3 rounded-xl border border-warning/30 bg-warning/10 p-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">Finish HubSpot OAuth</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          HubSpot app credentials are saved. Open the install flow, approve access, and CRMy will finish the connection when HubSpot redirects back here.
                        </p>
                        <div className="flex flex-wrap gap-2 mt-3">
                          {installUrl && (
                            <a
                              href={installUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 inline-flex items-center gap-1.5"
                            >
                              Open HubSpot Install <Globe className="w-3 h-3" />
                            </a>
                          )}
                          <button
                            onClick={() => startEditSystem(system)}
                            className="h-8 px-3 rounded-lg border border-border bg-card text-xs font-semibold hover:bg-muted"
                          >
                            Manual Finish
                          </button>
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                          Manual finish is only needed if the browser blocks the redirect or you installed from a different CRMy URL.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-3">Last sync: {system.last_sync_at ? fmtDate(system.last_sync_at) : 'Never'}</p>
                {editingSystemId === system.id && (
                  <div className="mt-4 rounded-xl border border-border bg-muted/20 p-3 space-y-3">
                    <div className="flex items-start gap-2">
                      <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      <p className="text-sm text-muted-foreground">
                        Update the connection name, auth path, or encrypted credentials. Blank credential fields keep the existing secret.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <input value={editName} onChange={e => setEditName(e.target.value)} placeholder="Connection name" className={inputCls} />
                      {renderEditAuthTypeField(system)}
                      {renderEditCredentialFields(system)}
                    </div>
                    <details className="rounded-xl border border-border bg-background/70">
                      <summary className="cursor-pointer list-none px-3 py-2 text-sm font-semibold text-foreground flex items-center justify-between gap-3">
                        Advanced connection settings
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      </summary>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 px-3 pb-3">
                        <div>
                          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Config JSON</label>
                          <textarea value={editConfigInput} onChange={e => setEditConfigInput(e.target.value)} className={textAreaCls} />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Sync Settings JSON</label>
                          <textarea value={editSyncInput} onChange={e => setEditSyncInput(e.target.value)} className={textAreaCls} />
                        </div>
                      </div>
                    </details>
                    <div className="flex justify-end gap-2">
                      <button onClick={cancelEditSystem} className="h-8 px-3 rounded-lg border border-border text-xs font-semibold hover:bg-muted">Cancel</button>
                      <button
                        onClick={() => handleUpdateSystem(system)}
                        disabled={!editName.trim() || updateSystem.isPending}
                        className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-40"
                      >
                        {updateSystem.isPending ? 'Saving...' : 'Save Changes'}
                      </button>
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap gap-2 mt-4">
                  <button onClick={() => startEditSystem(system)} className="h-8 px-3 rounded-lg border border-border text-xs font-semibold hover:bg-muted">Edit</button>
                  <button
                    onClick={() => testSystem.mutate(system.id, {
                      onSuccess: result => {
                        const response = result as { ok?: boolean; message?: string };
                        if (response.ok === false) {
                          if (isHubSpotOAuthIncomplete(response.message)) startEditSystem(system);
                          toast({
                            title: 'Test needs attention',
                            description: response.message ?? 'Check credentials and try again.',
                            variant: 'destructive',
                          });
                          return;
                        }
                        toast({ title: 'Connection verified', description: response.message ?? 'CRMy validated access to the external system.' });
                      },
                      onError: err => toast({ title: 'Test failed', description: err instanceof Error ? err.message : 'Check credentials and try again.', variant: 'destructive' }),
                    })}
                    className="h-8 px-3 rounded-lg border border-border text-xs font-semibold hover:bg-muted"
                  >
                    Test
                  </button>
                  <button
                    onClick={() => runSystemSyncFor(system, mappedCount)}
                    disabled={runSync.isPending}
                    title={system.status !== 'connected' ? 'Test the connection before syncing.' : mappedCount === 0 ? 'Add a mapping before syncing.' : 'Run incremental sync.'}
                    className="h-8 px-3 rounded-lg border border-border text-xs font-semibold hover:bg-muted disabled:opacity-40"
                  >
                    {runSync.isPending ? 'Syncing...' : 'Run Sync'}
                  </button>
                  {system.system_type === 'hubspot' && (
                    <button onClick={() => handleApplyHubSpotPresets(system.id)} className="h-8 px-3 rounded-lg border border-border text-xs font-semibold hover:bg-muted">Apply read presets</button>
                  )}
                  <button onClick={() => deleteSystem.mutate(system.id, { onSuccess: () => toast({ title: 'Connection deleted' }) })} className="h-8 px-3 rounded-lg border border-destructive/30 text-xs font-semibold text-destructive hover:bg-destructive/10 ml-auto">Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'mappings' && (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(520px,0.95fr)_1fr] gap-4">
          <div className={cardCls}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">{editingMappingId ? 'Edit record mapping' : 'Map records'}</h3>
                <p className="text-sm text-muted-foreground mt-0.5">Choose an external object, match the same record, then decide which fields can be read or written.</p>
              </div>
              {editingMappingId && (
                <button onClick={resetMappingForm} className="h-7 px-2 rounded-md border border-border text-xs font-semibold hover:bg-muted">
                  New mapping
                </button>
              )}
            </div>
            <div className="space-y-3">
              <select value={mappingSystemId} onChange={e => setMappingSystemId(e.target.value)} className={`${inputCls} w-full`}>
                {systems.map(system => <option key={system.id} value={system.id}>{system.name}</option>)}
              </select>
              {systems.find(system => system.id === mappingSystemId)?.system_type === 'hubspot' && (
                <button
                  onClick={() => handleApplyHubSpotPresets(mappingSystemId)}
                  className="w-full h-9 rounded-lg border border-primary/30 bg-primary/5 text-primary text-sm font-semibold hover:bg-primary/10 transition-colors"
                >
                  Apply HubSpot read presets
                </button>
              )}
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">CRMy record</span>
                  <select value={mappingObjectType} onChange={e => setMappingObjectType(e.target.value)} className={`${inputCls} w-full`}>
                    <option value="contact">Contact</option>
                    <option value="account">Account</option>
                    <option value="opportunity">Opportunity</option>
                    <option value="activity">Activity</option>
                    <option value="use_case">Use Case (conflict review only)</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">External object / table</span>
                  <input value={mappingExternalObject} onChange={e => setMappingExternalObject(e.target.value)} placeholder="e.g. contacts, Account, customer_table" className={`${inputCls} w-full`} />
                </label>
              </div>
              {mappingObjectType === 'use_case' && (
                <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                  Use Case mappings are visible for review and conflict tracking in 0.8. Direct sync into Use Cases needs a follow-up typed-object adapter.
                </div>
              )}
              <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Discover schema</p>
                    <p className="text-sm text-muted-foreground mt-0.5">Use the live connection to choose external objects and field names.</p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <button onClick={discoverExternalObjects} className="h-8 px-2 rounded-lg border border-border text-xs font-semibold hover:bg-background">Objects</button>
                    <button onClick={discoverExternalFields} className="h-8 px-2 rounded-lg border border-border text-xs font-semibold hover:bg-background">Fields</button>
                  </div>
                </div>
                {discoveryMode && (
                  <div className="rounded-lg border border-border bg-background p-2">
                    {discovery.isFetching ? (
                      <p className="text-sm text-muted-foreground">Discovering {discoveryMode}...</p>
                    ) : discovery.error ? (
                      <p className="text-sm text-destructive">{discovery.error instanceof Error ? discovery.error.message : 'Could not discover schema. Test the connection and try again.'}</p>
                    ) : discoveryItems.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No {discoveryMode} returned for this connection.</p>
                    ) : (
                      <div className="max-h-48 overflow-y-auto space-y-1">
                        {discoveryItems.slice(0, 50).map((item, index) => {
                          const itemName = String(item.name ?? '');
                          const itemLabel = String(item.label ?? item.name ?? '');
                          return (
                            <div key={`${itemName}-${index}`} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60">
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-foreground truncate">{itemLabel}</p>
                                <p className="text-xs text-muted-foreground truncate">{itemName}{item.type ? ` • ${String(item.type)}` : ''}</p>
                              </div>
                              {discoveryMode === 'objects' ? (
                                <button onClick={() => { setMappingExternalObject(itemName); setDiscoveryMode(''); }} className="h-7 px-2 rounded-md border border-border text-xs font-semibold hover:bg-background">Use</button>
                              ) : (
                                <div className="flex items-center gap-1">
                                  <button onClick={() => setMappingExternalField(itemName)} className="h-7 px-2 rounded-md border border-border text-xs font-semibold hover:bg-background">Use</button>
                                  <button onClick={() => setMappingIdField(itemName)} className="h-7 px-2 rounded-md border border-border text-xs font-semibold hover:bg-background">ID</button>
                                  <button onClick={() => setMappingWatermarkField(itemName)} className="h-7 px-2 rounded-md border border-border text-xs font-semibold hover:bg-background">Watermark</button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">How CRMy matches the same record</span>
                  <input value={mappingIdField} onChange={e => setMappingIdField(e.target.value)} placeholder="External ID field" className={`${inputCls} w-full`} />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">How CRMy detects changes</span>
                  <input value={mappingWatermarkField} onChange={e => setMappingWatermarkField(e.target.value)} placeholder="Updated timestamp field" className={`${inputCls} w-full`} />
                </label>
              </div>
              <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-2">
                <div>
                  <p className="text-sm font-semibold text-foreground">Add field mapping</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Map a CRMy field to the external field name. Mapped fields are read during sync; writeback is opt-in per field.</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2">
                  <select value={mappingCrmyField} onChange={e => setMappingCrmyField(e.target.value)} className={inputCls}>
                    {mappingFieldOptions.map(field => (
                      <option key={field.value} value={field.value}>{field.label}</option>
                    ))}
                  </select>
                  <input
                    value={mappingExternalField}
                    onChange={e => setMappingExternalField(e.target.value)}
                    placeholder="External field name"
                    className={inputCls}
                  />
                  <button
                    onClick={() => addFieldMapping()}
                    className="h-10 px-3 rounded-lg border border-border text-sm font-semibold hover:bg-background"
                  >
                    Add
                  </button>
                </div>
              </div>
              <div className="rounded-xl border border-border bg-background overflow-hidden">
                <div className="grid grid-cols-[1fr_1fr_72px_88px_44px] gap-2 border-b border-border bg-muted/30 px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <span>CRMy field</span>
                  <span>External field</span>
                  <span className="text-center">Read</span>
                  <span className="text-center">Write</span>
                  <span />
                </div>
                {mappingFieldPairs.length === 0 ? (
                  <div className="px-3 py-6 text-sm text-muted-foreground text-center">No fields mapped yet. Add the first field above or apply a preset.</div>
                ) : mappingFieldPairs.map(([crmyField, externalField]) => (
                  <div key={crmyField} className="grid grid-cols-[1fr_1fr_72px_88px_44px] gap-2 items-center border-b border-border/70 px-3 py-2 last:border-b-0">
                    <span className="text-sm font-medium text-foreground truncate">{mappingFieldOptions.find(field => field.value === crmyField)?.label ?? crmyField}</span>
                    <input
                      value={externalField}
                      onChange={e => updateMappedField(crmyField, e.target.value)}
                      className="h-8 rounded-md border border-border bg-card px-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
                    />
                    <span className="justify-self-center rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">Yes</span>
                    <label className="justify-self-center inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={writableFieldSet.has(externalField)}
                        onChange={e => toggleWritableField(externalField, e.target.checked)}
                        className="h-4 w-4 rounded border-border"
                      />
                      Allow
                    </label>
                    <button aria-label={`Remove ${crmyField} mapping`} onClick={() => removeMappedField(crmyField)} className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="rounded-xl border border-border bg-muted/20 p-3">
                <p className="text-sm font-semibold text-foreground">Readiness</p>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div className="flex items-start gap-2 rounded-lg bg-background p-2">
                    {mappingIdField.trim() ? <CheckCircle2 className="w-4 h-4 text-success mt-0.5" /> : <AlertTriangle className="w-4 h-4 text-warning mt-0.5" />}
                    <p className="text-sm text-muted-foreground">{mappingIdField.trim() ? 'Record matching is set.' : 'Choose the external ID field.'}</p>
                  </div>
                  <div className="flex items-start gap-2 rounded-lg bg-background p-2">
                    {mappingWatermarkField.trim() ? <CheckCircle2 className="w-4 h-4 text-success mt-0.5" /> : <AlertTriangle className="w-4 h-4 text-warning mt-0.5" />}
                    <p className="text-sm text-muted-foreground">{mappingWatermarkField.trim() ? 'Change detection is set.' : 'Add an updated timestamp when available.'}</p>
                  </div>
                  <div className="flex items-start gap-2 rounded-lg bg-background p-2">
                    {mappingFieldPairs.length > 0 ? <CheckCircle2 className="w-4 h-4 text-success mt-0.5" /> : <AlertTriangle className="w-4 h-4 text-warning mt-0.5" />}
                    <p className="text-sm text-muted-foreground">{mappingFieldPairs.length > 0 ? `${mappingFieldPairs.length} field${mappingFieldPairs.length !== 1 ? 's' : ''} will be read.` : 'Map at least one field.'}</p>
                  </div>
                  <div className="flex items-start gap-2 rounded-lg bg-background p-2">
                    {mappingWritebackMode && parseCsvList(mappingWritableFields).length > 0 ? <ShieldCheck className="w-4 h-4 text-warning mt-0.5" /> : <CheckCircle2 className="w-4 h-4 text-success mt-0.5" />}
                    <p className="text-sm text-muted-foreground">{mappingWritebackMode && parseCsvList(mappingWritableFields).length > 0 ? `${parseCsvList(mappingWritableFields).length} field${parseCsvList(mappingWritableFields).length !== 1 ? 's' : ''} may be written with policy checks.` : 'Writeback is disabled for this mapping.'}</p>
                  </div>
                </div>
              </div>
              <details className="rounded-xl border border-border bg-muted/20">
                <summary className="cursor-pointer list-none px-3 py-2 text-sm font-semibold text-foreground flex items-center justify-between gap-3">
                  Advanced mapping
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                </summary>
                <div className="space-y-3 px-3 pb-3">
                  <p className="text-sm text-muted-foreground">
                    Use these controls for scoped reads, governed writeback, conflict authority, loop prevention, and raw JSON editing.
                  </p>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Field mapping JSON</label>
                    <textarea value={mappingFieldJson} onChange={e => setMappingFieldJson(e.target.value)} className={`${textAreaCls} mt-1`} />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Readable fields</label>
                      <input
                        value={mappingReadableFields}
                        onChange={e => setMappingReadableFields(e.target.value)}
                        placeholder="Comma-separated external fields"
                        className={`${inputCls} w-full mt-1`}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Fields CRMy may update</label>
                      <input
                        value={mappingWritableFields}
                        onChange={e => setMappingWritableFields(e.target.value)}
                        placeholder="Fields agents/workflows may write"
                        className={`${inputCls} w-full mt-1`}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">When values differ</span>
                    <select value={mappingSourceAuthority} onChange={e => setMappingSourceAuthority(e.target.value)} className={`${inputCls} w-full`}>
                      <option value="external">External source wins</option>
                      <option value="crmy">CRMy source wins</option>
                      <option value="bidirectional">Bidirectional</option>
                      <option value="read_only">Read only</option>
                      <option value="approval_required">Approval required</option>
                    </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Writeback behavior</span>
                    <select value={mappingWritebackMode} onChange={e => setMappingWritebackMode(e.target.value)} className={`${inputCls} w-full`}>
                      <option value="">No writeback</option>
                      <option value="append_event">Append-only event</option>
                      <option value="mapped_upsert">Mapped upsert</option>
                      <option value="stored_procedure">Stored procedure</option>
                    </select>
                    </label>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Writeback config JSON</label>
                    <textarea
                      value={mappingWritebackConfigJson}
                      onChange={e => setMappingWritebackConfigJson(e.target.value)}
                      placeholder='{"sql_template":"CALL update_customer(?, ?)","parameter_order":["account_id","health_score"]}'
                      className={`${textAreaCls} mt-1`}
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <label className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={mappingIsActive}
                        onChange={e => setMappingIsActive(e.target.checked)}
                        className="h-4 w-4 rounded border-border"
                      />
                      Mapping active
                    </label>
                    <label className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={mappingAllowSourceLoop}
                        onChange={e => setMappingAllowSourceLoop(e.target.checked)}
                        className="h-4 w-4 rounded border-border"
                      />
                      Allow source-loop writebacks
                    </label>
                  </div>
                </div>
              </details>
              <button onClick={handleUpsertMapping} disabled={!mappingSystemId || upsertMapping.isPending} className="w-full h-9 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-40">{editingMappingId ? 'Save Changes' : 'Save Mapping'}</button>
            </div>
          </div>
          <div className="space-y-2">
            {mappings.length === 0 ? (
              <div className={`${cardCls} text-center py-10`}>
                <Database className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-sm font-semibold text-foreground">No mappings yet</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                  Mappings are the contract between an external object and a typed CRMy record. Add one before running sync.
                </p>
                {systems.find(system => system.id === mappingSystemId)?.system_type === 'hubspot' ? (
                  <button
                    onClick={() => handleApplyHubSpotPresets(mappingSystemId)}
                    disabled={!mappingSystemId || upsertMapping.isPending}
                    className="mt-4 h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-40"
                  >
                    Apply HubSpot Defaults
                  </button>
                ) : (
                  <button
                    onClick={discoverExternalObjects}
                    disabled={!mappingSystemId}
                    className="mt-4 h-9 px-3 rounded-lg border border-border text-sm font-semibold hover:bg-muted disabled:opacity-40"
                  >
                    Discover Objects
                  </button>
                )}
              </div>
            ) : mappings.map(mapping => {
              const hasWritableFields = (mapping.writable_fields ?? []).length > 0;
              const hasWritebackConfig = mapping.writeback_config && Object.keys(mapping.writeback_config).length > 0;
              return (
              <div key={mapping.id} className={`${cardCls} flex items-center justify-between gap-3`}>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground capitalize">{mapping.object_type.replace('_', ' ')}</p>
                  <p className="text-xs text-muted-foreground">
                    {systems.find(s => s.id === mapping.system_id)?.name ?? mapping.system_id} • {mapping.external_object}
                    {mapping.last_sync_at ? ` • Last sync ${fmtDate(mapping.last_sync_at)}` : ''}
                    {mapping.sync_watermark ? ` • Watermark ${mapping.sync_watermark}` : ''}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="rounded-md border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {(mapping.source_authority ?? 'external').replace('_', ' ')}
                    </span>
                    {mapping.writeback_mode ? (
                      <span className={`rounded-md border px-2 py-0.5 text-xs ${hasWritableFields ? 'border-success/30 bg-success/10 text-success' : 'border-warning/30 bg-warning/10 text-warning'}`}>
                        {mapping.writeback_mode} • {(mapping.writable_fields ?? []).length} writable
                      </span>
                    ) : (
                      <span className="rounded-md border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">read only</span>
                    )}
                    {mapping.writeback_mode === 'stored_procedure' || systems.find(s => s.id === mapping.system_id)?.system_type === 'databricks' || systems.find(s => s.id === mapping.system_id)?.system_type === 'snowflake' ? (
                      <span className={`rounded-md border px-2 py-0.5 text-xs ${hasWritebackConfig ? 'border-success/30 bg-success/10 text-success' : 'border-warning/30 bg-warning/10 text-warning'}`}>
                        {hasWritebackConfig ? 'writeback config set' : 'writeback config needed'}
                      </span>
                    ) : null}
                    {mapping.allow_source_loop && (
                      <span className="rounded-md border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs text-warning">source loop allowed</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${mapping.is_active ? statusClass('completed') : statusClass('inactive')}`}>{mapping.is_active ? 'active' : 'inactive'}</span>
                  {confirmDeleteMappingId === mapping.id ? (
                    <>
                      <button onClick={() => handleDeleteMapping(mapping)} disabled={deleteMapping.isPending} className="h-8 px-2 rounded-lg border border-destructive/30 text-xs font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-40">Confirm</button>
                      <button onClick={() => setConfirmDeleteMappingId('')} className="h-8 px-2 rounded-lg border border-border text-xs font-semibold hover:bg-muted">Cancel</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => startEditMapping(mapping)} className="h-8 px-2 rounded-lg border border-border text-xs font-semibold hover:bg-muted">Edit</button>
                      <button onClick={() => setConfirmDeleteMappingId(mapping.id)} className="h-8 px-2 rounded-lg border border-destructive/30 text-xs font-semibold text-destructive hover:bg-destructive/10">Delete</button>
                    </>
                  )}
                </div>
              </div>
            );
            })}
          </div>
        </div>
      )}

      {tab === 'activity' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Sync activity</h3>
              <p className="text-sm text-muted-foreground mt-0.5">See what CRMy read from connected systems and where sync needs attention.</p>
            </div>
          </div>
          {runs.length === 0 ? (
            <div className={`${cardCls} text-center py-10`}>
              <RefreshCw className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground">No sync runs yet</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                Test a connection, add mappings, then run sync to bring external customer records into CRMy.
              </p>
              <button
                onClick={() => setTab(systems.length === 0 ? 'systems' : mappings.length === 0 ? 'mappings' : 'systems')}
                className="mt-4 h-9 px-3 rounded-lg border border-border text-sm font-semibold hover:bg-muted"
              >
                {systems.length === 0 ? 'Add System' : mappings.length === 0 ? 'Add Mapping' : 'Choose System'}
              </button>
            </div>
          ) : runs.map(run => (
            <div key={String(run.id)} className={`${cardCls} flex items-center justify-between gap-3`}>
              <div>
                <p className="text-sm font-semibold text-foreground">{systems.find(s => s.id === run.system_id)?.name ?? String(run.system_id)}</p>
                <p className="text-xs text-muted-foreground">
                  {syncRunSummary(run)}
                  {' '}• {fmtDate(run.started_at)}
                </p>
                {run.error ? <p className="text-xs text-destructive mt-1">{String(run.error)}</p> : null}
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full border ${statusClass(String(run.status ?? ''))}`}>{String(run.status ?? 'unknown')}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'activity' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 pt-2">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Conflicts</h3>
              <p className="text-sm text-muted-foreground mt-0.5">When CRMy and the system of record disagree, resolve the difference here.</p>
            </div>
          </div>
          {conflicts.length === 0 ? (
            <div className={`${cardCls} text-center py-10`}>
              <CheckCircle2 className="w-8 h-8 text-success/70 mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground">No open sync conflicts</p>
              <p className="text-sm text-muted-foreground mt-1">When source and CRMy values disagree, conflicts appear here for review.</p>
            </div>
          ) : conflicts.map(conflict => (
            <div key={String(conflict.id)} className={cardCls}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">{String(conflict.object_type)} • {String(conflict.field_name)}</p>
                  <p className="text-xs text-muted-foreground">{String(conflict.external_object)} / {String(conflict.external_record_id)}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full border ${statusClass(String(conflict.status ?? ''))}`}>{String(conflict.status)}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
                <code className="rounded-lg bg-muted/50 p-2 text-xs overflow-x-auto">Local: {JSON.stringify(conflict.local_value)}</code>
                <code className="rounded-lg bg-muted/50 p-2 text-xs overflow-x-auto">External: {JSON.stringify(conflict.external_value)}</code>
              </div>
              {conflict.status === 'open' && (
                <div className="flex gap-2 mt-3">
                  <button onClick={() => handleResolveConflict(String(conflict.id), 'resolved_external')} disabled={resolveConflict.isPending} className="h-8 px-3 rounded-lg border border-border text-xs font-semibold hover:bg-muted disabled:opacity-50">Use External</button>
                  <button onClick={() => handleResolveConflict(String(conflict.id), 'resolved_local')} disabled={resolveConflict.isPending} className="h-8 px-3 rounded-lg border border-border text-xs font-semibold hover:bg-muted disabled:opacity-50">Keep Local</button>
                  <button onClick={() => handleResolveConflict(String(conflict.id), 'ignored')} disabled={resolveConflict.isPending} className="h-8 px-3 rounded-lg border border-border text-xs font-semibold hover:bg-muted disabled:opacity-50">Ignore</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'activity' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 pt-2">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Writeback receipts</h3>
              <p className="text-sm text-muted-foreground mt-0.5">Track governed requests from Handoffs, Automations, and the advanced test bench.</p>
            </div>
            <button onClick={() => setTab('advanced')} className="h-8 px-3 rounded-lg border border-border text-xs font-semibold hover:bg-muted">
              Test writeback
            </button>
          </div>
          {writebacks.length === 0 ? (
            <div className={`${cardCls} text-center py-8`}>
              <ShieldCheck className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground">No writebacks requested</p>
              <p className="text-sm text-muted-foreground mt-1">Governed writes will appear here after approval or execution.</p>
            </div>
          ) : writebacks.map(writeback => (
            <div key={String(writeback.id)} className={`${cardCls} flex items-center justify-between gap-3`}>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">
                  {String(writeback.operation)} {String(writeback.object_type)} to {systems.find(s => s.id === writeback.system_id)?.name ?? String(writeback.system_id)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {String(writeback.writeback_mode)} • {fmtDate(writeback.created_at)}
                </p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full border ${statusClass(String(writeback.status ?? ''))}`}>{String(writeback.status)}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'advanced' && (
        <div className="space-y-4">
          <div className={`${cardCls} grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4`}>
            <div className="space-y-3">
              <div>
                <p className="text-sm font-semibold text-foreground">Advanced: test writeback request</p>
                <p className="text-sm text-muted-foreground mt-0.5">Use this admin test bench to preview policy and diff checks. Normal writebacks should come from Handoffs and Automations.</p>
              </div>
              <select value={writebackSystemId} onChange={e => { setWritebackSystemId(e.target.value); setWritebackMappingId(''); setWritebackPreview(null); }} className={`${inputCls} w-full`}>
                <option value="">Select system</option>
                {systems.map(system => <option key={system.id} value={system.id}>{system.name} ({system.system_type})</option>)}
              </select>
              <select value={writebackMappingId} onChange={e => applyWritebackMapping(e.target.value)} className={`${inputCls} w-full`}>
                <option value="">{writebackSystemId ? 'Select mapping' : 'Select system first'}</option>
                {writebackMappings.map(mapping => (
                  <option key={mapping.id} value={mapping.id}>
                    {mapping.object_type.replace('_', ' ')} → {mapping.external_object}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <select value={writebackObjectType} onChange={e => { setWritebackObjectType(e.target.value); setWritebackPreview(null); }} className={inputCls}>
                  <option value="contact">Contact</option>
                  <option value="account">Account</option>
                  <option value="opportunity">Opportunity</option>
                  <option value="activity">Activity</option>
                  <option value="use_case">Use Case</option>
                  <option value="context_entry">Context Entry</option>
                </select>
                <input value={writebackExternalObject} onChange={e => { setWritebackExternalObject(e.target.value); setWritebackPreview(null); }} placeholder="External object" className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select value={writebackOperation} onChange={e => { setWritebackOperation(e.target.value); setWritebackPreview(null); }} className={inputCls}>
                  <option value="create">Create</option>
                  <option value="update">Update</option>
                  <option value="upsert">Upsert</option>
                  <option value="append_event">Append event</option>
                  <option value="stored_procedure">Stored procedure</option>
                </select>
                <select value={writebackMode} onChange={e => { setWritebackMode(e.target.value); setWritebackPreview(null); }} className={inputCls}>
                  <option value="mapped_upsert">Mapped upsert</option>
                  <option value="append_event">Append-only event</option>
                  <option value="stored_procedure">Stored procedure</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input value={writebackObjectId} onChange={e => setWritebackObjectId(e.target.value)} placeholder="CRMy object ID (optional)" className={inputCls} />
                <input value={writebackExternalRecordId} onChange={e => setWritebackExternalRecordId(e.target.value)} placeholder="External record ID (optional)" className={inputCls} />
              </div>
              <label className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={writebackRequireApproval}
                  onChange={e => setWritebackRequireApproval(e.target.checked)}
                  className="h-4 w-4 rounded border-border"
                />
                Request human approval before execution
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={handlePreviewWriteback} disabled={previewWriteback.isPending || !writebackSystemId} className="h-9 rounded-lg border border-border text-sm font-semibold hover:bg-muted disabled:opacity-40">
                  {previewWriteback.isPending ? 'Previewing...' : 'Preview'}
                </button>
                <button onClick={handleRequestWriteback} disabled={requestWriteback.isPending || !writebackSystemId} className="h-9 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-40">
                  {requestWriteback.isPending ? 'Requesting...' : 'Request'}
                </button>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Payload</p>
                <textarea value={writebackPayloadJson} onChange={e => { setWritebackPayloadJson(e.target.value); setWritebackPreview(null); }} className={`${textAreaCls} min-h-48`} />
              </div>
              {writebackPreview ? (
                (() => {
                  const actionPolicy = actionPolicyFrom(writebackPreview);
                  const decision = writebackDecisionLabel(writebackPreview, actionPolicy);
                  const reasons = writebackReasonList(writebackPreview, actionPolicy);
                  const fields = writebackFieldList(writebackPreview);
                  return (
                    <div className={`rounded-xl border p-3 ${decision === 'Blocked' ? 'border-destructive/30 bg-destructive/5' : 'border-border bg-muted/20'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-foreground">Preview result</p>
                          <p className="text-sm text-muted-foreground mt-0.5">
                            {fields.length > 0 ? `${fields.length} field${fields.length !== 1 ? 's' : ''} checked` : 'Payload checked'}
                            {writebackPreview.mode ? ` • ${String(writebackPreview.mode).replace('_', ' ')}` : ''}
                          </p>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${writebackDecisionClass(decision)}`}>
                          {decision}
                        </span>
                      </div>
                      {fields.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {fields.slice(0, 8).map(field => (
                            <span key={field} className="rounded-md border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground">{field}</span>
                          ))}
                          {fields.length > 8 && <span className="rounded-md border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground">+{fields.length - 8} more</span>}
                        </div>
                      )}
                      {reasons.length > 0 ? (
                        <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                          {reasons.map(reason => <li key={reason}>• {reason}</li>)}
                        </ul>
                      ) : (
                        <p className="mt-3 text-sm text-muted-foreground">No policy warnings. This writeback can follow the selected approval setting.</p>
                      )}
                      <details className="mt-3">
                        <summary className="cursor-pointer text-xs font-semibold text-muted-foreground hover:text-foreground">View preview JSON</summary>
                        <code className="block text-xs text-foreground whitespace-pre-wrap break-words mt-2">{JSON.stringify(writebackPreview, null, 2)}</code>
                      </details>
                    </div>
                  );
                })()
              ) : (
                <div className="rounded-xl border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
                  Preview shows whether the mapping allows this payload, which fields will change, and whether approval is required.
                </div>
              )}
            </div>
          </div>
          {writebacks.length === 0 ? (
            <div className={`${cardCls} text-center py-10`}>
              <ShieldCheck className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground">No external writebacks requested</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                Preview first, then request approval before CRMy writes back to a CRM or warehouse.
              </p>
            </div>
          ) : writebacks.map(writeback => (
            <div key={String(writeback.id)} className={cardCls}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{String(writeback.operation)} {String(writeback.object_type)} to {systems.find(s => s.id === writeback.system_id)?.name ?? String(writeback.system_id)}</p>
                  <p className="text-xs text-muted-foreground">{String(writeback.writeback_mode)} • {fmtDate(writeback.created_at)}{writeback.hitl_request_id ? ` • HITL ${String(writeback.hitl_request_id).slice(0, 8)}` : ''}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full border ${statusClass(String(writeback.status ?? ''))}`}>{String(writeback.status)}</span>
              </div>
              {(() => {
                const policyResult = asObject(writeback.policy_result);
                const preview = asObject(writeback.preview);
                const actionPolicy = actionPolicyFrom(policyResult);
                const decision = writebackDecisionLabel(policyResult, actionPolicy);
                const reasons = writebackReasonList(policyResult, actionPolicy);
                const fields = writebackFieldList(preview, writeback.payload);
                return (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 mt-3">
                    <div className="rounded-lg border border-border bg-muted/40 p-3">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Policy</p>
                      <span className={`inline-flex text-xs px-2 py-0.5 rounded-full border ${writebackDecisionClass(decision)}`}>
                        {decision}
                      </span>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {reasons[0] ?? 'Policy allows this request.'}
                      </p>
                      {reasons.length > 1 && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs font-semibold text-muted-foreground hover:text-foreground">View all reasons</summary>
                          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                            {reasons.map(reason => <li key={reason}>• {reason}</li>)}
                          </ul>
                        </details>
                      )}
                    </div>
                    <div className="rounded-lg border border-border bg-muted/40 p-3">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Preview</p>
                      <p className="text-sm text-foreground">
                        {fields.length > 0 ? `${fields.length} field${fields.length !== 1 ? 's' : ''} checked` : 'No field diff available'}
                      </p>
                      {fields.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {fields.slice(0, 6).map(field => (
                            <span key={field} className="rounded-md border border-border bg-background px-1.5 py-0.5 text-xs text-muted-foreground">{field}</span>
                          ))}
                          {fields.length > 6 && <span className="rounded-md border border-border bg-background px-1.5 py-0.5 text-xs text-muted-foreground">+{fields.length - 6}</span>}
                        </div>
                      )}
                    </div>
                    <div className="rounded-lg border border-border bg-muted/40 p-3">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Payload</p>
                      <p className="text-sm text-foreground">{Object.keys(asObject(writeback.payload)).length} field{Object.keys(asObject(writeback.payload)).length !== 1 ? 's' : ''}</p>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-semibold text-muted-foreground hover:text-foreground">View request JSON</summary>
                        <code className="block text-xs text-foreground whitespace-pre-wrap break-words mt-2">
                          {JSON.stringify({ policy_result: writeback.policy_result ?? {}, preview: writeback.preview ?? {}, payload: writeback.payload ?? {} }, null, 2)}
                        </code>
                      </details>
                    </div>
                  </div>
                );
              })()}
              {Boolean(writeback.execution_result && Object.keys(writeback.execution_result as Record<string, unknown>).length > 0) && (
                <div className="rounded-xl border border-border bg-muted/30 p-3 mt-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">Execution receipt</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {String(writebackReceipt(writeback).operation ?? writeback.operation)} • {String(writebackReceipt(writeback).external_object ?? writeback.external_object)}
                        {writebackReceipt(writeback).executed_at ? ` • ${fmtDate(writebackReceipt(writeback).executed_at)}` : ''}
                      </p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${writebackReceipt(writeback).ok === false ? statusClass('failed') : statusClass('completed')}`}>
                      {writebackReceipt(writeback).ok === false ? 'failed' : 'completed'}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3">
                    <div className="rounded-lg bg-background/80 p-2">
                      <p className="text-xs text-muted-foreground">External ID</p>
                      <p className="text-sm font-mono text-foreground truncate">{String(writebackReceipt(writeback).external_record_id ?? writeback.external_record_id ?? '—')}</p>
                    </div>
                    <div className="rounded-lg bg-background/80 p-2">
                      <p className="text-xs text-muted-foreground">Sync run</p>
                      <p className="text-sm font-mono text-foreground truncate">{String(writebackReceipt(writeback).sync_run_id ?? '—')}</p>
                    </div>
                    <div className="rounded-lg bg-background/80 p-2">
                      <p className="text-xs text-muted-foreground">Reference</p>
                      <p className="text-sm text-foreground truncate">
                        {writebackReference(writeback).updated === false
                          ? String(writebackReference(writeback).warning ?? 'Not updated')
                          : String(writebackReference(writeback).action ?? 'updated')}
                      </p>
                    </div>
                  </div>
                  {Boolean(writebackReceipt(writeback).error) && (
                    <p className="mt-3 rounded-lg border border-destructive/25 bg-destructive/5 p-2 text-xs text-destructive">
                      {String(writebackReceipt(writeback).error)}
                    </p>
                  )}
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs font-semibold text-muted-foreground hover:text-foreground">View receipt JSON</summary>
                    <code className="block text-xs text-foreground whitespace-pre-wrap break-words mt-2">{JSON.stringify(writeback.execution_result, null, 2)}</code>
                  </details>
                </div>
              )}
              <div className="flex flex-wrap justify-end gap-2 mt-3">
                {writeback.status === 'approval_required' && (
                  <>
                    <button onClick={() => handleReviewWriteback(String(writeback.id), 'approved')} disabled={reviewWriteback.isPending} className="h-8 px-3 rounded-lg border border-border text-xs font-semibold hover:bg-muted disabled:opacity-50">Approve</button>
                    <button onClick={() => handleReviewWriteback(String(writeback.id), 'rejected')} disabled={reviewWriteback.isPending} className="h-8 px-3 rounded-lg border border-destructive/30 text-xs font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50">Reject</button>
                  </>
                )}
                {(writeback.status === 'approved' || writeback.status === 'pending') && (
                  <button
                    onClick={() => executeWriteback.mutate(String(writeback.id), {
                      onSuccess: () => toast({ title: 'Writeback executed', description: 'The external system accepted the governed write.' }),
                      onError: err => toast({ title: 'Writeback failed', description: err instanceof Error ? err.message : 'Review the request and try again.', variant: 'destructive' }),
                    })}
                    className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90"
                  >
                    Execute
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-4 flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-foreground">Governed by default</p>
          <p className="text-sm text-muted-foreground mt-0.5">Secrets are encrypted, external writes require configured mappings, and sync changes emit normal CRMy events for Automations, Sequences, HITL, audit, and context extraction.</p>
        </div>
      </div>
    </div>
  );
}

type DbProviderId = 'local' | 'neon' | 'lakebase' | 'supabase' | 'rds' | 'other';

const DB_PROVIDER_GUIDES: Record<DbProviderId, {
  label: string;
  fit: string;
  placeholder: string;
  steps: string[];
  pgvector: string;
}> = {
  local: {
    label: 'Local Postgres',
    fit: 'Best for local development, demos, and offline agent workflows.',
    placeholder: 'postgresql://postgres:postgres@localhost:5432/crmy',
    steps: [
      'Run a Postgres 16 image with pgvector, or use your local Postgres install.',
      'Create a database named crmy if init did not already create it.',
      'Use sslmode=disable for local Docker or local Postgres.',
    ],
    pgvector: 'Use the pgvector/pgvector Docker image, then enable the extension with CREATE EXTENSION IF NOT EXISTS vector.',
  },
  neon: {
    label: 'Neon',
    fit: 'Good default for serverless Postgres and branch-per-environment workflows.',
    placeholder: 'postgresql://user:password@ep-example.us-east-2.aws.neon.tech/neondb?sslmode=require',
    steps: [
      'Copy the pooled or direct connection string from Neon Project Settings.',
      'Keep sslmode=require in the URL.',
      'Use a project role with permission to create extensions during init/migrations.',
    ],
    pgvector: 'Neon supports pgvector. Run CREATE EXTENSION IF NOT EXISTS vector in the target database before semantic search.',
  },
  lakebase: {
    label: 'Lakebase',
    fit: 'Best when your customer context layer should live near Databricks data.',
    placeholder: 'postgresql://user:password@instance.database.cloud.databricks.com:5432/crmy?sslmode=require',
    steps: [
      'Create a Postgres database instance and copy its connection string.',
      'Use sslmode=require unless your workspace networking policy says otherwise.',
      'Confirm the CRMy server can reach the Lakebase endpoint from its network.',
    ],
    pgvector: 'If pgvector is available in the instance, enable vector before using semantic search. Otherwise CRMy falls back to keyword search.',
  },
  supabase: {
    label: 'Supabase',
    fit: 'Good for hosted Postgres with dashboard SQL tools and simple extension management.',
    placeholder: 'postgresql://postgres:password@db.project-ref.supabase.co:5432/postgres?sslmode=require',
    steps: [
      'Copy the direct Postgres connection string from Project Settings > Database.',
      'Use the database password, not the anon or service API key.',
      'Keep sslmode=require for hosted Supabase.',
    ],
    pgvector: 'Enable the vector extension in Database > Extensions or run CREATE EXTENSION IF NOT EXISTS vector.',
  },
  rds: {
    label: 'Amazon RDS',
    fit: 'Best for managed enterprise AWS deployments and private-network installs.',
    placeholder: 'postgresql://user:password@mydb.abc123.us-east-1.rds.amazonaws.com:5432/crmy?sslmode=require',
    steps: [
      'Use an RDS for PostgreSQL version that supports the vector extension.',
      'Open network access from the CRMy server security group to RDS port 5432.',
      'Use sslmode=require when enforcing encrypted connections.',
    ],
    pgvector: 'Install/enable pgvector with CREATE EXTENSION IF NOT EXISTS vector after confirming your RDS engine version supports it.',
  },
  other: {
    label: 'Other',
    fit: 'Use this for any PostgreSQL-compatible host CRMy can reach.',
    placeholder: 'postgresql://user:password@postgres.example.com:5432/crmy?sslmode=require',
    steps: [
      'Copy the direct PostgreSQL connection string from your database provider.',
      'Confirm the CRMy server can reach the database host and port.',
      'Use sslmode=require for hosted databases unless your provider recommends a different SSL mode.',
    ],
    pgvector: 'If your provider supports pgvector, enable the vector extension and run migrations with ENABLE_PGVECTOR=true. Otherwise CRMy uses keyword search.',
  },
};

function detectDbProvider(host?: string): DbProviderId {
  const h = (host ?? '').toLowerCase();
  if (!h || h === 'localhost' || h === '127.0.0.1' || h === '::1') return 'local';
  if (h.includes('neon.tech')) return 'neon';
  if (h.includes('supabase.co')) return 'supabase';
  if (h.includes('rds.amazonaws.com')) return 'rds';
  if (h.includes('databricks') || h.includes('lakebase')) return 'lakebase';
  return 'other';
}

function DatabaseSettings() {
  const { data, isLoading } = useDbConfig();
  const testConfig = useTestDbConfig();
  const saveConfig = useSaveDbConfig();
  const seedSample = useSeedSampleData();
  const [editing, setEditing] = useState(false);
  const [connStr, setConnStr] = useState('');
  const [provider, setProvider] = useState<DbProviderId>('local');
  const [testResult, setTestResult] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [testError, setTestError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');
  const [showSeedConfirm, setShowSeedConfirm] = useState(false);

  const dbInfo = data as {
    host: string;
    port: string;
    database: string;
    user: string;
    ssl: string | null;
    pgvector_enabled?: boolean;
    pgvector_column_ready?: boolean;
    pgvector_env_enabled?: boolean;
    embedding_configured?: boolean;
    embedding_provider?: string | null;
    embedding_model?: string | null;
    ready?: boolean;
    sample_data?: {
      seeded: boolean;
      counts: {
        accounts: number;
        contacts: number;
        opportunities: number;
        context_entries: number;
        signals?: number;
        memory?: number;
        raw_context_sources?: number;
        handoffs?: number;
      };
    };
  } | undefined;
  const currentProvider = detectDbProvider(dbInfo?.host);
  const selectedGuide = DB_PROVIDER_GUIDES[provider];
  const sampleCounts = dbInfo?.sample_data?.counts;
  const hasWorkspaceData = !!sampleCounts && Object.values(sampleCounts).some(count => count > 0);
  const semanticReady = Boolean(dbInfo?.ready);

  useEffect(() => {
    setProvider(currentProvider);
  }, [currentProvider]);

  const handleTest = async () => {
    setTestResult('testing');
    setTestError('');
    setSaveSuccess('');
    try {
      await testConfig.mutateAsync(connStr);
      setTestResult('ok');
    } catch (err) {
      setTestResult('fail');
      setTestError(err instanceof Error ? err.message : 'Connection failed');
    }
  };

  const handleSave = async () => {
    try {
      const result = await saveConfig.mutateAsync(connStr) as { message: string };
      setSaveSuccess(result.message);
      setEditing(false);
      setConnStr('');
      setTestResult('idle');
      toast({ title: 'Database config saved', description: result.message });
    } catch (err) {
      toast({
        title: 'Could not save database config',
        description: err instanceof Error ? err.message : 'Test the connection again, then retry the save.',
        variant: 'destructive',
      });
    }
  };

  const handleSeedSample = async () => {
    try {
      const result = await seedSample.mutateAsync(true);
      setShowSeedConfirm(false);
      toast({ title: 'Sample data added', description: result.message });
    } catch (err) {
      toast({ title: 'Failed to add sample data', description: err instanceof Error ? err.message : 'Please try again.', variant: 'destructive' });
    }
  };

  const copyCommand = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copied' });
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display font-bold text-lg text-foreground">Database Connection</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Connect CRMy to the Postgres database that stores operational state for agents. Changes are saved to <code className="text-xs font-mono bg-muted px-1 py-0.5 rounded">.env.db</code> and take effect after a server restart.
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {!editing ? (
          <button onClick={() => { setEditing(true); setSaveSuccess(''); setTestResult('idle'); }}
            className="h-9 px-4 flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-primary to-primary/80 text-primary-foreground text-sm font-semibold hover:shadow-md transition-all flex-shrink-0 press-scale">
            <Database className="w-4 h-4" /> Edit Connection
          </button>
        ) : (
          <span className="h-9 px-3 inline-flex items-center rounded-xl border border-border bg-card text-sm text-muted-foreground">
            Editing connection
          </span>
        )}
        <span className={`h-9 inline-flex items-center px-3 rounded-xl border text-sm font-medium ${semanticReady ? 'border-success/30 bg-success/5 text-success' : 'border-amber-500/30 bg-amber-500/10 text-amber-700'}`}>
          Semantic retrieval {semanticReady ? 'ready' : 'needs setup'}
        </span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5">
        <div className="space-y-4">
        {isLoading ? (
          <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-muted/50 rounded-xl animate-pulse" />)}</div>
        ) : (
          <div className="p-5 rounded-xl border border-border bg-card space-y-4 shadow-sm">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Current connection</h3>
                <p className="text-sm text-muted-foreground mt-0.5">Detected provider: {DB_PROVIDER_GUIDES[currentProvider].label}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { label: 'Host', value: dbInfo?.host || '—' },
                { label: 'Port', value: dbInfo?.port || '—' },
                { label: 'Database', value: dbInfo?.database || '—' },
                { label: 'User', value: dbInfo?.user || '—' },
                { label: 'SSL', value: dbInfo?.ssl || 'default' },
              ].map((row) => (
                <div key={row.label} className="rounded-lg border border-border bg-background px-3 py-2 min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">{row.label}</p>
                  <code className="block text-sm font-mono text-foreground truncate mt-0.5">{row.value}</code>
                </div>
              ))}
            </div>
            <div className="pt-3 mt-3 border-t border-border text-xs text-muted-foreground">
              Semantic retrieval helps CRMy find related Memory and Signals even when wording differs. Keyword search still works when semantic retrieval is not ready.
            </div>
          </div>
        )}

        <div className="rounded-xl border border-border bg-card p-5 space-y-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Semantic retrieval setup</h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                Enable this when you want natural-language search and stronger related-context matching.
              </p>
            </div>
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${semanticReady ? 'border-success/30 bg-success/5 text-success' : 'border-warning/30 bg-warning/10 text-warning'}`}>
              {semanticReady ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
              {semanticReady ? 'Ready' : 'Setup needed'}
            </span>
          </div>

          <div className="grid gap-2 text-sm md:grid-cols-3">
            <div className={`rounded-lg border px-3 py-2 ${dbInfo?.pgvector_env_enabled ? 'border-success/25 bg-success/5' : 'border-border bg-background'}`}>
              <p className="font-medium text-foreground">1. Opt in</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Set <code className="rounded bg-muted px-1 py-0.5 font-mono">ENABLE_PGVECTOR=true</code> in the CRMy server environment.
              </p>
            </div>
            <div className={`rounded-lg border px-3 py-2 ${dbInfo?.pgvector_enabled && dbInfo?.pgvector_column_ready ? 'border-success/25 bg-success/5' : 'border-border bg-background'}`}>
              <p className="font-medium text-foreground">2. Run migration</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Enable the vector extension, then run migrations so CRMy adds embedding columns and indexes.
              </p>
            </div>
            <div className={`rounded-lg border px-3 py-2 ${dbInfo?.embedding_configured ? 'border-success/25 bg-success/5' : 'border-border bg-background'}`}>
              <p className="font-medium text-foreground">3. Add embeddings</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Configure <code className="rounded bg-muted px-1 py-0.5 font-mono">EMBEDDING_PROVIDER</code> and related embedding variables before restarting.
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-background p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Server environment</p>
            <pre className="mt-2 overflow-x-auto rounded-md bg-muted/50 p-3 text-xs text-foreground"><code>{`ENABLE_PGVECTOR=true
EMBEDDING_PROVIDER=openai
EMBEDDING_API_KEY=sk-...
EMBEDDING_MODEL=text-embedding-3-small`}</code></pre>
            <p className="mt-2 text-xs text-muted-foreground">
              Model Settings controls the Workspace Agent. Embedding settings live in the server environment because CRMy uses them for background indexing and semantic retrieval.
              {dbInfo?.embedding_configured && dbInfo.embedding_provider ? ` Current embedding provider: ${dbInfo.embedding_provider}${dbInfo.embedding_model ? ` · ${dbInfo.embedding_model}` : ''}.` : ''}
            </p>
          </div>

          <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            After changing these settings, restart the CRMy server and run migrations. Existing Memory can be embedded with the admin MCP tool <code className="rounded bg-muted px-1 py-0.5 font-mono">context_embed_backfill</code>.
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 space-y-4 shadow-sm">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Sample data</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Load the same demo records used by <code className="text-xs font-mono bg-muted px-1 py-0.5 rounded">crmy seed-demo</code>: one customer thread that shows Raw Context becoming Signals, Memory, and a pending Handoff.
            </p>
          </div>
          {sampleCounts && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              {[
                ['Raw Context', sampleCounts.raw_context_sources ?? 0],
                ['Signals', sampleCounts.signals ?? 0],
                ['Memory', sampleCounts.memory ?? sampleCounts.context_entries],
                ['Handoffs', sampleCounts.handoffs ?? 0],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-border bg-background px-2 py-1.5">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="float-right font-mono text-foreground">{value}</span>
                </div>
              ))}
            </div>
          )}
          {!showSeedConfirm ? (
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => setShowSeedConfirm(true)}
                className="h-9 px-4 rounded-lg border border-border text-sm font-semibold text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">
                Add sample data
              </button>
              <button onClick={() => copyCommand('crmy seed-demo')} className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                <Copy className="w-3.5 h-3.5" /> Copy CLI command
              </button>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 space-y-3">
              <div className="flex gap-2 text-xs text-amber-700">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>{hasWorkspaceData ? 'This workspace already has records. Sample data is idempotent: CRMy refreshes demo records and leaves your other records alone.' : 'This will add demo records to the current tenant.'}</span>
              </div>
              <div className="flex gap-2">
                <button onClick={handleSeedSample} disabled={seedSample.isPending}
                  className="flex-1 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-40">
                  {seedSample.isPending ? 'Adding...' : 'Confirm'}
                </button>
                <button onClick={() => setShowSeedConfirm(false)} className="flex-1 px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {saveSuccess && (
          <div className="flex items-start gap-2 p-3 rounded-xl border border-success/30 bg-success/5 text-sm text-success">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{saveSuccess}</span>
          </div>
        )}

        {editing && (
          <div className="space-y-4 p-5 rounded-xl border border-border bg-card shadow-sm">
            <div>
              <h3 className="text-sm font-semibold text-foreground">New connection string</h3>
              <p className="text-sm text-muted-foreground mt-0.5">Paste a Postgres URL, test it, then save when the connection succeeds.</p>
            </div>
            <input
              value={connStr}
              onChange={(e) => { setConnStr(e.target.value); setTestResult('idle'); setTestError(''); }}
              placeholder="postgresql://user:password@host:5432/dbname"
              className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground font-mono outline-none focus:ring-1 focus:ring-ring"
            />

            {testResult === 'ok' && (
              <div className="flex items-center gap-1.5 text-xs text-success">
                <CheckCircle2 className="w-3.5 h-3.5" /> Connection successful
              </div>
            )}
            {testResult === 'fail' && (
              <div className="flex items-start gap-1.5 text-xs text-destructive">
                <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {testError}
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={handleTest}
                disabled={!connStr.trim() || testConfig.isPending}
                className="px-4 py-2 rounded-lg border border-border text-sm font-semibold text-muted-foreground hover:text-foreground hover:border-foreground/30 disabled:opacity-40 transition-colors">
                {testConfig.isPending ? 'Testing...' : 'Test Connection'}
              </button>
              <button onClick={handleSave}
                disabled={!connStr.trim() || testResult !== 'ok' || saveConfig.isPending}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors">
                {saveConfig.isPending ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => { setEditing(false); setConnStr(''); setTestResult('idle'); setTestError(''); }}
                className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors">
                Cancel
              </button>
            </div>
            <p className="text-xs text-muted-foreground">Test the connection before saving. Save is only enabled after a successful test.</p>
          </div>
        )}
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-5 space-y-4 shadow-sm">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Provider setup</h3>
              <p className="text-sm text-muted-foreground mt-0.5">Choose your database host to see the right setup notes.</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(DB_PROVIDER_GUIDES) as DbProviderId[]).map(id => (
                <button
                  key={id}
                  onClick={() => setProvider(id)}
                  className={`h-9 px-3 rounded-lg border text-sm text-left transition-colors ${provider === id ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40'}`}
                >
                  {DB_PROVIDER_GUIDES[id].label}
                </button>
              ))}
            </div>
            <div className="space-y-2 pt-1">
              <p className="text-sm font-semibold text-foreground">{selectedGuide.fit}</p>
              <code className="block rounded-lg border border-border bg-background p-2 text-xs font-mono text-foreground overflow-x-auto whitespace-nowrap">{selectedGuide.placeholder}</code>
              <button onClick={() => { setConnStr(selectedGuide.placeholder); setEditing(true); setTestResult('idle'); }}
                className="h-8 px-3 inline-flex items-center rounded-lg border border-border text-sm font-medium text-primary hover:bg-primary/5 transition-colors">
                Use as template
              </button>
              <ul className="space-y-1.5">
                {selectedGuide.steps.map(step => (
                  <li key={step} className="flex gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="w-3.5 h-3.5 text-success mt-0.5 shrink-0" />
                    <span>{step}</span>
                  </li>
                ))}
              </ul>
              <div className="rounded-lg border border-blue-500/20 bg-blue-500/8 p-3 text-xs text-blue-700 dark:text-blue-400">
                {selectedGuide.pgvector}
              </div>
            </div>
          </div>

        </aside>
      </div>
    </div>
  );
}

// System-default types that are always available (seeded on tenant creation).
// These cannot be removed — they are the foundation of the context engine and activity tracking.
const SYSTEM_CONTEXT_TYPES = [
  { type_name: 'note', label: 'Note' },
  { type_name: 'transcript', label: 'Transcript' },
  { type_name: 'summary', label: 'Summary' },
  { type_name: 'research', label: 'Research' },
  { type_name: 'preference', label: 'Preference' },
  { type_name: 'decision', label: 'Decision' },
  { type_name: 'relationship_map', label: 'Relationship Map' },
  { type_name: 'agent_reasoning', label: 'Agent Reasoning' },
  { type_name: 'sentiment_analysis', label: 'Sentiment Analysis' },
  { type_name: 'commitment', label: 'Commitment' },
  { type_name: 'next_step', label: 'Next Step' },
  { type_name: 'stakeholder', label: 'Stakeholder' },
  { type_name: 'deal_risk', label: 'Deal Risk' },
  { type_name: 'competitive_intel', label: 'Competitive Intel' },
  { type_name: 'objection', label: 'Objection' },
  { type_name: 'meeting_notes', label: 'Meeting Notes' },
  { type_name: 'key_fact', label: 'Key Fact' },
];

const SYSTEM_ACTIVITY_TYPES = [
  { type_name: 'outreach_email', label: 'Email Sent', category: 'outreach' },
  { type_name: 'outreach_call', label: 'Call Made', category: 'outreach' },
  { type_name: 'outreach_sms', label: 'SMS Sent', category: 'outreach' },
  { type_name: 'outreach_social', label: 'Social Touch', category: 'outreach' },
  { type_name: 'meeting_scheduled', label: 'Meeting Scheduled', category: 'meeting' },
  { type_name: 'meeting_held', label: 'Meeting Held', category: 'meeting' },
  { type_name: 'meeting_cancelled', label: 'Meeting Cancelled', category: 'meeting' },
  { type_name: 'proposal_drafted', label: 'Proposal Drafted', category: 'proposal' },
  { type_name: 'proposal_sent', label: 'Proposal Sent', category: 'proposal' },
  { type_name: 'proposal_viewed', label: 'Proposal Viewed', category: 'proposal' },
  { type_name: 'contract_sent', label: 'Contract Sent', category: 'contract' },
  { type_name: 'contract_signed', label: 'Contract Signed', category: 'contract' },
  { type_name: 'note_added', label: 'Note Added', category: 'internal' },
  { type_name: 'research_completed', label: 'Research Completed', category: 'internal' },
  { type_name: 'stage_change', label: 'Stage Changed', category: 'lifecycle' },
  { type_name: 'field_update', label: 'Field Updated', category: 'lifecycle' },
  { type_name: 'task_completed', label: 'Task Completed', category: 'internal' },
  { type_name: 'handoff_initiated', label: 'Handoff Initiated', category: 'handoff' },
  { type_name: 'handoff_accepted', label: 'Handoff Accepted', category: 'handoff' },
];

function RegistriesSettings() {
  const { data: ctxData, isLoading: ctxLoading } = useContextTypes();
  const createCtxType = useCreateContextType();
  const deleteCtxType = useDeleteContextType();
  const { data: actData, isLoading: actLoading } = useActivityTypes();
  const createActType = useCreateActivityType();
  const deleteActType = useDeleteActivityType();
  const { data: meetingData, isLoading: meetingLoading } = useMeetingClassifications({ include_disabled: true });
  const createMeetingClassification = useCreateMeetingClassification();
  const updateMeetingClassification = useUpdateMeetingClassification();
  const deleteMeetingClassification = useDeleteMeetingClassification();

  const [ctxName, setCtxName] = useState('');
  const [ctxLabel, setCtxLabel] = useState('');
  const [ctxDesc, setCtxDesc] = useState('');
  const [actName, setActName] = useState('');
  const [actLabel, setActLabel] = useState('');
  const [actCategory, setActCategory] = useState('');
  const [actDesc, setActDesc] = useState('');
  const [meetingName, setMeetingName] = useState('');
  const [meetingLabel, setMeetingLabel] = useState('');
  const [meetingDesc, setMeetingDesc] = useState('');
  const [meetingHints, setMeetingHints] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const contextTypes = (ctxData as any)?.data ?? [];
  const activityTypes = (actData as any)?.data ?? [];
  const meetingClassifications = (meetingData as any)?.data ?? [];

  const handleCreateCtx = async () => {
    if (!ctxName.trim() || !ctxLabel.trim()) return;
    try {
      await createCtxType.mutateAsync({ type_name: ctxName.trim(), label: ctxLabel.trim(), description: ctxDesc.trim() || undefined });
      setCtxName(''); setCtxLabel(''); setCtxDesc('');
      toast({ title: 'Context type added' });
    } catch { toast({ title: 'Error', variant: 'destructive' }); }
  };

  const handleCreateAct = async () => {
    if (!actName.trim() || !actLabel.trim() || !actCategory.trim()) return;
    try {
      await createActType.mutateAsync({ type_name: actName.trim(), label: actLabel.trim(), category: actCategory.trim(), description: actDesc.trim() || undefined });
      setActName(''); setActLabel(''); setActCategory(''); setActDesc('');
      toast({ title: 'Activity type added' });
    } catch { toast({ title: 'Error', variant: 'destructive' }); }
  };

  const handleCreateMeetingClassification = async () => {
    if (!meetingName.trim() || !meetingLabel.trim()) return;
    try {
      await createMeetingClassification.mutateAsync({
        type_name: meetingName.trim(),
        label: meetingLabel.trim(),
        description: meetingDesc.trim() || undefined,
        matching_hints: meetingHints.split(',').map(h => h.trim()).filter(Boolean),
        mapped_activity_type: 'meeting_held',
        required_record_types: ['account'],
        required_artifact_types: ['notes'],
        is_customer_facing: true,
        auto_process_raw_context: true,
        is_enabled: true,
      });
      setMeetingName(''); setMeetingLabel(''); setMeetingDesc(''); setMeetingHints('');
      toast({ title: 'Meeting classification added' });
    } catch (err) {
      toast({ title: 'Could not add classification', description: err instanceof Error ? err.message : 'Try again.', variant: 'destructive' });
    }
  };

  const inputCls = 'h-8 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';

  return (
    <div className="max-w-2xl">
      <h2 className="font-display font-bold text-lg text-foreground mb-1">Type Registries</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Context types classify the Memory your agents store — objections, next steps, competitive intel, and more.
        Activity types categorize what happened — calls, emails, meetings, handoffs. Both registries come with system
        defaults and can be extended with custom types to match your workflow.
      </p>

      {/* Context Types */}
      <div className="mb-8">
        <h3 className="text-sm font-semibold text-foreground mb-2">Context Types</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Each context entry is tagged with a type. Types control how context is prioritized in briefings,
          how confidence decays over time, and which entries the extraction pipeline produces automatically.
        </p>

        {/* System types */}
        <div className="mb-3">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">System</span>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {SYSTEM_CONTEXT_TYPES.map(t => (
              <span key={t.type_name} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                {t.label}
              </span>
            ))}
          </div>
        </div>

        {/* Custom types */}
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Custom</span>
        <div className="space-y-1.5 mb-3 mt-1.5">
          {ctxLoading ? (
            <div className="h-8 bg-muted/50 rounded animate-pulse" />
          ) : contextTypes.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No custom context types added yet.</p>
          ) : contextTypes.map((t: any) => (
            <div key={t.type_name} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card">
              <span className="text-sm font-medium text-foreground flex-1">{t.label || t.type_name}</span>
              <span className="text-xs font-mono text-muted-foreground">{t.type_name}</span>
              {t.description && <span className="text-xs text-muted-foreground hidden sm:inline truncate max-w-[200px]">{t.description}</span>}
              <button
                onClick={() => {
                  if (confirmDelete === t.type_name) {
                    deleteCtxType.mutate(t.type_name, { onSuccess: () => { toast({ title: 'Removed' }); setConfirmDelete(null); } });
                  } else {
                    setConfirmDelete(t.type_name);
                    setTimeout(() => setConfirmDelete(null), 3000);
                  }
                }}
                className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input value={ctxName} onChange={e => setCtxName(e.target.value)} placeholder="type_name (slug)" className={`${inputCls} w-36`} />
          <input value={ctxLabel} onChange={e => setCtxLabel(e.target.value)} placeholder="Label" className={`${inputCls} w-32`} />
          <input value={ctxDesc} onChange={e => setCtxDesc(e.target.value)} placeholder="Description (optional)" className={`${inputCls} flex-1 min-w-[120px]`} />
          <button onClick={handleCreateCtx} disabled={!ctxName.trim() || !ctxLabel.trim() || createCtxType.isPending}
            className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors">
            <Plus className="w-3 h-3 inline mr-1" />Add
          </button>
        </div>
      </div>

      {/* Activity Types */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-2">Activity Types</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Activities represent things that happened — calls made, emails sent, meetings held.
          Each type belongs to a category (outreach, meeting, proposal, contract, internal, lifecycle, handoff)
          which drives filtering, timeline grouping, and reporting.
        </p>

        {/* System types grouped by category */}
        <div className="mb-3">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">System</span>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {SYSTEM_ACTIVITY_TYPES.map(t => (
              <span key={t.type_name} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                {t.label}
                <span className="text-xs opacity-60">{t.category}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Custom types */}
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Custom</span>
        <div className="space-y-1.5 mb-3 mt-1.5">
          {actLoading ? (
            <div className="h-8 bg-muted/50 rounded animate-pulse" />
          ) : activityTypes.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No custom activity types added yet.</p>
          ) : activityTypes.map((t: any) => (
            <div key={t.type_name} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card">
              <span className="text-sm font-medium text-foreground flex-1">{t.label || t.type_name}</span>
              <span className="text-xs font-mono text-muted-foreground">{t.type_name}</span>
              {t.category && <span className="px-1.5 py-0.5 rounded text-xs bg-muted text-muted-foreground">{t.category}</span>}
              <button
                onClick={() => {
                  if (confirmDelete === t.type_name) {
                    deleteActType.mutate(t.type_name, { onSuccess: () => { toast({ title: 'Removed' }); setConfirmDelete(null); } });
                  } else {
                    setConfirmDelete(t.type_name);
                    setTimeout(() => setConfirmDelete(null), 3000);
                  }
                }}
                className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input value={actName} onChange={e => setActName(e.target.value)} placeholder="type_name (slug)" className={`${inputCls} w-36`} />
          <input value={actLabel} onChange={e => setActLabel(e.target.value)} placeholder="Label" className={`${inputCls} w-32`} />
          <input value={actCategory} onChange={e => setActCategory(e.target.value)} placeholder="Category" className={`${inputCls} w-28`} />
          <input value={actDesc} onChange={e => setActDesc(e.target.value)} placeholder="Description (optional)" className={`${inputCls} flex-1 min-w-[120px]`} />
          <button onClick={handleCreateAct} disabled={!actName.trim() || !actLabel.trim() || !actCategory.trim() || createActType.isPending}
            className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors">
            <Plus className="w-3 h-3 inline mr-1" />Add
          </button>
        </div>
      </div>

      {/* Meeting Classifications */}
      <div className="mt-8">
        <h3 className="text-sm font-semibold text-foreground mb-2">Meeting Classifications</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Meeting classifications tell CRMy how to interpret calendar events, what customer records are required,
          and whether notes or transcripts are needed before Raw Context can become Signals.
        </p>
        <div className="space-y-2 mb-3">
          {meetingLoading ? (
            <div className="h-10 bg-muted/50 rounded animate-pulse" />
          ) : meetingClassifications.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No meeting classifications configured yet.</p>
          ) : meetingClassifications.map((classification: any) => (
            <div key={classification.type_name} className="rounded-lg border border-border bg-card px-3 py-2">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{classification.label}</span>
                    <span className="text-xs font-mono text-muted-foreground">{classification.type_name}</span>
                    {classification.is_default && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">Default</span>}
                    {!classification.is_enabled && <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-destructive">Disabled</span>}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Requires {(classification.required_record_types ?? []).join(', ') || 'no specific record'}
                    {(classification.required_artifact_types ?? []).length ? ` · Context: ${(classification.required_artifact_types ?? []).join(', ')}` : ''}
                    {classification.auto_process_raw_context ? ' · Auto-processes Raw Context' : ' · Manual processing'}
                  </p>
                </div>
                <button
                  onClick={() => updateMeetingClassification.mutate({
                    type_name: classification.type_name,
                    is_enabled: !classification.is_enabled,
                  }, { onSuccess: () => toast({ title: classification.is_enabled ? 'Classification disabled' : 'Classification enabled' }) })}
                  className="px-2 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  {classification.is_enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  onClick={() => {
                    if (classification.is_default) {
                      toast({ title: 'Default classifications cannot be deleted', description: 'Disable it instead if you do not want CRMy to use it.', variant: 'destructive' });
                      return;
                    }
                    if (confirmDelete === classification.type_name) {
                      deleteMeetingClassification.mutate(classification.type_name, { onSuccess: () => { toast({ title: 'Removed' }); setConfirmDelete(null); } });
                    } else {
                      setConfirmDelete(classification.type_name);
                      setTimeout(() => setConfirmDelete(null), 3000);
                    }
                  }}
                  className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input value={meetingName} onChange={e => setMeetingName(e.target.value)} placeholder="type_name (slug)" className={`${inputCls} w-36`} />
          <input value={meetingLabel} onChange={e => setMeetingLabel(e.target.value)} placeholder="Label" className={`${inputCls} w-32`} />
          <input value={meetingHints} onChange={e => setMeetingHints(e.target.value)} placeholder="Hints, comma-separated" className={`${inputCls} flex-1 min-w-[150px]`} />
          <input value={meetingDesc} onChange={e => setMeetingDesc(e.target.value)} placeholder="Description (optional)" className={`${inputCls} flex-1 min-w-[150px]`} />
          <button
            onClick={handleCreateMeetingClassification}
            disabled={!meetingName.trim() || !meetingLabel.trim() || createMeetingClassification.isPending}
            className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors"
          >
            <Plus className="w-3 h-3 inline mr-1" />Add
          </button>
        </div>
      </div>
    </div>
  );
}

function AutomationsSettings() {
  const cards = [
    {
      title: 'Action Rules',
      description: 'Configure event-driven rules for context, handoffs, and governed actions. Use this when CRMy needs to route work after something changes.',
      Icon: Zap,
      href: '/automations?tab=triggers',
      cta: 'Open action rules',
    },
    {
      title: 'Sequences',
      description: 'Experimental governed outbound orchestration. Keep customer engagement flows policy-aware and human-reviewable.',
      Icon: ListOrdered,
      href: '/automations?tab=sequences',
      cta: 'Open sequences',
    },
    {
      title: 'Webhooks',
      description: 'Advanced event delivery for operators and developers integrating CRMy with external systems.',
      Icon: Link2,
      href: '/settings/webhooks',
      cta: 'Open webhooks',
    },
  ];

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h2 className="font-display text-lg font-bold text-foreground">Automations</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Admin-only automation tools for routing events, governing outbound orchestration, and delivering webhooks.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {cards.map(({ title, description, Icon, href, cta }) => (
          <section key={title} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h3 className="font-display text-sm font-semibold text-foreground">{title}</h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
              </div>
            </div>
            <Link to={href} className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted">
              {cta}
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </section>
        ))}
      </div>
    </div>
  );
}

export default function Settings() {
  const location = useLocation();
  const user = getUser();
  const userRole = (user?.role ?? 'member') as NavRole;
  const visibleNav = settingsNavConfig.filter(item => item.roles.includes(userRole));
  const groupedNav = settingsGroupOrder
    .map(group => ({
      group,
      items: visibleNav.filter(item => item.group === group),
    }))
    .filter(section => section.items.length > 0);

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Settings"
        icon={SettingsIcon}
        iconClassName="text-muted-foreground"
        description="Manage personal access, agent setup, sources, systems, and governance."
      />

      <div className="md:hidden flex gap-1 overflow-x-auto no-scrollbar px-4 pt-3 pb-1 border-b border-border">
        {visibleNav.map((item) => {
          const active = item.path === '/settings' ? location.pathname === '/settings' : location.pathname.startsWith(item.path);
          return (
            <Link key={item.path} to={item.path}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>
              <item.icon className="w-3.5 h-3.5" />
              {item.label}
              <SettingsNavHealthDot path={item.path} />
            </Link>
          );
        })}
      </div>

      <div className="flex-1 flex overflow-hidden">
        <nav className="hidden md:flex flex-col w-60 border-r border-border bg-muted p-2 gap-3 overflow-y-auto">
          {groupedNav.map((section) => (
            <div key={section.group} className="space-y-0.5">
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                {section.group}
              </p>
              {section.items.map((item) => {
                const active = item.path === '/settings' ? location.pathname === '/settings' : location.pathname.startsWith(item.path);
                return (
                  <Link key={item.path} to={item.path}
                    className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${active ? 'bg-primary/15 text-primary' : 'text-foreground/60 hover:bg-muted hover:text-foreground'}`}>
                    <item.icon className="w-4 h-4" />
                    {item.label}
                    <SettingsNavHealthDot path={item.path} className="ml-auto" />
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="flex-1 overflow-y-auto p-6 pb-20 md:pb-6">
          <Routes>
            <Route index element={<ProfileSettings />} />
            <Route path="appearance" element={<Navigate to="/settings" replace />} />
            <Route path="api-keys" element={<ApiKeysSettings />} />
            <Route path="webhooks" element={<RequireRole roles={['admin', 'owner']}><WebhooksSettings /></RequireRole>} />
            <Route path="custom-fields" element={<RequireRole roles={['admin', 'owner']}><CustomFieldsSettings /></RequireRole>} />
            <Route path="registries" element={<RequireRole roles={['admin', 'owner']}><RegistriesSettings /></RequireRole>} />
            <Route path="actors" element={<RequireRole roles={['admin', 'owner']}><ActorsSettings /></RequireRole>} />
            <Route path="messaging" element={<RequireRole roles={['admin', 'owner']}><MessagingSettings /></RequireRole>} />
            <Route path="hitl-rules" element={<RequireRole roles={['admin', 'owner']}><HITLRulesSettings /></RequireRole>} />
            <Route path="model" element={<RequireRole roles={['admin', 'owner']}><AgentSettings /></RequireRole>} />
            <Route path="automations" element={<Navigate to="/settings/advanced" replace />} />
            <Route path="systems" element={<RequireRole roles={['admin', 'owner']}><SystemsOfRecordSettings /></RequireRole>} />
            <Route path="systems/oauth/hubspot/callback" element={<RequireRole roles={['admin', 'owner']}><SystemsOfRecordSettings /></RequireRole>} />
            <Route path="database" element={<RequireRole roles={['admin', 'owner']}><DatabaseSettings /></RequireRole>} />
            <Route path="advanced" element={<RequireRole roles={['admin', 'owner']}><AutomationsSettings /></RequireRole>} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
