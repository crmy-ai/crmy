// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useRef, useCallback } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { MemoryGraph } from '@/components/crm/MemoryGraph';
import { GraphSidebar, GraphNodeSheet, type GraphNodeData, type FilterCounts } from '@/components/crm/GraphSidebar';
import { useContact, useAccount } from '@/api/hooks';

const ALL_FILTERS = new Set(['context', 'related', 'activities', 'assignments']);

export default function MemoryGraphPage() {
  const { id } = useParams<{ id: string }>();
  const { pathname } = useLocation();
  const type = pathname.startsWith('/contacts') ? 'contact' : 'account';

  // Load subject name
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: contactData } = useContact(type === 'contact' ? (id ?? '') : '') as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: accountData } = useAccount(type === 'account' ? (id ?? '') : '') as any;

  const subjectName = type === 'contact'
    ? (() => {
        const c = contactData?.contact;
        return c ? [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || '' : '';
      })()
    : accountData?.account?.name ?? '';

  // Lifted state
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeData, setSelectedNodeData] = useState<GraphNodeData | null>(null);
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set(ALL_FILTERS));
  const [filterCounts, setFilterCounts] = useState<FilterCounts>({ context: 0, related: 0, activities: 0, assignments: 0 });

  const fitViewRef = useRef<(() => void) | null>(null);

  const handleNodeSelect = useCallback((nodeId: string | null, data: GraphNodeData | null) => {
    setSelectedNodeId(nodeId);
    setSelectedNodeData(data);
  }, []);

  const handleFilterCounts = useCallback((counts: FilterCounts) => {
    setFilterCounts(counts);
  }, []);

  if (!id) return null;

  return (
    <div className="flex flex-row flex-1 min-h-0 h-full overflow-hidden">
      <GraphSidebar
        subjectType={type}
        subjectName={subjectName}
        activeFilters={activeFilters}
        filterCounts={filterCounts}
        onFilterChange={setActiveFilters}
        onFitView={() => fitViewRef.current?.()}
      />
      <MemoryGraph
        subjectType={type}
        subjectId={id}
        subjectName={subjectName}
        selectedNodeId={selectedNodeId}
        onNodeSelect={handleNodeSelect}
        activeFilters={activeFilters}
        fitViewRef={fitViewRef}
        onFilterCounts={handleFilterCounts}
      />
      <GraphNodeSheet
        node={selectedNodeData}
        onClose={() => handleNodeSelect(null, null)}
        onNodeFocus={nodeId => handleNodeSelect(nodeId, selectedNodeData)}
      />
    </div>
  );
}
