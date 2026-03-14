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
import { AIFab } from '@/components/crm/AIFab';
import { CommandPalette } from '@/components/crm/CommandPalette';
import { ShortcutsOverlay } from '@/components/crm/ShortcutsOverlay';
import { DrawerShell } from '@/components/crm/DrawerShell';
import { QuickAddDrawer } from '@/components/crm/QuickAddDrawer';
import { ContactDrawer } from '@/components/crm/ContactDrawer';
import { DealDrawer } from '@/components/crm/DealDrawer';
import { UseCaseDrawer } from '@/components/crm/UseCaseDrawer';
import { AccountDrawer } from '@/components/crm/AccountDrawer';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useAppStore } from '@/store/appStore';
import { useTheme } from '@/hooks/useTheme';

import { LoginPage } from '@/pages/auth/Login';
import Dashboard from '@/pages/Dashboard';
import Contacts from '@/pages/Contacts';
import Accounts from '@/pages/Accounts';
import Deals from '@/pages/Deals';
import UseCasesPage from '@/pages/UseCases';
import Activities from '@/pages/Activities';
import Agent from '@/pages/Agent';
import Settings from '@/pages/Settings';
import NotFound from '@/pages/NotFound';
import { HITLPage } from '@/pages/hitl/HITL';

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
          <Route path="/deals" element={<Deals />} />
          <Route path="/use-cases" element={<UseCasesPage />} />
          <Route path="/activities" element={<Activities />} />
          <Route path="/agent" element={<Agent />} />
          <Route path="/hitl" element={<HITLPage />} />
          <Route path="/settings/*" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
}

function AppContent() {
  useKeyboardShortcuts();
  const { drawerType, zenMode } = useAppStore();

  const drawerTitle = drawerType === 'contact' ? 'Contact Details'
    : drawerType === 'deal' ? 'Deal Details'
    : drawerType === 'use-case' ? 'Use Case Details'
    : drawerType === 'account' ? 'Account Details'
    : '';

  return (
    <div className="flex h-screen w-full overflow-hidden">
      {!zenMode && <Sidebar />}
      <main className="flex-1 flex flex-col overflow-hidden transition-all duration-200">
        <div className="flex-1 flex flex-col overflow-hidden md:ml-14">
          <AnimatedRoutes />
        </div>
      </main>
      {!zenMode && <MobileNav />}
      {!zenMode && <AIFab />}

      {/* Drawers */}
      <DrawerShell title={drawerTitle}>
        {drawerType === 'contact' && <ContactDrawer />}
        {drawerType === 'deal' && <DealDrawer />}
        {drawerType === 'use-case' && <UseCaseDrawer />}
        {drawerType === 'account' && <AccountDrawer />}
      </DrawerShell>

      {/* Overlays */}
      <CommandPalette />
      <ShortcutsOverlay />
      <QuickAddDrawer />
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
  );
}
