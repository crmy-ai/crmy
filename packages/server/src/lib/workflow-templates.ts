// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Static workflow templates for common GTM patterns.
 *
 * Each template defines a complete workflow configuration that an agent or
 * user can pass directly to `workflow_create`. Templates serve as starting
 * points — they can be customised after creation.
 */

export interface WorkflowTemplate {
  id:          string;
  category:    string;
  name:        string;
  description: string;
  trigger_event:  string;
  trigger_filter: Record<string, unknown>;
  actions:        Array<{ type: string; config: Record<string, unknown> }>;
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  // ── Lead qualification ──────────────────────────────────────────────────────
  {
    id:          'lead-qualification',
    category:    'Inbound',
    name:        'Lead Qualification',
    description: 'When a new contact is created, log a context entry, assign to a rep, and send an internal notification for immediate follow-up.',
    trigger_event:  'contact.created',
    trigger_filter: {},
    actions: [
      {
        type:   'create_context_entry',
        config: {
          entry_type: 'note',
          body:       'New lead created — {{contact.first_name}} {{contact.last_name}} from {{contact.company}}. Requires qualification.',
        },
      },
      {
        type:   'assign_owner',
        config: {
          strategy: 'round_robin',
          notify:   'true',
        },
      },
      {
        type:   'send_notification',
        config: {
          title:   'New lead: {{contact.first_name}} {{contact.last_name}}',
          body:    'A new lead arrived from {{contact.company}}. Check their context and qualify within 24 hours.',
          channel: 'app',
        },
      },
    ],
  },

  // ── Deal won ────────────────────────────────────────────────────────────────
  {
    id:          'deal-won-celebration',
    category:    'Revenue',
    name:        'Deal Won',
    description: 'When an opportunity moves to Closed Won, create a win activity, log context, and notify the team.',
    trigger_event:  'opportunity.stage_changed',
    trigger_filter: { stage: { op: 'eq', value: 'closed_won' } },
    actions: [
      {
        type:   'create_activity',
        config: {
          activity_type: 'note',
          body:          '🎉 Deal closed! {{opportunity.name}} won for {{opportunity.amount_formatted}}.',
        },
      },
      {
        type:   'create_context_entry',
        config: {
          entry_type: 'milestone',
          body:       'Opportunity {{opportunity.name}} closed won. Revenue: {{opportunity.amount_formatted}}.',
        },
      },
      {
        type:   'send_notification',
        config: {
          title:   '🎉 Deal closed: {{opportunity.name}}',
          body:    '{{opportunity.name}} has been won! Value: {{opportunity.amount_formatted}}.',
          channel: 'app',
        },
      },
    ],
  },

  // ── Churn risk alert ────────────────────────────────────────────────────────
  {
    id:          'churn-risk-alert',
    category:    'Customer Success',
    name:        'Churn Risk Alert',
    description: 'When a use case health score drops to at-risk, escalate to a human via Handoffs and send a notification.',
    trigger_event:  'use_case.health_changed',
    trigger_filter: { health: { op: 'eq', value: 'at_risk' } },
    actions: [
      {
        type:   'hitl_checkpoint',
        config: {
          title:        'Churn risk: {{use_case.name}} is at risk',
          instructions: 'Health dropped to at-risk. Review usage data, recent activities, and decide on a recovery play. Consider a QBR, executive outreach, or discount offer.',
        },
      },
      {
        type:   'send_notification',
        config: {
          title:   '⚠️ Churn risk: {{use_case.name}}',
          body:    'Health score dropped to at-risk. A handoff has been created for your review.',
          channel: 'app',
        },
      },
    ],
  },

  // ── Email opened → sequence enroll ─────────────────────────────────────────
  {
    id:          'email-engaged-enroll',
    category:    'Outreach',
    name:        'Engaged Contact — Enroll in Sequence',
    description: 'When a contact opens an email, add a tag and enroll them in a nurture sequence for follow-up.',
    trigger_event:  'email.opened',
    trigger_filter: {},
    actions: [
      {
        type:   'add_tag',
        config: { tag: 'engaged' },
      },
      {
        type:   'update_field',
        config: {
          field: 'lifecycle_stage',
          value: 'engaged',
        },
      },
    ],
  },

  // ── Inbound reply ───────────────────────────────────────────────────────────
  {
    id:          'inbound-reply',
    category:    'Outreach',
    name:        'Inbound Email Reply',
    description: 'When a contact replies to an email, update their lifecycle stage, create an activity, and notify the owner.',
    trigger_event:  'email.replied',
    trigger_filter: {},
    actions: [
      {
        type:   'update_field',
        config: {
          field: 'lifecycle_stage',
          value: 'responded',
        },
      },
      {
        type:   'create_activity',
        config: {
          activity_type: 'email',
          body:          '{{contact.first_name}} replied to an email. Follow up within 1 business day.',
        },
      },
      {
        type:   'send_notification',
        config: {
          title:   '📩 {{contact.first_name}} replied',
          body:    '{{contact.first_name}} {{contact.last_name}} replied to your email. Time to follow up!',
          channel: 'app',
        },
      },
    ],
  },

  // ── Assignment overdue ──────────────────────────────────────────────────────
  {
    id:          'assignment-overdue',
    category:    'Operations',
    name:        'Assignment Overdue Escalation',
    description: 'When an assignment passes its due date without completion, send a reminder notification and create an escalation handoff.',
    trigger_event:  'assignment.overdue',
    trigger_filter: {},
    actions: [
      {
        type:   'send_notification',
        config: {
          title:   '⏰ Assignment overdue: {{assignment.title}}',
          body:    'Assignment "{{assignment.title}}" is past due. Please take action immediately.',
          channel: 'app',
        },
      },
      {
        type:   'hitl_checkpoint',
        config: {
          title:        'Overdue assignment: {{assignment.title}}',
          instructions: 'This assignment is overdue. Decide whether to extend the deadline, reassign, or escalate to management.',
        },
      },
    ],
  },

  // ── New contact in ICP → outreach sequence ──────────────────────────────────
  {
    id:          'icp-outreach',
    category:    'Inbound',
    name:        'ICP Contact — Trigger Outreach',
    description: 'When a contact matching your ICP is created (e.g., VP title at a company with 50+ employees), enroll them in an outreach sequence automatically.',
    trigger_event:  'contact.created',
    trigger_filter: { title: { op: 'contains', value: 'VP' } },
    actions: [
      {
        type:   'create_context_entry',
        config: {
          entry_type: 'note',
          body:       'ICP match: {{contact.first_name}} {{contact.last_name}} is a VP at {{contact.company}}. Auto-enrolled in ICP outreach sequence.',
        },
      },
    ],
  },

  // ── Opportunity stalled ─────────────────────────────────────────────────────
  {
    id:          'opportunity-stalled',
    category:    'Revenue',
    name:        'Opportunity Stalled',
    description: 'When no activity is logged on an opportunity for 14+ days, create a nudge activity and notify the owner.',
    trigger_event:  'opportunity.stalled',
    trigger_filter: {},
    actions: [
      {
        type:   'create_activity',
        config: {
          activity_type: 'task',
          body:          'No activity on {{opportunity.name}} for 14 days. Re-engage the prospect.',
        },
      },
      {
        type:   'send_notification',
        config: {
          title:   '💤 Deal stalled: {{opportunity.name}}',
          body:    '{{opportunity.name}} has had no activity for 14 days. Consider a re-engagement play.',
          channel: 'app',
        },
      },
    ],
  },
];

export function getTemplatesByCategory(): Record<string, WorkflowTemplate[]> {
  const groups: Record<string, WorkflowTemplate[]> = {};
  for (const tpl of WORKFLOW_TEMPLATES) {
    (groups[tpl.category] ??= []).push(tpl);
  }
  return groups;
}

export function getTemplateById(id: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find(t => t.id === id);
}
