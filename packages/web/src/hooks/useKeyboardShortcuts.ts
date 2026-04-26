import { useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAppStore } from '@/store/appStore';

export function useKeyboardShortcuts() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setCommandPaletteOpen, openDrawer, setShortcutsOpen, toggleZenMode, openQuickAdd, toggleAgentPanel, closeAgentPanel } = useAppStore();

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

    // Cmd+K — command palette
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setCommandPaletteOpen(true);
      return;
    }

    // Cmd+J — toggle persistent agent panel
    if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
      e.preventDefault();
      toggleAgentPanel();
      return;
    }

    // Cmd+Shift+Z — zen mode
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'Z') {
      e.preventDefault();
      toggleZenMode();
      return;
    }

    // Escape — close panel first, then other overlays
    if (e.key === 'Escape') {
      if (useAppStore.getState().agentPanelOpen) {
        e.preventDefault();
        closeAgentPanel();
        return;
      }
      useAppStore.getState().closeDrawer();
      useAppStore.getState().closeQuickAdd();
      setCommandPaletteOpen(false);
      setShortcutsOpen(false);
      return;
    }

    if (isInput) return;

    // ? — shortcuts
    if (e.key === '?') {
      e.preventDefault();
      setShortcutsOpen(true);
      return;
    }

    // N — new contact (on contacts page)
    if (e.key === 'n' || e.key === 'N') {
      if (location.pathname === '/contacts') {
        e.preventDefault();
        openQuickAdd('contact');
        return;
      }
    }

    // D — new opportunity (on opportunities page, not with meta key)
    if (e.key === 'd' && !e.metaKey && !e.ctrlKey) {
      if (location.pathname === '/opportunities') {
        e.preventDefault();
        openQuickAdd('opportunity');
        return;
      }
    }

    // G then navigation
    if (e.key === 'g') {
      const handler = (e2: KeyboardEvent) => {
        window.removeEventListener('keydown', handler);
        if (e2.key === 'h') navigate('/');
        else if (e2.key === 'c') navigate('/contacts');
        else if (e2.key === 'd') navigate('/opportunities');
      };
      window.addEventListener('keydown', handler);
      setTimeout(() => window.removeEventListener('keydown', handler), 1000);
      return;
    }
  }, [navigate, location.pathname, setCommandPaletteOpen, openDrawer, setShortcutsOpen, toggleZenMode, openQuickAdd, toggleAgentPanel, closeAgentPanel]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
