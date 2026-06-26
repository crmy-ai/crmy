// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { TopBar } from '@/components/layout/TopBar';
import KnowledgeGovernanceSettings from '@/components/settings/KnowledgeGovernanceSettings';
import { BookOpen } from 'lucide-react';

export default function Knowledge() {
  return (
    <>
      <TopBar
        title="Knowledge"
        icon={BookOpen}
        iconClassName="text-[#f59e0b]"
        description="Governed claims for briefings and customer-facing work"
      />
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <KnowledgeGovernanceSettings />
      </div>
    </>
  );
}
