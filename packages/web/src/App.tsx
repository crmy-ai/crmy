// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useEffect } from 'react';
import { BrowserRouter, Route, Routes, useLocation, Navigate } from 'react-router-dom';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { motion, AnimatePresence } from 'framer-motion';

import { Sidebar } from '@/components/layout/Sidebar';
import { MobileNav } from '@/components/layout/MobileNav';
import { CommandPalette } from '@/components/crm/CommandPalette';
import { ShortcutsOverlay } from '@/components/crm/ShortcutsOverlay';
import { DrawerShell } from '@/components/crm/DrawerShell';
import { QuickAddDrawer } from '@/components/crm/QuickAddDrawer';
import { ContactDrawer } from '@/components/crm/ContactDrawer';
import { OpportunityDrawer } from '@/components/crm/OpportunityDrawer';
import { UseCaseDrawer } from '@/components/crm/UseCaseDrawer';
import { AccountDrawer } from '@/components/crm/AccountDrawer';
import { AssignmentDrawer } from '@/components/crm/AssignmentDrawer';
import { WorkflowDrawer } from '@/components/crm/WorkflowDrawer';
import { WorkflowEditor } from '@/components/crm/WorkflowEditor';
import { SequenceEditor } from '@/components/crm/SequenceEditor';
import { EmailDrawer } from '@/components/crm/EmailDrawer';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useAppStore } from '@/store/appStore';
import { GlobalAgentPanel } from '@/components/crm/GlobalAgentPanel';
import { AIFab } from '@/components/crm/AIFab';
import { useTheme } from '@/hooks/useTheme';
import { AgentSettingsProvider } from '@/contexts/AgentSettingsContext';

import { LoginPage } from '@/pages/auth/Login';
import Dashboard from '@/pages/Dashboard';
import Contacts from '@/pages/Contacts';
import Accounts from '@/pages/Accounts';
import Opportunities from '@/pages/Opportunities';
import UseCasesPage from '@/pages/UseCases';
import Activities from '@/pages/Activities';
import Agent from '@/pages/Agent';
import AgentActivity from '@/pages/AgentActivity';
import Settings from '@/pages/Settings';
import NotFound from '@/pages/NotFound';
import AssignmentsPage from '@/pages/Assignments';
import InboxPage from '@/pages/Inbox';
import ContextPage from '@/pages/Context';
import WorkflowsPage from '@/pages/Workflows';
import EmailsPage from '@/pages/Emails';
import ActorsPage from '@/pages/Agents';
import MemoryGraphPage from '@/pages/MemoryGraphPage';
import SequencesPage from '@/pages/Sequences';
import AutomationsPage from '@/pages/Automations';
import InboundInboxPage from '@/pages/InboundInbox';
import AuditLogPage from '@/pages/AuditLog';

function ThemeApplier() {
  const { darkVariant } = useAppStore();
  useTheme(); // applies theme class to html element

  useEffect(() => {
    const html = document.documentElement;
    if (darkVariant === 'charcoal') {
      html.classList.add('charcoal');
    } else {
      html.classList.remove('charcoal');
    }
  }, [darkVariant]);

  return null;
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('crmy_token');
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function AnimatedRoutes() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className="flex-1 flex flex-col overflow-hidden"
      >
        <Routes location={location}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/opportunities" element={<Opportunities />} />
          <Route path="/use-cases" element={<UseCasesPage />} />
          <Route path="/activities" element={<Activities />} />
          <Route path="/handoffs" element={<InboxPage />} />
          <Route path="/assignments" element={<Navigate to="/handoffs" replace />} />
          <Route path="/inbox" element={<Navigate to="/handoffs" replace />} />
          <Route path="/approvals" element={<Navigate to="/handoffs" replace />} />
          <Route path="/hitl" element={<Navigate to="/handoffs" replace />} />
          <Route path="/context" element={<ContextPage />} />
          <Route path="/automations" element={<AutomationsPage />} />
          <Route path="/workflows"   element={<Navigate to="/automations?tab=triggers"  replace />} />
          <Route path="/sequences"   element={<Navigate to="/automations?tab=sequences" replace />} />
          <Route path="/emails" element={<EmailsPage />} />
          <Route path="/agents" element={<Navigate to="/settings/agents" replace />} />
          <Route path="/actors" element={<Navigate to="/settings/agents" replace />} />
          <Route path="/contacts/:id/graph" element={<MemoryGraphPage />} />
          <Route path="/inbound" element={<Navigate to="/emails" replace />} />
          <Route path="/audit-log" element={<AuditLogPage />} />
          <Route path="/accounts/:id/graph" element={<MemoryGraphPage />} />
          <Route path="/agent" element={<Agent />} />
          <Route path="/agent/activity" element={<AgentActivity />} />
          <Route path="/settings/*" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
}

function AppContent() {
  useKeyboardShortcuts();
  const {
    drawerType, zenMode,
    workflowEditorOpen, workflowEditorId, closeWorkflowEditor,
    sequenceEditorOpen, sequenceEditorId, closeSequenceEditor,
  } = useAppStore();

  const drawerTitle = drawerType === 'contact' ? 'Contact Details'
    : drawerType === 'opportunity' ? 'Opportunity Details'
    : drawerType === 'use-case' ? 'Use Case Details'
    : drawerType === 'account' ? 'Account Details'
    : drawerType === 'assignment' ? 'Assignment Details'
    : drawerType === 'workflow' ? 'Workflow Details'
    : drawerType === 'email' ? 'Email Details'
    : '';

  return (
    <div className="flex h-screen w-full overflow-hidden">
      {!zenMode && <Sidebar />}
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden">
          <AnimatedRoutes />
        </div>
      </main>
      {!zenMode && <MobileNav />}
      {/* Drawers */}
      <DrawerShell title={drawerTitle}>
        {drawerType === 'contact' && <ContactDrawer />}
        {drawerType === 'opportunity' && <OpportunityDrawer />}
        {drawerType === 'use-case' && <UseCaseDrawer />}
        {drawerType === 'account' && <AccountDrawer />}
        {drawerType === 'assignment' && <AssignmentDrawer />}
        {drawerType === 'workflow' && <WorkflowDrawer />}
        {drawerType === 'email' && <EmailDrawer />}
      </DrawerShell>

      {/* Workflow editor — lives at root so it's never unmounted by other state changes */}
      <WorkflowEditor
        open={workflowEditorOpen}
        workflowId={workflowEditorId}
        onClose={closeWorkflowEditor}
        onSaved={closeWorkflowEditor}
      />

      {/* Sequence editor — same root-level pattern for consistent layering */}
      <SequenceEditor
        open={sequenceEditorOpen}
        sequenceId={sequenceEditorId}
        onClose={closeSequenceEditor}
        onSaved={closeSequenceEditor}
      />

      {/* Overlays */}
      <CommandPalette />
      <ShortcutsOverlay />
      <QuickAddDrawer />

      {/* Persistent agent panel — always mounted so SSE streams survive navigation */}
      <GlobalAgentPanel />

      {/* FAB — opens the panel from any page */}
      {!zenMode && <AIFab />}
    </div>
  );
}

export function App() {
  return (
    <AgentSettingsProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter basename="/app">
          <ThemeApplier />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/*"
              element={
                <AuthGuard>
                  <AppContent />
                </AuthGuard>
              }
            />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AgentSettingsProvider>
  );
}
