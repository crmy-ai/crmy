// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, Briefcase, LayoutDashboard, FolderKanban, Activity, Settings, Search,
  Building2, BookOpen, ClipboardList, Plus, Database, Bot, Mail,
  ScrollText, ShieldCheck, Network, KeyRound, Tags, Palette,
  Webhook, Sparkles, Loader2, FileText, Server, type LucideIcon,
} from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { getUser } from '@/api/client';
import { cn, formatCompactCurrency } from '@/lib/utils';
import { useSearch } from '@/api/hooks';
import { useIsMobile } from '@/hooks/use-mobile';
import { ENTITY_COLORS } from '@/lib/entityColors';

type Tone = { text: string; bg: string; bar: string };

interface DestinationCommand {
  label: string;
  description?: string;
  path: string;
  icon: LucideIcon;
  color?: Tone | null;
  keywords: string;
  roles?: Array<'member' | 'manager' | 'admin' | 'owner'>;
}

interface ActionCommand {
  label: string;
  description?: string;
  icon: LucideIcon;
  color: Tone;
  keywords: string;
  run: () => void;
  roles?: Array<'member' | 'manager' | 'admin' | 'owner'>;
}

const DESTINATIONS: DestinationCommand[] = [
  { label: 'Overview',        icon: LayoutDashboard, path: '/',                         color: ENTITY_COLORS.dashboard, keywords: 'dashboard command center status activate setup home' },
  { label: 'Context',         icon: FileText,        path: '/context',                  color: ENTITY_COLORS.context, keywords: 'sources ingestion processing volume signals memory browser context entries customer memory lineage graph' },
  { label: 'Signals',         icon: Sparkles,        path: '/context?tab=signals',      color: ENTITY_COLORS.context, keywords: 'signals inferred context review promote dismiss evidence confidence' },
  { label: 'Memory',          icon: FileText,        path: '/context?tab=browser',      color: ENTITY_COLORS.context, keywords: 'memory confirmed context operational knowledge evidence' },
  { label: 'Context Connectors', icon: Activity,      path: '/context?tab=connectors',   color: ENTITY_COLORS.context, keywords: 'connectors sources email activity meetings calls mailbox calendar mcp api add context' },
  { label: 'Knowledge',        icon: BookOpen,        path: '/knowledge',                color: ENTITY_COLORS.knowledge, keywords: 'knowledge trusted facts company product competitor approved grounded cite briefing drafts', roles: ['admin', 'owner'] },
  { label: 'Memory Health',   icon: ShieldCheck,     path: '/?tab=health',              color: ENTITY_COLORS.context, keywords: 'memory health review contradictions context quality', roles: ['admin', 'owner'] },
  { label: 'Context Graph',   icon: Network,         path: '/context?tab=graph',        color: ENTITY_COLORS.context, keywords: 'graph context memory relationships briefing network' },
  { label: 'Memory Lineage',  icon: Network,         path: '/context?tab=lineage',      color: ENTITY_COLORS.context, keywords: 'lineage evidence sources signals memory handoffs writebacks audit' },
  { label: 'Workspace Agent', icon: Bot,             path: '/agent',                    color: ENTITY_COLORS.agents, keywords: 'agent chat local model workspace reasoning' },
  { label: 'Agent Activity',  icon: Activity,        path: '/agent/activity',           color: ENTITY_COLORS.agents, keywords: 'agent activity tools mcp traces latency errors', roles: ['admin', 'owner'] },
  { label: 'Contacts',        icon: Users,           path: '/contacts',                 color: ENTITY_COLORS.contacts, keywords: 'people leads customers contacts' },
  { label: 'Accounts',        icon: Building2,       path: '/accounts',                 color: ENTITY_COLORS.accounts, keywords: 'accounts companies organizations domains' },
  { label: 'Opportunities',   icon: Briefcase,       path: '/opportunities',            color: ENTITY_COLORS.opportunities, keywords: 'deals pipeline revenue opportunities' },
  { label: 'Use Cases',       icon: FolderKanban,    path: '/use-cases',                color: ENTITY_COLORS.useCases, keywords: 'deployments products use cases outcomes' },
  { label: 'Customer Activity Source', icon: Activity, path: '/activities',             color: ENTITY_COLORS.activities, keywords: 'calls notes meetings timeline activities calendar context source' },
  { label: 'Customer Email Source', icon: Mail,       path: '/emails',                  color: ENTITY_COLORS.emails, keywords: 'email inbox outbound inbound drafts approvals mailbox context source' },
  { label: 'Advanced Settings', icon: Settings,       path: '/settings/advanced',       color: null, keywords: 'advanced experimental event bus webhooks', roles: ['admin', 'owner'] },
  { label: 'Handoffs',        icon: ClipboardList,   path: '/handoffs',                 color: ENTITY_COLORS.assignments, keywords: 'hitl approvals inbox assignments handoffs human review' },
  { label: 'Reliability',     icon: Database,        path: '/operations',               color: ENTITY_COLORS.operations, keywords: 'operations reliability health data quality system status', roles: ['admin', 'owner'] },
  { label: 'Audit Log',       icon: ScrollText,      path: '/audit-log',                color: ENTITY_COLORS.auditLog, keywords: 'audit events history trail changes', roles: ['admin', 'owner'] },
  { label: 'Settings',        icon: Settings,        path: '/settings',                 color: null, keywords: 'settings profile account' },
  { label: 'Actors',          icon: Users,           path: '/settings/actors',          color: ENTITY_COLORS.agents, keywords: 'actors users agents scopes invites passwords api keys', roles: ['admin', 'owner'] },
  { label: 'Database Settings', icon: Database,      path: '/settings/database',        color: ENTITY_COLORS.operations, keywords: 'database postgres neon supabase rds lakebase pgvector sample data', roles: ['admin', 'owner'] },
  { label: 'Model Settings',  icon: Sparkles,        path: '/settings/model',           color: ENTITY_COLORS.agents, keywords: 'model local workspace agent llm openai anthropic azure gemini bedrock mistral litellm openrouter ollama databricks nvidia backup provider', roles: ['admin', 'owner'] },
  { label: 'Systems of Record', icon: Server,        path: '/settings/systems',         color: ENTITY_COLORS.operations, keywords: 'systems of record hubspot salesforce snowflake databricks connectors sync mappings writebacks external systems', roles: ['admin', 'owner'] },
  { label: 'Knowledge Sources', icon: BookOpen,      path: '/settings/knowledge-sources', color: ENTITY_COLORS.knowledge, keywords: 'knowledge sources mcp connectors trusted facts setup', roles: ['admin', 'owner'] },
  { label: 'Appearance',      icon: Palette,         path: '/settings/appearance',      color: null, keywords: 'appearance theme charcoal color display' },
  { label: 'API Keys',        icon: KeyRound,        path: '/settings/api-keys',        color: null, keywords: 'api keys tokens access' },
  { label: 'Webhooks',        icon: Webhook,         path: '/settings/webhooks',        color: null, keywords: 'webhooks integrations outbound events advanced', roles: ['admin', 'owner'] },
  { label: 'Custom Fields',   icon: Tags,            path: '/settings/custom-fields',   color: null, keywords: 'custom fields record fields schema typed memory fields', roles: ['admin', 'owner'] },
  { label: 'Registries',      icon: Tags,            path: '/settings/registries',      color: null, keywords: 'registries activity types context types taxonomy', roles: ['admin', 'owner'] },
  { label: 'Context Connectors', icon: Server,        path: '/settings/connections',     color: null, keywords: 'context connectors messaging email provider smtp resend sendgrid oauth calendar mailbox', roles: ['admin', 'owner'] },
  { label: 'Action Policies', icon: ShieldCheck,     path: '/settings/hitl-rules',      color: ENTITY_COLORS.assignments, keywords: 'hitl rules approval handoff policy action policies', roles: ['admin', 'owner'] },
];

function canUseCommand<T extends { roles?: Array<'member' | 'manager' | 'admin' | 'owner'> }>(command: T, role: string): boolean {
  return !command.roles || command.roles.includes(role as 'member' | 'manager' | 'admin' | 'owner');
}

function useDebouncedValue(value: string, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timeout);
  }, [value, delayMs]);
  return debounced;
}

function includesQuery(query: string, ...parts: Array<unknown>) {
  if (!query) return true;
  return parts.filter(Boolean).join(' ').toLowerCase().includes(query);
}

function contactName(c: any) {
  return (c.name ?? [c.first_name, c.last_name].filter(Boolean).join(' ') ?? c.email ?? 'Unnamed contact') as string;
}

function contactCompany(c: any) {
  return (c.company ?? c.company_name ?? c.account_name ?? '') as string;
}

function accountName(a: any) {
  return (a.name ?? a.domain ?? 'Unnamed account') as string;
}

function opportunityName(o: any) {
  return (o.name ?? 'Unnamed opportunity') as string;
}

function useCaseName(u: any) {
  return (u.name ?? 'Unnamed use case') as string;
}

export function CommandPalette() {
  const { commandPaletteOpen, setCommandPaletteOpen, openDrawer, openQuickAdd } = useAppStore();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();
  const user = getUser();
  const role = user?.role ?? 'member';
  const isAdmin = role === 'admin' || role === 'owner';
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const searchQuery = useDebouncedValue(query.trim(), 180);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: searchResults, isFetching } = useSearch(searchQuery) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contacts: any[]     = searchResults?.contacts     ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accounts: any[]     = searchResults?.accounts     ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opportunities: any[] = searchResults?.opportunities ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activities: any[]   = searchResults?.activities   ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const useCases: any[]     = searchResults?.useCases     ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const assignments: any[]  = searchResults?.assignments  ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contextEntries: any[] = searchResults?.contextEntries ?? [];

  const actions: ActionCommand[] = useMemo(() => [
    { label: 'New Contact',     icon: Plus, color: ENTITY_COLORS.contacts,      keywords: 'create add person lead contact', run: () => openQuickAdd('contact') },
    { label: 'New Account',     icon: Plus, color: ENTITY_COLORS.accounts,      keywords: 'create add account company organization', run: () => openQuickAdd('account') },
    { label: 'New Opportunity', icon: Plus, color: ENTITY_COLORS.opportunities, keywords: 'create add deal pipeline opportunity', run: () => openQuickAdd('opportunity') },
    { label: 'New Use Case',    icon: Plus, color: ENTITY_COLORS.useCases,      keywords: 'create add use case deployment', run: () => openQuickAdd('use-case') },
    { label: 'Log Activity',    icon: Plus, color: ENTITY_COLORS.activities,    keywords: 'create add log call note meeting activity', run: () => openQuickAdd('activity') },
    { label: 'New Handoff',     icon: Plus, color: ENTITY_COLORS.assignments,   keywords: 'create add handoff task assignment', run: () => openQuickAdd('assignment') },
  ], [openQuickAdd]);

  const matchedDestinations = useMemo(() => {
    const results = DESTINATIONS
      .filter(destination => canUseCommand(destination, role))
      .filter(destination => includesQuery(normalizedQuery, destination.label, destination.description, destination.keywords));
    return (normalizedQuery ? results : results.slice(0, 10));
  }, [normalizedQuery, role]);

  const matchedActions = useMemo(() => {
    const results = actions
      .filter(action => canUseCommand(action, role))
      .filter(action => includesQuery(normalizedQuery, action.label, action.description, action.keywords));
    return (normalizedQuery ? results : results.slice(0, 6));
  }, [actions, normalizedQuery, role]);

  useEffect(() => {
    if (commandPaletteOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
    }
  }, [commandPaletteOpen]);

  const runAction = (fn: () => void) => {
    fn();
    setCommandPaletteOpen(false);
  };

  const itemClass = cn(
    'flex items-center gap-3 px-2 py-2 rounded-md text-sm text-foreground cursor-pointer',
    'data-[selected=true]:bg-primary/15 data-[selected=true]:text-primary',
    isMobile && 'py-3 px-3'
  );

  const commandContent = (
    <Command className="bg-card border-x border-border shadow-2xl overflow-hidden" shouldFilter={false}>
      <div className="flex items-center gap-2 px-4 border-b border-border">
        <Search className="w-4 h-4 text-muted-foreground" />
        <Command.Input
          ref={inputRef}
          value={query}
          onValueChange={setQuery}
          placeholder="Jump to any record, setting, or action..."
          className="flex-1 py-3 text-sm bg-transparent text-foreground placeholder:text-muted-foreground outline-none"
        />
      </div>
      <Command.List className="max-h-[60vh] overflow-y-auto p-2">
        <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
          {isFetching ? 'Searching...' : 'No results found.'}
        </Command.Empty>

        {matchedDestinations.length > 0 && (
          <Command.Group heading={normalizedQuery ? 'Destinations' : 'Pages & Settings'} className="text-xs text-muted-foreground px-2 py-1.5 font-display">
            {matchedDestinations.slice(0, normalizedQuery ? 8 : 10).map((page) => (
              <Command.Item
                key={page.path}
                value={`${page.label} ${page.keywords}`}
                onSelect={() => runAction(() => navigate(page.path))}
                className={itemClass}
              >
                <page.icon className={cn('w-4 h-4', page.color?.text ?? 'text-muted-foreground')} />
                <span>{page.label}</span>
                {page.description && <span className="ml-auto text-xs text-muted-foreground">{page.description}</span>}
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {matchedActions.length > 0 && (
          <Command.Group heading="Actions" className="text-xs text-muted-foreground px-2 py-1.5 font-display">
            {matchedActions.slice(0, normalizedQuery ? 6 : 8).map((action) => (
              <Command.Item
                key={action.label}
                value={`${action.label} ${action.keywords}`}
                onSelect={() => runAction(action.run)}
                className={itemClass}
              >
                <span className={cn('w-5 h-5 rounded-full flex items-center justify-center shrink-0', action.color.bg)}>
                  <action.icon className={cn('w-3 h-3', action.color.text)} />
                </span>
                <span>{action.label}</span>
                {action.description && <span className="ml-auto text-xs text-muted-foreground">{action.description}</span>}
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {query.trim().length >= 2 && isFetching && (
          <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Searching records...
          </div>
        )}

        {contacts.length > 0 && (
          <Command.Group heading="Contacts" className="text-xs text-muted-foreground px-2 py-1.5 font-display">
            {contacts.slice(0, 5).map((c) => (
              <Command.Item
                key={c.id as string}
                value={`${contactName(c)} ${contactCompany(c)} ${c.email ?? ''} ${c.phone ?? ''}`}
                onSelect={() => runAction(() => { navigate('/contacts'); openDrawer('contact', c.id as string); })}
                className={itemClass}
              >
                <Users className={cn('h-4 w-4 flex-shrink-0', ENTITY_COLORS.contacts.text)} />
                <span>{contactName(c)}</span>
                {contactCompany(c) && <span className="text-muted-foreground text-xs">— {contactCompany(c)}</span>}
                {c.lifecycle_stage && <span className="ml-auto text-xs text-muted-foreground">{c.lifecycle_stage as string}</span>}
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {accounts.length > 0 && (
          <Command.Group heading="Accounts" className="text-xs text-muted-foreground px-2 py-1.5 font-display">
            {accounts.slice(0, 5).map((a) => (
              <Command.Item
                key={a.id as string}
                value={`${accountName(a)} ${a.domain ?? ''} ${a.industry ?? ''}`}
                onSelect={() => runAction(() => { navigate('/accounts'); openDrawer('account', a.id as string); })}
                className={itemClass}
              >
                <Building2 className={cn('w-4 h-4', ENTITY_COLORS.accounts.text)} />
                <span>{accountName(a)}</span>
                {a.domain && <span className="text-muted-foreground text-xs">— {a.domain as string}</span>}
                {a.health_score != null && <span className="ml-auto text-xs text-muted-foreground">Health {a.health_score as number}</span>}
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {opportunities.length > 0 && (
          <Command.Group heading="Opportunities" className="text-xs text-muted-foreground px-2 py-1.5 font-display">
            {opportunities.slice(0, 5).map((d) => (
              <Command.Item
                key={d.id as string}
                value={`${opportunityName(d)} ${d.contact_name ?? ''} ${d.stage ?? ''}`}
                onSelect={() => runAction(() => { navigate('/opportunities'); openDrawer('opportunity', d.id as string); })}
                className={itemClass}
              >
                <Briefcase className={cn('w-4 h-4', ENTITY_COLORS.opportunities.text)} />
                <span>{opportunityName(d)}</span>
                {d.stage && <span className="text-muted-foreground text-xs">— {d.stage as string}</span>}
                {d.amount && (
                  <span className="text-muted-foreground text-xs ml-auto">
                    {formatCompactCurrency(Number(d.amount))}
                  </span>
                )}
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {activities.length > 0 && (
          <Command.Group heading="Activities" className="text-xs text-muted-foreground px-2 py-1.5 font-display">
            {activities.slice(0, 5).map((a) => (
              <Command.Item
                key={a.id as string}
                value={`${a.subject ?? ''} ${a.body ?? ''} ${a.activity_type ?? a.type ?? ''}`}
                onSelect={() => runAction(() => navigate('/activities'))}
                className={itemClass}
              >
                <Activity className={cn('w-4 h-4', ENTITY_COLORS.activities.text)} />
                <span className="truncate">{((a.subject as string) || (a.body as string) || 'Activity').slice(0, 60)}</span>
                {(a.activity_type || a.type) && <span className="ml-auto text-xs text-muted-foreground">{(a.activity_type ?? a.type) as string}</span>}
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {useCases.length > 0 && (
          <Command.Group heading="Use Cases" className="text-xs text-muted-foreground px-2 py-1.5 font-display">
            {useCases.slice(0, 5).map((u) => (
              <Command.Item
                key={u.id as string}
                value={`${useCaseName(u)} ${u.description ?? ''} ${u.stage ?? ''}`}
                onSelect={() => runAction(() => { navigate('/use-cases'); openDrawer('use-case', u.id as string); })}
                className={itemClass}
              >
                <FolderKanban className={cn('w-4 h-4', ENTITY_COLORS.useCases.text)} />
                <span>{useCaseName(u)}</span>
                {u.stage && <span className="ml-auto text-xs text-muted-foreground">{u.stage as string}</span>}
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {assignments.length > 0 && (
          <Command.Group heading="Handoffs" className="text-xs text-muted-foreground px-2 py-1.5 font-display">
            {assignments.slice(0, 5).map((a) => (
              <Command.Item
                key={a.id as string}
                value={`${a.title ?? ''} ${a.description ?? ''} ${a.assignment_type ?? ''} ${a.status ?? ''} ${a.priority ?? ''}`}
                onSelect={() => runAction(() => { navigate('/handoffs'); openDrawer('assignment', a.id as string); })}
                className={itemClass}
              >
                <ClipboardList className={cn('w-4 h-4', ENTITY_COLORS.assignments.text)} />
                <span className="truncate">{(a.title as string) || 'Handoff'}</span>
                {a.status && <span className="ml-auto text-xs text-muted-foreground">{a.status as string}</span>}
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {contextEntries.length > 0 && (
          <Command.Group heading="Signals & Memory" className="text-xs text-muted-foreground px-2 py-1.5 font-display">
            {contextEntries.slice(0, 5).map((entry) => (
              <Command.Item
                key={entry.id as string}
                value={`${entry.title ?? ''} ${entry.body ?? ''} ${entry.context_type ?? ''} ${entry.subject_type ?? ''}`}
                onSelect={() => runAction(() => navigate(entry.memory_status === 'signal' ? '/context?tab=signals' : '/context?tab=browser'))}
                className={itemClass}
              >
                <FileText className={cn('w-4 h-4', ENTITY_COLORS.context.text)} />
                <span className="truncate">{((entry.title as string) || (entry.body as string) || 'Context entry').slice(0, 64)}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {entry.memory_status === 'signal' ? 'Signal' : 'Memory'}
                  {entry.context_type ? ` · ${entry.context_type as string}` : ''}
                </span>
              </Command.Item>
            ))}
          </Command.Group>
        )}

      </Command.List>
      {!isMobile && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-border text-xs text-muted-foreground">
          <span>Navigate with ↑↓ · Select with ↵</span>
          <span>ESC to close</span>
        </div>
      )}
    </Command>
  );

  return (
    <AnimatePresence>
      {commandPaletteOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm"
            onClick={() => setCommandPaletteOpen(false)}
          />
          {isMobile ? (
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed left-0 right-0 bottom-0 z-[70] flex flex-col max-h-[85vh]"
            >
              <div className="flex justify-center py-2 bg-card rounded-t-2xl border-t border-x border-border">
                <div className="w-10 h-1 rounded-full bg-muted-foreground/20" />
              </div>
              {commandContent}
            </motion.div>
          ) : (
            <div className="fixed inset-0 z-[70] flex items-center justify-center px-4 pointer-events-none">
              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.15 }}
                className="w-full max-w-2xl pointer-events-auto"
              >
                <div className="rounded-2xl overflow-hidden border border-border shadow-2xl">
                  {commandContent}
                </div>
              </motion.div>
            </div>
          )}
        </>
      )}
    </AnimatePresence>
  );
}
