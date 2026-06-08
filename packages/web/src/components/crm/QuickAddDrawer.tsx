// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useRef, useEffect } from 'react';
import { useAppStore, type FieldProvenance, type QuickAddContext } from '@/store/appStore';
import { useAgentSettings } from '@/contexts/AgentSettingsContext';
import { X, Sparkles, Check, FileText, Pencil, ChevronLeft, Bot, ArrowUp, ShieldCheck, Link2, AlertTriangle, Table2 } from 'lucide-react';
import { useCreateContact, useCreateAccount, useCreateOpportunity, useCreateUseCase, useCreateActivity, useCreateAssignment, useActors, useExtractRecordDraft, useUpdateContact, useUpdateAccount, useUpdateOpportunity, useUpdateUseCase } from '@/api/hooks';
import { EntityCombobox } from '@/components/ui/entity-combobox';
import { toast } from '@/components/ui/use-toast';
import { DatePicker, DateTimePicker } from '@/components/ui/date-picker';
import { DuplicateWarning, type DuplicateCandidate } from '@/components/crm/DuplicateWarning';
import { ApiError } from '@/api/client';
import { assertReferenceExists, assertSubjectReference, normalizeSubjectLink, trimStringPayload } from '@/lib/referenceValidation';

const typeLabels: Record<string, string> = {
  contact: 'Contact',
  opportunity: 'Opportunity',
  'use-case': 'Use Case',
  activity: 'Activity',
  account: 'Account',
  assignment: 'Assignment',
};

type DraftFieldRow = {
  field: string;
  label: string;
  value: unknown;
  current_value?: unknown;
  draft_value?: unknown;
  changed?: boolean;
  source: 'user' | 'model_knowledge' | 'matched_record' | 'provider' | 'required';
  source_label?: string;
  confidence_label?: string;
  requires_confirmation?: boolean;
  status: 'ready' | 'missing' | 'linked' | 'optional';
  required: boolean;
};
type EnrichmentSuggestion = {
  field: string;
  label: string;
  value: unknown;
  source: 'model_knowledge' | 'provider';
  source_label: string;
  confidence_label: string;
  requires_confirmation: boolean;
};
type LinkedRecord = {
  type: 'account' | 'contact' | 'opportunity' | 'use_case';
  id: string;
  name: string;
  detail?: string | null;
};
type AgentDraftResult = {
  data: Record<string, unknown>;
  draft?: Record<string, unknown>;
  patch?: Record<string, unknown>;
  operation?: 'create' | 'edit';
  current_record?: Record<string, unknown> | null;
  field_rows?: DraftFieldRow[];
  enrichment_suggestions?: EnrichmentSuggestion[];
  required_fields?: string[];
  missing_fields?: string[];
  linked_records?: LinkedRecord[];
  duplicate_candidates?: DuplicateCandidate[];
  resolution_summary?: string[];
  unresolved_references?: string[];
  work_log?: string[];
  can_create?: boolean;
  can_write?: boolean;
  policy_blockers?: string[];
  action_context?: {
    operating_mode: 'inform' | 'warn' | 'require_review';
    readiness_status: 'ready' | 'review_needed' | 'blocked';
    risk_level: 'low' | 'medium' | 'high';
    review_required: boolean;
    guidance_summary: string;
    warning_reasons?: string[];
    review_reasons?: string[];
    proof?: Record<string, unknown>;
    source_authority?: Record<string, unknown>;
  };
};
type CreatedQuickAddRecord = {
  type: 'contact' | 'opportunity' | 'use-case' | 'activity' | 'account';
  id: string;
  name: string;
  detail?: string;
};
type AgentWriteConfig = {
  can_write_objects?: boolean;
  can_log_activities?: boolean;
  can_create_assignments?: boolean;
} | null | undefined;

function agentCanUseLiteRecordFlow(type: string, config: AgentWriteConfig): boolean {
  if (!config) return false;
  if (type === 'activity') return config.can_log_activities !== false;
  if (type === 'assignment') return config.can_create_assignments !== false;
  return config.can_write_objects !== false;
}

function liteAgentDisabledNotice(type: string): string {
  if (type === 'activity') return 'Workspace Agent activity logging is disabled, so CRMy opened the form.';
  if (type === 'assignment') return 'Workspace Agent assignment creation is disabled, so CRMy opened the form.';
  return 'Workspace Agent record writing is disabled, so CRMy opened the form.';
}

function formatFieldName(key: string): string {
  const labels: Record<string, string> = {
    body: 'notes',
    company_name: 'company',
    first_name: 'first name',
    last_name: 'last name',
    occurred_at: 'occurred at',
  };
  return labels[key] ?? key.replace(/_/g, ' ');
}

function formatFieldValue(value: unknown): string {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(item => formatFieldValue(item)).filter(Boolean).join(', ');
  if (typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${formatFieldName(k)}: ${String(v)}`)
      .join(', ');
  }
  return String(value);
}

function editableFieldValue(value: unknown): string {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(item => String(item)).join(', ');
  return String(value);
}

function parseEditedSuggestionValue(field: string, value: string, previousValue: unknown): unknown {
  const trimmed = value.trim();
  if (Array.isArray(previousValue) || field === 'aliases' || field === 'tags') {
    return trimmed.split(',').map(item => item.trim()).filter(Boolean);
  }
  if (typeof previousValue === 'number') {
    const parsed = Number(trimmed.replace(/[$,]/g, ''));
    return Number.isFinite(parsed) ? parsed : previousValue;
  }
  return trimmed;
}

function missingRequiredDraftFields(type: string, fields: Record<string, unknown>): string[] {
  if (type === 'contact') return fields.first_name ? [] : ['first name'];
  if (type === 'account') return fields.name ? [] : ['account name'];
  if (type === 'opportunity') return fields.name ? [] : ['opportunity name'];
  if (type === 'activity') return fields.type && fields.subject ? [] : ['type', 'subject'].filter(key => !fields[key]);
  if (type === 'use-case') {
    const missing: string[] = [];
    if (!fields.name) missing.push('use case name');
    if (!fields.account_id) missing.push('client');
    return missing;
  }
  if (type === 'assignment') {
    const missing: string[] = [];
    if (!fields.title) missing.push('title');
    if (!fields.assignment_type) missing.push('type');
    if (!fields.assigned_to) missing.push('assignee');
    return missing;
  }
  return [];
}

function normalizeCreatedRecord(type: string, result: unknown): CreatedQuickAddRecord | null {
  const body = (result ?? {}) as Record<string, unknown>;
  const key = type === 'use-case' ? 'use_case' : type;
  const record = (body[key] ?? body.data ?? body) as Record<string, unknown>;

  if (type === 'activity') {
    const id = typeof record.id === 'string' ? record.id : undefined;
    return id ? { type: 'activity', id, name: String(record.subject ?? 'Activity'), detail: String(record.type ?? '') } : null;
  }

  const id = typeof record.id === 'string' ? record.id : undefined;
  if (!id) return null;
  const name = type === 'contact'
    ? `${String(record.first_name ?? '')} ${String(record.last_name ?? '')}`.trim()
    : String(record.name ?? typeLabels[type]);
  return {
    type: type === 'use-case' ? 'use-case' : type as CreatedQuickAddRecord['type'],
    id,
    name: name || typeLabels[type],
    detail: String(record.stage ?? record.industry ?? record.company_name ?? record.email ?? ''),
  };
}

function draftRowsFallback(type: string, draft: Record<string, unknown> | null, missing: string[]): DraftFieldRow[] {
  const rows: DraftFieldRow[] = [];
  if (draft) {
    for (const [field, value] of Object.entries(draft)) {
      if (value === undefined || value === '') continue;
      const isLinked = field.endsWith('_id') || field === 'subject_id';
      rows.push({
        field,
        label: formatFieldName(field).replace(/\b\w/g, char => char.toUpperCase()),
        value,
        source: isLinked ? 'matched_record' : 'user',
        source_label: isLinked ? 'Matched existing record' : 'Provided by user',
        status: isLinked ? 'linked' : 'ready',
        required: missing.includes(field),
      });
    }
  }
  for (const field of missing) {
    if (!rows.some(row => row.field === field)) {
      rows.push({
        field,
        label: formatFieldName(field),
        value: null,
        source: 'required',
        source_label: 'Needs confirmation',
        status: 'missing',
        required: true,
        requires_confirmation: true,
      });
    }
  }
  return rows;
}

function provenanceFromRows(rows: DraftFieldRow[], excludedFields: string[] = []): Record<string, FieldProvenance> {
  const provenance: Record<string, FieldProvenance> = {};
  for (const row of rows) {
    if (row.source !== 'model_knowledge' && row.source !== 'provider') continue;
    if (excludedFields.includes(row.field)) continue;
    provenance[row.field] = {
      source: row.source,
      source_label: row.source_label ?? 'Suggested by model',
      confidence_label: row.confidence_label,
      requires_confirmation: row.requires_confirmation,
    };
  }
  return provenance;
}

function LightweightRecordAgentPanel({ type, onClose, context }: { type: string; onClose: () => void; context?: QuickAddContext | null }) {
  const [input, setInput] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [draftResult, setDraftResult] = useState<AgentDraftResult | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[] | null>(null);
  const [pendingPayload, setPendingPayload] = useState<Record<string, unknown> | null>(null);
  const [excludedSuggestionFields, setExcludedSuggestionFields] = useState<string[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { openDrawer, openDrawerEdit, closeQuickAdd, setRecordFieldProvenance } = useAppStore();

  const createContact = useCreateContact();
  const createAccount = useCreateAccount();
  const createOpportunity = useCreateOpportunity();
  const createUseCase = useCreateUseCase();
  const createActivity = useCreateActivity();
  const updateContact = useUpdateContact(context?.record_id ?? '');
  const updateAccount = useUpdateAccount(context?.record_id ?? '');
  const updateOpportunity = useUpdateOpportunity(context?.record_id ?? '');
  const updateUseCase = useUpdateUseCase(context?.record_id ?? '');
  const extractRecordDraft = useExtractRecordDraft();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const mode = context?.mode === 'edit' ? 'edit' : 'create';
  const draft = draftResult?.patch ?? draftResult?.draft ?? draftResult?.data ?? null;
  const missing = draftResult?.missing_fields ?? (draft ? missingRequiredDraftFields(type, draft) : []);
  const linkedRecords = draftResult?.linked_records ?? [];
  const fieldRows = draftResult?.field_rows ?? draftRowsFallback(type, draft, missing);
  const enrichmentSuggestions = draftResult?.enrichment_suggestions ?? [];
  const possibleDuplicates = duplicates ?? draftResult?.duplicate_candidates ?? [];
  const policyBlockers = draftResult?.policy_blockers ?? [];
  const actionContext = draftResult?.action_context;
  const definitiveDuplicate = possibleDuplicates.some(candidate => candidate.score >= 90);
  const serverCanCreate = draftResult?.can_create;
  const serverCanWrite = draftResult?.can_write;
  const canCreate = Boolean(draft)
    && missing.length === 0
    && !definitiveDuplicate
    && (serverCanCreate === undefined || serverCanCreate)
    && !isSubmitting
    && !isExtracting;
  const canWrite = mode === 'edit'
    && Boolean(draft)
    && Object.keys(draft ?? {}).length > 0
    && policyBlockers.length === 0
    && (serverCanWrite === undefined || serverCanWrite)
    && !isSubmitting
    && !isExtracting;
  const canConfirm = mode === 'edit' ? canWrite : canCreate;

  const applyExcludedSuggestions = (payload: Record<string, unknown>) => {
    if (type !== 'account') return payload;
    for (const field of excludedSuggestionFields) delete payload[field];
    return payload;
  };

  const handleSuggestionChange = (suggestion: EnrichmentSuggestion, rawValue: string) => {
    const value = parseEditedSuggestionValue(suggestion.field, rawValue, suggestion.value);
    setDraftResult(prev => {
      if (!prev) return prev;
      const updateDraft = (target?: Record<string, unknown>) => target ? { ...target, [suggestion.field]: value } : target;
      return {
        ...prev,
        data: updateDraft(prev.data) ?? prev.data,
        draft: updateDraft(prev.draft ?? prev.data),
        field_rows: prev.field_rows?.map(row => row.field === suggestion.field
          ? {
              ...row,
              value,
              source_label: row.source === 'model_knowledge' ? 'Edited model suggestion' : row.source_label,
              confidence_label: row.source === 'model_knowledge' ? 'User reviewed' : row.confidence_label,
              requires_confirmation: true,
            }
          : row),
        enrichment_suggestions: prev.enrichment_suggestions?.map(item => item.field === suggestion.field
          ? {
              ...item,
              value,
              source_label: item.source === 'model_knowledge' ? 'Edited model suggestion' : item.source_label,
              confidence_label: item.source === 'model_knowledge' ? 'User reviewed' : item.confidence_label,
              requires_confirmation: true,
            }
          : item),
      };
    });
  };

  const handleFieldChange = (row: DraftFieldRow, rawValue: string) => {
    const previousValue = row.draft_value ?? row.value;
    const value = parseEditedSuggestionValue(row.field, rawValue, previousValue);
    setDraftResult(prev => {
      if (!prev) return prev;
      const current = prev.patch ?? prev.draft ?? prev.data ?? {};
      const nextDraft = { ...current, [row.field]: value };
      const currentValue = row.current_value;
      const changed = mode === 'edit' ? formatFieldValue(currentValue) !== formatFieldValue(value) : true;
      const nextMissing = (prev.missing_fields ?? []).filter(field => field !== row.field);
      if ((value == null || value === '') && row.required && !nextMissing.includes(row.field)) nextMissing.push(row.field);
      const nextRows = prev.field_rows?.map(item => item.field === row.field
        ? {
            ...item,
            value,
            draft_value: value,
            changed,
            status: value == null || value === '' ? 'missing' as const : item.status === 'missing' ? 'ready' as const : item.status,
            source_label: item.source === 'model_knowledge' ? 'Edited model suggestion' : item.source_label,
            confidence_label: item.source === 'model_knowledge' ? 'User reviewed' : item.confidence_label,
          }
        : item);
      return {
        ...prev,
        data: nextDraft,
        draft: mode === 'create' ? nextDraft : prev.draft,
        patch: mode === 'edit' ? nextDraft : prev.patch,
        field_rows: nextRows,
        missing_fields: nextMissing,
      };
    });
  };

  const handleExtract = async () => {
    if (!input.trim() || isSubmitting || isExtracting) return;
    const text = input.trim();
    setInput('');
    setIsExtracting(true);
    try {
      const result = await extractRecordDraft.mutateAsync({
        text,
        mode,
        object_type: type,
        record_type: type,
        record_id: context?.record_id,
        parent_subject_type: context?.parent_subject_type,
        parent_subject_id: context?.parent_subject_id,
        parent_subject_name: context?.parent_subject_name,
        defaults: mode === 'create' ? { ...(context?.defaults ?? {}), ...(draft ?? {}) } : context?.defaults,
      });
      setDraftResult(result);
      setExcludedSuggestionFields([]);
      setDuplicates(result.duplicate_candidates?.length ? result.duplicate_candidates : null);
    } catch (err) {
      console.warn('[quick-add] agent extraction failed, opening form:', err);
      toast({
        title: 'Workspace Agent unavailable',
        description: mode === 'edit'
          ? 'Workspace Agent is unavailable, so CRMy reopened the record details.'
          : 'Workspace Agent is unavailable, so CRMy opened the form.',
        variant: 'destructive',
      });
      if (mode === 'edit' && context?.record_id) {
        closeQuickAdd();
        openDrawerEdit(type === 'use-case' ? 'use-case' : type as Parameters<typeof openDrawer>[0], context.record_id);
      } else {
        setShowForm(true);
      }
    } finally {
      setIsExtracting(false);
    }
  };

  const createFromPayload = async (payload: Record<string, unknown>) => {
    if (type === 'contact') return createContact.mutateAsync(payload);
    if (type === 'account') return createAccount.mutateAsync(payload);
    if (type === 'opportunity') return createOpportunity.mutateAsync(payload);
    if (type === 'use-case') return createUseCase.mutateAsync(payload);
    if (type === 'activity') return createActivity.mutateAsync(payload);
    throw new Error(`Unsupported quick add type: ${type}`);
  };

  const updateFromPayload = async (payload: Record<string, unknown>) => {
    if (type === 'contact') return updateContact.mutateAsync(payload);
    if (type === 'account') return updateAccount.mutateAsync(payload);
    if (type === 'opportunity') return updateOpportunity.mutateAsync(payload);
    if (type === 'use-case') return updateUseCase.mutateAsync(payload);
    throw new Error(`Unsupported record update type: ${type}`);
  };

  const handleWrite = async (allowDuplicates = false, payloadOverride?: Record<string, unknown> | null) => {
    const payload: Record<string, unknown> = applyExcludedSuggestions({ ...(payloadOverride ?? draft ?? {}), ...(allowDuplicates ? { allow_duplicates: true } : {}) });
    if (!payload || isSubmitting || isExtracting) return;
    setIsSubmitting(true);
    try {
      normalizeSubjectLink(payload);
      await assertSubjectReference(payload.subject_type as string | undefined, payload.subject_id as string | undefined);
      await validateReferences(payload);
      if (mode === 'edit') {
        const updatePayload = draftResult?.action_context
          ? { patch: payload, action_context: draftResult.action_context }
          : payload;
        const result = await updateFromPayload(updatePayload);
        const updatedRecord = normalizeCreatedRecord(type, result) ?? (context?.record_id
          ? { type: type === 'use-case' ? 'use-case' : type as CreatedQuickAddRecord['type'], id: context.record_id, name: context.record_name ?? typeLabels[type] }
          : null);
        toast({ title: `${typeLabels[type]} updated`, description: updatedRecord ? 'Opening the updated record.' : 'Changes saved.' });
        closeQuickAdd();
        if (updatedRecord) openDrawer(updatedRecord.type, updatedRecord.id);
        return;
      }
      const result = await createFromPayload(payload);
      const createdRecord = normalizeCreatedRecord(type, result);
      if (createdRecord && type === 'account') {
        const provenance = provenanceFromRows(fieldRows, excludedSuggestionFields);
        if (Object.keys(provenance).length > 0) {
          setRecordFieldProvenance(createdRecord.type, createdRecord.id, provenance);
        }
      }
      toast({ title: `${typeLabels[type]} created`, description: createdRecord ? 'Opening the new record.' : 'Added to CRMy.' });
      closeQuickAdd();
      if (createdRecord) openDrawer(createdRecord.type, createdRecord.id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.candidates.length > 0) {
        setDuplicates(err.candidates as DuplicateCandidate[]);
        setPendingPayload(payload);
      } else {
        toast({ title: `Failed to ${mode === 'edit' ? 'update' : 'create'} ${typeLabels[type]}`, description: err instanceof Error ? err.message : 'Please try again.', variant: 'destructive' });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const validateReferences = async (payload: Record<string, unknown>) => {
    if (typeof payload.account_id === 'string') await assertReferenceExists('account', payload.account_id, 'account');
    if (typeof payload.contact_id === 'string') await assertReferenceExists('contact', payload.contact_id, 'contact');
    if (typeof payload.opportunity_id === 'string') await assertReferenceExists('opportunity', payload.opportunity_id, 'opportunity');
    if (typeof payload.use_case_id === 'string') await assertReferenceExists('use_case', payload.use_case_id, 'use case');
  };

  if (showForm) {
    return <ManualForm type={type} onClose={onClose} onBack={() => setShowForm(false)} backLabel={mode === 'edit' ? 'Back to agent update' : 'Back to agent create'} initialFields={draft ?? context?.defaults ?? undefined} />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-500/15">
            <Bot className="h-4 w-4 text-violet-400" />
          </span>
          <div className="min-w-0">
            <p className="font-display text-sm font-bold text-foreground">{mode === 'edit' ? 'Update' : 'New'} {typeLabels[type]}</p>
            <p className="truncate text-xs text-muted-foreground">
              {mode === 'edit'
                ? `Editing ${context?.record_name ?? typeLabels[type]}. Review before CRMy writes.`
                : context?.parent_subject_name ? `Scoped to ${context.parent_subject_name}` : 'Describe it naturally. Review before CRMy writes.'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (mode === 'edit' && context?.record_id) {
                closeQuickAdd();
                openDrawerEdit(type === 'use-case' ? 'use-case' : type as Parameters<typeof openDrawer>[0], context.record_id);
              } else {
                setShowForm(true);
              }
            }}
            className="flex items-center gap-1.5 rounded-md border border-border/70 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <FileText className="h-3 w-3" /> Use form
          </button>
          <button onClick={onClose} className="rounded-lg p-1.5 transition-colors hover:bg-muted">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      </div>

      <div className="border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/25 bg-violet-500/10 px-2.5 py-1 text-xs font-semibold text-violet-300">
            <ShieldCheck className="h-3 w-3" /> Preview before write
          </span>
          {context?.parent_subject_name && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-foreground">
              <Link2 className="h-3 w-3 text-muted-foreground" /> {context.parent_subject_name}
            </span>
          )}
          {linkedRecords.map(record => (
            <span key={`${record.type}-${record.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-foreground">
              <Link2 className="h-3 w-3 text-muted-foreground" /> {record.name}
            </span>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isExtracting ? (
          <div className="rounded-2xl border border-violet-500/25 bg-violet-500/8 p-6 text-center">
            <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-500/15">
              <Sparkles className="h-5 w-5 animate-spin text-violet-300" />
            </span>
            <p className="mt-3 text-sm font-semibold text-foreground">{mode === 'edit' ? 'Drafting update' : `Drafting ${typeLabels[type].toLowerCase()}`}…</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
              CRMy is reading your details, checking safe fields, and matching visible customer records.
            </p>
          </div>
        ) : !draft ? (
          <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-6 text-center">
            <Table2 className="mx-auto h-5 w-5 text-violet-400" />
            <p className="mt-2 text-sm font-semibold text-foreground">{mode === 'edit' ? 'Describe the update' : `Add ${typeLabels[type].toLowerCase()} details`}</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
              {mode === 'edit'
                ? 'Describe what changed in plain language. CRMy will draft a minimal update and preview every field before writing.'
                : `Describe the ${typeLabels[type].toLowerCase()} in plain language. CRMy will draft the right fields, check required details, and preview everything before writing.`}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-foreground">{mode === 'edit' ? 'Update preview' : 'Draft preview'}</p>
                <p className="text-xs text-muted-foreground">
                  {mode === 'edit'
                    ? policyBlockers.length ? `${policyBlockers.length} guarded change${policyBlockers.length === 1 ? '' : 's'} need review` : Object.keys(draft ?? {}).length ? 'Ready for your confirmation' : 'No changes drafted yet'
                    : missing.length ? `${missing.length} required detail${missing.length === 1 ? '' : 's'} missing` : 'Ready for your confirmation'}
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${(mode === 'edit' ? policyBlockers.length > 0 : missing.length > 0) ? 'bg-amber-500/10 text-amber-400' : 'bg-success/10 text-success'}`}>
                {(mode === 'edit' ? policyBlockers.length > 0 : missing.length > 0) ? 'Needs review' : 'Ready'}
              </span>
            </div>
            {actionContext && (
              <div className="border-b border-border bg-muted/20 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    actionContext.readiness_status === 'blocked'
                      ? 'bg-destructive/10 text-destructive'
                      : actionContext.readiness_status === 'review_needed'
                      ? 'bg-amber-500/10 text-amber-400'
                      : 'bg-success/10 text-success'
                  }`}>
                    Action Context · {actionContext.readiness_status === 'review_needed' ? 'Review needed' : actionContext.readiness_status === 'blocked' ? 'Blocked' : 'Ready'}
                  </span>
                  <span className="text-xs text-muted-foreground">{actionContext.guidance_summary}</span>
                </div>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Field</th>
                    {mode === 'edit' && <th className="px-4 py-2 font-medium">Current value</th>}
                    <th className="px-4 py-2 font-medium">{mode === 'edit' ? 'Suggested value' : 'Draft value'}</th>
                    <th className="px-4 py-2 font-medium">Source / reason</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {fieldRows.map(row => (
                    <tr key={row.field}>
                      <td className="px-4 py-2 text-foreground">
                        {row.label}
                        {row.required && <span className="ml-1 text-amber-400">*</span>}
                      </td>
                      {mode === 'edit' && (
                        <td className="max-w-[220px] px-4 py-2 text-muted-foreground">
                          <span className="line-clamp-2">{row.current_value == null ? 'Empty' : formatFieldValue(row.current_value)}</span>
                        </td>
                      )}
                      <td className="max-w-[260px] px-4 py-2 text-muted-foreground">
                        <input
                          value={editableFieldValue(row.draft_value ?? row.value)}
                          onChange={(e) => handleFieldChange(row, e.target.value)}
                          className="h-8 w-full rounded-lg border border-border bg-background px-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-violet-500/40"
                          placeholder="Missing"
                        />
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        <div className="flex flex-col gap-0.5">
                          <span>{row.source_label ?? row.source}</span>
                          {row.confidence_label && <span className="text-[11px] text-amber-300">{row.confidence_label}</span>}
                          {row.requires_confirmation && row.status !== 'missing' && (
                            <span className="text-[11px] text-muted-foreground">Confirm before saving</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          row.status === 'missing' ? 'bg-amber-500/10 text-amber-400' :
                          row.status === 'linked' ? 'bg-blue-500/10 text-blue-400' :
                          mode === 'edit' && !row.changed ? 'bg-muted text-muted-foreground' :
                          'bg-success/10 text-success'
                        }`}>
                          {row.status === 'missing' ? 'Needs detail' : row.status === 'linked' ? 'Linked' : mode === 'edit' && !row.changed ? 'Unchanged' : 'Ready'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-2 border-t border-border bg-background/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">Confirm before CRMy writes</p>
                <p className="text-xs text-muted-foreground">
                  {mode === 'edit'
                    ? canWrite
                      ? `This will update ${Object.keys(draft ?? {}).length} field${Object.keys(draft ?? {}).length === 1 ? '' : 's'}.`
                      : policyBlockers.length
                        ? 'Some suggested changes need form review or a governed workflow.'
                        : 'Review the draft before updating.'
                    : canCreate
                      ? `This will create one ${typeLabels[type].toLowerCase()} record.`
                      : missing.length
                      ? `Add ${missing.length} required detail${missing.length === 1 ? '' : 's'} before creating.`
                      : definitiveDuplicate
                        ? 'Use the existing record or review the duplicate before creating.'
                        : 'Review the draft before creating.'}
                </p>
              </div>
              <button
                onClick={() => handleWrite(false)}
                disabled={!canConfirm}
                className="flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl bg-success px-3.5 text-sm font-semibold text-success-foreground transition-colors hover:bg-success/90 disabled:opacity-40"
              >
                {isSubmitting ? (mode === 'edit' ? 'Updating...' : 'Creating...') : `Confirm and ${mode === 'edit' ? 'update' : 'create'} ${typeLabels[type]}`}
                {!isSubmitting && <Check className="h-4 w-4" />}
              </button>
            </div>
          </div>
        )}

        {type === 'account' && enrichmentSuggestions.length > 0 && (
          <div className="rounded-2xl border border-violet-500/25 bg-violet-500/8 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">Enrichment</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  CRMy suggested these account details from model knowledge. Confirm before saving.
                </p>
              </div>
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-300">
                Unverified
              </span>
            </div>
            <div className="mt-3 grid gap-2">
              {enrichmentSuggestions.map(suggestion => {
                const excluded = excludedSuggestionFields.includes(suggestion.field);
                return (
                  <div key={suggestion.field} className="grid gap-2 rounded-xl border border-border/70 bg-background/50 p-3 sm:grid-cols-[1.1fr,1.2fr,auto] sm:items-center">
                    <label className="block">
                      <span className="mb-1 block text-xs text-muted-foreground">{suggestion.label}</span>
                      <input
                        value={editableFieldValue(suggestion.value)}
                        onChange={(e) => handleSuggestionChange(suggestion, e.target.value)}
                        disabled={excluded}
                        className={`h-9 w-full rounded-lg border border-border bg-background px-2.5 text-sm font-semibold outline-none transition-colors focus:ring-1 focus:ring-violet-500/40 disabled:cursor-not-allowed disabled:opacity-50 ${
                          excluded ? 'text-muted-foreground line-through' : 'text-foreground'
                        }`}
                      />
                    </label>
                    <div className="text-xs text-muted-foreground">
                      <span>{suggestion.source_label}</span>
                      <span className="mx-1.5">·</span>
                      <span className={suggestion.confidence_label === 'User reviewed' ? 'text-success' : 'text-amber-300'}>{suggestion.confidence_label}</span>
                      <span className="mx-1.5">·</span>
                      <span>{excluded ? 'Will not be saved' : 'Will be saved when you confirm'}</span>
                    </div>
                    <button
                      onClick={() => setExcludedSuggestionFields(prev => (
                        excluded ? prev.filter(field => field !== suggestion.field) : [...prev, suggestion.field]
                      ))}
                      className="h-8 rounded-lg border border-border px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      {excluded ? 'Include' : 'Skip'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {draftResult?.unresolved_references?.length ? (
          <div className="rounded-2xl border border-amber-500/25 bg-amber-500/8 p-3 text-xs text-amber-200">
            <div className="mb-1 flex items-center gap-2 font-semibold"><AlertTriangle className="h-3.5 w-3.5" /> Needs a little help</div>
            {draftResult.unresolved_references.map(item => <p key={item}>{item}</p>)}
          </div>
        ) : null}

        {policyBlockers.length > 0 && (
          <div className="rounded-2xl border border-amber-500/25 bg-amber-500/8 p-3 text-xs text-amber-200">
            <div className="mb-1 flex items-center gap-2 font-semibold"><AlertTriangle className="h-3.5 w-3.5" /> Guarded changes</div>
            {policyBlockers.map(item => <p key={item}>{item}</p>)}
          </div>
        )}

        {possibleDuplicates.length > 0 && draft && ['contact', 'account', 'opportunity', 'use-case'].includes(type) && (
          <DuplicateWarning
            entityType={type as 'contact' | 'account' | 'opportunity' | 'use-case'}
            candidates={possibleDuplicates}
            onUseExisting={(id) => {
              openDrawer(type === 'use-case' ? 'use-case' : type as Parameters<typeof openDrawer>[0], id);
              closeQuickAdd();
            }}
            onCreateAnyway={() => handleWrite(true, pendingPayload ?? draft)}
            onCancel={() => { setDuplicates(null); setPendingPayload(null); }}
          />
        )}
      </div>

      <div className="border-t border-border p-3">
        <div className="mb-2 flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleExtract();
              }
            }}
            placeholder={mode === 'edit' ? `Describe the update to ${context?.record_name ?? typeLabels[type]}…` : `Describe the ${typeLabels[type].toLowerCase()} to create…`}
            rows={1}
            className="min-h-[42px] flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-violet-500/40"
          />
          <button
            onClick={handleExtract}
            disabled={!input.trim() || isSubmitting || isExtracting}
            className="flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-white text-background transition-colors hover:bg-white/90 disabled:opacity-40"
          >
            {isExtracting ? <Sparkles className="h-4 w-4 animate-pulse" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </div>
        <button
          onClick={() => handleWrite(false)}
          disabled={!canConfirm}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-success text-success-foreground text-sm font-semibold transition-colors hover:bg-success/90 disabled:opacity-40"
        >
          {isSubmitting ? (mode === 'edit' ? 'Updating...' : 'Creating...') : `Confirm and ${mode === 'edit' ? 'update' : 'create'} ${typeLabels[type]}`}
          {!isSubmitting && <Check className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

type FieldConfig = {
  key: string;
  label: string;
  placeholder?: string;
  inputType?: 'text' | 'email' | 'tel' | 'number' | 'date' | 'url' | 'datetime-local';
  fieldType?: 'textarea' | 'select' | 'account-select' | 'contact-select' | 'opportunity-select' | 'subject-type-select' | 'entity-select' | 'datalist' | 'actor-select';
  options?: string[];
  datalistId?: string;
  suggestions?: string[];
  required?: boolean;
  dependsOn?: { key: string; values?: string[] };
};

const FIELD_CONFIGS: Record<string, FieldConfig[]> = {
  contact: [
    { key: 'first_name', label: 'First Name', placeholder: 'First name', required: true },
    { key: 'last_name', label: 'Last Name', placeholder: 'Last name' },
    { key: 'email', label: 'Email', placeholder: 'email@example.com', inputType: 'email' },
    { key: 'phone', label: 'Phone', placeholder: '(555) 123-4567', inputType: 'tel' },
    { key: 'company_name', label: 'Account', placeholder: 'Account name' },
    { key: 'account_id', label: 'Existing Account', fieldType: 'account-select' },
  ],
  opportunity: [
    { key: 'name', label: 'Opportunity Name', placeholder: 'e.g. Northstar Agent Context Rollout', required: true },
    { key: 'account_id', label: 'Account', fieldType: 'account-select' },
    { key: 'contact_id', label: 'Primary Contact', fieldType: 'contact-select' },
    { key: 'amount', label: 'Amount ($)', placeholder: '850000', inputType: 'number' },
    { key: 'close_date', label: 'Close Date', inputType: 'date' },
    { key: 'description', label: 'Description', placeholder: 'Optional notes', fieldType: 'textarea' },
  ],
  'use-case': [
    { key: 'name', label: 'Name', placeholder: 'e.g. Corporate Relocation', required: true },
    { key: 'account_id', label: 'Account', fieldType: 'account-select', required: true },
    { key: 'opportunity_id', label: 'Opportunity', fieldType: 'opportunity-select' },
    { key: 'stage', label: 'Stage', fieldType: 'select', options: ['discovery', 'poc', 'production', 'scaling', 'sunset'] },
    { key: 'attributed_arr', label: 'Attributed ARR ($)', placeholder: '120000', inputType: 'number' },
    { key: 'target_prod_date', label: 'Target Prod Date', inputType: 'date' },
    { key: 'description', label: 'Description', placeholder: 'Any additional details', fieldType: 'textarea' },
  ],
  activity: [
    { key: 'type', label: 'Type', fieldType: 'select', options: ['call', 'email', 'meeting', 'note', 'task', 'demo', 'proposal', 'research', 'handoff', 'status_update'], required: true},
    { key: 'subject', label: 'Subject', placeholder: 'What was this activity about?', required: true },
    { key: 'subject_type', label: 'Linked To', fieldType: 'subject-type-select', placeholder: 'Link to a customer object (optional)' },
    { key: 'subject_id', label: 'Record', fieldType: 'entity-select', dependsOn: { key: 'subject_type' } },
    { key: 'direction', label: 'Direction', fieldType: 'select', options: ['inbound', 'outbound'] },
    { key: 'occurred_at', label: 'When', inputType: 'datetime-local', placeholder: 'When did this happen?' },
    { key: 'duration_minutes', label: 'Duration (minutes)', placeholder: '30', inputType: 'number' },
    { key: 'outcome', label: 'Outcome', fieldType: 'datalist', datalistId: 'outcome-suggestions', suggestions: ['connected', 'voicemail', 'positive', 'negative', 'neutral', 'no_show', 'follow_up_needed'], placeholder: 'e.g. connected, positive, voicemail' },
    { key: 'body', label: 'Notes', placeholder: 'Additional details...', fieldType: 'textarea' },
  ],
  account: [
    { key: 'name', label: 'Account Name', placeholder: 'e.g. Northstar Labs', required: true },
    { key: 'industry', label: 'Industry', placeholder: 'e.g. Real Estate, Technology' },
    { key: 'website', label: 'Website', placeholder: 'https://acme.com', inputType: 'url' },
    { key: 'domain', label: 'Domain', placeholder: 'acme.com' },
    { key: 'aliases', label: 'Aliases', placeholder: 'Comma-separated alternate names' },
    { key: 'tags', label: 'Tags', placeholder: 'Comma-separated tags' },
  ],
  assignment: [
    { key: 'title', label: 'Title', placeholder: 'e.g. Follow up with Northstar about security review', required: true },
    { key: 'assignment_type', label: 'Type', fieldType: 'select', options: ['call', 'draft', 'email', 'follow_up', 'research', 'review', 'send'], required: true },
    { key: 'assigned_to', label: 'Assign To', fieldType: 'actor-select', required: true },
    { key: 'subject_type', label: 'Linked To', fieldType: 'subject-type-select' },
    { key: 'subject_id', label: 'Record', fieldType: 'entity-select', dependsOn: { key: 'subject_type' } },
    { key: 'priority', label: 'Priority', fieldType: 'select', options: ['low', 'normal', 'high', 'urgent'] },
    { key: 'due_at', label: 'Due Date', inputType: 'date' },
    { key: 'context', label: 'Context', placeholder: 'Brief context for the assignee', fieldType: 'textarea' },
    { key: 'description', label: 'Description', placeholder: 'Additional details', fieldType: 'textarea' },
  ],
};

const SUBJECT_TYPE_OPTIONS = [
  { value: '', label: 'None (no link)' },
  { value: 'contact', label: 'Contact' },
  { value: 'account', label: 'Account' },
  { value: 'opportunity', label: 'Opportunity' },
  { value: 'use_case', label: 'Use Case' },
];

function EntitySelect({ subjectType, value, onChange }: { subjectType: string; value: string; onChange: (v: string) => void }) {
  const validTypes = ['account', 'contact', 'opportunity', 'use_case'];
  if (!subjectType || !validTypes.includes(subjectType)) return null;
  return (
    <EntityCombobox
      entityType={subjectType as 'account' | 'contact' | 'opportunity' | 'use_case'}
      value={value}
      onChange={onChange}
      placeholder={`Select ${subjectType.replace('_', ' ')}…`}
    />
  );
}

function ActorSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: actorsData } = useActors({ limit: 100, is_active: true }) as any;
  const actors: Array<{ id: string; display_name: string; actor_type: string }> = actorsData?.data ?? actorsData?.actors ?? [];
  const inputClass = 'w-full h-10 px-3 rounded-md border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={`${inputClass} pr-3`}>
      <option value="">Select actor…</option>
      {actors.map(a => (
        <option key={a.id} value={a.id}>
          {a.display_name} ({a.actor_type})
        </option>
      ))}
    </select>
  );
}

function stringifyInitialFields(initialFields?: Record<string, unknown> | null): Record<string, string> {
  if (!initialFields) return {};
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(initialFields)) {
    if (value == null) continue;
    if (Array.isArray(value)) fields[key] = value.map(item => String(item)).join(', ');
    else if (typeof value !== 'object') fields[key] = String(value);
  }
  return fields;
}

function ManualForm({
  type,
  onClose,
  onBack,
  backLabel,
  initialFields,
  notice,
}: {
  type: string;
  onClose: () => void;
  onBack?: () => void;
  backLabel?: string;
  initialFields?: Record<string, unknown> | null;
  notice?: string;
}) {
  const [fields, setFields] = useState<Record<string, string>>(() => stringifyInitialFields(initialFields));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [duplicateCandidates, setDuplicateCandidates] = useState<DuplicateCandidate[] | null>(null);
  const [pendingPayload, setPendingPayload] = useState<Record<string, unknown> | null>(null);
  const { openDrawer, closeQuickAdd } = useAppStore();

  const createContact = useCreateContact();
  const createAccount = useCreateAccount();
  const createOpportunity = useCreateOpportunity();
  const createUseCase = useCreateUseCase();
  const createActivity = useCreateActivity();
  const createAssignment = useCreateAssignment();

  const config = FIELD_CONFIGS[type] ?? FIELD_CONFIGS.contact;

  const isValid = () => {
    if (type === 'contact') return !!fields.first_name?.trim();
    if (type === 'activity') return !!fields.type && !!fields.subject?.trim();
    if (type === 'use-case') return !!fields.name?.trim() && !!fields.account_id;
    if (type === 'assignment') return !!fields.title?.trim() && !!fields.assignment_type && !!fields.assigned_to;
    return !!fields.name?.trim();
  };

  const set = (key: string, val: string) => setFields(prev => ({ ...prev, [key]: val }));

  const buildPayload = (): Record<string, unknown> => {
    const payload: Record<string, unknown> = { ...fields };
    trimStringPayload(payload);
    if (type === 'contact') delete payload.name;
    if (type === 'opportunity') { if (fields.amount) payload.amount = parseFloat(fields.amount) || 0; payload.stage = 'prospecting'; }
    if (type === 'use-case') { if (!payload.stage) payload.stage = 'discovery'; if (fields.attributed_arr) payload.attributed_arr = parseFloat(fields.attributed_arr) || 0; }
    if (type === 'account') {
      if (typeof payload.website === 'string') {
        payload.website = payload.website.startsWith('http') ? payload.website : `https://${payload.website}`;
      }
      if (typeof payload.aliases === 'string') {
        payload.aliases = payload.aliases.split(',').map(item => item.trim()).filter(Boolean);
      }
      if (typeof payload.tags === 'string') {
        payload.tags = payload.tags.split(',').map(item => item.trim()).filter(Boolean);
      }
    }
    if (type === 'activity') {
      if (fields.occurred_at) payload.occurred_at = new Date(fields.occurred_at).toISOString();
      normalizeSubjectLink(payload);
      if (fields.duration_minutes) {
        const duration = parseInt(fields.duration_minutes, 10);
        if (Number.isFinite(duration) && duration > 0) payload.detail = { duration_minutes: duration };
      }
      delete payload.duration_minutes;
    }
    if (type === 'assignment') {
      if (fields.due_at) payload.due_at = new Date(fields.due_at + 'T00:00:00').toISOString();
      normalizeSubjectLink(payload);
      if (!fields.due_at) delete payload.due_at;
      if (!fields.priority) payload.priority = 'normal';
    }
    return payload;
  };

  const validateReferences = async (payload: Record<string, unknown>) => {
    if (typeof payload.account_id === 'string') await assertReferenceExists('account', payload.account_id, 'account');
    if (typeof payload.contact_id === 'string') await assertReferenceExists('contact', payload.contact_id, 'contact');
    if (typeof payload.opportunity_id === 'string') await assertReferenceExists('opportunity', payload.opportunity_id, 'opportunity');
    if (typeof payload.assigned_to === 'string') await assertReferenceExists('actor', payload.assigned_to, 'assignee');
    if (type === 'activity' || type === 'assignment') {
      await assertSubjectReference(payload.subject_type as string | undefined, payload.subject_id as string | undefined);
    }
  };

  const executeCreate = async (payload: Record<string, unknown>) => {
    if (type === 'contact') await createContact.mutateAsync(payload);
    else if (type === 'account') await createAccount.mutateAsync(payload);
    else if (type === 'opportunity') await createOpportunity.mutateAsync(payload);
    else if (type === 'use-case') await createUseCase.mutateAsync(payload);
    else if (type === 'activity') await createActivity.mutateAsync(payload);
    else if (type === 'assignment') await createAssignment.mutateAsync(payload);
    const label = fields.first_name ?? fields.title ?? fields.name ?? fields.subject ?? typeLabels[type];
    toast({ title: `${typeLabels[type]} created`, description: `${label} has been added. Open the record for briefing, context, and audit actions.` });
    onClose();
  };

  const handleSubmit = async () => {
    if (!isValid() || isSubmitting) return;
    setIsSubmitting(true);
    const payload = buildPayload();
    try {
      await validateReferences(payload);
      await executeCreate(payload);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.candidates.length > 0) {
        setDuplicateCandidates(err.candidates as DuplicateCandidate[]);
        setPendingPayload(payload);
      } else {
        toast({ title: `Failed to create ${typeLabels[type]}`, description: err instanceof Error ? err.message : 'Please try again.', variant: 'destructive' });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClass = 'w-full h-10 px-3 rounded-md border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';

  // Check if a field should be visible based on its dependsOn condition
  const isFieldVisible = (f: FieldConfig) => {
    if (!f.dependsOn) return true;
    const depVal = fields[f.dependsOn.key];
    if (!depVal) return false;
    if (f.dependsOn.values) return f.dependsOn.values.includes(depVal);
    return true;
  };

  // ── Duplicate warning overlay ────────────────────────────────────────────
  if (duplicateCandidates && pendingPayload) {
    const entityType = type as 'contact' | 'account' | 'opportunity' | 'use-case';
    return (
      <div className="flex-1 overflow-y-auto p-4">
        <DuplicateWarning
          entityType={entityType}
          candidates={duplicateCandidates}
          onUseExisting={(id) => {
            openDrawer(entityType === 'use-case' ? 'use-case' : entityType as Parameters<typeof openDrawer>[0], id);
            closeQuickAdd();
          }}
          onCreateAnyway={async () => {
            setDuplicateCandidates(null);
            setIsSubmitting(true);
            try {
              await executeCreate({ ...pendingPayload, allow_duplicates: true });
            } catch (err) {
              toast({ title: `Failed to create ${typeLabels[type]}`, description: err instanceof Error ? err.message : 'Please try again.', variant: 'destructive' });
            } finally {
              setIsSubmitting(false);
              setPendingPayload(null);
            }
          }}
          onCancel={() => { setDuplicateCandidates(null); setPendingPayload(null); }}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {onBack && (
        <button onClick={onBack} className="mb-5 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          {backLabel ? <><Bot className="w-3 h-3 text-violet-500" /> {backLabel}</> : <><ChevronLeft className="w-3.5 h-3.5" /> Back</>}
        </button>
      )}
      {notice && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-400" />
          <span>{notice}</span>
        </div>
      )}
      <div className="space-y-4">
        {config.filter(isFieldVisible).map(f => (
          <div key={f.key} className="space-y-1.5">
            <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
              {f.label}{f.required && <span className="text-destructive ml-0.5">*</span>}
            </label>

            {f.fieldType === 'select' ? (
              <select
                value={fields[f.key] || ''}
                onChange={(e) => set(f.key, e.target.value)}
                className={`${inputClass} pr-3`}
              >
                <option value="">Select {f.label.toLowerCase()}…</option>
                {f.options?.map(o => (
                  <option key={o} value={o}>{o.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
                ))}
              </select>
            ) : f.fieldType === 'account-select' ? (
              <EntityCombobox
                entityType="account"
                value={fields[f.key] || ''}
                onChange={(v) => set(f.key, v)}
                placeholder="Select account…"
              />
            ) : f.fieldType === 'contact-select' ? (
              <EntityCombobox
                entityType="contact"
                value={fields[f.key] || ''}
                onChange={(v) => set(f.key, v)}
                placeholder="Select contact…"
              />
            ) : f.fieldType === 'opportunity-select' ? (
              <EntityCombobox
                entityType="opportunity"
                value={fields[f.key] || ''}
                onChange={(v) => set(f.key, v)}
                placeholder="Select opportunity…"
              />
            ) : f.fieldType === 'subject-type-select' ? (
              <select
                value={fields[f.key] || ''}
                onChange={(e) => { set(f.key, e.target.value); set('subject_id', ''); }}
                className={`${inputClass} pr-3`}
              >
                {SUBJECT_TYPE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            ) : f.fieldType === 'entity-select' ? (
              <EntitySelect
                subjectType={fields.subject_type || ''}
                value={fields[f.key] || ''}
                onChange={(v) => set(f.key, v)}
              />
            ) : f.fieldType === 'actor-select' ? (
              <ActorSelect
                value={fields[f.key] || ''}
                onChange={(v) => set(f.key, v)}
              />
            ) : f.fieldType === 'datalist' ? (
              <>
                <input
                  type="text"
                  value={fields[f.key] || ''}
                  onChange={(e) => set(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  list={f.datalistId}
                  className={`${inputClass} pr-3`}
                />
                {f.datalistId && f.suggestions && (
                  <datalist id={f.datalistId}>
                    {f.suggestions.map(s => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                )}
              </>
            ) : f.fieldType === 'textarea' ? (
              <textarea
                value={fields[f.key] || ''}
                onChange={(e) => set(f.key, e.target.value)}
                placeholder={f.placeholder}
                rows={3}
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring resize-none"
              />
            ) : f.inputType === 'date' ? (
              <DatePicker
                value={fields[f.key] || ''}
                onChange={(v) => set(f.key, v)}
                required={f.required}
              />
            ) : f.inputType === 'datetime-local' ? (
              <DateTimePicker
                value={fields[f.key] || ''}
                onChange={(v) => set(f.key, v)}
                required={f.required}
              />
            ) : (
              <div className="relative">
                <input
                  type={f.inputType ?? 'text'}
                  value={fields[f.key] || ''}
                  onChange={(e) => set(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  className={`${inputClass} pr-8`}
                />
                <Pencil className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40 pointer-events-none" />
              </div>
            )}
          </div>
        ))}
        <button
          onClick={handleSubmit}
          disabled={!isValid() || isSubmitting}
          className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors mt-2"
        >
          {isSubmitting ? 'Creating...' : `Create ${typeLabels[type]}`}
        </button>
      </div>
    </div>
  );
}

export function QuickAddDrawer() {
  const { quickAddType, quickAddContext, closeQuickAdd } = useAppStore();
  const { enabled: agentEnabled, config, connectivity, loading } = useAgentSettings();

  if (!quickAddType) return null;
  const agentConfigured = agentEnabled && Boolean(config?.model && config?.base_url);
  const checkingAgent = !loading && agentConfigured && connectivity === 'unknown';
  const agentReady = agentConfigured && connectivity === 'online';
  const agentCreatable = quickAddType !== 'assignment';
  const agentCanDraftRecord = agentCreatable && agentCanUseLiteRecordFlow(quickAddType, config);
  const writeDisabledNotice = agentReady && agentCreatable && !agentCanDraftRecord
    ? liteAgentDisabledNotice(quickAddType)
    : undefined;

  return (
    <>
      <div className="fixed inset-0 bg-background/60 backdrop-blur-sm z-[80]" onClick={closeQuickAdd} />
      <div className="fixed right-0 top-0 h-full w-full max-w-2xl bg-background border-l border-border z-[90] shadow-2xl flex flex-col animate-slide-in-right">
        {loading || checkingAgent ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <Bot className="h-5 w-5 animate-pulse text-violet-400" />
            <p className="text-sm text-muted-foreground">Checking Workspace Agent settings…</p>
          </div>
        ) : agentReady && agentCanDraftRecord
          ? <LightweightRecordAgentPanel type={quickAddType} context={quickAddContext} onClose={closeQuickAdd} />
          : <ManualForm type={quickAddType} onClose={closeQuickAdd} notice={writeDisabledNotice} />
        }
      </div>
    </>
  );
}
