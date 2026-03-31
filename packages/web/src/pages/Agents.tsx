// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Users } from 'lucide-react';
import { TopBar } from '@/components/layout/TopBar';
import ActorsSettings from '@/components/settings/ActorsSettings';

export default function ActorsPage() {
  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Actors"
        icon={Users}
        iconClassName="text-[#6366f1]"
        description="Manage humans and AI agents with access to your CRMy workspace."
      />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-24 md:pb-6">
        <ActorsSettings />
      </div>
    </div>
  );
}
