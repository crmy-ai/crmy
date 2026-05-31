// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { lazy, Suspense, useEffect } from 'react';
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
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useAppStore } from '@/store/appStore';
import { useTheme } from '@/hooks/useTheme';
import { AgentSettingsProvider } from '@/contexts/AgentSettingsContext';

import { LoginPage } from '@/pages/auth/Login';
import { SetupPage } from '@/pages/auth/Setup';
import { getUser } from '@/api/client';

const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Contacts = lazy(() => import('@/pages/Contacts'));
const Accounts = lazy(() => import('@/pages/Accounts'));
const Opportunities = lazy(() => import('@/pages/Opportunities'));
const UseCasesPage = lazy(() => import('@/pages/UseCases'));
const Activities = lazy(() => import('@/pages/Activities'));
const Agent = lazy(() => import('@/pages/Agent'));
const AgentActivity = lazy(() => import('@/pages/AgentActivity'));
const Settings = lazy(() => import('@/pages/Settings'));
const NotFound = lazy(() => import('@/pages/NotFound'));
const InboxPage = lazy(() => import('@/pages/Inbox'));
const ContextPage = lazy(() => import('@/pages/Context'));
const EmailsPage = lazy(() => import('@/pages/Emails'));
const MemoryGraphPage = lazy(() => import('@/pages/MemoryGraphPage'));
const AutomationsPage = lazy(() => import('@/pages/Automations'));
const AuditLogPage = lazy(() => import('@/pages/AuditLog'));
const OperationsPage = lazy(() => import('@/pages/Operations'));
const SearchResultsPage = lazy(() => import('@/pages/SearchResults').then(mod => ({ default: mod.SearchResultsPage })));
const QuickAddDrawer = lazy(() => import('@/components/crm/QuickAddDrawer').then(mod => ({ default: mod.QuickAddDrawer })));
const ContactDrawer = lazy(() => import('@/components/crm/ContactDrawer').then(mod => ({ default: mod.ContactDrawer })));
const OpportunityDrawer = lazy(() => import('@/components/crm/OpportunityDrawer').then(mod => ({ default: mod.OpportunityDrawer })));
const UseCaseDrawer = lazy(() => import('@/components/crm/UseCaseDrawer').then(mod => ({ default: mod.UseCaseDrawer })));
const AccountDrawer = lazy(() => import('@/components/crm/AccountDrawer').then(mod => ({ default: mod.AccountDrawer })));
const AssignmentDrawer = lazy(() => import('@/components/crm/AssignmentDrawer').then(mod => ({ default: mod.AssignmentDrawer })));
const ActivityDrawer = lazy(() => import('@/components/crm/ActivityDrawer').then(mod => ({ default: mod.ActivityDrawer })));
const WorkflowDrawer = lazy(() => import('@/components/crm/WorkflowDrawer').then(mod => ({ default: mod.WorkflowDrawer })));
const WorkflowEditor = lazy(() => import('@/components/crm/WorkflowEditor').then(mod => ({ default: mod.WorkflowEditor })));
const SequenceEditor = lazy(() => import('@/components/crm/SequenceEditor').then(mod => ({ default: mod.SequenceEditor })));
const EmailDrawer = lazy(() => import('@/components/crm/EmailDrawer').then(mod => ({ default: mod.EmailDrawer })));
const EmailDraftDrawer = lazy(() => import('@/components/crm/EmailDraftDrawer').then(mod => ({ default: mod.EmailDraftDrawer })));

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

function AdminGuard({ children }: { children: React.ReactNode }) {
  const role = getUser()?.role;
  if (role !== 'admin' && role !== 'owner') {
    return <Navigate to="/" replace />;
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
        <Suspense fallback={<div className="flex-1 bg-background" />}>
          <Routes location={location}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/contacts" element={<Contacts />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/companies" element={<Accounts />} />
            <Route path="/opportunities" element={<Opportunities />} />
            <Route path="/use-cases" element={<UseCasesPage />} />
            <Route path="/activities" element={<Activities />} />
            <Route path="/handoffs" element={<InboxPage />} />
            <Route path="/context" element={<ContextPage />} />
            <Route path="/automations" element={<AdminGuard><AutomationsPage /></AdminGuard>} />
            <Route path="/emails" element={<EmailsPage />} />
            <Route path="/contacts/:id/graph" element={<MemoryGraphPage />} />
            <Route path="/operations" element={<AdminGuard><OperationsPage /></AdminGuard>} />
            <Route path="/audit-log" element={<AdminGuard><AuditLogPage /></AdminGuard>} />
            <Route path="/search" element={<SearchResultsPage />} />
            <Route path="/accounts/:id/graph" element={<MemoryGraphPage />} />
            <Route path="/companies/:id/graph" element={<MemoryGraphPage />} />
            <Route path="/agent" element={<Agent />} />
            <Route path="/agent/activity" element={<AgentActivity />} />
            <Route path="/settings/*" element={<Settings />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </motion.div>
    </AnimatePresence>
  );
}

function AppContent() {
  useKeyboardShortcuts();
  const {
    drawerType, zenMode,
    workflowEditorOpen, workflowEditorId, workflowEditorDraft, closeWorkflowEditor,
    sequenceEditorOpen, sequenceEditorId, sequenceEditorDraft, closeSequenceEditor,
  } = useAppStore();

  const drawerTitle = drawerType === 'contact' ? 'Contact Details'
    : drawerType === 'opportunity' ? 'Opportunity Details'
    : drawerType === 'use-case' ? 'Use Case Details'
    : drawerType === 'account' ? 'Account Details'
    : drawerType === 'assignment' ? 'Assignment Details'
    : drawerType === 'activity' ? 'Activity Details'
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
      <Suspense fallback={null}>
        <DrawerShell title={drawerTitle}>
          {drawerType === 'contact' && <ContactDrawer />}
          {drawerType === 'opportunity' && <OpportunityDrawer />}
          {drawerType === 'use-case' && <UseCaseDrawer />}
          {drawerType === 'account' && <AccountDrawer />}
          {drawerType === 'assignment' && <AssignmentDrawer />}
          {drawerType === 'activity' && <ActivityDrawer />}
          {drawerType === 'workflow' && <WorkflowDrawer />}
          {drawerType === 'email' && <EmailDrawer />}
        </DrawerShell>
      </Suspense>

      {/* Workflow editor — lives at root so it's never unmounted by other state changes */}
      <Suspense fallback={null}>
        <WorkflowEditor
          open={workflowEditorOpen}
          workflowId={workflowEditorId}
          workflow={workflowEditorDraft}
          onClose={closeWorkflowEditor}
          onSaved={closeWorkflowEditor}
        />
      </Suspense>

      {/* Sequence editor — same root-level pattern for consistent layering */}
      <Suspense fallback={null}>
        <SequenceEditor
          open={sequenceEditorOpen}
          sequenceId={sequenceEditorId}
          sequence={sequenceEditorDraft}
          onClose={closeSequenceEditor}
          onSaved={closeSequenceEditor}
        />
      </Suspense>

      {/* Overlays */}
      <CommandPalette />
      <ShortcutsOverlay />
      <Suspense fallback={null}>
        <QuickAddDrawer />
        <EmailDraftDrawer />
      </Suspense>

    </div>
  );
}

export function App() {
  return (
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter basename="/app">
        <ThemeApplier />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/setup/:token" element={<SetupPage />} />
          <Route
            path="/*"
            element={
              <AuthGuard>
                <AgentSettingsProvider>
                  <AppContent />
                </AgentSettingsProvider>
              </AuthGuard>
            }
          />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  );
}
