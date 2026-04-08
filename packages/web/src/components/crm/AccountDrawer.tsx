// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { useAccount, useUpdateAccount, useDeleteAccount, useUsers, useCustomFields } from '@/api/hooks';
import { ContactAvatar } from './ContactAvatar';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store/appStore';
import { useAgentSettings } from '@/contexts/AgentSettingsContext';
import { Sparkles, Globe, Users, DollarSign, Heart, Pencil, ChevronLeft, Trash2 } from 'lucide-react';
import { DrawerTabBar, type DrawerView } from './DrawerTabBar';
import { MemoryGraph } from './MemoryGraph';
import { ContextPanel } from './ContextPanel';
import { BriefingPanel } from './BriefingPanel';
import { CustomFieldsSection } from './CrmWidgets';
import { toast } from '@/components/ui/use-toast';
import { DatePicker } from '@/components/ui/date-picker';

const inputClass = 'w-full h-10 px-3 rounded-md border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';
const labelClass = 'text-xs font-mono text-muted-foreground uppercase tracking-wider';

function HealthBadge({ score }: { score: number }) {
  const color = score >= 80 ? 'text-green-400 bg-green-500/15' : score >= 50 ? 'text-yellow-400 bg-yellow-500/15' : 'text-red-400 bg-red-500/15';
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${color}`}>
      <Heart className="w-3 h-3" /> {score}
    </span>
  );
}

function formatRevenue(revenue: number) {
  if (revenue >= 1_000_000) return `$${(revenue / 1_000_000).toFixed(1)}M`;
  if (revenue >= 1_000) return `$${(revenue / 1_000).toFixed(0)}K`;
  return `$${revenue}`;
}

function AccountEditForm({
  account,
  onSave,
  onCancel,
  onDelete,
  isSaving,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  account: any;
  onSave: (data: Record<string, unknown>) => void;
  onCancel: () => void;
  onDelete: () => void;
  isSaving: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({
    name: account.name ?? '',
    industry: account.industry ?? '',
    website: account.website ?? '',
    domain: account.domain ?? '',
    employee_count: account.employee_count != null ? String(account.employee_count) : '',
    annual_revenue: account.annual_revenue != null ? String(account.annual_revenue) : '',
    health_score: account.health_score != null ? String(account.health_score) : '',
    owner_id: account.owner_id ?? '',
  });

  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    if (account.custom_fields) {
      for (const [k, v] of Object.entries(account.custom_fields as Record<string, unknown>)) {
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
  const { data: customFieldDefs } = useCustomFields('account') as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fieldDefs: any[] = customFieldDefs?.fields ?? [];

  const set = (key: string, val: string) => setFields(prev => ({ ...prev, [key]: val }));
  const setCF = (key: string, val: string) => setCustomFieldValues(prev => ({ ...prev, [key]: val }));

  const handleSave = () => {
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v === '') continue;
      if (k === 'employee_count' || k === 'annual_revenue' || k === 'health_score') payload[k] = Number(v) || 0;
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
        <span className="text-xs text-muted-foreground ml-auto">Editing account</span>
      </div>
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {[
          { key: 'name', label: 'Company Name', type: 'text', placeholder: 'e.g. Acme Corp', required: true },
          { key: 'industry', label: 'Industry', type: 'text', placeholder: 'e.g. Technology' },
          { key: 'website', label: 'Website', type: 'url', placeholder: 'https://acme.com' },
          { key: 'domain', label: 'Domain', type: 'text', placeholder: 'acme.com' },
          { key: 'employee_count', label: 'Employees', type: 'number', placeholder: '250' },
          { key: 'annual_revenue', label: 'Annual Revenue ($)', type: 'number', placeholder: '5000000' },
          { key: 'health_score', label: 'Health Score (0–100)', type: 'number', placeholder: '75' },
        ].map(f => (
          <div key={f.key} className="space-y-1.5">
            <label className={labelClass}>{f.label}{f.required && <span className="text-destructive ml-0.5">*</span>}</label>
            <input type={f.type} value={fields[f.key]} onChange={e => set(f.key, e.target.value)} placeholder={f.placeholder} className={inputClass} />
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
            <Trash2 className="w-3.5 h-3.5" /> Delete Account
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

export function AccountDrawer() {
  const { drawerEntityId, openAIWithContext, closeDrawer, drawerBriefing } = useAppStore();
  const { enabled: agentEnabled } = useAgentSettings();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [view, setView] = useState<DrawerView>(drawerBriefing ? 'brief' : 'detail');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: accountData, isLoading } = useAccount(drawerEntityId ?? '') as any;
  const updateAccount = useUpdateAccount(drawerEntityId ?? '');
  const deleteAccount = useDeleteAccount(drawerEntityId ?? '');

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 p-6 animate-pulse">
        <div className="flex gap-4">
          <div className="w-14 h-14 rounded-2xl bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-muted rounded w-3/4" />
            <div className="h-3 bg-muted rounded w-1/2" />
          </div>
        </div>
      </div>
    );
  }

  if (!accountData?.account) {
    return <div className="p-4 text-muted-foreground">Account not found</div>;
  }

  const account = accountData.account;
  const name: string = account.name ?? '';
  const industry: string = account.industry ?? '';
  const website: string = account.website ?? '';
  const revenue: number = account.annual_revenue ?? 0;
  const employeeCount: number = account.employee_count ?? 0;
  const healthScore: number = account.health_score ?? 0;

  if (view === 'brief') {
    return (
      <>
        <DrawerTabBar view={view} onChange={setView} />
        <BriefingPanel subjectType="account" subjectId={drawerEntityId!} onClose={() => setView('detail')} />
      </>
    );
  }

  if (view === 'graph') {
    return (
      <>
        <DrawerTabBar view={view} onChange={setView} />
        <MemoryGraph subjectType="account" subjectId={drawerEntityId!} subjectName={name} />
      </>
    );
  }

  if (editing) {
    return (
      <AccountEditForm
        account={account}
        onSave={async (data) => {
          try {
            await updateAccount.mutateAsync(data);
            setEditing(false);
            toast({ title: 'Account updated' });
          } catch (err) {
            toast({ title: 'Failed to update account', description: err instanceof Error ? err.message : 'Please try again.', variant: 'destructive' });
          }
        }}
        onCancel={() => setEditing(false)}
        onDelete={async () => {
          try {
            await deleteAccount.mutateAsync();
            closeDrawer();
            toast({ title: 'Account deleted' });
          } catch (err) {
            toast({ title: 'Failed to delete account', description: err instanceof Error ? err.message : 'Please try again.', variant: 'destructive' });
          }
        }}
        isSaving={updateAccount.isPending}
      />
    );
  }

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-border">
        <div className="flex items-start gap-4">
          <ContactAvatar name={name} className="w-14 h-14 rounded-2xl text-lg" />
          <div className="flex-1">
            <h2 className="font-display font-extrabold text-xl text-foreground">{name}</h2>
            {industry && <p className="text-sm text-muted-foreground">{industry}</p>}
            <div className="flex items-center gap-2 mt-2">
              {healthScore > 0 && <HealthBadge score={healthScore} />}
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          {website && (
            <a
              href={website.startsWith('http') ? website : `https://${website}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-muted text-foreground text-sm font-medium hover:bg-muted/80 transition-all press-scale"
            >
              <Globe className="w-3.5 h-3.5" /> Website
            </a>
          )}
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-muted text-foreground text-sm font-medium hover:bg-muted/80 transition-all press-scale"
          >
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
          {agentEnabled && (
            <button
              onClick={() => {
                openAIWithContext({ type: 'account', id: account.id, name, detail: industry });
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

      <DrawerTabBar view={view} onChange={setView} />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 p-4 mx-4 mt-4">
        {[
          { icon: DollarSign, label: 'Revenue', value: revenue ? formatRevenue(revenue) : '—' },
          { icon: Users, label: 'Employees', value: employeeCount ? String(employeeCount) : '—' },
          { icon: Heart, label: 'Health', value: healthScore ? String(healthScore) : '—' },
        ].map((stat) => (
          <div key={stat.label} className="bg-muted/50 rounded-xl p-3 text-center">
            <stat.icon className="w-4 h-4 text-muted-foreground mx-auto mb-1" />
            <p className="text-sm font-display font-bold text-foreground">{stat.value}</p>
            <p className="text-[10px] text-muted-foreground">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Details */}
      <div className="p-4 mx-4 mt-2 space-y-3">
        <h3 className="text-xs font-display font-bold text-muted-foreground uppercase tracking-wide">Details</h3>
        {[
          { label: 'Industry', value: industry },
          { label: 'Website', value: website },
          { label: 'Created', value: account.created_at ? new Date(account.created_at as string).toLocaleDateString() : undefined },
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
      <CustomFieldsSection objectType="account" values={(account.custom_fields ?? {}) as Record<string, unknown>} />

      {/* Context */}
      <ContextPanel subjectType="account" subjectId={drawerEntityId!} />

      {/* Description */}
      {account.description && (
        <div className="p-4 mx-4 mt-2 mb-6">
          <h3 className="text-xs font-display font-bold text-muted-foreground uppercase tracking-wide mb-2">About</h3>
          <p className="text-sm text-foreground leading-relaxed">{account.description as string}</p>
        </div>
      )}
    </div>
  );
}
