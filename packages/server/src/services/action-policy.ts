// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ActorContext, ContextEvidence } from '@crmy/shared';
import { validationError } from '@crmy/shared';

export type ActionPolicyDecision = 'allowed' | 'approval_required' | 'blocked' | 'draft_only';

export interface ActionPolicyResult {
  decision: ActionPolicyDecision;
  reasons: string[];
  required_approval?: boolean;
  required_evidence?: boolean;
  risk_level: 'low' | 'medium' | 'high';
  policy: string;
}

export interface ActionPolicyInput {
  action_type: string;
  object_type?: string;
  field_names?: string[];
  actor?: ActorContext;
  confidence?: number | null;
  evidence?: ContextEvidence[] | null;
  memory_status?: 'signal' | 'active' | 'rejected' | 'superseded';
  target_system_type?: string;
  source_authority?: string;
  approved?: boolean;
}

const HIGH_RISK_FIELDS: Record<string, Set<string>> = {
  opportunity: new Set(['forecast_cat']),
};

function hasEvidence(evidence?: ContextEvidence[] | null): boolean {
  return Array.isArray(evidence) && evidence.some(item =>
    Boolean(item.source_id || item.source_ref || item.source_url || item.snippet),
  );
}

function mergeDecision(
  current: ActionPolicyResult,
  next: Partial<ActionPolicyResult> & { decision: ActionPolicyDecision; reasons: string[] },
): ActionPolicyResult {
  const severity: Record<ActionPolicyDecision, number> = {
    allowed: 0,
    draft_only: 1,
    approval_required: 2,
    blocked: 3,
  };
  const riskSeverity = { low: 0, medium: 1, high: 2 } as const;
  const decision = severity[next.decision] > severity[current.decision] ? next.decision : current.decision;
  const risk_level = next.risk_level && riskSeverity[next.risk_level] > riskSeverity[current.risk_level]
    ? next.risk_level
    : current.risk_level;
  return {
    ...current,
    ...next,
    decision,
    risk_level,
    reasons: [...current.reasons, ...next.reasons],
    required_approval: current.required_approval || next.required_approval,
    required_evidence: current.required_evidence || next.required_evidence,
  };
}

/**
 * Central action boundary for agent and automation writes.
 *
 * CRMy lets agents infer freely, but actions that coordinate work, influence
 * forecast, or write to systems of record pass through this policy result.
 * The evaluator is intentionally deterministic and conservative; callers can
 * either block immediately or turn approval_required into a HITL request.
 */
export function evaluateActionPolicy(input: ActionPolicyInput): ActionPolicyResult {
  let result: ActionPolicyResult = {
    decision: 'allowed',
    reasons: [],
    risk_level: 'low',
    policy: 'crmy.action_policy.v1',
  };

  const fieldNames = new Set(input.field_names ?? []);
  const highRiskFields = input.object_type ? HIGH_RISK_FIELDS[input.object_type] : undefined;
  const touchedHighRisk = highRiskFields
    ? [...fieldNames].filter(field => highRiskFields.has(field))
    : [];

  if (touchedHighRisk.length > 0 && input.actor?.actor_type !== 'user' && !input.approved) {
    result = mergeDecision(result, {
      decision: 'approval_required',
      risk_level: 'high',
      required_approval: true,
      reasons: [
        `${input.object_type} field ${touchedHighRisk.join(', ')} influences forecast or execution and requires approval for non-user actors.`,
      ],
    });
  }

  if (input.action_type === 'context.signal_promote') {
    if (!hasEvidence(input.evidence)) {
      result = mergeDecision(result, {
        decision: 'blocked',
        risk_level: 'high',
        required_evidence: true,
        reasons: ['Signals need supporting evidence before they can become Current Memory.'],
      });
    }

    const confidence = input.confidence ?? 0;
    if (confidence < 0.7 && !input.approved) {
      result = mergeDecision(result, {
        decision: 'approval_required',
        risk_level: 'high',
        required_approval: true,
        reasons: [`Signal confidence is ${Math.round(confidence * 100)}%, below the 70% promotion threshold.`],
      });
    } else if (input.actor?.actor_type === 'agent' && confidence < 0.85 && !input.approved) {
      result = mergeDecision(result, {
        decision: 'approval_required',
        risk_level: 'medium',
        required_approval: true,
        reasons: [`Agent promotion requires review below 85% confidence; this Signal is ${Math.round(confidence * 100)}%.`],
      });
    }
  }

  if (input.memory_status === 'signal' && !input.approved && input.action_type !== 'context.signal_promote') {
    result = mergeDecision(result, {
      decision: 'approval_required',
      risk_level: 'medium',
      required_approval: true,
      reasons: ['Actions based on Signals require promotion or approval before they affect operational state.'],
    });
  }

  if (input.action_type === 'external.writeback') {
    if (input.source_authority === 'read_only') {
      result = mergeDecision(result, {
        decision: 'blocked',
        risk_level: 'high',
        reasons: ['The target mapping is read-only.'],
      });
    } else if ((input.source_authority === 'external' || input.source_authority === 'approval_required') && !input.approved) {
      result = mergeDecision(result, {
        decision: 'approval_required',
        risk_level: 'high',
        required_approval: true,
        reasons: [`${input.source_authority} source authority requires approval before external writeback.`],
      });
    }
  }

  if (result.reasons.length === 0) {
    result.reasons.push('Policy allows this action.');
  }

  return result;
}

export function assertActionPolicyAllowsMutation(result: ActionPolicyResult): void {
  if (result.decision === 'blocked') {
    throw validationError(`Action blocked by policy: ${result.reasons.join(' ')}`);
  }
  if (result.decision === 'approval_required') {
    throw validationError(`Action requires approval: ${result.reasons.join(' ')}`);
  }
  if (result.decision === 'draft_only') {
    throw validationError(`Action is draft-only by policy: ${result.reasons.join(' ')}`);
  }
}
