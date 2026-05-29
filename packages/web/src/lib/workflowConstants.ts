// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/** All known operational trigger events for workflow autocomplete. */
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
  // Signals / Memory
  { value: 'context.signal_promoted',     label: 'Signal promoted to Memory', group: 'Signals & Memory' },
  { value: 'context.signal_auto_promoted', label: 'Signal auto-promoted to Memory', group: 'Signals & Memory' },
  { value: 'context.signal_rejected',     label: 'Signal dismissed',          group: 'Signals & Memory' },
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
  // Systems of Record
  { value: 'system_of_record.created',   label: 'System of record created',   group: 'Systems'       },
  { value: 'system_of_record.updated',   label: 'System of record updated',   group: 'Systems'       },
  { value: 'system_sync.completed',      label: 'System sync completed',      group: 'Systems'       },
  { value: 'system_sync.failed',         label: 'System sync failed',         group: 'Systems'       },
  { value: 'sync_conflict.resolved',      label: 'Sync conflict resolved',     group: 'Systems'       },
  { value: 'system_writeback.requested', label: 'External writeback requested', group: 'Systems'     },
  { value: 'system_writeback.approved',  label: 'External writeback approved', group: 'Systems'       },
  { value: 'system_writeback.rejected',  label: 'External writeback rejected', group: 'Systems'       },
  { value: 'system_writeback.completed', label: 'External writeback completed', group: 'Systems'      },
  { value: 'system_writeback.failed',    label: 'External writeback failed',   group: 'Systems'       },
  { value: 'workflow.action.run_system_sync', label: 'Workflow system sync completed', group: 'Systems' },
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
  type?:       'text' | 'boolean' | 'textarea' | 'number' | 'sequence_picker' | 'system_picker' | 'mapping_picker';
  hint?:       string;
  aiControlled?: boolean;
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
      { key: 'ai_generate',      label: 'AI generate content', placeholder: '', required: false, type: 'boolean', hint: 'Requires the Workspace Agent to be configured.' },
      { key: 'ai_prompt',        label: 'AI prompt',        placeholder: 'Describe what to write. CRMy will use this prompt with current customer context.', required: false, type: 'textarea', hint: 'Supports {{variables}}' },
      { key: 'body_text',        label: 'Body',             placeholder: 'Email body. Supports {{variables}}.',          required: true,  type: 'textarea', hint: 'Supports {{variables}}', aiControlled: true },
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
      { key: 'ai_generate', label: 'AI generate message', placeholder: '', required: false, type: 'boolean', hint: 'Requires the Workspace Agent to be configured.' },
      { key: 'ai_prompt',   label: 'AI prompt', placeholder: 'Describe the message CRMy should draft from this event.', required: false, type: 'textarea', hint: 'Supports {{variables}}' },
      { key: 'message',    label: 'Message',    placeholder: 'e.g. New lead arrived: {{subject.first_name}}', required: true,  type: 'textarea', hint: 'Supports {{variables}}', aiControlled: true },
      { key: 'channel_id', label: 'Channel ID', placeholder: 'Uses the default channel if empty',             required: false, type: 'text' },
      { key: 'recipient',  label: 'Recipient',  placeholder: 'e.g. #channel or @user',                        required: false, type: 'text' },
    ],
  },
  // ── State ─────────────────────────────────────────────────────────────────
  {
    value: 'create_context_entry',
    label: 'Create context entry',
    description: 'Add Memory to the triggered customer record',
    group: 'State',
    supportsVariables: true,
    configFields: [
      { key: 'body',         label: 'Content',      placeholder: 'Note content. Supports {{variables}}.', required: true,  type: 'textarea', hint: 'Supports {{variables}}' },
      { key: 'context_type', label: 'Context type', placeholder: 'e.g. note, insight (default: note)',    required: false, type: 'text' },
    ],
  },
  {
    value: 'create_activity',
    label: 'Create activity',
    description: 'Log an activity on the triggered entity',
    group: 'State',
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
    group: 'State',
    configFields: [
      { key: 'field', label: 'Field name', placeholder: 'e.g. lifecycle_stage', required: true,  type: 'text' },
      { key: 'value', label: 'New value',  placeholder: 'e.g. customer',        required: true,  type: 'text' },
    ],
  },
  {
    value: 'add_tag',
    label: 'Add tag',
    description: 'Add a tag to the triggered entity',
    group: 'State',
    configFields: [
      { key: 'tag', label: 'Tag', placeholder: 'e.g. hot-lead', required: true, type: 'text' },
    ],
  },
  {
    value: 'remove_tag',
    label: 'Remove tag',
    description: 'Remove a tag from the triggered entity',
    group: 'State',
    configFields: [
      { key: 'tag', label: 'Tag', placeholder: 'e.g. unqualified', required: true, type: 'text' },
    ],
  },
  {
    value: 'assign_owner',
    label: 'Assign owner',
    description: 'Set the owner of the triggered entity',
    group: 'State',
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
  // ── Systems of Record ─────────────────────────────────────────────────────
  {
    value: 'request_external_writeback',
    label: 'Request governed writeback',
    description: 'Create a policy-checked writeback request. Approval may be required before CRMy updates Salesforce, HubSpot, Databricks, Snowflake, or another system of record.',
    group: 'Systems',
    supportsVariables: true,
    hitlCapable: true,
    configFields: [
      { key: 'system_id', label: 'System', placeholder: 'Select a system', required: true, type: 'system_picker' },
      { key: 'mapping_id', label: 'Mapping', placeholder: 'Optional mapping', required: false, type: 'mapping_picker' },
      { key: 'object_type', label: 'Object type', placeholder: 'contact, account, opportunity, activity', required: true, type: 'text' },
      { key: 'external_object', label: 'External object', placeholder: 'contacts, companies, deals, table name', required: true, type: 'text' },
      { key: 'operation', label: 'Operation', placeholder: 'upsert, update, append_event', required: true, type: 'text' },
      { key: 'writeback_mode', label: 'Writeback mode', placeholder: 'mapped_upsert, append_event, stored_procedure', required: true, type: 'text' },
      { key: 'payload', label: 'Payload', placeholder: '{"field":"value"} — supports {{variables}}', required: true, type: 'textarea', hint: 'JSON object or templated payload' },
      { key: 'require_approval', label: 'Require human approval', placeholder: '', required: false, type: 'boolean', hint: 'System policy may still require approval before execution.' },
    ],
  },
  {
    value: 'run_system_sync',
    label: 'Run system sync',
    description: 'Start a governed sync for a configured system of record.',
    group: 'Systems',
    configFields: [
      { key: 'system_id', label: 'System', placeholder: 'Select a system', required: true, type: 'system_picker' },
      { key: 'mapping_id', label: 'Mapping', placeholder: 'Optional mapping', required: false, type: 'mapping_picker' },
      { key: 'mode', label: 'Mode', placeholder: 'incremental or full', required: false, type: 'text' },
    ],
  },
  {
    value: 'create_sync_conflict_review',
    label: 'Create sync conflict review',
    description: 'Route a source/local conflict to a human reviewer.',
    group: 'Systems',
    configFields: [
      { key: 'title', label: 'Review title', placeholder: 'Review sync conflict for {{subject.name}}', required: true, type: 'text', hint: 'Supports {{variables}}' },
      { key: 'instructions', label: 'Instructions', placeholder: 'What should the reviewer decide?', required: false, type: 'textarea' },
      { key: 'priority', label: 'Priority', placeholder: 'normal, high, urgent', required: false, type: 'text' },
    ],
  },
  {
    value: 'create_context_from_external_change',
    label: 'Create context from external change',
    description: 'Save a governed context entry when an external system updates a customer record.',
    group: 'Systems',
    supportsVariables: true,
    configFields: [
      { key: 'subject_type', label: 'Subject type', placeholder: 'contact, account, opportunity, use_case', required: true, type: 'text' },
      { key: 'subject_id', label: 'Subject ID', placeholder: '{{subject.id}}', required: true, type: 'text', hint: 'Supports {{variables}}' },
      { key: 'context_type', label: 'Context type', placeholder: 'external_update', required: false, type: 'text' },
      { key: 'body', label: 'Body', placeholder: 'What changed? Supports {{variables}}.', required: true, type: 'textarea', hint: 'Supports {{variables}}' },
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
];

/** Unique action groups in display order */
export const ACTION_GROUPS = ['Human', 'Outreach', 'State', 'Sequences', 'Systems', 'Developer'] as const;
export type ActionGroup = typeof ACTION_GROUPS[number];

export const VISIBLE_ACTION_TYPES = ACTION_TYPES;

export const ACTION_GROUP_HELP: Record<ActionGroup, string> = {
  Human: 'Ask for review before risk.',
  Outreach: 'Notify people or send approved messages.',
  State: 'Update CRMy operational state.',
  Sequences: 'Start or stop customer engagement.',
  Systems: 'Sync or request governed writeback.',
  Developer: 'Call controlled technical hooks.',
};

export const TRIGGER_TEMPLATES = [
  {
    label: 'Promote trusted Memory to system of record',
    description: 'When a Signal becomes Memory, request a governed writeback instead of bypassing policy.',
    workflow: {
      name: 'Promote trusted Memory to system of record',
      description: 'Requests a policy-checked system writeback after a Signal is promoted to confirmed Memory.',
      trigger_event: 'context.signal_promoted',
      trigger_filter: {},
      is_active: false,
      actions: [
        {
          type: 'request_external_writeback',
          config: {
            object_type: '{{subject.type}}',
            object_id: '{{subject.id}}',
            external_object: 'contacts',
            operation: 'upsert',
            writeback_mode: 'mapped_upsert',
            payload: '{\n  "memory_id": "{{subject.id}}",\n  "summary": "{{subject.body}}"\n}',
            require_approval: 'true',
          },
        },
      ],
    },
  },
  {
    label: 'Update lifecycle stage after approved Signal',
    description: 'Use approval resolution as the gate before requesting a stage update.',
    workflow: {
      name: 'Update lifecycle stage after approved Signal',
      description: 'Requests governed writeback after a reviewer approves a lifecycle-stage change.',
      trigger_event: 'hitl.resolved',
      trigger_filter: {
        status: { op: 'eq', value: 'approved' },
      },
      is_active: false,
      actions: [
        {
          type: 'request_external_writeback',
          config: {
            object_type: '{{subject.type}}',
            object_id: '{{subject.id}}',
            external_object: 'contacts',
            operation: 'update',
            writeback_mode: 'mapped_upsert',
            payload: '{\n  "lifecycle_stage": "{{payload.lifecycle_stage}}"\n}',
            require_approval: 'true',
          },
        },
      ],
    },
  },
  {
    label: 'Append product/customer event to warehouse',
    description: 'Append governed activity or product signals into an approved warehouse event table.',
    workflow: {
      name: 'Append product/customer event to warehouse',
      description: 'Requests an append-only warehouse writeback after a customer activity is logged.',
      trigger_event: 'activity.created',
      trigger_filter: {},
      is_active: false,
      actions: [
        {
          type: 'request_external_writeback',
          config: {
            object_type: 'activity',
            object_id: '{{subject.id}}',
            external_object: 'customer_events',
            operation: 'append_event',
            writeback_mode: 'append_event',
            payload: '{\n  "activity_id": "{{subject.id}}",\n  "type": "{{subject.type}}",\n  "summary": "{{subject.subject}}"\n}',
            require_approval: 'false',
          },
        },
      ],
    },
  },
  {
    label: 'Sync external system after key CRMy change',
    description: 'Run a governed sync after an important customer record changes.',
    workflow: {
      name: 'Sync external system after key CRMy change',
      description: 'Runs an incremental system sync after an account update.',
      trigger_event: 'account.updated',
      trigger_filter: {},
      is_active: false,
      actions: [
        {
          type: 'run_system_sync',
          config: {
            mode: 'incremental',
          },
        },
      ],
    },
  },
] as const;

/** Returns true if every required config field is filled for the given action. */
export function isActionValid(action: { type: string; config: Record<string, string> }): boolean {
  const def = ACTION_TYPES.find(a => a.value === action.type);
  if (!def) return false;
  const aiGenerate = action.config.ai_generate === 'true';
  return def.configFields.filter(f => f.required).every(f => {
    if (aiGenerate && f.aiControlled) return true;
    return (action.config[f.key] ?? '').trim() !== '';
  });
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

export interface FilterFieldSuggestion {
  field: string;
  label: string;
  hint?: string;
  group: string;
}

const COMMON_FILTER_FIELDS: FilterFieldSuggestion[] = [
  { field: 'event_type', label: 'Event type', group: 'Event' },
  { field: 'object_type', label: 'Object type', group: 'Event' },
  { field: 'object_id', label: 'Object ID', group: 'Event' },
];

const EXTERNAL_METADATA_FILTER_FIELDS: FilterFieldSuggestion[] = [
  { field: 'metadata.origin', label: 'Origin', hint: 'crm_sync, warehouse_sync, workflow, sequence', group: 'Source' },
  { field: 'metadata.system_id', label: 'System ID', group: 'Source' },
  { field: 'metadata.system_type', label: 'System type', hint: 'hubspot, salesforce, databricks, snowflake', group: 'Source' },
  { field: 'metadata.external_record_id', label: 'External record ID', group: 'Source' },
  { field: 'metadata.sync_run_id', label: 'Sync run ID', group: 'Source' },
  { field: 'metadata.sync_mode', label: 'Sync mode', hint: 'test, full, incremental, replay', group: 'Source' },
  { field: 'metadata.changed_fields', label: 'Changed fields', hint: 'Use contains with a field name', group: 'Source' },
  { field: 'metadata.conflict_state', label: 'Conflict state', hint: 'none, open, resolved, unknown', group: 'Source' },
  { field: 'metadata.confidence', label: 'Confidence', hint: '0 to 1', group: 'Source' },
];

const SUBJECT_FILTER_FIELDS: FilterFieldSuggestion[] = [
  { field: 'id', label: 'Record ID', group: 'Record' },
  { field: 'name', label: 'Name', group: 'Record' },
  { field: 'email', label: 'Email', group: 'Record' },
  { field: 'stage', label: 'Stage', group: 'Record' },
  { field: 'lifecycle_stage', label: 'Lifecycle stage', group: 'Record' },
  { field: 'account_id', label: 'Account ID', group: 'Record' },
  { field: 'contact_id', label: 'Contact ID', group: 'Record' },
];

export function getFilterFieldSuggestions(triggerEvent: string): FilterFieldSuggestion[] {
  const fields = [...COMMON_FILTER_FIELDS, ...SUBJECT_FILTER_FIELDS];
  const isExternalAware = triggerEvent.startsWith('system_') ||
    triggerEvent.startsWith('sync_') ||
    triggerEvent.startsWith('workflow.action.run_system_sync') ||
    ['contact.', 'account.', 'opportunity.', 'activity.', 'use_case.'].some(prefix => triggerEvent.startsWith(prefix));

  if (isExternalAware) fields.push(...EXTERNAL_METADATA_FILTER_FIELDS);
  return fields;
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
  { path: 'subject.company_name',    label: 'Account',          group: 'Contact' },
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
  { path: 'metadata.origin',         label: 'Origin',           group: 'Source' },
  { path: 'metadata.system_type',    label: 'System type',      group: 'Source' },
  { path: 'metadata.system_id',      label: 'System ID',        group: 'Source' },
  { path: 'metadata.changed_fields', label: 'Changed fields',   group: 'Source' },
  { path: 'metadata.sync_mode',      label: 'Sync mode',        group: 'Source' },
  { path: 'external.record_id',      label: 'External record ID', group: 'Source' },
];

/** Get variable suggestions relevant to a given trigger event */
export function getSuggestionsForTrigger(triggerEvent: string): VariableSuggestion[] {
  if (triggerEvent.startsWith('contact.')) {
    return VARIABLE_SUGGESTIONS.filter(v => ['Contact', 'Event', 'Source'].includes(v.group));
  }
  if (triggerEvent.startsWith('account.')) {
    return VARIABLE_SUGGESTIONS.filter(v => ['Account', 'Event', 'Source'].includes(v.group));
  }
  if (triggerEvent.startsWith('opportunity.')) {
    return VARIABLE_SUGGESTIONS.filter(v => ['Opportunity', 'Event', 'Source'].includes(v.group));
  }
  return VARIABLE_SUGGESTIONS;
}

/** Sample payload skeleton for the test panel, keyed by trigger event prefix */
export function getSamplePayload(triggerEvent: string): Record<string, unknown> {
  const metadata = {
    origin: 'crm_sync',
    system_id: '<system-uuid>',
    system_type: 'hubspot',
    external_record_id: '<external-id>',
    sync_run_id: '<sync-run-uuid>',
    sync_mode: 'incremental',
    changed_fields: ['email', 'lifecycle_stage'],
    confidence: 1,
    conflict_state: 'none',
  };
  if (triggerEvent.startsWith('contact.')) {
    return { id: '<contact-uuid>', first_name: 'Alice', last_name: 'Smith', email: 'alice@example.com', lifecycle_stage: 'lead', event_type: triggerEvent, object_type: 'contact', object_id: '<contact-uuid>', metadata };
  }
  if (triggerEvent.startsWith('account.')) {
    return { id: '<account-id>', name: 'Northstar Labs', domain: 'northstarlabs.example', industry: 'AI Infrastructure', event_type: triggerEvent, object_type: 'account', object_id: '<account-id>', metadata };
  }
  if (triggerEvent.startsWith('opportunity.')) {
    return { id: '<opportunity-uuid>', name: 'Q1 Deal', stage: 'qualification', amount: 50000, contact_id: '<contact-uuid>', event_type: triggerEvent, object_type: 'opportunity', object_id: '<opportunity-uuid>', metadata };
  }
  if (triggerEvent.startsWith('activity.')) {
    return { id: '<activity-uuid>', type: 'call', subject: 'Discovery call', outcome: 'positive', contact_id: '<contact-uuid>', event_type: triggerEvent, object_type: 'activity', object_id: '<activity-uuid>', metadata };
  }
  if (triggerEvent.startsWith('assignment.')) {
    return { id: '<assignment-uuid>', title: 'Follow up with Alice', status: 'pending' };
  }
  if (triggerEvent.startsWith('system_writeback.')) {
    return {
      id: '<writeback-uuid>',
      status: triggerEvent.endsWith('.failed') ? 'failed' : 'completed',
      system_id: '<system-uuid>',
      object_type: 'contact',
      object_id: '<contact-uuid>',
      external_object: 'contacts',
      external_record_id: '<external-id>',
      payload: { lifecycle_stage: 'customer' },
      event_type: triggerEvent,
      metadata: { ...metadata, origin: 'workflow' },
    };
  }
  if (triggerEvent.startsWith('sync_conflict.')) {
    return {
      id: '<conflict-uuid>',
      conflict_id: '<conflict-uuid>',
      system_id: '<system-uuid>',
      object_type: 'contact',
      object_id: '<contact-uuid>',
      resolution: 'resolved_external',
      event_type: triggerEvent,
      metadata: { ...metadata, conflict_state: 'resolved' },
    };
  }
  if (triggerEvent.startsWith('system_sync.') || triggerEvent === 'workflow.action.run_system_sync') {
    return {
      id: '<sync-run-uuid>',
      system_id: '<system-uuid>',
      status: triggerEvent.endsWith('.failed') ? 'failed' : 'completed',
      records_seen: 42,
      records_updated: 5,
      error: triggerEvent.endsWith('.failed') ? 'Connection timed out' : undefined,
      event_type: triggerEvent,
      object_type: 'external_sync_run',
      object_id: '<sync-run-uuid>',
      metadata: { ...metadata, origin: triggerEvent === 'workflow.action.run_system_sync' ? 'workflow' : metadata.origin },
    };
  }
  return { id: '<entity-uuid>' };
}
