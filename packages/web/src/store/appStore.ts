import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type DrawerType = 'contact' | 'opportunity' | 'use-case' | 'account' | 'assignment' | 'workflow' | 'email' | null;

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
  drawerBriefing: boolean;
  openDrawer: (type: DrawerType, entityId?: string) => void;
  openDrawerBriefing: (type: DrawerType, entityId: string) => void;
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

  workflowEditorId: string | null;   // null = create mode, string = edit mode
  workflowEditorOpen: boolean;
  openWorkflowEditor: (id: string | null) => void;
  closeWorkflowEditor: () => void;

  sequenceEditorId: string | null;   // null = create mode, string = edit mode
  sequenceEditorOpen: boolean;
  openSequenceEditor: (id: string | null) => void;
  closeSequenceEditor: () => void;
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
      drawerBriefing: false,
      openDrawer: (type, entityId) => set({ drawerOpen: true, drawerType: type, drawerEntityId: entityId ?? null, drawerBriefing: false }),
      openDrawerBriefing: (type, entityId) => set({ drawerOpen: true, drawerType: type, drawerEntityId: entityId, drawerBriefing: true }),
      closeDrawer: () => set({ drawerOpen: false, drawerType: null, drawerEntityId: null, drawerBriefing: false }),

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

      workflowEditorId: null,
      workflowEditorOpen: false,
      openWorkflowEditor: (id) => set({ workflowEditorOpen: true, workflowEditorId: id }),
      closeWorkflowEditor: () => set({ workflowEditorOpen: false, workflowEditorId: null }),

      sequenceEditorId: null,
      sequenceEditorOpen: false,
      openSequenceEditor: (id) => set({ sequenceEditorOpen: true, sequenceEditorId: id }),
      closeSequenceEditor: () => set({ sequenceEditorOpen: false, sequenceEditorId: null }),

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
