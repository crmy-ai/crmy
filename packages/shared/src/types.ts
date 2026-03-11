export type UUID = string;

export interface Tenant {
  id: UUID;
  slug: string;
  name: string;
  plan: string;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: UUID;
  tenant_id: UUID;
  email: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
  custom_fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: UUID;
  tenant_id: UUID;
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  title?: string;
  company_name?: string;
  account_id?: UUID;
  owner_id?: UUID;
  lifecycle_stage: 'lead' | 'prospect' | 'customer' | 'churned';
  source?: string;
  tags: string[];
  custom_fields: Record<string, unknown>;
  created_by?: UUID;
  created_at: string;
  updated_at: string;
}

export interface Account {
  id: UUID;
  tenant_id: UUID;
  name: string;
  domain?: string;
  industry?: string;
  employee_count?: number;
  annual_revenue?: number;
  currency_code: string;
  website?: string;
  parent_id?: UUID;
  owner_id?: UUID;
  health_score?: number;
  tags: string[];
  custom_fields: Record<string, unknown>;
  created_by?: UUID;
  created_at: string;
  updated_at: string;
}

export interface Opportunity {
  id: UUID;
  tenant_id: UUID;
  name: string;
  account_id?: UUID;
  contact_id?: UUID;
  owner_id?: UUID;
  stage: 'prospecting' | 'qualification' | 'proposal' | 'negotiation' | 'closed_won' | 'closed_lost';
  amount?: number;
  currency_code: string;
  close_date?: string;
  probability?: number;
  forecast_cat: 'pipeline' | 'best_case' | 'commit' | 'closed';
  description?: string;
  lost_reason?: string;
  custom_fields: Record<string, unknown>;
  created_by?: UUID;
  created_at: string;
  updated_at: string;
}

export interface Activity {
  id: UUID;
  tenant_id: UUID;
  type: 'call' | 'email' | 'meeting' | 'note' | 'task';
  subject: string;
  body?: string;
  status: string;
  direction?: string;
  due_at?: string;
  completed_at?: string;
  contact_id?: UUID;
  account_id?: UUID;
  opportunity_id?: UUID;
  owner_id?: UUID;
  source_agent?: string;
  custom_fields: Record<string, unknown>;
  created_by?: UUID;
  created_at: string;
  updated_at: string;
}

export interface HITLRequest {
  id: UUID;
  tenant_id: UUID;
  agent_id: string;
  session_id?: string;
  action_type: string;
  action_summary: string;
  action_payload: unknown;
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'auto_approved';
  reviewer_id?: UUID;
  review_note?: string;
  auto_approve_after?: string;
  expires_at: string;
  created_at: string;
  resolved_at?: string;
}

export interface CrmyEvent {
  id: number;
  tenant_id: UUID;
  event_type: string;
  actor_id?: string;
  actor_type: 'user' | 'agent' | 'system';
  object_type: string;
  object_id?: UUID;
  before_data?: unknown;
  after_data?: unknown;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ApiKey {
  id: UUID;
  tenant_id: UUID;
  user_id?: UUID;
  label: string;
  scopes: string[];
  last_used_at?: string;
  expires_at?: string;
  created_at: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  next_cursor?: string;
  total: number;
}

export interface ActorContext {
  tenant_id: UUID;
  actor_id: string;
  actor_type: 'user' | 'agent' | 'system';
  role: 'owner' | 'admin' | 'member';
  scopes?: string[];
}

export interface OperationResult<T> {
  data: T;
  event_id: number;
}
