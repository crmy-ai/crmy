// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { TopBar } from '@/components/layout/TopBar';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, Library, Search, ShieldCheck } from 'lucide-react';
import { ContextBrowser } from '@/components/crm/ContextBrowser';
import { ContextGovernance } from '@/components/crm/ContextGovernance';
import { useContextEntries, useDbConfig } from '@/api/hooks';
import { headerDescription } from '@/lib/headerCopy';

type ContextTab = 'browser' | 'governance';

export default function ContextPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get('tab') ?? 'browser') as ContextTab;
  const { data: dbInfo } = useDbConfig() as any;
  const { data: contextData } = useContextEntries({ limit: 1 }) as any;
  const { data: staleData } = useContextEntries({ is_current: false, limit: 200 }) as any;
  const pgvectorEnabled = Boolean(dbInfo?.pgvector_enabled);
  const contextTotal = Number(contextData?.total ?? 0);
  const staleCount = Number(staleData?.data?.length ?? 0);

  const setTab = (nextTab: ContextTab) => {
    const existing = Object.fromEntries(searchParams.entries());
    setSearchParams({ ...existing, tab: nextTab });
  };

  const tabs: { key: ContextTab; label: string; Icon: typeof Library }[] = [
    { key: 'browser', label: 'Memory Browser', Icon: Library },
    { key: 'governance', label: 'Governance', Icon: ShieldCheck },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar
        title="Context"
        icon={Library}
        iconClassName="text-[#0ea5e9]"
        description={tab === 'governance'
          ? headerDescription('Review stale memory and quality', staleCount, 'entry', 'entries')
          : headerDescription('Search customer memory and notes', contextTotal, 'entry', 'entries')}
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
      />

      <div className="flex items-center gap-1 px-4 md:px-6 pt-4 border-b border-border pb-0">
        {tabs.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'governance' ? <ContextGovernance /> : <ContextBrowser />}
    </div>
  );
}
