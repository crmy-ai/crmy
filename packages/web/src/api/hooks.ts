// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// Generic list hook with pagination
function useList<T>(key: string, path: string, params?: Record<string, string | number | boolean | undefined>) {
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
export function useOpportunities(params?: { q?: string; stage?: string; limit?: number; cursor?: string }) {
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
    mutationFn: (data: { stage: string; note?: string; attributed_arr?: number }) =>
      api.post(`use-cases/${id}/stage`, data),
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
    mutationFn: (data: { health_score: number; health_note: string }) => api.post(`use-cases/${id}/health`, data),
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
export function useCreateActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('activities', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['activities'] }),
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
export function useHITLRequests() {
  return useQuery({
    queryKey: ['hitl'],
    queryFn: () => api.get('hitl'),
    refetchInterval: 10_000,
  });
}
export function useResolveHITL() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; status: string; note?: string }) =>
      api.post(`hitl/${id}/resolve`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hitl'] }),
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

// Events
export function useEvents(params?: { object_id?: string; limit?: number }) {
  return useList('events', 'events', params);
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['emails'] }),
  });
}

// Admin: User Management
type AdminUser = { id: string; email: string; name: string; role: string; created_at: string; updated_at?: string };

export function useUsers() {
  return useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.get<{ data: AdminUser[] }>('admin/users'),
  });
}
export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; email: string; password: string; role: string }) =>
      api.post<AdminUser>('admin/users', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });
}
export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string; email?: string; role?: string; password?: string }) =>
      api.patch<AdminUser>(`admin/users/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });
}
export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`admin/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });
}

// Admin: Database Config
export function useDbConfig() {
  return useQuery({
    queryKey: ['admin-db-config'],
    queryFn: () => api.get<{ host: string; port: string; database: string; user: string; ssl: string | null }>('admin/db-config'),
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

// Notes
export function useNotes(params: { object_type: string; object_id: string }) {
  return useList('notes', 'notes', params);
}
export function useCreateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('notes', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes'] }),
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
      api.patch(`actors/${id}`, { patch }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['actors'] });
      qc.invalidateQueries({ queryKey: ['actor'] });
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
  is_current?: boolean;
  limit?: number;
}) {
  return useList('context-entries', 'context', params);
}
export function useContextEntry(id: string) {
  return useQuery({ queryKey: ['context-entry', id], queryFn: () => api.get(`context/${id}`), enabled: !!id });
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
    mutationFn: ({ id, ...data }: { id: string; body: string; title?: string }) =>
      api.post(`context/${id}/supersede`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['context-entries'] }),
  });
}
export function useContextSearch(query: string, params?: { subject_type?: string; subject_id?: string; context_type?: string; tag?: string; current_only?: boolean; limit?: number }) {
  const searchParams = new URLSearchParams();
  searchParams.set('query', query);
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
    mutationFn: (id: string) => api.post(`context/${id}/review`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['context-entries'] });
      qc.invalidateQueries({ queryKey: ['context-stale'] });
    },
  });
}
export function useStaleContextEntries(params?: { subject_type?: string; subject_id?: string; limit?: number }) {
  return useList('context-stale', 'context/stale', params);
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
export function useWorkflows(params?: { q?: string; enabled?: boolean; limit?: number }) {
  return useList('workflows', 'workflows', params);
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
export function useSemanticSearch(query: string, params?: { subject_type?: string; subject_id?: string; context_type?: string; tag?: string; current_only?: boolean; limit?: number }) {
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['context-entries'] }),
  });
}

// Inbox counts (HITL pending + my active assignments) — used by nav badge
export function useInboxCounts() {
  const { data: whoami } = useWhoAmI() as any;
  const myActorId: string | undefined = whoami?.actor_id;
  const hitlQ = useHITLRequests();
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
export function useBriefing(subjectType: string, subjectId: string, params?: { format?: string; since?: string; context_types?: string; include_stale?: boolean }) {
  const searchParams = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '') searchParams.set(k, String(v));
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

// ── Agent ──

export interface AgentConfigData {
  id: string;
  tenant_id: string;
  enabled: boolean;
  provider: 'anthropic' | 'openai' | 'openrouter' | 'ollama' | 'custom';
  base_url: string;
  api_key_enc: string | null;
  model: string;
  system_prompt: string | null;
  max_tokens_per_turn: number;
  history_retention_days: number;
  can_write_objects: boolean;
  can_log_activities: boolean;
  can_create_assignments: boolean;
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
}

export interface AgentSessionFull extends AgentSessionSummary {
  messages: { role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string }[];
}

export function useAgentConfig() {
  return useQuery<{ data: AgentConfigData | null }>({
    queryKey: ['agent-config'],
    queryFn: () => api.get('agent/config'),
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
  return useMutation<{ ok: boolean; error?: string }>({
    mutationFn: () => api.post('agent/config/test'),
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
  return useMutation<{ data: AgentSessionFull }, Error, { context_type?: string; context_id?: string; context_name?: string }>({
    mutationFn: (data) => api.post('agent/sessions', data),
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

