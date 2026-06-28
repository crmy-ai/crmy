// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ContextLineage, ContextLineageEdge, ContextLineageNode, ContextLineageOutcome, UUID } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';

export interface ContextLineageQuery {
  subject_type?: string;
  subject_id?: string;
  context_entry_id?: string;
  signal_group_id?: string;
  source_id?: string;
}

function addNode(nodes: Map<string, ContextLineageNode>, node: ContextLineageNode): void {
  if (!nodes.has(node.id)) nodes.set(node.id, node);
}

function addEdge(edges: Map<string, ContextLineageEdge>, edge: ContextLineageEdge): void {
  if (edge.source === edge.target) return;
  if (!edges.has(edge.id)) edges.set(edge.id, edge);
}

function label(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function uuidLike(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
}

function lineageNodeIdForObject(objectType: string, objectId: string): string {
  if (objectType === 'context_entry') return `context:${objectId}`;
  if (objectType === 'hitl_request') return `handoff:${objectId}`;
  if (objectType === 'external_writeback') return `writeback:${objectId}`;
  if (objectType === 'activity') return `activity:${objectId}`;
  if (['account', 'contact', 'opportunity', 'use_case'].includes(objectType)) return `record:${objectType}:${objectId}`;
  return `${objectType}:${objectId}`;
}

function subjectKey(subjectType?: unknown, subjectId?: unknown): string | null {
  if (typeof subjectType !== 'string' || !uuidLike(subjectId)) return null;
  if (!['account', 'contact', 'opportunity', 'use_case'].includes(subjectType)) return null;
  return `${subjectType}:${subjectId}`;
}

function relationLabel(relation: string): string {
  return relation.replace(/_/g, ' ');
}

function metadataStringArray(metadata: unknown, key: string): string[] {
  if (!metadata || typeof metadata !== 'object') return [];
  const value = (metadata as Record<string, unknown>)[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function metadataRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function nestedMetadataRecord(value: unknown, keys: string[]): Record<string, unknown> | null {
  let current: unknown = value;
  for (const key of keys) {
    const record = metadataRecord(current);
    if (!record) return null;
    current = record[key];
  }
  return metadataRecord(current);
}

function nestedMetadataString(value: unknown, keys: string[]): string | null {
  let current: unknown = value;
  for (const key of keys) {
    const record = metadataRecord(current);
    if (!record) return null;
    current = record[key];
  }
  return typeof current === 'string' && current.trim() ? current : null;
}

function nestedMetadataStringArray(value: unknown, keys: string[]): string[] {
  let current: unknown = value;
  for (const key of keys) {
    const record = metadataRecord(current);
    if (!record) return [];
    current = record[key];
  }
  if (!Array.isArray(current)) return [];
  return current.filter((item): item is string => typeof item === 'string');
}

function nestedMetadataNumber(value: unknown, keys: string[]): number | null {
  let current: unknown = value;
  for (const key of keys) {
    const record = metadataRecord(current);
    if (!record) return null;
    current = record[key];
  }
  const numeric = typeof current === 'number' ? current : typeof current === 'string' ? Number(current) : NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function directMetadataString(value: unknown, key: string): string | null {
  const record = metadataRecord(value);
  const current = record?.[key];
  return typeof current === 'string' && current.trim() ? current : null;
}

function actionReceiptOrigin(event: Record<string, unknown>): string | null {
  return directMetadataString(event.metadata, 'origin')
    ?? directMetadataString(event.after_data, 'origin')
    ?? null;
}

function actionReceiptPresentation(event: Record<string, unknown>): {
  label: string;
  stage: 'action' | 'audit';
  display_order: number;
  description: string;
} {
  const eventType = String(event.event_type ?? '');
  const objectType = String(event.object_type ?? '');
  const origin = actionReceiptOrigin(event);

  if (origin === 'workflow' || eventType.startsWith('workflow.')) {
    return {
      label: 'Workflow action receipt',
      stage: 'action',
      display_order: 46,
      description: 'Workflow action produced with Action Context proof.',
    };
  }
  if (origin === 'sequence' || eventType.startsWith('sequence.')) {
    return {
      label: 'Sequence action receipt',
      stage: 'action',
      display_order: 46,
      description: 'Sequence action produced with Action Context proof.',
    };
  }
  if (eventType.startsWith('email.')) {
    return {
      label: 'Email action receipt',
      stage: 'action',
      display_order: 46,
      description: 'Customer email draft or send action produced with Action Context proof.',
    };
  }
  if (objectType === 'external_writeback' || eventType.startsWith('system_writeback.')) {
    return {
      label: 'Writeback audit receipt',
      stage: 'audit',
      display_order: 50,
      description: 'System-of-record writeback receipt tied to Action Context proof.',
    };
  }
  if (objectType === 'hitl_request' || eventType.startsWith('hitl.')) {
    return {
      label: 'Handoff audit receipt',
      stage: 'audit',
      display_order: 50,
      description: 'Handoff decision receipt tied to Action Context proof.',
    };
  }
  return {
    label: label(eventType, 'Action receipt'),
    stage: 'audit',
    display_order: 50,
    description: 'Action receipt produced after Action Context was retrieved.',
  };
}

function actionReceiptTargetIds(event: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  const objectType = typeof event.object_type === 'string' ? event.object_type : null;
  const objectId = typeof event.object_id === 'string' ? event.object_id : null;
  if (objectType && objectId && uuidLike(objectId)) {
    ids.add(lineageNodeIdForObject(objectType, objectId));
  }

  const metadataHitlId = directMetadataString(event.metadata, 'hitl_request_id');
  if (uuidLike(metadataHitlId)) ids.add(`handoff:${metadataHitlId}`);

  const afterData = metadataRecord(event.after_data);
  const afterHitlId = typeof afterData?.hitl_request_id === 'string' ? afterData.hitl_request_id : null;
  if (uuidLike(afterHitlId)) ids.add(`handoff:${afterHitlId}`);
  const actionPayload = metadataRecord(afterData?.action_payload);
  const payloadWritebackId = typeof actionPayload?.writeback_id === 'string' ? actionPayload.writeback_id : null;
  if (uuidLike(payloadWritebackId)) ids.add(`writeback:${payloadWritebackId}`);
  const payloadActivityId = typeof actionPayload?.activity_id === 'string' ? actionPayload.activity_id : null;
  if (uuidLike(payloadActivityId)) ids.add(`activity:${payloadActivityId}`);

  const afterActivityId = typeof afterData?.activity_id === 'string' ? afterData.activity_id : null;
  if (uuidLike(afterActivityId)) ids.add(`activity:${afterActivityId}`);

  return [...ids];
}

function lowerStatus(value: unknown): string {
  return String(value ?? '').toLowerCase();
}

function outcomeImpact(node: ContextLineageNode): ContextLineageOutcome['impact'] {
  const status = lowerStatus(node.status);
  if (['failed', 'rejected', 'cancelled', 'expired', 'delivery_uncertain'].includes(status)) return 'failed';
  if (['pending', 'approval_required', 'approved', 'executing', 'sending', 'queued_for_delivery'].includes(status)) return 'pending';
  if (['completed', 'sent', 'auto_approved', 'processed', 'resolved', 'success'].includes(status)) return 'completed';
  if (node.type === 'activity' && node.stage === 'action') return 'completed';
  if (node.type === 'audit' && node.stage === 'action') return 'completed';
  return 'informational';
}

function outcomeKind(node: ContextLineageNode): ContextLineageOutcome['kind'] | null {
  if (node.type === 'handoff') return 'handoff';
  if (node.type === 'writeback') return 'writeback';
  if (node.type === 'activity' && node.stage === 'action') return 'activity';
  if (node.type === 'audit' && node.stage === 'action') return 'action_receipt';
  if (node.type === 'audit') return 'audit';
  return null;
}

function outcomeFollowUp(node: ContextLineageNode, impact: ContextLineageOutcome['impact']): string | undefined {
  if (impact === 'pending') {
    if (node.type === 'handoff') return 'A human decision is still needed before the related action should proceed.';
    if (node.type === 'writeback') return 'Check approval/execution status before assuming the external system changed.';
    return 'Check the action status before continuing dependent work.';
  }
  if (impact === 'failed') {
    if (node.type === 'writeback') return 'Inspect the writeback error and retry only after the connector or payload issue is resolved.';
    if (node.type === 'handoff') return 'Review the rejection or expiry note before revising the action.';
    return 'Inspect the audit receipt and recover or retry from the Reliability surface if appropriate.';
  }
  if (impact === 'completed') {
    if (node.type === 'writeback') return 'Refresh the customer briefing or external sync before acting on the changed system-of-record state.';
    if (node.type === 'activity') return 'Use the resulting activity/context as CRMy-authored outcome evidence, not as a new customer statement.';
  }
  return undefined;
}

function buildLineageOutcomes(nodes: ContextLineageNode[]): NonNullable<ContextLineage['outcomes']> {
  const outcomes = nodes
    .map((node): ContextLineageOutcome | null => {
      const kind = outcomeKind(node);
      if (!kind) return null;
      const impact = outcomeImpact(node);
      return {
        kind,
        label: node.label,
        status: String(node.status ?? impact),
        occurred_at: node.timestamp ?? undefined,
        object_id: typeof node.object_id === 'string' ? node.object_id : undefined,
        node_id: node.id,
        impact,
        follow_up: outcomeFollowUp(node, impact),
      };
    })
    .filter((item): item is ContextLineageOutcome => Boolean(item))
    .sort((a, b) => String(b.occurred_at ?? '').localeCompare(String(a.occurred_at ?? '')));
  const pending = outcomes.filter(outcome => outcome.impact === 'pending');
  const failed = outcomes.filter(outcome => outcome.impact === 'failed');
  const completed = outcomes.filter(outcome => outcome.impact === 'completed');
  const recommended = [
    pending.length > 0 ? 'Resolve pending Handoffs, approvals, or queued writes before assuming the action is complete.' : undefined,
    failed.length > 0 ? 'Review failed outcomes in Handoffs, Systems of Record, Email, or Reliability before retrying dependent work.' : undefined,
    completed.length > 0 ? 'Refresh briefing or Action Context after completed outcomes so the next agent works from updated state.' : undefined,
    outcomes.length === 0 ? 'No downstream action outcomes were found for this lineage query yet.' : undefined,
  ].filter((item): item is string => Boolean(item));
  return {
    recent: outcomes.slice(0, 12),
    pending: pending.slice(0, 12),
    failed: failed.slice(0, 12),
    completed_count: completed.length,
    pending_count: pending.length,
    failed_count: failed.length,
    recommended_follow_up: recommended,
  };
}

export async function getContextLineage(
  db: DbPool,
  tenantId: UUID | string,
  query: ContextLineageQuery,
): Promise<ContextLineage> {
  const nodes = new Map<string, ContextLineageNode>();
  const edges = new Map<string, ContextLineageEdge>();
  const contextRows: Record<string, unknown>[] = [];

  const contextConditions = ['tenant_id = $1'];
  const contextParams: unknown[] = [tenantId];
  let idx = 2;

  if (query.context_entry_id) {
    contextConditions.push(`id = $${idx++}`);
    contextParams.push(query.context_entry_id);
  } else if (query.subject_type && query.subject_id) {
    contextConditions.push(`subject_type = $${idx++}`);
    contextParams.push(query.subject_type);
    contextConditions.push(`subject_id = $${idx++}`);
    contextParams.push(query.subject_id);
  } else if (query.source_id) {
    const source = await db.query(
      `SELECT * FROM raw_context_sources WHERE tenant_id = $1 AND id = $2`,
      [tenantId, query.source_id],
    );
    const row = source.rows[0];
    if (row?.subject_type && row?.subject_id) {
      contextConditions.push(`subject_type = $${idx++}`);
      contextParams.push(row.subject_type);
      contextConditions.push(`subject_id = $${idx++}`);
      contextParams.push(row.subject_id);
    }
    if (uuidLike(row?.source_ref)) {
      contextConditions.push(`source_activity_id = $${idx++}`);
      contextParams.push(row.source_ref);
    }
  } else if (query.signal_group_id) {
    const members = await db.query(
      `SELECT context_entry_id FROM signal_group_members WHERE tenant_id = $1 AND signal_group_id = $2`,
      [tenantId, query.signal_group_id],
    );
    const ids = members.rows.map(row => row.context_entry_id).filter(Boolean);
    if (ids.length > 0) {
      contextConditions.push(`id = ANY($${idx++}::uuid[])`);
      contextParams.push(ids);
    }
  }

  if (contextConditions.length === 1 && !query.signal_group_id && !query.source_id) {
    contextConditions.push('created_at > now() - interval \'30 days\'');
  }

  contextParams.push(100);
  const contextEntries = await db.query(
    `SELECT *
     FROM context_entries
     WHERE ${contextConditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${idx}`,
    contextParams,
  );

  const contextIds = new Set<string>();
  const activityIds = new Set<string>();
  for (const entry of contextEntries.rows) {
    contextRows.push(entry);
    contextIds.add(entry.id);
    const type = entry.memory_status === 'active' ? 'memory' : 'signal';
    addNode(nodes, {
      id: `context:${entry.id}`,
      type,
      label: label(entry.title, type === 'memory' ? 'Memory' : 'Signal'),
      timestamp: entry.created_at,
      status: entry.memory_status,
      subject_type: entry.subject_type,
      subject_id: entry.subject_id,
      object_id: entry.id,
      stage: type,
      display_order: type === 'memory' ? 30 : 20,
      description: type === 'memory'
        ? 'Confirmed Memory that agents can retrieve into Active Context.'
        : 'Evidence-backed Signal extracted from Source.',
      data: entry,
    });
    if (uuidLike(entry.source_activity_id)) activityIds.add(entry.source_activity_id);
  }

  const groupConditions = ['sg.tenant_id = $1'];
  const groupParams: unknown[] = [tenantId];
  let groupIdx = 2;
  if (query.signal_group_id) {
    groupConditions.push(`sg.id = $${groupIdx++}`);
    groupParams.push(query.signal_group_id);
  } else if (contextIds.size > 0) {
    groupConditions.push(`(sgm.context_entry_id = ANY($${groupIdx}::uuid[]) OR sg.promoted_context_entry_id = ANY($${groupIdx}::uuid[]))`);
    groupParams.push([...contextIds]);
    groupIdx++;
  } else if (query.subject_type && query.subject_id) {
    groupConditions.push(`sg.subject_type = $${groupIdx++}`);
    groupParams.push(query.subject_type);
    groupConditions.push(`sg.subject_id = $${groupIdx++}`);
    groupParams.push(query.subject_id);
  }
  groupParams.push(100);
  const groups = await db.query(
    `SELECT DISTINCT sg.*
     FROM signal_groups sg
     LEFT JOIN signal_group_members sgm ON sgm.signal_group_id = sg.id AND sgm.tenant_id = sg.tenant_id
     WHERE ${groupConditions.join(' AND ')}
     ORDER BY sg.updated_at DESC
     LIMIT $${groupIdx}`,
    groupParams,
  );
  const groupIds = new Set<string>();
  const promotedContextIds = new Set<string>();
  for (const group of groups.rows) {
    groupIds.add(group.id);
    addNode(nodes, {
      id: `signal_group:${group.id}`,
      type: 'signal_group',
      label: label(group.title, group.normalized_claim ?? 'Signal'),
      timestamp: group.updated_at,
      status: group.status,
      subject_type: group.subject_type,
      subject_id: group.subject_id,
      object_id: group.id,
      stage: 'signal',
      display_order: 25,
      description: `${Math.round(Number(group.aggregate_confidence ?? 0) * 100)}% trust from ${Number(group.evidence_count ?? 0)} evidence item${Number(group.evidence_count ?? 0) === 1 ? '' : 's'}.`,
      data: group,
    });
    if (group.promoted_context_entry_id) {
      promotedContextIds.add(group.promoted_context_entry_id);
      addEdge(edges, {
        id: `group-promoted:${group.id}:${group.promoted_context_entry_id}`,
        source: `signal_group:${group.id}`,
        target: `context:${group.promoted_context_entry_id}`,
        relation: 'promoted_to_memory',
      });
    }
  }

  const missingPromotedIds = [...promotedContextIds].filter(id => !contextIds.has(id));
  if (missingPromotedIds.length > 0) {
    const promotedEntries = await db.query(
      `SELECT *
       FROM context_entries
       WHERE tenant_id = $1 AND id = ANY($2::uuid[])
       ORDER BY created_at DESC
       LIMIT 100`,
      [tenantId, missingPromotedIds],
    );
    for (const entry of promotedEntries.rows) {
      contextRows.push(entry);
      contextIds.add(entry.id);
      const type = entry.memory_status === 'active' ? 'memory' : 'signal';
      addNode(nodes, {
        id: `context:${entry.id}`,
        type,
        label: label(entry.title, type === 'memory' ? 'Memory' : 'Signal'),
        timestamp: entry.created_at,
        status: entry.memory_status,
        subject_type: entry.subject_type,
        subject_id: entry.subject_id,
        object_id: entry.id,
        stage: type,
        display_order: type === 'memory' ? 30 : 20,
        description: type === 'memory'
          ? 'Confirmed Memory that agents can retrieve into Active Context.'
          : 'Evidence-backed Signal extracted from Source.',
        data: entry,
      });
      if (uuidLike(entry.source_activity_id)) activityIds.add(entry.source_activity_id);
    }
  }

  if (groupIds.size > 0) {
    const members = await db.query(
      `SELECT signal_group_id, context_entry_id, relation, similarity_score
       FROM signal_group_members
       WHERE tenant_id = $1 AND signal_group_id = ANY($2::uuid[])`,
      [tenantId, [...groupIds]],
    );
    for (const member of members.rows) {
      addEdge(edges, {
        id: `member:${member.signal_group_id}:${member.context_entry_id}`,
        source: `context:${member.context_entry_id}`,
        target: `signal_group:${member.signal_group_id}`,
        relation: member.relation,
        data: { similarity_score: member.similarity_score, label: relationLabel(String(member.relation)) },
      });
    }
  }

  if (activityIds.size > 0) {
    const activities = await db.query(
      `SELECT id, type, subject, body, outcome, occurred_at, subject_type, subject_id
       FROM activities
       WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, [...activityIds]],
    );
    for (const activity of activities.rows) {
      addNode(nodes, {
        id: `activity:${activity.id}`,
        type: 'activity',
        label: label(activity.subject, label(activity.body, activity.type ?? 'Activity')),
        timestamp: activity.occurred_at,
        status: activity.type,
        subject_type: activity.subject_type,
        subject_id: activity.subject_id,
        object_id: activity.id,
        stage: 'source',
        display_order: 12,
        description: 'Recorded customer interaction used as extraction provenance.',
        data: activity,
      });
    }
    for (const entry of contextRows) {
      if (uuidLike(entry.source_activity_id)) {
        addEdge(edges, {
          id: `activity-context:${entry.source_activity_id}:${entry.id}`,
          source: `activity:${entry.source_activity_id}`,
          target: `context:${entry.id}`,
          relation: 'extracted_signal',
        });
      }
    }
  }

  const rawConditions = ['tenant_id = $1'];
  const rawParams: unknown[] = [tenantId];
  let rawIdx = 2;
  if (query.source_id) {
    rawConditions.push(`id = $${rawIdx++}`);
    rawParams.push(query.source_id);
  } else if (query.subject_type && query.subject_id) {
    rawConditions.push(`subject_type = $${rawIdx++}`);
    rawParams.push(query.subject_type);
    rawConditions.push(`subject_id = $${rawIdx++}`);
    rawParams.push(query.subject_id);
  } else if (activityIds.size > 0) {
    rawConditions.push(`source_ref = ANY($${rawIdx++}::text[])`);
    rawParams.push([...activityIds]);
  }
  rawParams.push(50);
  const rawSources = await db.query(
    `SELECT *
     FROM raw_context_sources
     WHERE ${rawConditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${rawIdx}`,
    rawParams,
  );
  for (const source of rawSources.rows) {
    addNode(nodes, {
      id: `raw:${source.id}`,
      type: 'raw_context',
      label: label(source.source_label, source.source_type ?? 'Source'),
      timestamp: source.created_at,
      status: source.status,
      subject_type: source.subject_type,
      subject_id: source.subject_id,
      object_id: source.id,
      stage: 'source',
      display_order: 10,
      description: `${Number(source.memory_created ?? 0)} Memory, ${Number(source.signals_created ?? 0)} Signals, ${Number(source.skipped ?? 0)} skipped.`,
      data: source,
    });
    if (uuidLike(source.source_ref)) {
      addEdge(edges, {
        id: `raw-activity:${source.id}:${source.source_ref}`,
        source: `raw:${source.id}`,
        target: `activity:${source.source_ref}`,
        relation: 'recorded_as_activity',
      });
    }
  }

  if (groupIds.size > 0) {
    const handoffs = await db.query(
      `SELECT id, action_type, action_summary, action_payload, status, created_at, resolved_at
       FROM hitl_requests
       WHERE tenant_id = $1
         AND action_payload->>'signal_group_id' = ANY($2::text[])
       ORDER BY created_at DESC
       LIMIT 50`,
      [tenantId, [...groupIds]],
    );
    for (const handoff of handoffs.rows) {
      const groupId = handoff.action_payload?.signal_group_id;
      addNode(nodes, {
        id: `handoff:${handoff.id}`,
        type: 'handoff',
        label: label(handoff.action_summary, 'Handoff'),
        timestamp: handoff.created_at,
        status: handoff.status,
        object_id: handoff.id,
        stage: 'action',
        display_order: 40,
        description: 'Human review for a Signal, writeback, or high-impact agent decision.',
        data: handoff,
      });
      if (groupId) {
        addEdge(edges, {
          id: `group-handoff:${groupId}:${handoff.id}`,
          source: `signal_group:${groupId}`,
          target: `handoff:${handoff.id}`,
          relation: 'sent_to_handoff',
        });
      }
    }
  }

  const handoffIds = new Set<string>();
  for (const node of nodes.values()) {
    if (node.type === 'handoff' && uuidLike(node.object_id)) handoffIds.add(node.object_id);
  }

  const writebacks = await db.query(
    `SELECT id, object_type, object_id, external_object, operation, status, hitl_request_id, created_at, executed_at
     FROM external_writeback_requests
     WHERE tenant_id = $1
       AND (
         ($2::text IS NOT NULL AND object_type = $2 AND object_id = $3::uuid)
         OR ($4::uuid[] IS NOT NULL AND object_id = ANY($4::uuid[]))
         OR ($5::uuid[] IS NOT NULL AND hitl_request_id = ANY($5::uuid[]))
       )
     ORDER BY created_at DESC
     LIMIT 50`,
    [tenantId, query.subject_type ?? null, query.subject_id ?? null, [...contextIds], [...handoffIds]],
  ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
  for (const writeback of writebacks.rows) {
    addNode(nodes, {
      id: `writeback:${writeback.id}`,
      type: 'writeback',
      label: `${writeback.operation ?? 'writeback'} ${writeback.external_object ?? 'system record'}`,
      timestamp: writeback.executed_at ?? writeback.created_at,
      status: String(writeback.status ?? ''),
      subject_type: writeback.object_type as never,
      subject_id: writeback.object_id as never,
      object_id: writeback.id as never,
      stage: 'action',
      display_order: 45,
      description: 'Governed system-of-record writeback request or execution.',
      data: writeback,
    });
    if (uuidLike(writeback.hitl_request_id)) {
      handoffIds.add(writeback.hitl_request_id);
      addEdge(edges, {
        id: `handoff-writeback:${writeback.hitl_request_id}:${writeback.id}`,
        source: `handoff:${writeback.hitl_request_id}`,
        target: `writeback:${writeback.id}`,
        relation: 'approved_writeback',
        data: { label: 'approved' },
      });
    }
    if (uuidLike(writeback.object_id)) {
      const contextNodeId = `context:${writeback.object_id}`;
      const recordNodeId = `record:${writeback.object_type}:${writeback.object_id}`;
      const sourceNodeId = nodes.has(contextNodeId) ? contextNodeId : recordNodeId;
      addEdge(edges, {
        id: `writeback-target:${sourceNodeId}:${writeback.id}`,
        source: sourceNodeId,
        target: `writeback:${writeback.id}`,
        relation: 'requested_writeback',
        data: { label: 'written back' },
      });
    }
  }

  const missingHandoffIds = [...handoffIds].filter(id => !nodes.has(`handoff:${id}`));
  if (missingHandoffIds.length > 0) {
    const linkedHandoffs = await db.query(
      `SELECT id, action_type, action_summary, action_payload, status, created_at, resolved_at
       FROM hitl_requests
       WHERE tenant_id = $1 AND id = ANY($2::uuid[])
       ORDER BY created_at DESC
       LIMIT 50`,
      [tenantId, missingHandoffIds],
    ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
    for (const handoff of linkedHandoffs.rows) {
      addNode(nodes, {
        id: `handoff:${handoff.id}`,
        type: 'handoff',
        label: label(handoff.action_summary, 'Handoff'),
        timestamp: handoff.created_at,
        status: handoff.status,
        object_id: handoff.id,
        stage: 'action',
        display_order: 40,
        description: 'Human review for a Signal, writeback, or high-impact agent decision.',
        data: handoff,
      });
    }
  }

  const retrievalClauses: string[] = [];
  const retrievalParams: unknown[] = [tenantId];
  let retrievalIdx = 2;
  if (query.subject_type && query.subject_id) {
    retrievalClauses.push(`(object_type = $${retrievalIdx++} AND object_id = $${retrievalIdx++}::uuid)`);
    retrievalParams.push(query.subject_type, query.subject_id);
  }
  if (contextIds.size > 0) {
    retrievalClauses.push(`(metadata->'used_context_entry_ids' ?| $${retrievalIdx++}::text[])`);
    retrievalParams.push([...contextIds]);
  }
  if (groupIds.size > 0) {
    retrievalClauses.push(`(metadata->'used_signal_group_ids' ?| $${retrievalIdx++}::text[])`);
    retrievalParams.push([...groupIds]);
  }
  if (retrievalClauses.length > 0) {
    retrievalParams.push(50);
    const retrievalEvents = await db.query(
      `SELECT id, event_type, actor_id, actor_type, object_type, object_id, after_data, metadata, created_at
       FROM events
       WHERE tenant_id = $1
         AND event_type = 'action_context.retrieved'
         AND (${retrievalClauses.join(' OR ')})
       ORDER BY created_at DESC
       LIMIT $${retrievalIdx}`,
      retrievalParams,
    ).catch(() => ({ rows: [] as Record<string, unknown>[] }));

    for (const event of retrievalEvents.rows) {
      const objectType = String(event.object_type);
      const objectId = typeof event.object_id === 'string' ? event.object_id : null;
      addNode(nodes, {
        id: `retrieval:${event.id}`,
        type: 'retrieval',
        label: 'Action Context retrieved',
        timestamp: event.created_at as string,
        status: typeof event.metadata === 'object' && event.metadata
          ? String((event.metadata as Record<string, unknown>).readiness_status ?? 'retrieved')
          : 'retrieved',
        subject_type: subjectKey(objectType, objectId) ? objectType as never : undefined,
        subject_id: objectId as never,
        object_id: String(event.id),
        stage: 'active_context',
        display_order: 35,
        description: 'Briefing, policy, source authority, and readiness checks loaded into Active Context.',
        data: event,
      });
      for (const contextId of metadataStringArray(event.metadata, 'used_context_entry_ids')) {
        addEdge(edges, {
          id: `context-retrieval:${contextId}:${event.id}`,
          source: `context:${contextId}`,
          target: `retrieval:${event.id}`,
          relation: 'loaded_into_active_context',
          data: { label: 'loaded' },
        });
      }
      for (const groupId of metadataStringArray(event.metadata, 'used_signal_group_ids')) {
        addEdge(edges, {
          id: `signal-group-retrieval:${groupId}:${event.id}`,
          source: `signal_group:${groupId}`,
          target: `retrieval:${event.id}`,
          relation: 'loaded_into_active_context',
          data: { label: 'loaded' },
        });
      }
    }
  }

  const actionReceiptClauses: string[] = [];
  const actionReceiptParams: unknown[] = [tenantId];
  let actionReceiptIdx = 2;
  if (query.subject_type && query.subject_id) {
    actionReceiptClauses.push(`(
      metadata->'action_context'->>'subject_type' = $${actionReceiptIdx++}
      AND metadata->'action_context'->>'subject_id' = $${actionReceiptIdx++}
    )`);
    actionReceiptParams.push(query.subject_type, query.subject_id);
  }
  if (contextIds.size > 0) {
    actionReceiptClauses.push(`(coalesce(metadata->'action_context'->'proof'->'used_context_entry_ids', '[]'::jsonb) ?| $${actionReceiptIdx++}::text[])`);
    actionReceiptParams.push([...contextIds]);
  }
  if (groupIds.size > 0) {
    actionReceiptClauses.push(`(coalesce(metadata->'action_context'->'proof'->'used_signal_group_ids', '[]'::jsonb) ?| $${actionReceiptIdx++}::text[])`);
    actionReceiptParams.push([...groupIds]);
  }
  if (actionReceiptClauses.length > 0) {
    actionReceiptParams.push(100);
    const actionReceiptEvents = await db.query(
      `SELECT id, event_type, actor_id, actor_type, object_type, object_id, after_data, metadata, created_at
       FROM events
       WHERE tenant_id = $1
         AND event_type <> 'action_context.retrieved'
         AND metadata ? 'action_context'
         AND (${actionReceiptClauses.join(' OR ')})
       ORDER BY created_at DESC
       LIMIT $${actionReceiptIdx}`,
      actionReceiptParams,
    ).catch(() => ({ rows: [] as Record<string, unknown>[] }));

    for (const event of actionReceiptEvents.rows) {
      const actionContext = nestedMetadataRecord(event.metadata, ['action_context']);
      const subjectType = nestedMetadataString(event.metadata, ['action_context', 'subject_type']);
      const subjectId = nestedMetadataString(event.metadata, ['action_context', 'subject_id']);
      const presentation = actionReceiptPresentation(event);
      const afterData = metadataRecord(event.after_data);
      if (event.object_type === 'hitl_request' && uuidLike(event.object_id)) {
        addNode(nodes, {
          id: `handoff:${event.object_id}`,
          type: 'handoff',
          label: label(afterData?.action_summary, 'Handoff'),
          timestamp: typeof afterData?.created_at === 'string' ? afterData.created_at : event.created_at as string,
          status: typeof afterData?.status === 'string' ? afterData.status : String(event.event_type ?? 'handoff'),
          object_id: String(event.object_id),
          stage: 'action',
          display_order: 40,
          description: 'Human review for a Signal, writeback, or high-impact agent decision.',
          data: afterData ?? event,
        });
      }
      if (event.object_type === 'external_writeback' && uuidLike(event.object_id)) {
        addNode(nodes, {
          id: `writeback:${event.object_id}`,
          type: 'writeback',
          label: `${afterData?.operation ?? 'writeback'} ${afterData?.external_object ?? 'system record'}`,
          timestamp: typeof afterData?.executed_at === 'string'
            ? afterData.executed_at
            : typeof afterData?.created_at === 'string'
              ? afterData.created_at
              : event.created_at as string,
          status: typeof afterData?.status === 'string' ? afterData.status : String(event.event_type ?? 'writeback'),
          subject_type: typeof afterData?.object_type === 'string' ? afterData.object_type as never : undefined,
          subject_id: uuidLike(afterData?.object_id) ? afterData.object_id as never : undefined,
          object_id: String(event.object_id),
          stage: 'action',
          display_order: 45,
          description: 'Governed system-of-record writeback request or execution.',
          data: afterData ?? event,
        });
      }
      if (uuidLike(afterData?.activity_id)) {
        addNode(nodes, {
          id: `activity:${afterData.activity_id}`,
          type: 'activity',
          label: 'Activity created by action',
          timestamp: event.created_at as string,
          status: String(event.event_type ?? 'activity'),
          object_id: afterData.activity_id,
          stage: 'action',
          display_order: 46,
          description: 'Customer activity created by an approved or automated action.',
          data: { id: afterData.activity_id, source_event: event },
        });
      }
      addNode(nodes, {
        id: `audit:${event.id}`,
        type: 'audit',
        label: presentation.label,
        timestamp: event.created_at as string,
        status: String(event.object_type ?? 'action'),
        subject_type: subjectKey(subjectType, subjectId) ? subjectType as never : undefined,
        subject_id: subjectKey(subjectType, subjectId) ? subjectId as never : undefined,
        object_id: String(event.id),
        stage: presentation.stage,
        display_order: presentation.display_order,
        description: presentation.description,
        data: event,
      });

      const retrievalEventId = nestedMetadataNumber(actionContext, ['proof', 'retrieval_event_id']);
      if (retrievalEventId !== null && nodes.has(`retrieval:${retrievalEventId}`)) {
        addEdge(edges, {
          id: `retrieval-action-receipt:${retrievalEventId}:${event.id}`,
          source: `retrieval:${retrievalEventId}`,
          target: `audit:${event.id}`,
          relation: 'informed_action',
          data: { label: 'informed action' },
        });
      }
      for (const targetNodeId of actionReceiptTargetIds(event)) {
        if (!nodes.has(targetNodeId)) continue;
        if (retrievalEventId !== null && nodes.has(`retrieval:${retrievalEventId}`)) {
          addEdge(edges, {
            id: `retrieval-action-target:${retrievalEventId}:${targetNodeId}`,
            source: `retrieval:${retrievalEventId}`,
            target: targetNodeId,
            relation: 'informed_action',
            data: { label: 'informed action' },
          });
        }
        addEdge(edges, {
          id: `action-target-receipt:${targetNodeId}:${event.id}`,
          source: targetNodeId,
          target: `audit:${event.id}`,
          relation: 'receipted',
          data: { label: 'receipt' },
        });
      }
      for (const contextId of nestedMetadataStringArray(actionContext, ['proof', 'used_context_entry_ids'])) {
        addEdge(edges, {
          id: `context-action-proof:${contextId}:${event.id}`,
          source: `context:${contextId}`,
          target: `audit:${event.id}`,
          relation: 'used_as_proof',
          data: { label: 'used as proof' },
        });
      }
      for (const groupId of nestedMetadataStringArray(actionContext, ['proof', 'used_signal_group_ids'])) {
        addEdge(edges, {
          id: `signal-group-action-proof:${groupId}:${event.id}`,
          source: `signal_group:${groupId}`,
          target: `audit:${event.id}`,
          relation: 'used_as_proof',
          data: { label: 'used as proof' },
        });
      }
    }
  }

  const subjectPairs = new Set<string>();
  if (query.subject_type && query.subject_id) {
    const key = subjectKey(query.subject_type, query.subject_id);
    if (key) subjectPairs.add(key);
  }
  for (const node of nodes.values()) {
    const key = subjectKey(node.subject_type, node.subject_id);
    if (key) subjectPairs.add(key);
  }

  const recordLabels = new Map<string, { label: string; data: Record<string, unknown> }>();
  const idsByType = new Map<string, string[]>();
  for (const key of subjectPairs) {
    const [type, id] = key.split(':');
    idsByType.set(type, [...(idsByType.get(type) ?? []), id]);
  }
  async function loadLabels(type: string, sql: string, ids: string[]) {
    if (ids.length === 0) return;
    const result = await db.query(sql, [tenantId, ids]).catch(() => ({ rows: [] as Record<string, unknown>[] }));
    for (const row of result.rows) {
      const id = String(row.id);
      recordLabels.set(`${type}:${id}`, {
        label: label(row.name, type.replace('_', ' ')),
        data: row,
      });
    }
  }
  await loadLabels('account', 'SELECT id, name, domain, health_score, created_at FROM accounts WHERE tenant_id = $1 AND id = ANY($2::uuid[])', idsByType.get('account') ?? []);
  await loadLabels('opportunity', 'SELECT id, name, stage, amount, close_date, created_at FROM opportunities WHERE tenant_id = $1 AND id = ANY($2::uuid[])', idsByType.get('opportunity') ?? []);
  await loadLabels('use_case', 'SELECT id, name, stage, health_score, created_at FROM use_cases WHERE tenant_id = $1 AND id = ANY($2::uuid[])', idsByType.get('use_case') ?? []);
  const contactIds = idsByType.get('contact') ?? [];
  if (contactIds.length > 0) {
    const contacts = await db.query(
      `SELECT id, first_name, last_name, email, lifecycle_stage, created_at,
              trim(concat(coalesce(first_name, ''), ' ', coalesce(last_name, ''))) AS name
       FROM contacts
       WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, contactIds],
    ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
    for (const row of contacts.rows) {
      const id = String(row.id);
      recordLabels.set(`contact:${id}`, {
        label: label(row.name, label(row.email, 'Contact')),
        data: row,
      });
    }
  }

  for (const key of subjectPairs) {
    const [type, id] = key.split(':');
    const record = recordLabels.get(key);
    addNode(nodes, {
      id: `record:${type}:${id}`,
      type: 'record',
      label: record?.label ?? type.replace('_', ' '),
      timestamp: typeof record?.data.created_at === 'string' ? record.data.created_at : undefined,
      status: type,
      subject_type: type as never,
      subject_id: id as never,
      object_id: id,
      stage: 'record',
      display_order: 0,
      description: 'Customer record this lineage is attached to.',
      data: record?.data ?? { id, type },
    });
  }

  for (const node of [...nodes.values()]) {
    if (node.type === 'record') continue;
    const key = subjectKey(node.subject_type, node.subject_id);
    if (!key) continue;
    addEdge(edges, {
      id: `record-node:${key}:${node.id}`,
      source: `record:${key}`,
      target: node.id,
      relation: 'about_record',
      data: { label: 'about' },
    });
  }

  const objectIds = [...nodes.values()]
    .map(node => node.object_id)
    .filter(uuidLike);
  if (objectIds.length > 0) {
    const events = await db.query(
      `SELECT id, event_type, object_type, object_id, metadata, created_at
       FROM events
       WHERE tenant_id = $1
         AND object_id = ANY($2::uuid[])
         AND event_type <> 'action_context.retrieved'
       ORDER BY created_at DESC
       LIMIT 100`,
      [tenantId, objectIds],
    );
    for (const event of events.rows) {
      addNode(nodes, {
        id: `audit:${event.id}`,
        type: 'audit',
        label: event.event_type,
        timestamp: event.created_at,
        status: event.object_type,
        object_id: String(event.id),
        stage: 'audit',
        display_order: 50,
        description: 'Immutable audit receipt for this lineage item.',
        data: event,
      });
      const target = lineageNodeIdForObject(String(event.object_type), String(event.object_id));
      addEdge(edges, {
        id: `audit-edge:${event.id}:${event.object_id}`,
        source: target,
        target: `audit:${event.id}`,
        relation: 'audits',
        data: { label: 'audited' },
      });
    }
  }

  const nodeList = [...nodes.values()];
  const outcomes = buildLineageOutcomes(nodeList);
  return {
    nodes: nodeList,
    edges: [...edges.values()].filter(edge => nodes.has(edge.source) && nodes.has(edge.target)),
    outcomes,
    summary: {
      records: nodeList.filter(node => node.type === 'record').length,
      raw_context: nodeList.filter(node => node.type === 'raw_context').length,
      signals: nodeList.filter(node => node.type === 'signal').length,
      signal_groups: nodeList.filter(node => node.type === 'signal_group').length,
      memory: nodeList.filter(node => node.type === 'memory').length,
      retrievals: nodeList.filter(node => node.type === 'retrieval').length,
      action_receipts: nodeList.filter(node => node.type === 'audit' && node.stage === 'action').length,
      handoffs: nodeList.filter(node => node.type === 'handoff').length,
      writebacks: nodeList.filter(node => node.type === 'writeback').length,
      audit_events: nodeList.filter(node => node.type === 'audit').length,
    },
  };
}
