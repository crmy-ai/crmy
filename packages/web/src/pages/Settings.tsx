// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useMemo, useEffect } from 'react';
import { TopBar } from '@/components/layout/TopBar';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { CircleUser, Lock, Link2, ListFilter, Copy, Trash2, Plus, Palette, Database, CheckCircle2, XCircle, Users, Pencil, Eye, EyeOff, LayoutGrid, List, ChevronUp, ChevronDown, ChevronRight, Bot, Key, Search, X, Tags, Settings as SettingsIcon } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useAppStore } from '@/store/appStore';
import { ListToolbar, type FilterConfig, type SortOption } from '@/components/crm/ListToolbar';
import { PaginationBar } from '@/components/crm/PaginationBar';
import { motion, AnimatePresence } from 'framer-motion';
import { useIsMobile } from '@/hooks/use-mobile';
import { getUser } from '@/api/client';
import { useApiKeys, useCreateApiKey, useUpdateApiKey, useRevokeApiKey, useActors, useUpdateProfile, useWebhooks, useCreateWebhook, useDeleteWebhook, useWebhookDeliveries, useCustomFields, useCreateCustomField, useUpdateCustomField, useDeleteCustomField, useDbConfig, useTestDbConfig, useSaveDbConfig, useUsers, useCreateUser, useUpdateUser, useDeleteUser, useContextTypes, useCreateContextType, useDeleteContextType, useActivityTypes, useCreateActivityType, useDeleteActivityType } from '@/api/hooks';
import { useAgentSettings } from '@/contexts/AgentSettingsContext';
import AgentSettings from '@/pages/AgentSettings';
import ActorsSettings from '@/components/settings/ActorsSettings';

type NavRole = 'member' | 'admin' | 'owner';

const settingsNavConfig: { icon: React.ElementType; label: string; path: string; roles: NavRole[] }[] = [
  { icon: CircleUser, label: 'Profile',       path: '/settings',              roles: ['member', 'admin', 'owner'] },
  { icon: Palette,    label: 'Appearance',    path: '/settings/appearance',   roles: ['member', 'admin', 'owner'] },
  { icon: Lock,       label: 'API Keys',      path: '/settings/api-keys',     roles: ['member', 'admin', 'owner'] },
  { icon: Link2,      label: 'Webhooks',      path: '/settings/webhooks',     roles: ['admin', 'owner'] },
  { icon: ListFilter, label: 'Custom Fields', path: '/settings/custom-fields',roles: ['admin', 'owner'] },
  { icon: Users,      label: 'Actors',        path: '/settings/actors',       roles: ['admin', 'owner'] },
  { icon: Tags,       label: 'Registries',    path: '/settings/registries',   roles: ['admin', 'owner'] },
  { icon: Bot,        label: 'Local Agent', path: '/settings/agent',        roles: ['admin', 'owner'] },
  { icon: Database,   label: 'Database',      path: '/settings/database',     roles: ['admin', 'owner'] },
];

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
    <div className="max-w-lg">
      <h2 className="font-display font-bold text-lg text-foreground mb-1">Profile</h2>
      <p className="text-sm text-muted-foreground mb-6">Update your name, email, and password.</p>

      <div className="space-y-5">
        {/* Read-only: Role */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Role</label>
          <div className={readonlyCls}>
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border capitalize ${roleBadge[user?.role ?? 'member'] ?? roleBadge.member}`}>
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
            {!isAdmin && <span className="text-[10px] text-muted-foreground/60 normal-case font-normal">contact an admin to change</span>}
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
    { value: 'assignments:create', label: 'Create' },
    { value: 'assignments:update', label: 'Update' },
  ]},
  { label: 'Context', scopes: [
    { value: 'context:read', label: 'Read' },
    { value: 'context:write', label: 'Write' },
  ]},
];

const ALL_SCOPES = API_KEY_SCOPE_GROUPS.flatMap(g => g.scopes);

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
      <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize flex-shrink-0 ${type === 'agent' ? 'bg-blue-500/10 text-blue-500 border-blue-500/30' : 'bg-amber-500/10 text-amber-600 border-amber-500/30'}`}>{type}</span>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="font-display font-bold text-lg text-foreground">API Keys</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Manage access tokens for the CRMy REST API and MCP server.</p>
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
                              <p className="text-[10px] font-mono text-muted-foreground">{k.id.slice(0, 14)}…</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => { setExpandedKeyId(prev => prev === k.id ? null : k.id); setEditingScopes(null); }}
                            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
                          >
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border font-mono">
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
                          {k.expires_at && <p className={`text-[10px] mt-0.5 ${new Date(k.expires_at) < new Date() ? 'text-destructive' : 'text-muted-foreground'}`}>Exp: {fmtDate(k.expires_at)}</p>}
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
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
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
                                          {API_KEY_SCOPE_GROUPS.map(group => (
                                            <div key={group.label}>
                                              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{group.label}</p>
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
                                              <span key={s} className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-primary/10 text-primary border border-primary/20">{s}</span>
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
                    <p className="text-[10px] font-mono text-muted-foreground">{k.id.slice(0, 14)}…</p>
                  </div>
                </div>
                {revokeId === k.id ? (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => handleRevoke(k.id)} className="px-2 py-0.5 rounded bg-destructive text-destructive-foreground text-[10px] font-semibold">Revoke</button>
                    <button onClick={() => setRevokeId(null)} className="px-2 py-0.5 rounded bg-muted text-muted-foreground text-[10px]">✕</button>
                  </div>
                ) : (
                  <button onClick={() => setRevokeId(k.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {(k.scopes ?? []).map((s: string) => (
                  <span key={s} className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-muted text-muted-foreground border border-border">{s}</span>
                ))}
              </div>
              <div className="space-y-1.5 pt-2 border-t border-border">
                {k.actor_name && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground w-16 flex-shrink-0">Actor</span>
                    <ActorBadge name={k.actor_name} type={k.actor_type} />
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground w-16 flex-shrink-0">Last used</span>
                  <span className={`text-xs ${k.last_used_at ? 'text-foreground' : 'text-muted-foreground'}`}>{fmtLastUsed(k.last_used_at)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground w-16 flex-shrink-0">Created</span>
                  <span className="text-xs text-muted-foreground">{fmtDate(k.created_at)}</span>
                </div>
                {k.expires_at && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground w-16 flex-shrink-0">Expires</span>
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
          <div key={d.id} className="flex items-center gap-2 text-[10px]">
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

function WebhooksSettings() {
  const { data, isLoading } = useWebhooks();
  const createWebhook = useCreateWebhook();
  const deleteWebhook = useDeleteWebhook();
  const [showCreate, setShowCreate] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
          <div key={wh.id} className="rounded-xl border border-border bg-card overflow-hidden">
            <div
              className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/30 transition-colors"
              onClick={() => setExpandedId(expandedId === wh.id ? null : wh.id)}
            >
              <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${expandedId === wh.id ? 'rotate-90' : ''}`} />
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
              <button onClick={(e) => { e.stopPropagation(); handleDelete(wh.id); }} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            {expandedId === wh.id && (
              <div className="border-t border-border bg-muted/10">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-4 pt-2">Recent deliveries</p>
                <WebhookDeliveryLog webhookId={wh.id} />
              </div>
            )}
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
    } catch {
      toast({ title: 'Error', description: 'Failed to create field.', variant: 'destructive' });
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
    } catch {
      toast({ title: 'Error', description: 'Failed to update field.', variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteField.mutateAsync(id);
      setConfirmDeleteId(null);
      toast({ title: 'Custom field deleted' });
    } catch {
      toast({ title: 'Error', description: 'Failed to delete field.', variant: 'destructive' });
    }
  };

  const inputCls = 'w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-display font-bold text-lg text-foreground">Custom Fields</h2>
        <button onClick={() => { setShowCreate(true); setEditingId(null); setConfirmDeleteId(null); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors">
          <Plus className="w-3.5 h-3.5" /> New Field
        </button>
      </div>
      <p className="text-sm text-muted-foreground mb-5">
        Define custom fields per object type. Values are type-checked and required fields are enforced by the server.
      </p>

      {/* Object type tabs */}
      <div className="flex gap-1 mb-5 overflow-x-auto no-scrollbar bg-muted rounded-xl p-0.5">
        {objectTypes.map((ot) => (
          <button key={ot.key} onClick={() => { setActiveTab(ot.key); setShowCreate(false); setEditingId(null); setConfirmDeleteId(null); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${activeTab === ot.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            {ot.label}
          </button>
        ))}
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="mb-5 p-4 rounded-xl border border-border bg-muted/30 space-y-3 max-w-lg">
          <p className="text-xs font-display font-semibold text-muted-foreground uppercase tracking-wider">New Field</p>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Label <span className="text-destructive">*</span></label>
            <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="e.g. Preferred Language"
              className={inputCls} onKeyDown={e => e.key === 'Enter' && handleCreate()} />
            {newLabel.trim() && (
              <p className="text-[11px] text-muted-foreground font-mono">key: {toFieldKey(newLabel)}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Type</label>
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
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
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
              className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors">
              {createField.isPending ? 'Creating…' : 'Create Field'}
            </button>
            <button onClick={() => { setShowCreate(false); setNewLabel(''); setNewRequired(false); setNewOptions(''); }}
              className="px-3 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-semibold hover:bg-muted/80 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Fields list */}
      <div className="space-y-2 max-w-2xl">
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
                      <span className="text-[10px] px-1.5 py-0.5 rounded border bg-destructive/10 text-destructive border-destructive/20 font-semibold">Required</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-mono font-medium ${fieldTypeColor(f.field_type)}`}>
                      {fieldTypeLabel(f.field_type)}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono">{f.field_key}</span>
                    {Array.isArray(f.options) && f.options.length > 0 && (
                      <span className="text-[10px] text-muted-foreground">
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
const ROLES = ['member', 'admin', 'owner'] as const;
type Role = typeof ROLES[number];
const roleLabels: Record<Role, string> = { member: 'Member', admin: 'Admin', owner: 'Owner' };

function isValidEmail(email: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function isStrongPassword(p: string) { return PASSWORD_RULES.every(r => r.test(p)); }

type UserRow = { id: string; email: string; name: string; role: string; created_at: string };

interface UserFormState {
  name: string; email: string; password: string; role: Role;
  showPassword: boolean; touched: Record<string, boolean>;
}

function initForm(defaults?: Partial<UserFormState>): UserFormState {
  return { name: '', email: '', password: '', role: 'member', showPassword: false, touched: {}, ...defaults };
}

function UserForm({
  form, onChange, onTouch, isEdit, currentUserRole,
}: {
  form: UserFormState;
  onChange: (patch: Partial<UserFormState>) => void;
  onTouch: (field: string) => void;
  isEdit: boolean;
  currentUserRole: string;
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
                  <li key={rule.label} className={`flex items-center gap-1 text-[11px] ${ok ? 'text-success' : 'text-muted-foreground'}`}>
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
          <p className="text-[11px] text-muted-foreground">
            {form.role === 'owner' ? 'Full access including billing and account deletion' : form.role === 'admin' ? 'Can manage users, settings, and all data' : 'Can access CRM data only'}
          </p>
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
      await createUser.mutateAsync({ name: f.name.trim(), email: f.email.trim(), password: f.password, role: f.role });
      setShowCreate(false);
      setCreateForm(initForm());
      toast({ title: 'User created' });
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed to create user', variant: 'destructive' });
    }
  };

  const startEdit = (u: UserRow) => {
    setEditingId(u.id);
    setEditForm(initForm({ name: u.name, email: u.email, role: u.role as Role }));
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
              isEdit={false} currentUserRole={currentUserRole}
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
                              isEdit={true} currentUserRole={currentUserRole}
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
                                    <span className="text-[10px] font-mono bg-muted text-muted-foreground px-1.5 py-0.5 rounded">you</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                          <td className="px-4 py-3">
                            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${rolePillCls[u.role] ?? rolePillCls.member}`}>
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
                    isEdit={true} currentUserRole={currentUserRole}
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
                            <span className="text-[10px] font-mono bg-muted text-muted-foreground px-1.5 py-0.5 rounded">you</span>
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
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${rolePillCls[u.role] ?? rolePillCls.member}`}>
                      {roleLabels[u.role as Role] ?? u.role}
                    </span>
                    {u.created_at && (
                      <span className="text-[10px] text-muted-foreground">
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

function DatabaseSettings() {
  const { data, isLoading } = useDbConfig();
  const testConfig = useTestDbConfig();
  const saveConfig = useSaveDbConfig();
  const [editing, setEditing] = useState(false);
  const [connStr, setConnStr] = useState('');
  const [testResult, setTestResult] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [testError, setTestError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');

  const dbInfo = data as { host: string; port: string; database: string; user: string; ssl: string | null } | undefined;

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
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed to save', variant: 'destructive' });
    }
  };

  return (
    <div>
      <h2 className="font-display font-bold text-lg text-foreground mb-2">Database Connection</h2>
      <p className="text-sm text-muted-foreground mb-6">
        View and update the PostgreSQL database connection. Changes are saved to <code className="text-xs font-mono bg-muted px-1 py-0.5 rounded">.env.db</code> and take effect after a server restart.
      </p>

      <div className="space-y-4 max-w-lg">
        {isLoading ? (
          <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-muted/50 rounded-lg animate-pulse" />)}</div>
        ) : (
          <div className="p-4 rounded-xl border border-border bg-card space-y-3">
            <p className="text-xs font-display font-semibold text-muted-foreground uppercase tracking-wider mb-2">Current Connection</p>
            {[
              { label: 'Host', value: dbInfo?.host || '—' },
              { label: 'Port', value: dbInfo?.port || '—' },
              { label: 'Database', value: dbInfo?.database || '—' },
              { label: 'User', value: dbInfo?.user || '—' },
              { label: 'SSL', value: dbInfo?.ssl || 'default' },
            ].map((row) => (
              <div key={row.label} className="flex items-center gap-3">
                <span className="text-xs font-medium text-muted-foreground w-20 flex-shrink-0">{row.label}</span>
                <code className="text-sm font-mono text-foreground">{row.value}</code>
              </div>
            ))}
          </div>
        )}

        {saveSuccess && (
          <div className="flex items-start gap-2 p-3 rounded-xl border border-success/30 bg-success/5 text-sm text-success">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{saveSuccess}</span>
          </div>
        )}

        {!editing ? (
          <button onClick={() => { setEditing(true); setSaveSuccess(''); setTestResult('idle'); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors">
            <Database className="w-3.5 h-3.5" /> Edit Connection
          </button>
        ) : (
          <div className="space-y-3 p-4 rounded-xl border border-border bg-muted/30">
            <p className="text-xs font-display font-semibold text-muted-foreground uppercase tracking-wider">New Connection String</p>
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
                className="px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-foreground/30 disabled:opacity-40 transition-colors">
                {testConfig.isPending ? 'Testing...' : 'Test Connection'}
              </button>
              <button onClick={handleSave}
                disabled={!connStr.trim() || testResult !== 'ok' || saveConfig.isPending}
                className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors">
                {saveConfig.isPending ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => { setEditing(false); setConnStr(''); setTestResult('idle'); setTestError(''); }}
                className="px-3 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-semibold hover:bg-muted/80 transition-colors">
                Cancel
              </button>
            </div>
            <p className="text-xs text-muted-foreground">Test the connection before saving. Save is only enabled after a successful test.</p>
          </div>
        )}
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

  const [ctxName, setCtxName] = useState('');
  const [ctxLabel, setCtxLabel] = useState('');
  const [ctxDesc, setCtxDesc] = useState('');
  const [actName, setActName] = useState('');
  const [actLabel, setActLabel] = useState('');
  const [actCategory, setActCategory] = useState('');
  const [actDesc, setActDesc] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const contextTypes = (ctxData as any)?.data ?? [];
  const activityTypes = (actData as any)?.data ?? [];

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

  const inputCls = 'h-8 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';

  return (
    <div className="max-w-2xl">
      <h2 className="font-display font-bold text-lg text-foreground mb-1">Type Registries</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Context types classify the knowledge your agents store — objections, next steps, competitive intel, and more.
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
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">System</span>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {SYSTEM_CONTEXT_TYPES.map(t => (
              <span key={t.type_name} className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-muted text-muted-foreground">
                {t.label}
              </span>
            ))}
          </div>
        </div>

        {/* Custom types */}
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Custom</span>
        <div className="space-y-1.5 mb-3 mt-1.5">
          {ctxLoading ? (
            <div className="h-8 bg-muted/50 rounded animate-pulse" />
          ) : contextTypes.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No custom context types added yet.</p>
          ) : contextTypes.map((t: any) => (
            <div key={t.type_name} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card">
              <span className="text-sm font-medium text-foreground flex-1">{t.label || t.type_name}</span>
              <span className="text-[10px] font-mono text-muted-foreground">{t.type_name}</span>
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
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">System</span>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {SYSTEM_ACTIVITY_TYPES.map(t => (
              <span key={t.type_name} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-muted text-muted-foreground">
                {t.label}
                <span className="text-[9px] opacity-60">{t.category}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Custom types */}
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Custom</span>
        <div className="space-y-1.5 mb-3 mt-1.5">
          {actLoading ? (
            <div className="h-8 bg-muted/50 rounded animate-pulse" />
          ) : activityTypes.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No custom activity types added yet.</p>
          ) : activityTypes.map((t: any) => (
            <div key={t.type_name} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card">
              <span className="text-sm font-medium text-foreground flex-1">{t.label || t.type_name}</span>
              <span className="text-[10px] font-mono text-muted-foreground">{t.type_name}</span>
              {t.category && <span className="px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground">{t.category}</span>}
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
    </div>
  );
}

export default function Settings() {
  const location = useLocation();
  const user = getUser();
  const userRole = (user?.role ?? 'member') as NavRole;
  const visibleNav = settingsNavConfig.filter(item => item.roles.includes(userRole));
  const { enabled: agentEnabled } = useAgentSettings();

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Settings"
        icon={SettingsIcon}
        iconClassName="text-muted-foreground"
        description="Manage your account, team, and integrations."
      />

      <div className="md:hidden flex gap-1 overflow-x-auto no-scrollbar px-4 pt-3 pb-1 border-b border-border">
        {visibleNav.map((item) => {
          const active = item.path === '/settings' ? location.pathname === '/settings' : location.pathname.startsWith(item.path);
          return (
            <Link key={item.path} to={item.path}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>
              <item.icon className="w-3.5 h-3.5" />
              {item.label}
              {item.path === '/settings/agent' && (
                <span className={`w-2 h-2 rounded-full ${agentEnabled ? 'bg-amber-500' : 'bg-muted-foreground/40'}`} />
              )}
            </Link>
          );
        })}
      </div>

      <div className="flex-1 flex overflow-hidden">
        <nav className="hidden md:flex flex-col w-48 border-r border-border bg-muted p-2 gap-0.5">
          {visibleNav.map((item) => {
            const active = item.path === '/settings' ? location.pathname === '/settings' : location.pathname.startsWith(item.path);
            return (
              <Link key={item.path} to={item.path}
                className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${active ? 'bg-primary/15 text-primary' : 'text-foreground/60 hover:bg-muted hover:text-foreground'}`}>
                <item.icon className="w-4 h-4" />
                {item.label}
                {item.path === '/settings/agent' && (
                  <span className={`ml-auto w-2 h-2 rounded-full ${agentEnabled ? 'bg-amber-500' : 'bg-muted-foreground/40'}`} />
                )}
              </Link>
            );
          })}
        </nav>
        <div className="flex-1 overflow-y-auto p-6 pb-20 md:pb-6">
          <Routes>
            <Route index element={<ProfileSettings />} />
            <Route path="appearance" element={<AppearanceSettings />} />
            <Route path="api-keys" element={<ApiKeysSettings />} />
            <Route path="webhooks" element={<RequireRole roles={['admin', 'owner']}><WebhooksSettings /></RequireRole>} />
            <Route path="custom-fields" element={<RequireRole roles={['admin', 'owner']}><CustomFieldsSettings /></RequireRole>} />
            <Route path="registries" element={<RequireRole roles={['admin', 'owner']}><RegistriesSettings /></RequireRole>} />
            <Route path="actors" element={<RequireRole roles={['admin', 'owner']}><ActorsSettings /></RequireRole>} />
            <Route path="agent" element={<RequireRole roles={['admin', 'owner']}><AgentSettings /></RequireRole>} />
            <Route path="database" element={<RequireRole roles={['admin', 'owner']}><DatabaseSettings /></RequireRole>} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
