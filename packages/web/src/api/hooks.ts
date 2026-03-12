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
export function useActivities(params?: { contact_id?: string; account_id?: string; limit?: number }) {
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
export function useCreateEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('emails', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['emails'] }),
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
export function useApiKeys() {
  return useQuery({
    queryKey: ['api-keys'],
    queryFn: () => api.get<{ data: Array<{ id: string; label: string; scopes: string[]; created_at: string; last_used_at?: string }> }>('/auth/api-keys'),
  });
}
export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { label: string; scopes: string[] }) =>
      api.post<{ id: string; key: string; label: string }>('/auth/api-keys', data),
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
