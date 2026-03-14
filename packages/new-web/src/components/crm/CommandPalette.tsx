import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Users, Briefcase, LayoutDashboard, FolderKanban, Activity, Bot, Settings,
  Search
} from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { cn } from '@/lib/utils';
import { ContactAvatar } from './ContactAvatar';
import { contacts, deals } from '@/lib/mockData';
import { useIsMobile } from '@/hooks/use-mobile';

export function CommandPalette() {
  const { commandPaletteOpen, setCommandPaletteOpen, openDrawer } = useAppStore();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (commandPaletteOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [commandPaletteOpen]);

  const runAction = (fn: () => void) => {
    fn();
    setCommandPaletteOpen(false);
  };

  const itemClass = isMobile
    ? "flex items-center gap-3 px-3 py-3 rounded-md text-sm text-foreground cursor-pointer data-[selected=true]:bg-primary/15 data-[selected=true]:text-primary"
    : "flex items-center gap-3 px-2 py-2 rounded-md text-sm text-foreground cursor-pointer data-[selected=true]:bg-primary/15 data-[selected=true]:text-primary";

  const commandContent = (
    <Command className="bg-card border-x border-border shadow-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 border-b border-border">
        <Search className="w-4 h-4 text-muted-foreground" />
        <Command.Input
          ref={inputRef}
          placeholder="Search contacts, deals, or type a command..."
          className="flex-1 py-3 text-sm bg-transparent text-foreground placeholder:text-muted-foreground outline-none"
        />
      </div>
      <Command.List className="max-h-80 overflow-y-auto p-2">
        <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
          No results found.
        </Command.Empty>

        <Command.Group heading="Pages" className="text-xs text-muted-foreground px-2 py-1.5 font-display">
          {[
            { label: 'Dashboard', icon: LayoutDashboard, path: '/' },
            { label: 'Contacts', icon: Users, path: '/contacts' },
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

        <Command.Group heading="Contacts" className="text-xs text-muted-foreground px-2 py-1.5 font-display">
          {contacts.slice(0, 8).map((c) => (
            <Command.Item
              key={c.id}
              value={`${c.name} ${c.company} ${c.email}`}
              onSelect={() => runAction(() => { navigate('/contacts'); openDrawer('contact', c.id); })}
              className={itemClass}
            >
              <ContactAvatar name={c.name} className="w-5 h-5 rounded-full text-[8px]" />
              <span>{c.name}</span>
              {c.company && <span className="text-muted-foreground text-xs">— {c.company}</span>}
            </Command.Item>
          ))}
        </Command.Group>

        <Command.Group heading="Deals" className="text-xs text-muted-foreground px-2 py-1.5 font-display">
          {deals.slice(0, 6).map((d) => (
            <Command.Item
              key={d.id}
              value={`${d.name} ${d.contactName}`}
              onSelect={() => runAction(() => { navigate('/deals'); openDrawer('deal', d.id); })}
              className={itemClass}
            >
              <Briefcase className="w-4 h-4" />
              <span>{d.name}</span>
              <span className="text-muted-foreground text-xs ml-auto">${(d.amount / 1000).toFixed(0)}K</span>
            </Command.Item>
          ))}
        </Command.Group>
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
        </>
      )}
    </AnimatePresence>
  );
}
