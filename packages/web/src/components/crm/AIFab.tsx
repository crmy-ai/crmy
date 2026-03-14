import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Sparkles, Command } from 'lucide-react';

export function AIFab() {
  const location = useLocation();
  const navigate = useNavigate();

  if (location.pathname === '/agent') return null;

  return (
    <div className="fixed z-[60] bottom-20 md:bottom-6 right-4 md:right-6 flex flex-col items-center gap-1.5">
      <motion.button
        onClick={() => navigate('/agent')}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg bg-gradient-to-br from-primary to-accent text-primary-foreground animate-fab-glow"
      >
        <Sparkles className="w-5 h-5" />
      </motion.button>
      <span className="hidden md:inline-flex items-center gap-0.5 text-[10px] font-mono text-muted-foreground bg-card/80 backdrop-blur-sm border border-border px-1.5 py-0.5 rounded-md shadow-sm">
        <Command className="w-2.5 h-2.5" />J
      </span>
    </div>
  );
}
