// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Link, useLocation } from 'react-router-dom';
import { Brain, Inbox, Bot } from 'lucide-react';
import { motion } from 'framer-motion';

const tabs = [
  { icon: Brain,      label: 'Workspace', path: '/' },
  { icon: Bot,        label: 'Agent',     path: '/agent' },
  { icon: Bot,        label: 'Agents',    path: '/agents' },
  { icon: Inbox,      label: 'Handoffs',  path: '/handoffs' },
];

export function MobileNav() {
  const location = useLocation();

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around h-16 bg-card/95 backdrop-blur-md border-t border-border safe-area-bottom">
      {tabs.map((tab) => {
        const active = tab.path === '/' ? location.pathname === '/' : location.pathname.startsWith(tab.path);
        return (
          <Link
            key={tab.path}
            to={tab.path}
            className="relative flex flex-col items-center justify-center py-1 min-w-[44px] min-h-[44px]"
          >
            {active && (
              <motion.div
                layoutId="mobile-nav-pill"
                className="absolute inset-x-0.5 -top-0.5 bottom-1 rounded-2xl bg-primary/10"
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              />
            )}
            <tab.icon className={`w-5 h-5 relative z-10 transition-colors ${active ? 'text-primary' : 'text-muted-foreground'}`} />
            {active && (
              <motion.span
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-[10px] font-display font-semibold text-primary relative z-10 mt-0.5"
              >
                {tab.label}
              </motion.span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
