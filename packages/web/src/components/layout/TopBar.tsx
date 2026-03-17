import { Search, Command, Sun, Moon, LogOut } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { useTheme } from '@/hooks/useTheme';
import { useNavigate } from 'react-router-dom';
import { clearToken } from '@/api/client';

interface TopBarProps {
  title: string;
  children?: React.ReactNode;
}

export function TopBar({ title, children }: TopBarProps) {
  const { setCommandPaletteOpen } = useAppStore();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();

  const handleLogout = () => {
    clearToken();
    navigate('/login');
  };

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between h-14 px-4 md:px-6 border-b border-border bg-background/80 backdrop-blur-md gap-2">
      <h1 className="font-display font-bold text-lg text-foreground truncate hidden md:block">{title}</h1>
      <div className="flex items-center gap-1.5 md:ml-auto w-full md:w-auto">
        {children}
        <button
          onClick={toggle}
          className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
        <button
          onClick={() => setCommandPaletteOpen(true)}
          className="flex items-center gap-2 flex-1 md:flex-none px-3 py-1.5 rounded-xl bg-muted text-muted-foreground text-sm hover:bg-muted/80 transition-colors min-h-[36px] md:min-h-0"
        >
          <Search className="w-4 h-4 md:w-3.5 md:h-3.5 flex-shrink-0" />
          <span className="text-left flex-1 md:flex-none">Search...</span>
          <kbd className="hidden md:inline-flex items-center gap-0.5 text-xs font-mono bg-background px-1.5 py-0.5 rounded-md border border-border">
            <Command className="w-3 h-3" />K
          </kbd>
        </button>
        <button
          onClick={handleLogout}
          className="p-2 rounded-xl text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
          title="Sign out"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
