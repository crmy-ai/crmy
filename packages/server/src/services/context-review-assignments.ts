// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { Assignment, UUID } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';
import * as assignmentRepo from '../db/repos/assignments.js';
import { detectContradictions, type ContradictionWarning } from './contradictions.js';

function contradictionKey(warning: ContradictionWarning): string {
  const ids = [warning.entry_a.id, warning.entry_b.id].sort();
  return ids.join(':');
}

async function openContradictionAssignmentExists(
  db: DbPool,
  tenantId: UUID,
  key: string,
): Promise<boolean> {
  const result = await db.query(
    `SELECT id FROM assignments
     WHERE tenant_id = $1
       AND status NOT IN ('completed', 'declined', 'cancelled')
       AND metadata->>'contradiction_key' = $2
     LIMIT 1`,
    [tenantId, key],
  );
  return result.rows.length > 0;
}

function chooseAssignee(warning: ContradictionWarning): UUID {
  const confidenceA = warning.entry_a.confidence ?? 0.5;
  const confidenceB = warning.entry_b.confidence ?? 0.5;
  if (confidenceA !== confidenceB) {
    return confidenceA >= confidenceB ? warning.entry_a.authored_by : warning.entry_b.authored_by;
  }
  const createdA = new Date(warning.entry_a.created_at).getTime();
  const createdB = new Date(warning.entry_b.created_at).getTime();
  return createdA >= createdB ? warning.entry_a.authored_by : warning.entry_b.authored_by;
}

export async function createContradictionReviewAssignments(
  db: DbPool,
  tenantId: UUID,
  assignedBy: UUID,
  input: {
    subject_type: 'contact' | 'account' | 'opportunity' | 'use_case';
    subject_id: UUID;
    context_type?: string;
    limit?: number;
  },
): Promise<{ assignments: Assignment[]; warnings: ContradictionWarning[]; skipped_existing: number }> {
  const warnings = await detectContradictions(
    db,
    tenantId,
    input.subject_type,
    input.subject_id,
    input.context_type,
  );

  const assignments: Assignment[] = [];
  let skippedExisting = 0;

  for (const warning of warnings.slice(0, input.limit ?? 20)) {
    const key = contradictionKey(warning);
    if (await openContradictionAssignmentExists(db, tenantId, key)) {
      skippedExisting++;
      continue;
    }

    const entryALabel = warning.entry_a.title ?? warning.entry_a.context_type;
    const entryBLabel = warning.entry_b.title ?? warning.entry_b.context_type;
    const assignment = await assignmentRepo.createAssignment(db, tenantId, {
      title: `Resolve contradictory context: ${warning.conflict_field}`,
      description: `${warning.conflict_evidence}\n\nCompare "${entryALabel}" and "${entryBLabel}", then use context_resolve_contradiction or context_supersede to preserve the accurate current belief.`,
      assignment_type: 'contradiction_review',
      assigned_by: assignedBy,
      assigned_to: chooseAssignee(warning),
      subject_type: input.subject_type,
      subject_id: input.subject_id,
      priority: warning.suggested_action === 'manual_review' ? 'high' : 'normal',
      context: `${warning.entry_a.id}:${warning.entry_b.id}`,
      metadata: {
        contradiction_key: key,
        entry_a_id: warning.entry_a.id,
        entry_b_id: warning.entry_b.id,
        conflict_field: warning.conflict_field,
        conflict_evidence: warning.conflict_evidence,
        suggested_action: warning.suggested_action,
        context_type: warning.entry_a.context_type,
      },
    });
    assignments.push(assignment);
  }

  return { assignments, warnings, skipped_existing: skippedExisting };
}
