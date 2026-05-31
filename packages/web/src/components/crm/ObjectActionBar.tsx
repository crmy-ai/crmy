// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ElementType } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Brain, Bot, FileText, MailPlus, Pencil } from 'lucide-react';
import { useAgentSettings } from '@/contexts/AgentSettingsContext';
import { useAppStore, type AIContextEntity } from '@/store/appStore';

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
  const { openAIWithContext, openQuickAdd, openEmailDraft, closeDrawer } = useAppStore();
  const subjectType = context.type === 'use-case' ? 'use_case' : context.type;

  return (
    <div className="mx-4 mt-3 rounded-2xl border border-border bg-card p-2.5">
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Actions</p>
        <p className="hidden text-xs text-muted-foreground sm:block">Use this record as the working scope.</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {agentEnabled && (
          <ActionButton
            icon={Bot}
            label="Ask Agent"
            iconClassName="text-violet-500"
            onClick={() => {
              openAIWithContext(context);
              closeDrawer();
              navigate('/agent');
            }}
          />
        )}
        {agentEnabled && (
          <ActionButton
            icon={Pencil}
            label="Update with Agent"
            iconClassName="text-violet-500"
            onClick={() => {
              closeDrawer();
              openQuickAdd(context.type, {
                mode: 'edit',
                record_id: context.id,
                record_name: context.name,
                parent_subject_type: subjectType,
                parent_subject_id: context.id,
                parent_subject_name: context.name,
              });
            }}
          />
        )}
        {onBrief ? (
          <ActionButton icon={FileText} label="Generate Brief" iconClassName="text-primary" onClick={onBrief} />
        ) : <div />}
        <ActionButton
          icon={Brain}
          label="Add Context"
          iconClassName="text-sky-500"
          onClick={() => {
            closeDrawer();
            const params = new URLSearchParams({
              tab: 'observations',
              add: 'context',
              subject_type: subjectType,
              subject_id: context.id,
              subject_label: context.name,
              return_subject_type: subjectType,
              return_subject_id: context.id,
              return_subject_label: context.name,
            });
            navigate(`/context?${params.toString()}`);
          }}
        />
        <ActionButton
          icon={MailPlus}
          label="Draft Email"
          iconClassName="text-blue-500"
          onClick={() => {
            closeDrawer();
            openEmailDraft({
              subject_type: subjectType,
              subject_id: context.id,
              ...(context.type === 'contact' ? { contact_id: context.id } : {}),
              ...(context.type === 'account' ? { account_id: context.id } : {}),
              ...(context.type === 'opportunity' ? { opportunity_id: context.id } : {}),
              ...(context.type === 'use-case' ? { use_case_id: context.id } : {}),
              intent: 'follow_up',
            });
          }}
        />
        <ActionButton
          icon={Activity}
          label="Log Activity"
          iconClassName="text-warning"
          onClick={() => {
            closeDrawer();
            openQuickAdd('activity', {
              parent_subject_type: subjectType,
              parent_subject_id: context.id,
              parent_subject_name: context.name,
              defaults: {
                subject_type: subjectType,
                subject_id: context.id,
              },
            });
          }}
        />
      </div>
    </div>
  );
}
