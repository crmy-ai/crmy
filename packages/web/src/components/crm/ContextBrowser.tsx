// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { type ReactNode, useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ListToolbar, type FilterConfig, type SortOption } from '@/components/crm/ListToolbar';
import {
  useContextEntriesInfinite,
  useReviewContextEntry,
  useContextTypes,
  useSemanticSearch,
  useContextIngest,
  useContextIngestAuto,
  useDetectSubjects,
  useIngestFile,
  useCreateContextEntry,
  usePromoteSignal,
  useRejectSignal,
  useStaleContextEntries,
  useContacts,
  useAccounts,
  useOpportunities,
  useUseCases,
} from '@/api/hooks';
import { getUser } from '@/api/client';
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
  Eye,
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
import { Checkbox } from '@/components/ui/checkbox';
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
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

function ConfidencePill({ value, variant = 'toned' }: { value: number | null | undefined; variant?: 'toned' | 'neutral' }) {
  if (value == null) return null;
  const pct = Math.round(value * 100);
  const cls = variant === 'neutral'
    ? 'rounded-full bg-muted px-2 text-muted-foreground'
    : pct >= 80
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
      {expired ? 'Needs review ' : 'Review by '}
      {formatDistanceToNow(new Date(date), { addSuffix: true })}
    </span>
  );
}

function contextEntryMatchesQuery(entry: any, rawQuery: string) {
  const needle = rawQuery.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    entry.title,
    entry.body,
    entry.subject_name,
    entry.subject_type,
    entry.context_type,
    entry.source_label,
    entry.source_ref,
    entry.source_type,
    ...(Array.isArray(entry.tags) ? entry.tags : []),
  ]
    .filter(Boolean)
    .map(value => String(value).toLowerCase())
    .join(' ');
  return haystack.includes(needle);
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

type IngestSubjectLocal = {
  type: string;
  id: string;
  label: string;
  auto?: boolean;
  confidence?: string;
  pinned?: boolean;
};

function normalizeSubjectTypeParam(value: string | null) {
  if (!value) return '';
  return value === 'use-case' ? 'use_case' : value;
}

function subjectKey(subject: Pick<IngestSubjectLocal, 'type' | 'id'>) {
  return `${subject.type}:${subject.id}`;
}

function mergeIngestSubjects(
  existing: IngestSubjectLocal[],
  incoming: IngestSubjectLocal[],
): IngestSubjectLocal[] {
  const merged = new Map<string, IngestSubjectLocal>();

  [...existing, ...incoming].forEach((subject) => {
    if (!subject.type || !subject.id) {
      merged.set(`${subject.type || 'unknown'}:${subject.id || Math.random()}`, subject);
      return;
    }
    const key = subjectKey(subject);
    const current = merged.get(key);
    if (!current) {
      merged.set(key, subject);
      return;
    }
    const pinned = Boolean(current.pinned || subject.pinned);
    merged.set(key, {
      ...current,
      ...subject,
      label: current.label || subject.label,
      confidence: subject.confidence ?? current.confidence,
      pinned,
      auto: pinned ? false : Boolean(subject.auto ?? current.auto),
    });
  });

  return Array.from(merged.values()).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
}

function PinnedSubjectBanner({
  subjects,
  onRemove,
}: {
  subjects: IngestSubjectLocal[];
  onRemove: (subject: IngestSubjectLocal) => void;
}) {
  const pinnedSubjects = subjects.filter(subject => subject.pinned && subject.type && subject.id);
  if (pinnedSubjects.length === 0) return null;

  return (
    <div className="rounded-xl border border-sky-500/25 bg-sky-500/10 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">
        Linked record
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {pinnedSubjects.map((subject) => {
          const Icon = SUBJECT_ICONS[subject.type] ?? User;
          const color = SUBJECT_COLORS[subject.type] ?? '#0ea5e9';
          return (
            <span
              key={subjectKey(subject)}
              className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold"
              style={{ background: `${color}18`, borderColor: `${color}35`, color }}
            >
              <Icon className="h-3.5 w-3.5" />
              Linked to {subjectTypeLabel(subject.type)} · {subject.label || subject.id}
              <button
                type="button"
                onClick={() => onRemove(subject)}
                className="ml-0.5 opacity-70 transition-opacity hover:opacity-100"
                aria-label={`Unlink ${subject.label || subjectTypeLabel(subject.type)}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        CRMy will attach this context to the selected record and can add other mentioned records when it finds them.
      </p>
    </div>
  );
}

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

  const removeSubject = (subject: IngestSubjectLocal) => onChange(subjects.filter(s => subjectKey(s) !== subjectKey(subject)));
  const addManual = () => setShowManual(true);

  const pinnedSubjects = subjects.filter(s => s.pinned);
  const autoSubjects = subjects.filter(s => s.auto && !s.pinned);
  const manualSubjects = subjects.filter(s => !s.auto && !s.pinned);

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
                onClick={() => removeSubject(s)}
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
              onChange([...pinnedSubjects, ...autoSubjects, ...updated]);
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
                onChange([...pinnedSubjects, ...autoSubjects, ...updated]);
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
              onChange([...pinnedSubjects, ...autoSubjects, ...updated]);
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

type IngestSummary = {
  memoryCreated: number;
  signalsCreated: number;
  skipped: number;
  returnSubject?: {
    type: string;
    id: string;
    label: string;
  } | null;
} | null;

export function ContextBrowser({
  memoryStatus = 'active',
  drawerOnly = false,
  allowAddContext = true,
  viewMode: controlledViewMode,
  headerContent,
}: {
  memoryStatus?: 'signal' | 'active';
  drawerOnly?: boolean;
  allowAddContext?: boolean;
  viewMode?: 'cards' | 'table';
  headerContent?: ReactNode;
}) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isSignalMode = memoryStatus === 'signal';

  // Initialise filters from URL params
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>(() => {
    const init: Record<string, string[]> = {};
    const st = searchParams.get('add') === 'context' ? null : searchParams.get('subject_type');
    if (st) init.subject_type = [st];
    if (searchParams.get('stale') === 'true') init.validity = ['stale'];
    return init;
  });
  const [q,          setQ]          = useState('');
  const [sort,       setSort]       = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [searchMode, setSearchMode] = useState<'keyword' | 'semantic'>('keyword');
  const [localViewMode]             = useState<'cards' | 'table'>('cards');
  const viewMode = controlledViewMode ?? localViewMode;

  // Ingest dialog state
  type IngestProposal = {
    record_type: string;
    name: string;
    confidence?: number;
    reason?: string;
    fields?: Record<string, unknown>;
    duplicate_candidates?: unknown[];
  };
  const [ingestOpen,        setIngestOpen]        = useState(false);
  const [ingestTab,         setIngestTab]          = useState<'text' | 'file'>('text');
  const [ingestText,        setIngestText]         = useState('');
  const [ingestSubjects,    setIngestSubjects]     = useState<IngestSubjectLocal[]>([]);
  const [ingestProposals,   setIngestProposals]    = useState<IngestProposal[]>([]);
  const [ingestResolutionSummary, setIngestResolutionSummary] = useState<string | null>(null);
  const [ingestSource,      setIngestSource]       = useState('');
  const [ingestOccurredAt,  setIngestOccurredAt]   = useState('');
  const [autoResolveIngest, setAutoResolveIngest]  = useState(true);
  const [ingesting,         setIngesting]          = useState(false);
  const [detecting,         setDetecting]          = useState(false);
  const [detectError,       setDetectError]        = useState<string | null>(null);
  const [clipboardBanner,   setClipboardBanner]    = useState<string | null>(null);
  // File upload state
  const [uploadFile,        setUploadFile]         = useState<File | null>(null);
  const [uploadText,        setUploadText]         = useState('');
  const [uploadPreview,     setUploadPreview]      = useState('');
  const [uploadTruncated,   setUploadTruncated]    = useState(false);
  const [uploadSubjects,    setUploadSubjects]     = useState<IngestSubjectLocal[]>([]);
  const [uploadProposals,   setUploadProposals]    = useState<IngestProposal[]>([]);
  const [uploadResolutionSummary, setUploadResolutionSummary] = useState<string | null>(null);
  const [uploadSource,      setUploadSource]       = useState('');
  const [uploadOccurredAt,  setUploadOccurredAt]   = useState('');
  const [uploadParsing,     setUploadParsing]      = useState(false);
  const [uploadDragging,    setUploadDragging]     = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const detectDebounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Add Entry dialog state
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<AddEntryForm>(BLANK_ADD_FORM);
  const [adding, setAdding] = useState(false);
  const [ingestSummary, setIngestSummary] = useState<IngestSummary>(null);
  const openDrawer = useAppStore(s => s.openDrawer);

  // Detail drawer state
  const [selectedEntry, setSelectedEntry] = useState<any | null>(null);
  const [drawerOpen,    setDrawerOpen]    = useState(false);

  function openEntryDrawer(entry: any) {
    setSelectedEntry(entry);
    setDrawerOpen(true);
  }

  const reviewEntry      = useReviewContextEntry();
  const supersedeEntry   = useSupersedeContextEntry();
  const promoteSignal    = usePromoteSignal();
  const rejectSignal     = useRejectSignal();
  const ingestMutation   = useContextIngest();
  const ingestAutoMut    = useContextIngestAuto();
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

  useEffect(() => {
    if (searchParams.get('add') !== 'context') return;
    const rawSubjectType = normalizeSubjectTypeParam(searchParams.get('subject_type'));
    const subjectId = searchParams.get('subject_id') ?? '';
    const subjectLabel = searchParams.get('subject_label') ?? '';
    const validSubjectType = SUBJECT_TYPES.includes(rawSubjectType as (typeof SUBJECT_TYPES)[number]);
    const pinnedSubject: IngestSubjectLocal | null = validSubjectType && subjectId
      ? {
          type: rawSubjectType,
          id: subjectId,
          label: subjectLabel || subjectTypeLabel(rawSubjectType),
          auto: false,
          pinned: true,
        }
      : null;

    setIngestOpen(true);
    setIngestTab('text');
    if (pinnedSubject) {
      setIngestSubjects(prev => mergeIngestSubjects(prev, [pinnedSubject]));
      setUploadSubjects(prev => mergeIngestSubjects(prev, [pinnedSubject]));
    }
    const next = new URLSearchParams(searchParams);
    next.delete('add');
    next.delete('subject_type');
    next.delete('subject_id');
    next.delete('subject_label');
    next.delete('return_subject_type');
    next.delete('return_subject_id');
    next.delete('return_subject_label');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // Auto-detect subjects from pasted text (debounced 600ms)
  const runDetect = useCallback((text: string, targetTab: 'text' | 'file') => {
    clearTimeout(detectDebounceRef.current);
    if (text.trim().length < 40) return;
    detectDebounceRef.current = setTimeout(async () => {
      setDetecting(true);
      setDetectError(null);
      try {
        const result = await detectSubjects.mutateAsync(text) as any;
        const detected: IngestSubjectLocal[] = (result?.subjects ?? []).map((s: any) => ({
          type: s.type,
          id: s.id,
          label: s.name,
          auto: true,
          confidence: s.confidence,
        }));
        const proposals: IngestProposal[] = result?.proposed_records ?? [];
        if (targetTab === 'text') {
          setIngestProposals(proposals);
          setIngestResolutionSummary(result?.resolution_summary ?? null);
          setIngestSubjects(prev => mergeIngestSubjects(prev, detected));
        } else {
          setUploadProposals(proposals);
          setUploadResolutionSummary(result?.resolution_summary ?? null);
          setUploadSubjects(prev => mergeIngestSubjects(prev, detected));
        }
      } catch (err) {
        setDetectError(err instanceof Error
          ? err.message
          : 'Workspace Agent could not match customer records automatically.');
      } finally {
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
      const result = await ingestFileMut.mutateAsync({ filename: file.name, data: base64, include_text: true }) as any;
      setUploadText(result.full_text ?? '');
      setUploadPreview(result.text_preview ?? '');
      setUploadTruncated(result.truncated ?? false);
      setDetectError(result.subject_detection_error ?? null);
      const detected: IngestSubjectLocal[] = (result.subjects ?? []).map((s: any) => ({
        type: s.type, id: s.id, label: s.name, auto: true, confidence: s.confidence,
      }));
      setUploadSubjects(prev => mergeIngestSubjects(prev, detected));
      setUploadProposals(result.proposed_records ?? []);
      setUploadResolutionSummary(result.resolution_summary ?? null);
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
    setIngestProposals([]);
    setIngestResolutionSummary(null);
    setIngestSource('');
    setIngestOccurredAt('');
    setAutoResolveIngest(true);
    setIngestTab('text');
    setUploadFile(null);
    setUploadText('');
    setUploadPreview('');
    setUploadSubjects([]);
    setUploadProposals([]);
    setUploadResolutionSummary(null);
    setUploadSource('');
    setUploadOccurredAt('');
    setClipboardBanner(null);
    setDetectError(null);
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

  // Preserve the `tab` param when clearing/changing filters so Context stays
  // on the Current Memory, Signals, or Memory Health view.
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
    memory_status: memoryStatus,
    q:             searchMode === 'keyword' ? q.trim() || undefined : undefined,
    limit:        20,
  }), [subjectType, contextType, memoryStatus, searchMode, q]);

  const staleQuery = useStaleContextEntries({
    subject_type: subjectType || undefined,
    limit: 200,
  }) as any;
  const staleEntries: any[] = useMemo(() => {
    const rows = staleQuery.data?.stale_entries ?? staleQuery.data?.data ?? [];
    return contextType ? rows.filter((entry: any) => entry.context_type === contextType) : rows;
  }, [staleQuery.data, contextType]);

  const {
    data: infiniteData,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useContextEntriesInfinite(params);
  const entries: any[] = useMemo(
    () => staleOnly ? staleEntries : infiniteData?.pages.flatMap((p: any) => p.data ?? []) ?? [],
    [infiniteData, staleOnly, staleEntries],
  );
  const recentKeywordEntriesRef = useRef<any[]>([]);
  const total: number = staleOnly ? staleEntries.length : infiniteData?.pages[0]?.total ?? 0;

  const semanticParams = useMemo(() => ({
    subject_type:  subjectType || undefined,
    context_type:  contextType || undefined,
    memory_status: memoryStatus,
    limit:         50,
  }), [subjectType, contextType, memoryStatus]);

  const {
    data: semanticData,
    isLoading: semanticLoading,
    isError: semanticError,
  } = useSemanticSearch(searchMode === 'semantic' ? q : '', semanticParams);
  const semanticEntries: any[] = (semanticData as any)?.entries ?? (semanticData as any)?.data ?? [];
  const semanticUnavailable = searchMode === 'semantic' && (semanticError || Boolean((semanticData as any)?.error));
  const showSemanticFallbackNote = semanticUnavailable && q.trim().length >= 2;
  const semanticUnavailableMessage = (semanticData as any)?.error
    ? String((semanticData as any).error)
    : 'Semantic search is not ready on this workspace.';
  const currentUser = getUser();
  const canOpenDatabaseSettings = currentUser?.role === 'admin' || currentUser?.role === 'owner';

  useEffect(() => {
    if (!staleOnly && searchMode === 'keyword' && !q.trim() && entries.length > 0) {
      recentKeywordEntriesRef.current = entries;
    }
  }, [entries, q, searchMode, staleOnly]);

  // When semantic search errors, fall back to keyword results
  const effectiveMode = searchMode === 'semantic' && semanticUnavailable ? 'keyword' : searchMode;

  const filtered = useMemo(() => {
    let items = staleOnly ? entries : effectiveMode === 'semantic' ? semanticEntries : entries;
    const keywordQuery = q.trim();
    if (!staleOnly && effectiveMode === 'keyword' && keywordQuery) {
      const localBase = entries.length > 0 ? entries : recentKeywordEntriesRef.current;
      const localMatches = localBase.filter(entry => contextEntryMatchesQuery(entry, keywordQuery));
      if (items.length === 0 && localMatches.length > 0) items = localMatches;
    }

    if (sort) {
      items = [...items].sort((a: any, b: any) => {
        const av = String(a[sort.key] ?? '');
        const bv = String(b[sort.key] ?? '');
        return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }

    return items;
  }, [entries, semanticEntries, q, effectiveMode, sort, staleOnly]);

  const isSearching = staleOnly
    ? staleQuery.isLoading
    : searchMode === 'keyword'
    ? isLoading
    : (semanticUnavailable ? isLoading : semanticLoading);
  const hasFilters  = Object.keys(activeFilters).length > 0 || q;
  const displayedTotal = q.trim() && effectiveMode === 'keyword' && total === 0 && filtered.length > 0
    ? filtered.length
    : total;

  const handleIngest = useCallback(async () => {
    const activeText = ingestTab === 'file' ? uploadText : ingestText;
    const activeSubjects = ingestTab === 'file' ? uploadSubjects : ingestSubjects;
    const activeProposals = ingestTab === 'file' ? uploadProposals : ingestProposals;
    const activeSource = ingestTab === 'file' ? uploadSource : ingestSource;
    const activeOccurredAt = ingestTab === 'file' ? uploadOccurredAt : ingestOccurredAt;
    const returnSubject = activeSubjects.find(subject => subject.pinned && subject.type && subject.id) ?? null;

    const validSubjects = activeSubjects.filter(s => s.type && s.id);
    if (!activeText.trim() || (!autoResolveIngest && validSubjects.length === 0)) {
      toast({
        title: 'Missing fields',
        description: !autoResolveIngest && validSubjects.length === 0
          ? 'Choose at least one customer record, or turn on automatic subject matching.'
          : 'No document text provided.',
        variant: 'destructive',
      });
      return;
    }
    setIngesting(true);
    try {
      const useResolvedSubjects = validSubjects.length > 0;
      const results = autoResolveIngest
        ? [await ingestAutoMut.mutateAsync({
            text: activeText,
            source: activeSource || undefined,
            source_occurred_at: activeOccurredAt || undefined,
            subjects: useResolvedSubjects
              ? validSubjects.map(subject => ({
                  type: subject.type,
                  id: subject.id,
                  name: subject.label,
                }))
              : undefined,
            proposed_records: activeProposals.length > 0 ? activeProposals : undefined,
          })]
        : [];
      if (!autoResolveIngest) {
        for (const subject of validSubjects) {
          results.push(await ingestMutation.mutateAsync({
              text:         activeText,
              subject_type: subject.type,
              subject_id:   subject.id,
              source:       activeSource || undefined,
          }));
        }
      }
      const totalExtracted: number = results.reduce((sum: number, r: any) => sum + (r?.extracted_count ?? 0), 0);
      const memoryCreated = results.reduce((sum: number, r: any) => sum + Number(r?.memory_created ?? r?.memory_entries?.length ?? 0), 0);
      const signalsCreated = results.reduce((sum: number, r: any) => sum + Number(r?.signals_created ?? r?.signals?.length ?? 0), 0);
      const skipped = results.reduce((sum: number, r: any) => {
        const explicit = Number(r?.skipped ?? 0);
        return sum + (explicit > 0 ? explicit : r?.subjects_resolved?.length === 0 && totalExtracted === 0 ? 1 : 0);
      }, 0);
      const proposedRecords = results.reduce((sum: number, r: any) => sum + Number(r?.proposed_records?.length ?? 0), 0);
      const handoffRequests = results.reduce((sum: number, r: any) => sum + Number(r?.handoff_requests?.length ?? 0), 0);
      const resolutionSummary = (results.find((r: any) => typeof r?.resolution_summary === 'string') as any)?.resolution_summary;
      setIngestSummary({ memoryCreated, signalsCreated, skipped, returnSubject });
      if (totalExtracted > 0) {
        toast({
          title: 'Context processed',
          description: `${resolutionSummary ? `${resolutionSummary} ` : ''}${memoryCreated} Memory created, ${signalsCreated} ${signalsCreated === 1 ? 'Signal needs' : 'Signals need'} review${handoffRequests > 0 ? `, ${handoffRequests} record ${handoffRequests === 1 ? 'proposal' : 'proposals'} sent to Handoffs` : ''}, ${skipped} skipped.`,
        });
        closeIngestDialog();
      } else if (handoffRequests > 0 || proposedRecords > 0) {
        toast({
          title: 'Record review created',
          description: handoffRequests > 0
            ? `${handoffRequests} possible new ${handoffRequests === 1 ? 'record was' : 'records were'} sent to Handoffs for review.`
            : `${proposedRecords} possible new ${proposedRecords === 1 ? 'record needs' : 'records need'} review before CRMy creates anything.`,
        });
        closeIngestDialog();
      } else {
        const firstResult = results[0] as any;
        const matchedCount = Number(firstResult?.subjects_resolved?.length ?? 0);
        const reason = firstResult?.message
          ?? firstResult?.source?.failure_reason
          ?? firstResult?.processing_receipts?.find((receipt: any) => receipt?.failure_reason)?.failure_reason;
        toast({
          title: matchedCount > 0 || useResolvedSubjects ? 'No Signals extracted' : 'No customer record matched',
          description: autoResolveIngest && !useResolvedSubjects
            ? matchedCount > 0
              ? reason || `CRMy matched ${matchedCount} customer ${matchedCount === 1 ? 'record' : 'records'}, but the Workspace Agent did not find customer-specific Signals to save. Add more detail or choose a record manually.`
              : reason || 'No customer records were confidently matched. Add matching contacts/accounts or choose a subject manually.'
            : reason || 'CRMy processed the selected customer record, but did not find evidence-backed Signals to save. Add more specific customer statements, next steps, risks, commitments, or decision details.',
          variant: 'destructive',
        });
      }
    } catch (err) {
      toast({
        title: 'Ingestion failed',
        description: err instanceof Error ? err.message : 'Try again.',
        variant: 'destructive',
      });
    } finally {
      setIngesting(false);
    }
  }, [autoResolveIngest, ingestTab, ingestText, ingestSubjects, ingestProposals, ingestSource, ingestOccurredAt, uploadText, uploadSubjects, uploadProposals, uploadSource, uploadOccurredAt, ingestAutoMut, ingestMutation, closeIngestDialog]);

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
        memory_status: 'active',
        tags,
        source: addForm.source.trim() || undefined,
        valid_until: addForm.valid_until || undefined,
      });
      toast({
        title: 'Memory saved',
        description: `Added to ${addForm.subject_label || addForm.subject_type}.`,
      });
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

  const activePinnedSubjects = (ingestTab === 'file' ? uploadSubjects : ingestSubjects)
    .filter(subject => subject.pinned && subject.type && subject.id);
  const removePinnedSubject = useCallback((subject: IngestSubjectLocal) => {
    setIngestSubjects(prev => prev.filter(item => subjectKey(item) !== subjectKey(subject)));
    setUploadSubjects(prev => prev.filter(item => subjectKey(item) !== subjectKey(subject)));
  }, []);

  const searchModeToggle = (
    <div className="flex items-center gap-2 flex-shrink-0">
      <div className="flex items-center gap-0.5 bg-muted rounded-xl p-0.5">
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-9 px-3 gap-1.5">
            <MoreHorizontal className="w-4 h-4" />
            <span className="hidden sm:inline">Advanced</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onClick={() => { setAddForm(BLANK_ADD_FORM); setAddOpen(true); }}>
            <Edit3 className="w-3.5 h-3.5 mr-2" />
            Write Memory manually
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {!drawerOnly && (
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
        onAdd={allowAddContext ? () => { setIngestOpen(true); setIngestTab('text'); } : undefined}
        addLabel={allowAddContext ? 'Add Context' : undefined}
        entityType="context"
        searchSuffix={searchModeToggle}
      />

      <div className="flex-1 overflow-y-auto px-4 md:px-6 pb-24 md:pb-6">
        {headerContent}
        {ingestSummary && (
          <div className="mb-4 rounded-xl border border-border bg-card px-4 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-foreground">Context processed</p>
                <p className="text-sm text-muted-foreground">
                  {ingestSummary.memoryCreated} Memory created · {ingestSummary.signalsCreated} Signals need attention · {ingestSummary.skipped} skipped
                </p>
              </div>
              <div className="flex items-center gap-2">
                {ingestSummary.returnSubject && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const drawerType = DRAWER_TYPE_MAP[ingestSummary.returnSubject!.type] ?? 'account';
                      openDrawer(drawerType, ingestSummary.returnSubject!.id);
                    }}
                  >
                    Back to {ingestSummary.returnSubject.label || subjectTypeLabel(ingestSummary.returnSubject.type)}
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => preservedSetSearchParams({ tab: 'signals' })}>
                  Review Signals
                </Button>
                <Button variant="outline" size="sm" onClick={() => preservedSetSearchParams({ tab: 'browser' })}>
                  View Memory
                </Button>
              </div>
            </div>
          </div>
        )}
        {isSignalMode && (
          <div className="mb-4 rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-foreground">Signals are raw inferences</p>
                <p className="text-sm text-muted-foreground">
                  CRMy combines supporting evidence across sources so confirmed Signals can become Memory.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground whitespace-nowrap">
                <span>Sources</span>
                <span className="text-violet-500">→</span>
                <span className="text-violet-600 dark:text-violet-300">Signals</span>
                <span className="text-violet-500">→</span>
                <span>Memory</span>
              </div>
            </div>
          </div>
        )}

        {/* Semantic search setup note */}
        {showSemanticFallbackNote && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            role={canOpenDatabaseSettings ? 'link' : 'status'}
            tabIndex={canOpenDatabaseSettings ? 0 : undefined}
            onClick={canOpenDatabaseSettings ? () => navigate('/settings/database') : undefined}
            onKeyDown={canOpenDatabaseSettings ? event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                navigate('/settings/database');
              }
            } : undefined}
            className={`mb-4 flex items-start gap-2 rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2 text-xs text-muted-foreground ${
              canOpenDatabaseSettings ? 'cursor-pointer transition-colors hover:border-violet-500/35 hover:bg-violet-500/10 focus:outline-none focus:ring-2 focus:ring-violet-500/30' : ''
            }`}
            title={canOpenDatabaseSettings ? 'Open Database Settings' : undefined}
          >
            <Search className="mt-0.5 h-4 w-4 flex-shrink-0 text-violet-500" />
            <span>
              Showing keyword matches for this search because semantic search is not ready.{' '}
              {canOpenDatabaseSettings
                ? 'Open Database Settings to enable pgvector and an embedding provider.'
                : 'Ask an admin to enable semantic search in Database Settings.'}
              <span className="sr-only"> {semanticUnavailableMessage}</span>
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
              {hasFilters
                ? memoryStatus === 'signal' ? 'No Signals match your filters' : staleOnly ? 'No Memory needs review' : 'No Memory matches your filters'
                : memoryStatus === 'signal' ? 'No Signals waiting for review' : 'No Current Memory yet'}
            </p>
            <p className="text-sm text-muted-foreground max-w-sm">
              {hasFilters
                ? searchMode === 'semantic'
                  ? 'Try rephrasing your question or adjusting filters.'
                  : 'Try adjusting your search or filters.'
                : memoryStatus === 'signal'
                ? 'Sources from calls, emails, documents, and systems of record create Signals here before they become Memory.'
                : 'Current Memory powers briefings, agent work, handoffs, and governed writeback.'}
            </p>
            {hasFilters && (
              <Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </motion.div>
        ) : viewMode === 'table' ? (
          <>
          <p className="mb-3 text-xs text-muted-foreground">
            {effectiveMode === 'semantic'
              ? `Showing ${filtered.length.toLocaleString()} top semantic matches.`
              : `Showing ${filtered.length.toLocaleString()} of ${displayedTotal.toLocaleString()} ${q.trim() ? 'matching ' : ''}${memoryStatus === 'signal' ? 'Signals' : 'Memory entries'}.`}
            {' '}Use search, record, type, and semantic search to narrow large workspaces.
          </p>
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-sunken/50">
                    <th className="px-4 py-3 text-left text-xs font-display font-semibold text-muted-foreground">Memory</th>
                    <th className="px-4 py-3 text-left text-xs font-display font-semibold text-muted-foreground">Subject</th>
                    <th className="px-4 py-3 text-left text-xs font-display font-semibold text-muted-foreground">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-display font-semibold text-muted-foreground">Confidence</th>
                    <th className="px-4 py-3 text-left text-xs font-display font-semibold text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-display font-semibold text-muted-foreground">Updated</th>
                    <th className="px-4 py-3 text-right text-xs font-display font-semibold text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((entry: any, index: number) => {
                    const expired = entry.valid_until ? isPast(new Date(entry.valid_until)) : false;
                    return (
                      <tr
                        key={entry.id}
                        onClick={() => openEntryDrawer(entry)}
                        className={`cursor-pointer border-b border-border transition-colors hover:bg-primary/5 last:border-0 ${index % 2 === 1 ? 'bg-surface-sunken/30' : ''}`}
                      >
                        <td className="max-w-[30rem] px-4 py-3">
                          <div className="font-semibold text-foreground line-clamp-1">{entry.title || entry.body || 'Untitled Memory'}</div>
                          {entry.body && <div className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{entry.body}</div>}
                        </td>
                        <td className="px-4 py-3">
                          <SubjectChip subjectType={entry.subject_type} subjectId={entry.subject_id} subjectName={entry.subject_name} />
                        </td>
                        <td className="px-4 py-3 capitalize text-muted-foreground">{String(entry.context_type ?? 'context').replace(/_/g, ' ')}</td>
                        <td className="px-4 py-3"><ConfidencePill value={entry.confidence_score} /></td>
                        <td className="px-4 py-3">
                          {entry.is_current === false ? (
                            <Badge variant="outline" className="text-xs text-muted-foreground border-muted">Superseded</Badge>
                          ) : expired ? (
                            <Badge className="text-xs bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20">Needs review</Badge>
                          ) : (
                            <Badge className="text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20">Current</Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(entry.updated_at ?? entry.created_at), { addSuffix: true })}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(event) => {
                              event.stopPropagation();
                              openEntryDrawer(entry);
                            }}
                          >
                            Details
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          </>
        ) : (
          <>
            <p className="mb-3 text-xs text-muted-foreground">
              {effectiveMode === 'semantic'
                ? `Showing ${filtered.length.toLocaleString()} top semantic matches.`
                : `Showing ${filtered.length.toLocaleString()} of ${displayedTotal.toLocaleString()} ${q.trim() ? 'matching ' : ''}${memoryStatus === 'signal' ? 'Signals' : 'Memory entries'}.`}
              {' '}Use search, record, type, and semantic search to narrow large workspaces.
            </p>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {filtered.map((entry: any, i: number) => {
                const expired = entry.valid_until ? isPast(new Date(entry.valid_until)) : false;
                const isSignal = entry.memory_status === 'signal';
                const isSuperseded = entry.is_current === false;
                return (
                  <motion.article
                    key={entry.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.02 }}
                    className={`group flex min-h-[14rem] cursor-pointer flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition-colors hover:border-primary/30 hover:bg-card/95 ${
                      expired ? 'border-amber-500/30' : searchMode === 'semantic' ? 'border-violet-500/30' : 'border-border'
                    }`}
                    onClick={() => openEntryDrawer(entry)}
                  >
                    <div className="flex flex-1 items-start gap-3 p-4">
                      <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-500">
                        <FileText className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="mb-2 flex flex-wrap items-center gap-1.5">
                          {isSignal ? (
                            <Badge className="text-xs bg-violet-600/10 text-violet-700 dark:text-violet-300 border border-violet-500/20">Signal</Badge>
                          ) : isSuperseded ? (
                            <Badge variant="outline" className="text-xs text-muted-foreground border-muted">Superseded</Badge>
                          ) : expired ? (
                            <Badge className="text-xs bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20">Needs review</Badge>
                          ) : (
                            <Badge className="text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20">Current</Badge>
                          )}
                          {entry.context_type && (
                            <Badge variant="outline" className="text-xs capitalize">
                              {entry.context_type.replace(/_/g, ' ')}
                            </Badge>
                          )}
                          {searchMode === 'semantic' && <SimilarityPill value={entry.similarity} />}
                        </div>
                        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
                          {entry.title || entry.body || 'Untitled Memory'}
                        </h3>
                        {entry.body && (
                          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{entry.body}</p>
                        )}
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <SubjectChip subjectType={entry.subject_type} subjectId={entry.subject_id} subjectName={entry.subject_name} />
                          <ConfidencePill value={entry.confidence_score} variant="neutral" />
                          {Array.isArray(entry.evidence) && entry.evidence.length > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-300">
                              <FileText className="h-3 w-3" />
                              {entry.evidence.length} evidence
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface-sunken/30 px-3 py-2" onClick={event => event.stopPropagation()}>
                      <div className="flex justify-start">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground" aria-label="Entry actions">
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="w-44">
                            <DropdownMenuItem onClick={() => openEntryDrawer(entry)}>
                              <Eye className="mr-2 h-3.5 w-3.5" />
                              Details
                            </DropdownMenuItem>
                            {!isSignal && (
                              <DropdownMenuItem onClick={() => navigate(`/context?tab=lineage&context_entry_id=${entry.id}`)}>
                                <FileText className="mr-2 h-3.5 w-3.5" />
                                View Lineage
                              </DropdownMenuItem>
                            )}
                            {isSignal && (
                              <DropdownMenuItem
                                onClick={() => rejectSignal.mutate(
                                  { id: entry.id, reason: 'Rejected from Signals review' },
                                  { onSuccess: () => toast({ title: 'Signal dismissed', description: 'It will stay out of Memory.' }) },
                                )}
                              >
                                <X className="mr-2 h-3.5 w-3.5" />
                                Dismiss Signal
                              </DropdownMenuItem>
                            )}
                            {expired && (
                              <DropdownMenuItem onClick={() => reviewEntry.mutate(entry.id)}>
                                <CheckCircle2 className="mr-2 h-3.5 w-3.5" />
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
                              <Trash2 className="mr-2 h-3.5 w-3.5" />
                              Forget / Invalidate
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          {entry.tags?.length > 0 && (
                            <span className="inline-flex items-center gap-1">
                              <Tag className="h-3 w-3" />
                              {entry.tags.slice(0, 3).join(', ')}
                              {entry.tags.length > 3 && ` +${entry.tags.length - 3}`}
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}
                          </span>
                          <ValidUntilBadge date={entry.valid_until} />
                      </div>
                      <div className="ml-auto flex flex-wrap justify-end gap-2">
                        {expired && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs text-amber-600 border-amber-500/30 hover:bg-amber-500/10"
                            onClick={() => reviewEntry.mutate(entry.id)}
                            disabled={reviewEntry.isPending}
                          >
                            <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                            Mark reviewed
                          </Button>
                        )}
                        {isSignal && (
                          <Button
                            size="sm"
                            className="h-7 bg-emerald-600 text-xs text-white hover:bg-emerald-600/90"
                            onClick={() => promoteSignal.mutate(
                              { id: entry.id },
                              { onSuccess: () => toast({ title: 'Promoted to Memory', description: 'Agents can now use this as confirmed operational context.' }) },
                            )}
                            disabled={promoteSignal.isPending}
                          >
                            <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                            Confirm Signal
                          </Button>
                        )}
                      </div>
                    </div>
                  </motion.article>
                );
              })}
            </div>
            {!staleOnly && searchMode === 'keyword' && hasNextPage && (
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
          </>
        )}
      </div>

      {/* ── Context Entry Detail Drawer ──────────────────────────────────── */}
      <ContextEntryDrawer
        entry={selectedEntry}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
      </>
      )}

      {/* ── Add Context Drawer ─────────────────────────────────────────────── */}
      <Sheet open={ingestOpen} onOpenChange={(open) => { if (!open) closeIngestDialog(); else setIngestOpen(true); }}>
        <SheetContent side="right" className="flex h-full w-full flex-col gap-0 p-0 sm:max-w-2xl">
          <SheetHeader className="border-b border-border px-5 pb-4 pt-5 text-left">
            <SheetTitle className="flex items-center gap-2 text-base">
              <FileText className="w-5 h-5 text-[#0ea5e9]" />
              Add Context
            </SheetTitle>
            <SheetDescription>
              Paste transcripts, emails, meeting notes, support updates, or research. CRMy extracts Signals and promotes high-confidence items to Memory.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {/* Tab switcher */}
            <div className="flex items-center gap-0.5 bg-muted rounded-xl p-0.5 self-start">
            <button
              onClick={() => setIngestTab('text')}
              className={`flex items-center gap-1.5 h-8 px-3 rounded-lg text-sm font-medium transition-all ${ingestTab === 'text' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <FileText className="w-3.5 h-3.5" />
              Paste text
            </button>
            <button
              onClick={() => setIngestTab('file')}
              className={`flex items-center gap-1.5 h-8 px-3 rounded-lg text-sm font-medium transition-all ${ingestTab === 'file' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Upload className="w-3.5 h-3.5" />
              Upload file
            </button>
            </div>

            <PinnedSubjectBanner subjects={activePinnedSubjects} onRemove={removePinnedSubject} />

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
                placeholder="Paste a meeting transcript, research notes, email thread, support update, or product usage summary…"
                value={ingestText}
                onChange={(e) => {
                  setIngestText(e.target.value);
                  runDetect(e.target.value, 'text');
                }}
                className="min-h-[320px] resize-y text-sm leading-6 md:min-h-[46vh]"
              />

              <div className="rounded-xl border border-border bg-muted/30 p-3">
                <label className="flex items-start gap-3">
                  <Checkbox
                    checked={autoResolveIngest}
                    onCheckedChange={(checked) => setAutoResolveIngest(Boolean(checked))}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-foreground">Match customer records automatically</span>
                    <span className="block text-xs text-muted-foreground">
                      {activePinnedSubjects.length > 0
                        ? 'CRMy will attach this context to the selected record and can add other mentioned records when it finds them.'
                        : 'CRMy will find the contacts and accounts mentioned here, extract Signals, and promote high-confidence items to Memory.'}
                    </span>
                    {autoResolveIngest && ingestSubjects.length > 0 && (
                      <span className="mt-2 block text-xs text-muted-foreground">
                        {ingestResolutionSummary ?? `Detected ${ingestSubjects.length} possible ${ingestSubjects.length === 1 ? 'subject' : 'subjects'} for matching.`}
                      </span>
                    )}
                  </span>
                </label>
              </div>
              {autoResolveIngest && detectError && (
                <div className="flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/10 p-3 text-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" />
                  <div>
                    <p className="font-semibold text-foreground">Automatic matching needs attention</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {detectError} You can still turn off automatic matching and choose the customer record manually.
                    </p>
                  </div>
                </div>
              )}

              {!autoResolveIngest && (
                <SubjectSection
                  subjects={ingestSubjects}
                  onChange={setIngestSubjects}
                  detecting={detecting}
                />
              )}

              <div className="grid gap-2 sm:grid-cols-[1fr_220px]">
                <Input
                  placeholder="Source label (optional, e.g. 'Q1 review call')"
                  value={ingestSource}
                  onChange={(e) => setIngestSource(e.target.value)}
                  className="h-9 text-sm"
                />
                <Input
                  type="datetime-local"
                  aria-label="Context event time"
                  value={ingestOccurredAt}
                  onChange={(e) => setIngestOccurredAt(e.target.value)}
                  className="h-9 text-sm text-muted-foreground"
                  title="When this customer context happened. This helps CRMy avoid treating the same source as new corroboration."
                />
              </div>
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
                    <button onClick={() => { setUploadFile(null); setUploadText(''); setUploadPreview(''); setUploadSubjects(prev => prev.filter(subject => subject.pinned)); setUploadProposals([]); }} className="text-muted-foreground hover:text-foreground">
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

              <div className="rounded-xl border border-border bg-muted/30 p-3">
                <label className="flex items-start gap-3">
                  <Checkbox
                    checked={autoResolveIngest}
                    onCheckedChange={(checked) => setAutoResolveIngest(Boolean(checked))}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-foreground">Match customer records automatically</span>
                    <span className="block text-xs text-muted-foreground">
                      {activePinnedSubjects.length > 0
                        ? 'CRMy will attach this file to the selected record and can add other mentioned records when it finds them.'
                        : 'CRMy will resolve the file to matching customer records before extracting Signals and Memory.'}
                    </span>
                    {autoResolveIngest && uploadSubjects.length > 0 && (
                      <span className="mt-2 block text-xs text-muted-foreground">
                        {uploadResolutionSummary ?? `Detected ${uploadSubjects.length} possible ${uploadSubjects.length === 1 ? 'subject' : 'subjects'} for matching.`}
                      </span>
                    )}
                  </span>
                </label>
              </div>
              {autoResolveIngest && detectError && (
                <div className="flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/10 p-3 text-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" />
                  <div>
                    <p className="font-semibold text-foreground">Automatic matching needs attention</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {detectError} You can still turn off automatic matching and choose the customer record manually.
                    </p>
                  </div>
                </div>
              )}

              {!autoResolveIngest && (
                <SubjectSection
                  subjects={uploadSubjects}
                  onChange={setUploadSubjects}
                  detecting={uploadParsing}
                />
              )}

              <div className="grid gap-2 sm:grid-cols-[1fr_220px]">
                <Input
                  placeholder="Source label (e.g. 'Q1 review transcript')"
                  value={uploadSource}
                  onChange={(e) => setUploadSource(e.target.value)}
                  className="h-9 text-sm"
                />
                <Input
                  type="datetime-local"
                  aria-label="Context event time"
                  value={uploadOccurredAt}
                  onChange={(e) => setUploadOccurredAt(e.target.value)}
                  className="h-9 text-sm text-muted-foreground"
                  title="When this customer context happened. This helps CRMy avoid treating the same source as new corroboration."
                />
              </div>
              </div>
            )}
          </div>

          <SheetFooter className="border-t border-border px-5 py-4">
            <Button variant="outline" onClick={closeIngestDialog}>Cancel</Button>
            <Button
              onClick={handleIngest}
              disabled={ingesting || uploadParsing || detecting}
              className="gap-1.5 bg-[#0ea5e9] text-white hover:bg-[#0284c7]"
            >
              {ingesting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {detecting ? 'Matching records…' : 'Add Context'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* ── Add Context Entry Dialog ────────────────────────────────────────── */}
      <Dialog open={addOpen} onOpenChange={(open) => { if (!open) { setAddOpen(false); setAddForm(BLANK_ADD_FORM); } else setAddOpen(true); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5 text-primary" />
              Write Memory manually
            </DialogTitle>
            <DialogDescription>
              Record confirmed context directly. For transcripts, emails, notes, or other messy source material, use Add Context instead.
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
              Save Memory
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
