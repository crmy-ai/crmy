// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { TopBar } from '@/components/layout/TopBar';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, FileText, GitBranch, LayoutGrid, Library, List, Network, Search, Sparkles } from 'lucide-react';
import { ContextBrowser } from '@/components/crm/ContextBrowser';
import { ContextLineageView } from '@/components/crm/ContextLineageView';
import { ObservationsDashboard } from '@/components/crm/ObservationsDashboard';
import { SignalGroupsBrowser } from '@/components/crm/SignalGroupsBrowser';
import { useActivities, useContextEntries, useDbConfig, useSignalGroups } from '@/api/hooks';
import { headerDescription } from '@/lib/headerCopy';
import { GraphTab } from './GraphExplorerPage';

type ContextTab = 'observations' | 'browser' | 'signals' | 'graph' | 'lineage';
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

export default function ContextPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [signalViewMode, setSignalViewMode] = useState<ViewMode>('cards');
  const [memoryViewMode, setMemoryViewMode] = useState<ViewMode>('cards');
  const rawTab = searchParams.get('tab');
  const normalizedTab = rawTab === 'signal-groups' ? 'signals' : rawTab === 'governance' ? 'browser' : rawTab ?? 'browser';
  const tab: ContextTab = ['observations', 'browser', 'signals', 'graph', 'lineage'].includes(normalizedTab)
    ? (normalizedTab as ContextTab)
    : 'browser';
  const { data: dbInfo } = useDbConfig() as any;
  const { data: contextData } = useContextEntries({ limit: 1 }) as any;
  const { data: signalGroupData } = useSignalGroups({ attention_only: true, limit: 1 }) as any;
  const { data: activitiesData } = useActivities({ limit: 1 }) as any;
  const pgvectorEnabled = Boolean(dbInfo?.pgvector_enabled);
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

  const tabs: { key: ContextTab; label: string; Icon: typeof Library; activeBorder: string }[] = [
    { key: 'observations', label: 'Raw Context', Icon: FileText, activeBorder: 'border-[#0ea5e9]' },
    { key: 'signals', label: 'Signals', Icon: Sparkles, activeBorder: 'border-violet-500' },
    { key: 'browser', label: 'Memory', Icon: Library, activeBorder: 'border-emerald-500' },
    { key: 'graph', label: 'Graph', Icon: Network, activeBorder: 'border-[#0ea5e9]' },
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
          : tab === 'graph'
          ? 'Explore related records, Current Memory, recent activity, and open handoffs.'
          : tab === 'lineage'
          ? 'Trace source material into Memory and the actions it informed.'
          : headerDescription('Search persistent Memory agents retrieve into Active Context', contextTotal, 'entry', 'entries')}
        badge={(
          <span className={`hidden md:inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
            pgvectorEnabled
              ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400'
          }`}>
            {pgvectorEnabled ? <CheckCircle2 className="w-3 h-3" /> : <Search className="w-3 h-3" />}
            {pgvectorEnabled ? 'Semantic search ready' : 'Keyword search fallback'}
          </span>
        )}
      >
        {tab === 'signals' && <HeaderViewToggle value={signalViewMode} onChange={setSignalViewMode} />}
        {tab === 'browser' && <HeaderViewToggle value={memoryViewMode} onChange={setMemoryViewMode} />}
      </TopBar>

      <div className="flex items-center gap-1 overflow-x-auto px-4 md:px-6 pt-4 border-b border-border pb-0">
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

      {tab === 'observations'
        ? (
          <>
            <ObservationsDashboard onAddContext={openAddContext} />
            <ContextBrowser drawerOnly />
          </>
        )
        : tab === 'signals'
        ? <SignalGroupsBrowser viewMode={signalViewMode} />
        : tab === 'graph'
        ? <GraphTab />
        : tab === 'lineage'
        ? <ContextLineageView />
        : <ContextBrowser memoryStatus="active" allowAddContext={false} viewMode={memoryViewMode} />}
    </div>
  );
}
