// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { TopBar } from '@/components/layout/TopBar';
import { AgentStatusDot } from '@/components/crm/CrmWidgets';
import { EntityCombobox, type EntityType } from '@/components/ui/entity-combobox';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAppStore, type AIContextEntity } from '@/store/appStore';
import { useAgentSettings } from '@/contexts/AgentSettingsContext';
import { toast } from '@/hooks/use-toast';
import {
  useAgentSessions,
  useCreateAgentSession,
  useCreateContextEntry,
  useDeleteAgentSession,
  useRenameAgentSession,
  useWhoAmI,
  type AgentSessionSummary,
} from '@/api/hooks';
import {
  ArrowLeft, ArrowUp, X, User, Briefcase, Building, Layers, Clock, Loader2, Wrench,
  ChevronDown, ChevronRight, Pencil, Trash2, Check, MessageSquare,
  Bot, Brain, Eye, EyeOff, RotateCcw, WifiOff, ClipboardList, ShieldCheck,
  Database, CheckCircle2, Circle, AlertTriangle, FileCheck2,
  GitPullRequestArrow, PanelRightClose, PanelRightOpen,
  Paperclip, FileText, Search,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
	  cancelAgentTurn, createAgentTurn, deleteAgentAttachment, streamAgentTurn,
	  uploadAgentAttachment, groupToolMessages, getAgentSession,
  SYSTEM_INIT_PREFIX, COMPACT_SUMMARY_PREFIX, COMPACT_ACK_PREFIX, ATTACHED_CONTEXT_PREFIX,
  type AgentAttachmentSummary, type AgentTurnSummary,
  type DisplayMessage, type RenderItem, type ToolGroupItem, type ToolGroupStep, type SSEEvent,
} from '@/lib/agentStream';
import { AgentMarkdown } from '@/components/ui/agent-markdown';
import { ENTITY_COLORS } from '@/lib/entityColors';
import { friendlyErrorMessage } from '@/lib/friendlyErrors';

const agentDescription = 'Ask questions, prep follow-ups, add context, and safely act on your book of business.';
const agentIconClassName = ENTITY_COLORS.agents.text;

const typeIcons: Record<string, typeof User> = {
  contact: User, opportunity: Briefcase, 'use-case': Layers, use_case: Layers, account: Building,
};
const typeLabels: Record<string, string> = {
  contact: 'Contact', opportunity: 'Opportunity', 'use-case': 'Use Case', use_case: 'Use Case', account: 'Account',
};

// ── Message filtering helpers ────────────────────────────────────────────────

type RawMsg = { role: string; content: string };

/** True for messages that should count as visible / meaningful in the chat. */
function isVisibleMsg(m: RawMsg): boolean {
  if (m.role === 'system') return false;
  if (m.role === 'user' && m.content?.startsWith(SYSTEM_INIT_PREFIX)) return false;
  if (m.role === 'user' && m.content?.startsWith(ATTACHED_CONTEXT_PREFIX)) return false;
  if (m.role === 'user' && m.content?.startsWith(COMPACT_SUMMARY_PREFIX)) return false;
  if (m.role === 'assistant' && m.content?.startsWith(COMPACT_ACK_PREFIX)) return false;
  return true;
}

/** Convert raw server messages into the display format shown in the chat UI. */
function rawMsgsToDisplay(rawMsgs: RawMsg[]): DisplayMessage[] {
  const display: DisplayMessage[] = [];
  for (const msg of rawMsgs) {
    if (!isVisibleMsg(msg)) continue;
    if (msg.role === 'user') display.push({ kind: 'user', content: msg.content });
    if (msg.role === 'assistant' && msg.content) display.push({ kind: 'assistant', content: msg.content });
  }
  return display;
}

function deriveSessionLabel(message: string): string {
  const label = message
    .replace(/^\s*(please|can you|could you|would you|help me|i need you to|let'?s)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!label) return 'New conversation';
  return label.length > 60 ? `${label.slice(0, 57).trimEnd()}...` : label;
}

function humanizeToolName(name: string): string {
  const displayNames: Record<string, string> = {
    model_retry: 'Retrying model',
    model_failover: 'Using backup model',
  };
  if (displayNames[name]) return displayNames[name];
  return name
    .replace(/^crm_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function summarizeToolInput(args?: Record<string, unknown>): string | null {
  if (!args || Object.keys(args).length === 0) return null;
  const subject = args.subject_type && args.subject_id ? `${args.subject_type} ${String(args.subject_id).slice(0, 8)}` : null;
  const named = args.name ?? args.title ?? args.query ?? args.q ?? args.email ?? args.type;
  if (named) return String(named);
  if (subject) return subject;
  return `${Object.keys(args).length} input field${Object.keys(args).length === 1 ? '' : 's'}`;
}

function summarizeToolOutput(result: unknown, isError?: boolean): string | null {
  if (!result) return null;
  if (isError) {
    if (typeof result === 'string') return result;
    if (typeof result === 'object') {
      const body = result as Record<string, unknown>;
      return String(body.error ?? body.message ?? body.detail ?? 'Tool failed');
    }
    return 'Tool failed';
  }
  if (typeof result !== 'object') return String(result).slice(0, 120);
  const body = result as Record<string, unknown>;
  const data = body.data && typeof body.data === 'object' ? body.data as Record<string, unknown> : body;
  const label = data.name ?? data.title ?? data.subject ?? data.id;
  if (label) return String(label);
  if (Array.isArray(body.data)) return `${body.data.length} result${body.data.length === 1 ? '' : 's'}`;
  if (typeof body.total === 'number') return `${body.total} result${body.total === 1 ? '' : 's'}`;
  return null;
}

type AgentTaskStatus = 'running' | 'waiting_approval' | 'failed' | 'complete';
type AgentTaskRisk = 'low' | 'medium' | 'high';
type AgentTaskStepStatus = 'pending' | 'running' | 'complete' | 'failed' | 'skipped';

type AgentTaskStep = {
  id: string;
  label: string;
  status: AgentTaskStepStatus;
  toolName?: string;
};

type AgentTaskState = {
  id: string;
  goal: string;
  subject?: AIContextEntity | null;
  status: AgentTaskStatus;
  risk: AgentTaskRisk;
  steps: AgentTaskStep[];
  changedRecords: string[];
  startedAt: number;
  completedAt?: number;
  nextAction?: string;
};

type MemoryProposal = {
  id: string;
  title: string;
  body: string;
  status: 'pending' | 'saving' | 'approved' | 'discarded' | 'temporary' | 'error';
  error?: string;
};

type WorkflowCommand = {
  label: string;
  prompt: string;
  description: string;
};

function normalizeSubjectType(type?: string | null): string | undefined {
  if (!type) return undefined;
  return type === 'use-case' ? 'use_case' : type;
}

function isNonTrivialTask(text: string): boolean {
  const lower = text.toLowerCase();
  if (text.length > 90) return true;
  return /(brief|review|risk|next best|meeting|follow.?up|handoff|stale|quality|create|update|log|add|prepare|analy[sz]e|summari[sz]e|draft|send|advance|approve|reject|compare|plan|investigate)/.test(lower);
}

function classifyRisk(text: string, canWrite?: boolean): AgentTaskRisk {
  const lower = text.toLowerCase();
  if (/(delete|send|bulk|approve|reject|proposal|pricing|contract|executive|owner|password|permission)/.test(lower)) {
    return 'high';
  }
  if (canWrite || /(create|update|log|add|advance|handoff|assign|enroll|write|change)/.test(lower)) {
    return 'medium';
  }
  return 'low';
}

function createAgentTask(goal: string, subject: AIContextEntity | null, canWrite?: boolean): AgentTaskState | null {
  if (!isNonTrivialTask(goal)) return null;
  return {
    id: `task-${Date.now()}`,
    goal,
    subject,
    status: 'running',
    risk: classifyRisk(goal, canWrite),
    startedAt: Date.now(),
    changedRecords: [],
    steps: [
      { id: 'understand', label: 'Understand goal and scope', status: 'complete' },
      { id: 'context', label: 'Retrieve customer context', status: 'pending' },
      { id: 'tools', label: 'Use scoped tools if needed', status: 'pending' },
      { id: 'review', label: 'Review safety, audit, and next action', status: 'pending' },
      { id: 'answer', label: 'Answer with evidence and next step', status: 'pending' },
    ],
  };
}

function toolStepId(toolName: string): string {
  if (/briefing|context|search|semantic|list|get|read|activity/.test(toolName)) return 'context';
  if (/hitl|handoff|approval|assignment/.test(toolName)) return 'review';
  return 'tools';
}

function updateStepStatus(steps: AgentTaskStep[], stepId: string, status: AgentTaskStepStatus, toolName?: string): AgentTaskStep[] {
  return steps.map(step => {
    if (step.id !== stepId) return step;
    if (step.status === 'failed') return step;
    if (step.status === 'complete' && status === 'running') return step;
    return { ...step, status, toolName: toolName ?? step.toolName };
  });
}

function updateTaskForToolStatus(task: AgentTaskState | null, toolName: string): AgentTaskState | null {
  if (!task || task.status === 'failed' || task.status === 'complete') return task;
  const waiting = /hitl|approval/.test(toolName);
  return {
    ...task,
    status: waiting ? 'waiting_approval' : 'running',
    steps: updateStepStatus(task.steps, toolStepId(toolName), 'running', toolName),
  };
}

function summarizeChangedRecord(toolName: string, result: unknown): string | null {
  if (!/(create|update|delete|log|add|advance|approve|reject|complete|assign|handoff|supersede|resolve)/.test(toolName)) return null;
  if (!result || typeof result !== 'object') return toolName.replace(/_/g, ' ');
  const data = (result as Record<string, unknown>).data;
  const body = data && typeof data === 'object' ? data as Record<string, unknown> : result as Record<string, unknown>;
  const name = body.name ?? body.title ?? body.subject ?? body.id;
  return name ? `${toolName.replace(/_/g, ' ')}: ${String(name)}` : toolName.replace(/_/g, ' ');
}

function updateTaskForToolResult(task: AgentTaskState | null, toolName: string, isError: boolean, result: unknown): AgentTaskState | null {
  if (!task || task.status === 'complete') return task;
  const stepId = toolStepId(toolName);
  const changed = !isError ? summarizeChangedRecord(toolName, result) : null;
  return {
    ...task,
    status: isError ? 'failed' : (/hitl|approval/.test(toolName) ? 'waiting_approval' : 'running'),
    steps: updateStepStatus(task.steps, stepId, isError ? 'failed' : 'complete', toolName),
    changedRecords: changed && !task.changedRecords.includes(changed)
      ? [...task.changedRecords, changed].slice(-5)
      : task.changedRecords,
  };
}

function completeTask(task: AgentTaskState | null): AgentTaskState | null {
  if (!task || task.status === 'failed' || task.status === 'waiting_approval') return task;
  const skippableSteps = new Set(['context', 'tools']);
  return {
    ...task,
    status: 'complete',
    completedAt: Date.now(),
    nextAction: task.changedRecords.length > 0 ? 'Review audit trail' : 'Save useful context or choose a next workflow',
    steps: task.steps.map(step => {
      if (step.status !== 'pending' && step.status !== 'running') return step;
      if (skippableSteps.has(step.id) && !step.toolName) return { ...step, status: 'skipped' };
      return { ...step, status: 'complete' };
    }),
  };
}

function getWorkflowCommands(subject: AIContextEntity | null): WorkflowCommand[] {
  const target = subject ? `this ${typeLabels[subject.type].toLowerCase()} (${subject.name})` : 'your workspace';
  return [
    { label: '/brief', description: 'Current state, risks, activity, and next action', prompt: `Get a briefing for ${target}. Include Current Memory, recent activity, risks, and recommended next action.` },
    { label: '/deal-review', description: 'Stage fit, blockers, health, and probability', prompt: `Review the deal context for ${target}. Summarize stage fit, blockers, health, probability, and next steps.` },
    { label: '/renewal-risk', description: 'Risk, missing context, objections, and handoff needs', prompt: `Assess renewal risk for ${target}. Look for Memory that needs review, missing activity, objections, and handoff needs.` },
    { label: '/next-action', description: 'Recommended action with evidence and safety boundary', prompt: `Recommend the next best action for ${target}. Explain the evidence and whether a handoff or write needs approval.` },
    { label: '/meeting-prep', description: 'Agenda, open questions, and what changed', prompt: `Prepare meeting notes for ${target}. Include what changed, open questions, and suggested agenda.` },
    { label: '/follow-up', description: 'Grounded follow-up summary or email draft', prompt: `Draft a follow-up summary for ${target}. Ground it in known context and call out assumptions.` },
    { label: '/handoff', description: 'Human review packet for risky or blocked work', prompt: `Prepare a human handoff for ${target}. Include urgency, owner, reasoning, and context the reviewer needs.` },
    { label: '/memory-health', description: 'Stale, weak, or contradictory Memory', prompt: `Review Memory that needs review or weak context for ${target}. Suggest what should be refreshed before action.` },
    { label: '/data-quality', description: 'Missing relationships, weak fields, and conflicts', prompt: `Scan data quality for ${target}. Identify missing relationships, weak fields, and conflicts that could affect agent work.` },
  ];
}

function getHighValueSuggestions(subject: AIContextEntity | null): WorkflowCommand[] {
  if (!subject) {
    return [
      { label: 'Show my focus queue', description: 'Review scoped work needing attention', prompt: 'Show me the highest priority accounts, opportunities, Signals, and handoffs that need my attention.' },
      { label: 'Summarize pipeline risk', description: 'Find risky deals and next actions', prompt: 'Summarize pipeline risk across my visible book of business. Focus on stalled opportunities, missing next steps, and open handoffs.' },
      { label: 'Review handoffs', description: 'Inspect pending decisions', prompt: 'Review my pending handoffs and tell me which decisions need action first.' },
    ];
  }
  if (subject.type === 'account') {
    return [
      { label: 'Get account briefing', description: 'Current Memory, risks, and next action', prompt: `Get an account-wide briefing for ${subject.name}. Include Current Memory, open Signals, recent activity, risks, and recommended next action.` },
      { label: 'Find risks and next steps', description: 'Actionable account review', prompt: `Find risks, unresolved Signals, stale Memory, and next steps for ${subject.name}. Recommend what I should do first.` },
      { label: 'Prep follow-up', description: 'Draft grounded follow-up', prompt: `Prepare a follow-up for ${subject.name}. Ground it in confirmed Memory and call out any assumptions from Signals.` },
    ];
  }
  if (subject.type === 'opportunity') {
    return [
      { label: 'Review deal health', description: 'Stage fit, blockers, and confidence', prompt: `Review deal health for ${subject.name}. Include stage fit, blockers, commitments, risks, and next best action.` },
      { label: 'Identify blockers', description: 'Find risks before the next step', prompt: `Identify blockers and missing context for ${subject.name}. Tell me what needs review or a handoff before action.` },
      { label: 'Prepare next meeting', description: 'Agenda and open questions', prompt: `Prepare the next meeting for ${subject.name}. Include agenda, open questions, likely objections, and useful Memory.` },
    ];
  }
  if (subject.type === 'contact') {
    return [
      { label: 'Prep outreach', description: 'Grounded message prep', prompt: `Prep outreach to ${subject.name}. Include relationship context, recent activity, likely interests, and what not to assume.` },
      { label: 'Summarize relationship', description: 'Role, influence, and history', prompt: `Summarize the relationship with ${subject.name}. Include stakeholder role, influence, commitments, and recent activity.` },
      { label: 'Log follow-up context', description: 'Capture useful context safely', prompt: `Help me turn a follow-up note about ${subject.name} into useful Signals or Memory with evidence.` },
    ];
  }
  return [
    { label: 'Review adoption health', description: 'Use case health and risks', prompt: `Review adoption health for ${subject.name}. Include current outcomes, risks, blockers, and next action.` },
    { label: 'Find expansion risks', description: 'Signals that affect expansion', prompt: `Find expansion risks and success criteria for ${subject.name}. Separate confirmed Memory from uncertain Signals.` },
    { label: 'Prepare check-in', description: 'Grounded customer check-in', prompt: `Prepare a customer check-in for ${subject.name}. Include what changed, open questions, and recommended next steps.` },
  ];
}

function resolveShortcutInput(text: string, commands: WorkflowCommand[]): string {
  const trimmed = text.trim();
  const command = commands.find(item => item.label === trimmed);
  return command?.prompt ?? trimmed;
}

function buildMemoryProposal(assistantText: string): MemoryProposal | null {
  const body = assistantText.replace(/\s+/g, ' ').trim();
  if (body.length < 120) return null;
  return {
    id: `memory-${Date.now()}`,
    title: 'Agent conversation insight',
    body: body.length > 700 ? `${body.slice(0, 697).trimEnd()}...` : body,
    status: 'pending',
  };
}

function extractToolNames(messages: DisplayMessage[]): string[] {
  return messages.flatMap((message) => {
    if (message.kind === 'tool_status' || message.kind === 'tool_call' || message.kind === 'tool_result') return [message.name];
    return [];
  });
}

function buildContextEvidence(messages: DisplayMessage[], subject: AIContextEntity | null) {
  const toolNames = extractToolNames(messages);
  if (!subject && toolNames.length === 0) return null;
  const uniqueTools = Array.from(new Set(toolNames));
  const usedBriefing = uniqueTools.some(name => name.includes('briefing'));
  const usedMemory = uniqueTools.some(name => name.includes('context') || name.includes('semantic'));
  const usedActivity = uniqueTools.some(name => name.includes('activity'));
  const usedHandoff = uniqueTools.some(name => name.includes('handoff') || name.includes('hitl') || name.includes('assignment'));
  return {
    subject,
    uniqueTools,
    toolCount: toolNames.length,
    usedBriefing,
    usedMemory,
    usedActivity,
    usedHandoff,
    warnings: [
      subject && !usedBriefing && !usedMemory ? 'Only record metadata is attached so far.' : null,
      uniqueTools.some(name => name.includes('stale')) ? 'Stale context was checked.' : null,
      uniqueTools.some(name => name.includes('contradiction')) ? 'Contradiction review was checked.' : null,
    ].filter(Boolean) as string[],
  };
}

// ── Session item with rename/delete ─────────────────────────────────────────

function SessionItem({
  session,
  isActive,
  taskStatus,
  onSelect,
  onRenamed,
  onDeleted,
}: {
  session: AgentSessionSummary;
  isActive: boolean;
  taskStatus?: AgentTaskStatus;
  onSelect: () => void;
  onRenamed: () => void;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.label ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rename = useRenameAgentSession();
  const del = useDeleteAgentSession();
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(session.label ?? '');
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commitEdit = async () => {
    if (draft.trim() && draft.trim() !== session.label) {
      await rename.mutateAsync({ id: session.id, label: draft.trim() });
      onRenamed();
    }
    setEditing(false);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirmDelete) {
      setConfirmDelete(true);
      // Auto-reset after 3 s so the button doesn't stay in "confirm" state forever
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    await del.mutateAsync(session.id);
    onDeleted();
  };

  return (
    <div
      className={`group relative flex items-start gap-2 px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${
        isActive ? 'bg-primary/8 border border-primary/20' : 'hover:bg-muted/50 border border-transparent'
      }`}
      onClick={editing ? undefined : onSelect}
    >
      <Clock className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit();
              if (e.key === 'Escape') setEditing(false);
            }}
            onBlur={commitEdit}
            className="w-full text-xs bg-transparent border-b border-primary outline-none text-foreground"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors line-clamp-2">
            {session.label || 'Untitled conversation'}
          </span>
        )}
        {session.context_name && (
          <span className="text-xs text-muted-foreground/60 truncate block mt-0.5">
            {typeLabels[session.context_type ?? ''] ?? session.context_type} · {session.context_name}
          </span>
        )}
        {taskStatus && (
          <span className={`inline-flex mt-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
            taskStatus === 'complete' ? 'bg-emerald-500/10 text-emerald-600' :
            taskStatus === 'failed' ? 'bg-destructive/10 text-destructive' :
            taskStatus === 'waiting_approval' ? 'bg-amber-500/10 text-amber-600' :
            'bg-primary/10 text-primary'
          }`}>
            {taskStatus === 'waiting_approval' ? 'Waiting approval' : taskStatus}
          </span>
        )}
      </div>
      {!editing && (
        <div className={`flex items-center gap-1 transition-opacity flex-shrink-0 ${confirmDelete ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          <button
            onClick={startEdit}
            className="p-0.5 rounded hover:bg-muted transition-colors"
            title="Rename"
          >
            <Pencil className="w-3 h-3 text-muted-foreground" />
          </button>
          <button
            onClick={handleDelete}
            className={`p-0.5 rounded transition-colors ${confirmDelete ? 'text-destructive hover:bg-destructive/10' : 'hover:bg-muted text-muted-foreground'}`}
            title={confirmDelete ? 'Click again to confirm delete' : 'Delete session'}
          >
            {confirmDelete ? <Check className="w-3 h-3" /> : <Trash2 className="w-3 h-3" />}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────────────────

export default function Agent() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [entityContext, setEntityContext] = useState<AIContextEntity | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const assistantTextRef = useRef('');
  const didRestoreRef = useRef(false);
  const launchContextRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatResetRef = useRef(0);

  // Track the last message the user sent so we can retry it after errors.
  const [lastSentMessage, setLastSentMessage] = useState('');
  const [task, setTask] = useState<AgentTaskState | null>(null);
  const [memoryProposals, setMemoryProposals] = useState<MemoryProposal[]>([]);
  // True when we've sent a message but haven't received the agent's response yet —
  // covers both the live-streaming window and the "navigated away mid-turn" case.
  const [isSessionPending, setIsSessionPending] = useState(false);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [currentTurnId, setCurrentTurnId] = useState<string | null>(null);
  const [activeTurnMeta, setActiveTurnMeta] = useState<AgentSessionSummary['active_turn'] | null>(null);
  const [attachments, setAttachments] = useState<AgentAttachmentSummary[]>([]);
  const [attachmentMode, setAttachmentMode] = useState<'active_context' | 'raw_context'>('active_context');
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [scopeType, setScopeType] = useState<EntityType>('account');
  const [scopeId, setScopeId] = useState('');
  const [scopeLabel, setScopeLabel] = useState('');
  const [scopePickerOpen, setScopePickerOpen] = useState(false);

  // Process mode: when on, show model reasoning when available and richer tool detail.
  const [showProcess, setShowProcess] = useState<boolean>(() => {
    try { return localStorage.getItem('crmy_agent_show_process') === 'true'; } catch { return false; }
  });
  const toggleProcess = () => setShowProcess(v => {
    const next = !v;
    try { localStorage.setItem('crmy_agent_show_process', String(next)); } catch {}
    return next;
  });
  const [sessionsOpen, setSessionsOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('crmy_agent_sessions_open') !== 'false'; } catch { return true; }
  });
  const toggleSessionsOpen = () => setSessionsOpen(v => {
    const next = !v;
    try { localStorage.setItem('crmy_agent_sessions_open', String(next)); } catch {}
    return next;
  });

  const { aiContext } = useAppStore();
  const { enabled, loading: configLoading, connectivity, config, connectivityError } = useAgentSettings();
  const { data: whoami } = useWhoAmI() as any;
  const isAdminUser = whoami?.role === 'admin' || whoami?.role === 'owner';
  const { data: sessionsData, refetch: refetchSessions } = useAgentSessions();
  const createSession = useCreateAgentSession();
  const renameSession = useRenameAgentSession();
  const createContextEntry = useCreateContextEntry();

  const sessions: AgentSessionSummary[] = sessionsData?.data ?? [];

  const exitAgent = useCallback(() => {
    const historyIndex = typeof window !== 'undefined'
      ? (window.history.state as { idx?: number } | null)?.idx
      : 0;
    if (typeof historyIndex === 'number' && historyIndex > 0) {
      navigate(-1);
    } else {
      navigate('/app');
    }
  }, [navigate]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      exitAgent();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [exitAgent]);

  const exitButton = (
    <button
      onClick={exitAgent}
      className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      title="Exit Workspace Agent (Esc)"
    >
      <ArrowLeft className="h-4 w-4" />
      <span className="hidden sm:inline">Exit</span>
      <kbd className="hidden rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground md:inline">
        Esc
      </kbd>
    </button>
  );

  // Persist the active session id so we can restore it on page re-visit.
  useEffect(() => {
    if (activeSessionId) {
      localStorage.setItem('crmy_active_session_id', activeSessionId);
    } else {
      localStorage.removeItem('crmy_active_session_id');
    }
  }, [activeSessionId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load existing session (also detects in-progress turns so polling can recover them)
  const loadSession = useCallback(async (session: AgentSessionSummary, contextOverride?: AIContextEntity | null) => {
    setActiveSessionId(session.id);
    setIsSessionPending(false);
    setCurrentTurnId(null);
    setActiveTurnMeta(null);
    setTask(null);
    setMemoryProposals([]);
    setAttachments([]);
    setEntityContext(contextOverride ?? (session.context_type ? {
      type: (session.context_type === 'use_case' ? 'use-case' : session.context_type) as AIContextEntity['type'],
      id: session.context_id ?? '',
      name: session.context_name ?? '',
    } : null));

    try {
      const data = await getAgentSession(session.id);
      const rawMsgs: { role: string; content: string }[] = data.messages ?? [];
      const display = rawMsgsToDisplay(rawMsgs);
      if (data.active_turn?.input_message) {
        setMessages([...display, { kind: 'user', content: data.active_turn.input_message }]);
        setIsSessionPending(true);
        setCurrentTurnId(data.active_turn.id);
        setActiveTurnMeta(data.active_turn);
      } else {
        setMessages(display);
        setActiveTurnMeta(null);
      }
      setAttachments(data.attachments ?? []);

      // Detect an incomplete turn: if the last meaningful message is from the user,
      // the server is still (or was) working on a response. Start polling.
      const lastMeaningful = [...rawMsgs]
        .reverse()
        .find(m => isVisibleMsg(m));
      if (lastMeaningful?.role === 'user' || data.active_turn) {
        setIsSessionPending(true);
      }
    } catch { /* ignore */ }
  }, []);

  const openRecordSession = useCallback(async (ctx: AIContextEntity) => {
    const launchKey = `${ctx.type}:${ctx.id}`;
    if (launchContextRef.current === launchKey) return;
    launchContextRef.current = launchKey;

    setEntityContext(ctx);
    setInput('');
    setMessages([]);
    setActiveSessionId(null);
    setIsSessionPending(false);
    setCurrentTurnId(null);
    setActiveTurnMeta(null);
    setLastSentMessage('');
    setTask(null);
    setMemoryProposals([]);
    setAttachments([]);

    try {
      const session = await createSession.mutateAsync({
        context_type: ctx.type,
        context_id: ctx.id,
        context_name: ctx.name,
        reuse_context: true,
      });
      await loadSession(session.data, ctx);
      refetchSessions();
    } catch (err) {
      setMessages([{ kind: 'error', message: friendlyErrorMessage(err, 'Could not load this agent session.') }]);
    } finally {
      launchContextRef.current = null;
    }
  }, [createSession, loadSession, refetchSessions]);

  // Handle entity context from record pages (openAIWithContext)
  useEffect(() => {
    if (aiContext) {
      useAppStore.setState({ aiContext: null });
      openRecordSession(aiContext);
    }
  }, [aiContext, openRecordSession]);

  const startNewChat = useCallback(() => {
    chatResetRef.current += 1;
    abortRef.current?.abort();
    launchContextRef.current = null;
    localStorage.removeItem('crmy_active_session_id');
    setActiveSessionId(null);
    setMessages([]);
    setEntityContext(null);
    setInput('');
    setIsSessionPending(false);
    setCurrentTurnId(null);
    setActiveTurnMeta(null);
    setLastSentMessage('');
    setTask(null);
    setMemoryProposals([]);
    setAttachments([]);
    setScopeId('');
    setScopeLabel('');
    setScopePickerOpen(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  const handleAgentEvent = useCallback((event: SSEEvent, opts?: { proposeMemory?: boolean }) => {
    switch (event.type) {
      case 'delta': {
        assistantTextRef.current += event.content;
        const snapshot = assistantTextRef.current;
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.kind === 'assistant') {
            return [...prev.slice(0, -1), { kind: 'assistant', content: snapshot }];
          }
          return [...prev, { kind: 'assistant', content: snapshot }];
        });
        break;
      }
      case 'tool_status':
        setTask(prev => updateTaskForToolStatus(prev, event.name));
        assistantTextRef.current = '';
        setMessages(prev => {
          let existingIdx = -1;
          for (let i = prev.length - 1; i >= 0; i--) {
            const m = prev[i];
            if (m.kind === 'tool_status' && m.id === event.id) { existingIdx = i; break; }
          }
          const newMsg: DisplayMessage = {
            kind: 'tool_status',
            id: event.id,
            name: event.name,
            status: event.status,
            turn_id: event.turn_id,
          };
          if (existingIdx >= 0) {
            const updated = [...prev];
            updated[existingIdx] = newMsg;
            return updated;
          }
          return [...prev, newMsg];
        });
        break;
      case 'thinking':
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.kind === 'thinking' && last.turn_id === event.turn_id) {
            return [...prev.slice(0, -1), { ...last, content: last.content + event.content }];
          }
          return [...prev, { kind: 'thinking', content: event.content, turn_id: event.turn_id }];
        });
        break;
      case 'tool_call':
        setMessages(prev => [...prev, { kind: 'tool_call', id: event.id, name: event.name, arguments: event.arguments, turn_id: event.turn_id }]);
        break;
      case 'tool_result':
        setTask(prev => updateTaskForToolResult(prev, event.name, event.is_error, event.result));
        setMessages(prev => {
          const updated = prev.map(m =>
            m.kind === 'tool_status' && m.id === event.id
              ? { ...m, status: event.is_error ? `Error from ${m.name.replace(/_/g, ' ')}` : m.status.replace('…', ' ✓'), turn_id: event.turn_id }
              : m
          );
          return [...updated, { kind: 'tool_result' as const, id: event.id, name: event.name, is_error: event.is_error, result: event.result, turn_id: event.turn_id }];
        });
        break;
      case 'error':
        setTask(prev => prev ? { ...prev, status: 'failed', nextAction: 'Retry the request or inspect the failed tool output.' } : prev);
        setMessages(prev => [...prev, { kind: 'error', message: friendlyErrorMessage(event.message, 'The agent turn failed. Try again.') }]);
        break;
      case 'done':
        setIsSessionPending(false);
        setCurrentTurnId(null);
        setActiveTurnMeta(null);
        setTask(prev => completeTask(prev));
        if (entityContext && opts?.proposeMemory) {
          const proposal = buildMemoryProposal(assistantTextRef.current);
          if (proposal) setMemoryProposals(prev => [proposal, ...prev].slice(0, 3));
        }
        refetchSessions();
        break;
    }
  }, [entityContext, refetchSessions]);

  const sendMessage = useCallback(async (overrideText?: string, opts?: { skipUserMessage?: boolean; clearInput?: boolean }) => {
    const text = (overrideText !== undefined ? overrideText : input).trim();
    if (!text || streaming) return;
    const resetVersion = chatResetRef.current;
    if (overrideText === undefined || opts?.clearInput) setInput('');

    setLastSentMessage(text);
    setIsSessionPending(true);
    assistantTextRef.current = '';
    const nextTask = createAgentTask(text, entityContext, config?.can_write_objects);
    if (nextTask) setTask(nextTask);

    // Add user message immediately (skip if retrying — user message already shown)
    if (!opts?.skipUserMessage) {
      setMessages(prev => [...prev, { kind: 'user', content: text }]);
    }

    setStreaming(true);
    const abort = new AbortController();
    abortRef.current = abort;

    let resolvedSessionId: string | null = null;

    try {
      // Create session if needed
      let sessionId = activeSessionId;
      if (!sessionId) {
        const session = await createSession.mutateAsync({
          context_type: entityContext?.type,
          context_id: entityContext?.id,
          context_name: entityContext?.name,
          reuse_context: Boolean(entityContext?.type && entityContext?.id),
        });
        sessionId = session.data.id;
        setActiveSessionId(sessionId);
      }
      resolvedSessionId = sessionId;

      const currentSession = sessions.find((session) => session.id === sessionId);
      if (!currentSession?.label) {
        const nextLabel = deriveSessionLabel(text);
        queryClient.setQueryData<{ data: AgentSessionSummary[] }>(['agent-sessions'], (old) => {
          if (!old?.data) return old;
          return {
            ...old,
            data: old.data.map((session) => (
              session.id === sessionId ? { ...session, label: nextLabel } : session
            )),
          };
        });
        renameSession.mutate({ id: sessionId, label: nextLabel });
      }

      const turn = await createAgentTurn(sessionId, text, entityContext?.detail ? { context_detail: entityContext.detail } : undefined);
      setCurrentTurnId(turn.id);
      setActiveTurnMeta(turn);
      queryClient.setQueryData<{ data: AgentSessionSummary[] }>(['agent-sessions'], (old) => {
        if (!old?.data) return old;
        return {
          ...old,
          data: old.data.map((session) => (
            session.id === sessionId ? { ...session, active_turn: turn } : session
          )),
        };
      });

      await streamAgentTurn(sessionId, turn.id, (event) => {
        handleAgentEvent(event, { proposeMemory: Boolean(nextTask) });
      }, abort.signal);
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        // Stream was interrupted locally. The durable turn may still finish.
        setIsSessionPending(Boolean(currentTurnId));
      } else {
        // Network / server error. Keep isSessionPending=true so polling can
        // recover if the server finishes the turn after disconnect.
        setTask(prev => prev ? { ...prev, status: 'failed', nextAction: 'Retry after the connection recovers.' } : prev);
        setMessages(prev => [...prev, { kind: 'error', message: friendlyErrorMessage(err, 'The agent turn failed. Try again.') }]);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;

      if (resolvedSessionId) {
        if (chatResetRef.current !== resetVersion) return;
        const sid = resolvedSessionId;
        getAgentSession(sid)
          .then(data => {
            if (!data.messages) return;
            const display = rawMsgsToDisplay(data.messages);
            if (data.active_turn?.input_message) {
              setMessages([...display, { kind: 'user', content: data.active_turn.input_message }]);
              setCurrentTurnId(data.active_turn.id);
              setActiveTurnMeta(data.active_turn);
              setIsSessionPending(true);
            } else if (display.length > 0) {
              setMessages(display);
              setCurrentTurnId(null);
              setActiveTurnMeta(null);
              setIsSessionPending(false);
            }
            setAttachments(data.attachments ?? []);
          })
          .catch(() => { /* ignore */ });
      }
    }
  }, [input, streaming, activeSessionId, entityContext, config?.can_write_objects, createSession, sessions, queryClient, renameSession, handleAgentEvent, currentTurnId]);

  // Retry the last sent message: strip error bubbles and re-send.
  const retryLast = useCallback(() => {
    if (!lastSentMessage || streaming) return;
    setMessages(prev => prev.filter(m => m.kind !== 'error'));
    sendMessage(lastSentMessage, { skipUserMessage: true });
  }, [lastSentMessage, streaming, sendMessage]);

  const stopCurrentTurn = useCallback(async () => {
    abortRef.current?.abort();
    if (activeSessionId && currentTurnId) {
      try {
        await cancelAgentTurn(activeSessionId, currentTurnId);
        setIsSessionPending(false);
        setCurrentTurnId(null);
        setActiveTurnMeta(null);
      } catch (err) {
        toast({ title: 'Could not stop agent turn', description: friendlyErrorMessage(err, 'Please try again.'), variant: 'destructive' });
      }
    } else {
      setIsSessionPending(false);
    }
  }, [activeSessionId, currentTurnId]);

  const ensureSessionForAttachment = useCallback(async (): Promise<string> => {
    if (activeSessionId) return activeSessionId;
    const session = await createSession.mutateAsync({
      context_type: entityContext?.type,
      context_id: entityContext?.id,
      context_name: entityContext?.name,
      reuse_context: Boolean(entityContext?.type && entityContext?.id),
    });
    setActiveSessionId(session.data.id);
    refetchSessions();
    return session.data.id;
  }, [activeSessionId, createSession, entityContext, refetchSessions]);

  const handleAttachmentFile = useCallback(async (file: File) => {
    setUploadingAttachment(true);
    try {
      const sessionId = await ensureSessionForAttachment();
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = typeof reader.result === 'string' ? reader.result : '';
          resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result);
        };
        reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
        reader.readAsDataURL(file);
      });
      const result = await uploadAgentAttachment(sessionId, {
        filename: file.name,
        data,
        mode: attachmentMode,
        source_label: file.name,
      });
      setAttachments(prev => [result.data, ...prev.filter(item => item.id !== result.data.id)]);
      if (attachmentMode === 'raw_context') {
        toast({ title: 'Raw Context processed', description: 'CRMy added the file to the Raw Context pipeline.' });
      } else {
        toast({ title: 'Attachment added', description: 'It will be used as temporary Active Context on the next turn.' });
      }
    } catch (err) {
      toast({ title: 'Attachment failed', description: friendlyErrorMessage(err, 'Please try another file.'), variant: 'destructive' });
    } finally {
      setUploadingAttachment(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [attachmentMode, ensureSessionForAttachment]);

  const removeAttachment = useCallback(async (attachmentId: string) => {
    if (!activeSessionId) return;
    try {
      await deleteAgentAttachment(activeSessionId, attachmentId);
      setAttachments(prev => prev.filter(item => item.id !== attachmentId));
    } catch (err) {
      toast({ title: 'Could not remove attachment', description: friendlyErrorMessage(err, 'Please try again.'), variant: 'destructive' });
    }
  }, [activeSessionId]);

  const applyScope = useCallback(async () => {
    if (!scopeId || !scopeLabel) return;
    const ctx: AIContextEntity = {
      type: scopeType === 'use_case' ? 'use-case' : scopeType,
      id: scopeId,
      name: scopeLabel,
    };
    await openRecordSession(ctx);
    setScopePickerOpen(false);
  }, [openRecordSession, scopeId, scopeLabel, scopeType]);

  const approveMemoryProposal = useCallback(async (proposal: MemoryProposal) => {
    if (!entityContext) return;
    setMemoryProposals(prev => prev.map(item => (
      item.id === proposal.id ? { ...item, status: 'saving' } : item
    )));
    try {
      await createContextEntry.mutateAsync({
        subject_type: normalizeSubjectType(entityContext.type),
        subject_id: entityContext.id,
        context_type: 'summary',
        title: proposal.title,
        body: proposal.body,
        source: 'workspace_agent',
        metadata: { reviewed_from_chat: true },
      });
      setMemoryProposals(prev => prev.map(item => (
        item.id === proposal.id ? { ...item, status: 'approved' } : item
      )));
    } catch (err) {
      setMemoryProposals(prev => prev.map(item => (
        item.id === proposal.id
          ? { ...item, status: 'error', error: (err as Error).message }
          : item
      )));
    }
  }, [createContextEntry, entityContext]);

  const updateMemoryProposal = useCallback((id: string, patch: Partial<MemoryProposal>) => {
    setMemoryProposals(prev => prev.map(item => item.id === id ? { ...item, ...patch } : item));
  }, []);

  // Auto-restore the last active session when the sessions list first loads.
  useEffect(() => {
    if (didRestoreRef.current || sessions.length === 0 || activeSessionId) return;
    didRestoreRef.current = true;
    const savedId = localStorage.getItem('crmy_active_session_id');
    if (!savedId) return;
    const session = sessions.find(s => s.id === savedId);
    if (session) loadSession(session);
  }, [sessions, activeSessionId, loadSession]);

  // Poll for server completion while a session turn is pending and we're not streaming.
  // This handles: user navigated away mid-turn, or SSE dropped before 'done' fired.
  useEffect(() => {
    if (!isSessionPending || streaming || !activeSessionId) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    const sid = activeSessionId;

    const check = async () => {
      try {
        const data = await getAgentSession(sid);
        const rawMsgs: { role: string; content: string }[] = data.messages ?? [];
        const display = rawMsgsToDisplay(rawMsgs);
        setAttachments(data.attachments ?? []);
        if (data.active_turn?.input_message) {
          setCurrentTurnId(data.active_turn.id);
          setActiveTurnMeta(data.active_turn);
          setMessages([...display, { kind: 'user', content: data.active_turn.input_message }]);
          setIsSessionPending(true);
          return;
        }
        // If the last meaningful message is now from assistant, the turn completed.
        const lastMeaningful = [...rawMsgs].reverse().find(m => isVisibleMsg(m));
        if (lastMeaningful?.role === 'assistant') {
          setIsSessionPending(false);
          setCurrentTurnId(null);
          setActiveTurnMeta(null);
          setMessages(display);
          refetchSessions();
        }
      } catch { /* ignore */ }
    };

    check(); // run immediately once, then on interval
    pollRef.current = setInterval(check, 3000);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [isSessionPending, streaming, activeSessionId, refetchSessions]);

  const workflowCommands = useMemo(() => getWorkflowCommands(entityContext), [entityContext]);
  const quickPromptButtons = useMemo(() => getHighValueSuggestions(entityContext), [entityContext]);
  const starterCards = useMemo(() => {
    const target = entityContext ? `${typeLabels[entityContext.type]} · ${entityContext.name}` : 'Workspace';
    return [
      {
        label: 'Retrieve a briefing',
        description: entityContext
          ? `Load confirmed Memory, open Signals, stale warnings, and next action for ${target}.`
          : 'Find the highest-priority customer work and retrieve the context behind it.',
        prompt: entityContext
          ? `Get a briefing for ${entityContext.name}. Separate confirmed Memory from Signals, call out stale or risky context, cite evidence, and recommend the next best action.`
          : 'Show my highest-priority accounts, opportunities, Signals, and handoffs. Retrieve the relevant context and recommend what to do first.',
        Icon: Search,
      },
      {
        label: 'Explain what is uncertain',
        description: 'Separate facts, inferred Signals, missing evidence, and approval boundaries.',
        prompt: entityContext
          ? `Explain what is confirmed, inferred, stale, or awaiting approval for ${entityContext.name}. Tell me what an agent should not assume.`
          : 'Explain the unresolved Signals and stale Memory across my workspace. Tell me what agents should not assume before acting.',
        Icon: ShieldCheck,
      },
      {
        label: 'Next best action',
        description: 'Recommend the strongest next move with evidence, context, and any review needs.',
        prompt: entityContext
          ? `Recommend the next best customer-facing action for ${entityContext.name}. Ground it in confirmed Memory and relevant Signals, flag assumptions, and call out any writeback, assignment, or handoff review needed before execution.`
          : 'Recommend the next best action for the top customer issue. Ground it in confirmed Memory and relevant Signals, flag assumptions, and call out any writeback, assignment, or handoff review needed before execution.',
        Icon: FileCheck2,
      },
    ];
  }, [entityContext]);
  const slashQuery = useMemo(() => {
    const match = input.match(/(?:^|\s)\/([a-z0-9-]*)$/i);
    return match ? match[1].toLowerCase() : null;
  }, [input]);
  const commandMatches = useMemo(() => {
    if (slashQuery === null) return [];
    return workflowCommands
      .filter(command => {
        const haystack = `${command.label} ${command.description}`.toLowerCase();
        return haystack.includes(slashQuery);
      })
      .slice(0, 6);
  }, [slashQuery, workflowCommands]);
  useEffect(() => setSelectedCommandIndex(0), [slashQuery]);

  const applyCommand = useCallback((command: WorkflowCommand) => {
    setInput(command.prompt);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  const sendComposerMessage = useCallback(() => {
    const resolved = resolveShortcutInput(input, workflowCommands);
    if (!resolved) return;
    sendMessage(resolved, { clearInput: true });
  }, [input, sendMessage, workflowCommands]);

  const handleComposerKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (commandMatches.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedCommandIndex(index => (index + 1) % commandMatches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedCommandIndex(index => (index - 1 + commandMatches.length) % commandMatches.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        applyCommand(commandMatches[selectedCommandIndex] ?? commandMatches[0]);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendComposerMessage();
    }
  }, [applyCommand, commandMatches, selectedCommandIndex, sendComposerMessage]);
  const contextEvidence = buildContextEvidence(messages, entityContext);
  const hasThinkingBlocks = messages.some(message => message.kind === 'thinking');

  const IconComponent = entityContext ? typeIcons[entityContext.type] : null;

  const connectivityLabel =
    connectivity === 'online'  ? 'Workspace Agent online' :
    connectivity === 'offline' ? (isAdminUser ? 'Configured but unreachable · check Model Settings' : 'Configured but unreachable · ask an admin to check Model Settings') :
    'Workspace Agent';

  // ── Loading state — wait for config before deciding enabled/disabled ──
  if (configLoading) {
    return (
      <div className="flex flex-col h-full">
        <TopBar title="Workspace Agent" icon={Bot} iconClassName={agentIconClassName} description={agentDescription}>
          {exitButton}
        </TopBar>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground/40" />
        </div>
      </div>
    );
  }

  // ── Not enabled state ──
  if (!enabled) {
    return (
      <div className="flex flex-col h-full">
        <TopBar title="Workspace Agent" icon={Bot} iconClassName={agentIconClassName} description={agentDescription}>
          {exitButton}
        </TopBar>
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-md space-y-3">
            <Bot className="w-12 h-12 mx-auto text-muted-foreground/40" />
            <h2 className="text-lg font-display font-bold text-foreground">Workspace Agent is not enabled</h2>
            <p className="text-sm text-muted-foreground">
              {isAdminUser
                ? <>Enable it in <span className="text-foreground font-medium">Settings → Model Settings</span> to let the app reason over local customer context, call scoped tools, and keep sensitive workspace state under your control.</>
                : <>Ask an admin to enable the shared Workspace Agent. Once enabled, it will use your normal book-of-business permissions.</>}
            </p>
            {isAdminUser && (
              <Link
                to="/settings/model"
                className="inline-flex items-center justify-center h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
              >
                Configure Workspace Agent
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Workspace Agent" icon={Bot} iconClassName={agentIconClassName} description={agentDescription}>
        {exitButton}
      </TopBar>
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">

        {/* ── Chat panel ── */}
        <div className="flex-1 flex flex-col min-w-0">

          {/* Agent header */}
          <div className="px-4 py-3 border-b border-border bg-gradient-to-r from-primary/5 to-accent/5">
            <div className="flex items-center gap-2">
              <AgentStatusDot />
              <span className={`text-sm font-display font-bold ${connectivity === 'offline' ? 'text-destructive' : 'text-foreground'}`}>
                {connectivityLabel}
              </span>
              {connectivity === 'offline' && connectivityError && (
                <span className="hidden md:inline text-xs text-muted-foreground truncate max-w-[28rem]" title={connectivityError}>
                  {connectivityError}
                </span>
              )}
              {streaming && (
                <span className="flex items-center gap-1 text-xs text-primary ml-2">
                  <Loader2 className="w-3 h-3 animate-spin" /> Thinking…
                </span>
              )}
              <div className="ml-auto flex items-center gap-2">
                {streaming && (
                  <button
                    onClick={stopCurrentTurn}
                    className="text-xs text-destructive bg-destructive/10 px-2 py-0.5 rounded-full hover:bg-destructive/20 transition-colors"
                  >
                    Stop
                  </button>
                )}
                <button
                  onClick={() => setScopePickerOpen(v => !v)}
                  title={scopePickerOpen ? 'Hide scope picker' : 'Set customer scope'}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium transition-colors ${
                    scopePickerOpen
                      ? 'bg-muted text-foreground hover:bg-muted/80'
                      : entityContext
                        ? 'bg-muted text-muted-foreground hover:text-foreground'
                        : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  <Search className="w-3.5 h-3.5" />
                  Scope
                </button>
                <button
                  onClick={toggleProcess}
                  title={showProcess ? 'Hide work log' : 'Show reasoning and tool details'}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium transition-colors ${
                    showProcess ? 'bg-muted text-foreground hover:bg-muted/80' : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {showProcess ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  Work log
                </button>
                <button
                  onClick={toggleSessionsOpen}
                  title={sessionsOpen ? 'Hide session history' : 'Show session history'}
                  className={`hidden lg:inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium transition-colors ${
                    sessionsOpen ? 'bg-muted text-muted-foreground hover:text-foreground' : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {sessionsOpen ? <PanelRightClose className="w-3.5 h-3.5" /> : <PanelRightOpen className="w-3.5 h-3.5" />}
                  Sessions
                </button>
                <button
                  onClick={startNewChat}
                  className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full hover:bg-muted/80 transition-colors"
                >
                  New chat
                </button>
              </div>
            </div>
          </div>

          {/* Context banner */}
          <AnimatePresence>
            {entityContext && IconComponent && (
              <motion.div
                key="context-banner"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="px-4 py-2.5 border-b border-border bg-accent/5"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-accent/15 flex items-center justify-center">
                    <IconComponent className="w-3.5 h-3.5 text-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-muted-foreground">{typeLabels[entityContext.type]}</p>
                    <p className="text-sm font-display font-bold text-foreground truncate">
                      {entityContext.name}
                      {entityContext.detail && <span className="font-normal text-muted-foreground ml-1.5">· {entityContext.detail}</span>}
                    </p>
                  </div>
                  <button onClick={() => setEntityContext(null)} className="p-1 rounded-md hover:bg-muted transition-colors">
                    <X className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AgentTrustBar
            provider={config?.provider}
            model={config?.model}
            canWrite={config?.can_write_objects}
            canHandoff={config?.can_create_assignments}
            autoExtract={config?.auto_extract_context}
            hasSubject={Boolean(entityContext)}
          />

          {!entityContext && scopePickerOpen && (
            <div className="border-b border-border bg-card/50 px-4 py-2.5">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                <div className="flex items-center gap-2 text-sm">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-foreground">Set customer scope</p>
                    <p className="text-xs text-muted-foreground">Pick a record to give the agent sharper context.</p>
                  </div>
                </div>
                <div className="flex flex-1 flex-col gap-2 sm:flex-row lg:ml-auto lg:max-w-2xl">
                  <select
                    value={scopeType}
                    onChange={(e) => { setScopeType(e.target.value as EntityType); setScopeId(''); setScopeLabel(''); }}
                    className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none"
                  >
                    <option value="account">Account</option>
                    <option value="opportunity">Opportunity</option>
                    <option value="contact">Contact</option>
                    <option value="use_case">Use Case</option>
                  </select>
                  <EntityCombobox
                    entityType={scopeType}
                    value={scopeId}
                    onChange={setScopeId}
                    onSelectItem={(item) => setScopeLabel(item.label)}
                    placeholder={`Search ${scopeType.replace('_', ' ')}`}
                    className="h-10"
                  />
                  <button
                    onClick={applyScope}
                    disabled={!scopeId || !scopeLabel}
                    className="h-10 min-w-[6.25rem] whitespace-nowrap rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50 disabled:hover:bg-background"
                  >
                    Set scope
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Pending-session banner — shown when the agent is working in the background */}
          <AnimatePresence>
            {isSessionPending && !streaming && (
              <motion.div
                key="pending-banner"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="px-4 py-2.5 border-b border-primary/20 bg-primary/8"
              >
                <div className="flex items-center gap-2.5">
                  <Loader2 className="w-3.5 h-3.5 text-primary animate-spin flex-shrink-0" />
                  <p className="text-xs text-primary flex-1">
                    Agent is working in the background
                    {activeTurnMeta?.attempt_count && activeTurnMeta.attempt_count > 1
                      ? ` · retry attempt ${activeTurnMeta.attempt_count}`
                      : ''}
                    {' '}— you can leave and return without losing this turn.
                  </p>
                  <button
                    onClick={() => setIsSessionPending(false)}
                    className="p-1 rounded-md hover:bg-primary/15 transition-colors flex-shrink-0"
                    title="Dismiss"
                  >
                    <X className="w-3 h-3 text-primary" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 pb-24 md:pb-4">
            {task && (
              <AgentTaskCard
                task={task}
                onRetry={retryLast}
                onStop={stopCurrentTurn}
              />
            )}
            {contextEvidence && (messages.length > 0 || task) && (
              <ContextUsedPanel evidence={contextEvidence} />
            )}
            {showProcess && messages.length > 0 && !hasThinkingBlocks && (
              <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
                Model reasoning stream not provided by this model. The work log still shows scoped tools, inputs, results, and safety checks.
              </div>
            )}
            {memoryProposals.length > 0 && entityContext && (
              <MemoryReviewPanel
                proposals={memoryProposals}
                onApprove={approveMemoryProposal}
                onUpdate={updateMemoryProposal}
              />
            )}
            {messages.length === 0 && (
              <div className="py-8">
                {entityContext && IconComponent ? (
                  <div className="mb-4 text-center text-muted-foreground">
                    <div className="w-10 h-10 mx-auto mb-3 rounded-xl bg-accent/10 flex items-center justify-center">
                      <IconComponent className="w-5 h-5 text-accent" />
                    </div>
                    <p className="text-sm font-medium text-foreground">Active Context is bound to this record.</p>
                    <p className="text-sm mt-1">Choose a starter to retrieve Memory, Signals, evidence, and safety boundaries.</p>
                  </div>
                ) : (
                  <div className="mb-4 text-center text-muted-foreground">
                    <Bot className="w-10 h-10 mx-auto mb-3 opacity-40" />
                    <p className="text-sm font-medium text-foreground">Choose what you want the agent to do first.</p>
                    <p className="text-sm mt-1">CRMy will retrieve the relevant Memory, Signals, evidence, and review needs behind the work.</p>
                  </div>
                )}
                <div className="mx-auto grid max-w-3xl gap-2 md:grid-cols-3">
                  {starterCards.map(card => (
                    <button
                      key={card.label}
                      type="button"
                      onClick={() => applyCommand(card)}
                      className="rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-primary/30 hover:bg-primary/5"
                    >
                      <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 text-violet-500">
                        <card.Icon className="h-4 w-4" />
                      </span>
                      <span className="block text-sm font-semibold text-foreground">{card.label}</span>
                      <span className="mt-1 block text-xs leading-5 text-muted-foreground">{card.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {groupToolMessages(messages).map((item, i) => (
              <MessageBubble key={i} item={item} index={i} showProcess={showProcess} onRetry={retryLast} />
            ))}
            {streaming && !['assistant', 'tool_status'].includes(messages[messages.length - 1]?.kind ?? '') && (
              <TypingIndicator />
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-4 pb-20 md:pb-4">
            <div className="relative">
              {commandMatches.length > 0 && (
                <div className="absolute bottom-full left-0 right-0 z-20 mb-2 overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
                  <div className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
                    Choose a command. Use arrow keys, then Enter.
                  </div>
                  <div className="max-h-64 overflow-y-auto p-1.5">
                    {commandMatches.map((command, index) => (
                      <button
                        key={command.label}
                        onClick={() => applyCommand(command)}
                        className={`flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left transition-colors ${
                          index === selectedCommandIndex ? 'bg-primary/10' : 'hover:bg-muted/60'
                        }`}
                      >
                        <span className="mt-0.5 rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">{command.label}</span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-foreground">{command.description}</span>
                          <span className="block truncate text-xs text-muted-foreground">{command.prompt}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="overflow-hidden rounded-2xl border-2 border-border bg-background shadow-sm transition-colors focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/10">
                {(messages.length === 0 || entityContext) && (
                  <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/20 px-3 py-2">
                    {entityContext && IconComponent ? (
                      <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent">
                        <IconComponent className="h-3 w-3 shrink-0" />
                        <span className="truncate">Bound to {typeLabels[entityContext.type]} · {entityContext.name}</span>
                      </span>
                    ) : (
                      <span className="hidden text-xs text-muted-foreground sm:inline">Workspace-wide</span>
                    )}
                    <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto sm:justify-end">
                      {quickPromptButtons.map((command) => (
                        <button
                          key={command.label}
                          onClick={() => applyCommand(command)}
                          title={command.description}
                          className="shrink-0 rounded-lg bg-background/70 px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
                        >
                          {command.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {attachments.filter(att => att.status === 'ready' || att.status === 'processed' || att.status === 'failed').length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2">
                    {attachments.slice(0, 6).map(att => (
                      <span
                        key={att.id}
                        className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
                          att.status === 'failed'
                            ? 'bg-destructive/10 text-destructive'
                            : att.mode === 'raw_context'
                              ? 'bg-primary/10 text-primary'
                              : 'bg-muted text-muted-foreground'
                        }`}
                        title={att.error_message ?? att.text_excerpt ?? att.filename}
                      >
                        <FileText className="h-3 w-3 shrink-0" />
                        <span className="truncate max-w-[12rem]">{att.filename}</span>
                        <span className="hidden sm:inline">{att.mode === 'raw_context' ? 'Raw Context' : 'Active Context'}</span>
                        {!att.consumed_at && att.status === 'ready' && (
                          <button onClick={() => removeAttachment(att.id)} className="rounded-full hover:text-foreground" title="Remove attachment">
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex items-end gap-2 p-2">
                  <div className="mb-0.5 flex shrink-0 items-center rounded-xl border border-border bg-muted/30 p-1">
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      accept=".txt,.md,.csv,.pdf,.docx,.json,.xml,.html"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handleAttachmentFile(file);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingAttachment || streaming}
                      className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:opacity-50"
                      title={attachmentMode === 'raw_context' ? 'Attach and process into Raw Context' : 'Attach as temporary Active Context'}
                    >
                      {uploadingAttachment ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                    </button>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => setAttachmentMode(mode => mode === 'active_context' ? 'raw_context' : 'active_context')}
                          aria-label="Toggle attachment mode"
                          className={`rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${
                            attachmentMode === 'raw_context'
                              ? 'bg-primary/10 text-primary'
                              : 'bg-background text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          {attachmentMode === 'raw_context' ? 'Raw' : 'Chat'}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" align="start" className="max-w-72 text-xs leading-relaxed">
                        <div className="space-y-1.5">
                          <p><span className="font-semibold text-foreground">Chat</span> uses the file only in this conversation as temporary Active Context.</p>
                          <p><span className="font-semibold text-foreground">Raw</span> sends the file into Raw Context so CRMy can extract Signals and Memory.</p>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleComposerKeyDown}
                    placeholder={entityContext ? `Ask about ${entityContext.name}...` : 'Ask your workspace agent...'}
                    rows={1}
                    disabled={streaming}
                    className="flex-1 resize-none bg-transparent px-2 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
                  />
                  <button
                    onClick={sendComposerMessage}
                    disabled={!input.trim() || streaming}
                    className="p-2.5 rounded-xl bg-white text-slate-950 hover:bg-white/90 hover:shadow-md disabled:opacity-40 transition-all press-scale"
                  >
                    {streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Session sidebar (desktop) ── */}
        {sessionsOpen && (
        <div className="hidden lg:flex flex-col w-72 border-l border-border bg-surface">
          <div className="px-4 pt-4 pb-2 flex items-center justify-between">
            <h3 className="font-display font-bold text-foreground text-sm flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
              Sessions
            </h3>
            <button
              onClick={startNewChat}
              className="text-xs text-primary hover:underline"
            >
              + New
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-4">
            {sessions.length === 0 && (
              <p className="text-xs text-muted-foreground px-3 py-2">No conversations yet.</p>
            )}
            <div className="space-y-1">
              {sessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  isActive={activeSessionId === session.id}
                  taskStatus={session.active_turn ? 'running' : activeSessionId === session.id ? task?.status : undefined}
                  onSelect={() => loadSession(session)}
                  onRenamed={() => refetchSessions()}
                  onDeleted={() => {
                    if (activeSessionId === session.id) startNewChat();
                    refetchSessions();
                  }}
                />
              ))}
            </div>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

function AgentTrustBar({
  provider,
  model,
  canWrite,
  canHandoff,
  autoExtract,
  hasSubject,
}: {
  provider?: string;
  model?: string;
  canWrite?: boolean;
  canHandoff?: boolean;
  autoExtract?: boolean;
  hasSubject?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const actionLabel = canWrite ? 'writes require policy/audit' : 'read-only by default';

  return (
    <div className="border-b border-border bg-card/60">
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs text-muted-foreground hover:bg-muted/40 transition-colors"
      >
        <ShieldCheck className="w-3.5 h-3.5 text-primary" />
        <span className="font-medium text-foreground">Trust boundary</span>
        <span className="hidden sm:inline">
          {provider && model ? `${provider} · ${model}` : 'Model configured'} · reads Memory and Signals · {actionLabel}
        </span>
        <span className="ml-auto inline-flex items-center gap-1 text-primary">
          Details {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </span>
      </button>
      {expanded && (
        <div className="grid gap-2 border-t border-border px-4 py-3 text-xs sm:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-lg bg-muted/40 p-2">
            <p className="font-semibold text-foreground">Model</p>
            <p className="mt-0.5 text-muted-foreground">{provider && model ? `${provider} · ${model}` : 'Configured in Model Settings'}</p>
          </div>
          <div className="rounded-lg bg-muted/40 p-2">
            <p className="font-semibold text-foreground">Writes</p>
            <p className="mt-0.5 text-muted-foreground">{canWrite ? 'Visible, scoped, and auditable.' : 'Disabled until enabled in settings.'}</p>
          </div>
          <div className="rounded-lg bg-muted/40 p-2">
            <p className="font-semibold text-foreground">Handoffs</p>
            <p className="mt-0.5 text-muted-foreground">{canHandoff ? 'Can route risky decisions for review.' : 'Review requests are disabled.'}</p>
          </div>
          <div className="rounded-lg bg-muted/40 p-2">
            <p className="font-semibold text-foreground">Active Context</p>
            <p className="mt-0.5 text-muted-foreground">{hasSubject ? 'Record metadata is loaded. Briefings add Memory and Signals when needed.' : 'This chat starts with session context and tool results.'}</p>
          </div>
          <div className="rounded-lg bg-muted/40 p-2">
            <p className="font-semibold text-foreground">Memory</p>
            <p className="mt-0.5 text-muted-foreground">{autoExtract ? 'Useful chats can propose reviewed Memory.' : 'Conversation Memory proposals are off.'}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function AgentTaskCard({
  task,
  onRetry,
  onStop,
}: {
  task: AgentTaskState;
  onRetry: () => void;
  onStop: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const statusCopy: Record<AgentTaskStatus, { label: string; description: string }> = {
    running: {
      label: 'Running',
      description: 'The agent is actively working through the task, retrieving context, using scoped tools, and preparing a response.',
    },
    waiting_approval: {
      label: 'Waiting approval',
      description: 'The agent reached a governed action boundary and needs a human decision before continuing.',
    },
    failed: {
      label: 'Failed',
      description: 'The task stopped because a tool, permission check, model call, or network request failed.',
    },
    complete: {
      label: 'Complete',
      description: 'The agent finished the task and returned a response or next step.',
    },
  };
  const riskCopy: Record<AgentTaskRisk, { label: string; description: string }> = {
    low: {
      label: 'Low risk',
      description: 'Mostly read-only work, such as retrieval, briefing, summarization, or planning.',
    },
    medium: {
      label: 'Medium risk',
      description: 'This may prepare or request scoped changes, create Memory, or route work for review. Writes still follow permissions and audit.',
    },
    high: {
      label: 'High risk',
      description: 'This may involve sensitive actions such as sends, approvals, ownership, pricing, contracts, or destructive changes.',
    },
  };
  const stepCopy: Record<string, string> = {
    understand: 'Clarify the user goal, customer scope, and likely action boundary.',
    context: 'Retrieve relevant records, Memory, Signals, activities, and prior handoffs.',
    tools: 'Use CRMy tools that are allowed for the current user and visible records.',
    review: 'Check whether the answer, update, handoff, or writeback needs policy review.',
    answer: 'Return the final answer with evidence, assumptions, and the next useful step.',
  };
  const stepStatusCopy: Record<AgentTaskStepStatus, string> = {
    pending: 'Not started yet.',
    running: 'In progress.',
    complete: 'Completed.',
    failed: 'This phase hit an error.',
    skipped: 'Skipped because this phase was not needed for the request.',
  };
  const statusTone =
    task.status === 'complete' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' :
    task.status === 'failed' ? 'bg-destructive/10 text-destructive' :
    task.status === 'waiting_approval' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' :
    'bg-purple-500/10 text-purple-700 dark:text-purple-300';
  const riskTone =
    task.risk === 'high' ? 'bg-destructive/10 text-destructive' :
    task.risk === 'medium' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' :
    'bg-muted text-muted-foreground';

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center flex-shrink-0">
          <ClipboardList className="w-4 h-4 text-purple-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">Agent task</p>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={`cursor-help rounded-full px-2 py-0.5 text-xs font-medium ${statusTone}`}>
                  {statusCopy[task.status].label}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-72 text-xs leading-relaxed">
                {statusCopy[task.status].description}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={`cursor-help rounded-full px-2 py-0.5 text-xs font-medium ${riskTone}`}>
                  {riskCopy[task.risk].label}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-72 text-xs leading-relaxed">
                <p>{riskCopy[task.risk].description}</p>
                <p className="mt-1 text-muted-foreground">Risk is estimated from the request and enabled agent capabilities; policy still controls writes and handoffs.</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{task.goal}</p>
          {task.subject && (
            <p className="text-xs text-muted-foreground/70 mt-1">
              Subject: {typeLabels[task.subject.type]} · {task.subject.name}
            </p>
          )}
        </div>
        {task.status === 'running' && (
          <button onClick={onStop} className="text-xs rounded-lg px-2 py-1 bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors">
            Stop
          </button>
        )}
        {task.status === 'failed' && (
          <button onClick={onRetry} className="text-xs rounded-lg px-2 py-1 bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
            Retry
          </button>
        )}
        <button
          onClick={() => setExpanded(v => !v)}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title={expanded ? 'Collapse task details' : 'Expand task details'}
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          Details
        </button>
      </div>
      {expanded && (
        <div className="px-4 py-3 space-y-2">
          {task.steps.map(step => (
            <div key={step.id} className="flex items-center gap-2 text-sm">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex cursor-help">
                  {step.status === 'complete' ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> :
                    step.status === 'failed' ? <AlertTriangle className="w-4 h-4 text-destructive" /> :
                    step.status === 'running' ? <Loader2 className="w-4 h-4 text-purple-500 animate-spin" /> :
                    <Circle className="w-4 h-4 text-muted-foreground/40" />}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-72 text-xs leading-relaxed">
                <p>{stepCopy[step.id] ?? step.label}</p>
                <p className="mt-1 text-muted-foreground">{stepStatusCopy[step.status]}</p>
              </TooltipContent>
            </Tooltip>
            <span className={step.status === 'pending' || step.status === 'skipped' ? 'text-muted-foreground' : 'text-foreground'}>{step.label}</span>
            {step.status === 'skipped' && <span className="text-xs text-muted-foreground/70">Not needed</span>}
            {step.toolName && <code className="ml-auto text-[11px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{step.toolName}</code>}
          </div>
        ))}
          {task.changedRecords.length > 0 && (
            <div className="pt-2 border-t border-border">
              <p className="text-xs font-semibold text-foreground mb-1">Changed records</p>
              <div className="flex flex-wrap gap-1.5">
                {task.changedRecords.map(record => (
                  <span key={record} className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-300">{record}</span>
                ))}
              </div>
            </div>
          )}
          {task.status === 'waiting_approval' && (
            <Link to="/handoffs" className="inline-flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300 hover:underline">
              <GitPullRequestArrow className="w-3 h-3" />
              Review pending handoffs
            </Link>
          )}
          {task.nextAction && (
            <p className="text-xs text-muted-foreground pt-1">Next: {task.nextAction}</p>
          )}
        </div>
      )}
    </motion.div>
  );
}

function ContextUsedPanel({ evidence }: { evidence: NonNullable<ReturnType<typeof buildContextEvidence>> }) {
  const subject = evidence.subject;
  return (
    <div className="rounded-xl border border-border bg-card/80 px-4 py-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileCheck2 className="w-4 h-4 text-primary" />
          <div>
            <p className="text-sm font-semibold text-foreground">Active Context used</p>
            <p className="text-xs text-muted-foreground">
              The temporary working set visible to the agent in this session.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-xs">
          <Link to="/context" className="rounded-lg border border-border bg-background px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            Memory Browser
          </Link>
          <Link to="/handoffs" className="rounded-lg border border-border bg-background px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            Handoffs
          </Link>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        {subject && (
          <span className="rounded-full bg-accent/10 text-accent px-2.5 py-1">
            {typeLabels[subject.type]} · {subject.name}
          </span>
        )}
        <span className={`rounded-full px-2.5 py-1 ${evidence.usedBriefing ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}>
          Briefing {evidence.usedBriefing ? 'used' : 'not run'}
        </span>
        <span className={`rounded-full px-2.5 py-1 ${evidence.usedMemory ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}>
          Memory {evidence.usedMemory ? 'queried' : 'not queried'}
        </span>
        <span className={`rounded-full px-2.5 py-1 ${evidence.usedActivity ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
          Activities {evidence.usedActivity ? 'checked' : 'not checked'}
        </span>
        <span className={`rounded-full px-2.5 py-1 ${evidence.usedHandoff ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-muted text-muted-foreground'}`}>
          Handoffs {evidence.usedHandoff ? 'involved' : 'not involved'}
        </span>
        <span className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground">
          {evidence.toolCount} tool event{evidence.toolCount === 1 ? '' : 's'}
        </span>
      </div>
      {evidence.warnings.length > 0 && (
        <div className="mt-2 space-y-1">
          {evidence.warnings.map(warning => (
            <p key={warning} className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle className="w-3 h-3" />
              {warning}
            </p>
          ))}
        </div>
      )}
      {subject && (
        <div className="mt-2 text-xs">
          <Link to={`/audit-log?object_type=${normalizeSubjectType(subject.type)}&object_id=${encodeURIComponent(subject.id)}`} className="text-muted-foreground hover:text-foreground hover:underline">
            Audit history
          </Link>
        </div>
      )}
    </div>
  );
}

function MemoryReviewPanel({
  proposals,
  onApprove,
  onUpdate,
}: {
  proposals: MemoryProposal[];
  onApprove: (proposal: MemoryProposal) => void;
  onUpdate: (id: string, patch: Partial<MemoryProposal>) => void;
}) {
  const visible = proposals.filter(proposal => proposal.status !== 'discarded');
  if (visible.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card/80 px-4 py-3 space-y-3">
      <div className="flex items-start gap-2">
        <Database className="w-4 h-4 text-primary mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-foreground">Memory review</p>
          <p className="text-xs text-muted-foreground">Approve useful conversation context before it becomes workspace memory.</p>
        </div>
      </div>
      {visible.map(proposal => (
        <div key={proposal.id} className="rounded-lg border border-border bg-background/50 p-3 space-y-2">
          <input
            value={proposal.title}
            onChange={(e) => onUpdate(proposal.id, { title: e.target.value })}
            disabled={proposal.status === 'approved' || proposal.status === 'saving'}
            className="w-full bg-transparent text-sm font-medium text-foreground outline-none border-b border-border pb-1 disabled:opacity-70"
          />
          <textarea
            value={proposal.body}
            onChange={(e) => onUpdate(proposal.id, { body: e.target.value })}
            disabled={proposal.status === 'approved' || proposal.status === 'saving'}
            rows={3}
            className="w-full resize-none rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary/40 disabled:opacity-70"
          />
          {proposal.error && <p className="text-xs text-destructive">{proposal.error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => onApprove(proposal)}
              disabled={proposal.status === 'approved' || proposal.status === 'saving'}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-colors"
            >
              {proposal.status === 'saving' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              {proposal.status === 'approved' ? 'Saved' : 'Approve memory'}
            </button>
            <button
              onClick={() => onUpdate(proposal.id, { status: 'temporary' })}
              disabled={proposal.status === 'approved' || proposal.status === 'saving'}
              className="rounded-lg bg-muted px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-60"
            >
              Temporary
            </button>
            <button
              onClick={() => onUpdate(proposal.id, { status: 'discarded' })}
              disabled={proposal.status === 'approved' || proposal.status === 'saving'}
              className="rounded-lg bg-muted px-2.5 py-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors disabled:opacity-60"
            >
              Discard
            </button>
            {proposal.status === 'temporary' && <span className="text-xs text-muted-foreground">Kept in chat only.</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Typing Indicator ────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      className="flex justify-start"
    >
      <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center mr-2 flex-shrink-0 mt-1">
        <Bot className="w-4 h-4 text-violet-500" />
      </div>
      <div className="bg-card border border-border rounded-2xl rounded-bl-md px-4 py-3.5 shadow-sm flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-primary/50 animate-bounce [animation-delay:0ms]" />
        <span className="w-2 h-2 rounded-full bg-primary/50 animate-bounce [animation-delay:150ms]" />
        <span className="w-2 h-2 rounded-full bg-primary/50 animate-bounce [animation-delay:300ms]" />
      </div>
    </motion.div>
  );
}

// ── Thinking Bubble ─────────────────────────────────────────────────────────

function ThinkingBubble({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = content.trim().split('\n').length;
  const preview = content.trim().split('\n').slice(0, 2).join(' ').slice(0, 100);

  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex justify-start pl-10">
      <div className="max-w-[80%] rounded-xl border border-primary/20 bg-primary/5 text-xs overflow-hidden">
        <button
          onClick={() => setExpanded(v => !v)}
          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-primary/10 transition-colors"
        >
          <Brain className="w-3 h-3 text-primary/60 shrink-0" />
          <span className="text-primary/70 font-medium shrink-0">
            {expanded ? 'Model reasoning' : `Model reasoning · ${lines} line${lines !== 1 ? 's' : ''}`}
          </span>
          {!expanded && (
            <span className="text-muted-foreground truncate flex-1 min-w-0">{preview}</span>
          )}
          {expanded
            ? <ChevronDown className="w-3 h-3 text-muted-foreground ml-auto shrink-0" />
            : <ChevronRight className="w-3 h-3 text-muted-foreground ml-auto shrink-0" />}
        </button>
        {expanded && (
          <div className="px-3 pb-3 pt-1 border-t border-primary/10">
            <pre className="whitespace-pre-wrap text-muted-foreground font-mono text-[11px] leading-relaxed">
              {content}
            </pre>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Expandable Step ──────────────────────────────────────────────────────────

function ExpandableStep({ step }: { step: ToolGroupStep }) {
  const [open, setOpen] = useState(false);
  const done = step.status.endsWith('✓');
  const err = step.status.startsWith('Error') || step.is_error;
  const hasDetail = step.arguments !== undefined || step.result !== undefined;
  const inputSummary = summarizeToolInput(step.arguments);
  const outputSummary = summarizeToolOutput(step.result, step.is_error);

  return (
    <div className="rounded-lg bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
      <button
        onClick={() => hasDetail && setOpen(v => !v)}
        className={`flex w-full items-start gap-2 text-left ${hasDetail ? 'hover:text-foreground transition-colors cursor-pointer' : 'cursor-default'}`}
      >
        <Wrench className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${err ? 'text-destructive' : done ? 'text-emerald-500' : 'text-primary'}`} />
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-foreground">{humanizeToolName(step.name)}</span>
          <span className={err ? 'text-destructive' : 'text-muted-foreground'}>
            {step.status}
            {inputSummary ? ` · ${inputSummary}` : ''}
            {outputSummary ? ` → ${outputSummary}` : ''}
          </span>
        </span>
        {hasDetail && (
          <span className="ml-auto mt-0.5 opacity-60">
            {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </span>
        )}
      </button>
      {open && (
        <div className="mt-2 space-y-2 border-t border-border pt-2">
          {step.arguments !== undefined && (
            <div>
              <p className="text-muted-foreground/50 uppercase tracking-wider text-[10px] mb-0.5">Input</p>
              <pre className="text-[10px] font-mono bg-muted/50 rounded p-1.5 overflow-x-auto max-h-32 text-foreground/70">
                {JSON.stringify(step.arguments, null, 2)}
              </pre>
            </div>
          )}
          {step.result !== undefined && (
            <div>
              <p className={`uppercase tracking-wider text-[10px] mb-0.5 ${step.is_error ? 'text-destructive/70' : 'text-muted-foreground/50'}`}>
                {step.is_error ? 'Error' : 'Output'}
              </p>
              <pre className={`text-[10px] font-mono rounded p-1.5 overflow-x-auto max-h-40 ${step.is_error ? 'bg-destructive/10 text-destructive' : 'bg-muted/50 text-foreground/70'}`}>
                {JSON.stringify(step.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Tool Group (collapsible) ─────────────────────────────────────────────────

function ToolGroup({ group, showProcess }: { group: ToolGroupItem; showProcess: boolean }) {
  const allDone = group.steps.every(s => s.status.endsWith('✓') || s.status.startsWith('Error') || s.is_error);
  const hasError = group.steps.some(s => s.status.startsWith('Error') || s.is_error);
  const [expanded, setExpanded] = useState(hasError); // auto-expand on error
  useEffect(() => {
    if (showProcess) setExpanded(true);
  }, [showProcess]);

  // While running: show current active step name
  const activeStep = group.steps.find(s => !s.status.endsWith('✓') && !s.status.startsWith('Error'));
  const currentStatus = activeStep?.status ?? (hasError ? 'Error in tool call' : `${group.steps.length} step${group.steps.length !== 1 ? 's' : ''} complete`);
  const primaryTool = activeStep?.name ?? group.steps[group.steps.length - 1]?.name ?? group.steps[0]?.name;
  const summary = primaryTool ? humanizeToolName(primaryTool) : 'Tool activity';

  const iconClass = hasError ? 'text-destructive' : allDone ? 'text-emerald-500' : 'text-primary animate-pulse';

  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="px-2 py-1">
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex w-full items-center gap-2 rounded-xl border border-border bg-card/70 px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors group"
      >
        <Wrench className={`w-3 h-3 shrink-0 ${iconClass}`} />
        <span className={hasError ? 'text-destructive' : allDone ? 'text-foreground' : 'text-foreground/80'}>
          {allDone
            ? `Used ${summary}`
            : currentStatus}
        </span>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {group.steps.length} {group.steps.length === 1 ? 'step' : 'steps'}
        </span>
        <span className="ml-auto opacity-70 transition-opacity group-hover:opacity-100">
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </span>
      </button>
      {expanded && (
        <div className="mt-2 ml-5 space-y-1.5 border-l border-border pl-3">
          {group.steps.map(step => (
            <ExpandableStep key={step.id} step={step} />
          ))}
        </div>
      )}
    </motion.div>
  );
}

// ── Message Bubble ──────────────────────────────────────────────────────────

function MessageBubble({ item, index, showProcess, onRetry }: { item: RenderItem; index: number; showProcess: boolean; onRetry?: () => void }) {
  if (item.kind === 'tool_group') {
    return <ToolGroup group={item} showProcess={showProcess} />;
  }

  const msg = item as DisplayMessage;

  if (msg.kind === 'thinking') {
    return showProcess ? <ThinkingBubble content={msg.content} /> : null;
  }

  if (msg.kind === 'tool_status' || msg.kind === 'tool_call' || msg.kind === 'tool_result') {
    // These are handled by ToolGroup — skip
    return null;
  }

  if (msg.kind === 'error') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-start gap-3 px-4 py-3 rounded-xl bg-destructive/8 border border-destructive/20"
      >
        <WifiOff className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-destructive">{msg.message}</p>
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="flex items-center gap-1 text-xs text-destructive bg-destructive/10 hover:bg-destructive/20 px-2 py-1 rounded-lg transition-colors flex-shrink-0"
            title="Retry last message"
          >
            <RotateCcw className="w-3 h-3" />
            Retry
          </button>
        )}
      </motion.div>
    );
  }

  const isUser = msg.kind === 'user';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.03, 0.3) }}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      {!isUser && (
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center mr-2 flex-shrink-0 mt-1">
          <Bot className="w-4 h-4 text-violet-500" />
        </div>
      )}
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm
          ${isUser
            ? 'whitespace-pre-wrap bg-gradient-to-br from-[#6366f1] via-[#7c3aed] to-[#a855f7] text-white rounded-br-md shadow-sm shadow-[#6366f1]/20'
            : 'bg-card border border-border text-foreground rounded-bl-md shadow-sm'
          }`}
      >
        {isUser ? msg.content : <AgentMarkdown content={msg.content} />}
      </div>
    </motion.div>
  );
}
