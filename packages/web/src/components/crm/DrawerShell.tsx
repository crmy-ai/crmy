import { motion, AnimatePresence } from 'framer-motion';
import { X, GripHorizontal } from 'lucide-react';
import { useAppStore } from '@/store/appStore';

interface DrawerShellProps {
  children: React.ReactNode;
  title?: string;
}

export function DrawerShell({ children, title }: DrawerShellProps) {
  const { drawerOpen, closeDrawer } = useAppStore();

  return (
    <AnimatePresence>
      {drawerOpen && (
        <>
          {/* Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-foreground/20 backdrop-blur-sm"
            onClick={closeDrawer}
          />

          {/* Desktop: slide from right */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="hidden md:flex fixed right-0 top-0 h-full w-[480px] z-50 bg-card border-l border-border shadow-2xl flex-col rounded-l-2xl"
          >
            <div className="flex items-center justify-between h-14 px-5 border-b border-border">
              {title && <h2 className="font-display font-bold text-foreground">{title}</h2>}
              <button
                onClick={closeDrawer}
                className="ml-auto p-2 rounded-xl hover:bg-muted text-muted-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {children}
            </div>
          </motion.div>

          {/* Mobile: slide from bottom */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="md:hidden fixed left-0 right-0 bottom-0 z-50 bg-card border-t border-border shadow-2xl flex flex-col rounded-t-3xl max-h-[90vh]"
          >
            {/* Drag handle */}
            <div className="flex justify-center py-2">
              <div className="w-10 h-1 rounded-full bg-muted-foreground/20" />
            </div>
            <div className="flex items-center justify-between px-5 pb-3 border-b border-border">
              {title && <h2 className="font-display font-bold text-foreground">{title}</h2>}
              <button
                onClick={closeDrawer}
                className="ml-auto p-2 rounded-xl hover:bg-muted text-muted-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto pb-safe">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
