// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { useUseCase, useUseCaseTimeline, useUpdateUseCase, useDeleteUseCase, useUsers, useCustomFields, useOpportunities } from '@/api/hooks';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store/appStore';
import { useAgentSettings } from '@/contexts/AgentSettingsContext';
import { Sparkles, Calendar, Bot, DollarSign, Pencil, ChevronLeft, Trash2, FileText } from 'lucide-react';
import { ContextPanel } from './ContextPanel';
import { BriefingPanel } from './BriefingPanel';
import { CustomFieldsSection } from './CrmWidgets';
import { ActivityTimeline } from './ActivityTimeline';
import { useCaseStageConfig } from '@/lib/stageConfig';
import { toast } from '@/components/ui/use-toast';
import { DatePicker } from '@/components/ui/date-picker';

const inputClass = 'w-full h-10 px-3 rounded-md border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';
const labelClass = 'text-xs font-mono text-muted-foreground uppercase tracking-wider';

const UC_STAGES = ['discovery', 'poc', 'production', 'scaling', 'sunset'];

function UseCaseStageBadge({ stage }: { stage: string }) {
  const config = useCaseStageConfig[stage] ?? { label: stage, color: '#94a3b8' };
  return (
    <span
      className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold"
      style={{ backgroundColor: config.color + '18', color: config.color }}
    >
      {config.label}
    </span>
  );
}

function UseCaseEditForm({
  useCase,
  onSave,
  onCancel,
  onDelete,
  isSaving,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useCase: any;
  onSave: (data: Record<string, unknown>) => void;
  onCancel: () => void;
  onDelete: () => void;
  isSaving: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({
    name: useCase.name ?? '',
    stage: useCase.stage ?? 'discovery',
    description: useCase.description ?? '',
    attributed_arr: useCase.attributed_arr != null ? String(useCase.attributed_arr) : '',
    currency_code: useCase.currency_code ?? 'USD',
    expansion_potential: useCase.expansion_potential != null ? String(useCase.expansion_potential) : '',
    unit_label: useCase.unit_label ?? '',
    consumption_unit: useCase.consumption_unit ?? '',
    consumption_capacity: useCase.consumption_capacity != null ? String(useCase.consumption_capacity) : '',
    started_at: useCase.started_at ? useCase.started_at.slice(0, 10) : '',
    target_prod_date: useCase.target_prod_date ? useCase.target_prod_date.slice(0, 10) : '',
    sunset_date: useCase.sunset_date ? useCase.sunset_date.slice(0, 10) : '',
    tags: Array.isArray(useCase.tags) ? useCase.tags.join(', ') : '',
    opportunity_id: useCase.opportunity_id ?? '',
    owner_id: useCase.owner_id ?? '',
  });

  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    if (useCase.custom_fields) {
      for (const [k, v] of Object.entries(useCase.custom_fields as Record<string, unknown>)) {
        init[k] = String(v ?? '');
      }
    }
    return init;
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: usersData } = useUsers() as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const users: any[] = usersData?.data ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: oppsData } = useOpportunities({ limit: 200 }) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opportunities: any[] = oppsData?.data ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: customFieldDefs } = useCustomFields('use_case') as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fieldDefs: any[] = customFieldDefs?.fields ?? [];

  const set = (key: string, val: string) => setFields(prev => ({ ...prev, [key]: val }));
  const setCF = (key: string, val: string) => setCustomFieldValues(prev => ({ ...prev, [key]: val }));

  const handleSave = () => {
    const payload: Record<string, unknown> = {};
    const numericKeys = ['attributed_arr', 'expansion_potential', 'consumption_capacity'];
    for (const [k, v] of Object.entries(fields)) {
      if (k === 'tags') continue; // handled separately
      if (v === '') continue;
      if (numericKeys.includes(k)) payload[k] = Number(v) || 0;
      else payload[k] = v;
    }
    // Tags: parse comma-separated string into array
    const tagsRaw = fields.tags.trim();
    payload.tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];
    const cfPayload: Record<string, unknown> = {};
    for (const def of fieldDefs) {
      const val = customFieldValues[def.field_key] ?? '';
      if (val === '') continue;
      if (def.field_type === 'number') cfPayload[def.field_key] = Number(val);
      else if (def.field_type === 'boolean') cfPayload[def.field_key] = val === 'true';
      else cfPayload[def.field_key] = val;
    }
    if (Object.keys(cfPayload).length > 0) payload.custom_fields = cfPayload;
    onSave(payload);
  };

  const sectionLabel = (text: string) => (
    <div className="border-t border-border pt-3 mt-1">
      <p className={labelClass}>{text}</p>
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-border">
        <button onClick={onCancel} className="flex items-center gap-1 text-xs text-accent hover:underline">
          <ChevronLeft className="w-3.5 h-3.5" /> Back
        </button>
        <span className="text-xs text-muted-foreground ml-auto">Editing use case</span>
      </div>
      <div className="flex-1 overflow-y-auto p-5 space-y-4">

        {/* Basic */}
        <div className="space-y-1.5">
          <label className={labelClass}>Name<span className="text-destructive ml-0.5">*</span></label>
          <input type="text" value={fields.name} onChange={e => set('name', e.target.value)} placeholder="Use case name" className={inputClass} />
        </div>
        <div className="space-y-1.5">
          <label className={labelClass}>Stage</label>
          <select value={fields.stage} onChange={e => set('stage', e.target.value)} className={`${inputClass} pr-3`}>
            {UC_STAGES.map(s => (
              <option key={s} value={s}>{useCaseStageConfig[s]?.label ?? s}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className={labelClass}>Description</label>
          <textarea
            value={fields.description}
            onChange={e => set('description', e.target.value)}
            placeholder="Optional description"
            rows={3}
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring resize-none"
          />
        </div>
        <div className="space-y-1.5">
          <label className={labelClass}>Tags <span className="normal-case font-normal">(comma-separated)</span></label>
          <input type="text" value={fields.tags} onChange={e => set('tags', e.target.value)} placeholder="e.g. ai, billing, high-priority" className={inputClass} />
        </div>

        {/* Commercial */}
        {sectionLabel('Commercial')}
        <div className="space-y-1.5">
          <label className={labelClass}>Attributed ARR ($)</label>
          <input type="number" value={fields.attributed_arr} onChange={e => set('attributed_arr', e.target.value)} placeholder="e.g. 120000" className={inputClass} />
        </div>
        <div className="space-y-1.5">
          <label className={labelClass}>Expansion Potential ($)</label>
          <input type="number" value={fields.expansion_potential} onChange={e => set('expansion_potential', e.target.value)} placeholder="e.g. 50000" className={inputClass} />
        </div>
        <div className="space-y-1.5">
          <label className={labelClass}>Currency</label>
          <input type="text" value={fields.currency_code} onChange={e => set('currency_code', e.target.value.toUpperCase().slice(0, 3))} placeholder="USD" maxLength={3} className={inputClass} />
        </div>

        {/* Consumption */}
        {sectionLabel('Consumption')}
        <div className="space-y-1.5">
          <label className={labelClass}>Unit Label</label>
          <input type="text" value={fields.unit_label} onChange={e => set('unit_label', e.target.value)} placeholder="e.g. API calls, seats, documents" className={inputClass} />
        </div>
        <div className="space-y-1.5">
          <label className={labelClass}>Consumption Unit</label>
          <input type="text" value={fields.consumption_unit} onChange={e => set('consumption_unit', e.target.value)} placeholder="e.g. calls/month" className={inputClass} />
        </div>
        <div className="space-y-1.5">
          <label className={labelClass}>Consumption Capacity</label>
          <input type="number" value={fields.consumption_capacity} onChange={e => set('consumption_capacity', e.target.value)} placeholder="e.g. 10000" className={inputClass} />
        </div>

        {/* Timeline */}
        {sectionLabel('Timeline')}
        <div className="space-y-1.5">
          <label className={labelClass}>Start Date</label>
          <DatePicker value={fields.started_at} onChange={val => set('started_at', val)} placeholder="Select start date" />
        </div>
        <div className="space-y-1.5">
          <label className={labelClass}>Production Date</label>
          <DatePicker value={fields.target_prod_date} onChange={val => set('target_prod_date', val)} placeholder="Select production date" />
        </div>
        <div className="space-y-1.5">
          <label className={labelClass}>Sunset Date</label>
          <DatePicker value={fields.sunset_date} onChange={val => set('sunset_date', val)} placeholder="Select sunset date" />
        </div>

        {/* Ownership */}
        {sectionLabel('Ownership')}
        {opportunities.length > 0 && (
          <div className="space-y-1.5">
            <label className={labelClass}>Linked Opportunity</label>
            <select value={fields.opportunity_id} onChange={e => set('opportunity_id', e.target.value)} className={`${inputClass} pr-3`}>
              <option value="">None</option>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {opportunities.map((o: any) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
        )}
        {users.length > 0 && (
          <div className="space-y-1.5">
            <label className={labelClass}>Owner</label>
            <select value={fields.owner_id} onChange={e => set('owner_id', e.target.value)} className={`${inputClass} pr-3`}>
              <option value="">Unassigned</option>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {users.map((u: any) => (
                <option key={u.id} value={u.id}>{u.name || u.email}</option>
              ))}
            </select>
          </div>
        )}

        {/* Custom Fields */}
        {fieldDefs.length > 0 && (
          <>
            {sectionLabel('Custom Fields')}
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {fieldDefs.map((def: any) => (
              <div key={def.field_key} className="space-y-1.5">
                <label className={labelClass}>{def.label}{def.required && <span className="text-destructive ml-0.5">*</span>}</label>
                {(def.field_type === 'text' || !def.field_type) && (
                  <input type="text" value={customFieldValues[def.field_key] ?? ''} onChange={e => setCF(def.field_key, e.target.value)} className={inputClass} />
                )}
                {def.field_type === 'number' && (
                  <input type="number" value={customFieldValues[def.field_key] ?? ''} onChange={e => setCF(def.field_key, e.target.value)} className={inputClass} />
                )}
                {def.field_type === 'date' && (
                  <DatePicker value={customFieldValues[def.field_key] ?? ''} onChange={val => setCF(def.field_key, val)} required={def.required} />
                )}
                {def.field_type === 'boolean' && (
                  <div className="flex items-center gap-2 h-10">
                    <input type="checkbox" checked={customFieldValues[def.field_key] === 'true'} onChange={e => setCF(def.field_key, e.target.checked ? 'true' : 'false')} className="w-4 h-4 rounded border-border accent-primary" />
                    <span className="text-sm text-foreground">Yes</span>
                  </div>
                )}
                {(def.field_type === 'select' || def.field_type === 'multi_select') && (
                  <select value={customFieldValues[def.field_key] ?? ''} onChange={e => setCF(def.field_key, e.target.value)} className={`${inputClass} pr-3`}>
                    <option value="">Select…</option>
                    {(def.options ?? []).map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                )}
              </div>
            ))}
          </>
        )}

        {useCase.created_at && (
          <div className="flex items-center justify-between py-2 border-t border-border mt-2">
            <span className="text-xs text-muted-foreground">Created</span>
            <span className="text-xs text-muted-foreground">{new Date(useCase.created_at as string).toLocaleDateString()}</span>
          </div>
        )}
        <button
          onClick={handleSave}
          disabled={!fields.name.trim() || isSaving}
          className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors"
        >
          {isSaving ? 'Saving…' : 'Save Changes'}
        </button>
        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="w-full h-9 rounded-md border border-destructive/40 text-destructive text-sm font-medium hover:bg-destructive/10 transition-colors flex items-center justify-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete Use Case
          </button>
        ) : (
          <div className="flex gap-2">
            <button onClick={() => setConfirmDelete(false)} className="flex-1 h-9 rounded-md border border-border text-sm text-muted-foreground hover:bg-muted/50 transition-colors">
              Cancel
            </button>
            <button onClick={onDelete} className="flex-1 h-9 rounded-md bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 transition-colors">
              Confirm Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function UseCaseDrawer() {
  const { drawerEntityId, openAIWithContext, closeDrawer } = useAppStore();
  const { enabled: agentEnabled } = useAgentSettings();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [briefing, setBriefing] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: useCaseData, isLoading } = useUseCase(drawerEntityId ?? '') as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: timelineData } = useUseCaseTimeline(drawerEntityId ?? '') as any;
  const updateUseCase = useUpdateUseCase(drawerEntityId ?? '');
  const deleteUseCase = useDeleteUseCase(drawerEntityId ?? '');

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 p-6 animate-pulse">
        <div className="h-6 bg-muted rounded w-3/4" />
        <div className="h-4 bg-muted rounded w-1/2" />
      </div>
    );
  }

  if (!useCaseData?.use_case) {
    return <div className="p-4 text-muted-foreground">Use case not found</div>;
  }

  const useCase = useCaseData.use_case;
  const name: string = useCase.name ?? '';
  const stage: string = useCase.stage ?? '';
  const arr: number = useCase.attributed_arr ?? 0;
  const healthScore: number = useCase.health_score ?? 0;

  const timeline: Array<Record<string, unknown>> = timelineData?.data ?? timelineData ?? [];

  if (briefing) {
    return <BriefingPanel subjectType="use_case" subjectId={drawerEntityId!} onClose={() => setBriefing(false)} />;
  }

  if (editing) {
    return (
      <UseCaseEditForm
        useCase={useCase}
        onSave={async (data) => {
          try {
            await updateUseCase.mutateAsync(data);
            setEditing(false);
            toast({ title: 'Use case updated' });
          } catch (err) {
            toast({ title: 'Failed to update use case', description: err instanceof Error ? err.message : 'Please try again.', variant: 'destructive' });
          }
        }}
        onCancel={() => setEditing(false)}
        onDelete={async () => {
          try {
            await deleteUseCase.mutateAsync();
            closeDrawer();
            toast({ title: 'Use case deleted' });
          } catch (err) {
            toast({ title: 'Failed to delete use case', description: err instanceof Error ? err.message : 'Please try again.', variant: 'destructive' });
          }
        }}
        isSaving={updateUseCase.isPending}
      />
    );
  }

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-border">
        <h2 className="font-display font-extrabold text-xl text-foreground">{name}</h2>
        <div className="flex items-center gap-2 mt-3">
          {stage && <UseCaseStageBadge stage={stage} />}
        </div>
        <div className="flex gap-2 mt-4">
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-muted text-foreground text-sm font-medium hover:bg-muted/80 transition-all press-scale"
          >
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
          <button
            onClick={() => setBriefing(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-muted text-foreground text-sm font-medium hover:bg-muted/80 transition-all press-scale"
          >
            <FileText className="w-3.5 h-3.5" /> Brief
          </button>
          {agentEnabled && (
            <button
              onClick={() => {
                openAIWithContext({ type: 'use-case', id: useCase.id, name, detail: stage });
                closeDrawer();
                navigate('/agent');
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-accent/30 bg-accent/5 text-accent text-sm font-semibold hover:bg-accent/10 transition-all ml-auto press-scale"
            >
              <Sparkles className="w-3.5 h-3.5" /> Chat
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 p-4 mx-4 mt-4">
        {[
          { icon: DollarSign, label: 'Attributed ARR', value: arr ? `$${(arr / 1000).toFixed(0)}K` : '—' },
          { icon: Calendar, label: 'Stage', value: (useCaseStageConfig[stage]?.label ?? stage) || '—' },
          { icon: Bot, label: 'Health', value: healthScore ? String(healthScore) : '—' },
        ].map((stat) => (
          <div key={stat.label} className="bg-muted/50 rounded-xl p-3 text-center">
            <stat.icon className="w-4 h-4 text-muted-foreground mx-auto mb-1" />
            <p className="text-sm font-display font-bold text-foreground truncate">{stat.value}</p>
            <p className="text-xs text-muted-foreground">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Details */}
      <div className="p-4 mx-4 mt-2 space-y-3">
        <h3 className="text-xs font-display font-bold text-muted-foreground uppercase tracking-wide">Details</h3>
        {[
          { label: 'Stage', value: useCaseStageConfig[stage]?.label ?? stage },
          { label: 'Health Score', value: healthScore ? String(healthScore) : undefined },
          { label: 'Prod Date', value: useCase.target_prod_date ? new Date(useCase.target_prod_date as string).toLocaleDateString() : undefined },
          { label: 'Created', value: useCase.created_at ? new Date(useCase.created_at as string).toLocaleDateString() : undefined },
        ]
          .filter((f) => f.value)
          .map((field) => (
            <div key={field.label} className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{field.label}</span>
              <span className="text-sm text-foreground">{field.value}</span>
            </div>
          ))}
      </div>

      {/* Custom Fields */}
      <CustomFieldsSection objectType="use_case" values={(useCase.custom_fields ?? {}) as Record<string, unknown>} />

      {/* Context */}
      <ContextPanel subjectType="use_case" subjectId={drawerEntityId!} />

      {/* Timeline */}
      {timeline.length > 0 && (
        <div className="p-4 mx-4 mt-2 mb-6">
          <h3 className="text-xs font-display font-bold text-muted-foreground uppercase tracking-wide mb-3">Timeline</h3>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <ActivityTimeline activities={timeline as any[]} />
        </div>
      )}
    </div>
  );
}
