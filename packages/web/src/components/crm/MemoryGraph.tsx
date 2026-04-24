// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import '@xyflow/react/dist/style.css';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  useReactFlow,
  type Node,
  type Edge,
} from '@xyflow/react';
import { useMemo, useEffect, useRef, useCallback } from 'react';
import { useBriefing } from '@/api/hooks';
import { useAppStore } from '@/store/appStore';
import { TYPE_COLORS } from './ContextPanel';
import {
  Loader2,
  Users, Building2, Briefcase, FolderKanban,
  Phone, Mail, Calendar, FileText, ClipboardList,
  Activity, Monitor, CheckSquare,
  type LucideIcon,
} from 'lucide-react';
import {
  ENTITY_HEX,
  ACTIVITY_COLORS,
  PRIORITY_COLORS,
  type GraphNodeData,
  type FilterCounts,
} from './GraphSidebar';

// ── Types ─────────────────────────────────────────────────────────────────────

interface MemoryGraphProps {
  subjectType:         string;
  subjectId:           string;
  subjectName:         string;
  selectedNodeId:      string | null;
  onNodeSelect:        (id: string | null, data: GraphNodeData | null) => void;
  activeFilters:       Set<string>;
  fitViewRef:          React.MutableRefObject<(() => void) | null>;
  onFilterCounts:      (counts: FilterCounts) => void;
  /** When provided, clicking a relatedNode re-centers the graph on that entity instead of opening the drawer. */
  onNavigateToEntity?: (type: string, id: string, name: string) => void;
}

// ── Layout helper ─────────────────────────────────────────────────────────────

function radialPos(
  cx: number, cy: number, r: number,
  i: number, total: number,
  startAngle = -Math.PI / 2,
  arcSpan = 2 * Math.PI,
) {
  const step = total <= 1 ? 0 : arcSpan / total;
  const angle = startAngle + i * step;
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

function flattenRelated(related: Record<string, unknown[]>) {
  const typeMap: Record<string, string> = {
    accounts: 'account', contacts: 'contact',
    opportunities: 'opportunity', use_cases: 'use_case',
  };
  const result: Array<{ type: string; id: string; name: string }> = [];
  for (const [key, items] of Object.entries(related)) {
    const type = typeMap[key] ?? key;
    for (const item of (items ?? []) as Record<string, unknown>[]) {
      const name = (item.name
        ?? item.display_name
        ?? [item.first_name, item.last_name].filter(Boolean).join(' ')
        ?? item.email
        ?? 'Unknown') as string;
      result.push({ type, id: item.id as string, name });
    }
  }
  return result;
}

function getCategoryForNodeType(type: string | undefined): string {
  if (type === 'relatedNode')                       return 'related';
  if (type === 'clusterNode' || type === 'leafNode') return 'context';
  if (type === 'activityNode')                      return 'activities';
  if (type === 'assignmentNode')                    return 'assignments';
  return 'entity';
}

// ── Graph builder ─────────────────────────────────────────────────────────────

function buildGraph(briefing: Record<string, unknown> | null, subjectType: string, subjectName: string, subjectId: string) {
  const nodes: Node<GraphNodeData>[] = [];
  const edges: Edge[] = [];
  const CX = 0, CY = 0;

  const contextEntries = (briefing?.context_entries ?? {}) as Record<string, Record<string, unknown>[]>;
  const typeKeys = Object.keys(contextEntries).slice(0, 10);
  const activities = ((briefing?.activities ?? []) as Record<string, unknown>[]).slice(0, 5);
  const assignments = ((briefing?.open_assignments ?? []) as Record<string, unknown>[]).slice(0, 3);
  const relatedObjects = flattenRelated((briefing?.related_objects ?? {}) as Record<string, unknown[]>);

  // ── Center entity ──
  nodes.push({
    id: 'entity',
    position: { x: CX, y: CY },
    type: 'entityNode',
    width: 60, height: 80,
    data: {
      nodeType: 'entityNode',
      label: subjectName || subjectType,
      color: ENTITY_HEX[subjectType] ?? '#6366f1',
      subjectType,
      entityId: subjectId,
      entityType: subjectType,
    },
  });

  // ── Zone 1: Related objects — right arc (r=200) ──
  relatedObjects.slice(0, 8).forEach((obj, i) => {
    const pos = radialPos(CX, CY, 200, i, Math.max(relatedObjects.length, 1), -Math.PI / 2, Math.PI);
    const color = ENTITY_HEX[obj.type] ?? '#94a3b8';
    const nodeId = `related-${obj.id}`;
    nodes.push({
      id: nodeId,
      position: pos,
      type: 'relatedNode',
      width: 40, height: 56,
      data: { nodeType: 'relatedNode', label: obj.name, color, entityType: obj.type, entityId: obj.id },
    });
    edges.push({
      id: `e-entity-${nodeId}`,
      source: 'entity', target: nodeId,
      style: { stroke: color, strokeWidth: 2, opacity: 0.5 },
    });
  });

  // ── Zone 2: Context type clusters — left arc (r=280) ──
  typeKeys.forEach((type, i) => {
    const pos = radialPos(CX, CY, 280, i, Math.max(typeKeys.length, 1), Math.PI / 2, Math.PI);
    const color = TYPE_COLORS[type] ?? '#94a3b8';
    const clusterId = `type-${type}`;
    const entries = contextEntries[type] ?? [];

    nodes.push({
      id: clusterId,
      position: pos,
      type: 'clusterNode',
      width: 80, height: 28,
      data: {
        nodeType: 'clusterNode',
        label: type.replace(/_/g, ' '),
        color,
        contextType: type,
        count: entries.length,
        entries: entries.slice(0, 6).map(e => ({
          id: e.id as string,
          title: e.title as string | undefined,
          body: (e.body ?? '') as string,
        })),
      },
    });
    edges.push({
      id: `e-entity-${clusterId}`,
      source: 'entity', target: clusterId,
      style: { stroke: color, strokeWidth: 1.5, opacity: 0.4 },
    });

    // Zone 3a: Leaf entries orbiting their cluster
    const leaves = entries.slice(0, 4);
    const parentAngle = Math.atan2(pos.y - CY, pos.x - CX);
    leaves.forEach((entry, j) => {
      const leafPos = radialPos(pos.x, pos.y, 90, j, Math.max(leaves.length, 1), parentAngle - Math.PI / 6, Math.PI / 3);
      const leafId = `entry-${entry.id as string}`;
      const now = new Date();
      const isStale = entry.valid_until ? new Date(entry.valid_until as string) < now : false;

      nodes.push({
        id: leafId,
        position: leafPos,
        type: 'leafNode',
        width: 12, height: 12,
        data: {
          nodeType: 'leafNode',
          label: ((entry.title ?? entry.body ?? '') as string).slice(0, 40) || type,
          color,
          contextType: type,
          body: entry.body as string,
          confidence: entry.confidence as number | undefined,
          tags: entry.tags as string[] | undefined,
          source: entry.source as string | undefined,
          createdAt: entry.created_at as string | undefined,
          isStale,
        },
      });
      edges.push({
        id: `e-${clusterId}-${leafId}`,
        source: clusterId, target: leafId,
        style: { stroke: color, strokeWidth: 1, opacity: 0.25 },
      });
    });
  });

  // ── Zone 3b: Activities — lower-left arc (r=170) ──
  activities.forEach((act, i) => {
    const pos = radialPos(CX, CY, 170, i, Math.max(activities.length, 1), Math.PI * 0.6, Math.PI * 0.5);
    const actType = ((act.type ?? act.activity_type ?? 'activity') as string);
    const color = ACTIVITY_COLORS[actType] ?? '#64748b';
    const actId = `activity-${act.id ?? i}`;

    nodes.push({
      id: actId,
      position: pos,
      type: 'activityNode',
      width: 32, height: 32,
      data: {
        nodeType: 'activityNode',
        label: actType.replace(/_/g, ' '),
        color,
        activityType: actType,
        subject: act.subject as string | undefined,
        body: (act.body ?? act.description) as string | undefined,
        outcome: act.outcome as string | undefined,
        occurredAt: (act.occurred_at ?? act.created_at) as string | undefined,
      },
    });
    edges.push({
      id: `e-act-${actId}`,
      source: actId, target: 'entity',
      style: { stroke: '#64748b', strokeWidth: 1, strokeDasharray: '3 4', opacity: 0.3 },
    });
  });

  // ── Zone 3c: Assignments — lower-right arc (r=170) ──
  assignments.forEach((asgn, i) => {
    const pos = radialPos(CX, CY, 170, i, Math.max(assignments.length, 1), Math.PI * 0.08, Math.PI * 0.4);
    const priority = (asgn.priority ?? 'normal') as string;
    const color = PRIORITY_COLORS[priority] ?? '#3b82f6';
    const asgnId = `assignment-${asgn.id ?? i}`;

    nodes.push({
      id: asgnId,
      position: pos,
      type: 'assignmentNode',
      width: 32, height: 32,
      data: {
        nodeType: 'assignmentNode',
        label: (asgn.title ?? 'Task') as string,
        color,
        status: asgn.status as string | undefined,
        priority,
        dueAt: asgn.due_at as string | undefined,
        description: asgn.description as string | undefined,
      },
    });
    edges.push({
      id: `e-entity-${asgnId}`,
      source: 'entity', target: asgnId,
      style: { stroke: color, strokeWidth: 1, strokeDasharray: '2 3', opacity: 0.35 },
    });
  });

  const filterCounts: FilterCounts = {
    context:     Object.values(contextEntries).reduce((s, a) => s + a.length, 0),
    related:     relatedObjects.length,
    activities:  activities.length,
    assignments: assignments.length,
  };

  return { nodes, edges, filterCounts };
}

// ── Icon maps ─────────────────────────────────────────────────────────────────

const ENTITY_ICONS: Record<string, LucideIcon> = {
  contact:     Users,
  account:     Building2,
  opportunity: Briefcase,
  use_case:    FolderKanban,
};

const ACTIVITY_ICONS: Record<string, LucideIcon> = {
  call:          Phone,
  email:         Mail,
  meeting:       Calendar,
  note:          FileText,
  task:          CheckSquare,
  demo:          Monitor,
  proposal:      FileText,
  research:      FileText,
  status_update: Activity,
};

// ── Invisible handle helper — edges render behind nodes so lines appear to
//    terminate at the node boundary even though endpoints are at center ─────────

function nh(top: number, left: number): React.CSSProperties {
  return { position: 'absolute', top, left, width: 1, height: 1, opacity: 0, border: 'none', background: 'transparent', minWidth: 1, minHeight: 1, pointerEvents: 'none' };
}

// ── Custom node components (module-scope — stable references) ─────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function EntityNodeComponent({ data }: { data: any }) {
  const color: string = data.color;
  const Icon = ENTITY_ICONS[data.subjectType as string] ?? Users;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, cursor: 'pointer', position: 'relative' }}>
      {/* Handles at circle center (circle is 60×60, top-left of bounding box) */}
      <Handle type="source" id="s" position={Position.Top} isConnectable={false} style={nh(30, 30)} />
      <Handle type="target" id="t" position={Position.Top} isConnectable={false} style={nh(30, 30)} />
      <div style={{
        width: 60, height: 60, borderRadius: '50%',
        backgroundColor: color + '18',
        border: data.isSelected ? `2px solid ${color}` : `1.5px solid ${color}50`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'border-color 0.15s',
      }}>
        <Icon size={22} color={color} strokeWidth={1.75} />
      </div>
      <span style={{
        fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
        maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis',
        color: 'hsl(var(--foreground))',
      }}>
        {(data.label as string).slice(0, 20)}
      </span>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function RelatedNodeComponent({ data }: { data: any }) {
  const color: string = data.color;
  const Icon = ENTITY_ICONS[data.entityType as string] ?? Users;
  const navigable: boolean = !!data.navigable;
  const title = navigable
    ? `Explore ${(data.entityType as string ?? '').replace(/_/g, ' ')}: ${data.label}`
    : data.label;
  return (
    <div
      title={title}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: 'pointer', position: 'relative' }}
    >
      {/* Handles at circle center (circle is 40×40) */}
      <Handle type="source" id="s" position={Position.Top} isConnectable={false} style={nh(20, 20)} />
      <Handle type="target" id="t" position={Position.Top} isConnectable={false} style={nh(20, 20)} />
      <div style={{
        width: 40, height: 40, borderRadius: '50%',
        backgroundColor: color + '15',
        border: data.isSelected ? `1.5px solid ${color}` : `1px solid ${color}45`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'border-color 0.15s',
      }}>
        <Icon size={15} color={color} strokeWidth={1.75} />
      </div>
      {navigable && (
        <div style={{
          position: 'absolute', top: -5, right: -5,
          width: 14, height: 14, borderRadius: '50%',
          backgroundColor: color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 8, color: '#fff', fontWeight: 700, lineHeight: 1,
        }}>
          ↗
        </div>
      )}
      <span style={{
        fontSize: 9, fontWeight: 500, whiteSpace: 'nowrap',
        maxWidth: 64, overflow: 'hidden', textOverflow: 'ellipsis',
        color: 'hsl(var(--muted-foreground))',
      }}>
        {(data.label as string).slice(0, 16)}
      </span>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ClusterNodeComponent({ data }: { data: any }) {
  const color: string = data.color;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer', position: 'relative' }}>
      {/* Handles at pill center (80×28 bounding box) */}
      <Handle type="source" id="s" position={Position.Top} isConnectable={false} style={nh(14, 40)} />
      <Handle type="target" id="t" position={Position.Top} isConnectable={false} style={nh(14, 40)} />
      <div style={{
        padding: '4px 10px', borderRadius: 8,
        backgroundColor: 'hsl(var(--card))',
        border: data.isSelected ? `1.5px solid ${color}` : `1px solid ${color}45`,
        display: 'flex', alignItems: 'center', gap: 6,
        transition: 'border-color 0.15s',
      }}>
        <span style={{ fontSize: 10, color, fontWeight: 600, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>
          {(data.label as string).slice(0, 14)}
        </span>
        {data.count > 0 && (
          <span style={{
            fontSize: 9, fontWeight: 700, color: 'white',
            backgroundColor: color, borderRadius: '50%',
            width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            {(data.count as number) > 9 ? '9+' : data.count}
          </span>
        )}
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function LeafNodeComponent({ data }: { data: any }) {
  const color: string = data.color;
  return (
    <div style={{
      width: 12, height: 12, borderRadius: '50%', position: 'relative',
      backgroundColor: color + '70',
      border: data.isSelected ? `1.5px solid ${color}` : `1px solid ${color}50`,
      cursor: 'pointer',
      transition: 'border-color 0.15s',
      opacity: data.isStale ? 0.4 : 1,
    }}>
      {/* Handles at circle center (12×12 bounding box) */}
      <Handle type="source" id="s" position={Position.Top} isConnectable={false} style={nh(6, 6)} />
      <Handle type="target" id="t" position={Position.Top} isConnectable={false} style={nh(6, 6)} />
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ActivityNodeComponent({ data }: { data: any }) {
  const color: string = data.color;
  const Icon = ACTIVITY_ICONS[data.activityType as string] ?? Activity;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, cursor: 'pointer', position: 'relative' }}>
      {/* Handles at square center (32×32 bounding box) */}
      <Handle type="source" id="s" position={Position.Top} isConnectable={false} style={nh(16, 16)} />
      <Handle type="target" id="t" position={Position.Top} isConnectable={false} style={nh(16, 16)} />
      <div style={{
        width: 32, height: 32, borderRadius: 8,
        backgroundColor: 'hsl(var(--card))',
        border: data.isSelected ? `1.5px solid ${color}` : `1px solid ${color}50`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'border-color 0.15s',
      }}>
        <Icon size={14} color={color} strokeWidth={1.75} />
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function AssignmentNodeComponent({ data }: { data: any }) {
  const color: string = data.color;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, cursor: 'pointer', position: 'relative' }}>
      {/* Handles at square center (32×32 bounding box) */}
      <Handle type="source" id="s" position={Position.Top} isConnectable={false} style={nh(16, 16)} />
      <Handle type="target" id="t" position={Position.Top} isConnectable={false} style={nh(16, 16)} />
      <div style={{
        width: 32, height: 32, borderRadius: 8,
        backgroundColor: 'hsl(var(--card))',
        border: data.isSelected ? `1.5px solid ${color}` : `1.5px dashed ${color}60`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'border-color 0.15s',
      }}>
        <ClipboardList size={14} color={color} strokeWidth={1.75} />
      </div>
    </div>
  );
}

const nodeTypes = {
  entityNode:     EntityNodeComponent,
  relatedNode:    RelatedNodeComponent,
  clusterNode:    ClusterNodeComponent,
  leafNode:       LeafNodeComponent,
  activityNode:   ActivityNodeComponent,
  assignmentNode: AssignmentNodeComponent,
};

// ── FitViewBridge — exposes useReactFlow().fitView via ref ────────────────────

function FitViewBridge({ fitViewRef }: { fitViewRef: React.MutableRefObject<(() => void) | null> }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    fitViewRef.current = () => fitView({ padding: 0.18, duration: 500 });
    return () => { fitViewRef.current = null; };
  }, [fitView, fitViewRef]);
  return null;
}

// ── Main component ────────────────────────────────────────────────────────────

export function MemoryGraph({
  subjectType, subjectId, subjectName,
  selectedNodeId, onNodeSelect, activeFilters, fitViewRef, onFilterCounts,
  onNavigateToEntity,
}: MemoryGraphProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: briefingData, isLoading } = useBriefing(subjectType, subjectId) as any;
  const briefing = briefingData?.briefing ?? briefingData ?? null;

  const prevCountsRef = useRef<FilterCounts | null>(null);

  const { nodes: baseNodes, edges: baseEdges, filterCounts } = useMemo(
    () => buildGraph(briefing, subjectType, subjectName, subjectId),
    [briefing, subjectType, subjectName, subjectId],
  );

  // Propagate counts to page (stable if unchanged)
  useEffect(() => {
    const prev = prevCountsRef.current;
    if (!prev ||
        prev.context !== filterCounts.context ||
        prev.related !== filterCounts.related ||
        prev.activities !== filterCounts.activities ||
        prev.assignments !== filterCounts.assignments) {
      prevCountsRef.current = filterCounts;
      onFilterCounts(filterCounts);
    }
  });

  // Apply filter visibility + selection state
  const displayNodes = useMemo(() =>
    baseNodes.map(n => ({
      ...n,
      hidden: n.type !== 'entityNode' && !activeFilters.has(getCategoryForNodeType(n.type ?? '')),
      data: {
        ...n.data,
        isSelected: n.id === selectedNodeId,
        // Flag related nodes as navigable so the node component can show the ↗ badge
        navigable: n.type === 'relatedNode' && !!onNavigateToEntity,
      },
    })),
    [baseNodes, activeFilters, selectedNodeId, onNavigateToEntity],
  );

  // Hide edges whose source/target is hidden
  const displayEdges = useMemo(() => {
    const visibleIds = new Set(displayNodes.filter(n => !n.hidden).map(n => n.id));
    return baseEdges.filter(e => visibleIds.has(e.source) && visibleIds.has(e.target));
  }, [baseEdges, displayNodes]);

  const openDrawer = useAppStore(s => s.openDrawer);

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node<GraphNodeData>) => {
    const data = node.data as GraphNodeData;

    // Related entities: navigate the graph if a handler is provided, otherwise open drawer
    if (node.type === 'relatedNode') {
      const entityType = data.entityType as string | undefined;
      const entityId   = data.entityId   as string | undefined;
      if (entityId && entityType) {
        if (onNavigateToEntity) {
          onNavigateToEntity(entityType, entityId, data.label);
        } else {
          const drawerType =
            entityType === 'account'     ? 'account'     as const
            : entityType === 'opportunity' ? 'opportunity' as const
            : entityType === 'use_case'    ? 'use-case'   as const
            : 'contact' as const;
          openDrawer(drawerType, entityId);
        }
      }
      return;
    }

    // Center entity node: open its drawer (it's the record currently in focus)
    if (node.type === 'entityNode') {
      const entityType = (data.entityType ?? data.subjectType) as string | undefined;
      const entityId   = data.entityId as string | undefined;
      if (entityId && entityType) {
        const drawerType =
          entityType === 'account'     ? 'account'     as const
          : entityType === 'opportunity' ? 'opportunity' as const
          : entityType === 'use_case'    ? 'use-case'   as const
          : 'contact' as const;
        openDrawer(drawerType, entityId);
      }
      return;
    }

    // Context clusters, leaf entries, activities, assignments → show the detail sheet
    onNodeSelect(node.id, data);
  }, [onNodeSelect, openDrawer, onNavigateToEntity]);

  const isEmpty = !briefing ||
    (Object.keys(briefing?.context_entries ?? {}).length === 0 &&
     (briefing?.activities ?? []).length === 0 &&
     (briefing?.open_assignments ?? []).length === 0 &&
     Object.keys(briefing?.related_objects ?? {}).every(k => (briefing.related_objects[k] ?? []).length === 0));

  if (isLoading) {
    return (
      <div className="flex-1 min-h-0 h-full w-full flex items-center justify-center gap-2 text-sm text-muted-foreground bg-background">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading graph…
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="flex-1 min-h-0 h-full w-full flex flex-col items-center justify-center text-center px-8 bg-background">
        <div className="w-10 h-10 rounded-xl border border-border flex items-center justify-center mb-4 opacity-30">
          <Activity className="w-5 h-5 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-muted-foreground">No context data yet</p>
        <p className="text-xs mt-1 max-w-xs text-muted-foreground/50 leading-relaxed">
          Agents populate this graph as they interact with this {subjectType.replace('_', ' ')}.
          Context entries, activities, and briefings will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 h-full w-full bg-background">
      <ReactFlow
        key={subjectId}
        nodes={displayNodes}
        edges={displayEdges}
        onNodeClick={handleNodeClick}
        onPaneClick={() => onNodeSelect(null, null)}
        nodeTypes={nodeTypes}
        nodeOrigin={[0.5, 0.5]}
        nodesDraggable={false}
        nodesConnectable={false}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.3}
        maxZoom={2.5}
        defaultEdgeOptions={{ type: 'straight' }}
        proOptions={{ hideAttribution: true }}
        style={{ backgroundColor: 'hsl(var(--background))' }}
      >
        <FitViewBridge fitViewRef={fitViewRef} />
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="hsl(var(--border))"
        />
        <Controls
          showInteractive={false}
          className="!bg-card !border-border !shadow-none [&>button]:!bg-transparent [&>button]:!text-muted-foreground [&>button:hover]:!text-foreground [&>button]:!border-border"
        />
        <MiniMap
          position="top-right"
          nodeColor={n => {
            const d = n.data as GraphNodeData;
            return n.hidden ? 'transparent' : (d.color ?? '#94a3b8');
          }}
          nodeStrokeWidth={0}
          nodeStrokeColor="transparent"
          maskColor="rgba(0,0,0,0.55)"
          zoomable
          pannable
          style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }}
        />
      </ReactFlow>
    </div>
  );
}
