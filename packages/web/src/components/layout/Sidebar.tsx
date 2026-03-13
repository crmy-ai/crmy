// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Users, Building2, Kanban, Briefcase,
  Activity, BarChart3, ShieldCheck, Settings,
} from 'lucide-react';
import { cn } from '../ui/utils';
import { useHITLRequests } from '../../api/hooks';

const navItems = [
  { to: '/app', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/app/contacts', icon: Users, label: 'Contacts' },
  { to: '/app/accounts', icon: Building2, label: 'Accounts' },
  { to: '/app/pipeline', icon: Kanban, label: 'Pipeline' },
  { to: '/app/use-cases', icon: Briefcase, label: 'Use Cases' },
  { to: '/app/activities', icon: Activity, label: 'Activities' },
  { to: '/app/analytics', icon: BarChart3, label: 'Analytics' },
];

export function Sidebar() {
  const { data: hitlData } = useHITLRequests();
  const pendingCount = (hitlData as { data?: unknown[] })?.data?.length ?? 0;

  return (
    <aside className="flex h-full w-56 flex-col border-r bg-card">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-display font-bold text-sm shadow-xl shadow-primary/30">
          C
        </div>
        <span className="font-display font-bold text-lg">CRMy</span>
      </div>
      <nav className="flex-1 space-y-1 p-2">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )
            }
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
        <div className="my-3 border-t" />
        <NavLink
          to="/app/hitl"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted',
            )
          }
        >
          <ShieldCheck className="h-4 w-4" />
          HITL Queue
          {pendingCount > 0 && (
            <span className="ml-auto flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-[10px] font-mono font-bold text-destructive-foreground">
              {pendingCount}
            </span>
          )}
        </NavLink>
        <div className="my-3 border-t" />
        <NavLink
          to="/app/settings"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted',
            )
          }
        >
          <Settings className="h-4 w-4" />
          Settings
        </NavLink>
      </nav>
    </aside>
  );
}
