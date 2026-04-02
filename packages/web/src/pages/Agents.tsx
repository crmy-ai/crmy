// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { UsersRound, List, LayoutGrid } from 'lucide-react';
import { TopBar } from '@/components/layout/TopBar';
import ActorsSettings from '@/components/settings/ActorsSettings';

export default function ActorsPage() {
  const [view, setView] = useState<'table' | 'cards'>('table');

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Actors"
        icon={UsersRound}
        iconClassName="text-[#6366f1]"
        description="Manage humans and AI agents with access to your CRMy workspace."
      >
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
      </TopBar>
      <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-24 md:pb-6">
        <ActorsSettings view={view} onViewChange={setView} />
      </div>
    </div>
  );
}
