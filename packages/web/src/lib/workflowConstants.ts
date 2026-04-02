// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/** All known CRM trigger events for workflow autocomplete. */
export const TRIGGER_EVENTS = [
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
] as const;

export type TriggerEventValue = typeof TRIGGER_EVENTS[number]['value'];

/** Per-action-type config field definitions used by the action builder UI. */
export interface ActionConfigField {
  key:         string;
  label:       string;
  placeholder: string;
  required:    boolean;
}

export interface ActionTypeDef {
  value:        string;
  label:        string;
  configFields: ActionConfigField[];
}

export const ACTION_TYPES: ActionTypeDef[] = [
  {
    value: 'send_notification',
    label: 'Send notification',
    configFields: [
      { key: 'message', label: 'Message', placeholder: 'e.g. A new lead arrived', required: true },
    ],
  },
  {
    value: 'create_note',
    label: 'Create note',
    configFields: [
      { key: 'body', label: 'Note body', placeholder: 'Note content…', required: true },
    ],
  },
  {
    value: 'create_activity',
    label: 'Create activity',
    configFields: [
      { key: 'type',    label: 'Type',    placeholder: 'e.g. call, email, task', required: true  },
      { key: 'subject', label: 'Subject', placeholder: 'Activity subject…',      required: true  },
    ],
  },
  {
    value: 'add_tag',
    label: 'Add tag',
    configFields: [
      { key: 'tag', label: 'Tag', placeholder: 'e.g. hot-lead', required: true },
    ],
  },
  {
    value: 'remove_tag',
    label: 'Remove tag',
    configFields: [
      { key: 'tag', label: 'Tag', placeholder: 'e.g. unqualified', required: true },
    ],
  },
  {
    value: 'update_field',
    label: 'Update field',
    configFields: [
      { key: 'field', label: 'Field name', placeholder: 'e.g. lifecycle_stage', required: true },
      { key: 'value', label: 'New value',  placeholder: 'e.g. customer',        required: true },
    ],
  },
  {
    value: 'assign_owner',
    label: 'Assign owner',
    configFields: [
      { key: 'owner_id', label: 'Owner ID', placeholder: 'User UUID', required: true },
    ],
  },
  {
    value: 'webhook',
    label: 'Call webhook',
    configFields: [
      { key: 'url', label: 'URL', placeholder: 'https://hooks.example.com/crmy', required: true },
    ],
  },
];

/** Returns true if every required config field is filled for the given action. */
export function isActionValid(action: { type: string; config: Record<string, string> }): boolean {
  const def = ACTION_TYPES.find(a => a.value === action.type);
  if (!def) return false;
  return def.configFields.filter(f => f.required).every(f => (action.config[f.key] ?? '').trim() !== '');
}
