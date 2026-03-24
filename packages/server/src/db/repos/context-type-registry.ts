// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type { ContextTypeRegistryEntry, UUID } from '@crmy/shared';

// ── Template definitions ────────────────────────────────────────────────────
// Each extractable type has:
//   json_schema       — JSON Schema for structured_data (shown to agents + used for validation)
//   extraction_prompt — Short instruction added to the extraction prompt for this type
//   is_extractable    — Whether the extraction pipeline should produce this type

interface ContextTypeTemplate extends Omit<ContextTypeRegistryEntry, 'tenant_id' | 'created_at'> {
  json_schema?: Record<string, unknown>;
  extraction_prompt?: string;
  is_extractable: boolean;
}

const DEFAULT_CONTEXT_TYPES: ContextTypeTemplate[] = [
  // ── Unstructured (original types, no extraction schema) ─────────────────
  {
    type_name: 'note',
    label: 'Note',
    description: 'General-purpose note or observation',
    is_default: true,
    is_extractable: false,
  },
  {
    type_name: 'transcript',
    label: 'Transcript',
    description: 'Verbatim or near-verbatim record of a conversation',
    is_default: true,
    is_extractable: false,
  },
  {
    type_name: 'summary',
    label: 'Summary',
    description: 'Condensed version of a longer interaction or document',
    is_default: true,
    is_extractable: false,
  },
  {
    type_name: 'research',
    label: 'Research',
    description: 'Background research on a person, company, or market',
    is_default: true,
    is_extractable: false,
  },
  {
    type_name: 'preference',
    label: 'Preference',
    description: 'Known preference of a contact or account (communication style, timing, etc.)',
    is_default: true,
    is_extractable: false,
  },
  {
    type_name: 'decision',
    label: 'Decision',
    description: 'A decision that was made and the reasoning behind it',
    is_default: true,
    is_extractable: false,
  },
  {
    type_name: 'relationship_map',
    label: 'Relationship Map',
    description: 'Key people, their roles, influence, and relationships to each other',
    is_default: true,
    is_extractable: false,
  },
  {
    type_name: 'agent_reasoning',
    label: 'Agent Reasoning',
    description: "An AI agent's internal reasoning or analysis about next steps",
    is_default: true,
    is_extractable: false,
  },
  {
    type_name: 'sentiment_analysis',
    label: 'Sentiment Analysis',
    description: 'Assessment of prospect sentiment or engagement level',
    is_default: true,
    is_extractable: false,
  },

  // ── Extractable structured types ─────────────────────────────────────────

  {
    type_name: 'commitment',
    label: 'Commitment',
    description: 'A specific commitment made by the prospect or customer (budget, timeline, resource, decision)',
    is_default: true,
    is_extractable: true,
    extraction_prompt: 'Extract explicit commitments made by the prospect/customer — budget approvals, timeline confirmations, resource allocations, or specific decisions. Only extract clearly stated commitments, not wishes or possibilities.',
    json_schema: {
      type: 'object',
      properties: {
        commitment_type: {
          type: 'string',
          enum: ['budget_approved', 'timeline_confirmed', 'resource_allocated', 'decision_made', 'other'],
          description: 'Category of commitment',
        },
        committed_by: {
          type: 'string',
          description: 'Name and/or role of the person who made the commitment',
        },
        value: {
          type: 'string',
          description: 'Specific value, amount, or detail of the commitment',
        },
        due_date: {
          type: 'string',
          description: 'When this commitment is expected to be fulfilled (ISO date or relative expression)',
        },
      },
      required: ['commitment_type', 'committed_by', 'value'],
    },
  },

  {
    type_name: 'next_step',
    label: 'Next Step',
    description: 'A concrete action item agreed upon during an interaction',
    is_default: true,
    is_extractable: true,
    extraction_prompt: 'Extract agreed-upon next steps and action items — who will do what by when. Only include explicitly agreed actions, not suggestions.',
    json_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'What needs to happen',
        },
        owner: {
          type: 'string',
          description: 'Who is responsible (name or role)',
        },
        due_date: {
          type: 'string',
          description: 'Target completion date (ISO date or relative)',
        },
        depends_on: {
          type: 'string',
          description: 'Any blocker or prerequisite',
        },
      },
      required: ['action', 'owner'],
    },
  },

  {
    type_name: 'stakeholder',
    label: 'Stakeholder',
    description: 'Information about a person involved in the deal — their role, influence, and sentiment',
    is_default: true,
    is_extractable: true,
    extraction_prompt: "Extract information about individuals mentioned in the activity — their role in the decision, attitude toward the deal, and level of influence. Create one entry per person if multiple people are discussed.",
    json_schema: {
      type: 'object',
      properties: {
        person_name: {
          type: 'string',
          description: 'Name of the individual',
        },
        role: {
          type: 'string',
          description: 'Job title or role in the organization',
        },
        influence: {
          type: 'string',
          enum: ['decision_maker', 'influencer', 'champion', 'evaluator', 'gatekeeper', 'end_user'],
          description: 'Their role in the buying/decision process',
        },
        sentiment: {
          type: 'string',
          enum: ['strong_advocate', 'supportive', 'neutral', 'skeptical', 'blocker'],
          description: 'Their attitude toward moving forward',
        },
        key_concern: {
          type: 'string',
          description: 'Their primary concern, question, or interest',
        },
      },
      required: ['person_name', 'role', 'influence', 'sentiment'],
    },
  },

  {
    type_name: 'deal_risk',
    label: 'Deal Risk',
    description: 'A risk or blocker that could jeopardize the deal or relationship',
    is_default: true,
    is_extractable: true,
    extraction_prompt: 'Extract risks, blockers, or red flags that could slow or kill the deal — budget cuts, internal politics, competitor threats, technical blockers, champion changes, or legal/compliance issues.',
    json_schema: {
      type: 'object',
      properties: {
        risk_type: {
          type: 'string',
          enum: ['budget', 'timeline', 'technical', 'champion_loss', 'competitive', 'legal_compliance', 'organizational', 'other'],
          description: 'Category of risk',
        },
        severity: {
          type: 'string',
          enum: ['critical', 'high', 'medium', 'low'],
          description: 'How likely this risk is to derail the deal',
        },
        description: {
          type: 'string',
          description: 'Specific details about the risk',
        },
        mitigation: {
          type: 'string',
          description: 'Agreed or suggested mitigation steps',
        },
      },
      required: ['risk_type', 'severity', 'description'],
    },
  },

  {
    type_name: 'competitive_intel',
    label: 'Competitive Intel',
    description: 'Information about competitors relevant to this deal or account',
    is_default: true,
    is_extractable: true,
    extraction_prompt: 'Extract information about competing vendors — who they are, whether they are actively competing, what the customer said about them, and any strengths/weaknesses mentioned.',
    json_schema: {
      type: 'object',
      properties: {
        competitor: {
          type: 'string',
          description: 'Competitor name',
        },
        status: {
          type: 'string',
          enum: ['actively_competing', 'shortlisted', 'eliminated', 'incumbent', 'mentioned'],
          description: 'Competitor status in this deal',
        },
        customer_concern: {
          type: 'string',
          description: 'Why the customer is considering this competitor or what they like about them',
        },
        our_differentiator: {
          type: 'string',
          description: 'Our key advantage vs. this competitor (if mentioned)',
        },
      },
      required: ['competitor', 'status'],
    },
  },

  {
    type_name: 'objection',
    label: 'Objection',
    description: 'A concern, pushback, or blocker raised by the prospect',
    is_default: true,
    is_extractable: true,
    extraction_prompt: 'Extract objections, concerns, or pushback raised by the prospect — price concerns, feature gaps, timing issues, internal resistance, etc. Note whether the objection was addressed.',
    json_schema: {
      type: 'object',
      properties: {
        objection_category: {
          type: 'string',
          enum: ['price', 'timing', 'features', 'trust', 'competition', 'internal_politics', 'technical', 'other'],
          description: 'Type of objection',
        },
        raised_by: {
          type: 'string',
          description: 'Who raised the objection (name or role)',
        },
        status: {
          type: 'string',
          enum: ['open', 'addressed', 'resolved', 'recurring'],
          description: 'Current state of the objection',
        },
        response: {
          type: 'string',
          description: 'How the objection was or could be addressed',
        },
      },
      required: ['objection_category', 'status'],
    },
  },

  {
    type_name: 'meeting_notes',
    label: 'Meeting Notes',
    description: 'Structured takeaways from a meeting (distinct from raw transcript)',
    is_default: true,
    is_extractable: false, // written explicitly, not extracted
  },

  {
    type_name: 'key_fact',
    label: 'Key Fact',
    description: 'An important fact about the contact, account, or deal that does not fit another category',
    is_default: true,
    is_extractable: true,
    extraction_prompt: 'Extract important standalone facts that do not fit the other categories — company news, org changes, technology stack details, budget cycles, contract end dates, etc.',
  },
];

// ── DB functions ─────────────────────────────────────────────────────────────

export async function seedDefaults(db: DbPool, tenantId: UUID): Promise<void> {
  for (const entry of DEFAULT_CONTEXT_TYPES) {
    await db.query(
      `INSERT INTO context_type_registry
         (type_name, tenant_id, label, description, is_default, json_schema, extraction_prompt, is_extractable)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (type_name) DO UPDATE SET
         label             = EXCLUDED.label,
         description       = EXCLUDED.description,
         json_schema       = EXCLUDED.json_schema,
         extraction_prompt = EXCLUDED.extraction_prompt,
         is_extractable    = EXCLUDED.is_extractable`,
      [
        entry.type_name,
        tenantId,
        entry.label,
        entry.description ?? null,
        true,
        entry.json_schema ? JSON.stringify(entry.json_schema) : null,
        entry.extraction_prompt ?? null,
        entry.is_extractable,
      ],
    );
  }
}

export async function listContextTypes(
  db: DbPool,
  tenantId: UUID,
): Promise<ContextTypeRegistryEntry[]> {
  const result = await db.query(
    'SELECT * FROM context_type_registry WHERE tenant_id = $1 ORDER BY type_name',
    [tenantId],
  );
  return result.rows as ContextTypeRegistryEntry[];
}

/** Get only extractable types with their schemas and prompts. */
export async function getExtractableTypes(
  db: DbPool,
  tenantId: UUID,
): Promise<(ContextTypeRegistryEntry & { json_schema: Record<string, unknown> | null; extraction_prompt: string | null })[]> {
  const result = await db.query(
    `SELECT * FROM context_type_registry
     WHERE tenant_id = $1 AND is_extractable = true
     ORDER BY type_name`,
    [tenantId],
  );
  return result.rows as (ContextTypeRegistryEntry & { json_schema: Record<string, unknown> | null; extraction_prompt: string | null })[];
}

/** Get schema for a single context type (used for validation). */
export async function getContextTypeSchema(
  db: DbPool,
  typeName: string,
): Promise<Record<string, unknown> | null> {
  const result = await db.query(
    'SELECT json_schema FROM context_type_registry WHERE type_name = $1',
    [typeName],
  );
  return (result.rows[0]?.json_schema as Record<string, unknown>) ?? null;
}

export async function addContextType(
  db: DbPool,
  tenantId: UUID,
  data: { type_name: string; label: string; description?: string; json_schema?: Record<string, unknown>; extraction_prompt?: string; is_extractable?: boolean },
): Promise<ContextTypeRegistryEntry> {
  const result = await db.query(
    `INSERT INTO context_type_registry
       (type_name, tenant_id, label, description, is_default, json_schema, extraction_prompt, is_extractable)
     VALUES ($1, $2, $3, $4, FALSE, $5, $6, $7)
     RETURNING *`,
    [
      data.type_name,
      tenantId,
      data.label,
      data.description ?? null,
      data.json_schema ? JSON.stringify(data.json_schema) : null,
      data.extraction_prompt ?? null,
      data.is_extractable ?? false,
    ],
  );
  return result.rows[0] as ContextTypeRegistryEntry;
}

export async function removeContextType(
  db: DbPool,
  tenantId: UUID,
  typeName: string,
): Promise<boolean> {
  const result = await db.query(
    `DELETE FROM context_type_registry
     WHERE type_name = $1 AND tenant_id = $2 AND is_default = FALSE
     RETURNING type_name`,
    [typeName, tenantId],
  );
  return result.rows.length > 0;
}
