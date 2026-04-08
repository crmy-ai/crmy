// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { TopBar } from '@/components/layout/TopBar';
import { Library } from 'lucide-react';
import { ContextBrowser } from '@/components/crm/ContextBrowser';

export default function ContextPage() {
  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Context"
        icon={Library}
        iconClassName="text-[#0ea5e9]"
        description="Structured memory written by agents after every interaction. Used to power briefings."
      />
      <ContextBrowser />
    </div>
  );
}
