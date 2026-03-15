// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { useUseCase, useUseCaseTimeline, useUpdateUseCase, useUsers, useCustomFields } from '@/api/hooks';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store/appStore';
import { Sparkles, Calendar, Bot, DollarSign, Pencil, ChevronLeft } from 'lucide-react';
import { CustomFieldsSection } from './CrmWidgets';
import { useCaseStageConfig } from '@/lib/stageConfig';
import { toast } from '@/components/ui/use-toast';

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
  isSaving,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useCase: any;
  onSave: (data: Record<string, unknown>) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [fields, setFields] = useState<Record<string, string>>({
    name: useCase.name ?? '',
    stage: useCase.stage ?? 'discovery',
    description: useCase.description ?? '',
    attributed_arr: useCase.attributed_arr != null ? String(useCase.attributed_arr) : '',
    target_prod_date: useCase.target_prod_date ? useCase.target_prod_date.slice(0, 10) : '',
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
  const { data: customFieldDefs } = useCustomFields('use_case') as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fieldDefs: any[] = customFieldDefs?.fields ?? [];

  const set = (key: string, val: string) => setFields(prev => ({ ...prev, [key]: val }));
  const setCF = (key: string, val: string) => setCustomFieldValues(prev => ({ ...prev, [key]: val }));

  const handleSave = () => {
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v === '') continue;
      if (k === 'attributed_arr') payload[k] = Number(v) || 0;
      else payload[k] = v;
    }
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

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-border">
        <button onClick={onCancel} className="flex items-center gap-1 text-xs text-accent hover:underline">
          <ChevronLeft className="w-3.5 h-3.5" /> Back
        </button>
        <span className="text-xs text-muted-foreground ml-auto">Editing use case</span>
      </div>
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
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
          <label className={labelClass}>Attributed ARR ($)</label>
          <input type="number" value={fields.attributed_arr} onChange={e => set('attributed_arr', e.target.value)} placeholder="e.g. 120000" className={inputClass} />
        </div>
        <div className="space-y-1.5">
          <label className={labelClass}>Production Date</label>
          <input type="date" value={fields.target_prod_date} onChange={e => set('target_prod_date', e.target.value)} className={inputClass} />
        </div>
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
        {fieldDefs.length > 0 && (
          <>
            <div className="border-t border-border pt-2">
              <p className={`${labelClass} mb-0`}>Custom Fields</p>
            </div>
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
                  <input type="date" value={customFieldValues[def.field_key] ?? ''} onChange={e => setCF(def.field_key, e.target.value)} className={inputClass} />
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
      </div>
    </div>
  );
}

export function UseCaseDrawer() {
  const { drawerEntityId, openAIWithContext, closeDrawer } = useAppStore();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: useCaseData, isLoading } = useUseCase(drawerEntityId ?? '') as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: timelineData } = useUseCaseTimeline(drawerEntityId ?? '') as any;
  const updateUseCase = useUpdateUseCase(drawerEntityId ?? '');

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

  if (editing) {
    return (
      <UseCaseEditForm
        useCase={useCase}
        onSave={async (data) => {
          await updateUseCase.mutateAsync(data);
          setEditing(false);
          toast({ title: 'Use case updated' });
        }}
        onCancel={() => setEditing(false)}
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
            onClick={() => {
              openAIWithContext({ type: 'use-case', id: useCase.id, name, detail: stage });
              closeDrawer();
              navigate('/agent');
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-accent/30 bg-accent/5 text-accent text-sm font-semibold hover:bg-accent/10 transition-all ml-auto press-scale"
          >
            <Sparkles className="w-3.5 h-3.5" /> Chat
          </button>
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
            <p className="text-[10px] text-muted-foreground">{stat.label}</p>
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

      {/* Timeline */}
      {timeline.length > 0 && (
        <div className="p-4 mx-4 mt-2 mb-6">
          <h3 className="text-xs font-display font-bold text-muted-foreground uppercase tracking-wide mb-3">Timeline</h3>
          <div className="space-y-3">
            {timeline.map((event, i) => (
              <div key={(event.id as string) ?? i} className="flex gap-3">
                <div className="w-7 h-7 rounded-xl bg-muted flex items-center justify-center text-xs flex-shrink-0">
                  {event.type === 'stage_change' ? '🔄' : event.type === 'health_update' ? '💚' : '📝'}
                </div>
                <div>
                  <p className="text-sm text-foreground">{(event.description ?? event.note ?? event.type) as string}</p>
                  <p className="text-xs text-muted-foreground">
                    {event.created_at ? new Date(event.created_at as string).toLocaleDateString() : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
