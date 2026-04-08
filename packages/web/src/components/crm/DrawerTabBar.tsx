// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { User, FileText, GitFork } from 'lucide-react';

export type DrawerView = 'detail' | 'brief' | 'graph';

export function DrawerTabBar({
  view,
  onChange,
}: {
  view: DrawerView;
  onChange: (v: DrawerView) => void;
}) {
  const tabs: { key: DrawerView; label: string; icon: React.ElementType }[] = [
    { key: 'detail', label: 'Detail', icon: User },
    { key: 'brief',  label: 'Brief',  icon: FileText },
    { key: 'graph',  label: 'Graph',  icon: GitFork },
  ];

  return (
    <div className="flex items-center gap-0.5 px-5 py-2 border-b border-border bg-muted/30">
      {tabs.map(t => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            view === t.key
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <t.icon className="w-3 h-3" />
          {t.label}
        </button>
      ))}
    </div>
  );
}
