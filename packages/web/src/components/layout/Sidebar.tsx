// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain,
  Bot,
  Inbox,
  Zap,
  Users,
  Building2,
  Briefcase,
  FolderKanban,
  Activity,
  Mail,
  ScrollText,
  Settings,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { useInboxCounts } from '@/api/hooks';
import crmyLogo from '@/assets/crmy-logo.png';
import { ENTITY_COLORS } from '@/lib/entityColors';

export { ENTITY_COLORS };

// Agent-facing tier — top of nav
const agentNavItems = [
  { icon: Brain,       label: 'Context',      path: '/',             color: ENTITY_COLORS.contacts },
  { icon: Zap,         label: 'Automations',  path: '/automations',  color: ENTITY_COLORS.workflows },
  { icon: Inbox,       label: 'Handoffs',     path: '/handoffs',     color: ENTITY_COLORS.assignments },
];

// Data tier — knowledge base objects
const dataNavItems = [
  { icon: Users,       label: 'Contacts',      path: '/contacts',      color: ENTITY_COLORS.contacts },
  { icon: Building2,   label: 'Companies',     path: '/companies',     color: ENTITY_COLORS.accounts },
  { icon: Briefcase,   label: 'Opportunities', path: '/opportunities', color: ENTITY_COLORS.opportunities },
  { icon: FolderKanban,label: 'Use Cases',     path: '/use-cases',     color: ENTITY_COLORS.useCases },
  { icon: Activity,    label: 'Activities',    path: '/activities',    color: ENTITY_COLORS.activities },
  { icon: Mail,        label: 'Emails',        path: '/emails',        color: ENTITY_COLORS.emails },
];

const bottomItems = [
  { icon: Settings,    label: 'Settings',  path: '/settings'   },
  { icon: ScrollText,  label: 'Audit Log', path: '/audit-log'  },
];

interface NavItemDef {
  icon: React.ElementType;
  label: string;
  path: string;
  color: { text: string; bg: string; bar: string };
}

function NavItem({ item, active, badge }: {
  item: NavItemDef;
  active: boolean;
  badge?: number;
}) {
  const { sidebarExpanded } = useAppStore();

  return (
    <Link
      to={item.path}
      className={`group relative flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-sm transition-all
        ${active
          ? `${item.color.bg} ${item.color.text}`
          : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
        }`}
      title={!sidebarExpanded ? item.label : undefined}
    >
      <item.icon className="w-5 h-5 flex-shrink-0" />
      <AnimatePresence>
        {sidebarExpanded && (
          <motion.span
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'auto' }}
            exit={{ opacity: 0, width: 0 }}
            className="whitespace-nowrap overflow-hidden font-medium flex-1"
          >
            {item.label}
          </motion.span>
        )}
      </AnimatePresence>
      {badge !== undefined && badge > 0 && (
        <span className={`flex-shrink-0 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-destructive text-white text-xs font-bold ${sidebarExpanded ? '' : 'absolute -top-1 -right-1'}`}>
          {badge > 99 ? '99+' : badge}
        </span>
      )}
      {active && (
        <motion.div
          layoutId="sidebar-active"
          className={`absolute -left-2 top-2 w-[3px] h-6 ${item.color.bar} rounded-r-full`}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        />
      )}
      {/* Tooltip when collapsed */}
      {!sidebarExpanded && (
        <div className="absolute left-full ml-2 px-2.5 py-1.5 rounded-lg bg-popover text-popover-foreground text-xs shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50 font-medium">
          {item.label}
        </div>
      )}
    </Link>
  );
}

export function Sidebar() {
  const location = useLocation();
  const { sidebarExpanded, setSidebarExpanded } = useAppStore();
  const { hitlCount, assignCount } = useInboxCounts();

  function isActive(path: string) {
    return path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);
  }

  function badge(path: string) {
    if (path === '/handoffs') {
      const total = (hitlCount ?? 0) + (assignCount ?? 0);
      return total > 0 ? total : undefined;
    }
    return undefined;
  }

  return (
    <motion.aside
      className="hidden md:flex flex-col h-screen bg-sidebar border-r border-sidebar-border flex-shrink-0 overflow-hidden"
      animate={{ width: sidebarExpanded ? 220 : 56 }}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
    >
      {/* Logo */}
      <div className="flex items-center h-16 px-3 gap-2 border-b border-sidebar-border">
        <img src={crmyLogo} alt="CRMy" className="w-8 h-8 flex-shrink-0 rounded-lg" />
        <AnimatePresence>
          {sidebarExpanded && (
            <motion.span
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              className="font-brand font-bold text-lg text-sidebar-accent-foreground whitespace-nowrap overflow-hidden"
            >
              CRMy
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Nav */}
      <nav className="flex-1 flex flex-col py-3 gap-1 px-2 overflow-y-auto overflow-x-hidden">
        {/* Agent-facing tier */}
        {agentNavItems.map((item) => (
          <NavItem key={item.path} item={item} active={isActive(item.path)} badge={badge(item.path)} />
        ))}

        {/* Divider */}
        <div className="mt-2 mb-1">
          <div className="border-t border-sidebar-border" />
          <AnimatePresence>
            {sidebarExpanded && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-widest px-2.5 pt-2 pb-0.5"
              >
                Knowledge Base
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {/* Data tier */}
        {dataNavItems.map((item) => (
          <NavItem key={item.path} item={item} active={isActive(item.path)} />
        ))}
      </nav>

      {/* Bottom */}
      <div className="flex flex-col gap-1 px-2 pb-3 border-t border-sidebar-border pt-3">
        {bottomItems.map((item) => {
          const active = location.pathname.startsWith(item.path);
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-sm transition-all
                ${active
                  ? 'bg-sidebar-primary/15 text-sidebar-primary'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                }`}
              title={!sidebarExpanded ? item.label : undefined}
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              <AnimatePresence>
                {sidebarExpanded && (
                  <motion.span
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: 'auto' }}
                    exit={{ opacity: 0, width: 0 }}
                    className="whitespace-nowrap overflow-hidden font-medium"
                  >
                    {item.label}
                  </motion.span>
                )}
              </AnimatePresence>
            </Link>
          );
        })}

        {/* Toggle button */}
        <button
          onClick={() => setSidebarExpanded(!sidebarExpanded)}
          className="flex items-center justify-center w-8 h-8 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground mx-auto mt-1 transition-colors"
        >
          {sidebarExpanded ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeft className="w-4 h-4" />}
        </button>
      </div>
    </motion.aside>
  );
}
