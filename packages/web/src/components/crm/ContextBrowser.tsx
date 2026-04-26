// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ListToolbar, type FilterConfig, type SortOption } from '@/components/crm/ListToolbar';
import {
  useContextEntriesInfinite,
  useReviewContextEntry,
  useContextTypes,
  useSemanticSearch,
  useContextIngest,
  useDetectSubjects,
  useIngestFile,
  useCreateContextEntry,
  useContacts,
  useAccounts,
  useOpportunities,
  useUseCases,
} from '@/api/hooks';
import { motion } from 'framer-motion';
import { formatDistanceToNow, isPast } from 'date-fns';
import {
  Library,
  Search,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Tag,
  Sparkles,
  FileText,
  Loader2,
  X,
  Plus,
  Upload,
  Wand2,
  Building2,
  User,
  Briefcase,
  FolderKanban,
  Clipboard,
} from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { ContextEntryDrawer } from '@/components/crm/ContextEntryDrawer';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSupersedeContextEntry } from '@/api/hooks';
import { MoreHorizontal, Trash2, Edit3 } from 'lucide-react';

// ── Helper components ────────────────────────────────────────────────────────

const SUBJECT_TYPES = ['contact', 'account', 'opportunity', 'use_case'] as const;

function ConfidencePill({ value }: { value: number | null | undefined }) {
  if (value == null) return null;
  const pct = Math.round(value * 100);
  const cls = pct >= 80
    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
    : pct >= 50
    ? 'bg-warning/15 text-warning'
    : 'bg-destructive/15 text-destructive';
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold ${cls}`}>
      {pct}%
    </span>
  );
}

function SimilarityPill({ value }: { value: number | null | undefined }) {
  if (value == null) return null;
  const pct = Math.round(value * 100);
  const label = pct >= 80 ? 'Strong match' : pct >= 50 ? 'Partial match' : 'Weak match';
  const cls   = pct >= 80
    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
    : pct >= 50
    ? 'bg-warning/15 text-warning'
    : 'bg-muted text-muted-foreground';
  return (
    <span title={`${pct}% similarity`}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold ${cls}`}>
      <Sparkles className="w-2.5 h-2.5" />
      {label}
    </span>
  );
}

function ValidUntilBadge({ date }: { date: string | null | undefined }) {
  if (!date) return null;
  const expired = isPast(new Date(date));
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${expired ? 'text-destructive' : 'text-muted-foreground'}`}>
      {expired && <AlertTriangle className="w-3 h-3" />}
      {expired ? 'Expired ' : 'Valid until '}
      {formatDistanceToNow(new Date(date), { addSuffix: true })}
    </span>
  );
}

function subjectTypeLabel(t: string) {
  return t === 'use_case' ? 'Use Case' : t.charAt(0).toUpperCase() + t.slice(1);
}

const SUBJECT_ICONS: Record<string, React.ElementType> = {
  contact:     User,
  account:     Building2,
  opportunity: Briefcase,
  use_case:    FolderKanban,
};

const SUBJECT_COLORS: Record<string, string> = {
  contact:     '#f97316',
  account:     '#8b5cf6',
  opportunity: '#0ea5e9',
  use_case:    '#22c55e',
};

const DRAWER_TYPE_MAP: Record<string, 'contact' | 'account' | 'opportunity' | 'use-case'> = {
  contact:     'contact',
  account:     'account',
  opportunity: 'opportunity',
  use_case:    'use-case',
};

function SubjectChip({
  subjectType,
  subjectId,
  subjectName,
}: {
  subjectType?: string;
  subjectId?: string;
  subjectName?: string;
}) {
  const openDrawer = useAppStore(s => s.openDrawer);
  if (!subjectType) return null;

  const Icon       = SUBJECT_ICONS[subjectType] ?? User;
  const color      = SUBJECT_COLORS[subjectType] ?? '#94a3b8';
  const drawerType = DRAWER_TYPE_MAP[subjectType] ?? 'contact';
  const label      = subjectName || subjectTypeLabel(subjectType);

  return (
    <button
      onClick={subjectId ? () => openDrawer(drawerType, subjectId) : undefined}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium transition-colors ${
        subjectId
          ? 'hover:opacity-80 cursor-pointer'
          : 'cursor-default'
      }`}
      style={{ background: color + '18', color }}
      title={subjectId ? `Open ${subjectTypeLabel(subjectType)}` : undefined}
    >
      <Icon className="w-2.5 h-2.5 flex-shrink-0" />
      {label}
    </button>
  );
}

// ── Entity picker ─────────────────────────────────────────────────────────────

function EntityPicker({
  subjectType,
  selectedId,
  selectedLabel,
  onSelect,
}: {
  subjectType: string;
  selectedId: string;
  selectedLabel: string;
  onSelect: (id: string, name: string) => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);

  const { data: contactsData }  = useContacts({ q: q || undefined, limit: 8 });
  const { data: accountsData }  = useAccounts({ q: q || undefined, limit: 8 });
  const { data: oppsData }      = useOpportunities({ q: q || undefined, limit: 8 });
  const { data: ucData }        = useUseCases({ q: q || undefined, limit: 8 });

  const results = useMemo(() => {
    if (subjectType === 'contact') {
      return (contactsData?.data ?? []).map((c: any) => ({
        id: c.id,
        name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || '(unknown)',
        sub: c.email,
      }));
    }
    if (subjectType === 'account') {
      return (accountsData?.data ?? []).map((a: any) => ({ id: a.id, name: a.name, sub: a.website }));
    }
    if (subjectType === 'opportunity') {
      return (oppsData?.data ?? []).map((o: any) => ({ id: o.id, name: o.name, sub: o.stage }));
    }
    if (subjectType === 'use_case') {
      return (ucData?.data ?? []).map((u: any) => ({ id: u.id, name: u.name || u.title, sub: u.stage }));
    }
    return [];
  }, [subjectType, contactsData, accountsData, oppsData, ucData]);

  const inputCls = 'w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';

  if (selectedId) {
    return (
      <div className="flex items-center gap-2 h-9 px-3 rounded-lg border border-border bg-background text-sm flex-1">
        <span className="flex-1 text-foreground truncate">{selectedLabel}</span>
        <button
          type="button"
          onClick={() => { onSelect('', ''); setQ(''); }}
          className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
          aria-label="Clear selection"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex-1">
      <input
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={`Search ${subjectTypeLabel(subjectType)}…`}
        className={inputCls}
      />
      {open && results.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg overflow-hidden max-h-48 overflow-y-auto">
          {results.map((r: any) => (
            <button
              key={r.id}
              type="button"
              onMouseDown={() => { onSelect(r.id, r.name); setOpen(false); }}
              className="w-full text-left px-3 py-2 hover:bg-muted transition-colors"
            >
              <p className="text-sm font-medium text-foreground truncate">{r.name}</p>
              {r.sub && <p className="text-xs text-muted-foreground truncate">{r.sub}</p>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Subject section for import dialog ────────────────────────────────────────

type IngestSubjectLocal = { type: string; id: string; label: string; auto?: boolean; confidence?: string };

function SubjectSection({
  subjects,
  onChange,
  detecting,
}: {
  subjects: IngestSubjectLocal[];
  onChange: (subjects: IngestSubjectLocal[]) => void;
  detecting: boolean;
}) {
  const [showManual, setShowManual] = useState(false);

  const removeSubject = (id: string) => onChange(subjects.filter(s => s.id !== id));
  const addManual = () => setShowManual(true);

  const autoSubjects = subjects.filter(s => s.auto);
  const manualSubjects = subjects.filter(s => !s.auto);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <p className="text-xs font-medium text-muted-foreground flex-1">
          Subjects
          <span className="font-normal ml-1">(context extracted once per subject)</span>
        </p>
        {detecting && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Wand2 className="w-3 h-3 animate-pulse text-primary" />
            Detecting…
          </span>
        )}
      </div>

      {/* Auto-detected chips */}
      {autoSubjects.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {autoSubjects.map((s) => (
            <span
              key={s.id}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${
                s.confidence === 'high'
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400'
                  : 'bg-primary/8 border-primary/20 text-primary'
              }`}
            >
              {s.type === 'contact' ? <User className="w-3 h-3" /> : <Building2 className="w-3 h-3" />}
              {s.label}
              <span className="opacity-60">{s.type}</span>
              <button
                type="button"
                onClick={() => removeSubject(s.id)}
                className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity"
                aria-label={`Remove ${s.label}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Manual subjects */}
      {manualSubjects.map((subject, idx) => (
        <div key={`manual-${idx}`} className="flex gap-2 items-center">
          <Select
            value={subject.type}
            onValueChange={(v) => {
              const updated = manualSubjects.map((s, i) => i === idx ? { type: v, id: '', label: '' } : s);
              onChange([...autoSubjects, ...updated]);
            }}
          >
            <SelectTrigger className="h-9 w-36 flex-shrink-0 text-sm">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              {SUBJECT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{subjectTypeLabel(t)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {subject.type ? (
            <EntityPicker
              subjectType={subject.type}
              selectedId={subject.id}
              selectedLabel={subject.label}
              onSelect={(id, name) => {
                const updated = manualSubjects.map((s, i) => i === idx ? { ...s, id, label: name } : s);
                onChange([...autoSubjects, ...updated]);
              }}
            />
          ) : (
            <div className="flex-1 h-9 px-3 rounded-lg border border-border bg-muted/40 text-sm text-muted-foreground flex items-center">
              Select a type first
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              const updated = manualSubjects.filter((_, i) => i !== idx);
              onChange([...autoSubjects, ...updated]);
              if (updated.length === 0) setShowManual(false);
            }}
            className="flex-shrink-0 text-muted-foreground hover:text-destructive transition-colors"
            aria-label="Remove subject"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}

      {/* Show manual entry if requested, or if no auto-detected */}
      {(showManual || autoSubjects.length === 0) && !manualSubjects.length && (
        <div className="flex gap-2 items-center">
          <Select
            onValueChange={(v) => onChange([...subjects, { type: v, id: '', label: '' }])}
          >
            <SelectTrigger className="h-9 w-36 flex-shrink-0 text-sm">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              {SUBJECT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{subjectTypeLabel(t)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex-1 h-9 px-3 rounded-lg border border-border bg-muted/40 text-sm text-muted-foreground flex items-center">
            Select a type first
          </div>
        </div>
      )}

      {/* Add subject link */}
      {subjects.length < 5 && (
        <button
          type="button"
          onClick={addManual}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add subject manually
        </button>
      )}
    </div>
  );
}

const SORT_OPTIONS: SortOption[] = [
  { key: 'created_at',       label: 'Date Created' },
  { key: 'confidence_score', label: 'Confidence' },
  { key: 'valid_until',      label: 'Valid Until' },
];

// ── ContextBrowser ────────────────────────────────────────────────────────────

type AddEntryForm = {
  subject_type: string; subject_id: string; subject_label: string;
  context_type: string; title: string; body: string;
  confidence: string; tags: string; source: string; valid_until: string;
};
const BLANK_ADD_FORM: AddEntryForm = {
  subject_type: '', subject_id: '', subject_label: '',
  context_type: '', title: '', body: '',
  confidence: '', tags: '', source: '', valid_until: '',
};

export function ContextBrowser() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Initialise filters from URL params
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>(() => {
    const init: Record<string, string[]> = {};
    const st = searchParams.get('subject_type');
    if (st) init.subject_type = [st];
    if (searchParams.get('stale') === 'true') init.validity = ['stale'];
    return init;
  });
  const [q,          setQ]          = useState('');
  const [sort,       setSort]       = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [searchMode, setSearchMode] = useState<'keyword' | 'semantic'>('keyword');

  // Ingest dialog state
  type IngestSubject = { type: string; id: string; label: string; auto?: boolean; confidence?: string };
  const [ingestOpen,        setIngestOpen]        = useState(false);
  const [ingestTab,         setIngestTab]          = useState<'text' | 'file'>('text');
  const [ingestText,        setIngestText]         = useState('');
  const [ingestSubjects,    setIngestSubjects]     = useState<IngestSubject[]>([]);
  const [ingestSource,      setIngestSource]       = useState('');
  const [ingesting,         setIngesting]          = useState(false);
  const [detecting,         setDetecting]          = useState(false);
  const [clipboardBanner,   setClipboardBanner]    = useState<string | null>(null);
  // File upload state
  const [uploadFile,        setUploadFile]         = useState<File | null>(null);
  const [uploadText,        setUploadText]         = useState('');
  const [uploadPreview,     setUploadPreview]      = useState('');
  const [uploadTruncated,   setUploadTruncated]    = useState(false);
  const [uploadSubjects,    setUploadSubjects]     = useState<IngestSubject[]>([]);
  const [uploadSource,      setUploadSource]       = useState('');
  const [uploadParsing,     setUploadParsing]      = useState(false);
  const [uploadDragging,    setUploadDragging]     = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const detectDebounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Add Entry dialog state
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<AddEntryForm>(BLANK_ADD_FORM);
  const [adding, setAdding] = useState(false);

  // Detail drawer state
  const [selectedEntry, setSelectedEntry] = useState<any | null>(null);
  const [drawerOpen,    setDrawerOpen]    = useState(false);

  function openEntryDrawer(entry: any) {
    setSelectedEntry(entry);
    setDrawerOpen(true);
  }

  const reviewEntry      = useReviewContextEntry();
  const supersedeEntry   = useSupersedeContextEntry();
  const ingestMutation   = useContextIngest();
  const detectSubjects   = useDetectSubjects();
  const ingestFileMut    = useIngestFile();
  const createEntry      = useCreateContextEntry();

  // Smart paste: read clipboard when dialog opens
  useEffect(() => {
    if (!ingestOpen) {
      setClipboardBanner(null);
      return;
    }
    if (ingestText.trim()) return; // already has content
    navigator.clipboard.readText().then(text => {
      if (text.trim().length > 100) setClipboardBanner(text.trim());
    }).catch(() => {}); // permission denied — silently skip
  }, [ingestOpen]);

  // Auto-detect subjects from pasted text (debounced 600ms)
  const runDetect = useCallback((text: string, targetTab: 'text' | 'file') => {
    clearTimeout(detectDebounceRef.current);
    if (text.trim().length < 40) return;
    detectDebounceRef.current = setTimeout(async () => {
      setDetecting(true);
      try {
        const result = await detectSubjects.mutateAsync(text) as any;
        const detected: IngestSubject[] = (result?.subjects ?? []).map((s: any) => ({
          type: s.type,
          id: s.id,
          label: s.name,
          auto: true,
          confidence: s.confidence,
        }));
        if (targetTab === 'text') {
          setIngestSubjects(prev => {
            // Merge auto-detected with any existing manual entries
            const manual = prev.filter(s => !s.auto);
            const newIds = new Set(detected.map(d => d.id));
            const keptManual = manual.filter(s => !newIds.has(s.id));
            return [...detected, ...keptManual];
          });
        } else {
          setUploadSubjects(detected);
        }
      } catch { /* silently fail */ } finally {
        setDetecting(false);
      }
    }, 600);
  }, [detectSubjects]);

  // File upload handler
  const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB — server truncates extracted text at ~120k chars
  const handleFileUpload = useCallback(async (file: File) => {
    if (file.size > MAX_FILE_BYTES) {
      toast({
        title: 'File too large',
        description: `Maximum upload size is 15 MB. This file is ${(file.size / (1024 * 1024)).toFixed(1)} MB. Try splitting the document or pasting key excerpts as text instead.`,
        variant: 'destructive',
      });
      return;
    }
    setUploadFile(file);
    setUploadSource(file.name);
    setUploadParsing(true);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1] ?? '');
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const result = await ingestFileMut.mutateAsync({ filename: file.name, data: base64 }) as any;
      setUploadText(result.full_text ?? '');
      setUploadPreview(result.text_preview ?? '');
      setUploadTruncated(result.truncated ?? false);
      const detected: IngestSubject[] = (result.subjects ?? []).map((s: any) => ({
        type: s.type, id: s.id, label: s.name, auto: true, confidence: s.confidence,
      }));
      setUploadSubjects(detected);
    } catch (err) {
      toast({ title: 'File parsing failed', description: err instanceof Error ? err.message : 'Try a different file.', variant: 'destructive' });
      setUploadFile(null);
    } finally {
      setUploadParsing(false);
    }
  }, [ingestFileMut]);

  // Reset dialog state on close
  const closeIngestDialog = useCallback(() => {
    setIngestOpen(false);
    setIngestText('');
    setIngestSubjects([]);
    setIngestSource('');
    setIngestTab('text');
    setUploadFile(null);
    setUploadText('');
    setUploadPreview('');
    setUploadSubjects([]);
    setUploadSource('');
    setClipboardBanner(null);
    clearTimeout(detectDebounceRef.current);
  }, []);

  // Dynamic context types from registry
  const { data: contextTypesData } = useContextTypes();
  const dynamicContextTypes: string[] = useMemo(() => {
    const types = (contextTypesData as any)?.data ?? [];
    return types.map((t: any) => t.type_name);
  }, [contextTypesData]);
  const FALLBACK_CONTEXT_TYPES = [
    'transcript', 'objection', 'summary', 'research',
    'note', 'action_plan', 'competitor_intel', 'stakeholder_map',
  ];
  const contextTypeOptions = dynamicContextTypes.length > 0 ? dynamicContextTypes : FALLBACK_CONTEXT_TYPES;

  const subjectType = activeFilters.subject_type?.[0] ?? '';
  const contextType = activeFilters.context_type?.[0] ?? '';
  const staleOnly   = activeFilters.validity?.includes('stale') ?? false;

  const filterConfigs: FilterConfig[] = useMemo(() => [
    {
      key: 'subject_type',
      label: 'Subject',
      options: [
        { value: 'contact',     label: 'Contact' },
        { value: 'account',     label: 'Account' },
        { value: 'opportunity', label: 'Opportunity' },
        { value: 'use_case',    label: 'Use Case' },
      ],
    },
    {
      key: 'context_type',
      label: 'Context type',
      options: contextTypeOptions.map(t => ({ value: t, label: t.replace(/_/g, ' ') })),
    },
    {
      key: 'validity',
      label: 'Validity',
      options: [{ value: 'stale', label: 'Stale / Expired' }],
    },
  ], [contextTypeOptions]);

  // Preserve the `tab` param when clearing/changing filters so Workspace's
  // Knowledge tab doesn't get popped back to Overview.
  const preservedSetSearchParams = (updates: Record<string, string>) => {
    const tab = searchParams.get('tab');
    setSearchParams(tab ? { tab, ...updates } : updates);
  };

  const handleFilterChange = (key: string, values: string[]) => {
    setActiveFilters(prev => {
      const next = { ...prev };
      if (values.length === 0) delete next[key];
      else next[key] = values;
      return next;
    });
    preservedSetSearchParams({});
  };

  const handleSortChange = (key: string) => {
    setSort(prev =>
      prev?.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' },
    );
  };

  const clearFilters = () => {
    setActiveFilters({});
    setQ('');
    preservedSetSearchParams({});
  };

  const params = useMemo(() => ({
    subject_type: subjectType || undefined,
    context_type: contextType || undefined,
    is_current:   staleOnly ? false : undefined,
    limit:        20,
  }), [subjectType, contextType, staleOnly]);

  const {
    data: infiniteData,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useContextEntriesInfinite(params);
  const entries: any[] = useMemo(
    () => infiniteData?.pages.flatMap((p: any) => p.data ?? []) ?? [],
    [infiniteData],
  );
  const total: number = infiniteData?.pages[0]?.total ?? 0;

  const semanticParams = useMemo(() => ({
    subject_type:  subjectType || undefined,
    context_type:  contextType || undefined,
    current_only:  staleOnly ? false : undefined,
    limit:         50,
  }), [subjectType, contextType, staleOnly]);

  const {
    data: semanticData,
    isLoading: semanticLoading,
    isError: semanticError,
  } = useSemanticSearch(searchMode === 'semantic' ? q : '', semanticParams);
  const semanticEntries: any[] = (semanticData as any)?.entries ?? (semanticData as any)?.data ?? [];

  // Toast once when semantic search fails so users notice even if they scrolled past the inline banner
  const semanticErrorToastedRef = useRef(false);
  useEffect(() => {
    if (semanticError && searchMode === 'semantic' && !semanticErrorToastedRef.current) {
      semanticErrorToastedRef.current = true;
      toast({
        title: 'Semantic search unavailable',
        description: 'pgvector is not enabled on this instance. Showing keyword results instead. Set ENABLE_PGVECTOR=true to activate semantic search.',
        variant: 'destructive',
      });
    }
    if (!semanticError) semanticErrorToastedRef.current = false;
  }, [semanticError, searchMode]);

  // When semantic search errors, fall back to keyword results
  const effectiveMode = searchMode === 'semantic' && semanticError ? 'keyword' : searchMode;

  const filtered = useMemo(() => {
    let items = effectiveMode === 'semantic' ? semanticEntries : entries;

    if (effectiveMode === 'keyword' && q.trim()) {
      const lower = q.toLowerCase();
      items = items.filter((e: any) =>
        (e.title ?? '').toLowerCase().includes(lower) ||
        (e.body ?? '').toLowerCase().includes(lower) ||
        (e.tags ?? []).some((t: string) => t.toLowerCase().includes(lower)),
      );
    }

    if (sort) {
      items = [...items].sort((a: any, b: any) => {
        const av = String(a[sort.key] ?? '');
        const bv = String(b[sort.key] ?? '');
        return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }

    return items;
  }, [entries, semanticEntries, q, effectiveMode, sort]);

  const isSearching = searchMode === 'keyword' ? isLoading : (semanticError ? isLoading : semanticLoading);
  const hasFilters  = Object.keys(activeFilters).length > 0 || q;

  const handleIngest = useCallback(async () => {
    const activeText = ingestTab === 'file' ? uploadText : ingestText;
    const activeSubjects = ingestTab === 'file' ? uploadSubjects : ingestSubjects;
    const activeSource = ingestTab === 'file' ? uploadSource : ingestSource;

    const validSubjects = activeSubjects.filter(s => s.type && s.id);
    if (!activeText.trim() || validSubjects.length === 0) {
      toast({
        title: 'Missing fields',
        description: validSubjects.length === 0
          ? 'No subjects found or selected. Add one manually or paste text that mentions a contact or account.'
          : 'No document text provided.',
        variant: 'destructive',
      });
      return;
    }
    setIngesting(true);
    try {
      const results = await Promise.all(validSubjects.map(s =>
        ingestMutation.mutateAsync({
          text:         activeText,
          subject_type: s.type,
          subject_id:   s.id,
          source:       activeSource || undefined,
        }),
      ));
      const totalExtracted: number = results.reduce((sum: number, r: any) => sum + (r?.extracted_count ?? 0), 0);
      if (totalExtracted > 0) {
        toast({
          title: 'Ingestion complete',
          description: `${totalExtracted} context ${totalExtracted === 1 ? 'entry' : 'entries'} extracted across ${validSubjects.length === 1 ? '1 subject' : `${validSubjects.length} subjects`}.`,
        });
      } else {
        toast({
          title: 'Document saved',
          description: 'No entries were extracted — the Workspace Agent may not be configured, or no extractable context types are defined.',
          variant: 'destructive',
        });
      }
      closeIngestDialog();
    } catch (err) {
      toast({
        title: 'Ingestion failed',
        description: err instanceof Error ? err.message : 'Try again.',
        variant: 'destructive',
      });
    } finally {
      setIngesting(false);
    }
  }, [ingestTab, ingestText, ingestSubjects, ingestSource, uploadText, uploadSubjects, uploadSource, ingestMutation, closeIngestDialog]);

  // Handle manual entry creation
  const handleAddEntry = useCallback(async () => {
    if (!addForm.subject_type || !addForm.subject_id || !addForm.context_type || !addForm.body.trim()) {
      toast({
        title: 'Missing required fields',
        description: 'Subject, context type, and body are required.',
        variant: 'destructive',
      });
      return;
    }
    const confidenceNum = addForm.confidence !== '' ? parseFloat(addForm.confidence) : undefined;
    if (confidenceNum !== undefined && (isNaN(confidenceNum) || confidenceNum < 0 || confidenceNum > 1)) {
      toast({ title: 'Invalid confidence', description: 'Confidence must be between 0 and 1.', variant: 'destructive' });
      return;
    }
    const tags = addForm.tags
      .split(',')
      .map(t => t.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''))
      .filter(t => t.length > 0);

    setAdding(true);
    try {
      await createEntry.mutateAsync({
        subject_type: addForm.subject_type,
        subject_id: addForm.subject_id,
        context_type: addForm.context_type,
        title: addForm.title.trim() || undefined,
        body: addForm.body.trim(),
        confidence: confidenceNum,
        tags,
        source: addForm.source.trim() || undefined,
        valid_until: addForm.valid_until || undefined,
      });
      toast({ title: 'Context entry created', description: `Added to ${addForm.subject_label || addForm.subject_type}.` });
      setAddOpen(false);
      setAddForm(BLANK_ADD_FORM);
    } catch (err) {
      toast({
        title: 'Failed to create entry',
        description: err instanceof Error ? err.message : 'Try again.',
        variant: 'destructive',
      });
    } finally {
      setAdding(false);
    }
  }, [addForm, createEntry]);

  const searchModeToggle = (
    <div className="flex items-center gap-0.5 bg-muted rounded-xl p-0.5 flex-shrink-0">
      <button
        onClick={() => setSearchMode('keyword')}
        className={`flex items-center gap-1.5 h-8 px-3 rounded-lg text-sm font-medium transition-all ${
          searchMode === 'keyword'
            ? 'bg-card text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <Search className="w-3.5 h-3.5" />
        Keyword
      </button>
      <button
        onClick={() => setSearchMode('semantic')}
        className={`flex items-center gap-1.5 h-8 px-3 rounded-lg text-sm font-medium transition-all ${
          searchMode === 'semantic'
            ? 'bg-violet-600 text-white shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <Sparkles className="w-3.5 h-3.5" />
        Semantic
      </button>
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <ListToolbar
        searchValue={q}
        onSearchChange={setQ}
        searchPlaceholder={
          searchMode === 'semantic'
            ? 'Ask a question about your context…'
            : 'Search title, body, tags…'
        }
        filters={filterConfigs}
        activeFilters={activeFilters}
        onFilterChange={handleFilterChange}
        onClearFilters={clearFilters}
        sortOptions={SORT_OPTIONS}
        currentSort={sort}
        onSortChange={handleSortChange}
        onSecondaryAdd={() => { setAddForm(BLANK_ADD_FORM); setAddOpen(true); }}
        secondaryAddLabel="Add"
        onAdd={() => { setIngestOpen(true); setIngestTab('text'); }}
        addLabel="Import"
        entityType="context"
        searchSuffix={searchModeToggle}
      />

      <div className="flex-1 overflow-y-auto px-4 md:px-6 pb-24 md:pb-6">

        {/* Semantic unavailable banner */}
        {searchMode === 'semantic' && semanticError && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mb-4 px-3 py-2 bg-warning/10 border border-warning/30 rounded-lg text-xs text-warning flex items-center gap-2"
          >
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>
              Semantic search requires pgvector. Set{' '}
              <code className="px-1 py-0.5 bg-warning/20 rounded">ENABLE_PGVECTOR=true</code>{' '}
              and configure an embedding provider. Falling back to keyword search.
            </span>
          </motion.div>
        )}

        {/* Content */}
        {isSearching ? (
          <div className="text-sm text-muted-foreground py-8 text-center flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            {searchMode === 'semantic' ? 'Searching semantically…' : 'Loading…'}
          </div>
        ) : filtered.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-20 text-center"
          >
            <Library className="w-14 h-14 text-muted-foreground/30 mb-4" />
            <p className="text-base font-display font-semibold text-foreground mb-1">
              {hasFilters ? 'No entries match your filters' : 'No context entries yet'}
            </p>
            <p className="text-sm text-muted-foreground max-w-sm">
              {hasFilters
                ? searchMode === 'semantic'
                  ? 'Try rephrasing your question or adjusting filters.'
                  : 'Try adjusting your search or filters.'
                : 'Agents write context entries after every interaction. They power the briefings returned by briefing_get.'}
            </p>
            {hasFilters && (
              <Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </motion.div>
        ) : (
          <div className="space-y-2 pt-2">
            {filtered.map((entry: any, i: number) => {
              const expired = entry.valid_until ? isPast(new Date(entry.valid_until)) : false;
              return (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.02 }}
                  className={`group bg-card border rounded-xl p-4 transition-colors cursor-pointer hover:bg-muted/30 ${
                    expired
                      ? 'border-destructive/30'
                      : searchMode === 'semantic'
                      ? 'border-border border-l-2 border-l-violet-500/50'
                      : 'border-border'
                  }`}
                  onClick={() => openEntryDrawer(entry)}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        {entry.title && (
                          <span className="text-sm font-semibold text-foreground truncate max-w-xs">
                            {entry.title}
                          </span>
                        )}
                        {entry.context_type && (
                          <Badge variant="outline" className="text-xs capitalize">
                            {entry.context_type.replace(/_/g, ' ')}
                          </Badge>
                        )}
                        <SubjectChip
                          subjectType={entry.subject_type}
                          subjectId={entry.subject_id}
                          subjectName={entry.subject_name}
                        />
                        {entry.is_current === false && (
                          <Badge variant="outline" className="text-xs text-muted-foreground border-muted">
                            superseded
                          </Badge>
                        )}
                        <ConfidencePill value={entry.confidence_score} />
                        {searchMode === 'semantic' && <SimilarityPill value={entry.similarity} />}
                      </div>
                      {entry.body && (
                        <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{entry.body}</p>
                      )}
                      <div className="flex items-center gap-3 flex-wrap">
                        {entry.tags?.length > 0 && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Tag className="w-3 h-3" />
                            {entry.tags.slice(0, 4).join(', ')}
                            {entry.tags.length > 4 && ` +${entry.tags.length - 4}`}
                          </span>
                        )}
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}
                        </span>
                        <ValidUntilBadge date={entry.valid_until} />
                      </div>
                    </div>
                    {/* Right-side actions */}
                    <div
                      className="flex items-center gap-1.5 flex-shrink-0"
                      onClick={e => e.stopPropagation()}
                    >
                      {expired && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                          onClick={(e) => { e.stopPropagation(); reviewEntry.mutate(entry.id); }}
                          disabled={reviewEntry.isPending}
                        >
                          Mark reviewed
                        </Button>
                      )}
                      {!expired && entry.is_current && (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      )}
                      {/* Kebab menu */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 focus:opacity-100"
                            aria-label="Entry actions"
                          >
                            <MoreHorizontal className="w-3.5 h-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem onClick={() => openEntryDrawer(entry)}>
                            <Edit3 className="w-3.5 h-3.5 mr-2" />
                            View details
                          </DropdownMenuItem>
                          {expired && (
                            <DropdownMenuItem onClick={() => reviewEntry.mutate(entry.id)}>
                              <CheckCircle2 className="w-3.5 h-3.5 mr-2" />
                              Mark reviewed
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive focus:bg-destructive/10"
                            onClick={() => {
                              const now = new Date().toISOString().slice(0, 10);
                              supersedeEntry.mutate(
                                { id: entry.id, body: `[Forgotten by user on ${now}]`, confidence: 0 },
                                { onSuccess: () => toast({ title: 'Entry forgotten', description: 'Belief invalidated. Audit record preserved.' }) },
                              );
                            }}
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-2" />
                            Forget / Invalidate
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </motion.div>
              );
            })}
            {searchMode === 'keyword' && hasNextPage && (
              <div className="flex justify-center pt-4 pb-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="gap-2"
                >
                  {isFetchingNextPage && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {isFetchingNextPage ? 'Loading…' : `Load more (${total - entries.length} remaining)`}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Context Entry Detail Drawer ──────────────────────────────────── */}
      <ContextEntryDrawer
        entry={selectedEntry}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />

      {/* ── Import Dialog ──────────────────────────────────────────────────── */}
      <Dialog open={ingestOpen} onOpenChange={(open) => { if (!open) closeIngestDialog(); else setIngestOpen(true); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-[#0ea5e9]" />
              Import context
            </DialogTitle>
            <DialogDescription>
              Paste text or upload a file — CRMy automatically detects which contacts and accounts are mentioned.
            </DialogDescription>
          </DialogHeader>

          {/* Tab switcher */}
          <div className="flex items-center gap-0.5 bg-muted rounded-xl p-0.5 self-start">
            <button
              onClick={() => setIngestTab('text')}
              className={`flex items-center gap-1.5 h-8 px-3 rounded-lg text-sm font-medium transition-all ${ingestTab === 'text' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <FileText className="w-3.5 h-3.5" />
              Text / Paste
            </button>
            <button
              onClick={() => setIngestTab('file')}
              className={`flex items-center gap-1.5 h-8 px-3 rounded-lg text-sm font-medium transition-all ${ingestTab === 'file' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Upload className="w-3.5 h-3.5" />
              Upload File
            </button>
          </div>

          {ingestTab === 'text' ? (
            <div className="space-y-3">
              {/* Smart paste banner */}
              {clipboardBanner && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/8 border border-primary/20 text-sm">
                  <Clipboard className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                  <span className="flex-1 text-foreground">Clipboard content detected — import it?</span>
                  <button
                    onClick={() => {
                      setIngestText(clipboardBanner);
                      setClipboardBanner(null);
                      runDetect(clipboardBanner, 'text');
                    }}
                    className="text-xs font-semibold text-primary hover:underline"
                  >Use</button>
                  <button onClick={() => setClipboardBanner(null)} className="text-muted-foreground hover:text-foreground">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <Textarea
                placeholder="Paste a meeting transcript, research notes, email thread…"
                value={ingestText}
                onChange={(e) => {
                  setIngestText(e.target.value);
                  runDetect(e.target.value, 'text');
                }}
                className="min-h-[150px] text-sm"
              />

              <SubjectSection
                subjects={ingestSubjects}
                onChange={setIngestSubjects}
                detecting={detecting}
              />

              <Input
                placeholder="Source label (optional, e.g. 'Q1 review call')"
                value={ingestSource}
                onChange={(e) => setIngestSource(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
          ) : (
            <div className="space-y-3">
              {/* Dropzone */}
              {!uploadFile ? (
                <div
                  className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${uploadDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40 hover:bg-muted/30'}`}
                  onDragOver={(e) => { e.preventDefault(); setUploadDragging(true); }}
                  onDragLeave={() => setUploadDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setUploadDragging(false);
                    const f = e.dataTransfer.files[0];
                    if (f) handleFileUpload(f);
                  }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.md,.pdf,.docx,.csv"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }}
                  />
                  <Upload className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
                  <p className="text-sm font-medium text-foreground">Drop a file or click to browse</p>
                  <p className="text-xs text-muted-foreground mt-1">PDF, DOCX, TXT, MD · up to ~120,000 chars</p>
                </div>
              ) : (
                <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-primary flex-shrink-0" />
                    <span className="text-sm font-medium text-foreground flex-1 truncate">{uploadFile.name}</span>
                    <span className="text-xs text-muted-foreground">{(uploadFile.size / 1024).toFixed(0)} KB</span>
                    <button onClick={() => { setUploadFile(null); setUploadText(''); setUploadPreview(''); setUploadSubjects([]); }} className="text-muted-foreground hover:text-foreground">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  {uploadParsing ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Extracting text and detecting subjects…
                    </div>
                  ) : uploadPreview ? (
                    <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3 italic">
                      {uploadPreview}
                      {uploadTruncated && <span className="not-italic text-warning ml-1">[truncated]</span>}
                    </p>
                  ) : null}
                </div>
              )}

              <SubjectSection
                subjects={uploadSubjects}
                onChange={setUploadSubjects}
                detecting={uploadParsing}
              />

              <Input
                placeholder="Source label (e.g. 'Q1 review transcript')"
                value={uploadSource}
                onChange={(e) => setUploadSource(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeIngestDialog}>Cancel</Button>
            <Button
              onClick={handleIngest}
              disabled={ingesting || uploadParsing}
              className="gap-1.5"
            >
              {ingesting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Extract &amp; Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add Context Entry Dialog ────────────────────────────────────────── */}
      <Dialog open={addOpen} onOpenChange={(open) => { if (!open) { setAddOpen(false); setAddForm(BLANK_ADD_FORM); } else setAddOpen(true); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5 text-primary" />
              Add context entry
            </DialogTitle>
            <DialogDescription>
              Manually record a belief, preference, or note about any CRM object.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {/* Subject type + entity picker */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Subject <span className="text-destructive">*</span></label>
              <div className="flex gap-2">
                <Select
                  value={addForm.subject_type}
                  onValueChange={(v) => setAddForm(f => ({ ...f, subject_type: v, subject_id: '', subject_label: '' }))}
                >
                  <SelectTrigger className="h-9 w-36 flex-shrink-0 text-sm">
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent>
                    {SUBJECT_TYPES.map(t => (
                      <SelectItem key={t} value={t}>{subjectTypeLabel(t)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {addForm.subject_type ? (
                  <EntityPicker
                    subjectType={addForm.subject_type}
                    selectedId={addForm.subject_id}
                    selectedLabel={addForm.subject_label}
                    onSelect={(id, name) => setAddForm(f => ({ ...f, subject_id: id, subject_label: name }))}
                  />
                ) : (
                  <div className="flex-1 h-9 px-3 rounded-lg border border-border bg-muted/40 text-sm text-muted-foreground flex items-center">
                    Select a type first
                  </div>
                )}
              </div>
            </div>

            {/* Context type */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Context type <span className="text-destructive">*</span></label>
              <Select
                value={addForm.context_type}
                onValueChange={(v) => setAddForm(f => ({ ...f, context_type: v }))}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Select type…" />
                </SelectTrigger>
                <SelectContent>
                  {contextTypeOptions.map(t => (
                    <SelectItem key={t} value={t} className="capitalize">{t.replace(/_/g, ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Title */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Title <span className="opacity-40">(optional)</span></label>
              <Input
                placeholder="Short summary…"
                value={addForm.title}
                onChange={(e) => setAddForm(f => ({ ...f, title: e.target.value }))}
                className="h-9 text-sm"
              />
            </div>

            {/* Body */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Body <span className="text-destructive">*</span></label>
              <Textarea
                placeholder="What do you know about this contact or account…"
                value={addForm.body}
                onChange={(e) => setAddForm(f => ({ ...f, body: e.target.value }))}
                className="min-h-[100px] text-sm"
              />
            </div>

            {/* Confidence + Tags row */}
            <div className="flex gap-2">
              <div className="space-y-1.5 w-28 flex-shrink-0">
                <label className="text-xs font-medium text-muted-foreground">Confidence <span className="opacity-40">0–1</span></label>
                <Input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  placeholder="0.85"
                  value={addForm.confidence}
                  onChange={(e) => setAddForm(f => ({ ...f, confidence: e.target.value }))}
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5 flex-1">
                <label className="text-xs font-medium text-muted-foreground">Tags <span className="opacity-40">comma-separated</span></label>
                <Input
                  placeholder="budget, expansion, q2"
                  value={addForm.tags}
                  onChange={(e) => setAddForm(f => ({ ...f, tags: e.target.value }))}
                  className="h-9 text-sm"
                />
              </div>
            </div>

            {/* Source + Valid Until row */}
            <div className="flex gap-2">
              <div className="space-y-1.5 flex-1">
                <label className="text-xs font-medium text-muted-foreground">Source <span className="opacity-40">optional</span></label>
                <Input
                  placeholder="e.g. Q1 review call"
                  value={addForm.source}
                  onChange={(e) => setAddForm(f => ({ ...f, source: e.target.value }))}
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5 w-40 flex-shrink-0">
                <label className="text-xs font-medium text-muted-foreground">Expires <span className="opacity-40">optional</span></label>
                <Input
                  type="date"
                  value={addForm.valid_until}
                  onChange={(e) => setAddForm(f => ({ ...f, valid_until: e.target.value }))}
                  className="h-9 text-sm"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddOpen(false); setAddForm(BLANK_ADD_FORM); }}>Cancel</Button>
            <Button
              onClick={handleAddEntry}
              disabled={adding || !addForm.subject_id || !addForm.context_type || !addForm.body.trim()}
              className="gap-1.5"
            >
              {adding && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Save entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
