// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ElementType } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Brain, FileText, ScrollText, Sparkles } from 'lucide-react';
import { useAgentSettings } from '@/contexts/AgentSettingsContext';
import { useAppStore, type AIContextEntity } from '@/store/appStore';

const AUDIT_OBJECT_TYPE: Record<AIContextEntity['type'], string> = {
  account: 'account',
  contact: 'contact',
  opportunity: 'opportunity',
  'use-case': 'use_case',
};

function ActionButton({
  icon: Icon,
  label,
  iconClassName,
  onClick,
}: {
  icon: ElementType;
  label: string;
  iconClassName: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-10 items-center justify-center gap-2 rounded-xl border border-border bg-background px-2.5 text-sm font-semibold text-foreground transition-colors hover:border-primary/30 hover:bg-muted"
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icon className={`h-4 w-4 ${iconClassName}`} />
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

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

  return (
    <div className="mx-4 mt-3 rounded-2xl border border-border bg-card p-2.5">
      <div className="grid grid-cols-2 gap-2">
        {onBrief && (
          <ActionButton icon={FileText} label="Brief" iconClassName="text-primary" onClick={onBrief} />
        )}
        {agentEnabled && (
          <ActionButton
            icon={Sparkles}
            label="Ask Agent"
            iconClassName="text-accent"
            onClick={() => {
              openAIWithContext(context);
              closeDrawer();
              navigate('/agent');
            }}
          />
        )}
        {!agentEnabled && (
          <ActionButton
            icon={Activity}
            label="Log Activity"
            iconClassName="text-warning"
            onClick={() => {
              closeDrawer();
              openQuickAdd('activity');
            }}
          />
        )}
        <ActionButton
          icon={Brain}
          label="Add Context"
          iconClassName="text-sky-500"
          onClick={() => {
            closeDrawer();
            navigate('/context');
          }}
        />
        <ActionButton
          icon={ScrollText}
          label="View Audit"
          iconClassName="text-violet-400"
          onClick={() => {
            closeDrawer();
            const objectType = AUDIT_OBJECT_TYPE[context.type];
            navigate(`/audit-log?object_type=${encodeURIComponent(objectType)}&object_id=${encodeURIComponent(context.id)}`);
          }}
        />
      </div>
    </div>
  );
}
