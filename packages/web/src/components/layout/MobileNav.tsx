// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Link, useLocation } from 'react-router-dom';
import { Inbox, LayoutDashboard, Library, Settings as SettingsIcon } from 'lucide-react';
import { motion } from 'framer-motion';

const tabs = [
  { icon: LayoutDashboard, label: 'Overview', path: '/' },
  { icon: Library,         label: 'Context',  path: '/context' },
  { icon: Inbox,           label: 'Handoffs', path: '/handoffs' },
  { icon: SettingsIcon,    label: 'Settings', path: '/settings' },
];

export function MobileNav() {
  const location = useLocation();

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 grid h-16 grid-cols-4 bg-card/95 backdrop-blur-md border-t border-border safe-area-bottom">
      {tabs.map((tab) => {
        const active = tab.path === '/' ? location.pathname === '/' : location.pathname.startsWith(tab.path);
        return (
          <Link
            key={tab.path}
            to={tab.path}
            className="relative flex min-h-[44px] min-w-0 flex-col items-center justify-center gap-0.5 px-1 py-1"
          >
            {active && (
              <motion.div
                layoutId="mobile-nav-pill"
                className="absolute inset-x-1 -top-0.5 bottom-1 rounded-2xl bg-primary/10"
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              />
            )}
            <tab.icon className={`w-5 h-5 relative z-10 transition-colors ${active ? 'text-primary' : 'text-muted-foreground'}`} />
            <motion.span
              initial={false}
              animate={{ opacity: active ? 1 : 0.78 }}
              className={`relative z-10 max-w-full truncate text-[11px] font-display font-semibold leading-4 ${active ? 'text-primary' : 'text-muted-foreground'}`}
            >
              {tab.label}
            </motion.span>
          </Link>
        );
      })}
    </nav>
  );
}
