// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Briefcase, LayoutDashboard, FolderKanban, Activity, Bot, Settings, Search, Building2 } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { cn } from '@/lib/utils';
import { ContactAvatar } from './ContactAvatar';
import { useSearch } from '@/api/hooks';
import { useIsMobile } from '@/hooks/use-mobile';

export function CommandPalette() {
  const { commandPaletteOpen, setCommandPaletteOpen, openDrawer } = useAppStore();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();
  const [query, setQuery] = useState('');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: searchResults } = useSearch(query) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contacts: any[] = searchResults?.contacts ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opportunities: any[] = searchResults?.opportunities ?? [];

  useEffect(() => {
    if (commandPaletteOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
    }
  }, [commandPaletteOpen]);

  const runAction = (fn: () => void) => {
    fn();
    setCommandPaletteOpen(false);
  };

  const itemClass = cn(
    'flex items-center gap-3 px-2 py-2 rounded-md text-sm text-foreground cursor-pointer',
    'data-[selected=true]:bg-primary/15 data-[selected=true]:text-primary',
    isMobile && 'py-3 px-3'
  );

  const commandContent = (
    <Command className="bg-card border-x border-border shadow-2xl overflow-hidden" shouldFilter={false}>
      <div className="flex items-center gap-2 px-4 border-b border-border">
        <Search className="w-4 h-4 text-muted-foreground" />
        <Command.Input
          ref={inputRef}
          value={query}
          onValueChange={setQuery}
          placeholder="Search contacts, deals, or type a command..."
          className="flex-1 py-3 text-sm bg-transparent text-foreground placeholder:text-muted-foreground outline-none"
        />
      </div>
      <Command.List className="max-h-80 overflow-y-auto p-2">
        <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
          No results found.
        </Command.Empty>

        {!query && (
          <Command.Group heading="Pages" className="text-xs text-muted-foreground px-2 py-1.5 font-display">
            {[
              { label: 'Dashboard', icon: LayoutDashboard, path: '/' },
              { label: 'Contacts', icon: Users, path: '/contacts' },
              { label: 'Accounts', icon: Building2, path: '/accounts' },
              { label: 'Deals', icon: Briefcase, path: '/deals' },
              { label: 'Use Cases', icon: FolderKanban, path: '/use-cases' },
              { label: 'Activities', icon: Activity, path: '/activities' },
              { label: 'AI Agent', icon: Bot, path: '/agent' },
              { label: 'Settings', icon: Settings, path: '/settings' },
            ].map((page) => (
              <Command.Item
                key={page.path}
                value={page.label}
                onSelect={() => runAction(() => navigate(page.path))}
                className={itemClass}
              >
                <page.icon className="w-4 h-4" />
                {page.label}
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {contacts.length > 0 && (
          <Command.Group heading="Contacts" className="text-xs text-muted-foreground px-2 py-1.5 font-display">
            {contacts.slice(0, 8).map((c) => (
              <Command.Item
                key={c.id as string}
                value={`${c.name} ${c.company} ${c.email}`}
                onSelect={() => runAction(() => { navigate('/contacts'); openDrawer('contact', c.id as string); })}
                className={itemClass}
              >
                <ContactAvatar name={c.name as string} className="w-5 h-5 rounded-full text-[8px]" />
                <span>{c.name as string}</span>
                {c.company && <span className="text-muted-foreground text-xs">— {c.company as string}</span>}
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {opportunities.length > 0 && (
          <Command.Group heading="Deals" className="text-xs text-muted-foreground px-2 py-1.5 font-display">
            {opportunities.slice(0, 6).map((d) => (
              <Command.Item
                key={d.id as string}
                value={`${d.name} ${d.contact_name}`}
                onSelect={() => runAction(() => { navigate('/deals'); openDrawer('deal', d.id as string); })}
                className={itemClass}
              >
                <Briefcase className="w-4 h-4" />
                <span>{d.name as string}</span>
                {d.amount && (
                  <span className="text-muted-foreground text-xs ml-auto">
                    ${((d.amount as number) / 1000).toFixed(0)}K
                  </span>
                )}
              </Command.Item>
            ))}
          </Command.Group>
        )}
      </Command.List>
      {!isMobile && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-border text-xs text-muted-foreground">
          <span>Navigate with ↑↓ · Select with ↵</span>
          <span>ESC to close</span>
        </div>
      )}
    </Command>
  );

  return (
    <AnimatePresence>
      {commandPaletteOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm"
            onClick={() => setCommandPaletteOpen(false)}
          />
          {isMobile ? (
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed left-0 right-0 bottom-0 z-[70] flex flex-col max-h-[85vh]"
            >
              <div className="flex justify-center py-2 bg-card rounded-t-2xl border-t border-x border-border">
                <div className="w-10 h-1 rounded-full bg-muted-foreground/20" />
              </div>
              {commandContent}
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: -8 }}
              transition={{ duration: 0.15 }}
              className="fixed top-20 left-1/2 -translate-x-1/2 z-[70] w-full max-w-xl"
            >
              <div className="rounded-2xl overflow-hidden border border-border shadow-2xl">
                {commandContent}
              </div>
            </motion.div>
          )}
        </>
      )}
    </AnimatePresence>
  );
}
