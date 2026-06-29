// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { TopBar } from '@/components/layout/TopBar';
import { ViewModeToggle, type ViewMode } from '@/components/crm/ViewModeToggle';
import KnowledgeGovernanceSettings from '@/components/settings/KnowledgeGovernanceSettings';
import { BookOpen } from 'lucide-react';
import { useState } from 'react';

export default function Knowledge() {
  const [viewMode, setViewMode] = useState<ViewMode>('cards');

  return (
    <>
      <TopBar
        title="Knowledge"
        icon={BookOpen}
        iconClassName="text-[#f59e0b]"
        description="Trusted Facts for briefings and customer-facing work"
      >
        <ViewModeToggle value={viewMode} onChange={setViewMode} className="md:mr-2" />
      </TopBar>
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <KnowledgeGovernanceSettings viewMode={viewMode} />
      </div>
    </>
  );
}
