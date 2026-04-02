// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useMemo, useEffect } from 'react';
import { useActors, useCreateActor, useUpdateActor, useCreateUser, useUsers, useApiKeys, useCreateApiKey, useRevokeApiKey } from '@/api/hooks';
import { ListToolbar, type FilterConfig, type SortOption } from '@/components/crm/ListToolbar';
import { PaginationBar } from '@/components/crm/PaginationBar';
import { motion, AnimatePresence } from 'framer-motion';
import { useIsMobile } from '@/hooks/use-mobile';
import { getUser } from '@/api/client';
import { toast } from '@/hooks/use-toast';
import {
  Users, Bot, LayoutGrid, List, ChevronUp, ChevronDown,
  Pencil, Trash2, Shield, Phone, Mail, MessageSquare,
  Plus, X, CheckCircle2, CircleDot, Power, PowerOff,
  Key, Copy, ChevronRight, Lock,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type ActorType = 'human' | 'agent';
type TabFilter = 'all' | 'human' | 'agent';

interface ContactChannel {
  channel_type: string;
  handle: string;
  primary?: boolean;
}

interface ActorRow {
  id: string;
  actor_type: ActorType;
  display_name: string;
  email?: string;
  phone?: string;
  user_id?: string;
  role?: string;
  agent_identifier?: string;
  agent_model?: string;
  scopes: string[];
  metadata: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CHANNEL_TYPES = [
  { value: 'slack', label: 'Slack', icon: MessageSquare },
  { value: 'teams', label: 'Teams', icon: MessageSquare },
  { value: 'discord', label: 'Discord', icon: MessageSquare },
  { value: 'whatsapp', label: 'WhatsApp', icon: Phone },
];

const roleLabels: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};

const rolePillCls: Record<string, string> = {
  owner: 'bg-accent/15 text-accent border-accent/30',
  admin: 'bg-primary/15 text-primary border-primary/30',
  member: 'bg-muted text-muted-foreground border-border',
};

const typePillCls: Record<string, string> = {
  human: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
  agent: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30',
};

const SCOPE_GROUPS = [
  { label: 'General', scopes: [
    { value: 'read', label: 'Read', desc: 'Read all CRM data' },
    { value: 'write', label: 'Write', desc: 'Create and modify CRM data' },
  ]},
  { label: 'Contacts', scopes: [
    { value: 'contacts:read', label: 'Read contacts' },
    { value: 'contacts:write', label: 'Write contacts' },
  ]},
  { label: 'Accounts', scopes: [
    { value: 'accounts:read', label: 'Read accounts' },
    { value: 'accounts:write', label: 'Write accounts' },
  ]},
  { label: 'Opportunities', scopes: [
    { value: 'opportunities:read', label: 'Read opportunities' },
    { value: 'opportunities:write', label: 'Write opportunities' },
  ]},
  { label: 'Activities', scopes: [
    { value: 'activities:read', label: 'Read activities' },
    { value: 'activities:write', label: 'Write activities' },
  ]},
  { label: 'Assignments', scopes: [
    { value: 'assignments:create', label: 'Create assignments' },
    { value: 'assignments:update', label: 'Update assignments' },
  ]},
  { label: 'Context', scopes: [
    { value: 'context:read', label: 'Read context' },
    { value: 'context:write', label: 'Write context' },
  ]},
];

// ─── Actor Detail Panel ──────────────────────────────────────────────────────

function ActorDetailPanel({
  actor,
  onClose,
}: {
  actor: ActorRow;
  onClose: () => void;
}) {
  const updateActor = useUpdateActor();
  const { data: keysData, isLoading: keysLoading } = useApiKeys(actor.id);
  const createKey = useCreateApiKey();
  const revokeKey = useRevokeApiKey();
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [showCreateKey, setShowCreateKey] = useState(false);
  const [editingScopes, setEditingScopes] = useState(false);
  const [scopeDraft, setScopeDraft] = useState<string[]>(actor.scopes ?? []);

  const keys = (keysData as { data: Array<{ id: string; label: string; last_used_at?: string; created_at: string }> })?.data ?? [];

  const handleCreateKey = async () => {
    if (!newKeyLabel.trim()) return;
    try {
      const result = await createKey.mutateAsync({
        label: newKeyLabel.trim(),
        scopes: actor.scopes ?? ['read'],
        actor_id: actor.id,
      });
      setRevealedKey((result as { key?: string }).key ?? null);
      setNewKeyLabel('');
      setShowCreateKey(false);
      toast({ title: 'API key created', description: 'Copy it now — it won\'t be shown again.' });
    } catch {
      toast({ title: 'Error', description: 'Failed to create API key.', variant: 'destructive' });
    }
  };

  const handleRevokeKey = async (id: string) => {
    try {
      await revokeKey.mutateAsync(id);
      toast({ title: 'API key revoked' });
    } catch {
      toast({ title: 'Error', description: 'Failed to revoke key.', variant: 'destructive' });
    }
  };

  const toggleScope = (scope: string) => {
    setScopeDraft(prev => prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope]);
  };

  const handleSaveScopes = async () => {
    try {
      await updateActor.mutateAsync({ id: actor.id, scopes: scopeDraft });
      setEditingScopes(false);
      toast({ title: 'Permissions updated' });
    } catch {
      toast({ title: 'Error', description: 'Failed to update permissions.', variant: 'destructive' });
    }
  };

  const inputCls = 'w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="overflow-hidden"
    >
      <div className="px-4 py-4 bg-muted/20 border-t border-border space-y-4">
        {/* ── Permissions / Scopes ── */}
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-semibold text-foreground">Permissions</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                {(actor.scopes ?? []).length} scopes
              </span>
            </div>
            {!editingScopes ? (
              <button onClick={() => { setEditingScopes(true); setScopeDraft(actor.scopes ?? []); }}
                className="text-xs font-semibold text-primary hover:underline">
                Edit
              </button>
            ) : (
              <div className="flex gap-2">
                <button onClick={handleSaveScopes} disabled={updateActor.isPending}
                  className="px-2.5 py-1 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-40">
                  {updateActor.isPending ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => setEditingScopes(false)}
                  className="px-2.5 py-1 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:text-foreground">
                  Cancel
                </button>
              </div>
            )}
          </div>
          <div className="px-4 py-3">
            {editingScopes ? (
              <div className="space-y-3">
                {SCOPE_GROUPS.map(group => (
                  <div key={group.label}>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{group.label}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {group.scopes.map(s => {
                        const active = scopeDraft.includes(s.value);
                        return (
                          <button key={s.value} onClick={() => toggleScope(s.value)}
                            className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                              active
                                ? 'bg-primary/10 text-primary border-primary/30'
                                : 'bg-muted/50 border-border text-muted-foreground hover:text-foreground'
                            }`}>
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
                {(actor.scopes ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">No permissions assigned.</p>
                ) : (
                  (actor.scopes ?? []).map(s => (
                    <span key={s} className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-primary/10 text-primary border border-primary/20">
                      {s}
                    </span>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── API Keys ── */}
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Key className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-semibold text-foreground">API Keys</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                {keys.length}
              </span>
            </div>
            <button onClick={() => setShowCreateKey(true)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90">
              <Plus className="w-3 h-3" /> New Key
            </button>
          </div>

          <div className="px-4 py-3 space-y-2">
            {/* Revealed key banner */}
            {revealedKey && (
              <div className="p-3 rounded-lg border border-green-500/30 bg-green-500/5 space-y-2">
                <p className="text-xs font-semibold text-green-600 dark:text-green-400">Copy this key now — it won't be shown again:</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs font-mono bg-background rounded px-2 py-1.5 border border-border truncate">{revealedKey}</code>
                  <button onClick={() => { navigator.clipboard.writeText(revealedKey); toast({ title: 'Copied!' }); }}
                    className="p-1.5 rounded-lg hover:bg-muted transition-colors flex-shrink-0">
                    <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                </div>
                <button onClick={() => setRevealedKey(null)} className="text-xs text-muted-foreground hover:text-foreground">Dismiss</button>
              </div>
            )}

            {/* Create key form */}
            {showCreateKey && (
              <div className="flex items-center gap-2">
                <input value={newKeyLabel} onChange={e => setNewKeyLabel(e.target.value)}
                  placeholder="Key label (e.g. Production)"
                  className={inputCls + ' max-w-xs'}
                  onKeyDown={e => e.key === 'Enter' && handleCreateKey()} />
                <button onClick={handleCreateKey} disabled={!newKeyLabel.trim() || createKey.isPending}
                  className="px-2.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-40">
                  Create
                </button>
                <button onClick={() => { setShowCreateKey(false); setNewKeyLabel(''); }}
                  className="px-2.5 py-1.5 rounded-lg border border-border text-xs font-semibold text-muted-foreground">
                  Cancel
                </button>
              </div>
            )}

            {/* Keys list */}
            {keysLoading ? (
              <div className="h-8 bg-muted/50 rounded animate-pulse" />
            ) : keys.length === 0 && !showCreateKey ? (
              <p className="text-xs text-muted-foreground py-2">No API keys. Create one to allow this actor to authenticate.</p>
            ) : (
              keys.map(k => (
                <div key={k.id} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
                  <Key className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-foreground">{k.label}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {k.last_used_at ? `Last used ${new Date(k.last_used_at).toLocaleDateString()}` : 'Never used'}
                      {' · Created '}
                      {new Date(k.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <button onClick={() => handleRevokeKey(k.id)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors flex-shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex justify-end">
          <button onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">
            Close details
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ActorAvatar({ actor, size = 'sm' }: { actor: ActorRow; size?: 'sm' | 'lg' }) {
  const sz = size === 'lg' ? 'w-10 h-10 text-sm' : 'w-8 h-8 text-xs';
  if (actor.actor_type === 'agent') {
    return (
      <div className={`${sz} rounded-xl bg-blue-500/15 flex items-center justify-center flex-shrink-0`}>
        <Bot className={size === 'lg' ? 'w-5 h-5 text-blue-500' : 'w-3.5 h-3.5 text-blue-500'} />
      </div>
    );
  }
  const initials = actor.display_name.trim().split(/\s+/).map(n => n[0]).slice(0, 2).join('').toUpperCase() || '?';
  return (
    <div className={`${sz} rounded-xl bg-amber-500/15 flex items-center justify-center flex-shrink-0`}>
      <span className="font-display font-bold text-amber-600 dark:text-amber-400">{initials}</span>
    </div>
  );
}

function getContactChannels(metadata: Record<string, unknown>): ContactChannel[] {
  const channels = metadata?.contact_channels;
  if (Array.isArray(channels)) return channels as ContactChannel[];
  return [];
}

// ─── Contact Channels Editor ──────────────────────────────────────────────────

function ContactChannelsEditor({
  channels,
  onChange,
}: {
  channels: ContactChannel[];
  onChange: (channels: ContactChannel[]) => void;
}) {
  const addChannel = () => {
    onChange([...channels, { channel_type: 'slack', handle: '', primary: false }]);
  };

  const removeChannel = (idx: number) => {
    onChange(channels.filter((_, i) => i !== idx));
  };

  const updateChannel = (idx: number, patch: Partial<ContactChannel>) => {
    onChange(channels.map((c, i) => i === idx ? { ...c, ...patch } : c));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">Messaging Channels</label>
        <button
          type="button"
          onClick={addChannel}
          className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium"
        >
          <Plus className="w-3 h-3" /> Add channel
        </button>
      </div>
      {channels.length === 0 && (
        <p className="text-xs text-muted-foreground/60 italic">No messaging channels configured</p>
      )}
      <AnimatePresence>
        {channels.map((ch, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-2"
          >
            <select
              value={ch.channel_type}
              onChange={e => updateChannel(idx, { channel_type: e.target.value })}
              className="h-8 px-2 rounded-lg border border-border bg-background text-xs text-foreground outline-none focus:ring-1 focus:ring-ring w-28"
            >
              {CHANNEL_TYPES.map(ct => (
                <option key={ct.value} value={ct.value}>{ct.label}</option>
              ))}
            </select>
            <input
              value={ch.handle}
              onChange={e => updateChannel(idx, { handle: e.target.value })}
              placeholder="@handle or ID"
              className="flex-1 h-8 px-2 rounded-lg border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              onClick={() => removeChannel(idx)}
              className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ─── Create Forms ─────────────────────────────────────────────────────────────

interface HumanFormState {
  name: string;
  email: string;
  phone: string;
  role: string;
  password: string;
  channels: ContactChannel[];
  createAuthUser: boolean;
}

interface AgentFormState {
  display_name: string;
  agent_identifier: string;
  agent_model: string;
}

const initHumanForm = (): HumanFormState => ({
  name: '', email: '', phone: '', role: 'member', password: '', channels: [], createAuthUser: true,
});

const initAgentForm = (): AgentFormState => ({
  display_name: '', agent_identifier: '', agent_model: '',
});

// ─── Main Component ───────────────────────────────────────────────────────────

interface ActorsSettingsProps {
  /** When provided the parent controls the view toggle (e.g. via TopBar). */
  view?: 'table' | 'cards';
  onViewChange?: (v: 'table' | 'cards') => void;
}

export default function ActorsSettings({ view: viewProp, onViewChange }: ActorsSettingsProps = {}) {
  const currentUser = getUser();
  const isMobile = useIsMobile();
  const [viewInternal, setViewInternal] = useState<'table' | 'cards'>('table');
  // Use controlled value when parent provides it, otherwise own state
  const view = viewProp ?? viewInternal;
  const setView = (v: 'table' | 'cards') => { setViewInternal(v); onViewChange?.(v); };
  const effectiveView = isMobile ? 'cards' : view;

  // Data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: actorsData, isLoading } = useActors({ limit: 200 }) as any;
  const allActors: ActorRow[] = actorsData?.data ?? [];

  // Mutations
  const createActor = useCreateActor();
  const updateActor = useUpdateActor();
  const createUser = useCreateUser();

  // Filters
  const [tab, setTab] = useState<TabFilter>('all');
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({});
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Detail panel
  const [expandedActorId, setExpandedActorId] = useState<string | null>(null);

  // Forms
  const [showCreate, setShowCreate] = useState<'human' | 'agent' | null>(null);
  const [humanForm, setHumanForm] = useState<HumanFormState>(initHumanForm());
  const [agentForm, setAgentForm] = useState<AgentFormState>(initAgentForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPhone, setEditPhone] = useState('');
  const [editRole, setEditRole] = useState('');
  const [editName, setEditName] = useState('');
  const [editChannels, setEditChannels] = useState<ContactChannel[]>([]);

  // Computed
  const filtered = useMemo(() => {
    let result = [...allActors];
    if (tab !== 'all') result = result.filter(a => a.actor_type === tab);
    if (activeFilters.status?.length) {
      const wantActive = activeFilters.status.includes('active');
      const wantInactive = activeFilters.status.includes('inactive');
      if (wantActive && !wantInactive) result = result.filter(a => a.is_active);
      if (wantInactive && !wantActive) result = result.filter(a => !a.is_active);
    }
    if (activeFilters.role?.length) {
      result = result.filter(a => a.role && activeFilters.role.includes(a.role));
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(a =>
        a.display_name.toLowerCase().includes(q) ||
        (a.email ?? '').toLowerCase().includes(q) ||
        (a.phone ?? '').toLowerCase().includes(q) ||
        (a.agent_identifier ?? '').toLowerCase().includes(q)
      );
    }
    if (sort) {
      result.sort((a, b) => {
        const aVal = String((a as unknown as Record<string, unknown>)[sort.key] ?? '');
        const bVal = String((b as unknown as Record<string, unknown>)[sort.key] ?? '');
        return sort.dir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      });
    }
    return result;
  }, [allActors, tab, search, activeFilters, sort]);

  useEffect(() => { setPage(1); }, [tab, search, activeFilters, sort]);
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  const humanCount = allActors.filter(a => a.actor_type === 'human').length;
  const agentCount = allActors.filter(a => a.actor_type === 'agent').length;

  // Config
  const filterConfigs: FilterConfig[] = [
    {
      key: 'status', label: 'Status', options: [
        { value: 'active', label: 'Active' },
        { value: 'inactive', label: 'Inactive' },
      ],
    },
    {
      key: 'role', label: 'Role', options: [
        { value: 'owner', label: 'Owner' },
        { value: 'admin', label: 'Admin' },
        { value: 'member', label: 'Member' },
      ],
    },
  ];

  const sortOptions: SortOption[] = [
    { key: 'display_name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'actor_type', label: 'Type' },
    { key: 'created_at', label: 'Created' },
  ];

  const handleFilterChange = (key: string, values: string[]) => {
    setActiveFilters(prev => {
      const next = { ...prev };
      if (values.length === 0) delete next[key]; else next[key] = values;
      return next;
    });
  };

  const handleSortChange = (key: string) => {
    setSort(prev => prev?.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  };

  // ─── Create Handlers ────────────────────────────────────────────────────────

  const handleCreateHuman = async () => {
    if (!humanForm.name.trim() || !humanForm.email.trim()) return;
    try {
      // If creating an auth user too, create user first (which auto-creates actor via backend)
      if (humanForm.createAuthUser && humanForm.password) {
        await createUser.mutateAsync({
          name: humanForm.name.trim(),
          email: humanForm.email.trim(),
          password: humanForm.password,
          role: humanForm.role,
        });
      } else {
        // Create actor only (no auth user)
        const metadata: Record<string, unknown> = {};
        if (humanForm.channels.length > 0) {
          metadata.contact_channels = humanForm.channels.filter(c => c.handle.trim());
        }
        await createActor.mutateAsync({
          actor_type: 'human',
          display_name: humanForm.name.trim(),
          email: humanForm.email.trim(),
          phone: humanForm.phone.trim() || undefined,
          role: humanForm.role,
          metadata,
        });
      }
      setShowCreate(null);
      setHumanForm(initHumanForm());
      toast({ title: 'Human actor created' });
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed to create', variant: 'destructive' });
    }
  };

  const handleCreateAgent = async () => {
    if (!agentForm.display_name.trim()) return;
    try {
      await createActor.mutateAsync({
        actor_type: 'agent',
        display_name: agentForm.display_name.trim(),
        agent_identifier: agentForm.agent_identifier.trim() || undefined,
        agent_model: agentForm.agent_model.trim() || undefined,
        metadata: {},
      });
      setShowCreate(null);
      setAgentForm(initAgentForm());
      toast({ title: 'Agent registered' });
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed to register', variant: 'destructive' });
    }
  };

  // ─── Edit / Toggle ──────────────────────────────────────────────────────────

  const startEdit = (actor: ActorRow) => {
    setEditingId(actor.id);
    setEditName(actor.display_name);
    setEditPhone(actor.phone ?? '');
    setEditRole(actor.role ?? 'member');
    setEditChannels(getContactChannels(actor.metadata));
  };

  const handleUpdate = async () => {
    if (!editingId) return;
    try {
      const metadata: Record<string, unknown> = {};
      if (editChannels.length > 0) {
        metadata.contact_channels = editChannels.filter(c => c.handle.trim());
      }
      await updateActor.mutateAsync({
        id: editingId,
        display_name: editName.trim(),
        phone: editPhone.trim() || null,
        role: editRole || null,
        metadata,
      });
      setEditingId(null);
      toast({ title: 'Actor updated' });
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed to update', variant: 'destructive' });
    }
  };

  const toggleExpand = (actorId: string) => {
    setExpandedActorId(prev => prev === actorId ? null : actorId);
  };

  const toggleActive = async (actor: ActorRow) => {
    try {
      await updateActor.mutateAsync({ id: actor.id, is_active: !actor.is_active });
      toast({ title: actor.is_active ? 'Actor deactivated' : 'Actor activated' });
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed', variant: 'destructive' });
    }
  };

  // ─── Sort Header ────────────────────────────────────────────────────────────

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

  // ─── Render ─────────────────────────────────────────────────────────────────

  const inputCls = 'w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';

  return (
    <div className="-mx-6 -my-6 flex flex-col">
      {/* View toggle — only shown when parent isn't controlling it (e.g. Settings embed) */}
      {!viewProp && (
        <div className="flex items-center justify-end px-6 pt-4 pb-2">
          <div className="hidden md:flex items-center gap-1 bg-muted rounded-xl p-0.5">
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
      )}

      {/* Type tabs */}
      <div className="flex items-center gap-1 px-6 pt-4 pb-2">
        {([
          { key: 'all', label: 'All', count: allActors.length },
          { key: 'human', label: 'Humans', count: humanCount, icon: Users },
          { key: 'agent', label: 'Agents', count: agentCount, icon: Bot },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              tab === t.key ? 'bg-primary/15 text-primary' : 'bg-muted/50 text-muted-foreground hover:text-foreground'
            }`}
          >
            {'icon' in t && t.icon && <t.icon className="w-3 h-3" />}
            {t.label}
            <span className="text-[10px] opacity-60">{t.count}</span>
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <ListToolbar
        searchValue={search} onSearchChange={setSearch} searchPlaceholder="Search actors..."
        filters={filterConfigs} activeFilters={activeFilters} onFilterChange={handleFilterChange}
        onClearFilters={() => setActiveFilters({})} sortOptions={sortOptions} currentSort={sort}
        onSortChange={handleSortChange}
        onAdd={() => setShowCreate(tab === 'agent' ? 'agent' : 'human')}
        addLabel={tab === 'agent' ? 'Register Agent' : 'Add Human'}
        entityType="actors"
      />

      <div className="px-4 md:px-6 pb-8 space-y-3 mt-1">
        {/* Create forms */}
        <AnimatePresence>
          {showCreate === 'human' && (
            <motion.div
              initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              className="p-4 rounded-xl border border-border bg-muted/30 space-y-4"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-display font-semibold text-muted-foreground uppercase tracking-wider">New Human Actor</p>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={humanForm.createAuthUser}
                      onChange={e => setHumanForm(f => ({ ...f, createAuthUser: e.target.checked }))}
                      className="rounded"
                    />
                    Create login account
                  </label>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Name <span className="text-destructive">*</span></label>
                  <input value={humanForm.name} onChange={e => setHumanForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Jane Smith" className={inputCls} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Email <span className="text-destructive">*</span></label>
                  <input type="email" value={humanForm.email} onChange={e => setHumanForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="jane@company.com" className={inputCls} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Phone</label>
                  <input value={humanForm.phone} onChange={e => setHumanForm(f => ({ ...f, phone: e.target.value }))}
                    placeholder="+1 (555) 123-4567" className={inputCls} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Role</label>
                  <select value={humanForm.role} onChange={e => setHumanForm(f => ({ ...f, role: e.target.value }))}
                    className={`${inputCls} cursor-pointer`}>
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                    {currentUser?.role === 'owner' && <option value="owner">Owner</option>}
                  </select>
                </div>
              </div>
              {humanForm.createAuthUser && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Password <span className="text-destructive">*</span></label>
                    <input type="password" value={humanForm.password} onChange={e => setHumanForm(f => ({ ...f, password: e.target.value }))}
                      placeholder="Min. 8 characters" className={inputCls} />
                  </div>
                </div>
              )}
              <ContactChannelsEditor
                channels={humanForm.channels}
                onChange={channels => setHumanForm(f => ({ ...f, channels }))}
              />
              <div className="flex gap-2 pt-1">
                <button onClick={handleCreateHuman} disabled={createActor.isPending || createUser.isPending}
                  className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors">
                  {createActor.isPending || createUser.isPending ? 'Creating...' : 'Create Human Actor'}
                </button>
                <button onClick={() => { setShowCreate(null); setHumanForm(initHumanForm()); }}
                  className="px-3 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-semibold hover:bg-muted/80 transition-colors">
                  Cancel
                </button>
              </div>
            </motion.div>
          )}

          {showCreate === 'agent' && (
            <motion.div
              initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              className="p-4 rounded-xl border border-border bg-muted/30 space-y-4"
            >
              <p className="text-xs font-display font-semibold text-muted-foreground uppercase tracking-wider">Register Agent</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Display Name <span className="text-destructive">*</span></label>
                  <input value={agentForm.display_name} onChange={e => setAgentForm(f => ({ ...f, display_name: e.target.value }))}
                    placeholder="Outreach Bot" className={inputCls} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Identifier</label>
                  <input value={agentForm.agent_identifier} onChange={e => setAgentForm(f => ({ ...f, agent_identifier: e.target.value }))}
                    placeholder="custom/outreach-v1" className={inputCls} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Model</label>
                  <input value={agentForm.agent_model} onChange={e => setAgentForm(f => ({ ...f, agent_model: e.target.value }))}
                    placeholder="claude-sonnet-4-20250514" className={inputCls} />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={handleCreateAgent} disabled={createActor.isPending}
                  className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors">
                  {createActor.isPending ? 'Registering...' : 'Register Agent'}
                </button>
                <button onClick={() => { setShowCreate(null); setAgentForm(initAgentForm()); }}
                  className="px-3 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-semibold hover:bg-muted/80 transition-colors">
                  Cancel
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Content */}
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => <div key={i} className="h-14 bg-muted/50 rounded-xl animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Users className="w-8 h-8 mb-3 opacity-30" />
            <p className="text-sm">No actors found.</p>
            {(search || Object.keys(activeFilters).length > 0 || tab !== 'all') && (
              <button onClick={() => { setSearch(''); setActiveFilters({}); setTab('all'); }}
                className="mt-2 text-xs text-primary font-semibold hover:underline">
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
                    <SortHeader label="Name" sortKey="display_name" />
                    <th className="text-left px-4 py-3 text-xs font-display font-semibold text-muted-foreground">Type</th>
                    <SortHeader label="Email" sortKey="email" />
                    <th className="text-left px-4 py-3 text-xs font-display font-semibold text-muted-foreground">Contact</th>
                    <th className="text-left px-4 py-3 text-xs font-display font-semibold text-muted-foreground">Role / Model</th>
                    <th className="text-left px-4 py-3 text-xs font-display font-semibold text-muted-foreground">Status</th>
                    <th className="px-2 py-3 w-20" />
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((actor, i) => (
                    <React.Fragment key={actor.id}>
                      {editingId === actor.id ? (
                        <tr>
                          <td colSpan={7} className="p-4 bg-muted/20 border-b border-border last:border-0">
                            <p className="text-xs font-display font-semibold text-muted-foreground uppercase tracking-wider mb-3">Edit Actor</p>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                              <div className="space-y-1">
                                <label className="text-xs font-medium text-muted-foreground">Name</label>
                                <input value={editName} onChange={e => setEditName(e.target.value)} className={inputCls} />
                              </div>
                              {actor.actor_type === 'human' && (
                                <>
                                  <div className="space-y-1">
                                    <label className="text-xs font-medium text-muted-foreground">Phone</label>
                                    <input value={editPhone} onChange={e => setEditPhone(e.target.value)} placeholder="+1 (555) 123-4567" className={inputCls} />
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-xs font-medium text-muted-foreground">Role</label>
                                    <select value={editRole} onChange={e => setEditRole(e.target.value)} className={`${inputCls} cursor-pointer`}>
                                      <option value="member">Member</option>
                                      <option value="admin">Admin</option>
                                      {currentUser?.role === 'owner' && <option value="owner">Owner</option>}
                                    </select>
                                  </div>
                                </>
                              )}
                            </div>
                            {actor.actor_type === 'human' && (
                              <ContactChannelsEditor channels={editChannels} onChange={setEditChannels} />
                            )}
                            <div className="flex gap-2 pt-3">
                              <button onClick={handleUpdate} disabled={updateActor.isPending}
                                className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors">
                                {updateActor.isPending ? 'Saving...' : 'Save Changes'}
                              </button>
                              <button onClick={() => setEditingId(null)}
                                className="px-3 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-semibold hover:bg-muted/80 transition-colors">
                                Cancel
                              </button>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        <>
                        <tr className={`border-b border-border last:border-0 hover:bg-primary/5 transition-colors group cursor-pointer ${i % 2 === 1 ? 'bg-surface-sunken/30' : ''}`}
                          onClick={() => toggleExpand(actor.id)}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <ActorAvatar actor={actor} />
                              <div>
                                <span className="font-semibold text-foreground">{actor.display_name}</span>
                                {actor.user_id && (
                                  <span className="ml-1.5 text-[10px] font-mono bg-muted text-muted-foreground px-1 py-0.5 rounded">auth</span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border capitalize ${typePillCls[actor.actor_type]}`}>
                              {actor.actor_type}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground text-xs">{actor.email || '—'}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-0.5">
                              {actor.phone && (
                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                  <Phone className="w-3 h-3" /> {actor.phone}
                                </span>
                              )}
                              {getContactChannels(actor.metadata).slice(0, 2).map((ch, ci) => (
                                <span key={ci} className="text-xs text-muted-foreground flex items-center gap-1">
                                  <MessageSquare className="w-3 h-3" /> {ch.channel_type}: {ch.handle}
                                </span>
                              ))}
                              {!actor.phone && getContactChannels(actor.metadata).length === 0 && (
                                <span className="text-xs text-muted-foreground/40">—</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {actor.actor_type === 'human' ? (
                              actor.role ? (
                                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${rolePillCls[actor.role] ?? rolePillCls.member}`}>
                                  {roleLabels[actor.role] ?? actor.role}
                                </span>
                              ) : <span className="text-xs text-muted-foreground/40">—</span>
                            ) : (
                              <div className="text-xs text-muted-foreground">
                                {actor.agent_identifier && <div className="font-mono">{actor.agent_identifier}</div>}
                                {actor.agent_model && <div className="text-muted-foreground/60">{actor.agent_model}</div>}
                                {!actor.agent_identifier && !actor.agent_model && '—'}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                              actor.is_active
                                ? 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30'
                                : 'bg-muted text-muted-foreground border-border'
                            }`}>
                              <CircleDot className="w-2.5 h-2.5" />
                              {actor.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="px-2 py-3" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center gap-1 justify-end">
                              <button onClick={() => toggleExpand(actor.id)}
                                className={`p-1.5 rounded-lg transition-colors ${
                                  expandedActorId === actor.id
                                    ? 'text-primary bg-primary/10'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                                }`}
                                title="Permissions & Keys">
                                <ChevronRight className={`w-3.5 h-3.5 transition-transform ${expandedActorId === actor.id ? 'rotate-90' : ''}`} />
                              </button>
                              <button onClick={() => startEdit(actor)}
                                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors opacity-0 group-hover:opacity-100"
                                title="Edit">
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => toggleActive(actor)}
                                className={`p-1.5 rounded-lg transition-colors opacity-0 group-hover:opacity-100 ${
                                  actor.is_active
                                    ? 'text-muted-foreground hover:text-destructive hover:bg-destructive/10'
                                    : 'text-muted-foreground hover:text-green-600 hover:bg-green-500/10'
                                }`}
                                title={actor.is_active ? 'Deactivate' : 'Activate'}>
                                {actor.is_active ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          </td>
                        </tr>
                        {/* Detail panel (permissions + API keys) */}
                        <AnimatePresence>
                          {expandedActorId === actor.id && (
                            <tr>
                              <td colSpan={7}>
                                <ActorDetailPanel actor={actor} onClose={() => setExpandedActorId(null)} />
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
            <PaginationBar page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={setPageSize} className="px-4" />
          </div>
        ) : (
          /* ── Card view ── */
          <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {paginated.map((actor, i) => (
              editingId === actor.id ? (
                <motion.div
                  key={actor.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className="col-span-full bg-card border border-border rounded-2xl p-4 space-y-4"
                >
                  <p className="text-xs font-display font-semibold text-muted-foreground uppercase tracking-wider">Edit Actor</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Name</label>
                      <input value={editName} onChange={e => setEditName(e.target.value)} className={inputCls} />
                    </div>
                    {actor.actor_type === 'human' && (
                      <>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">Phone</label>
                          <input value={editPhone} onChange={e => setEditPhone(e.target.value)} className={inputCls} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">Role</label>
                          <select value={editRole} onChange={e => setEditRole(e.target.value)} className={`${inputCls} cursor-pointer`}>
                            <option value="member">Member</option>
                            <option value="admin">Admin</option>
                            {currentUser?.role === 'owner' && <option value="owner">Owner</option>}
                          </select>
                        </div>
                      </>
                    )}
                  </div>
                  {actor.actor_type === 'human' && (
                    <ContactChannelsEditor channels={editChannels} onChange={setEditChannels} />
                  )}
                  <div className="flex gap-2 pt-1">
                    <button onClick={handleUpdate} disabled={updateActor.isPending}
                      className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors">
                      {updateActor.isPending ? 'Saving...' : 'Save Changes'}
                    </button>
                    <button onClick={() => setEditingId(null)}
                      className="px-3 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-semibold hover:bg-muted/80 transition-colors">
                      Cancel
                    </button>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key={actor.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
                  className={`bg-card border rounded-2xl p-4 hover:shadow-md transition-all group relative ${
                    actor.is_active ? 'border-border hover:border-primary/20' : 'border-border/50 opacity-60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <ActorAvatar actor={actor} size="lg" />
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="font-display font-bold text-foreground">{actor.display_name}</p>
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border capitalize ${typePillCls[actor.actor_type]}`}>
                            {actor.actor_type}
                          </span>
                          {actor.user_id && (
                            <span className="text-[10px] font-mono bg-muted text-muted-foreground px-1 py-0.5 rounded">auth</span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{actor.email || (actor.agent_identifier ?? 'No email')}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => toggleExpand(actor.id)}
                        className={`p-1.5 rounded-lg transition-colors ${
                          expandedActorId === actor.id
                            ? 'text-primary bg-primary/10'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                        }`}
                        title="Permissions & Keys">
                        <ChevronRight className={`w-3.5 h-3.5 transition-transform ${expandedActorId === actor.id ? 'rotate-90' : ''}`} />
                      </button>
                      <button onClick={() => startEdit(actor)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors md:opacity-0 md:group-hover:opacity-100">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => toggleActive(actor)}
                        className={`p-1.5 rounded-lg transition-colors md:opacity-0 md:group-hover:opacity-100 ${
                          actor.is_active ? 'text-muted-foreground hover:text-destructive hover:bg-destructive/10' : 'text-muted-foreground hover:text-green-600 hover:bg-green-500/10'
                        }`}>
                        {actor.is_active ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      {actor.actor_type === 'human' && actor.role && (
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${rolePillCls[actor.role] ?? rolePillCls.member}`}>
                          {roleLabels[actor.role] ?? actor.role}
                        </span>
                      )}
                      {actor.actor_type === 'agent' && actor.agent_model && (
                        <span className="text-[10px] font-mono text-muted-foreground">{actor.agent_model}</span>
                      )}
                      <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                        actor.is_active
                          ? 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30'
                          : 'bg-muted text-muted-foreground border-border'
                      }`}>
                        <CircleDot className="w-2.5 h-2.5" />
                        {actor.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    {actor.created_at && (
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(actor.created_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>

                  {/* Contact info */}
                  {(actor.phone || getContactChannels(actor.metadata).length > 0) && (
                    <div className="mt-2 pt-2 border-t border-border flex flex-wrap gap-x-3 gap-y-1">
                      {actor.phone && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Phone className="w-3 h-3" /> {actor.phone}
                        </span>
                      )}
                      {getContactChannels(actor.metadata).map((ch, ci) => (
                        <span key={ci} className="text-xs text-muted-foreground flex items-center gap-1">
                          <MessageSquare className="w-3 h-3" /> {ch.channel_type}: {ch.handle}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Detail panel (permissions + API keys) */}
                  <AnimatePresence>
                    {expandedActorId === actor.id && (
                      <div className="mt-3 -mx-4 -mb-4">
                        <ActorDetailPanel actor={actor} onClose={() => setExpandedActorId(null)} />
                      </div>
                    )}
                  </AnimatePresence>
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
