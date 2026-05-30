// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, getUser } from './client';

// Generic list hook with pagination
function useList<T>(
  key: string,
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
  options?: { enabled?: boolean },
) {
  const query = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '') query.set(k, String(v));
    });
  }
  const url = query.toString() ? `${path}?${query}` : path;
  return useQuery<{ data: T[]; next_cursor?: string; total: number }>({
    queryKey: [key, params],
    queryFn: () => api.get(url),
    enabled: options?.enabled ?? true,
  });
}

// Contacts
export function useContacts(params?: { q?: string; limit?: number; cursor?: string }) {
  return useList('contacts', 'contacts', params);
}
export function useContact(id: string) {
  return useQuery({ queryKey: ['contact', id], queryFn: () => api.get(`contacts/${id}`), enabled: !!id });
}
export function useCreateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('contacts', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts'] }),
  });
}
export function useUpdateContact(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.patch(`contacts/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contact', id] });
      qc.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
}
export function useDeleteContact(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(`contacts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts'] }),
  });
}

// Accounts
export function useAccounts(params?: { q?: string; limit?: number; cursor?: string }) {
  return useList('accounts', 'accounts', params);
}
export function useAccount(id: string) {
  return useQuery({ queryKey: ['account', id], queryFn: () => api.get(`accounts/${id}`), enabled: !!id });
}
export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('accounts', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  });
}
export function useUpdateAccount(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.patch(`accounts/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['account', id] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
}
export function useDeleteAccount(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(`accounts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  });
}

// Opportunities
export function useOpportunities(params?: {
  q?: string;
  stage?: string;
  forecast_cat?: string;
  close_date_before?: string;
  close_date_after?: string;
  limit?: number;
  cursor?: string;
}) {
  return useList('opportunities', 'opportunities', params);
}
export function useOpportunity(id: string) {
  return useQuery({ queryKey: ['opportunity', id], queryFn: () => api.get(`opportunities/${id}`), enabled: !!id });
}
export function useCreateOpportunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('opportunities', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['opportunities'] }),
  });
}
export function useUpdateOpportunity(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.patch(`opportunities/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['opportunity', id] });
      qc.invalidateQueries({ queryKey: ['opportunities'] });
    },
  });
}
export function useDeleteOpportunity(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(`opportunities/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['opportunities'] }),
  });
}

// Use Cases
export function useUseCases(params?: { account_id?: string; stage?: string; q?: string; limit?: number; cursor?: string }) {
  return useList('use-cases', 'use-cases', params);
}
export function useUseCase(id: string) {
  return useQuery({ queryKey: ['use-case', id], queryFn: () => api.get(`use-cases/${id}`), enabled: !!id });
}
export function useCreateUseCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('use-cases', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['use-cases'] }),
  });
}
export function useUpdateUseCase(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.patch(`use-cases/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['use-case', id] });
      qc.invalidateQueries({ queryKey: ['use-cases'] });
    },
  });
}
export function useDeleteUseCase(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(`use-cases/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['use-cases'] }),
  });
}
export function useAdvanceUseCaseStage(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { stage: string; note?: string }) =>
      api.patch(`use-cases/${id}`, { stage: data.stage, note: data.note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['use-case', id] });
      qc.invalidateQueries({ queryKey: ['use-cases'] });
    },
  });
}
export function useSetConsumption(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post(`use-cases/${id}/consumption`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['use-case', id] }),
  });
}
export function useSetHealth(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { score: number; rationale?: string }) => api.post(`use-cases/${id}/health`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['use-case', id] }),
  });
}
export function useUseCaseContacts(id: string) {
  return useQuery({
    queryKey: ['use-case-contacts', id],
    queryFn: () => api.get<{ data: Array<{ contact_id: string; role?: string; contact?: Record<string, unknown> }> }>(`use-cases/${id}/contacts`),
    enabled: !!id,
  });
}
export function useAddUseCaseContact(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { contact_id: string; role?: string }) => api.post(`use-cases/${id}/contacts`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['use-case-contacts', id] }),
  });
}
export function useRemoveUseCaseContact(useCaseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (contactId: string) => api.delete(`use-cases/${useCaseId}/contacts/${contactId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['use-case-contacts', useCaseId] }),
  });
}
export function useUseCaseTimeline(id: string) {
  return useQuery({
    queryKey: ['use-case-timeline', id],
    queryFn: () => api.get(`use-cases/${id}/timeline`),
    enabled: !!id,
  });
}

// Activities
export function useActivities(params?: {
  contact_id?: string;
  account_id?: string;
  type?: string;
  subject_type?: string;
  subject_id?: string;
  performed_by?: string;
  outcome?: string;
  limit?: number;
}) {
  return useList('activities', 'activities', params);
}
export function useActivity(id: string | null) {
  return useQuery<{ data: Record<string, unknown> }>({
    queryKey: ['activity', id],
    queryFn: () => api.get(`activities/${id}`),
    enabled: !!id,
  });
}
export function useCreateActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('activities', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['activities'] }),
  });
}
export function useExtractActivityDraft() {
  return useMutation<{ data: Record<string, unknown>; source: 'agent'; resolution_summary?: string[]; unresolved_references?: string[] }, Error, { text: string }>({
    mutationFn: (payload) => api.post('agent/extract/activity', payload),
  });
}
export function useExtractRecordDraft() {
  return useMutation<{
    data: Record<string, unknown>;
    draft?: Record<string, unknown>;
    patch?: Record<string, unknown>;
    operation?: 'create' | 'edit';
    current_record?: Record<string, unknown> | null;
    source: 'agent';
    field_rows?: Array<{
      field: string;
      label: string;
      value: unknown;
      current_value?: unknown;
      draft_value?: unknown;
      changed?: boolean;
      source: 'user' | 'model_knowledge' | 'matched_record' | 'provider' | 'required';
      source_label: string;
      confidence_label?: string;
      requires_confirmation?: boolean;
      status: 'ready' | 'missing' | 'linked' | 'optional';
      required: boolean;
    }>;
    enrichment_suggestions?: Array<{
      field: string;
      label: string;
      value: unknown;
      source: 'model_knowledge' | 'provider';
      source_label: string;
      confidence_label: string;
      requires_confirmation: boolean;
    }>;
    required_fields?: string[];
    missing_fields?: string[];
    linked_records?: Array<{ type: 'account' | 'contact' | 'opportunity' | 'use_case'; id: string; name: string; detail?: string | null }>;
    duplicate_candidates?: Array<{ id: string; name: string; score: number; reasons: string[] }>;
    resolution_summary?: string[];
    unresolved_references?: string[];
    work_log?: string[];
    can_create?: boolean;
    can_write?: boolean;
    policy_blockers?: string[];
  }, Error, { text: string; mode?: 'create' | 'edit'; object_type: string; record_type?: string; record_id?: string; parent_subject_type?: string; parent_subject_id?: string; parent_subject_name?: string; defaults?: Record<string, unknown> }>({
    mutationFn: (payload) => api.post('agent/extract/record', payload),
  });
}

// Calendar meetings and customer activity
export function useCalendarConnections() {
  return useQuery({
    queryKey: ['calendar-connections'],
    queryFn: () => api.get('calendar/connections'),
  });
}

export function useStartCalendarConnection(provider: 'google' | 'microsoft') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data?: Record<string, unknown>) => api.post(`calendar/connections/${provider}/start`, data ?? {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['calendar-connections'] }),
  });
}

export function useSyncCalendarConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`calendar/connections/${id}/sync`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar-connections'] });
      qc.invalidateQueries({ queryKey: ['calendar-events'] });
    },
  });
}

export function useDeleteCalendarConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`calendar/connections/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['calendar-connections'] }),
  });
}

export function useCalendarEvents(params?: {
  tab?: 'meetings' | 'needs_context' | 'all';
  q?: string;
  classification?: string;
  validation_status?: string;
  processing_status?: string;
  contact_id?: string;
  account_id?: string;
  opportunity_id?: string;
  use_case_id?: string;
  include_internal?: boolean;
  limit?: number;
  cursor?: string;
}) {
  return useList('calendar-events', 'calendar-events', params as Record<string, string | number | boolean | undefined>);
}

export function useCalendarEvent(id: string | null) {
  return useQuery({
    queryKey: ['calendar-event', id],
    queryFn: () => api.get(`calendar-events/${id}`),
    enabled: !!id,
  });
}

export function useUpdateCalendarEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Record<string, unknown>) => api.patch(`calendar-events/${id}`, data),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['calendar-event', variables.id] });
      qc.invalidateQueries({ queryKey: ['calendar-events'] });
    },
  });
}

export function useProcessCalendarEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`calendar-events/${id}/process`, {}),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['calendar-event', id] });
      qc.invalidateQueries({ queryKey: ['calendar-events'] });
      qc.invalidateQueries({ queryKey: ['activities'] });
      qc.invalidateQueries({ queryKey: ['context'] });
    },
  });
}

export function useAddMeetingArtifact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; artifact_type?: string; text_content?: string; source_label?: string; process?: boolean }) =>
      api.post(`calendar-events/${id}/artifacts`, data),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['calendar-event', variables.id] });
      qc.invalidateQueries({ queryKey: ['calendar-events'] });
      qc.invalidateQueries({ queryKey: ['activities'] });
      qc.invalidateQueries({ queryKey: ['context'] });
    },
  });
}

export function useIgnoreCalendarEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => api.post(`calendar-events/${id}/ignore`, { reason }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['calendar-event', variables.id] });
      qc.invalidateQueries({ queryKey: ['calendar-events'] });
    },
  });
}

export function useAddActivityContext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; text: string; artifact_type?: string; source_label?: string }) =>
      api.post(`activities/${id}/context`, data),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['activity', variables.id] });
      qc.invalidateQueries({ queryKey: ['activities'] });
      qc.invalidateQueries({ queryKey: ['raw-context-sources'] });
      qc.invalidateQueries({ queryKey: ['signal-groups'] });
      qc.invalidateQueries({ queryKey: ['context-entries'] });
    },
  });
}

export function useMeetingClassifications(params?: { include_disabled?: boolean }) {
  return useList('meeting-classifications', 'meeting-classifications', params as Record<string, string | number | boolean | undefined>);
}

export function useCreateMeetingClassification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('meeting-classifications', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meeting-classifications'] }),
  });
}

export function useUpdateMeetingClassification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type_name, ...data }: { type_name: string } & Record<string, unknown>) =>
      api.patch(`meeting-classifications/${type_name}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meeting-classifications'] }),
  });
}

export function useDeleteMeetingClassification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (typeName: string) => api.delete(`meeting-classifications/${typeName}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meeting-classifications'] }),
  });
}

// Analytics
export function usePipelineSummary(params?: { owner_id?: string }) {
  return useQuery({
    queryKey: ['analytics-pipeline', params],
    queryFn: () => api.get(`analytics/pipeline${params?.owner_id ? `?owner_id=${params.owner_id}` : ''}`),
  });
}
export function usePipelineForecast() {
  return useQuery({
    queryKey: ['analytics-forecast'],
    queryFn: () => api.get('analytics/forecast'),
  });
}
export function useUseCaseAnalytics(params?: { account_id?: string; group_by?: string }) {
  const query = new URLSearchParams();
  if (params?.account_id) query.set('account_id', params.account_id);
  if (params?.group_by) query.set('group_by', params.group_by);
  const url = query.toString() ? `analytics/use-cases?${query}` : 'analytics/use-cases';
  return useQuery({ queryKey: ['analytics-use-cases', params], queryFn: () => api.get(url) });
}

// HITL
export function useHITLRequests(params?: { status?: 'pending' | 'approved' | 'rejected' | 'expired' | 'auto_approved' | 'all'; limit?: number; refetchInterval?: number | false }) {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.limit) query.set('limit', String(params.limit));
  const url = query.toString() ? `hitl?${query}` : 'hitl';
  return useQuery({
    queryKey: ['hitl', params?.status ?? 'pending', params?.limit ?? 20],
    queryFn: () => api.get(url),
    refetchInterval: params?.refetchInterval ?? false,
    refetchOnWindowFocus: false,
  });
}
export function useHandoffSnapshot(snapshotId: string | null | undefined) {
  return useQuery({
    queryKey: ['handoff-snapshot', snapshotId],
    queryFn: () => api.get(`handoff-snapshots/${snapshotId}`),
    enabled: !!snapshotId,
  });
}

export function useResolveHITL() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, decision, note }: { id: string; status?: string; decision?: 'approved' | 'rejected'; note?: string }) =>
      api.post(`hitl/${id}/resolve`, { decision: decision ?? status, note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hitl'] }),
  });
}
export function useUpdateHITL() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: {
      id: string;
      action_summary?: string;
      priority?: 'low' | 'normal' | 'high' | 'urgent';
      sla_minutes?: number | null;
      escalate_to_id?: string | null;
    }) => api.patch(`hitl/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hitl'] }),
  });
}

// HITL Approval Rules
export function useHITLApprovalRules() {
  return useQuery({ queryKey: ['hitl-rules'], queryFn: () => api.get('hitl/rules') });
}
export function useCreateHITLRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('hitl/rules', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hitl-rules'] }),
  });
}
export function useUpdateHITLRule(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.patch(`hitl/rules/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hitl-rules'] }),
  });
}
export function useDeleteHITLRule(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(`hitl/rules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hitl-rules'] }),
  });
}

// Scoring
export function useRescoreContact(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post(`contacts/${id}/score`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contact', id] });
      qc.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
}
export function useRescoreOpportunity(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post(`opportunities/${id}/health-score`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['opportunity', id] });
      qc.invalidateQueries({ queryKey: ['opportunities'] });
    },
  });
}

// Specialist registry
export function useAgentSpecializations(actorId: string) {
  return useQuery({
    queryKey: ['specializations', actorId],
    queryFn: () => api.get(`actors/${actorId}/specializations`),
    enabled: !!actorId,
  });
}
export function useUpsertSpecialization(actorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post(`actors/${actorId}/specializations`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['specializations', actorId] }),
  });
}
export function useDeleteSpecialization(actorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (skillTag: string) => api.delete(`actors/${actorId}/specializations/${encodeURIComponent(skillTag)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['specializations', actorId] }),
  });
}
export function useSetActorAvailability(actorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: string) => api.patch(`actors/${actorId}`, { availability_status: status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['actor', actorId] });
      qc.invalidateQueries({ queryKey: ['actors'] });
    },
  });
}

// Memory consolidation
export function useConsolidateContext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      subject_type: string;
      subject_id: string;
      context_type: string;
      entry_ids?: string[];
    }) => api.post('context/consolidate', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['context-entries'] });
      qc.invalidateQueries({ queryKey: ['context-entries-infinite'] });
    },
  });
}

// Webhooks
export function useWebhooks() {
  return useList('webhooks', 'webhooks');
}
export function useCreateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('webhooks', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks'] }),
  });
}
export function useUpdateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => api.patch(`webhooks/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks'] }),
  });
}
export function useDeleteWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`webhooks/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks'] }),
  });
}

// Custom Fields
export function useCustomFields(objectType: string) {
  return useQuery({
    queryKey: ['custom-fields', objectType],
    queryFn: () => api.get(`custom-fields?object_type=${objectType}`),
    enabled: !!objectType,
  });
}
export function useCreateCustomField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('custom-fields', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custom-fields'] }),
  });
}
export function useUpdateCustomField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Record<string, unknown>) =>
      api.patch(`custom-fields/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custom-fields'] }),
  });
}
export function useDeleteCustomField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`custom-fields/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custom-fields'] }),
  });
}

// Search
export function useSearch(q: string) {
  return useQuery({
    queryKey: ['search', q],
    queryFn: () => api.get(`search?q=${encodeURIComponent(q)}`),
    enabled: q.length >= 2,
  });
}

// Emails
export function useEmails(params?: { contact_id?: string; status?: string; limit?: number }) {
  return useList('emails', 'emails', params);
}
export function useEmail(id: string) {
  return useQuery({ queryKey: ['email', id], queryFn: () => api.get(`emails/${id}`), enabled: !!id });
}
export function useCreateEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('emails', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['emails'] });
      qc.invalidateQueries({ queryKey: ['email-messages'] });
    },
  });
}

export function usePreviewEmailDraft() {
  return useMutation<{
    subject: string;
    body_text: string;
    context_used?: Record<string, unknown>;
    warnings?: string[];
    model_metadata?: Record<string, unknown>;
  }, Error, Record<string, unknown>>({
    mutationFn: (data) => api.post('emails/draft-preview', data),
  });
}

export function useSaveEmailDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('emails/drafts', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['emails'] });
      qc.invalidateQueries({ queryKey: ['email-messages'] });
    },
  });
}

export function useSourceFilters() {
  return useQuery({
    queryKey: ['source-filters'],
    queryFn: () => api.get('source-filters'),
  });
}

export function useUpdateSourceFilters() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.put('source-filters', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['source-filters'] }),
  });
}

export function useMailboxConnections() {
  return useQuery({
    queryKey: ['mailbox-connections'],
    queryFn: () => api.get('mailbox/connections'),
  });
}

export function useStartMailboxConnection(provider: 'google' | 'microsoft') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data?: Record<string, unknown>) => api.post(`mailbox/connections/${provider}/start`, data ?? {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mailbox-connections'] }),
  });
}

export function useSyncMailboxConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`mailbox/connections/${id}/sync`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mailbox-connections'] }),
  });
}

export function useDeleteMailboxConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`mailbox/connections/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mailbox-connections'] }),
  });
}

export function useEmailMessages(params?: {
  view?: 'customer' | 'review' | 'all';
  q?: string;
  direction?: 'inbound' | 'outbound';
  classification?: string;
  processing_status?: string;
  include_internal?: boolean;
  limit?: number;
  cursor?: string;
}) {
  return useList('email-messages', 'email-messages', params as Record<string, string | number | boolean | undefined>);
}

export function useEmailMessage(id: string | null) {
  return useQuery({
    queryKey: ['email-message', id],
    queryFn: () => api.get(`email-messages/${id}`),
    enabled: !!id,
  });
}

export function useUpdateEmailMessageClassification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, classification }: { id: string; classification: string }) =>
      api.patch(`email-messages/${id}/classification`, { classification }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['email-message', variables.id] });
      qc.invalidateQueries({ queryKey: ['email-messages'] });
    },
  });
}

export function useUpdateEmailMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Record<string, unknown>) =>
      api.patch(`email-messages/${id}`, data),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['email-message', variables.id] });
      qc.invalidateQueries({ queryKey: ['email-messages'] });
      qc.invalidateQueries({ queryKey: ['raw-context-sources'] });
      qc.invalidateQueries({ queryKey: ['signal-groups'] });
      qc.invalidateQueries({ queryKey: ['context-entries'] });
    },
  });
}

export function useProcessEmailMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`email-messages/${id}/process`, {}),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['email-message', id] });
      qc.invalidateQueries({ queryKey: ['email-messages'] });
    },
  });
}

export function useIgnoreEmailMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => api.post(`email-messages/${id}/ignore`, { reason }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['email-message', variables.id] });
      qc.invalidateQueries({ queryKey: ['email-messages'] });
    },
  });
}

export function useEnrollInSequence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { sequence_id: string; contact_id: string; variables?: Record<string, unknown>; start_at_step?: number }) =>
      api.post(`sequences/${data.sequence_id}/enroll`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sequence-enrollments'] }),
  });
}
export function useUnenrollFromSequence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`sequences/unenroll`, { id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sequence-enrollments'] }),
  });
}
export function useSequenceEnrollments(params?: { sequence_id?: string; contact_id?: string; status?: string; limit?: number }) {
  return useList('sequence-enrollments', 'sequences/enrollments', params as Record<string, string | number | boolean | undefined>);
}

// Sequences (new canonical hooks)
export function useSequences(params?: { is_active?: boolean; tags?: string[]; limit?: number }, options?: { enabled?: boolean }) {
  return useList('sequences', 'sequences', params as Record<string, string | number | boolean | undefined>, options);
}
export function useSequence(id: string) {
  return useQuery({ queryKey: ['sequence', id], queryFn: () => api.get(`sequences/${id}`), enabled: !!id });
}
export function useCreateSequence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('sequences', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sequences'] }),
  });
}
export function useUpdateSequence(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patch(`sequences/${id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sequences'] });
      qc.invalidateQueries({ queryKey: ['sequence', id] });
    },
  });
}
export function useDeleteSequence(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(`sequences/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sequences'] }),
  });
}
export function useSequenceAnalytics(id: string, periodType: 'day' | 'week' | 'month' = 'day') {
  return useQuery({
    queryKey: ['sequence-analytics', id, periodType],
    queryFn: () => api.get(`sequences/${id}/analytics?period_type=${periodType}`),
    enabled: !!id,
  });
}
export function useEnrollmentActivities(enrollmentId: string) {
  return useQuery({
    queryKey: ['enrollment-activities', enrollmentId],
    queryFn: () => api.get(`sequences/enrollments/${enrollmentId}/activities`),
    enabled: !!enrollmentId,
  });
}
export function useEnrollmentContext(enrollmentId: string) {
  return useQuery({
    queryKey: ['enrollment-context', enrollmentId],
    queryFn: () => api.get(`sequences/enrollments/${enrollmentId}/context`),
    enabled: !!enrollmentId,
  });
}
export function useEnrollInSequenceWithObjective() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { sequence_id: string; contact_id: string; objective?: string; variables?: Record<string, unknown> }) =>
      api.post(`sequences/enroll`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sequence-enrollments'] }),
  });
}

/** Generate a sample AI draft for an email step without saving or enrolling. */
export function useDraftSequencePreview() {
  return useMutation({
    mutationFn: (step: { subject?: string; body_text?: string; ai_prompt?: string; ai_persona?: string }) =>
      api.post<{ subject: string; body_text: string }>('sequences/draft-preview', step),
  });
}

// Inbound emails (activities with direction=inbound)
export function useInboundEmails(params?: { limit?: number; cursor?: string }) {
  return useList('inbound-emails', 'activities', {
    ...(params as Record<string, string | number | boolean | undefined>),
    type: 'email',
    direction: 'inbound',
  });
}

// Events / Audit log
export function useEvents(params?: { object_type?: string; object_id?: string; event_type?: string; actor_id?: string; limit?: number; cursor?: string }) {
  return useList('events', 'events', params as Record<string, string | number | boolean | undefined>);
}

// Admin: User Management
type AdminUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  manager_id?: string | null;
  is_active?: boolean;
  invited_at?: string | null;
  password_set_at?: string | null;
  last_login_at?: string | null;
  created_at: string;
  updated_at?: string;
};

export interface AdminActorRow {
  id: string;
  actor_type: 'human' | 'agent';
  display_name: string;
  email?: string | null;
  phone?: string | null;
  user_id?: string | null;
  role?: string | null;
  agent_identifier?: string | null;
  agent_model?: string | null;
  scopes: string[];
  metadata: Record<string, unknown>;
  is_active: boolean;
  availability_status?: 'available' | 'busy' | 'offline';
  registration_source?: 'admin' | 'self_registered' | 'migration';
  registration_status?: 'approved' | 'pending_review' | 'rejected';
  user_email?: string | null;
  user_name?: string | null;
  user_role?: string | null;
  user_is_active?: boolean | null;
  user_invited_at?: string | null;
  user_password_set_at?: string | null;
  user_last_login_at?: string | null;
  invite_pending?: boolean;
  api_key_count?: number;
  last_activity_at?: string | null;
  created_at: string;
  updated_at: string;
}

export function useAdminActors() {
  return useQuery({
    queryKey: ['admin-actors'],
    queryFn: () => api.get<{ data: AdminActorRow[] }>('admin/actors'),
  });
}

export function useUsers() {
  return useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.get<{ data: AdminUser[] }>('admin/users'),
  });
}
export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; email: string; phone?: string; password?: string; role: string; manager_id?: string | null; send_invite?: boolean; metadata?: Record<string, unknown> }) =>
      api.post<AdminUser & { invite?: { setup_url: string; email_sent: boolean; email_error?: string } | null }>('admin/users', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      qc.invalidateQueries({ queryKey: ['admin-actors'] });
      qc.invalidateQueries({ queryKey: ['actors'] });
    },
  });
}
export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string; email?: string; role?: string; manager_id?: string | null; password?: string; is_active?: boolean }) =>
      api.patch<AdminUser>(`admin/users/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      qc.invalidateQueries({ queryKey: ['admin-actors'] });
      qc.invalidateQueries({ queryKey: ['actors'] });
    },
  });
}
export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`admin/users/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      qc.invalidateQueries({ queryKey: ['admin-actors'] });
      qc.invalidateQueries({ queryKey: ['actors'] });
    },
  });
}

export function useInviteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ success: boolean; invite: { setup_url: string; email_sent: boolean; email_error?: string } }>(`admin/users/${id}/invite`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      qc.invalidateQueries({ queryKey: ['admin-actors'] });
    },
  });
}

export function useResetUserPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ success: boolean; reset: { setup_url: string; email_sent: boolean; email_error?: string } }>(`admin/users/${id}/password-reset`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      qc.invalidateQueries({ queryKey: ['admin-actors'] });
    },
  });
}

export function useApproveActor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; display_name?: string; agent_identifier?: string; agent_model?: string; scopes?: string[]; metadata?: Record<string, unknown>; is_active?: boolean }) =>
      api.post(`admin/actors/${id}/approve`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-actors'] });
      qc.invalidateQueries({ queryKey: ['actors'] });
    },
  });
}

export function useRejectActor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api.post(`admin/actors/${id}/reject`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-actors'] });
      qc.invalidateQueries({ queryKey: ['actors'] });
    },
  });
}

// Admin: Database Config
export function useDbConfig() {
  return useQuery({
    queryKey: ['admin-db-config'],
    queryFn: () => api.get<{
      host: string;
      port: string;
      database: string;
      user: string;
      ssl: string | null;
      pgvector_enabled?: boolean;
      pgvector_column_ready?: boolean;
      pgvector_env_enabled?: boolean;
      embedding_configured?: boolean;
      embedding_provider?: string | null;
      embedding_model?: string | null;
      ready?: boolean;
      sample_data?: {
        seeded: boolean;
        counts: {
          accounts: number;
          contacts: number;
          opportunities: number;
          context_entries: number;
          signals?: number;
          memory?: number;
          raw_context_sources?: number;
          handoffs?: number;
        };
      };
    }>('admin/db-config'),
  });
}
export function useTestDbConfig() {
  return useMutation({
    mutationFn: (connection_string: string) => api.post<{ success: boolean }>('admin/db-config/test', { connection_string }),
  });
}
export function useSaveDbConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (connection_string: string) =>
      api.patch<{ success: boolean; message: string }>('admin/db-config', { connection_string }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-db-config'] }),
  });
}
export function useSeedSampleData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (confirm: boolean) =>
      api.post<{ success: boolean; message: string; sample_data: unknown }>('admin/sample-data', { confirm }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-db-config'] });
      qc.invalidateQueries({ queryKey: ['contacts'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['opportunities'] });
      qc.invalidateQueries({ queryKey: ['use-cases'] });
      qc.invalidateQueries({ queryKey: ['activities'] });
      qc.invalidateQueries({ queryKey: ['context-entries'] });
      qc.invalidateQueries({ queryKey: ['signal-groups'] });
      qc.invalidateQueries({ queryKey: ['raw-context-sources'] });
      qc.invalidateQueries({ queryKey: ['hitl'] });
      qc.invalidateQueries({ queryKey: ['hitl-requests'] });
      qc.invalidateQueries({ queryKey: ['assignments'] });
    },
  });
}

// API Keys
export function useApiKeys(actorId?: string) {
  const params = actorId ? `?actor_id=${actorId}` : '';
  return useQuery({
    queryKey: ['api-keys', actorId],
    queryFn: () => api.get<{ data: Array<{ id: string; label: string; scopes: string[]; actor_id?: string; actor_name?: string; actor_type?: string; created_at: string; last_used_at?: string }> }>(`/auth/api-keys${params}`),
  });
}
export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { label: string; scopes: string[]; actor_id?: string }) =>
      api.post<{ id: string; key: string; label: string }>('/auth/api-keys', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys'] }),
  });
}
export function useUpdateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; label?: string; scopes?: string[]; actor_id?: string | null; expires_at?: string | null }) =>
      api.patch(`/auth/api-keys/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys'] }),
  });
}
export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/auth/api-keys/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys'] }),
  });
}

// Profile (self-service)
export function useUpdateProfile() {
  return useMutation({
    mutationFn: (data: { name?: string; email?: string; current_password?: string; new_password?: string }) =>
      api.patch<{ id: string; email: string; name: string; role: string }>('/auth/profile', data),
  });
}

// -- Context Engine hooks (v0.4) --

// Actors
export function useActors(params?: { actor_type?: string; q?: string; is_active?: boolean; limit?: number }) {
  return useList('actors', 'actors', params);
}
export function useActor(id: string) {
  return useQuery({ queryKey: ['actor', id], queryFn: () => api.get(`actors/${id}`), enabled: !!id });
}
export function useCreateActor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('actors', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['actors'] }),
  });
}
export function useUpdateActor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string; [key: string]: unknown }) =>
      api.patch(`actors/${id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['actors'] });
      qc.invalidateQueries({ queryKey: ['actor'] });
      qc.invalidateQueries({ queryKey: ['admin-actors'] });
    },
  });
}
export function useWhoAmI() {
  return useQuery({
    queryKey: ['actor-whoami'],
    queryFn: () => api.get('actors/whoami'),
  });
}

// Assignments
export function useAssignments(params?: {
  assigned_to?: string;
  assigned_by?: string;
  status?: string;
  priority?: string;
  subject_type?: string;
  subject_id?: string;
  limit?: number;
}) {
  return useList('assignments', 'assignments', params);
}
export function useAssignment(id: string) {
  return useQuery({ queryKey: ['assignment', id], queryFn: () => api.get(`assignments/${id}`), enabled: !!id });
}
export function useCreateAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('assignments', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assignments'] }),
  });
}
export function useUpdateAssignment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.patch(`assignments/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assignment', id] });
      qc.invalidateQueries({ queryKey: ['assignments'] });
    },
  });
}
export function useAcceptAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`assignments/${id}/accept`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assignments'] }),
  });
}
export function useCompleteAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; completed_by_activity_id?: string }) =>
      api.post(`assignments/${id}/complete`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assignments'] }),
  });
}
export function useDeclineAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; reason?: string }) =>
      api.post(`assignments/${id}/decline`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assignments'] }),
  });
}

// Context Entries
export function useContextEntries(params?: {
  subject_type?: string;
  subject_id?: string;
  context_type?: string;
  memory_status?: 'signal' | 'active' | 'rejected' | 'superseded';
  is_current?: boolean;
  limit?: number;
}) {
  return useList('context-entries', 'context', params);
}
export function useContextEntriesInfinite(params?: {
  subject_type?: string;
  subject_id?: string;
  context_type?: string;
  memory_status?: 'signal' | 'active' | 'rejected' | 'superseded';
  is_current?: boolean;
  limit?: number;
}) {
  const limit = params?.limit ?? 20;
  return useInfiniteQuery<{ data: any[]; next_cursor?: string; total: number }>({
    queryKey: ['context-entries-infinite', params],
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams();
      if (params?.subject_type) query.set('subject_type', params.subject_type);
      if (params?.subject_id) query.set('subject_id', params.subject_id);
      if (params?.context_type) query.set('context_type', params.context_type);
      if (params?.memory_status) query.set('memory_status', params.memory_status);
      if (params?.is_current !== undefined) query.set('is_current', String(params.is_current));
      query.set('limit', String(limit));
      if (pageParam) query.set('cursor', pageParam as string);
      return api.get(`context?${query}`);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });
}
export function useContextEntry(id: string) {
  return useQuery({ queryKey: ['context-entry', id], queryFn: () => api.get(`context/${id}`), enabled: !!id });
}
export interface SignalGroup {
  id: string;
  subject_type: string;
  subject_id: string;
  context_type: string;
  title?: string | null;
  normalized_claim: string;
  status: 'gathering' | 'ready' | 'promoted' | 'blocked' | 'dismissed' | 'conflicting' | 'merged';
  aggregate_confidence: number;
  support_count: number;
  independent_source_count: number;
  conflict_count: number;
  evidence_count: number;
  latest_signal_id?: string | null;
  promoted_context_entry_id?: string | null;
  blocked_reason?: string | null;
  metadata?: Record<string, unknown>;
  subject_name?: string | null;
  updated_at: string;
  created_at: string;
  members?: Array<Record<string, unknown>>;
}
export function useSignalGroups(params?: {
  status?: string;
  subject_type?: string;
  subject_id?: string;
  context_type?: string;
  attention_only?: boolean;
  limit?: number;
}) {
  return useList<SignalGroup>('signal-groups', 'context/signal-groups', params);
}
export function useSignalGroup(id: string | null) {
  return useQuery<{ signal_group: SignalGroup }>({
    queryKey: ['signal-group', id],
    queryFn: () => api.get(`context/signal-groups/${id}`),
    enabled: !!id,
  });
}
export function usePromoteSignalGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`context/signal-groups/${id}/promote`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['signal-groups'] });
      qc.invalidateQueries({ queryKey: ['context-entries'] });
      qc.invalidateQueries({ queryKey: ['context-entries-infinite'] });
    },
  });
}
export function useRejectSignalGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api.post(`context/signal-groups/${id}/reject`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['signal-groups'] });
      qc.invalidateQueries({ queryKey: ['context-entries'] });
      qc.invalidateQueries({ queryKey: ['context-entries-infinite'] });
    },
  });
}
export function useSendSignalGroupToHandoff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`context/signal-groups/${id}/handoff`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['signal-groups'] });
      qc.invalidateQueries({ queryKey: ['hitl'] });
      qc.invalidateQueries({ queryKey: ['inbox-count'] });
    },
  });
}

export interface ContextLineageNode {
  id: string;
  type: 'record' | 'raw_context' | 'activity' | 'signal' | 'signal_group' | 'memory' | 'handoff' | 'writeback' | 'audit';
  label: string;
  timestamp?: string | null;
  status?: string | null;
  subject_type?: string | null;
  subject_id?: string | null;
  object_id?: string | null;
  stage?: string | null;
  display_order?: number | null;
  description?: string | null;
  data?: Record<string, unknown>;
}
export interface ContextLineageEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
  data?: Record<string, unknown>;
}
export interface ContextLineage {
  nodes: ContextLineageNode[];
  edges: ContextLineageEdge[];
  summary: Record<string, number>;
}
export function useContextLineage(params?: {
  subject_type?: string;
  subject_id?: string;
  context_entry_id?: string;
  signal_group_id?: string;
  raw_context_source_id?: string;
}) {
  const query = new URLSearchParams();
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value) query.set(key, String(value));
  });
  return useQuery<{ lineage: ContextLineage }>({
    queryKey: ['context-lineage', params],
    queryFn: () => api.get(`context/lineage?${query}`),
  });
}
export interface RawContextSource {
  id: string;
  source_type: string;
  source_ref: string;
  source_label?: string | null;
  subject_type?: string | null;
  subject_id?: string | null;
  status: 'pending' | 'processing' | 'processed' | 'needs_review' | 'failed' | 'skipped';
  stage: string;
  raw_excerpt?: string | null;
  detected_subjects?: Array<Record<string, unknown>>;
  signals_created: number;
  memory_created: number;
  skipped: number;
  failure_reason?: string | null;
  metadata?: Record<string, unknown>;
  processed_at?: string | null;
  created_at: string;
  updated_at: string;
}
export function useRawContextSources(params?: {
  source_type?: string;
  status?: string;
  subject_type?: string;
  subject_id?: string;
  limit?: number;
}) {
  return useList<RawContextSource>('raw-context-sources', 'context/raw-sources', params);
}
export function useReprocessRawContextSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`context/raw-sources/${id}/reprocess`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['raw-context-sources'] });
      qc.invalidateQueries({ queryKey: ['context-entries'] });
      qc.invalidateQueries({ queryKey: ['context-entries-infinite'] });
    },
  });
}
export function useCreateContextEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('context', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['context-entries'] }),
  });
}
export function useSupersedeContextEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; body: string; title?: string; confidence?: number }) =>
      api.post(`context/${id}/supersede`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['context-entries'] }),
  });
}
export function usePromoteSignal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; body?: string; title?: string; confidence?: number; reason?: string }) =>
      api.post(`context/${id}/promote`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['context-entries'] });
      qc.invalidateQueries({ queryKey: ['context-entries-infinite'] });
    },
  });
}
export function useRejectSignal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api.post(`context/${id}/reject`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['context-entries'] });
      qc.invalidateQueries({ queryKey: ['context-entries-infinite'] });
    },
  });
}
export function useContextSearch(query: string, params?: { subject_type?: string; subject_id?: string; context_type?: string; tag?: string; current_only?: boolean; memory_status?: 'signal' | 'active' | 'rejected' | 'superseded'; limit?: number }) {
  const searchParams = new URLSearchParams();
  searchParams.set('q', query);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '') searchParams.set(k, String(v));
    });
  }
  return useQuery({
    queryKey: ['context-search', query, params],
    queryFn: () => api.get(`context/search?${searchParams}`),
    enabled: query.length >= 2,
  });
}
export function useReviewContextEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: string | { id: string; extend_days?: number }) => {
      const id = typeof input === 'string' ? input : input.id;
      const body = typeof input === 'string' ? {} : { extend_days: input.extend_days };
      return api.post(`context/${id}/review`, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['context-entries'] });
      qc.invalidateQueries({ queryKey: ['context-entries-infinite'] });
      qc.invalidateQueries({ queryKey: ['context-stale'] });
    },
  });
}
export function useStaleContextEntries(params?: { subject_type?: string; subject_id?: string; limit?: number }) {
  return useList('context-stale', 'context/stale', params);
}
export function useReviewContextBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { entry_ids: string[]; extend_days?: number }) => api.post('context/review-batch', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['context-entries'] });
      qc.invalidateQueries({ queryKey: ['context-entries-infinite'] });
      qc.invalidateQueries({ queryKey: ['context-stale'] });
      qc.invalidateQueries({ queryKey: ['briefing'] });
    },
  });
}
export function useBulkMarkContextStale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { entry_ids: string[]; reason?: string }) => api.post('context/mark-stale', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['context-entries'] });
      qc.invalidateQueries({ queryKey: ['context-entries-infinite'] });
      qc.invalidateQueries({ queryKey: ['context-stale'] });
      qc.invalidateQueries({ queryKey: ['briefing'] });
    },
  });
}
export function useContextContradictions(params?: { subject_type?: string; subject_id?: string; context_type?: string }) {
  const query = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '') query.set(k, String(v));
    });
  }
  const enabled = !!params?.subject_type && !!params?.subject_id;
  return useQuery({
    queryKey: ['context-contradictions', params],
    queryFn: () => api.get(`context/contradictions?${query}`),
    enabled,
  });
}
export function useAssignContextContradictions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { subject_type: string; subject_id: string; context_type?: string; limit?: number }) =>
      api.post('context/contradictions/assign', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assignments'] });
      qc.invalidateQueries({ queryKey: ['context-contradictions'] });
    },
  });
}
export function useResolveContextContradiction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { keep_entry_id: string; supersede_entry_id: string; resolution_note: string }) =>
      api.post('context/contradictions/resolve', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['context-entries'] });
      qc.invalidateQueries({ queryKey: ['context-entries-infinite'] });
      qc.invalidateQueries({ queryKey: ['context-contradictions'] });
      qc.invalidateQueries({ queryKey: ['briefing'] });
    },
  });
}

// Assignment actions (v0.5)
export function useStartAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`assignments/${id}/start`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assignments'] }),
  });
}
export function useBlockAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api.post(`assignments/${id}/block`, { reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assignments'] }),
  });
}
export function useCancelAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api.post(`assignments/${id}/cancel`, { reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assignments'] }),
  });
}

// Activity Type Registry
export function useActivityTypes(params?: { category?: string }) {
  return useList('activity-types', 'activity-types', params);
}
export function useCreateActivityType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { type_name: string; label: string; category: string; description?: string }) =>
      api.post('activity-types', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['activity-types'] }),
  });
}
export function useDeleteActivityType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (typeName: string) => api.delete(`activity-types/${typeName}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['activity-types'] }),
  });
}

// Context Type Registry
export function useContextTypes() {
  return useList('context-types', 'context-types');
}
export function useCreateContextType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { type_name: string; label: string; description?: string }) =>
      api.post('context-types', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['context-types'] }),
  });
}
export function useDeleteContextType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (typeName: string) => api.delete(`context-types/${typeName}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['context-types'] }),
  });
}

// Workflows
export function useWorkflows(params?: { q?: string; enabled?: boolean; limit?: number }, options?: { enabled?: boolean }) {
  return useList('workflows', 'workflows', params, options);
}
export function useWorkflow(id: string) {
  return useQuery({ queryKey: ['workflow', id], queryFn: () => api.get(`workflows/${id}`), enabled: !!id });
}
export function useCreateWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('workflows', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflows'] }),
  });
}
export function useUpdateWorkflow(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.patch(`workflows/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflow', id] });
      qc.invalidateQueries({ queryKey: ['workflows'] });
    },
  });
}
export function useUpdateWorkflowById() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { id: string; [key: string]: unknown }>({
    mutationFn: ({ id, ...data }) =>
      api.patch(`workflows/${id}`, data),
    onSuccess: (_result, variables) => {
      qc.invalidateQueries({ queryKey: ['workflow', variables.id] });
      qc.invalidateQueries({ queryKey: ['workflows'] });
    },
  });
}
export function useDeleteWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`workflows/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflows'] }),
  });
}
export function useWorkflowRuns(workflowId: string, params?: { limit?: number }) {
  return useQuery({
    queryKey: ['workflow-runs', workflowId, params],
    queryFn: () => {
      const qs = params?.limit ? `?limit=${params.limit}` : '';
      return api.get(`workflows/${workflowId}/runs${qs}`);
    },
    enabled: !!workflowId,
  });
}
export function useTestWorkflow() {
  return useMutation({
    mutationFn: ({ id, sample_payload }: { id: string; sample_payload: Record<string, unknown> }) =>
      api.post(`workflows/${id}/test`, { sample_payload }),
  });
}
export function useTestDraftWorkflow() {
  return useMutation({
    mutationFn: ({ workflow, sample_payload }: { workflow: Record<string, unknown>; sample_payload: Record<string, unknown> }) =>
      api.post('workflows/test-draft', { workflow, sample_payload }),
  });
}
export function useDraftWorkflowContentPreview() {
  return useMutation({
    mutationFn: (data: {
      action_type: 'send_email' | 'send_notification';
      config: Record<string, unknown>;
      sample_payload?: Record<string, unknown>;
    }) =>
      api.post<{ subject?: string; body_text?: string; message?: string }>('workflows/draft-content-preview', data),
  });
}
export function useCloneWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name?: string }) =>
      api.post(`workflows/${id}/clone`, name ? { name } : {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflows'] }),
  });
}

export function useManualTriggerWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      api.post(`workflows/${id}/trigger`, payload),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['workflow-runs', id] });
      qc.invalidateQueries({ queryKey: ['workflows'] });
    },
  });
}

// Webhook Deliveries
export function useWebhookDeliveries(webhookId: string, params?: { limit?: number }) {
  return useQuery({
    queryKey: ['webhook-deliveries', webhookId, params],
    queryFn: () => {
      const qs = params?.limit ? `?limit=${params.limit}` : '';
      return api.get(`webhooks/${webhookId}/deliveries${qs}`);
    },
    enabled: !!webhookId,
  });
}

// Semantic Search
export function useSemanticSearch(query: string, params?: { subject_type?: string; subject_id?: string; context_type?: string; tag?: string; current_only?: boolean; memory_status?: 'signal' | 'active' | 'rejected' | 'superseded'; limit?: number }) {
  const searchParams = new URLSearchParams();
  searchParams.set('q', query);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '') searchParams.set(k, String(v));
    });
  }
  return useQuery({
    queryKey: ['context-semantic-search', query, params],
    queryFn: () => api.get(`context/semantic-search?${searchParams}`),
    enabled: query.length >= 2,
    retry: false,
  });
}

// Context Ingest
export function useContextIngest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { text: string; subject_type: string; subject_id: string; source?: string }) =>
      api.post('context/ingest', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['context-entries'] });
      qc.invalidateQueries({ queryKey: ['context-entries-infinite'] });
      qc.invalidateQueries({ queryKey: ['raw-context-sources'] });
    },
  });
}

export function useContextIngestAuto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      text: string;
      source?: string;
      confidence_threshold?: number;
      subjects?: Array<{ type: string; id: string; name?: string }>;
      proposed_records?: Array<{
        record_type: string;
        name: string;
        confidence?: number;
        reason?: string;
        fields?: Record<string, unknown>;
        duplicate_candidates?: unknown[];
      }>;
    }) =>
      api.post('context/ingest-auto', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['context-entries'] });
      qc.invalidateQueries({ queryKey: ['context-entries-infinite'] });
      qc.invalidateQueries({ queryKey: ['raw-context-sources'] });
    },
  });
}

// Auto-detect subjects mentioned in free text with the Workspace Agent, then entity-resolve them.
export function useDetectSubjects() {
  return useMutation({
    mutationFn: (text: string) => api.post('context/detect-subjects', { text }),
  });
}

// Ingest a file: send base64-encoded content, get back detected subjects + text preview
export function useIngestFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { filename: string; data: string; source_label?: string }) =>
      api.post('context/ingest-file', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['context-entries'] });
      qc.invalidateQueries({ queryKey: ['context-entries-infinite'] });
      qc.invalidateQueries({ queryKey: ['raw-context-sources'] });
    },
  });
}

// Inbox counts (HITL pending + my active assignments) — used by nav badge
export function useInboxCounts() {
  const { data: whoami } = useWhoAmI() as any;
  const myActorId: string | undefined = whoami?.actor_id;
  const hitlQ = useHITLRequests({ status: 'pending', limit: 200 });
  const assignQ = useQuery<{ data: any[]; total: number }>({
    queryKey: ['inbox-assignments', myActorId],
    queryFn: () => api.get(`assignments?assigned_to=${encodeURIComponent(myActorId!)}&limit=200`),
    enabled: !!myActorId,
    refetchInterval: 30_000,
  });
  const hitlCount = ((hitlQ.data as any)?.data ?? []).filter((r: any) => r.status === 'pending').length;
  const assignCount = ((assignQ.data as any)?.assignments ?? []).filter((a: any) =>
    ['pending', 'accepted', 'in_progress', 'blocked'].includes(a.status)
  ).length;
  return { total: hitlCount + assignCount, hitlCount, assignCount };
}

// Briefing
export function useBriefing(subjectType: string, subjectId: string, params?: {
  format?: string;
  since?: string;
  context_types?: string;
  include_stale?: boolean;
  context_radius?: 'direct' | 'adjacent' | 'account_wide';
  token_budget?: number;
}) {
  const searchParams = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && String(v) !== '') searchParams.set(k, String(v));
    });
  }
  const qs = searchParams.toString();
  const url = `briefing/${subjectType}/${subjectId}${qs ? `?${qs}` : ''}`;
  return useQuery({
    queryKey: ['briefing', subjectType, subjectId, params],
    queryFn: () => api.get(url),
    enabled: !!subjectType && !!subjectId,
  });
}

export function useBriefingSummary(subjectType: string, subjectId: string) {
  return useMutation({
    mutationFn: () => api.post<{ summary: string | null }>(`briefing/${subjectType}/${subjectId}/summary`, {}),
  });
}

// Operations
export function useOpsStatus(params?: { sample_limit?: number; include_samples?: boolean }) {
  const searchParams = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && String(v) !== '') searchParams.set(k, String(v));
    });
  }
  const qs = searchParams.toString();
  return useQuery({
    queryKey: ['ops-status', params],
    queryFn: () => api.get(`ops/status${qs ? `?${qs}` : ''}`),
    refetchInterval: 30_000,
  });
}

export function useOpsDataQuality(params?: { sample_limit?: number; include_clean?: boolean }) {
  const searchParams = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && String(v) !== '') searchParams.set(k, String(v));
    });
  }
  const qs = searchParams.toString();
  return useQuery({
    queryKey: ['ops-data-quality', params],
    queryFn: () => api.get(`ops/data-quality${qs ? `?${qs}` : ''}`),
  });
}

// ── Agent ──

export interface AgentConfigData {
  id: string;
  tenant_id: string;
  enabled: boolean;
  provider: 'anthropic' | 'openai' | 'openrouter' | 'ollama' | 'custom';
  base_url: string;
  api_key_configured: boolean;
  api_key_hint: string | null;
  model: string;
  system_prompt: string | null;
  max_tokens_per_turn: number;
  history_retention_days: number;
  can_write_objects: boolean;
  can_log_activities: boolean;
  can_create_assignments: boolean;
  auto_extract_context: boolean;
  auto_promote_signals: boolean;
  signal_auto_promote_threshold: number;
}

export interface AgentSessionSummary {
  id: string;
  label: string | null;
  context_type: string | null;
  context_id: string | null;
  context_name: string | null;
  token_count: number;
  created_at: string;
  updated_at: string;
  active_turn?: {
    id: string;
    status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
    input_message: string;
    created_at: string;
    updated_at: string;
  } | null;
}

export interface AgentSessionFull extends AgentSessionSummary {
  messages: { role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string }[];
  attachments?: Array<{
    id: string;
    filename: string;
    format?: string | null;
    mode: 'active_context' | 'raw_context';
    status: 'ready' | 'processing' | 'processed' | 'failed' | 'consumed';
    text_excerpt?: string | null;
    truncated?: boolean;
    raw_context_source_id?: string | null;
    error_message?: string | null;
    created_at: string;
  }>;
}

export function useAgentConfig() {
  const user = getUser();
  return useQuery<{ data: AgentConfigData | null }>({
    queryKey: ['agent-config', user?.tenant_id ?? 'anonymous', user?.id ?? 'anonymous'],
    queryFn: () => api.get('agent/config'),
    enabled: Boolean(user?.tenant_id && user?.id),
  });
}

export function useSaveAgentConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.put('agent/config', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-config'] }),
  });
}

export function useTestAgentConnection() {
  return useMutation<
    { ok: boolean; status?: string; error?: string; warning?: string; tool_calling_verified?: boolean },
    Error,
    Record<string, string>
  >({
    mutationFn: (payload) => api.post('agent/config/test', payload),
  });
}

export function useAgentSessions() {
  return useQuery<{ data: AgentSessionSummary[] }>({
    queryKey: ['agent-sessions'],
    queryFn: () => api.get('agent/sessions'),
  });
}

export function useAgentSession(id: string | null) {
  return useQuery<{ data: AgentSessionFull }>({
    queryKey: ['agent-session', id],
    queryFn: () => api.get(`agent/sessions/${id}`),
    enabled: !!id,
  });
}

export function useCreateAgentSession() {
  const qc = useQueryClient();
  return useMutation<{ data: AgentSessionFull }, Error, { context_type?: string; context_id?: string; context_name?: string; reuse_context?: boolean }>({
    mutationFn: (data) => api.post('agent/sessions', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-sessions'] }),
  });
}

export function useRenameAgentSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, label }: { id: string; label: string }) =>
      api.patch(`agent/sessions/${id}`, { label }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-sessions'] }),
  });
}

export function useDeleteAgentSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`agent/sessions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-sessions'] }),
  });
}

export function useClearAllAgentSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete('agent/sessions'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-sessions'] }),
  });
}

export interface ActivityLogEntry {
  id: string;
  tenant_id: string;
  session_id: string;
  session_label: string | null;
  user_id: string;
  user_name: string | null;
  turn_index: number;
  tool_name: string;
  tool_args: Record<string, unknown>;
  tool_result: unknown;
  is_error: boolean;
  duration_ms: number | null;
  created_at: string;
}

export interface ActivityFilters {
  user_id?: string;
  tool_name?: string;
  is_error?: boolean;
  since?: string;
  limit?: number;
  cursor?: string;
}

export interface AgentToolCatalogEntry {
  name: string;
  tier: 'core' | 'extended' | 'analytics' | 'admin';
  required_scopes: string[];
  description: string;
  category: string;
}

export function useAgentToolCatalog() {
  return useQuery<{ data: AgentToolCatalogEntry[]; total: number }>({
    queryKey: ['agent-tool-catalog'],
    queryFn: () => api.get('agent/tools'),
  });
}

export function useAgentActivity(filters?: ActivityFilters) {
  return useQuery<{ data: ActivityLogEntry[]; total: number; next_cursor?: string }>({
    queryKey: ['agent-activity', filters],
    queryFn: () => {
      const p: Record<string, string | number | boolean | undefined> = {};
      if (filters?.user_id) p.user_id = filters.user_id;
      if (filters?.tool_name) p.tool_name = filters.tool_name;
      if (filters?.is_error !== undefined) p.is_error = filters.is_error;
      if (filters?.since) p.since = filters.since;
      if (filters?.limit) p.limit = filters.limit;
      if (filters?.cursor) p.cursor = filters.cursor;
      const qs = new URLSearchParams(
        Object.entries(p)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)]),
      ).toString();
      return api.get(`agent/activity${qs ? '?' + qs : ''}`);
    },
  });
}

export function useSessionActivity(sessionId: string | null) {
  return useQuery<{ activity: ActivityLogEntry[] }>({
    queryKey: ['session-activity', sessionId],
    queryFn: () => api.get(`agent/sessions/${sessionId}/activity`),
    enabled: !!sessionId,
  });
}

// ── Email Provider ───────────────────────────────────────────────────────────

export function useEmailProvider() {
  return useQuery({ queryKey: ['email-provider'], queryFn: () => api.get('email-provider') });
}

export function useUpdateEmailProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.put('email-provider', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['email-provider'] }),
  });
}

export function useInboundEmailConfig() {
  return useQuery({ queryKey: ['email-provider-inbound'], queryFn: () => api.get('email-provider/inbound') });
}

export function useGenerateInboundSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('email-provider/inbound/secret', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['email-provider-inbound'] }),
  });
}

// ── Messaging Channels ──────────────────────────────────────────────────────

export function useMessagingChannels(params?: { provider?: string; is_active?: boolean; limit?: number }) {
  return useList('messaging-channels', 'messaging-channels', params as Record<string, string | number | boolean | undefined>);
}

export function useCreateMessagingChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('messaging-channels', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['messaging-channels'] }),
  });
}

export function useUpdateMessagingChannel(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.patch(`messaging-channels/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['messaging-channels'] }),
  });
}

export function useDeleteMessagingChannel(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(`messaging-channels/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['messaging-channels'] }),
  });
}

// ── Systems Of Record ───────────────────────────────────────────────────────

export type SystemOfRecordType = 'hubspot' | 'salesforce' | 'databricks' | 'snowflake';

export interface SystemOfRecord {
  id: string;
  name: string;
  system_type: SystemOfRecordType;
  auth_type: string;
  status: string;
  health?: Record<string, unknown>;
  config?: Record<string, unknown>;
  sync_settings?: Record<string, unknown>;
  has_credentials?: boolean;
  last_error?: string | null;
  last_sync_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SystemMapping {
  id: string;
  system_id: string;
  object_type: string;
  external_object: string;
  external_id_field: string;
  watermark_field?: string | null;
  field_mapping?: Record<string, string>;
  readable_fields?: string[];
  writable_fields?: string[];
  source_authority?: string;
  writeback_mode?: string | null;
  writeback_config?: Record<string, unknown>;
  allow_source_loop?: boolean;
  is_active: boolean;
  sync_cursor?: string | null;
  sync_watermark?: string | null;
  last_sync_at?: string | null;
  last_sync_run_id?: string | null;
  created_at: string;
  updated_at: string;
}

export function useSystemsOfRecord(params?: { system_type?: string; status?: string; limit?: number; cursor?: string }) {
  return useList<SystemOfRecord>('systems-of-record', 'systems-of-record', params);
}

export function useCreateSystemOfRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('systems-of-record', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['systems-of-record'] }),
  });
}

export function useUpdateSystemOfRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) => api.patch(`systems-of-record/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['systems-of-record'] }),
  });
}

export function useDeleteSystemOfRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`systems-of-record/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['systems-of-record'] });
      qc.invalidateQueries({ queryKey: ['systems-of-record-mappings'] });
    },
  });
}

export function useTestSystemOfRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`systems-of-record/${id}/test`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['systems-of-record'] }),
  });
}

export function useDiscoverSystemOfRecord(systemId?: string, objectName?: string) {
  return useQuery({
    queryKey: ['systems-of-record-discover', systemId, objectName],
    queryFn: () => api.get(`systems-of-record/${systemId}/discover${objectName ? `?object_name=${encodeURIComponent(objectName)}` : ''}`),
    enabled: !!systemId,
  });
}

export function useSystemMappings(params?: { system_id?: string; object_type?: string; is_active?: boolean; limit?: number; cursor?: string }) {
  return useList<SystemMapping>('systems-of-record-mappings', 'systems-of-record/mappings/list', params);
}

export function useUpsertSystemMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('systems-of-record/mappings', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['systems-of-record-mappings'] });
      qc.invalidateQueries({ queryKey: ['systems-of-record'] });
    },
  });
}

export function useDeleteSystemMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`systems-of-record/mappings/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['systems-of-record-mappings'] });
      qc.invalidateQueries({ queryKey: ['systems-of-record'] });
    },
  });
}

export function useRunSystemSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, mode, mapping_id }: { id: string; mode?: string; mapping_id?: string }) =>
      api.post(`systems-of-record/${id}/sync`, { mode: mode ?? 'incremental', mapping_id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['systems-of-record'] });
      qc.invalidateQueries({ queryKey: ['systems-of-record-sync-runs'] });
    },
  });
}

export function useSystemSyncRuns(params?: { system_id?: string; status?: string; limit?: number; cursor?: string }) {
  return useList<Record<string, unknown>>('systems-of-record-sync-runs', 'systems-of-record/sync-runs/list', params);
}

export function useSystemConflicts(params?: { system_id?: string; status?: string; object_type?: string; object_id?: string; limit?: number; cursor?: string }) {
  return useList<Record<string, unknown>>('systems-of-record-conflicts', 'systems-of-record/conflicts/list', params);
}

export function useResolveSystemConflict() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, resolution, note }: { id: string; resolution: string; note?: string }) =>
      api.post(`systems-of-record/conflicts/${id}/resolve`, { resolution, note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['systems-of-record-conflicts'] }),
  });
}

export function useSystemWritebacks(params?: { system_id?: string; status?: string; limit?: number; cursor?: string }) {
  return useList<Record<string, unknown>>('systems-of-record-writebacks', 'systems-of-record/writebacks/list', params);
}

export function usePreviewSystemWriteback() {
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('systems-of-record/writebacks/preview', data),
  });
}

export function useRequestSystemWriteback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('systems-of-record/writebacks', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['systems-of-record-writebacks'] }),
  });
}

export function useExecuteSystemWriteback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`systems-of-record/writebacks/${id}/execute`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['systems-of-record-writebacks'] }),
  });
}

export function useReviewSystemWriteback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, note }: { id: string; decision: 'approved' | 'rejected'; note?: string }) =>
      api.post(`systems-of-record/writebacks/${id}/review`, { decision, note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['systems-of-record-writebacks'] }),
  });
}
