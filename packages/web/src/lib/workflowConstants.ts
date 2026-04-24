// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/** All known CRM trigger events for workflow autocomplete. */
export const TRIGGER_EVENTS = [
  // Manual
  { value: 'manual',                     label: 'Manual / On Demand',         group: 'Manual'        },
  // Contacts
  { value: 'contact.created',            label: 'Contact created',            group: 'Contacts'      },
  { value: 'contact.updated',            label: 'Contact updated',            group: 'Contacts'      },
  { value: 'contact.stage_changed',      label: 'Contact stage changed',      group: 'Contacts'      },
  { value: 'contact.deleted',            label: 'Contact deleted',            group: 'Contacts'      },
  // Accounts
  { value: 'account.created',            label: 'Account created',            group: 'Accounts'      },
  { value: 'account.updated',            label: 'Account updated',            group: 'Accounts'      },
  { value: 'account.deleted',            label: 'Account deleted',            group: 'Accounts'      },
  // Opportunities
  { value: 'opportunity.created',        label: 'Opportunity created',        group: 'Opportunities' },
  { value: 'opportunity.updated',        label: 'Opportunity updated',        group: 'Opportunities' },
  { value: 'opportunity.stage_changed',  label: 'Opportunity stage changed',  group: 'Opportunities' },
  { value: 'opportunity.closed',         label: 'Opportunity closed',         group: 'Opportunities' },
  { value: 'opportunity.closed_won',     label: 'Opportunity closed won',     group: 'Opportunities' },
  { value: 'opportunity.closed_lost',    label: 'Opportunity closed lost',    group: 'Opportunities' },
  { value: 'opportunity.deleted',        label: 'Opportunity deleted',        group: 'Opportunities' },
  // Activities
  { value: 'activity.created',           label: 'Activity created',           group: 'Activities'    },
  { value: 'activity.updated',           label: 'Activity updated',           group: 'Activities'    },
  { value: 'activity.completed',         label: 'Activity completed',         group: 'Activities'    },
  // Assignments
  { value: 'assignment.created',         label: 'Assignment created',         group: 'Assignments'   },
  { value: 'assignment.completed',       label: 'Assignment completed',       group: 'Assignments'   },
  // Use Cases
  { value: 'use_case.created',           label: 'Use case created',           group: 'Use Cases'     },
  { value: 'use_case.updated',           label: 'Use case updated',           group: 'Use Cases'     },
  { value: 'use_case.stage_changed',     label: 'Use case stage changed',     group: 'Use Cases'     },
  // Email
  { value: 'email.sent',                 label: 'Email sent',                 group: 'Email'         },
  { value: 'email.failed',               label: 'Email failed',               group: 'Email'         },
  // HITL / Handoffs
  { value: 'hitl.submitted',             label: 'HITL request submitted',     group: 'Handoffs'      },
  { value: 'hitl.resolved',              label: 'HITL request resolved',      group: 'Handoffs'      },
] as const;

export type TriggerEventValue = typeof TRIGGER_EVENTS[number]['value'];

/** Lookup trigger event label from value */
export function getTriggerLabel(value: string): string {
  return TRIGGER_EVENTS.find(e => e.value === value)?.label ?? value;
}

/** Per-action-type config field definitions used by the action builder UI. */
export interface ActionConfigField {
  key:         string;
  label:       string;
  placeholder: string;
  required:    boolean;
  type?:       'text' | 'boolean' | 'textarea' | 'number' | 'sequence_picker';
  hint?:       string;
}

export interface ActionTypeDef {
  value:        string;
  label:        string;
  description?: string;
  configFields: ActionConfigField[];
  supportsVariables?: boolean;
  /** UI grouping category */
  group?:        string;
  /** This action type always creates a HITL request (blocks for human review) */
  isHITL?:       boolean;
  /** This action CAN require human review via a require_approval config field */
  hitlCapable?:  boolean;
}

export const ACTION_TYPES: ActionTypeDef[] = [
  // ── Human review ──────────────────────────────────────────────────────────
  {
    value: 'hitl_checkpoint',
    label: 'Human Review Checkpoint',
    description: 'Pause and request human review before continuing. Subsequent actions run after approval.',
    group: 'Human',
    isHITL: true,
    configFields: [
      { key: 'title',        label: 'Review request title', placeholder: 'e.g. Review outreach email for {{subject.first_name}}', required: true,  type: 'text',     hint: 'Supports {{variables}}' },
      { key: 'instructions', label: 'Instructions',         placeholder: 'What should the reviewer check or decide?',             required: false, type: 'textarea' },
      { key: 'priority',     label: 'Priority',             placeholder: 'normal  (or high / urgent)',                            required: false, type: 'text' },
    ],
  },
  // ── Outreach ──────────────────────────────────────────────────────────────
  {
    value: 'send_email',
    label: 'Send email',
    description: 'Compose and send an email. Enable "Require approval" to route through a human before sending.',
    group: 'Outreach',
    supportsVariables: true,
    hitlCapable: true,
    configFields: [
      { key: 'to_address',       label: 'To',               placeholder: 'e.g. {{subject.email}} or person@example.com', required: true,  type: 'text',     hint: 'Supports {{variables}}' },
      { key: 'subject',          label: 'Subject',          placeholder: 'e.g. Following up on {{subject.name}}',        required: true,  type: 'text',     hint: 'Supports {{variables}}' },
      { key: 'body_text',        label: 'Body',             placeholder: 'Email body. Supports {{variables}}.',          required: true,  type: 'textarea', hint: 'Supports {{variables}}' },
      { key: 'require_approval', label: 'Require human approval before sending', placeholder: '', required: false, type: 'boolean', hint: 'A HITL review request is created; email only sends after approval' },
    ],
  },
  {
    value: 'send_notification',
    label: 'Send notification',
    description: 'Post a message to a messaging channel (Slack, etc.)',
    group: 'Outreach',
    supportsVariables: true,
    configFields: [
      { key: 'message',    label: 'Message',    placeholder: 'e.g. New lead arrived: {{subject.first_name}}', required: true,  type: 'textarea', hint: 'Supports {{variables}}' },
      { key: 'channel_id', label: 'Channel ID', placeholder: 'UUID (uses default if empty)',                  required: false, type: 'text' },
      { key: 'recipient',  label: 'Recipient',  placeholder: 'e.g. #channel or @user',                        required: false, type: 'text' },
    ],
  },
  // ── CRM ───────────────────────────────────────────────────────────────────
  {
    value: 'create_context_entry',
    label: 'Create context entry',
    description: 'Add a note or insight to the triggered entity\'s knowledge base',
    group: 'CRM',
    supportsVariables: true,
    configFields: [
      { key: 'body',         label: 'Content',      placeholder: 'Note content. Supports {{variables}}.', required: true,  type: 'textarea', hint: 'Supports {{variables}}' },
      { key: 'context_type', label: 'Context type', placeholder: 'e.g. note, insight (default: note)',    required: false, type: 'text' },
    ],
  },
  {
    value: 'create_activity',
    label: 'Create activity',
    description: 'Log a CRM activity on the triggered entity',
    group: 'CRM',
    supportsVariables: true,
    configFields: [
      { key: 'type',    label: 'Activity type', placeholder: 'e.g. task, call, email, note',   required: true,  type: 'text' },
      { key: 'subject', label: 'Subject',        placeholder: 'Activity subject. {{variables}}', required: true,  type: 'text', hint: 'Supports {{variables}}' },
      { key: 'body',    label: 'Notes',          placeholder: 'Additional notes (optional)',     required: false, type: 'textarea', hint: 'Supports {{variables}}' },
    ],
  },
  {
    value: 'update_field',
    label: 'Update field',
    description: 'Set a field value on the triggered entity',
    group: 'CRM',
    configFields: [
      { key: 'field', label: 'Field name', placeholder: 'e.g. lifecycle_stage', required: true,  type: 'text' },
      { key: 'value', label: 'New value',  placeholder: 'e.g. customer',        required: true,  type: 'text' },
    ],
  },
  {
    value: 'add_tag',
    label: 'Add tag',
    description: 'Add a tag to the triggered entity',
    group: 'CRM',
    configFields: [
      { key: 'tag', label: 'Tag', placeholder: 'e.g. hot-lead', required: true, type: 'text' },
    ],
  },
  {
    value: 'remove_tag',
    label: 'Remove tag',
    description: 'Remove a tag from the triggered entity',
    group: 'CRM',
    configFields: [
      { key: 'tag', label: 'Tag', placeholder: 'e.g. unqualified', required: true, type: 'text' },
    ],
  },
  {
    value: 'assign_owner',
    label: 'Assign owner',
    description: 'Set the owner of the triggered entity',
    group: 'CRM',
    configFields: [
      { key: 'owner_id', label: 'Owner ID', placeholder: 'Actor UUID', required: true, type: 'text' },
    ],
  },
  // ── Sequences ─────────────────────────────────────────────────────────────
  {
    value: 'enroll_in_sequence',
    label: 'Enroll in Sequence',
    description: 'Enroll the triggered contact into a sequence journey',
    group: 'Sequences',
    supportsVariables: true,
    configFields: [
      { key: 'sequence_id', label: 'Sequence',  placeholder: 'Select a sequence',                             required: true,  type: 'sequence_picker' },
      { key: 'objective',   label: 'Objective', placeholder: 'e.g. Book demo call by end of month',           required: false, type: 'text', hint: 'Supports {{variables}}' },
      { key: 'contact_id',  label: 'Contact ID (override)', placeholder: 'Leave blank to use {{contact.id}}', required: false, type: 'text', hint: 'Auto-resolved from event subject if blank' },
    ],
  },
  // ── Developer ─────────────────────────────────────────────────────────────
  {
    value: 'webhook',
    label: 'Call webhook',
    description: 'POST a JSON payload to an external HTTPS endpoint',
    group: 'Developer',
    configFields: [
      { key: 'url',    label: 'URL',    placeholder: 'https://hooks.example.com/crmy', required: true,  type: 'text' },
      { key: 'secret', label: 'Secret', placeholder: 'Optional shared secret',         required: false, type: 'text' },
    ],
  },
  {
    value: 'wait',
    label: 'Wait / delay',
    description: 'Pause execution before running the next action',
    group: 'Developer',
    configFields: [
      { key: 'seconds', label: 'Delay (seconds)', placeholder: 'e.g. 30 (max 300)', required: true, type: 'number' },
    ],
  },
  // ── Legacy (hidden from UI, kept for backward compat) ─────────────────────
  {
    value: 'create_note',
    label: 'Create context entry (legacy)',
    description: 'Deprecated — use "Create context entry" instead',
    group: 'CRM',
    supportsVariables: true,
    configFields: [
      { key: 'body', label: 'Note body', placeholder: 'Note content. Supports {{variables}}.', required: true, type: 'textarea', hint: 'Supports {{variables}}' },
    ],
  },
];

/** Unique action groups in display order */
export const ACTION_GROUPS = ['Human', 'Outreach', 'CRM', 'Sequences', 'Developer'] as const;
export type ActionGroup = typeof ACTION_GROUPS[number];

/** Action types shown to users when creating a new workflow (hide deprecated aliases) */
export const VISIBLE_ACTION_TYPES = ACTION_TYPES.filter(a => a.value !== 'create_note');

/** Returns true if every required config field is filled for the given action. */
export function isActionValid(action: { type: string; config: Record<string, string> }): boolean {
  const def = ACTION_TYPES.find(a => a.value === action.type);
  if (!def) return false;
  return def.configFields.filter(f => f.required).every(f => (action.config[f.key] ?? '').trim() !== '');
}

// ── Filter operators ────────────────────────────────────────────────────────

export const FILTER_OPERATORS = [
  { value: 'eq',          label: 'equals'           },
  { value: 'neq',         label: 'does not equal'   },
  { value: 'contains',    label: 'contains'         },
  { value: 'starts_with', label: 'starts with'      },
  { value: 'gt',          label: 'greater than'     },
  { value: 'lt',          label: 'less than'        },
  { value: 'exists',      label: 'exists'           },
  { value: 'not_exists',  label: 'does not exist'   },
] as const;

export type FilterOperator = typeof FILTER_OPERATORS[number]['value'];

export interface FilterCondition {
  field: string;
  op: FilterOperator;
  value: string;
}

/** Convert UI filter conditions array to the JSONB filter object stored in DB */
export function conditionsToFilter(conditions: FilterCondition[]): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  for (const c of conditions) {
    if (!c.field.trim()) continue;
    if (c.op === 'exists' || c.op === 'not_exists') {
      filter[c.field] = { op: c.op };
    } else {
      filter[c.field] = { op: c.op, value: c.value };
    }
  }
  return filter;
}

/** Convert stored JSONB filter object back to UI conditions array */
export function filterToConditions(filter: Record<string, unknown>): FilterCondition[] {
  return Object.entries(filter ?? {}).map(([field, cond]) => {
    if (cond && typeof cond === 'object' && 'op' in (cond as object)) {
      const c = cond as { op: string; value?: unknown };
      return { field, op: (c.op as FilterOperator) ?? 'eq', value: String(c.value ?? '') };
    }
    // Legacy plain-equality format
    return { field, op: 'eq' as FilterOperator, value: String(cond ?? '') };
  });
}

// ── Variable suggestions ────────────────────────────────────────────────────

export interface VariableSuggestion {
  path: string;
  label: string;
  group: string;
}

export const VARIABLE_SUGGESTIONS: VariableSuggestion[] = [
  // Contact / subject fields
  { path: 'subject.first_name',      label: 'First name',       group: 'Contact' },
  { path: 'subject.last_name',       label: 'Last name',        group: 'Contact' },
  { path: 'subject.email',           label: 'Email',            group: 'Contact' },
  { path: 'subject.phone',           label: 'Phone',            group: 'Contact' },
  { path: 'subject.title',           label: 'Job title',        group: 'Contact' },
  { path: 'subject.company_name',    label: 'Company',          group: 'Contact' },
  { path: 'subject.lifecycle_stage', label: 'Lifecycle stage',  group: 'Contact' },
  // Account fields
  { path: 'subject.name',            label: 'Name',             group: 'Account' },
  { path: 'subject.domain',          label: 'Domain',           group: 'Account' },
  { path: 'subject.industry',        label: 'Industry',         group: 'Account' },
  // Opportunity fields
  { path: 'subject.stage',           label: 'Stage',            group: 'Opportunity' },
  { path: 'subject.amount',          label: 'Amount',           group: 'Opportunity' },
  { path: 'subject.close_date',      label: 'Close date',       group: 'Opportunity' },
  // Event generic
  { path: 'event.id',                label: 'Entity ID',        group: 'Event' },
  { path: 'event.type',              label: 'Event type',       group: 'Event' },
];

/** Get variable suggestions relevant to a given trigger event */
export function getSuggestionsForTrigger(triggerEvent: string): VariableSuggestion[] {
  if (triggerEvent.startsWith('contact.')) {
    return VARIABLE_SUGGESTIONS.filter(v => ['Contact', 'Event'].includes(v.group));
  }
  if (triggerEvent.startsWith('account.')) {
    return VARIABLE_SUGGESTIONS.filter(v => ['Account', 'Event'].includes(v.group));
  }
  if (triggerEvent.startsWith('opportunity.')) {
    return VARIABLE_SUGGESTIONS.filter(v => ['Opportunity', 'Event'].includes(v.group));
  }
  return VARIABLE_SUGGESTIONS;
}

/** Sample payload skeleton for the test panel, keyed by trigger event prefix */
export function getSamplePayload(triggerEvent: string): Record<string, unknown> {
  if (triggerEvent.startsWith('contact.')) {
    return { id: '<contact-uuid>', first_name: 'Alice', last_name: 'Smith', email: 'alice@example.com', lifecycle_stage: 'lead' };
  }
  if (triggerEvent.startsWith('account.')) {
    return { id: '<account-uuid>', name: 'Acme Corp', domain: 'acme.com', industry: 'Technology' };
  }
  if (triggerEvent.startsWith('opportunity.')) {
    return { id: '<opportunity-uuid>', name: 'Q1 Deal', stage: 'discovery', amount: 50000 };
  }
  if (triggerEvent.startsWith('activity.')) {
    return { id: '<activity-uuid>', type: 'call', subject: 'Discovery call', outcome: 'positive' };
  }
  if (triggerEvent.startsWith('assignment.')) {
    return { id: '<assignment-uuid>', title: 'Follow up with Alice', status: 'pending' };
  }
  return { id: '<entity-uuid>' };
}
