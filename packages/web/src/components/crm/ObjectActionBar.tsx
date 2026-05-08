// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useNavigate } from 'react-router-dom';
import { Activity, Brain, FileText, ScrollText, Sparkles } from 'lucide-react';
import { useAgentSettings } from '@/contexts/AgentSettingsContext';
import { useAppStore, type AIContextEntity } from '@/store/appStore';

export function ObjectActionBar({
  context,
  onBrief,
}: {
  context: AIContextEntity;
  onBrief?: () => void;
}) {
  const navigate = useNavigate();
  const { enabled: agentEnabled } = useAgentSettings();
  const { openAIWithContext, openQuickAdd, closeDrawer } = useAppStore();

  const buttonClass = 'inline-flex items-center justify-center gap-1.5 h-8 px-2.5 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-muted transition-colors';

  return (
    <div className="mx-4 mt-3 rounded-xl border border-border bg-card p-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {onBrief && (
          <button onClick={onBrief} className={buttonClass}>
            <FileText className="w-3.5 h-3.5 text-primary" /> Brief
          </button>
        )}
        <button
          onClick={() => {
            if (agentEnabled) {
              openAIWithContext(context);
              closeDrawer();
              navigate('/agent');
            } else {
              closeDrawer();
              navigate('/settings/model');
            }
          }}
          className={buttonClass}
        >
          <Sparkles className="w-3.5 h-3.5 text-accent" />
          {agentEnabled ? 'Ask Agent' : 'Set Up Agent'}
        </button>
        <button
          onClick={() => {
            closeDrawer();
            navigate('/context');
          }}
          className={buttonClass}
        >
          <Brain className="w-3.5 h-3.5 text-sky-500" /> Add Context
        </button>
        <button
          onClick={() => {
            closeDrawer();
            openQuickAdd('activity');
          }}
          className={buttonClass}
        >
          <Activity className="w-3.5 h-3.5 text-warning" /> Log Activity
        </button>
        <button
          onClick={() => {
            closeDrawer();
            navigate('/audit-log');
          }}
          className={buttonClass}
        >
          <ScrollText className="w-3.5 h-3.5 text-violet-400" /> Audit
        </button>
      </div>
    </div>
  );
}
