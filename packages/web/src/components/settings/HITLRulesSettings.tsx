// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from '@/hooks/use-toast';
import {
  useHITLApprovalRules, useCreateHITLRule, useUpdateHITLRule, useDeleteHITLRule,
} from '@/api/hooks';
import {
  ShieldCheck, Plus, Trash2, Power, PowerOff, X, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, GripVertical, AlertTriangle, Database, GitBranch, Sparkles,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RuleCondition {
  field: string;
  op: '<' | '>' | '=' | '!=' | 'contains' | 'not_contains';
  value: string;
}

interface ApprovalRule {
  id: string;
  name: string;
  action_type: string | null;
  condition: RuleCondition | RuleCondition[] | Record<string, never>;
  decision: 'approved' | 'rejected';
  priority: number;
  is_active: boolean;
  created_at: string;
}

const OPS = [
  { value: '=',            label: 'equals' },
  { value: '!=',           label: 'not equals' },
  { value: '<',            label: 'less than' },
  { value: '>',            label: 'greater than' },
  { value: 'contains',     label: 'contains' },
  { value: 'not_contains', label: 'not contains' },
] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const inputCls = 'w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';
const btnPrimary = 'px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-40';
const btnOutline = 'px-3 py-1.5 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-muted';

const BUILT_IN_POLICIES = [
  {
    title: 'Forecast changes',
    description: 'Agents and automation must request approval before changing forecast category.',
    icon: AlertTriangle,
    tone: 'border-warning/30 bg-warning/10 text-warning',
  },
  {
    title: 'Signal promotion',
    description: 'Signals need evidence before becoming Memory. Low-confidence Signals stay in review.',
    icon: Sparkles,
    tone: 'border-primary/30 bg-primary/10 text-primary',
  },
  {
    title: 'External writeback',
    description: 'Systems of Record writes check scopes, mappings, source authority, and idempotency.',
    icon: Database,
    tone: 'border-info/30 bg-info/10 text-info',
  },
  {
    title: 'Workflow field updates',
    description: 'Sensitive automation changes pause for approval instead of writing directly.',
    icon: GitBranch,
    tone: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600',
  },
] as const;

function conditionsToArray(cond: ApprovalRule['condition']): RuleCondition[] {
  if (!cond || Object.keys(cond).length === 0) return [];
  if (Array.isArray(cond)) return cond;
  return [cond as RuleCondition];
}

function emptyCondition(): RuleCondition {
  return { field: '', op: '=', value: '' };
}

// ─── Condition Builder ────────────────────────────────────────────────────────

function ConditionBuilder({
  conditions,
  onChange,
}: {
  conditions: RuleCondition[];
  onChange: (conditions: RuleCondition[]) => void;
}) {
  const update = (i: number, patch: Partial<RuleCondition>) => {
    const next = conditions.map((c, idx) => idx === i ? { ...c, ...patch } : c);
    onChange(next);
  };
  const remove = (i: number) => onChange(conditions.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      {conditions.map((c, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="text-muted-foreground shrink-0">
            <GripVertical className="w-4 h-4" />
          </div>
          <input
            type="text"
            value={c.field}
            onChange={(e) => update(i, { field: e.target.value })}
            placeholder="field.path"
            className={`${inputCls} flex-1`}
          />
          <select
            value={c.op}
            onChange={(e) => update(i, { op: e.target.value as RuleCondition['op'] })}
            className={`${inputCls} w-40 shrink-0`}
          >
            {OPS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <input
            type="text"
            value={c.value}
            onChange={(e) => update(i, { value: e.target.value })}
            placeholder="value"
            className={`${inputCls} flex-1`}
          />
          <button
            type="button"
            onClick={() => remove(i)}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-destructive shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...conditions, emptyCondition()])}
        className="flex items-center gap-1.5 text-xs text-primary hover:underline"
      >
        <Plus className="w-3.5 h-3.5" />
        Add condition
      </button>
      {conditions.length === 0 && (
        <p className="text-xs text-muted-foreground">No conditions — policy matches all requests of this type.</p>
      )}
    </div>
  );
}

// ─── Rule Row ─────────────────────────────────────────────────────────────────

function RuleRow({ rule }: { rule: ApprovalRule }) {
  const update = useUpdateHITLRule(rule.id);
  const del = useDeleteHITLRule(rule.id);
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [name, setName] = useState(rule.name);
  const [actionType, setActionType] = useState(rule.action_type ?? '');
  const [conditions, setConditions] = useState<RuleCondition[]>(() => conditionsToArray(rule.condition));
  const [decision, setDecision] = useState<'approved' | 'rejected'>(rule.decision);
  const [priority, setPriority] = useState(String(rule.priority));

  const handleToggle = async () => {
    try {
      await update.mutateAsync({ is_active: !rule.is_active });
    } catch {
      toast({ title: 'Failed to update policy', variant: 'destructive' });
    }
  };

  const handleSave = async () => {
    try {
      await update.mutateAsync({
        name,
        action_type: actionType.trim() || null,
        condition: conditions.length > 0 ? conditions : {},
        decision,
        priority: parseInt(priority) || 0,
      });
      setExpanded(false);
      toast({ title: 'Policy updated' });
    } catch {
      toast({ title: 'Failed to save policy', variant: 'destructive' });
    }
  };

  const handleDelete = async () => {
    try {
      await del.mutateAsync();
      toast({ title: 'Policy deleted' });
    } catch {
      toast({ title: 'Failed to delete policy', variant: 'destructive' });
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Decision badge */}
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
          rule.decision === 'approved'
            ? 'bg-emerald-500/15'
            : 'bg-destructive/10'
        }`}>
          {rule.decision === 'approved'
            ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            : <XCircle className="w-4 h-4 text-destructive" />
          }
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground truncate">{rule.name}</span>
            {rule.action_type && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                {rule.action_type}
              </span>
            )}
            <span className={`text-xs px-1.5 py-0.5 rounded border font-semibold ${
              rule.decision === 'approved'
                ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                : 'bg-destructive/10 text-destructive border-destructive/20'
            }`}>
              {rule.decision === 'approved' ? 'Auto-approve' : 'Auto-reject'}
            </span>
            {!rule.is_active && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                Inactive
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Priority {rule.priority}
            {conditionsToArray(rule.condition).length > 0
              ? ` · ${conditionsToArray(rule.condition).length} condition${conditionsToArray(rule.condition).length !== 1 ? 's' : ''}`
              : ' · matches all'}
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleToggle}
            title={rule.is_active ? 'Deactivate' : 'Activate'}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors"
          >
            {rule.is_active
              ? <Power className="w-4 h-4 text-emerald-500" />
              : <PowerOff className="w-4 h-4 text-muted-foreground" />
            }
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-destructive transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <button onClick={handleDelete} className="text-xs font-semibold text-destructive hover:underline">Delete</button>
              <button onClick={() => setConfirmDelete(false)} className="p-1 text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 py-4 border-t border-border bg-muted/20 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1 sm:col-span-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Policy Name</label>
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Priority</label>
                  <input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} className={inputCls} />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Action Type</label>
                  <input
                    type="text"
                    value={actionType}
                    onChange={(e) => setActionType(e.target.value)}
                    placeholder="Any (leave blank to match all)"
                    className={inputCls}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Decision</label>
                  <select value={decision} onChange={(e) => setDecision(e.target.value as 'approved' | 'rejected')} className={inputCls}>
                    <option value="approved">Auto-approve</option>
                    <option value="rejected">Auto-reject</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Conditions (AND logic)</label>
                <ConditionBuilder conditions={conditions} onChange={setConditions} />
              </div>

              <div className="flex justify-end gap-2">
                <button onClick={() => setExpanded(false)} className={btnOutline}>Cancel</button>
                <button onClick={handleSave} disabled={update.isPending} className={btnPrimary}>
                  {update.isPending ? 'Saving…' : 'Save Policy'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Create Form ──────────────────────────────────────────────────────────────

function CreateRuleForm({ onClose }: { onClose: () => void }) {
  const create = useCreateHITLRule();
  const [name, setName] = useState('');
  const [actionType, setActionType] = useState('');
  const [conditions, setConditions] = useState<RuleCondition[]>([]);
  const [decision, setDecision] = useState<'approved' | 'rejected'>('approved');
  const [priority, setPriority] = useState('0');

  const handleCreate = async () => {
    if (!name.trim()) {
      toast({ title: 'Policy name is required', variant: 'destructive' });
      return;
    }
    try {
      await create.mutateAsync({
        name: name.trim(),
        action_type: actionType.trim() || null,
        condition: conditions.length > 0 ? conditions : {},
        decision,
        priority: parseInt(priority) || 0,
      });
      toast({ title: 'Policy created' });
      onClose();
    } catch {
      toast({ title: 'Failed to create policy', variant: 'destructive' });
    }
  };

  return (
    <div className="rounded-lg border border-primary/30 bg-card p-4 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1 sm:col-span-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Policy Name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Auto-approve low-value actions" className={inputCls} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Priority</label>
          <input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} placeholder="0" className={inputCls} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Action Type</label>
          <input
            type="text"
            value={actionType}
            onChange={(e) => setActionType(e.target.value)}
            placeholder="Any (leave blank to match all)"
            className={inputCls}
          />
          <p className="text-xs text-muted-foreground">e.g. send_email, create_contact</p>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Decision</label>
          <select value={decision} onChange={(e) => setDecision(e.target.value as 'approved' | 'rejected')} className={inputCls}>
            <option value="approved">Auto-approve</option>
            <option value="rejected">Auto-reject</option>
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Conditions (AND logic)</label>
        <ConditionBuilder conditions={conditions} onChange={setConditions} />
      </div>

      <div className="flex justify-end gap-2">
        <button onClick={onClose} className={btnOutline}>Cancel</button>
        <button onClick={handleCreate} disabled={create.isPending || !name.trim()} className={btnPrimary}>
          {create.isPending ? 'Creating…' : 'Create Policy'}
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function HITLRulesSettings() {
  const { data, isLoading } = useHITLApprovalRules() as { data: { data: ApprovalRule[] } | undefined; isLoading: boolean };
  const [showCreate, setShowCreate] = useState(false);
  const rules = data?.data ?? [];

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h2 className="font-display font-bold text-lg text-foreground mb-1">Action Policies</h2>
        <p className="text-sm text-muted-foreground">
          Control what agents may change, what requires approval, and what should be rejected before it touches operational state.
          Policies are evaluated in descending priority order — the first match wins.
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Built-in safety boundaries</h3>
          <p className="text-sm text-muted-foreground mt-1">
            These guardrails are always active. Custom policies below add workspace-specific auto-approval or rejection rules.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {BUILT_IN_POLICIES.map(item => {
            const Icon = item.icon;
            return (
              <div key={item.title} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${item.tone}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">{item.title}</p>
                    <p className="text-sm text-muted-foreground mt-1">{item.description}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/15 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-emerald-500" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-foreground">Policies</h3>
            <p className="text-xs text-muted-foreground">
              {rules.length === 0
                ? 'No custom policies configured — built-in safety boundaries still apply.'
                : `${rules.filter(r => r.is_active).length} active polic${rules.filter(r => r.is_active).length !== 1 ? 'ies' : 'y'}`}
            </p>
          </div>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className={`${btnOutline} flex items-center gap-1.5 shrink-0`}
          >
            {showCreate ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {showCreate ? 'Cancel' : 'Add Policy'}
          </button>
        </div>

        <AnimatePresence>
          {showCreate && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <CreateRuleForm onClose={() => setShowCreate(false)} />
            </motion.div>
          )}
        </AnimatePresence>

        {isLoading ? (
          <div className="text-sm text-muted-foreground py-4">Loading…</div>
        ) : rules.length === 0 && !showCreate ? (
          <div className="rounded-lg border border-border bg-card p-8 text-center">
            <ShieldCheck className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm font-semibold text-foreground mb-1">No custom policies configured</p>
            <p className="text-xs text-muted-foreground max-w-xs mx-auto">
              Add policies to automatically approve routine agent actions or reject risky ones without human review.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {rules.map((rule) => (
              <RuleRow key={rule.id} rule={rule} />
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <p className="text-xs font-semibold text-foreground mb-1">How action policies work</p>
        <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
          <li>Policies are checked in descending <strong className="text-foreground">priority</strong> order — higher number runs first</li>
          <li>The <strong className="text-foreground">first matching policy</strong> wins; remaining policies are not evaluated</li>
          <li>Use <strong className="text-foreground">Action Type</strong> to target a specific agent action (e.g. <code className="bg-muted px-1 rounded">send_email</code>)</li>
          <li>Leave Action Type blank to match any action type</li>
          <li>Multiple conditions use <strong className="text-foreground">AND</strong> logic — all must be satisfied</li>
          <li>Leave conditions empty to match all requests of that action type</li>
        </ul>
      </div>
    </div>
  );
}
