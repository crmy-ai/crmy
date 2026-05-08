// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useSearchParams } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { Zap, ListOrdered } from 'lucide-react';
import WorkflowsPage from './Workflows';
import SequencesPage from './Sequences';
import { useWorkflows, useSequences } from '@/api/hooks';
import { headerDescription } from '@/lib/headerCopy';

type AutomationsTab = 'triggers' | 'sequences';

export default function AutomationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get('tab') ?? 'triggers') as AutomationsTab;
  const { data: workflowData } = useWorkflows({ limit: 200 }) as any;
  const { data: sequenceData } = useSequences({ limit: 200 }) as any;
  const triggerCount = (workflowData?.data ?? workflowData?.workflows ?? []).length;
  const sequenceCount = (sequenceData?.data ?? sequenceData?.sequences ?? []).length;

  const setTab = (t: AutomationsTab) => {
    const existing = Object.fromEntries(searchParams.entries());
    setSearchParams({ ...existing, tab: t });
  };

  const TABS: { key: AutomationsTab; label: string; Icon: typeof Zap }[] = [
    { key: 'triggers',  label: 'Triggers',  Icon: Zap },
    { key: 'sequences', label: 'Sequences', Icon: ListOrdered },
  ];

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Automations"
        icon={Zap}
        iconClassName="text-amber-500"
        description={tab === 'triggers'
          ? headerDescription('Run actions when events happen', triggerCount, 'trigger')
          : headerDescription('Manage multi-step outreach', sequenceCount, 'sequence')}
      />

      {/* Email-style tab bar */}
      <div className="flex items-center gap-1 px-4 md:px-6 pt-4 border-b border-border pb-0">
        {TABS.map(({ key, label, Icon }) => (
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

      {tab === 'triggers'  && <WorkflowsPage  embedded />}
      {tab === 'sequences' && <SequencesPage  embedded />}
    </div>
  );
}
