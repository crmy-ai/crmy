import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '@/store/appStore';

const shortcuts = [
  { group: 'Global', items: [
    { keys: ['⌘', 'K'], label: 'Command palette' },
    { keys: ['⌘', '⇧', 'A'], label: 'Workspace Agent panel' },
    { keys: ['⌘', '⇧', 'Z'], label: 'Zen mode' },
    { keys: ['?'], label: 'Keyboard shortcuts' },
    { keys: ['Esc'], label: 'Close drawer / modal' },
  ]},
  { group: 'Navigation', items: [
    { keys: ['G', 'H'], label: 'Go to Dashboard' },
    { keys: ['G', 'C'], label: 'Go to Contacts' },
    { keys: ['G', 'D'], label: 'Go to Opportunities' },
  ]},
];

export function ShortcutsOverlay() {
  const { shortcutsOpen, setShortcutsOpen } = useAppStore();

  return (
    <AnimatePresence>
      {shortcutsOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
            onClick={() => setShortcutsOpen(false)}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md bg-card border border-border rounded-lg shadow-2xl p-6"
          >
            <h2 className="font-display font-bold text-lg text-foreground mb-4">Keyboard Shortcuts</h2>
            {shortcuts.map((group) => (
              <div key={group.group} className="mb-4">
                <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2">{group.group}</h3>
                <div className="space-y-2">
                  {group.items.map((item) => (
                    <div key={item.label} className="flex items-center justify-between">
                      <span className="text-sm text-foreground">{item.label}</span>
                      <div className="flex gap-1">
                        {item.keys.map((key) => (
                          <kbd key={key} className="px-1.5 py-0.5 text-xs font-mono bg-muted text-muted-foreground rounded border border-border">
                            {key}
                          </kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <p className="text-xs text-muted-foreground mt-4">Press <kbd className="px-1 py-0.5 text-xs font-mono bg-muted rounded border border-border">Esc</kbd> to close</p>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
