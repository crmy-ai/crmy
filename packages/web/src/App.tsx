// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { Shell } from './components/layout/Shell';
import { LoginPage } from './pages/auth/Login';
import { DashboardPage } from './pages/Dashboard';
import { ContactListPage } from './pages/contacts/ContactList';
import { ContactDetailPage } from './pages/contacts/ContactDetail';
import { ContactCreatePage } from './pages/contacts/ContactCreate';
import { AccountListPage } from './pages/accounts/AccountList';
import { AccountDetailPage } from './pages/accounts/AccountDetail';
import { AccountCreatePage } from './pages/accounts/AccountCreate';
import { PipelinePage } from './pages/pipeline/Pipeline';
import { OpportunityDetailPage } from './pages/opportunities/OpportunityDetail';
import { OpportunityCreatePage } from './pages/opportunities/OpportunityCreate';
import { UseCaseListPage } from './pages/use-cases/UseCaseList';
import { UseCaseDetailPage } from './pages/use-cases/UseCaseDetail';
import { UseCaseCreatePage } from './pages/use-cases/UseCaseCreate';
import { ActivityListPage } from './pages/activities/ActivityList';
import { AnalyticsPage } from './pages/analytics/Analytics';
import { HITLPage } from './pages/hitl/HITL';
import { SettingsPage } from './pages/settings/Settings';
import { SearchResultsPage } from './pages/SearchResults';

const router = createBrowserRouter([
  {
    path: '/app/login',
    element: <LoginPage />,
  },
  {
    path: '/app',
    element: <Shell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'contacts', element: <ContactListPage /> },
      { path: 'contacts/new', element: <ContactCreatePage /> },
      { path: 'contacts/:id', element: <ContactDetailPage /> },
      { path: 'accounts', element: <AccountListPage /> },
      { path: 'accounts/new', element: <AccountCreatePage /> },
      { path: 'accounts/:id', element: <AccountDetailPage /> },
      { path: 'pipeline', element: <PipelinePage /> },
      { path: 'opportunities/new', element: <OpportunityCreatePage /> },
      { path: 'opportunities/:id', element: <OpportunityDetailPage /> },
      { path: 'use-cases', element: <UseCaseListPage /> },
      { path: 'use-cases/new', element: <UseCaseCreatePage /> },
      { path: 'use-cases/:id', element: <UseCaseDetailPage /> },
      { path: 'activities', element: <ActivityListPage /> },
      { path: 'analytics', element: <AnalyticsPage /> },
      { path: 'hitl', element: <HITLPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'search', element: <SearchResultsPage /> },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/app" replace />,
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
