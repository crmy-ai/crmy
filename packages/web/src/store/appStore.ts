import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type DrawerType = 'contact' | 'opportunity' | 'use-case' | 'account' | 'assignment' | null;

export interface AIContextEntity {
  type: 'contact' | 'opportunity' | 'use-case' | 'account';
  id: string;
  name: string;
  detail?: string;
}
type QuickAddType = 'contact' | 'opportunity' | 'use-case' | 'activity' | 'account' | 'assignment' | null;

interface AppState {
  darkVariant: 'warm' | 'charcoal';
  setDarkVariant: (variant: 'warm' | 'charcoal') => void;
  sidebarExpanded: boolean;
  setSidebarExpanded: (expanded: boolean) => void;
  toggleSidebar: () => void;

  drawerOpen: boolean;
  drawerType: DrawerType;
  drawerEntityId: string | null;
  openDrawer: (type: DrawerType, entityId?: string) => void;
  closeDrawer: () => void;

  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;

  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;

  zenMode: boolean;
  toggleZenMode: () => void;

  theme: 'dark' | 'light' | 'system';
  setTheme: (theme: 'dark' | 'light' | 'system') => void;

  quickAddOpen: boolean;
  quickAddType: QuickAddType;
  openQuickAdd: (type: QuickAddType) => void;
  closeQuickAdd: () => void;

  aiContext: AIContextEntity | null;
  openAIWithContext: (context: AIContextEntity) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      sidebarExpanded: false,
      setSidebarExpanded: (expanded) => set({ sidebarExpanded: expanded }),
      toggleSidebar: () => set((s) => ({ sidebarExpanded: !s.sidebarExpanded })),

      drawerOpen: false,
      drawerType: null,
      drawerEntityId: null,
      openDrawer: (type, entityId) => set({ drawerOpen: true, drawerType: type, drawerEntityId: entityId ?? null }),
      closeDrawer: () => set({ drawerOpen: false, drawerType: null, drawerEntityId: null }),

      commandPaletteOpen: false,
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

      shortcutsOpen: false,
      setShortcutsOpen: (open) => set({ shortcutsOpen: open }),

      zenMode: false,
      toggleZenMode: () => set((s) => ({ zenMode: !s.zenMode })),

      theme: 'dark',
      setTheme: (theme) => {
        const root = document.documentElement;
        root.classList.remove('dark', 'light');
        if (theme === 'system') {
          const sys = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
          root.classList.add(sys);
        } else {
          root.classList.add(theme);
        }
        set({ theme });
      },

      quickAddOpen: false,
      quickAddType: null,
      openQuickAdd: (type) => set({ quickAddOpen: true, quickAddType: type }),
      closeQuickAdd: () => set({ quickAddOpen: false, quickAddType: null }),

      aiContext: null,
      openAIWithContext: (context) => set({ aiContext: context }),

      darkVariant: 'warm',
      setDarkVariant: (variant) => set({ darkVariant: variant }),
    }),
    {
      name: 'crmy-app-store',
      partialize: (state) => ({
        sidebarExpanded: state.sidebarExpanded,
        theme: state.theme,
        darkVariant: state.darkVariant,
      }),
    }
  )
);
