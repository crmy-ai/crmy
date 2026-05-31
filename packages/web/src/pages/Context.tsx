// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { TopBar } from '@/components/layout/TopBar';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, Bot, CalendarDays, CheckCircle2, FileText, GitBranch, LayoutGrid, Library, List, Mail, Network, Search, Sparkles } from 'lucide-react';
import { ContextBrowser } from '@/components/crm/ContextBrowser';
import { ContextLineageView } from '@/components/crm/ContextLineageView';
import { ObservationsDashboard } from '@/components/crm/ObservationsDashboard';
import { SignalGroupsBrowser } from '@/components/crm/SignalGroupsBrowser';
import { useActivities, useCalendarConnections, useContextEntries, useDbConfig, useMailboxConnections, useSignalGroups } from '@/api/hooks';
import { headerDescription } from '@/lib/headerCopy';
import { ENTITY_COLORS } from '@/lib/entityColors';
import { GraphTab } from './GraphExplorerPage';

type ContextTab = 'observations' | 'browser' | 'signals' | 'lineage' | 'sources' | 'graph';
type PrimaryContextTab = 'observations' | 'browser' | 'signals' | 'lineage';
type ViewMode = 'cards' | 'table';

function HeaderViewToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}) {
  return (
    <div className="hidden h-9 rounded-xl border border-border bg-muted p-0.5 md:inline-flex md:mr-2">
      <button
        type="button"
        onClick={() => onChange('cards')}
        className={`rounded-lg p-1.5 transition-all ${value === 'cards' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
        aria-label="Card view"
      >
        <LayoutGrid className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onChange('table')}
        className={`rounded-lg p-1.5 transition-all ${value === 'table' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
        aria-label="Table view"
      >
        <List className="h-4 w-4" />
      </button>
    </div>
  );
}

function SourcesTab() {
  const { data: mailboxData } = useMailboxConnections() as any;
  const { data: calendarData } = useCalendarConnections() as any;
  const mailboxConnections = mailboxData?.data ?? [];
  const calendarConnections = calendarData?.data ?? [];
  const mailboxConnected = mailboxConnections.some((connection: any) => connection.status === 'connected');
  const calendarConnected = calendarConnections.some((connection: any) => connection.status === 'connected');

  const featuredCards = [
    {
      title: 'Add Context',
      Icon: FileText,
      color: ENTITY_COLORS.context,
      status: 'Best for notes, transcripts, and one-off source material',
      description: 'Paste or upload customer context you already have. CRMy links it to records, extracts Signals, and creates Memory when the evidence is ready.',
      primary: 'Add Context',
      primaryHref: '/context?tab=observations&add=context',
      primaryClassName: 'bg-[#0ea5e9] text-white hover:bg-[#0ea5e9]/90',
      secondary: 'View Raw Context',
      secondaryHref: '/context?tab=observations',
    },
    {
      title: 'MCP / API',
      Icon: Bot,
      color: ENTITY_COLORS.agents,
      status: 'Best for external agents and scripts',
      description: 'Use context_ingest_auto to send customer context into CRMy, then briefing_get to retrieve trusted Memory before an agent acts.',
      primary: 'Manage API Keys',
      primaryHref: '/settings/api-keys',
      primaryClassName: 'bg-[#6366f1] text-white hover:bg-[#6366f1]/90',
      secondary: 'View Memory',
      secondaryHref: '/context?tab=browser',
    },
  ];

  const connectedCards = [
    {
      title: 'Customer Email',
      Icon: Mail,
      color: ENTITY_COLORS.emails,
      status: mailboxConnected ? 'Connected' : 'Optional source',
      description: 'Connect a mailbox when you want customer threads matched to customer records automatically. Email is optional; pasted emails and MCP ingestion use the same context engine.',
      primary: 'Open Customer Email',
      primaryHref: '/emails',
      secondary: mailboxConnected ? 'Review connections' : 'Connect mailbox',
      secondaryHref: '/emails?tab=connections',
    },
    {
      title: 'Customer Activity',
      Icon: CalendarDays,
      color: ENTITY_COLORS.activities,
      status: calendarConnected ? 'Connected' : 'Optional source',
      description: 'Connect a calendar when you want meetings tracked and flagged for missing notes or transcripts. Meeting debriefs can still be added manually.',
      primary: 'Open Customer Activity',
      primaryHref: '/activities',
      secondary: calendarConnected ? 'Review connections' : 'Connect calendar',
      secondaryHref: '/activities?tab=connections',
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6">
      <div className="mb-5 max-w-3xl">
        <h2 className="text-lg font-display font-semibold text-foreground">Context Sources</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose how customer context enters CRMy. Every source feeds the same loop: Raw Context becomes Signals, trusted Signals become Memory, and agents retrieve Memory before acting.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {featuredCards.map(({ title, Icon, color, status, description, primary, primaryHref, primaryClassName, secondary, secondaryHref }) => (
          <section key={title} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${color.bg}`}>
                  <Icon className={`h-5 w-5 ${color.text}`} />
                </span>
                <div>
                  <h3 className="font-display text-sm font-semibold text-foreground">{title}</h3>
                  <p className="text-xs text-muted-foreground">{status}</p>
                </div>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">{description}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link to={primaryHref} className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors ${primaryClassName}`}>
                {primary}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              <Link to={secondaryHref} className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted">
                {secondary}
              </Link>
            </div>
          </section>
        ))}
      </div>
      <div className="mt-6">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-foreground">Optional connected sources</h3>
          <p className="mt-1 text-sm text-muted-foreground">Email and calendar work differently, so each has its own setup, filters, and review workflow.</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {connectedCards.map(({ title, Icon, color, status, description, primary, primaryHref, secondary, secondaryHref }) => (
            <section key={title} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-3">
                <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${color.bg}`}>
                  <Icon className={`h-5 w-5 ${color.text}`} />
                </span>
                <div>
                  <h3 className="font-display text-sm font-semibold text-foreground">{title}</h3>
                  <p className="text-xs text-muted-foreground">{status}</p>
                </div>
              </div>
              <p className="mt-4 text-sm leading-6 text-muted-foreground">{description}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link to={primaryHref} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted">
                  {primary}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <Link to={secondaryHref} className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  {secondary}
                </Link>
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ContextPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [signalViewMode, setSignalViewMode] = useState<ViewMode>('cards');
  const [memoryViewMode, setMemoryViewMode] = useState<ViewMode>('cards');
  const rawTab = searchParams.get('tab');
  const normalizedTab = rawTab === 'signal-groups' ? 'signals' : rawTab === 'governance' ? 'browser' : rawTab ?? 'observations';
  const tab: ContextTab = ['observations', 'browser', 'signals', 'lineage', 'sources', 'graph'].includes(normalizedTab)
    ? (normalizedTab as ContextTab)
    : 'observations';
  const { data: dbInfo } = useDbConfig() as any;
  const { data: contextData } = useContextEntries({ limit: 1 }) as any;
  const { data: signalGroupData } = useSignalGroups({ attention_only: true, limit: 1 }) as any;
  const { data: activitiesData } = useActivities({ limit: 1 }) as any;
  const semanticRetrievalReady = Boolean(dbInfo?.ready ?? dbInfo?.pgvector_enabled);
  const contextTotal = Number(contextData?.total ?? 0);
  const signalGroupTotal = Number(signalGroupData?.total ?? 0);
  const observationTotal = Number(activitiesData?.total ?? 0);

  const setTab = (nextTab: ContextTab) => {
    const existing = Object.fromEntries(searchParams.entries());
    setSearchParams({ ...existing, tab: nextTab });
  };

  const openAddContext = () => {
    const existing = Object.fromEntries(searchParams.entries());
    setSearchParams({ ...existing, tab: 'observations', add: 'context' });
  };

  const tabs: { key: PrimaryContextTab; label: string; Icon: typeof Library; activeBorder: string }[] = [
    { key: 'observations', label: 'Raw Context', Icon: FileText, activeBorder: 'border-[#0ea5e9]' },
    { key: 'signals', label: 'Signals', Icon: Sparkles, activeBorder: 'border-violet-500' },
    { key: 'browser', label: 'Memory', Icon: Library, activeBorder: 'border-emerald-500' },
    { key: 'lineage', label: 'Lineage', Icon: GitBranch, activeBorder: 'border-destructive' },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar
        title="Context"
        icon={Library}
        iconClassName="text-[#0ea5e9]"
        description={tab === 'observations'
          ? headerDescription('Review source volume and processing outcomes', observationTotal, 'source', 'sources')
          : tab === 'signals'
          ? headerDescription('Review inferred customer context before it becomes Memory', signalGroupTotal, 'signal', 'signals')
          : tab === 'lineage'
          ? 'Trace source material into Memory and the actions it informed.'
          : tab === 'sources'
          ? 'Choose how customer context enters CRMy.'
          : tab === 'graph'
          ? 'Explore related records, Current Memory, recent activity, and open handoffs.'
          : headerDescription('Search persistent Memory agents retrieve into Active Context', contextTotal, 'entry', 'entries')}
        badge={(
          <span className={`hidden md:inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
            semanticRetrievalReady
              ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400'
          }`}>
            {semanticRetrievalReady ? <CheckCircle2 className="w-3 h-3" /> : <Search className="w-3 h-3" />}
            {semanticRetrievalReady ? 'Semantic search ready' : 'Keyword fallback'}
          </span>
        )}
      >
        {tab === 'signals' && <HeaderViewToggle value={signalViewMode} onChange={setSignalViewMode} />}
        {tab === 'browser' && <HeaderViewToggle value={memoryViewMode} onChange={setMemoryViewMode} />}
      </TopBar>

      <div className="flex items-center gap-2 overflow-x-auto px-4 md:px-6 pt-4 border-b border-border pb-0">
        <div className="flex min-w-max items-center gap-1">
          {tabs.map(({ key, label, Icon, activeBorder }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex flex-shrink-0 items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === key
                  ? `${activeBorder} text-foreground`
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex min-w-max items-center gap-2 pb-2">
          <button
            type="button"
            onClick={() => setTab('sources')}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors ${
              tab === 'sources'
                ? 'border-primary/30 bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <FileText className="h-3.5 w-3.5" />
            Context Sources
          </button>
          <button
            type="button"
            onClick={() => setTab('graph')}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors ${
              tab === 'graph'
                ? 'border-primary/30 bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <Network className="h-3.5 w-3.5" />
            Graph
          </button>
        </div>
      </div>

      {tab === 'observations'
        ? (
          <>
            <ObservationsDashboard onAddContext={openAddContext} />
            <ContextBrowser drawerOnly />
          </>
        )
        : tab === 'signals'
        ? <SignalGroupsBrowser viewMode={signalViewMode} />
        : tab === 'lineage'
        ? <ContextLineageView />
        : tab === 'sources'
        ? <SourcesTab />
        : tab === 'graph'
        ? <GraphTab />
        : <ContextBrowser memoryStatus="active" allowAddContext={false} viewMode={memoryViewMode} />}
    </div>
  );
}
