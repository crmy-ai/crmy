// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Outlet, Navigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function Shell() {
  const token = localStorage.getItem('crmy_token');
  if (!token) return <Navigate to="/app/login" replace />;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
