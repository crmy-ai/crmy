// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Eye,
  FileText,
  GitBranch,
  Loader2,
  PenLine,
  PlusCircle,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import {
  useActors,
  useCompleteSignalGroupDetails,
  useContextTypes,
  usePromoteSignalGroup,
  useRejectSignalGroup,
  useSendSignalGroupToHandoff,
  useSignalGroup,
  useSignalGroups,
  type SignalGroup,
} from '@/api/hooks';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { toast } from '@/hooks/use-toast';
import { ListToolbar, type FilterConfig, type SortOption } from '@/components/crm/ListToolbar';
import { useAppStore } from '@/store/appStore';

function pct(value: number | null | undefined) {
  return `${Math.round(Number(value ?? 0) * 100)}%`;
}

function statusTone(status: SignalGroup['status']) {
  if (status === 'ready') return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
  if (status === 'conflicting') return 'border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400';
  if (status === 'blocked') return 'border-sky-500/25 bg-sky-500/10 text-sky-600 dark:text-sky-400';
  if (status === 'promoted') return 'border-primary/20 bg-primary/10 text-primary';
  if (status === 'dismissed') return 'border-muted bg-muted text-muted-foreground';
  return 'border-border bg-muted/60 text-muted-foreground';
}

type SignalReadiness = NonNullable<SignalGroup['readiness']>;
type SignalReadinessStatus = SignalReadiness['status'];
type DrawerRecordType = 'contact' | 'account' | 'opportunity' | 'use-case';
type JsonSchema = Record<string, any>;
type RepairField = {
  key: string;
  label: string;
  description?: string;
  type: 'string' | 'number' | 'boolean';
  enum?: string[];
};

const DRAWER_TYPE_MAP: Record<string, DrawerRecordType> = {
  contact: 'contact',
  account: 'account',
  opportunity: 'opportunity',
  use_case: 'use-case',
};

const STRUCTURED_READINESS_KEYS = new Set([
  'readiness_blockers',
  'missing_details',
  'extraction_completeness',
  'validation_warnings',
]);

function readinessTone(status: SignalReadinessStatus) {
  if (status === 'ready_to_confirm' || status === 'confirmed') return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
  if (status === 'blocked_by_conflict' || status === 'approval_required') return 'border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400';
  if (status === 'needs_more_detail') return 'border-sky-500/25 bg-sky-500/10 text-sky-600 dark:text-sky-400';
  if (status === 'dismissed') return 'border-muted bg-muted text-muted-foreground';
  return 'border-border bg-muted/60 text-muted-foreground';
}

function readinessLabel(status: SignalReadinessStatus) {
  const labels: Record<SignalReadinessStatus, string> = {
    ready_to_confirm: 'Ready to confirm',
    needs_more_evidence: 'Needs evidence',
    needs_more_detail: 'Needs detail',
    blocked_by_conflict: 'Conflict',
    approval_required: 'Approval required',
    confirmed: 'Confirmed',
    dismissed: 'Dismissed',
  };
  return labels[status];
}

function statusLabel(status: SignalGroup['status']) {
  if (status === 'ready') return 'Ready for Memory';
  if (status === 'conflicting') return 'Blocked by conflict';
  if (status === 'blocked') return 'Needs approval';
  if (status === 'promoted') return 'Memory created';
  if (status === 'dismissed') return 'Dismissed';
  return 'Needs more evidence';
}

function subjectLabel(group: SignalGroup) {
  if (group.subject_name) return group.subject_name;
  const type = group.subject_type === 'use_case' ? 'Use Case' : group.subject_type[0].toUpperCase() + group.subject_type.slice(1);
  return `${type} ${group.subject_id.slice(0, 8)}`;
}

function subjectTypeLabel(subjectType: string) {
  if (subjectType === 'use_case') return 'Use Case';
  return subjectType.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function humanizeKey(key: string) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function normalizeFieldText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isBlank(value: unknown) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function schemaProperties(schema?: JsonSchema | null): Record<string, JsonSchema> {
  return schema?.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
    ? schema.properties as Record<string, JsonSchema>
    : {};
}

function schemaRequired(schema?: JsonSchema | null): string[] {
  return Array.isArray(schema?.required) ? schema.required.map(String) : [];
}

function cleanStructuredData(data: Record<string, any> | undefined | null) {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data ?? {})) {
    if (!STRUCTURED_READINESS_KEYS.has(key)) cleaned[key] = value;
  }
  return cleaned;
}

function supportingEntry(group: SignalGroup): Record<string, any> | null {
  const members = (group.members ?? []) as any[];
  const supporting = members
    .filter(member => member.relation === 'supports')
    .map(member => member.context_entry)
    .filter(Boolean);
  if (group.latest_signal_id) {
    const latest = supporting.find(entry => entry.id === group.latest_signal_id);
    if (latest) return latest;
  }
  return supporting[0] ?? null;
}

function currentSignalDetails(group: SignalGroup) {
  return cleanStructuredData(supportingEntry(group)?.structured_data);
}

function missingDetailLabels(group: SignalGroup, readiness: SignalReadiness) {
  const values: string[] = [];
  const md = metadata(group);
  if (Array.isArray(md.missing_details)) values.push(...md.missing_details.map(String));
  for (const member of (group.members ?? []) as any[]) {
    const details = member.context_entry?.structured_data?.missing_details;
    if (Array.isArray(details)) values.push(...details.map(String));
  }
  for (const blocker of readiness.blockers) {
    const match = blocker.match(/^Missing\s+(.+?)\.?$/i);
    if (match?.[1]) values.push(match[1]);
  }
  for (const reason of readiness.reasons) {
    const match = reason.match(/Missing typed detail:\s*(.+?)\.?$/i);
    if (match?.[1]) values.push(...match[1].split(',').map(value => value.trim()));
  }
  return Array.from(new Set(values.map(value => value.replace(/\.$/, '').trim()).filter(Boolean)));
}

function fieldRepairType(property: JsonSchema): RepairField['type'] | null {
  if (Array.isArray(property.enum)) return 'string';
  if (property.type === 'number' || property.type === 'integer') return 'number';
  if (property.type === 'boolean') return 'boolean';
  if (!property.type || property.type === 'string') return 'string';
  return null;
}

function repairFieldsForGroup(group: SignalGroup, readiness: SignalReadiness, schema?: JsonSchema | null): RepairField[] {
  if (readiness.status !== 'needs_more_detail') return [];
  const properties = schemaProperties(schema);
  const current = currentSignalDetails(group);
  const labels = missingDetailLabels(group, readiness).map(normalizeFieldText);
  const required = schemaRequired(schema).filter(field => properties[field] && isBlank(current[field]));
  const candidates = required.filter(field => {
    if (labels.length === 0) return true;
    const property = properties[field];
    const names = [
      field,
      humanizeKey(field),
      property.title,
      property.description,
    ].filter(Boolean).map(String).map(normalizeFieldText);
    return names.some(name => labels.some(label => label && (name.includes(label) || label.includes(name))));
  });
  return candidates.flatMap(field => {
    const property = properties[field];
    const type = fieldRepairType(property);
    if (!type) return [];
    return [{
      key: field,
      label: String(property.title ?? humanizeKey(field)),
      description: typeof property.description === 'string' ? property.description : undefined,
      type,
      enum: Array.isArray(property.enum) ? property.enum.map(String) : undefined,
    }];
  });
}

function primaryActionLabel(readiness: SignalReadiness) {
  if (readiness.status === 'ready_to_confirm') return 'Confirm Signal';
  if (readiness.status === 'needs_more_detail') return 'Add missing details';
  if (readiness.status === 'needs_more_evidence') return 'Add evidence';
  if (readiness.status === 'blocked_by_conflict') return 'Resolve conflict';
  if (readiness.status === 'approval_required') return readiness.can_confirm ? 'Confirm Signal' : 'Request approval';
  return 'View details';
}

function sourceLabel(raw: string | undefined) {
  const value = String(raw || 'source').toLowerCase();
  const labels: Record<string, string> = {
    activity: 'Activity',
    call: 'Call',
    meeting: 'Meeting',
    transcript: 'Transcript',
    email: 'Email',
    inbound_email: 'Email',
    outbound_email: 'Email',
    mcp: 'MCP',
    crm_sync: 'CRM',
    warehouse_sync: 'Warehouse',
    hubspot: 'HubSpot',
    salesforce: 'Salesforce',
    databricks: 'Databricks',
    snowflake: 'Snowflake',
    manual: 'Manual Add Context',
    add_context: 'Add Context',
    raw_context: 'Raw Context',
  };
  return labels[value] ?? value.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function metadata(group: SignalGroup) {
  return (group.metadata ?? {}) as Record<string, any>;
}

function confidenceComponents(group: SignalGroup) {
  const stored = (metadata(group).confidence_components ?? {}) as Record<string, any>;
  if (Object.keys(stored).length > 0) return stored;
  const members = (group.members ?? []) as any[];
  const supporting = members.filter(member => member.relation === 'supports');
  const evidenceConfidence = supporting.map(member => Number(member.context_entry?.confidence ?? 0.5));
  const sourceWeights = supporting.map(member => Number(member.evidence_weight ?? 0.85));
  return {
    strongest_evidence_confidence: evidenceConfidence.length ? Math.max(...evidenceConfidence) : 0,
    strongest_source_weight: sourceWeights.length ? Math.max(...sourceWeights) : 0,
    source_trust_label: sourceWeights.length && Math.max(...sourceWeights) >= 0.98 ? 'High' : sourceWeights.length && Math.max(...sourceWeights) >= 0.85 ? 'Medium' : 'Lower',
    support_boost: Math.min(0.16, Math.max(0, group.support_count - 1) * 0.04),
    source_boost: Math.min(0.12, Math.max(0, group.independent_source_count - 1) * 0.06),
    conflict_penalty: Math.min(0.35, group.conflict_count * 0.18),
  };
}

function promotionThreshold(group: SignalGroup) {
  const threshold = metadata(group).threshold;
  return typeof threshold === 'number' ? threshold : 0.85;
}

function trustExplanation(group: SignalGroup) {
  const components = confidenceComponents(group);
  const confidence = Number(components.strongest_evidence_confidence ?? 0);
  const sourceWeight = Number(components.strongest_source_weight ?? 0);
  if (confidence >= 0.85 && sourceWeight < 0.98) {
    return 'The model was confident, but this source type has medium source quality.';
  }
  if (group.independent_source_count < 2 && group.aggregate_confidence < promotionThreshold(group)) {
    return 'Add another independent source or confirm this Signal when the evidence is enough.';
  }
  if (group.conflict_count > 0) {
    return 'Conflicting evidence lowers readiness and blocks automatic confirmation.';
  }
  if (group.aggregate_confidence >= promotionThreshold(group)) {
    return 'This Signal meets the current promotion threshold.';
  }
  return 'Readiness increases when CRMy finds stronger evidence or support from independent sources.';
}

function promotionStatusText(group: SignalGroup) {
  if (group.status === 'promoted') return 'Memory created';
  if (group.status === 'conflicting') return 'Blocked by conflict';
  if (group.status === 'blocked') return canPromote(group) ? 'Needs your confirmation' : 'Needs approval';
  if (group.aggregate_confidence >= promotionThreshold(group)) return 'Will become Memory automatically';
  return 'Below threshold';
}

function promotionBlockers(group: SignalGroup) {
  const blockers = metadata(group).promotion_blockers;
  if (Array.isArray(blockers)) return blockers.filter(Boolean).map(String);
  return group.blocked_reason ? [group.blocked_reason] : [];
}

function fallbackReadiness(group: SignalGroup): SignalReadiness {
  const components = confidenceComponents(group);
  const blockers = promotionBlockers(group);
  const conflictCount = Number(group.conflict_count ?? 0);
  const threshold = promotionThreshold(group);
  const score = Number(group.aggregate_confidence ?? 0);
  const status: SignalReadinessStatus = group.status === 'promoted'
    ? 'confirmed'
    : group.status === 'dismissed'
      ? 'dismissed'
      : conflictCount > 0 || group.status === 'conflicting'
        ? 'blocked_by_conflict'
        : blockers.some(blocker => blocker.toLowerCase().includes('approval') || blocker.toLowerCase().includes('corroboration'))
          ? 'approval_required'
          : blockers.length > 0
            ? 'needs_more_detail'
            : score >= threshold && independentSourceCount(group) > 0 && evidenceItemCount(group) > 0
              ? 'ready_to_confirm'
              : 'needs_more_evidence';
  return {
    version: 'crmy.signal_readiness.v1',
    status,
    can_confirm: status === 'ready_to_confirm' || status === 'approval_required',
    can_auto_confirm: status === 'ready_to_confirm' && group.status === 'ready',
    score,
    threshold,
    reasons: status === 'ready_to_confirm'
      ? ['This Signal has enough evidence, source quality, typed detail, and no conflicts to become confirmed Memory.']
      : blockers.length > 0
        ? blockers
        : [statusLabel(group.status)],
    blockers,
    next_actions: [],
    components: {
      model_confidence: Number(components.strongest_evidence_confidence ?? score),
      source_quality: Number(components.strongest_source_weight ?? 0),
      independent_source_count: independentSourceCount(group),
      duplicate_source_count: Number(components.duplicate_source_count ?? 0),
      evidence_count: evidenceItemCount(group),
      conflict_count: conflictCount,
      typed_completeness: typeof metadata(group).typed_completeness === 'number' ? Number(metadata(group).typed_completeness) : null,
      source_boost: Number(components.source_boost ?? 0),
      conflict_penalty: Number(components.conflict_penalty ?? 0),
    },
  };
}

function readinessForGroup(group: SignalGroup): SignalReadiness {
  return group.readiness ?? fallbackReadiness(group);
}

function readinessReason(group: SignalGroup) {
  const readiness = readinessForGroup(group);
  return readiness.reasons[0] ?? 'Readiness is available for this Signal.';
}

function friendlyPromotionBlocker(group: SignalGroup, blocker: string) {
  if (blocker.toLowerCase().includes('needs corroboration or approval')) {
    return canPromote(group)
      ? 'This is a sensitive customer claim, so CRMy will not confirm it automatically from one source. You can confirm it now if the evidence is enough.'
      : 'This is a sensitive customer claim and needs another independent source or an approval before agents rely on it.';
  }
  if (blocker.toLowerCase().startsWith('trust score is') || blocker.toLowerCase().startsWith('readiness score is')) {
    return `${blocker.replace(/^trust score/i, 'Readiness score')} You can still confirm this Signal when the evidence is enough.`;
  }
  return blocker;
}

function canPromote(group: SignalGroup) {
  if (group.readiness) return group.readiness.can_confirm && !['promoted', 'dismissed'].includes(group.status);
  const blockers = promotionBlockers(group);
  const onlyHumanConfirmationBlocker = blockers.length > 0
    && blockers.every(blocker => blocker.toLowerCase().includes('needs corroboration or approval'));
  if (group.status === 'blocked' && onlyHumanConfirmationBlocker) return true;
  const explicit = metadata(group).can_promote_manually;
  if (typeof explicit === 'boolean') return explicit && !['conflicting', 'promoted', 'dismissed'].includes(group.status);
  return !['blocked', 'conflicting', 'promoted', 'dismissed'].includes(group.status);
}

function signalActionClass(color: 'success' | 'warning' | 'ghost') {
  const colorMap = {
    success: 'bg-success text-white hover:bg-success/90',
    warning: 'border border-amber-500/30 text-amber-600 hover:bg-amber-500/10',
    ghost: 'border border-border text-muted-foreground hover:bg-muted/50',
  };
  return `h-7 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-50 ${colorMap[color]}`;
}

function sourceTypes(group: SignalGroup) {
  const members = group.members ?? [];
  const values = new Set<string>();
  for (const member of members as any[]) {
    const entry = member.context_entry ?? {};
    const evidence = Array.isArray(entry.evidence) ? entry.evidence : [];
    const first = evidence[0] ?? {};
    values.add(sourceLabel(first.source_type ?? entry.source));
  }
  return Array.from(values).slice(0, 5);
}

function evidenceItems(group: SignalGroup) {
  return ((group.members ?? []) as any[]).flatMap(member => {
    const entry = member.context_entry ?? {};
    const evidence = Array.isArray(entry.evidence) && entry.evidence.length > 0
      ? entry.evidence
      : [{}];
    return evidence.map((item: any, index: number) => ({
      id: `${member.id}-${index}`,
      relation: member.relation,
      entry,
      evidence: item,
      source: sourceLabel(item.source_type ?? entry.source),
      sourceLabel: item.source_label ?? item.source_ref ?? item.source_id ?? entry.source_ref,
      snippet: item.snippet,
      observedAt: item.observed_at,
    }));
  });
}

function supportingSignalCount(group: SignalGroup) {
  if (typeof group.support_count === 'number' && group.support_count > 0) return group.support_count;
  return ((group.members ?? []) as any[]).filter(member => member.relation === 'supports').length;
}

function independentSourceCount(group: SignalGroup) {
  if (typeof group.independent_source_count === 'number' && group.independent_source_count > 0) return group.independent_source_count;
  const keys = new Set<string>();
  for (const member of (group.members ?? []) as any[]) {
    if (member.relation !== 'supports') continue;
    const entry = member.context_entry ?? {};
    const evidence = Array.isArray(entry.evidence) ? entry.evidence : [];
    const first = evidence[0] ?? {};
    keys.add(String(member.source_key ?? first.source_id ?? first.source_ref ?? first.source_url ?? entry.source_ref ?? entry.id ?? member.id));
  }
  return keys.size;
}

function evidenceItemCount(group: SignalGroup) {
  if (typeof group.evidence_count === 'number' && group.evidence_count > 0) return group.evidence_count;
  return evidenceItems(group).filter(item => item.snippet || item.sourceLabel || item.evidence?.source_id || item.evidence?.source_ref).length;
}

type SignalViewMode = 'cards' | 'table';

export function SignalGroupsBrowser({
  viewMode: controlledViewMode,
}: {
  viewMode?: SignalViewMode;
} = {}) {
  const navigate = useNavigate();
  const openDrawer = useAppStore(s => s.openDrawer);
  const [searchParams, setSearchParams] = useSearchParams();
  const [attentionOnly, setAttentionOnly] = useState(true);
  const [localViewMode] = useState<SignalViewMode>('cards');
  const viewMode = controlledViewMode ?? localViewMode;
  const [q, setQ] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({});
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerView, setDrawerView] = useState<'details' | 'evidence'>('details');
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const [detailPatch, setDetailPatch] = useState<Record<string, string>>({});
  const [showDelegation, setShowDelegation] = useState(false);
  const [delegateAssigneeId, setDelegateAssigneeId] = useState('');
  const [delegateReason, setDelegateReason] = useState('');
  const [delegateNote, setDelegateNote] = useState('');
  const [delegatePriority, setDelegatePriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal');
  const [lastHandoffId, setLastHandoffId] = useState<string | null>(null);
  const query = q.trim();
  const { data, isLoading } = useSignalGroups({
    attention_only: attentionOnly,
    q: query || undefined,
    status: activeFilters.status?.[0],
    subject_type: activeFilters.subject_type?.[0],
    context_type: activeFilters.context_type?.[0],
    limit: 50,
  }) as any;
  const groups: SignalGroup[] = data?.data ?? [];
  const total = Number(data?.total ?? groups.length);
  const selected = groups.find(g => g.id === selectedId) ?? null;
  const detail = useSignalGroup(selectedId);
  const detailedGroup = (detail.data as any)?.signal_group ?? selected;
  const promote = usePromoteSignalGroup();
  const reject = useRejectSignalGroup();
  const handoff = useSendSignalGroupToHandoff();
  const completeDetails = useCompleteSignalGroupDetails();
  const { data: contextTypesData } = useContextTypes() as any;
  const { data: actorsData } = useActors({ actor_type: 'human', is_active: true, limit: 100 }) as any;
  const actors = (actorsData?.data ?? []) as Array<Record<string, any>>;
  const contextTypeByName = useMemo(() => {
    const map = new Map<string, any>();
    for (const type of (contextTypesData?.data ?? []) as any[]) map.set(type.type_name, type);
    return map;
  }, [contextTypesData]);
  const selectedParam = searchParams.get('signal_group_id');

  const openSignal = (id: string) => {
    setSelectedId(id);
    setDrawerView('details');
    setConfirmDismiss(false);
    const next = new URLSearchParams(searchParams);
    next.set('signal_group_id', id);
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    if (!selectedParam) return;
    setSelectedId(selectedParam);
    setDrawerView('details');
  }, [selectedParam]);

  useEffect(() => {
    setDetailPatch({});
    setShowDelegation(false);
    setDelegateAssigneeId('');
    setDelegateNote('');
    setDelegatePriority('normal');
    setLastHandoffId(null);
    if (detailedGroup) setDelegateReason(readinessReason(detailedGroup));
  }, [detailedGroup?.id]);

  const closeSignalDrawer = () => {
    setSelectedId(null);
    setDrawerView('details');
    setConfirmDismiss(false);
    setDetailPatch({});
    setShowDelegation(false);
    setLastHandoffId(null);
    if (searchParams.has('signal_group_id')) {
      const next = new URLSearchParams(searchParams);
      next.delete('signal_group_id');
      setSearchParams(next, { replace: true });
    }
  };

  const filterConfigs: FilterConfig[] = useMemo(() => {
    const contextTypes = Array.from(new Set(groups.map(group => group.context_type).filter(Boolean))).sort();
    return [
      {
        key: 'status',
        label: 'Status',
        options: [
          { value: 'gathering', label: 'Needs more evidence' },
          { value: 'ready', label: 'Ready for Memory' },
          { value: 'blocked', label: 'Needs approval' },
          { value: 'conflicting', label: 'Conflict' },
          { value: 'promoted', label: 'Memory created' },
          { value: 'dismissed', label: 'Dismissed' },
        ],
      },
      {
        key: 'subject_type',
        label: 'Record',
        options: [
          { value: 'account', label: 'Accounts' },
          { value: 'contact', label: 'Contacts' },
          { value: 'opportunity', label: 'Opportunities' },
          { value: 'use_case', label: 'Use Cases' },
        ],
      },
      {
        key: 'context_type',
        label: 'Type',
        options: contextTypes.map(type => ({ value: type, label: type.replace(/_/g, ' ') })),
      },
    ];
  }, [groups]);

  const sortOptions: SortOption[] = [
    { key: 'updated_at', label: 'Updated' },
    { key: 'aggregate_confidence', label: 'Readiness score' },
    { key: 'evidence_count', label: 'Evidence' },
    { key: 'independent_source_count', label: 'Sources' },
  ];

  const handleFilterChange = (key: string, values: string[]) => {
    setActiveFilters(prev => {
      const next = { ...prev };
      if (values.length) next[key] = values;
      else delete next[key];
      return next;
    });
  };

  const handleSortChange = (key: string) => {
    setSort(prev => {
      if (prev?.key === key) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      return { key, dir: 'desc' };
    });
  };

  const clearFilters = () => {
    setActiveFilters({});
    setQ('');
  };

  const groupedByStatus = useMemo(() => {
    const order: SignalGroup['status'][] = ['conflicting', 'blocked', 'ready', 'gathering', 'promoted', 'dismissed'];
    const filtered = groups;
    if (sort) {
      return [...filtered].sort((a, b) => {
        const aValue = sort.key === 'updated_at'
          ? new Date(a.updated_at ?? a.created_at).getTime()
          : Number((a as any)[sort.key] ?? 0);
        const bValue = sort.key === 'updated_at'
          ? new Date(b.updated_at ?? b.created_at).getTime()
          : Number((b as any)[sort.key] ?? 0);
        return sort.dir === 'asc' ? aValue - bValue : bValue - aValue;
      });
    }
    return [...filtered].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  }, [groups, sort]);

  const relatedSignals = useMemo(() => {
    if (!detailedGroup) return [];
    return groups
      .filter(group => group.id !== detailedGroup.id)
      .filter(group => group.subject_id === detailedGroup.subject_id || group.context_type === detailedGroup.context_type)
      .slice(0, 4);
  }, [detailedGroup, groups]);

  const onPromote = async (id: string) => {
    try {
      await promote.mutateAsync(id);
      toast({ title: 'Signal confirmed', description: 'Agents can now rely on this customer context with its supporting evidence.' });
      closeSignalDrawer();
    } catch (err) {
      toast({ title: 'Could not confirm Signal', description: err instanceof Error ? err.message : 'Review the evidence and try again.', variant: 'destructive' });
    }
  };

  const onDismiss = async (id: string) => {
    try {
      await reject.mutateAsync({ id, reason: 'Dismissed from Signal intervention.' });
      toast({ title: 'Signal dismissed', description: 'CRMy will not promote this Signal to Memory. Evidence is preserved for audit.' });
      closeSignalDrawer();
    } catch (err) {
      toast({ title: 'Could not dismiss Signal', description: err instanceof Error ? err.message : 'Try again.', variant: 'destructive' });
    }
  };

  const onAddEvidence = (group: SignalGroup) => {
    const next = new URLSearchParams();
    next.set('tab', 'observations');
    next.set('add', 'context');
    next.set('subject_type', group.subject_type);
    next.set('subject_id', group.subject_id);
    next.set('subject_label', subjectLabel(group));
    navigate(`/context?${next.toString()}`);
  };

  const onOpenSubject = (group: SignalGroup) => {
    const drawerType = DRAWER_TYPE_MAP[group.subject_type] ?? 'account';
    openDrawer(drawerType, group.subject_id);
  };

  const onCompleteDetails = async (group: SignalGroup, fields: RepairField[]) => {
    const patch: Record<string, unknown> = {};
    for (const field of fields) {
      const raw = detailPatch[field.key]?.trim() ?? '';
      if (!raw) {
        toast({ title: 'Missing detail', description: `${field.label} is required before saving.`, variant: 'destructive' });
        return;
      }
      patch[field.key] = field.type === 'number'
        ? Number(raw)
        : field.type === 'boolean'
          ? raw === 'true'
          : raw;
    }
    try {
      await completeDetails.mutateAsync({ id: group.id, structured_data_patch: patch });
      toast({ title: 'Signal details saved', description: 'Readiness was recomputed for this Signal.' });
      setDetailPatch({});
    } catch (err) {
      toast({ title: 'Could not save details', description: err instanceof Error ? err.message : 'Check the fields and try again.', variant: 'destructive' });
    }
  };

  const onHandoff = async (group: SignalGroup) => {
    if (!delegateAssigneeId) {
      toast({ title: 'Choose a reviewer', description: 'Select who should handle this Signal before sending it to Handoff.', variant: 'destructive' });
      return;
    }
    try {
      const result = await handoff.mutateAsync({
        id: group.id,
        assignee_actor_id: delegateAssigneeId,
        reason: delegateReason.trim() || readinessReason(group),
        note: delegateNote.trim() || undefined,
        priority: delegatePriority,
      }) as any;
      const requestId = result?.hitl_request?.id;
      toast({
        title: result?.reused_existing ? 'Handoff already exists' : 'Handoff sent',
        description: result?.reused_existing
          ? 'The pending handoff was updated with the selected reviewer.'
          : 'A reviewer now has the Signal, evidence, and readiness blocker.',
      });
      setShowDelegation(false);
      setLastHandoffId(requestId ?? null);
    } catch (err) {
      toast({ title: 'Could not create handoff', description: err instanceof Error ? err.message : 'Try again.', variant: 'destructive' });
    }
  };

  const detailedReadiness = detailedGroup ? readinessForGroup(detailedGroup) : null;
  const detailedSchema = detailedGroup ? contextTypeByName.get(detailedGroup.context_type)?.json_schema as JsonSchema | undefined : undefined;
  const repairFields = detailedGroup && detailedReadiness ? repairFieldsForGroup(detailedGroup, detailedReadiness, detailedSchema) : [];

  return (
    <>
      <ListToolbar
        searchValue={q}
        onSearchChange={setQ}
        searchPlaceholder="Search Signals..."
        filters={filterConfigs}
        activeFilters={activeFilters}
        onFilterChange={handleFilterChange}
        onClearFilters={clearFilters}
        sortOptions={sortOptions}
        currentSort={sort}
        onSortChange={handleSortChange}
        entityType="signals"
        searchSuffix={(
          <div className="inline-flex h-9 flex-shrink-0 rounded-xl border border-border bg-muted p-1">
            <button
              type="button"
              onClick={() => setAttentionOnly(true)}
              aria-pressed={attentionOnly}
              className={`rounded-lg px-3 text-sm font-medium transition-colors ${
                attentionOnly
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Needs attention
            </button>
            <button
              type="button"
              onClick={() => setAttentionOnly(false)}
              aria-pressed={!attentionOnly}
              className={`rounded-lg px-3 text-sm font-medium transition-colors ${
                !attentionOnly
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              All Signals
            </button>
          </div>
        )}
      />

      <div className="flex-1 overflow-y-auto px-4 md:px-6 pb-24 md:pb-6">
        {!isLoading && groups.length > 0 && (
          <p className="mb-3 text-xs text-muted-foreground">
            Showing {groups.length.toLocaleString()} of {total.toLocaleString()} {query ? 'matching' : attentionOnly ? 'attention' : ''} Signals. Use search, record, status, and type filters to narrow large workspaces.
          </p>
        )}
        {isLoading ? (
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading Signals...
          </div>
        ) : groupedByStatus.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card text-center">
            <Sparkles className="mb-3 h-10 w-10 text-muted-foreground" />
            <h3 className="font-display text-lg font-semibold text-foreground">
              {q || Object.keys(activeFilters).length > 0 ? 'No Signals match your filters' : attentionOnly ? 'No Signals need attention' : 'No Signals yet'}
            </h3>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              {q || Object.keys(activeFilters).length > 0
                ? 'Try adjusting search or filters.'
                : 'Reviewable Signals appear here when Raw Context creates inferred customer context.'}
            </p>
          </div>
        ) : viewMode === 'table' ? (
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-sunken/50">
                    <th className="px-4 py-3 text-left text-xs font-display font-semibold text-muted-foreground">Signal</th>
                    <th className="px-4 py-3 text-left text-xs font-display font-semibold text-muted-foreground">Subject</th>
                    <th className="px-4 py-3 text-left text-xs font-display font-semibold text-muted-foreground">Readiness</th>
                    <th className="px-4 py-3 text-left text-xs font-display font-semibold text-muted-foreground">Evidence</th>
                    <th className="px-4 py-3 text-left text-xs font-display font-semibold text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-display font-semibold text-muted-foreground">Updated</th>
                    <th className="px-4 py-3 text-right text-xs font-display font-semibold text-muted-foreground"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {groupedByStatus.map((group, index) => {
                    const readiness = readinessForGroup(group);
                    return (
                      <tr
                        key={group.id}
                        onClick={() => openSignal(group.id)}
                        className={`cursor-pointer border-b border-border transition-colors hover:bg-primary/5 last:border-0 ${index % 2 === 1 ? 'bg-surface-sunken/30' : ''}`}
                      >
                        <td className="max-w-[28rem] px-4 py-3">
                          <div className="font-semibold text-foreground line-clamp-1">{group.title || group.normalized_claim}</div>
                          <div className="text-xs text-muted-foreground line-clamp-1">{readinessReason(group)}</div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{subjectLabel(group)}</td>
                        <td className="px-4 py-3 font-semibold text-foreground">{pct(readiness.score)}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {readiness.components.evidence_count} item{readiness.components.evidence_count === 1 ? '' : 's'} · {readiness.components.independent_source_count} source{readiness.components.independent_source_count === 1 ? '' : 's'}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={readinessTone(readiness.status)}>
                            {readinessLabel(readiness.status)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {new Date(group.updated_at ?? group.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            className={signalActionClass('ghost')}
                            onClick={(event) => {
                              event.stopPropagation();
                              openSignal(group.id);
                            }}
                          >
                            Details
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {groupedByStatus.map(group => {
              const canAct = !['promoted', 'dismissed'].includes(group.status);
              const readiness = readinessForGroup(group);
              return (
                <article
                  key={group.id}
                  onClick={() => openSignal(group.id)}
                  className="group flex min-h-[14rem] cursor-pointer flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-colors hover:border-primary/30 hover:bg-card/95"
                >
                  <div className="flex flex-1 items-start gap-3 p-4">
                    <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-500">
                      <Sparkles className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className={readinessTone(readiness.status)}>
                          {readinessLabel(readiness.status)}
                        </Badge>
                        <Badge variant="outline" className="text-xs capitalize">
                          {group.context_type.replace(/_/g, ' ')}
                        </Badge>
                      </div>
                      <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
                        {group.title || group.normalized_claim}
                      </h3>
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{readinessReason(group)}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground">{subjectLabel(group)}</span>
                        <span className="rounded-full bg-violet-500/10 px-2 py-0.5 font-semibold text-violet-600 dark:text-violet-300">
                          {pct(readiness.score)} readiness
                        </span>
                        <span>{readiness.components.evidence_count} evidence</span>
                        <span>{readiness.components.independent_source_count} source{readiness.components.independent_source_count === 1 ? '' : 's'}</span>
                        {readiness.components.conflict_count > 0 && (
                          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="h-3 w-3" />
                            {readiness.components.conflict_count} conflict{readiness.components.conflict_count === 1 ? '' : 's'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 border-t border-border bg-surface-sunken/30 px-3 py-2" onClick={event => event.stopPropagation()}>
                    <button type="button" className={signalActionClass('ghost')} onClick={() => openSignal(group.id)}>
                      <Eye className="mr-1 h-3.5 w-3.5" />
                      Details
                    </button>
                    {canPromote(group) && (
                      <button type="button" className={signalActionClass('success')} onClick={() => onPromote(group.id)} disabled={promote.isPending}>
                        {promote.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}
                        Confirm Signal
                      </button>
                    )}
                    {canAct && !canPromote(group) && (
                      <button
                        type="button"
                        className={signalActionClass(readiness.status === 'needs_more_evidence' ? 'ghost' : 'warning')}
                        onClick={() => {
                          if (readiness.status === 'needs_more_evidence') onAddEvidence(group);
                          else {
                            openSignal(group.id);
                            if (readiness.status === 'approval_required') setShowDelegation(true);
                          }
                        }}
                        disabled={handoff.isPending}
                      >
                        {readiness.status === 'needs_more_evidence'
                          ? <PlusCircle className="mr-1 h-3.5 w-3.5" />
                          : <PenLine className="mr-1 h-3.5 w-3.5" />}
                        {primaryActionLabel(readiness)}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <Sheet open={!!selectedId} onOpenChange={open => { if (!open) closeSignalDrawer(); }}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
          {detailedGroup && detailedReadiness ? (
            <>
              <SheetHeader className="border-b border-border px-5 pb-4 pt-5 text-left">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={readinessTone(detailedReadiness.status)}>
                    {readinessLabel(detailedReadiness.status)}
                  </Badge>
                  <Badge variant="outline" className="border-border text-muted-foreground">
                    {subjectLabel(detailedGroup)}
                  </Badge>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <SheetTitle className="font-display text-lg leading-snug">
                    {drawerView === 'evidence' ? 'Signal Evidence' : detailedGroup.title || detailedGroup.normalized_claim}
                  </SheetTitle>
                  {drawerView === 'evidence' && (
                    <Button variant="outline" size="sm" onClick={() => setDrawerView('details')}>
                      Back
                    </Button>
                  )}
                </div>
                <SheetDescription>
                  {drawerView === 'evidence'
                    ? 'Source lineage and confidence for each supporting or conflicting item.'
                    : 'Confirm this Signal when the evidence is enough, or repair the blocker before it becomes confirmed Memory.'}
                </SheetDescription>
              </SheetHeader>

              <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
                {drawerView === 'details' ? (
                  <>
                    <div className="rounded-2xl border border-border bg-surface p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Readiness score</p>
                          <p className="mt-1 text-3xl font-bold text-foreground">{pct(detailedReadiness.score)}</p>
                        </div>
                        <Sparkles className="h-8 w-8 text-violet-500" />
                      </div>
                      <p className="mt-3 text-sm text-muted-foreground">{detailedGroup.normalized_claim}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" onClick={() => setDrawerView('evidence')}>
                          <Eye className="mr-1 h-3.5 w-3.5" />
                          View Evidence
                        </Button>
                        <Button variant="ghost" size="sm" asChild>
                          <Link to={`/context?tab=lineage&signal_group_id=${detailedGroup.id}`}>
                            <GitBranch className="mr-1 h-3.5 w-3.5" />
                            View Lineage
                          </Link>
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-xl bg-muted p-3">
                        <p className="text-lg font-bold text-foreground">{supportingSignalCount(detailedGroup)}</p>
                        <p className="text-[11px] text-muted-foreground">Signals</p>
                      </div>
                      <div className="rounded-xl bg-muted p-3">
                        <p className="text-lg font-bold text-foreground">{independentSourceCount(detailedGroup)}</p>
                        <p className="text-[11px] text-muted-foreground">Sources</p>
                      </div>
                      <div className="rounded-xl bg-muted p-3">
                        <p className="text-lg font-bold text-foreground">{evidenceItemCount(detailedGroup)}</p>
                        <p className="text-[11px] text-muted-foreground">Evidence</p>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-border bg-card p-4">
                      <p className="text-sm font-semibold text-foreground">Why not Memory yet?</p>
                      <div className="mt-2 rounded-xl bg-muted p-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">Readiness</span>
                          <span className="font-medium text-foreground">{readinessLabel(detailedReadiness.status)}</span>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">Confirmation threshold</span>
                          <span className="font-medium text-foreground">{pct(detailedReadiness.threshold)}</span>
                        </div>
                      </div>
                      {detailedReadiness.blockers.length > 0 ? (
                        <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                          {detailedReadiness.blockers.map(blocker => (
                            <li key={blocker} className="flex gap-2">
                              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
                              <span>{friendlyPromotionBlocker(detailedGroup, blocker)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 text-sm text-muted-foreground">
                          {detailedReadiness.reasons[0] ?? 'This Signal can be confirmed as Memory.'}
                        </p>
                      )}
                    </div>

                    <div className="rounded-2xl border border-border bg-card p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">Resolve this Signal</p>
                          <p className="mt-1 text-sm text-muted-foreground">{readinessReason(detailedGroup)}</p>
                        </div>
                        <Badge variant="outline" className={readinessTone(detailedReadiness.status)}>
                          {primaryActionLabel(detailedReadiness)}
                        </Badge>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-muted p-3 text-sm">
                        <span className="text-muted-foreground">{subjectTypeLabel(detailedGroup.subject_type)}</span>
                        <span className="font-medium text-foreground">{subjectLabel(detailedGroup)}</span>
                        <Button variant="outline" size="sm" className="ml-auto h-8" onClick={() => onOpenSubject(detailedGroup)}>
                          <ArrowUpRight className="mr-1 h-3.5 w-3.5" />
                          Open record
                        </Button>
                      </div>

                      {detailedReadiness.status === 'needs_more_detail' && repairFields.length > 0 && (
                        <div className="mt-3 space-y-3">
                          {repairFields.map(field => {
                            const value = detailPatch[field.key] ?? '';
                            const commonClass = 'mt-1 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30';
                            return (
                              <label key={field.key} className="block text-xs font-medium text-muted-foreground">
                                {field.label}
                                {field.enum ? (
                                  <select
                                    value={value}
                                    onChange={event => setDetailPatch(prev => ({ ...prev, [field.key]: event.target.value }))}
                                    className={`${commonClass} h-9`}
                                  >
                                    <option value="">Select...</option>
                                    {field.enum.map(option => (
                                      <option key={option} value={option}>{humanizeKey(option)}</option>
                                    ))}
                                  </select>
                                ) : field.type === 'boolean' ? (
                                  <select
                                    value={value}
                                    onChange={event => setDetailPatch(prev => ({ ...prev, [field.key]: event.target.value }))}
                                    className={`${commonClass} h-9`}
                                  >
                                    <option value="">Select...</option>
                                    <option value="true">Yes</option>
                                    <option value="false">No</option>
                                  </select>
                                ) : (
                                  <input
                                    type={field.type === 'number' ? 'number' : 'text'}
                                    value={value}
                                    onChange={event => setDetailPatch(prev => ({ ...prev, [field.key]: event.target.value }))}
                                    className={`${commonClass} h-9`}
                                  />
                                )}
                                {field.description && <span className="mt-1 block text-[11px] text-muted-foreground">{field.description}</span>}
                              </label>
                            );
                          })}
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" onClick={() => onCompleteDetails(detailedGroup, repairFields)} disabled={completeDetails.isPending}>
                              {completeDetails.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}
                              Save details
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => setDrawerView('evidence')}>
                              <Eye className="mr-1 h-3.5 w-3.5" />
                              View Evidence
                            </Button>
                          </div>
                        </div>
                      )}

                      {detailedReadiness.status === 'needs_more_detail' && repairFields.length === 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button variant="outline" size="sm" onClick={() => onAddEvidence(detailedGroup)}>
                            <PlusCircle className="mr-1 h-3.5 w-3.5" />
                            Add evidence
                          </Button>
                        </div>
                      )}

                      {detailedReadiness.status === 'needs_more_evidence' && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button size="sm" onClick={() => onAddEvidence(detailedGroup)}>
                            <PlusCircle className="mr-1 h-3.5 w-3.5" />
                            Add evidence
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setDrawerView('evidence')}>
                            <Eye className="mr-1 h-3.5 w-3.5" />
                            View Evidence
                          </Button>
                        </div>
                      )}

                      {detailedReadiness.status === 'blocked_by_conflict' && (
                        <div className="mt-3 space-y-2">
                          {evidenceItems(detailedGroup).filter(item => item.relation === 'conflicts').slice(0, 3).map(item => (
                            <div key={item.id} className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-sm">
                              <p className="font-medium text-foreground">{item.entry.title || item.entry.body}</p>
                              {item.snippet && <p className="mt-1 line-clamp-2 text-muted-foreground">{item.snippet}</p>}
                            </div>
                          ))}
                          <Button variant="outline" size="sm" onClick={() => setShowDelegation(true)}>
                            <Users className="mr-1 h-3.5 w-3.5" />
                            Ask someone else
                          </Button>
                        </div>
                      )}

                      {detailedReadiness.status === 'approval_required' && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {canPromote(detailedGroup) && (
                            <Button size="sm" onClick={() => onPromote(detailedGroup.id)} disabled={promote.isPending}>
                              {promote.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}
                              Confirm Signal
                            </Button>
                          )}
                          <Button variant="outline" size="sm" onClick={() => setShowDelegation(true)}>
                            <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                            Request approval
                          </Button>
                        </div>
                      )}

                      {detailedReadiness.status === 'ready_to_confirm' && (
                        <div className="mt-3">
                          <Button size="sm" onClick={() => onPromote(detailedGroup.id)} disabled={promote.isPending || !canPromote(detailedGroup)}>
                            {promote.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}
                            Confirm Signal
                          </Button>
                        </div>
                      )}

                      {!['confirmed', 'dismissed'].includes(detailedReadiness.status) && detailedReadiness.status !== 'blocked_by_conflict' && detailedReadiness.status !== 'approval_required' && (
                        <div className="mt-3">
                          <Button variant="ghost" size="sm" onClick={() => setShowDelegation(value => !value)}>
                            <Users className="mr-1 h-3.5 w-3.5" />
                            Ask someone else
                          </Button>
                        </div>
                      )}

                      {showDelegation && (
                        <div className="mt-3 rounded-xl border border-border bg-surface p-3">
                          <div className="grid gap-3 sm:grid-cols-2">
                            <label className="block text-xs font-medium text-muted-foreground sm:col-span-2">
                              Reviewer
                              <select
                                value={delegateAssigneeId}
                                onChange={event => setDelegateAssigneeId(event.target.value)}
                                className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30"
                              >
                                <option value="">Select reviewer...</option>
                                {actors.map(actor => (
                                  <option key={actor.id} value={actor.id}>{actor.display_name ?? actor.name ?? actor.email ?? actor.id}</option>
                                ))}
                              </select>
                            </label>
                            <label className="block text-xs font-medium text-muted-foreground">
                              Priority
                              <select
                                value={delegatePriority}
                                onChange={event => setDelegatePriority(event.target.value as typeof delegatePriority)}
                                className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30"
                              >
                                <option value="normal">Normal</option>
                                <option value="high">High</option>
                                <option value="urgent">Urgent</option>
                                <option value="low">Low</option>
                              </select>
                            </label>
                            <label className="block text-xs font-medium text-muted-foreground sm:col-span-2">
                              Reason
                              <input
                                value={delegateReason}
                                onChange={event => setDelegateReason(event.target.value)}
                                className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30"
                              />
                            </label>
                            <label className="block text-xs font-medium text-muted-foreground sm:col-span-2">
                              Note
                              <textarea
                                value={delegateNote}
                                onChange={event => setDelegateNote(event.target.value)}
                                rows={3}
                                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30"
                              />
                            </label>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button size="sm" onClick={() => onHandoff(detailedGroup)} disabled={handoff.isPending}>
                              {handoff.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="mr-1 h-3.5 w-3.5" />}
                              Send to Handoff
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => setShowDelegation(false)}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}

                      {lastHandoffId && (
                        <Button variant="outline" size="sm" className="mt-3" asChild>
                          <Link to={`/handoffs?hitl=${lastHandoffId}`}>
                            <ArrowUpRight className="mr-1 h-3.5 w-3.5" />
                            Open Handoff
                          </Link>
                        </Button>
                      )}
                    </div>

                    <div className="rounded-2xl border border-border bg-card p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">Why this score?</p>
                          <p className="mt-1 text-sm text-muted-foreground">{detailedReadiness.reasons[0] ?? trustExplanation(detailedGroup)}</p>
                        </div>
                      </div>
                      <div className="mt-3 space-y-2 text-sm">
                        <div className="flex justify-between gap-3">
                          <span className="text-muted-foreground">Model confidence</span>
                          <span className="font-medium text-foreground">{pct(detailedReadiness.components.model_confidence)}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span className="text-muted-foreground">Source quality</span>
                          <span className="font-medium text-foreground">
                            {pct(detailedReadiness.components.source_quality)}
                          </span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span className="text-muted-foreground">
                            Independent sources
                            <span className="ml-1 text-xs">
                              ({detailedReadiness.components.evidence_count} evidence item{detailedReadiness.components.evidence_count === 1 ? '' : 's'})
                            </span>
                          </span>
                          <span className="font-medium text-foreground">{detailedReadiness.components.independent_source_count}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span className="text-muted-foreground">Typed detail</span>
                          <span className="font-medium text-foreground">
                            {detailedReadiness.components.typed_completeness == null ? 'Not typed' : pct(detailedReadiness.components.typed_completeness)}
                          </span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span className="text-muted-foreground">Conflicts</span>
                          <span className="font-medium text-foreground">{detailedReadiness.components.conflict_count}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span className="text-muted-foreground">Threshold</span>
                          <span className="font-medium text-foreground">{pct(detailedReadiness.threshold)}</span>
                        </div>
                      </div>
                    </div>

                    {relatedSignals.length > 0 && (
                      <div className="rounded-2xl border border-border bg-card p-4">
                        <p className="text-sm font-semibold text-foreground">Related Signals</p>
                        <div className="mt-3 space-y-2">
                          {relatedSignals.map(group => (
                            <button
                              key={group.id}
                              onClick={() => {
                                setSelectedId(group.id);
                                setDrawerView('details');
                                setConfirmDismiss(false);
                              }}
                              className="w-full rounded-xl bg-muted p-3 text-left transition-colors hover:bg-muted/80"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="line-clamp-1 text-sm font-medium text-foreground">{group.title || group.normalized_claim}</span>
                                <span className="text-xs font-semibold text-muted-foreground">{pct(group.aggregate_confidence)}</span>
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">{readinessLabel(readinessForGroup(group).status)}</p>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {evidenceItems(detailedGroup).map(item => (
                      <div key={item.id} className="rounded-2xl border border-border bg-card p-4">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className={item.relation === 'conflicts' ? 'border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'}>
                            {item.relation}
                          </Badge>
                          <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">{item.source}</span>
                          <span className="text-xs font-semibold text-foreground">{pct(item.entry.confidence)}</span>
                        </div>
                        <p className="text-sm font-medium text-foreground">{item.entry.title || item.entry.body}</p>
                        {item.snippet && (
                          <p className="mt-3 border-l-2 border-border pl-3 text-sm text-muted-foreground">
                            {item.snippet}
                          </p>
                        )}
                        <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                          {item.sourceLabel && <p>Source: {String(item.sourceLabel)}</p>}
                          {item.observedAt && <p>Observed: {new Date(item.observedAt).toLocaleString()}</p>}
                          <p>Subject: {item.entry.subject_name ?? item.entry.subject_type}</p>
                        </div>
                      </div>
                    ))}
                    {evidenceItems(detailedGroup).length === 0 && (
                      <div className="flex h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-border text-center text-muted-foreground">
                        <FileText className="mb-2 h-8 w-8" />
                        <p className="text-sm font-medium">No evidence details available</p>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 border-t border-border bg-card p-4">
                <Button
                  onClick={() => onPromote(detailedGroup.id)}
                  disabled={promote.isPending || !canPromote(detailedGroup)}
                  className="bg-emerald-600 text-white hover:bg-emerald-500 disabled:bg-muted disabled:text-muted-foreground"
                >
                  {promote.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}
                  Confirm Signal
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowDelegation(true)}
                  disabled={handoff.isPending || detailedGroup.status === 'promoted' || detailedGroup.status === 'dismissed'}
                >
                  <Users className="mr-1 h-3.5 w-3.5" />
                  Ask someone else
                </Button>
                <Button
                  variant={confirmDismiss ? 'destructive' : 'outline'}
                  onClick={() => {
                    if (confirmDismiss) onDismiss(detailedGroup.id);
                    else setConfirmDismiss(true);
                  }}
                  disabled={reject.isPending || detailedGroup.status === 'promoted' || detailedGroup.status === 'dismissed'}
                  title="Dismiss this Signal so it will not become Memory. Evidence is preserved for audit."
                  className={confirmDismiss
                    ? 'bg-rose-600 text-white hover:bg-rose-500'
                    : 'border-rose-500/30 text-rose-600 hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-400'}
                >
                  {reject.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <X className="mr-1 h-3.5 w-3.5" />}
                  {confirmDismiss ? 'Confirm Dismiss' : 'Dismiss Signal'}
                </Button>
                <Button variant="outline" onClick={() => setDrawerView(drawerView === 'evidence' ? 'details' : 'evidence')}>
                  <Eye className="mr-1 h-3.5 w-3.5" />
                  {drawerView === 'evidence' ? 'View Details' : 'View Evidence'}
                </Button>
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading Signal...
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
