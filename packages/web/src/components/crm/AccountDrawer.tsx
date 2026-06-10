// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount, useUpdateAccount, useDeleteAccount, useUsers, useCustomFields, useEmailSubjectSummary } from '@/api/hooks';
import { useAppStore } from '@/store/appStore';
import { Globe, Users, DollarSign, Heart, Pencil, ChevronLeft, Trash2, Mail } from 'lucide-react';
import { DrawerTabBar, type DrawerView } from './DrawerTabBar';
import { ContextPanel } from './ContextPanel';
import { BriefingPanel } from './BriefingPanel';
import { ObjectActionBar } from './ObjectActionBar';
import { CustomFieldsSection } from './CrmWidgets';
import { DrawerSection } from './DrawerSection';
import { CopyIconButton } from './CopyIconButton';
import { toast } from '@/components/ui/use-toast';
import { DatePicker } from '@/components/ui/date-picker';
import { useAgentSettings } from '@/contexts/AgentSettingsContext';

const inputClass = 'w-full h-10 px-3 rounded-md border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';
const labelClass = 'text-xs font-mono text-muted-foreground uppercase tracking-wider';

function HealthBadge({ score }: { score: number }) {
  const color = score >= 80
    ? 'text-green-400 bg-green-500/15'
    : score >= 50
      ? 'text-yellow-400 bg-yellow-500/15'
      : 'text-destructive bg-destructive/15';
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
          { key: 'name', label: 'Account Name', type: 'text', placeholder: 'e.g. Northstar Labs', required: true },
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
  const { drawerEntityId, closeDrawer, drawerBriefing, drawerEditing, setDrawerEditing, openQuickAdd, recordFieldProvenance } = useAppStore();
  const navigate = useNavigate();
  const editing = drawerEditing;
  const setEditing = setDrawerEditing;
  const [view, setView] = useState<DrawerView>(drawerBriefing ? 'brief' : 'detail');
  const graphHref = drawerEntityId ? `/accounts/${drawerEntityId}/graph` : undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: accountData, isLoading } = useAccount(drawerEntityId ?? '') as any;
  const emailSummaryQ = useEmailSubjectSummary('account', drawerEntityId ? [drawerEntityId] : []);
  const emailSummary = ((emailSummaryQ.data as any)?.data ?? [])[0] as { total?: number; inbound?: number; outbound?: number; drafts?: number; pending_approvals?: number } | undefined;
  const emailStats = {
    total: emailSummary?.total ?? 0,
    inbound: emailSummary?.inbound ?? 0,
    outbound: emailSummary?.outbound ?? 0,
    drafts: emailSummary?.drafts ?? 0,
    pendingApprovals: emailSummary?.pending_approvals ?? 0,
  };
  const updateAccount = useUpdateAccount(drawerEntityId ?? '');
  const deleteAccount = useDeleteAccount(drawerEntityId ?? '');
  const { enabled: agentEnabled, config: agentConfig, connectivity } = useAgentSettings();
  const agentReady = agentEnabled && Boolean(agentConfig?.model && agentConfig?.base_url) && connectivity === 'online';

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
  const domain: string = account.domain ?? '';
  const aliases: string[] = Array.isArray(account.aliases) ? account.aliases : [];
  const tags: string[] = Array.isArray(account.tags) ? account.tags : [];
  const revenue: number = account.annual_revenue ?? 0;
  const employeeCount: number = account.employee_count ?? 0;
  const healthScore: number = account.health_score ?? 0;
  const accountProvenance = drawerEntityId ? recordFieldProvenance[`account:${drawerEntityId}`] ?? {} : {};
  const startEdit = () => {
    if (agentReady && drawerEntityId) {
      closeDrawer();
      openQuickAdd('account', {
        mode: 'edit',
        record_id: drawerEntityId,
        record_name: name,
        parent_subject_type: 'account',
        parent_subject_id: drawerEntityId,
        parent_subject_name: name,
      });
      return;
    }
    setEditing(true);
  };

  if (view === 'brief') {
    return (
      <>
        <DrawerTabBar view={view} onChange={setView} graphHref={graphHref} />
        <BriefingPanel subjectType="account" subjectId={drawerEntityId!} onClose={() => setView('detail')} />
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
          <div className="flex-1">
            <h2 className="font-display font-extrabold text-xl text-foreground">{name}</h2>
            {industry && <p className="text-sm text-muted-foreground">{industry}</p>}
            <div className="flex items-center gap-2 mt-2">
              {healthScore > 0 && <HealthBadge score={healthScore} />}
            </div>
          </div>
          <button
            onClick={startEdit}
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-muted px-3 py-2 text-sm font-medium text-foreground transition-all hover:bg-muted/80 press-scale"
          >
            <Pencil className="h-3.5 w-3.5" /> Edit
          </button>
        </div>
        {website && (
          <div className="flex gap-2 mt-4">
            <a
              href={website.startsWith('http') ? website : `https://${website}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-muted text-foreground text-sm font-medium hover:bg-muted/80 transition-all press-scale"
            >
              <Globe className="w-3.5 h-3.5" /> Website
            </a>
          </div>
        )}
      </div>

      <DrawerTabBar view={view} onChange={setView} graphHref={graphHref} showBriefTab={false} />
      <ObjectActionBar
        context={{ type: 'account', id: account.id, name, detail: industry }}
        onBrief={() => setView('brief')}
      />

      {emailStats.total > 0 && (
        <div className="mx-4 mt-4 rounded-xl border border-border bg-card/70 p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10">
                <Mail className="h-4 w-4 text-blue-400" />
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">Email context</p>
                <p className="text-xs text-muted-foreground">
                  {emailStats.total} linked · {emailStats.inbound} in · {emailStats.outbound} out
                  {emailStats.drafts > 0 ? ` · ${emailStats.drafts} draft${emailStats.drafts === 1 ? '' : 's'}` : ''}
                  {emailStats.pendingApprovals > 0 ? ` · ${emailStats.pendingApprovals} approval${emailStats.pendingApprovals === 1 ? '' : 's'}` : ''}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                const params = new URLSearchParams({ account_id: account.id, scope_label: name });
                closeDrawer();
                navigate(`/emails?${params.toString()}`);
              }}
              className="rounded-lg border border-border bg-muted px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted/80"
            >
              View email context
            </button>
          </div>
        </div>
      )}

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
            <p className="text-xs text-muted-foreground">{stat.label}</p>
          </div>
        ))}
      </div>

      <DrawerSection title="Details">
        {[
          { key: 'industry', label: 'Industry', value: industry },
          { key: 'website', label: 'Website', value: website },
          { key: 'domain', label: 'Domain', value: domain },
          { key: 'aliases', label: 'Aliases', value: aliases.length ? aliases.join(', ') : undefined },
          { key: 'tags', label: 'Tags', value: tags.length ? tags.join(', ') : undefined },
          { key: 'created_at', label: 'Created', value: account.created_at ? new Date(account.created_at as string).toLocaleDateString() : undefined },
        ]
          .filter((f) => f.value)
          .map((field) => {
            const provenance = accountProvenance[field.key];
            return (
              <div key={field.key} className="flex items-start justify-between gap-4">
                <span className="text-xs text-muted-foreground">{field.label}</span>
                <span className="text-right">
                  <span className="flex items-center justify-end gap-1">
                    <span className="block truncate text-sm text-foreground">{field.value}</span>
                    {(field.key === 'website' || field.key === 'domain') && (
                      <CopyIconButton value={String(field.value ?? '')} label={field.label} />
                    )}
                  </span>
                  {provenance && (
                    <span className="block text-[11px] text-muted-foreground">
                      {provenance.source_label}{provenance.confidence_label ? ` · ${provenance.confidence_label}` : ''}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
      </DrawerSection>

      {/* Custom Fields */}
      <CustomFieldsSection objectType="account" values={(account.custom_fields ?? {}) as Record<string, unknown>} />

      {/* Context */}
      <ContextPanel subjectType="account" subjectId={drawerEntityId!} />

      {/* Description */}
      {account.description && (
        <DrawerSection title="About" defaultOpen={false} className="mb-6" contentClassName="">
          <p className="text-sm text-foreground leading-relaxed">{account.description as string}</p>
        </DrawerSection>
      )}
    </div>
  );
}
