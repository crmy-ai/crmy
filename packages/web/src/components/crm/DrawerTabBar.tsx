// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Link } from 'react-router-dom';
import { User, FileText, GitFork } from 'lucide-react';
import { useAppStore } from '@/store/appStore';

export type DrawerView = 'detail' | 'brief';

export function DrawerTabBar({
  view,
  onChange,
  graphHref,
}: {
  view: DrawerView;
  onChange: (v: DrawerView) => void;
  graphHref?: string;
}) {
  const closeDrawer = useAppStore(s => s.closeDrawer);
  const tabs: { key: DrawerView; label: string; icon: React.ElementType }[] = [
    { key: 'detail', label: 'Detail', icon: User },
    { key: 'brief',  label: 'Brief',  icon: FileText },
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
      {graphHref && (
        <Link
          to={graphHref}
          onClick={closeDrawer}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-muted-foreground hover:text-foreground transition-all"
        >
          <GitFork className="w-3 h-3" />
          Graph
        </Link>
      )}
    </div>
  );
}
