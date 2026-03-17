// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { useOpportunity, useUpdateOpportunity, useDeleteOpportunity, useUsers, useCustomFields } from '@/api/hooks';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store/appStore';
import { useAgentSettings } from '@/contexts/AgentSettingsContext';
import { StageBadge, CustomFieldsSection } from './CrmWidgets';
import { Sparkles, TrendingUp, Calendar, User, Pencil, ChevronLeft, Trash2, FileText } from 'lucide-react';
import { ContextPanel } from './ContextPanel';
import { BriefingPanel } from './BriefingPanel';
import { toast } from '@/components/ui/use-toast';
import { DatePicker } from '@/components/ui/date-picker';

const inputClass = 'w-full h-10 px-3 rounded-md border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';
const labelClass = 'text-xs font-mono text-muted-foreground uppercase tracking-wider';

const OPP_STAGES = ['prospecting', 'qualification', 'proposal', 'negotiation', 'closed_won', 'closed_lost'];

function OpportunityEditForm({
  opportunity,
  onSave,
  onCancel,
  onDelete,
  isSaving,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  opportunity: any;
  onSave: (data: Record<string, unknown>) => void;
  onCancel: () => void;
  onDelete: () => void;
  isSaving: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({
    name: opportunity.name ?? '',
    amount: opportunity.amount != null ? String(opportunity.amount) : '',
    stage: opportunity.stage ?? 'prospecting',
    close_date: opportunity.close_date ? opportunity.close_date.slice(0, 10) : '',
    probability: opportunity.probability != null ? String(opportunity.probability) : '',
    description: opportunity.description ?? '',
    owner_id: opportunity.owner_id ?? '',
  });

  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    if (opportunity.custom_fields) {
      for (const [k, v] of Object.entries(opportunity.custom_fields as Record<string, unknown>)) {
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
  const { data: customFieldDefs } = useCustomFields('opportunity') as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fieldDefs: any[] = customFieldDefs?.fields ?? [];

  const set = (key: string, val: string) => setFields(prev => ({ ...prev, [key]: val }));
  const setCF = (key: string, val: string) => setCustomFieldValues(prev => ({ ...prev, [key]: val }));

  const handleSave = () => {
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v === '') continue;
      if (k === 'amount' || k === 'probability') payload[k] = Number(v) || 0;
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
        <span className="text-xs text-muted-foreground ml-auto">Editing opportunity</span>
      </div>
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <div className="space-y-1.5">
          <label className={labelClass}>Opportunity Name<span className="text-destructive ml-0.5">*</span></label>
          <input type="text" value={fields.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Acme Enterprise" className={inputClass} />
        </div>
        <div className="space-y-1.5">
          <label className={labelClass}>Stage</label>
          <select value={fields.stage} onChange={e => set('stage', e.target.value)} className={`${inputClass} pr-3`}>
            {OPP_STAGES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>)}
          </select>
        </div>
        {[
          { key: 'amount', label: 'Amount ($)', type: 'number', placeholder: '50000' },
          { key: 'close_date', label: 'Close Date', type: 'date', placeholder: '' },
          { key: 'probability', label: 'Probability (%)', type: 'number', placeholder: '50' },
        ].map(f => (
          <div key={f.key} className="space-y-1.5">
            <label className={labelClass}>{f.label}</label>
            {f.type === 'date' ? (
              <DatePicker
                value={fields[f.key] ?? ''}
                onChange={val => set(f.key, val)}
                placeholder="Select close date"
              />
            ) : (
              <input type={f.type} value={fields[f.key]} onChange={e => set(f.key, e.target.value)} placeholder={f.placeholder} className={inputClass} />
            )}
          </div>
        ))}
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
            placeholder="Optional notes"
            rows={3}
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring resize-none"
          />
        </div>
        {fieldDefs.length > 0 && (
          <>
            <div className="border-t border-border pt-2">
              <p className={labelClass}>Custom Fields</p>
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
                  <DatePicker
                    value={customFieldValues[def.field_key] ?? ''}
                    onChange={val => setCF(def.field_key, val)}
                    required={def.required}
                  />
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
        {opportunity.created_at && (
          <div className="flex items-center justify-between py-2 border-t border-border mt-2">
            <span className="text-xs text-muted-foreground">Created</span>
            <span className="text-xs text-muted-foreground">{new Date(opportunity.created_at as string).toLocaleDateString()}</span>
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
            <Trash2 className="w-3.5 h-3.5" /> Delete Opportunity
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

export function OpportunityDrawer() {
  const { drawerEntityId, openAIWithContext, closeDrawer } = useAppStore();
  const { enabled: agentEnabled } = useAgentSettings();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [briefing, setBriefing] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: oppData, isLoading } = useOpportunity(drawerEntityId ?? '') as any;
  const updateOpportunity = useUpdateOpportunity(drawerEntityId ?? '');
  const deleteOpportunity = useDeleteOpportunity(drawerEntityId ?? '');

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 p-6 animate-pulse">
        <div className="h-6 bg-muted rounded w-3/4" />
        <div className="h-4 bg-muted rounded w-1/2" />
      </div>
    );
  }

  if (!oppData?.opportunity) {
    return <div className="p-4 text-muted-foreground">Opportunity not found</div>;
  }

  const opportunity = oppData.opportunity;
  const name: string = opportunity.name ?? '';
  const amount: number = opportunity.amount ?? 0;
  const stage: string = opportunity.stage ?? '';
  const probability: number = opportunity.probability ?? 0;
  const forecastCat: string = opportunity.forecast_cat ?? '';
  const closeDate: string = opportunity.close_date ? new Date(opportunity.close_date as string).toLocaleDateString() : '—';

  if (briefing) {
    return <BriefingPanel subjectType="opportunity" subjectId={drawerEntityId!} onClose={() => setBriefing(false)} />;
  }

  if (editing) {
    return (
      <OpportunityEditForm
        opportunity={opportunity}
        onSave={async (data) => {
          try {
            await updateOpportunity.mutateAsync(data);
            setEditing(false);
            toast({ title: 'Opportunity updated' });
          } catch (err) {
            toast({ title: 'Failed to update opportunity', description: err instanceof Error ? err.message : 'Please try again.', variant: 'destructive' });
          }
        }}
        onCancel={() => setEditing(false)}
        onDelete={async () => {
          try {
            await deleteOpportunity.mutateAsync();
            closeDrawer();
            toast({ title: 'Opportunity deleted' });
          } catch (err) {
            toast({ title: 'Failed to delete opportunity', description: err instanceof Error ? err.message : 'Please try again.', variant: 'destructive' });
          }
        }}
        isSaving={updateOpportunity.isPending}
      />
    );
  }

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-border">
        <h2 className="font-display font-extrabold text-xl text-foreground">{name}</h2>
        <p className="text-3xl font-display font-extrabold text-foreground mt-2">
          ${amount >= 1000 ? `${(amount / 1000).toFixed(0)}K` : amount}
        </p>
        <div className="flex items-center gap-2 mt-3">
          {stage && <StageBadge stage={stage} />}
          {probability > 0 && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-accent/10 text-accent">
              {probability}% probability
            </span>
          )}
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
                openAIWithContext({ type: 'opportunity', id: opportunity.id, name, detail: `$${(amount / 1000).toFixed(0)}K` });
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
          { icon: TrendingUp, label: 'Probability', value: `${probability}%` },
          { icon: Calendar, label: 'Close Date', value: closeDate },
          { icon: User, label: 'Forecast', value: forecastCat || '—' },
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
          { label: 'Stage', value: stage },
          { label: 'Forecast', value: forecastCat || undefined },
          { label: 'Created', value: opportunity.created_at ? new Date(opportunity.created_at as string).toLocaleDateString() : undefined },
        ]
          .filter((f) => f.value)
          .map((field) => (
            <div key={field.label} className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{field.label}</span>
              <span className="text-sm text-foreground">{field.value}</span>
            </div>
          ))}
        {opportunity.notes && (
          <div>
            <p className="text-xs text-muted-foreground mb-1">Notes</p>
            <p className="text-sm text-foreground leading-relaxed">{opportunity.notes as string}</p>
          </div>
        )}
      </div>

      {/* Custom Fields */}
      <CustomFieldsSection objectType="opportunity" values={(opportunity.custom_fields ?? {}) as Record<string, unknown>} />

      {/* Context */}
      <ContextPanel subjectType="opportunity" subjectId={drawerEntityId!} />
    </div>
  );
}
