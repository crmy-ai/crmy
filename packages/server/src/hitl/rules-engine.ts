// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * HITL auto-approval rules engine.
 *
 * Rules are evaluated in descending priority order. The first matching rule wins.
 * A rule matches when:
 *   1. Its action_type is null (wildcard) or equals the request's action_type.
 *   2. Its condition is empty ({}) or the condition expression is satisfied
 *      against the action_payload.
 *
 * Condition format: { field: "path.to.value", op: "<|>|=|!=|contains", value: ... }
 *   - field   : dot-separated path into action_payload (e.g. "amount", "contact.tier")
 *   - op      : comparison operator
 *   - value   : the comparison target
 *
 * Multiple conditions can be provided as an array — all must match (AND logic).
 */

import type { DbPool } from '../db/pool.js';
import type { UUID } from '@crmy/shared';

interface RuleCondition {
  field: string;
  op: '<' | '>' | '=' | '!=' | 'contains' | 'not_contains';
  value: unknown;
}

interface ApprovalRule {
  id: UUID;
  name: string;
  action_type: string | null;
  condition: RuleCondition | RuleCondition[] | Record<string, never>;
  decision: 'approved' | 'rejected';
  priority: number;
}

type MatchResult =
  | { matched: true; decision: 'approved' | 'rejected'; rule_id: UUID; rule_name: string }
  | { matched: false };

function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function evaluateCondition(payload: unknown, cond: RuleCondition): boolean {
  const actual = getNestedValue(payload, cond.field);
  const expected = cond.value;

  switch (cond.op) {
    case '<':   return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
    case '>':   return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    case '=':   return actual === expected || String(actual) === String(expected);
    case '!=':  return actual !== expected && String(actual) !== String(expected);
    case 'contains':
      return typeof actual === 'string' && typeof expected === 'string' && actual.toLowerCase().includes(expected.toLowerCase());
    case 'not_contains':
      return typeof actual === 'string' && typeof expected === 'string' && !actual.toLowerCase().includes(expected.toLowerCase());
    default:    return false;
  }
}

function ruleMatches(rule: ApprovalRule, actionType: string, payload: unknown): boolean {
  // Check action_type
  if (rule.action_type && rule.action_type !== actionType) return false;

  // Check conditions
  const conds = rule.condition;
  if (!conds || Object.keys(conds).length === 0) return true; // empty = always match

  const condArray: RuleCondition[] = Array.isArray(conds) ? conds : [conds as RuleCondition];
  return condArray.every((c) => evaluateCondition(payload, c));
}

export async function evaluateApprovalRules(
  db: DbPool,
  tenantId: UUID,
  request: { action_type: string; action_payload: unknown },
): Promise<MatchResult> {
  const result = await db.query(
    `SELECT id, name, action_type, condition, decision, priority
     FROM hitl_approval_rules
     WHERE tenant_id = $1 AND is_active = true
     ORDER BY priority DESC, created_at ASC`,
    [tenantId],
  );

  for (const row of result.rows as ApprovalRule[]) {
    if (ruleMatches(row, request.action_type, request.action_payload)) {
      return {
        matched: true,
        decision: row.decision,
        rule_id: row.id,
        rule_name: row.name,
      };
    }
  }

  return { matched: false };
}
