// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useRef, useCallback, useEffect } from 'react';
import { ArrowLeft, Search, X, Network, Building2, User, Briefcase, FolderKanban } from 'lucide-react';
import { MemoryGraph } from '@/components/crm/MemoryGraph';
import {
  GraphSidebar,
  GraphNodeSheet,
  ENTITY_HEX,
  type GraphNodeData,
  type FilterCounts,
} from '@/components/crm/GraphSidebar';
import { useContacts, useAccounts, useOpportunities, useUseCases } from '@/api/hooks';

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_FILTERS = new Set(['context', 'related', 'activities', 'assignments']);
const EMPTY_COUNTS: FilterCounts = { context: 0, related: 0, activities: 0, assignments: 0 };

// ── Types ─────────────────────────────────────────────────────────────────────

interface Subject {
  type: 'contact' | 'account' | 'opportunity' | 'use_case';
  id: string;
  name: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

// ── SubjectPicker ─────────────────────────────────────────────────────────────

// ── Per-entity display config ─────────────────────────────────────────────────

const ENTITY_CONFIG: Record<Subject['type'], {
  label: string;
  icon: React.ElementType;
  color: string;
  getName: (r: AnyRecord) => string;
  getSub?: (r: AnyRecord) => string | undefined;
}> = {
  contact: {
    label: 'Contacts',
    icon: User,
    color: ENTITY_HEX.contact,
    getName: r => [r.first_name, r.last_name].filter(Boolean).join(' ') || (r.email as string) || 'Contact',
    getSub: r => r.email as string | undefined,
  },
  account: {
    label: 'Accounts',
    icon: Building2,
    color: ENTITY_HEX.account,
    getName: r => (r.name as string) || 'Account',
    getSub: r => r.industry as string | undefined,
  },
  opportunity: {
    label: 'Opportunities',
    icon: Briefcase,
    color: ENTITY_HEX.opportunity,
    getName: r => (r.name as string) || 'Opportunity',
    getSub: r => r.stage as string | undefined,
  },
  use_case: {
    label: 'Use Cases',
    icon: FolderKanban,
    color: ENTITY_HEX.use_case,
    getName: r => (r.name as string) || 'Use Case',
    getSub: r => r.stage as string | undefined,
  },
};

// ── SubjectPicker ─────────────────────────────────────────────────────────────

function SubjectPicker({
  subject,
  onSelect,
  onClear,
  size = 'default',
  showSelectedChip = true,
  placeholder,
}: {
  subject: Subject | null;
  onSelect: (s: Subject) => void;
  onClear: () => void;
  size?: 'default' | 'large';
  showSelectedChip?: boolean;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen]   = useState(false);
  const containerRef      = useRef<HTMLDivElement>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: cData }  = useContacts({ q: query || undefined, limit: 5 }) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: aData }  = useAccounts({ q: query || undefined, limit: 5 }) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: opData } = useOpportunities({ q: query || undefined, limit: 5 }) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ucData } = useUseCases({ q: query || undefined, limit: 5 }) as any;

  const sections: Array<{ type: Subject['type']; rows: AnyRecord[] }> = (
    [
      { type: 'contact'     as const, rows: (cData?.data  ?? []) as AnyRecord[] },
      { type: 'account'     as const, rows: (aData?.data  ?? []) as AnyRecord[] },
      { type: 'opportunity' as const, rows: (opData?.data ?? []) as AnyRecord[] },
      { type: 'use_case'    as const, rows: (ucData?.data ?? []) as AnyRecord[] },
    ] as Array<{ type: Subject['type']; rows: AnyRecord[] }>
  ).filter(s => s.rows.length > 0);

  const hasResults = sections.length > 0;

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Element)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  function pick(s: Subject) {
    onSelect(s);
    setQuery('');
    setOpen(false);
  }

  const isLarge = size === 'large';

  // ── Selected chip ────────────────────────────────────────────────────────
  if (subject && showSelectedChip) {
    const cfg = ENTITY_CONFIG[subject.type];
    const Icon = cfg.icon;
    return (
      <div className={`flex items-center gap-2 ${isLarge ? 'h-10 pl-4 pr-3 text-base' : 'h-8 pl-3 pr-2 text-sm'} rounded-xl border border-border bg-muted/50`}>
        <Icon className={`flex-shrink-0 ${isLarge ? 'w-4 h-4' : 'w-3.5 h-3.5'}`} style={{ color: cfg.color }} />
        <span className="font-medium text-foreground">{subject.name}</span>
        <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground capitalize ml-0.5">
          {subject.type.replace('_', ' ')}
        </span>
        <button
          onClick={onClear}
          className="ml-1 p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    );
  }

  // ── Search input + dropdown ──────────────────────────────────────────────
  return (
    <div ref={containerRef} className="relative">
      <div
        className={`flex items-center gap-2 ${isLarge ? 'h-10 pl-4 pr-3' : 'h-8 pl-3 pr-2'} rounded-xl border border-border bg-muted/30 focus-within:border-primary/50 focus-within:bg-muted/50 transition-colors`}
      >
        <Search className={`text-muted-foreground flex-shrink-0 ${isLarge ? 'w-4 h-4' : 'w-3.5 h-3.5'}`} />
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder ?? (isLarge ? 'Search contacts, accounts, opportunities, use cases…' : 'Search…')}
          className={`bg-transparent outline-none text-foreground placeholder:text-muted-foreground ${isLarge ? 'text-base w-96' : 'text-sm w-52'}`}
        />
        {query && (
          <button onClick={() => setQuery('')} className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute top-full mt-1.5 left-0 w-88 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden" style={{ width: '22rem' }}>
          {!hasResults ? (
            <div className="px-4 py-3 text-sm text-muted-foreground">
              {query ? `No results for "${query}"` : 'Start typing to search…'}
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {sections.map(({ type, rows }) => {
                const cfg = ENTITY_CONFIG[type];
                const Icon = cfg.icon;
                return (
                  <div key={type}>
                    <div className="px-3 pt-2.5 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {cfg.label}
                    </div>
                    {rows.map((r: AnyRecord) => {
                      const name = cfg.getName(r);
                      const sub  = cfg.getSub?.(r);
                      return (
                        <button
                          key={r.id as string}
                          className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted/60 text-left transition-colors"
                          onClick={() => pick({ type, id: r.id as string, name })}
                        >
                          <div
                            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{ background: cfg.color + '18', border: `1px solid ${cfg.color}40` }}
                          >
                            <Icon className="w-3.5 h-3.5" style={{ color: cfg.color }} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{name}</p>
                            {sub && <p className="text-xs text-muted-foreground truncate capitalize">{sub}</p>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── GraphTab — embeds inside the Context tab panel ───────────────────────────

export function GraphTab() {
  const [subject, setSubject]               = useState<Subject | null>(null);
  const [history, setHistory]               = useState<Subject[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeData, setSelectedNodeData] = useState<GraphNodeData | null>(null);
  const [activeFilters, setActiveFilters]   = useState<Set<string>>(new Set(ALL_FILTERS));
  const [filterCounts, setFilterCounts]     = useState<FilterCounts>(EMPTY_COUNTS);
  const fitViewRef = useRef<(() => void) | null>(null);

  const handleNodeSelect = useCallback((id: string | null, data: GraphNodeData | null) => {
    setSelectedNodeId(id);
    setSelectedNodeData(data);
  }, []);

  /** Reset all graph state for a fresh subject without touching history */
  function resetGraphState() {
    setSelectedNodeId(null);
    setSelectedNodeData(null);
    setActiveFilters(new Set(ALL_FILTERS));
    setFilterCounts(EMPTY_COUNTS);
  }

  /** Navigate forward: push current subject onto history, switch to new entity */
  const handleNavigateToEntity = useCallback((type: string, id: string, name: string) => {
    setHistory(prev => subject ? [...prev, subject] : prev);
    setSubject({ type: type as Subject['type'], id, name });
    resetGraphState();
    // Fit the new graph into view after it renders
    setTimeout(() => fitViewRef.current?.(), 150);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject]);

  /** Back: pop history or clear to picker */
  const handleBack = useCallback(() => {
    setHistory(prev => {
      if (prev.length === 0) {
        setSubject(null);
        resetGraphState();
        return prev;
      }
      const next = [...prev];
      const previous = next.pop()!;
      setSubject(previous);
      resetGraphState();
      setTimeout(() => fitViewRef.current?.(), 150);
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Select from picker: clear history and set new root */
  const handlePickSubject = useCallback((s: Subject) => {
    setHistory([]);
    setSubject(s);
    resetGraphState();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearGraphSubject() {
    setHistory([]);
    setSubject(null);
    resetGraphState();
  }

  // ── Detail graph ─────────────────────────────────────────────────────────
  // Build breadcrumb: last 2 history items
  const historyItems = history.slice(-2).map(h => ({ name: h.name, type: h.type }));
  const subjectConfig = subject ? ENTITY_CONFIG[subject.type] : null;
  const SubjectIcon = subjectConfig?.icon;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 px-4 py-2 md:px-6 md:py-3">
        <div className="flex items-center gap-2">
          <SubjectPicker
            subject={subject}
            onSelect={handlePickSubject}
            onClear={clearGraphSubject}
            showSelectedChip={false}
            size="large"
            placeholder={subject?.name || 'Search records...'}
          />
          {historyItems.length > 0 && (
            <button
              type="button"
              onClick={handleBack}
              className="h-10 flex-shrink-0 rounded-xl border border-border bg-card px-3 text-sm font-semibold text-muted-foreground transition-all hover:border-primary/30 hover:text-foreground"
            >
              <span className="inline-flex items-center gap-1.5">
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </span>
            </button>
          )}
        </div>

        {subject && subjectConfig && SubjectIcon && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1 text-xs text-foreground">
              <SubjectIcon className="h-3.5 w-3.5" style={{ color: subjectConfig.color }} />
              <span className="text-muted-foreground">Record:</span> {subject.name}
              <span className="rounded bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground capitalize">
                {subject.type.replace('_', ' ')}
              </span>
              <button onClick={clearGraphSubject} className="ml-0.5 p-0.5 hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </span>
          </div>
        )}
      </div>

      {!subject ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-2xl"
            style={{ background: '#0ea5e9' + '15', border: `1.5px solid ${'#0ea5e9'}30` }}
          >
            <Network className="h-7 w-7" style={{ color: '#0ea5e9' }} />
          </div>
          <div>
            <p className="text-base font-semibold text-foreground">Search for a record to view the graph</p>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">
              Select a customer record to explore related records, Current Memory, recent activity, and open handoffs.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
          <GraphSidebar
            subjectType={subject.type}
            subjectName={subject.name}
            activeFilters={activeFilters}
            filterCounts={filterCounts}
            onFilterChange={setActiveFilters}
            onFitView={() => fitViewRef.current?.()}
            onBack={handleBack}
            historyItems={historyItems}
            showHeader={false}
          />
          <MemoryGraph
            subjectType={subject.type}
            subjectId={subject.id}
            subjectName={subject.name}
            selectedNodeId={selectedNodeId}
            onNodeSelect={handleNodeSelect}
            activeFilters={activeFilters}
            fitViewRef={fitViewRef}
            onFilterCounts={counts => setFilterCounts(counts)}
            onNavigateToEntity={handleNavigateToEntity}
          />
        </div>
      )}
      <GraphNodeSheet
        node={selectedNodeData}
        onClose={() => handleNodeSelect(null, null)}
        onNodeFocus={nodeId => handleNodeSelect(nodeId, selectedNodeData)}
      />
    </div>
  );
}
