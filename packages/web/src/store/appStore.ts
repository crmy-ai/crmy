import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type DrawerType = 'contact' | 'opportunity' | 'use-case' | 'account' | 'assignment' | 'workflow' | 'email' | 'activity' | null;

export interface AIContextEntity {
  type: 'contact' | 'opportunity' | 'use-case' | 'account';
  id: string;
  name: string;
  detail?: string;
}
export interface EmailDraftContext {
  source_email_message_id?: string;
  subject_type?: 'account' | 'contact' | 'opportunity' | 'use_case' | 'use-case';
  subject_id?: string;
  contact_id?: string;
  account_id?: string;
  opportunity_id?: string;
  use_case_id?: string;
  to_address?: string;
  to_name?: string;
  intent?: 'reply' | 'follow_up' | 'recap_next_steps' | 'nudge_stalled_deal' | 'custom';
}
type QuickAddType = 'contact' | 'opportunity' | 'use-case' | 'activity' | 'account' | 'assignment' | null;
export interface QuickAddContext {
  parent_subject_type?: 'account' | 'contact' | 'opportunity' | 'use_case' | 'use-case';
  parent_subject_id?: string;
  parent_subject_name?: string;
  defaults?: Record<string, unknown>;
  source_route?: string;
}
export interface FieldProvenance {
  source: 'user' | 'model_knowledge' | 'matched_record' | 'provider' | 'required';
  source_label: string;
  confidence_label?: string;
  requires_confirmation?: boolean;
}

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
  quickAddContext: QuickAddContext | null;
  openQuickAdd: (type: QuickAddType, context?: QuickAddContext | null) => void;
  closeQuickAdd: () => void;

  aiContext: AIContextEntity | null;
  openAIWithContext: (context: AIContextEntity) => void;

  recordFieldProvenance: Record<string, Record<string, FieldProvenance>>;
  setRecordFieldProvenance: (recordType: string, recordId: string, provenance: Record<string, FieldProvenance>) => void;

  emailDraftOpen: boolean;
  emailDraftContext: EmailDraftContext | null;
  openEmailDraft: (context?: EmailDraftContext | null) => void;
  closeEmailDraft: () => void;

  workflowEditorId: string | null;   // null = create mode, string = edit mode
  workflowEditorDraft: Record<string, unknown> | null;
  workflowEditorOpen: boolean;
  openWorkflowEditor: (id: string | null, draft?: Record<string, unknown> | null) => void;
  closeWorkflowEditor: () => void;

  sequenceEditorId: string | null;   // null = create mode, string = edit mode
  sequenceEditorDraft: Record<string, unknown> | null;
  sequenceEditorOpen: boolean;
  openSequenceEditor: (id: string | null, draft?: Record<string, unknown> | null) => void;
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
      quickAddContext: null,
      openQuickAdd: (type, context = null) => set({ quickAddOpen: true, quickAddType: type, quickAddContext: context }),
      closeQuickAdd: () => set({ quickAddOpen: false, quickAddType: null, quickAddContext: null }),

      aiContext: null,
      openAIWithContext: (context) => set({ aiContext: context }),

      recordFieldProvenance: {},
      setRecordFieldProvenance: (recordType, recordId, provenance) => set((state) => ({
        recordFieldProvenance: {
          ...state.recordFieldProvenance,
          [`${recordType}:${recordId}`]: provenance,
        },
      })),

      emailDraftOpen: false,
      emailDraftContext: null,
      openEmailDraft: (context = null) => set({ emailDraftOpen: true, emailDraftContext: context }),
      closeEmailDraft: () => set({ emailDraftOpen: false, emailDraftContext: null }),

      workflowEditorId: null,
      workflowEditorDraft: null,
      workflowEditorOpen: false,
      openWorkflowEditor: (id, draft = null) => set({ workflowEditorOpen: true, workflowEditorId: id, workflowEditorDraft: draft }),
      closeWorkflowEditor: () => set({ workflowEditorOpen: false, workflowEditorId: null, workflowEditorDraft: null }),

      sequenceEditorId: null,
      sequenceEditorDraft: null,
      sequenceEditorOpen: false,
      openSequenceEditor: (id, draft = null) => set({ sequenceEditorOpen: true, sequenceEditorId: id, sequenceEditorDraft: draft }),
      closeSequenceEditor: () => set({ sequenceEditorOpen: false, sequenceEditorId: null, sequenceEditorDraft: null }),

      darkVariant: 'charcoal',
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
