// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import '@xyflow/react/dist/style.css';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from '@xyflow/react';
import { useMemo, useState, useEffect } from 'react';
import { useBriefing } from '@/api/hooks';
import { TYPE_COLORS } from './ContextPanel';
import { Loader2, X } from 'lucide-react';

interface MemoryGraphProps {
  subjectType: string;
  subjectId: string;
  subjectName: string;
}

// Derive a hex fill color from Tailwind entity type strings
const ENTITY_HEX: Record<string, string> = {
  contact:     '#6366f1',
  account:     '#8b5cf6',
  opportunity: '#f59e0b',
  use_case:    '#22c55e',
};

function radialPos(cx: number, cy: number, r: number, i: number, total: number) {
  const angle = (2 * Math.PI * i) / total - Math.PI / 2;
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

interface NodeData {
  label: string;
  body?: string;
  color: string;
  size: number;
  [key: string]: unknown;
}

function buildGraph(briefing: any, subjectType: string, subjectName: string) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Center entity node
  nodes.push({
    id: 'entity',
    position: { x: 300, y: 260 },
    data: { label: subjectName, color: ENTITY_HEX[subjectType] ?? '#6366f1', size: 56 } as NodeData,
    type: 'entityNode',
  });

  const contextEntries: Record<string, any[]> = briefing?.context_entries ?? {};
  const typeKeys = Object.keys(contextEntries).slice(0, 8);
  const activities: any[] = (briefing?.activities ?? []).slice(0, 5);

  // Type cluster nodes
  typeKeys.forEach((type, i) => {
    const pos = radialPos(300, 260, 165, i, Math.max(typeKeys.length, 1));
    const color = TYPE_COLORS[type] ?? '#94a3b8';
    const clusterId = `type-${type}`;

    nodes.push({
      id: clusterId,
      position: pos,
      data: { label: type.replace(/_/g, ' '), color, size: 36 } as NodeData,
      type: 'clusterNode',
    });

    edges.push({
      id: `e-entity-${clusterId}`,
      source: 'entity',
      target: clusterId,
      style: { stroke: color, strokeWidth: 2, opacity: 0.6 },
    });

    // Leaf entry nodes
    const typeEntries = contextEntries[type].slice(0, 5);
    typeEntries.forEach((entry: any, j: number) => {
      const leafPos = radialPos(pos.x, pos.y, 80, j, Math.max(typeEntries.length, 1));
      const leafId = `entry-${entry.id}`;

      nodes.push({
        id: leafId,
        position: leafPos,
        data: {
          label: (entry.title ?? entry.body ?? '').slice(0, 22) || type,
          body: entry.body,
          color,
          size: 24,
        } as NodeData,
        type: 'leafNode',
      });

      edges.push({
        id: `e-${clusterId}-${leafId}`,
        source: clusterId,
        target: leafId,
        style: { stroke: color, strokeWidth: 1, opacity: 0.4 },
      });
    });
  });

  // Activity nodes — fan at bottom-left
  activities.forEach((act: any, i: number) => {
    const pos = radialPos(300, 260, 200, i + typeKeys.length + 1, typeKeys.length + activities.length + 1);
    const actId = `activity-${act.id ?? i}`;

    nodes.push({
      id: actId,
      position: pos,
      data: {
        label: (act.type ?? act.activity_type ?? 'activity').replace(/_/g, ' ').slice(0, 18),
        body: act.body ?? act.description,
        color: '#64748b',
        size: 22,
      } as NodeData,
      type: 'activityNode',
    });

    edges.push({
      id: `e-act-${actId}`,
      source: actId,
      target: 'entity',
      style: { stroke: '#64748b', strokeWidth: 1, strokeDasharray: '4 3', opacity: 0.35 },
    });
  });

  return { nodes, edges };
}

// ── Custom node renderers ─────────────────────────────────────────────────────

function EntityNodeComponent({ data }: { data: NodeData }) {
  return (
    <div
      className="flex items-center justify-center rounded-2xl text-white text-xs font-bold shadow-lg select-none border-2 border-white/20"
      style={{
        width: data.size,
        height: data.size,
        backgroundColor: data.color as string,
        fontSize: 10,
        padding: 4,
        textAlign: 'center',
        lineHeight: 1.2,
      }}
    >
      {(data.label as string).slice(0, 12)}
    </div>
  );
}

function ClusterNodeComponent({ data }: { data: NodeData }) {
  return (
    <div
      className="flex items-center justify-center rounded-xl text-white text-[9px] font-semibold shadow-md select-none capitalize"
      style={{
        width: data.size,
        height: data.size,
        backgroundColor: (data.color as string) + 'cc',
        fontSize: 9,
        padding: 3,
        textAlign: 'center',
        lineHeight: 1.2,
      }}
    >
      {(data.label as string).slice(0, 10)}
    </div>
  );
}

function LeafNodeComponent({ data }: { data: NodeData }) {
  return (
    <div
      className="flex items-center justify-center rounded-lg text-white text-[8px] font-medium shadow select-none"
      style={{
        width: data.size,
        height: data.size,
        backgroundColor: (data.color as string) + '99',
        fontSize: 8,
        padding: 2,
        textAlign: 'center',
        lineHeight: 1.2,
      }}
    >
      {(data.label as string).slice(0, 8)}
    </div>
  );
}

function ActivityNodeComponent({ data }: { data: NodeData }) {
  return (
    <div
      className="flex items-center justify-center rounded-lg text-white text-[8px] font-medium shadow select-none"
      style={{
        width: data.size,
        height: data.size,
        backgroundColor: '#64748b99',
        fontSize: 8,
        padding: 2,
        textAlign: 'center',
        lineHeight: 1.2,
      }}
    >
      {(data.label as string).slice(0, 8)}
    </div>
  );
}

const nodeTypes = {
  entityNode:   EntityNodeComponent,
  clusterNode:  ClusterNodeComponent,
  leafNode:     LeafNodeComponent,
  activityNode: ActivityNodeComponent,
};

// ── Main component ────────────────────────────────────────────────────────────

export function MemoryGraph({ subjectType, subjectId, subjectName }: MemoryGraphProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: briefingData, isLoading } = useBriefing(subjectType, subjectId) as any;
  const briefing = briefingData?.briefing ?? briefingData;

  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => buildGraph(briefing, subjectType, subjectName),
    [briefing, subjectType, subjectName],
  );

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState<{ label: string; body?: string } | null>(null);

  // Re-sync when briefing loads
  useEffect(() => {
    // useNodesState doesn't expose a reset — React remounts via key instead (see wrapper)
  }, [briefing]);

  const handleNodeClick: NodeMouseHandler = (_, node) => {
    const d = node.data as NodeData;
    setSelectedNode({ label: d.label as string, body: d.body as string | undefined });
  };

  const isEmpty = !briefing ||
    (Object.keys(briefing?.context_entries ?? {}).length === 0 &&
     (briefing?.activities ?? []).length === 0);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[450px] text-muted-foreground gap-2 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading graph…
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center h-[450px] text-center text-muted-foreground px-8">
        <div className="text-5xl mb-4 opacity-20">⬡</div>
        <p className="font-medium text-sm text-foreground">No context data yet</p>
        <p className="text-xs mt-1 max-w-xs">
          Agents populate this graph as they interact with this {subjectType.replace('_', ' ')}.
          Context entries, activities, and briefings will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="relative" style={{ height: 450 }}>
      <ReactFlow
        key={subjectId}
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.4}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#94a3b8" gap={20} size={1} style={{ opacity: 0.06 }} />
        <Controls showInteractive={false} className="!bottom-3 !left-3" />
      </ReactFlow>

      {/* Node detail tooltip */}
      {selectedNode && (
        <div className="absolute bottom-3 right-3 w-64 bg-card border border-border rounded-xl shadow-lg p-3 z-10">
          <div className="flex items-start justify-between gap-2 mb-1">
            <p className="text-xs font-semibold text-foreground capitalize leading-tight">{selectedNode.label}</p>
            <button
              onClick={() => setSelectedNode(null)}
              className="text-muted-foreground hover:text-foreground flex-shrink-0"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
          {selectedNode.body && (
            <p className="text-[11px] text-muted-foreground line-clamp-4 whitespace-pre-wrap">
              {selectedNode.body}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
