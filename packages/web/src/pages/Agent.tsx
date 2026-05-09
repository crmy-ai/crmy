// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { TopBar } from '@/components/layout/TopBar';
import { AgentStatusDot } from '@/components/crm/CrmWidgets';
import { useAppStore, type AIContextEntity } from '@/store/appStore';
import { useAgentSettings } from '@/contexts/AgentSettingsContext';
import {
  useAgentSessions,
  useCreateAgentSession,
  useCreateContextEntry,
  useDeleteAgentSession,
  useRenameAgentSession,
  type AgentSessionSummary,
} from '@/api/hooks';
import {
  Send, Bot, X, User, Briefcase, Building, Layers, Clock, Loader2, Wrench,
  ChevronDown, ChevronRight, Pencil, Trash2, Check, MessageSquare,
  Brain, Eye, EyeOff, RotateCcw, WifiOff, ClipboardList, ShieldCheck,
  ShieldAlert, Database, CheckCircle2, Circle, AlertTriangle, FileCheck2,
  GitPullRequestArrow,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  streamChat, groupToolMessages, getSuggestions,
  SYSTEM_INIT_PREFIX, COMPACT_SUMMARY_PREFIX, COMPACT_ACK_PREFIX,
  type DisplayMessage, type RenderItem, type ToolGroupItem, type ToolGroupStep,
} from '@/lib/agentStream';
import { AgentMarkdown } from '@/components/ui/agent-markdown';
import { ENTITY_COLORS } from '@/lib/entityColors';

const agentDescription = 'Private workspace reasoning over typed revenue objects, customer context, and scoped CRMy tools.';
const agentIconClassName = ENTITY_COLORS.agents.text;

const typeIcons: Record<string, typeof User> = {
  contact: User, opportunity: Briefcase, 'use-case': Layers, account: Building,
};
const typeLabels: Record<string, string> = {
  contact: 'Contact', opportunity: 'Opportunity', 'use-case': 'Use Case', account: 'Account',
};

// ── Message filtering helpers ────────────────────────────────────────────────

type RawMsg = { role: string; content: string };

/** True for messages that should count as visible / meaningful in the chat. */
function isVisibleMsg(m: RawMsg): boolean {
  if (m.role === 'system') return false;
  if (m.role === 'user' && m.content?.startsWith(SYSTEM_INIT_PREFIX)) return false;
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

type AgentTaskStatus = 'running' | 'waiting_approval' | 'failed' | 'complete';
type AgentTaskRisk = 'low' | 'medium' | 'high';
type AgentTaskStepStatus = 'pending' | 'running' | 'complete' | 'failed';

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
      { id: 'understand', label: 'Clarify goal and subject', status: 'complete' },
      { id: 'context', label: 'Gather customer context', status: subject ? 'pending' : 'complete' },
      { id: 'tools', label: 'Use scoped tools if needed', status: 'pending' },
      { id: 'review', label: 'Review safety, audit, and next action', status: 'pending' },
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
  return {
    ...task,
    status: 'complete',
    completedAt: Date.now(),
    nextAction: task.changedRecords.length > 0 ? 'Review audit trail' : 'Save useful context or choose a next workflow',
    steps: task.steps.map(step => ({ ...step, status: step.status === 'pending' || step.status === 'running' ? 'complete' : step.status })),
  };
}

function getWorkflowCommands(subject: AIContextEntity | null): WorkflowCommand[] {
  const target = subject ? `this ${typeLabels[subject.type].toLowerCase()} (${subject.name})` : 'the selected customer record';
  return [
    { label: '/account brief', prompt: `Get a briefing for ${target}. Include current context, recent activity, risks, and recommended next action.` },
    { label: '/deal review', prompt: `Review the deal context for ${target}. Summarize stage fit, blockers, health, probability, and next steps.` },
    { label: '/renewal risk', prompt: `Assess renewal risk for ${target}. Look for stale context, missing activity, objections, and handoff needs.` },
    { label: '/next best action', prompt: `Recommend the next best action for ${target}. Explain the evidence and whether a handoff or write needs approval.` },
    { label: '/meeting prep', prompt: `Prepare meeting notes for ${target}. Include what changed, open questions, and suggested agenda.` },
    { label: '/follow-up summary', prompt: `Draft a follow-up summary for ${target}. Ground it in known context and call out assumptions.` },
    { label: '/handoff prep', prompt: `Prepare a human handoff for ${target}. Include urgency, owner, reasoning, and context the reviewer needs.` },
    { label: '/stale context review', prompt: `Review stale or weak context for ${target}. Suggest what should be refreshed before action.` },
    { label: '/data quality scan', prompt: `Scan data quality for ${target}. Identify missing relationships, weak fields, and conflicts that could affect agent work.` },
  ];
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
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [entityContext, setEntityContext] = useState<AIContextEntity | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const didRestoreRef = useRef(false);
  const launchContextRef = useRef<string | null>(null);

  // Track the last message the user sent so we can retry it after errors.
  const [lastSentMessage, setLastSentMessage] = useState('');
  const [task, setTask] = useState<AgentTaskState | null>(null);
  const [memoryProposals, setMemoryProposals] = useState<MemoryProposal[]>([]);
  // True when we've sent a message but haven't received the agent's response yet —
  // covers both the live-streaming window and the "navigated away mid-turn" case.
  const [isSessionPending, setIsSessionPending] = useState(false);

  // Verbose mode: when on, show reasoning bubbles and tool call/result details.
  // Persisted to localStorage so users who build trust can keep it hidden.
  const [verbose, setVerbose] = useState<boolean>(() => {
    try { return localStorage.getItem('crmy_agent_verbose') !== 'false'; } catch { return true; }
  });
  const toggleVerbose = () => setVerbose(v => {
    const next = !v;
    try { localStorage.setItem('crmy_agent_verbose', String(next)); } catch {}
    return next;
  });

  const { aiContext } = useAppStore();
  const { enabled, loading: configLoading, connectivity, config } = useAgentSettings();
  const { data: sessionsData, refetch: refetchSessions } = useAgentSessions();
  const createSession = useCreateAgentSession();
  const renameSession = useRenameAgentSession();
  const createContextEntry = useCreateContextEntry();

  const sessions: AgentSessionSummary[] = sessionsData?.data ?? [];

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
    setTask(null);
    setMemoryProposals([]);
    setEntityContext(contextOverride ?? (session.context_type ? {
      type: session.context_type as AIContextEntity['type'],
      id: session.context_id ?? '',
      name: session.context_name ?? '',
    } : null));

    const token = localStorage.getItem('crmy_token');
    try {
      const res = await fetch(`/api/v1/agent/sessions/${session.id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const { data } = await res.json();
        const rawMsgs: { role: string; content: string }[] = data.messages ?? [];
        setMessages(rawMsgsToDisplay(rawMsgs));

        // Detect an incomplete turn: if the last meaningful message is from the user,
        // the server is still (or was) working on a response. Start polling.
        const lastMeaningful = [...rawMsgs]
          .reverse()
          .find(m => isVisibleMsg(m));
        if (lastMeaningful?.role === 'user') {
          setIsSessionPending(true);
        }
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
    setLastSentMessage('');
    setTask(null);
    setMemoryProposals([]);

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
      setMessages([{ kind: 'error', message: (err as Error).message }]);
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
    setActiveSessionId(null);
    setMessages([]);
    setEntityContext(null);
    setInput('');
    setIsSessionPending(false);
    setLastSentMessage('');
    setTask(null);
    setMemoryProposals([]);
  }, []);

  const sendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText !== undefined ? overrideText : input).trim();
    if (!text || streaming) return;
    if (overrideText === undefined) setInput('');

    setLastSentMessage(text);
    setIsSessionPending(true);
    const nextTask = createAgentTask(text, entityContext, config?.can_write_objects);
    if (nextTask) setTask(nextTask);

    // Add user message immediately (skip if retrying — user message already shown)
    if (overrideText === undefined) {
      setMessages(prev => [...prev, { kind: 'user', content: text }]);
    }

    setStreaming(true);
    const abort = new AbortController();
    abortRef.current = abort;

    // Track whether any assistant content arrived via SSE so we can fallback
    // to a server reload if the connection was buffered.
    // NOTE: this is intentionally NOT set inside a setMessages updater — updaters
    // can be called multiple times (React Strict Mode) and must be side-effect-free.
    let hasAssistantContent = false;
    let receivedDone = false;
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

      // Streaming accumulator for assistant text.
      // Reset to '' each time a tool_status arrives so the post-tool response
      // starts a fresh bubble rather than appending to a pre-tool one.
      let assistantText = '';

      await streamChat(sessionId, text, (event) => {
        switch (event.type) {
          case 'delta': {
            assistantText += event.content;
            hasAssistantContent = true;
            // Capture the accumulated text so the pure updater below is
            // side-effect-free (React may call updaters more than once).
            const snapshot = assistantText;
            setMessages(prev => {
              const last = prev[prev.length - 1];
              if (last?.kind === 'assistant') {
                // Extend the existing assistant bubble in-place
                return [...prev.slice(0, -1), { kind: 'assistant', content: snapshot }];
              }
              // No assistant bubble yet for this turn — create one
              return [...prev, { kind: 'assistant', content: snapshot }];
            });
            break;
          }

          case 'tool_status':
            setTask(prev => updateTaskForToolStatus(prev, event.name));
            // Reset accumulator so the next delta starts a fresh assistant bubble
            // after the tool call, rather than appending to any pre-tool text.
            assistantText = '';
            // Append or update the status row (collapse duplicates by tool id)
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

          case 'thinking': {
            // Accumulate reasoning text — one bubble per turn_id
            setMessages(prev => {
              const last = prev[prev.length - 1];
              if (last?.kind === 'thinking' && last.turn_id === event.turn_id) {
                return [...prev.slice(0, -1), { ...last, content: last.content + event.content }];
              }
              return [...prev, { kind: 'thinking', content: event.content, turn_id: event.turn_id }];
            });
            break;
          }

          case 'tool_call':
            // Store in messages so groupToolMessages can attach arguments to ToolGroupStep
            setMessages(prev => [...prev, { kind: 'tool_call', id: event.id, name: event.name, arguments: event.arguments, turn_id: event.turn_id }]);
            break;

          case 'tool_result':
            setTask(prev => updateTaskForToolResult(prev, event.name, event.is_error, event.result));
            // Update status text AND store result so groupToolMessages can show it in expanded view
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
            setMessages(prev => [...prev, { kind: 'error', message: event.message }]);
            break;

          case 'done':
            receivedDone = true;
            setIsSessionPending(false);
            setTask(prev => completeTask(prev));
            if (entityContext && nextTask) {
              const proposal = buildMemoryProposal(assistantText);
              if (proposal) {
                setMemoryProposals(prev => [proposal, ...prev].slice(0, 3));
              }
            }
            refetchSessions();
            break;
        }
      }, abort.signal, entityContext?.detail ? { context_detail: entityContext.detail } : undefined);
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        // User deliberately stopped — clear pending, no error bubble.
        setIsSessionPending(false);
      } else {
        // Network / server error. Keep isSessionPending=true so polling can
        // recover if the server finishes the turn after disconnect.
        setTask(prev => prev ? { ...prev, status: 'failed', nextAction: 'Retry after the connection recovers.' } : prev);
        setMessages(prev => [...prev, { kind: 'error', message: (err as Error).message }]);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;

      // Fallback: if the SSE stream completed but no assistant content arrived
      // (proxy buffered the response and flushed only at close), reload from server.
      if (!hasAssistantContent && !receivedDone && resolvedSessionId) {
        const sid = resolvedSessionId;
        const token = localStorage.getItem('crmy_token');
        fetch(`/api/v1/agent/sessions/${sid}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
          .then(r => r.ok ? r.json() : null)
          .then(json => {
            if (!json?.data?.messages) return;
            const display = rawMsgsToDisplay(json.data.messages as { role: string; content: string }[]);
            if (display.length > 0) setMessages(display);
          })
          .catch(() => { /* ignore */ });
      }
    }
  }, [input, streaming, activeSessionId, entityContext, config?.can_write_objects, createSession, refetchSessions, sessions, queryClient, renameSession]);

  // Retry the last sent message: strip error bubbles and re-send.
  const retryLast = useCallback(() => {
    if (!lastSentMessage || streaming) return;
    setMessages(prev => prev.filter(m => m.kind !== 'error'));
    sendMessage(lastSentMessage);
  }, [lastSentMessage, streaming, sendMessage]);

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
    const token = localStorage.getItem('crmy_token');

    const check = async () => {
      try {
        const res = await fetch(`/api/v1/agent/sessions/${sid}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const { data } = await res.json();
        const rawMsgs: { role: string; content: string }[] = data.messages ?? [];
        // If the last meaningful message is now from assistant, the turn completed.
        const lastMeaningful = [...rawMsgs].reverse().find(m => isVisibleMsg(m));
        if (lastMeaningful?.role === 'assistant') {
          setIsSessionPending(false);
          setMessages(rawMsgsToDisplay(rawMsgs));
          refetchSessions();
        }
      } catch { /* ignore */ }
    };

    check(); // run immediately once, then on interval
    pollRef.current = setInterval(check, 3000);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [isSessionPending, streaming, activeSessionId, refetchSessions]);

  const suggestions = getSuggestions(entityContext?.type ?? null, entityContext?.name ?? null);
  const workflowCommands = getWorkflowCommands(entityContext);
  const contextEvidence = buildContextEvidence(messages, entityContext);

  const IconComponent = entityContext ? typeIcons[entityContext.type] : null;

  const connectivityLabel =
    connectivity === 'online'  ? 'Workspace Agent online' :
    connectivity === 'offline' ? 'Agent offline' :
    'Workspace Agent';

  // ── Loading state — wait for config before deciding enabled/disabled ──
  if (configLoading) {
    return (
      <div className="flex flex-col h-full">
        <TopBar title="Workspace Agent" icon={Bot} iconClassName={agentIconClassName} description={agentDescription} />
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
        <TopBar title="Workspace Agent" icon={Bot} iconClassName={agentIconClassName} description={agentDescription} />
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-md space-y-3">
            <Bot className="w-12 h-12 mx-auto text-muted-foreground/40" />
            <h2 className="text-lg font-display font-bold text-foreground">Workspace Agent is not enabled</h2>
            <p className="text-sm text-muted-foreground">
              Enable it in <span className="text-foreground font-medium">Settings → Model Settings</span> to let the app reason over local customer context, call scoped tools, and keep sensitive workspace state under your control.
            </p>
            <Link
              to="/settings/model"
              className="inline-flex items-center justify-center h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              Configure Workspace Agent
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Workspace Agent" icon={Bot} iconClassName={agentIconClassName} description={agentDescription} />
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
              {streaming && (
                <span className="flex items-center gap-1 text-xs text-primary ml-2">
                  <Loader2 className="w-3 h-3 animate-spin" /> Thinking…
                </span>
              )}
              <div className="ml-auto flex items-center gap-2">
                {streaming && (
                  <button
                    onClick={() => abortRef.current?.abort()}
                    className="text-xs text-destructive bg-destructive/10 px-2 py-0.5 rounded-full hover:bg-destructive/20 transition-colors"
                  >
                    Stop
                  </button>
                )}
                <button
                  onClick={toggleVerbose}
                  title={verbose ? 'Hide reasoning & tool details' : 'Show reasoning & tool details'}
                  className={`p-1 rounded-md transition-colors ${verbose ? 'text-primary bg-primary/10 hover:bg-primary/20' : 'text-muted-foreground hover:bg-muted'}`}
                >
                  {verbose ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
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
          />

          {/* Pending-session banner — shown when the agent is working in the background */}
          <AnimatePresence>
            {isSessionPending && !streaming && (
              <motion.div
                key="pending-banner"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="px-4 py-2.5 border-b border-amber-500/20 bg-amber-500/8"
              >
                <div className="flex items-center gap-2.5">
                  <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin flex-shrink-0" />
                  <p className="text-xs text-amber-700 dark:text-amber-400 flex-1">
                    Agent is working in the background — checking for a response…
                  </p>
                  <button
                    onClick={() => setIsSessionPending(false)}
                    className="p-1 rounded-md hover:bg-amber-500/15 transition-colors flex-shrink-0"
                    title="Dismiss"
                  >
                    <X className="w-3 h-3 text-amber-500" />
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
                onStop={() => abortRef.current?.abort()}
              />
            )}
            {contextEvidence && (messages.length > 0 || task) && (
              <ContextUsedPanel evidence={contextEvidence} />
            )}
            {memoryProposals.length > 0 && entityContext && (
              <MemoryReviewPanel
                proposals={memoryProposals}
                onApprove={approveMemoryProposal}
                onUpdate={updateMemoryProposal}
              />
            )}
            {messages.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                {entityContext && IconComponent ? (
                  <>
                    <div className="w-10 h-10 mx-auto mb-3 rounded-xl bg-accent/10 flex items-center justify-center">
                      <IconComponent className="w-5 h-5 text-accent" />
                    </div>
                    <p className="text-sm font-medium text-foreground">Record context attached.</p>
                    <p className="text-sm mt-1">Ask about this record or get a briefing when you need full current context.</p>
                  </>
                ) : (
                  <>
                    <Bot className="w-10 h-10 mx-auto mb-3 opacity-40" />
                    <p className="text-sm">Ask about customer context, revenue objects, handoffs, or safe next actions.</p>
                  </>
                )}
              </div>
            )}
            {groupToolMessages(messages).map((item, i) => (
              <MessageBubble key={i} item={item} index={i} verbose={verbose} onRetry={retryLast} />
            ))}
            {streaming && !['assistant', 'tool_status'].includes(messages[messages.length - 1]?.kind ?? '') && (
              <TypingIndicator />
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Suggestions */}
          {messages.length === 0 && (
            <div className="px-4 space-y-3">
              <div className="flex gap-2 flex-wrap">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => setInput(s)}
                  className="px-3.5 py-2 rounded-xl text-xs bg-card border border-border text-muted-foreground hover:bg-primary/5 hover:text-primary hover:border-primary/30 transition-all press-scale"
                >
                  {s}
                </button>
              ))}
              </div>
              <div className="flex gap-2 flex-wrap">
                {workflowCommands.slice(0, entityContext ? 9 : 5).map((command) => (
                  <button
                    key={command.label}
                    onClick={() => setInput(command.prompt)}
                    className="px-3 py-1.5 rounded-lg text-xs bg-muted/60 border border-border text-foreground hover:bg-accent/10 hover:border-accent/30 transition-colors"
                  >
                    {command.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="p-4 pb-20 md:pb-4">
            <div className="flex gap-2 items-end bg-card border border-border rounded-2xl p-2 shadow-sm focus-within:border-primary/40 transition-colors">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), sendMessage())}
                placeholder="Ask your workspace agent…"
                rows={1}
                disabled={streaming}
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground resize-none outline-none px-2 py-1.5 disabled:opacity-50"
              />
              <button
                onClick={() => sendMessage()}
                disabled={!input.trim() || streaming}
                className="p-2.5 rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground hover:shadow-md disabled:opacity-40 transition-all press-scale"
              >
                {streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>

        {/* ── Session sidebar (desktop) ── */}
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
                  taskStatus={activeSessionId === session.id ? task?.status : undefined}
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
}: {
  provider?: string;
  model?: string;
  canWrite?: boolean;
  canHandoff?: boolean;
  autoExtract?: boolean;
}) {
  return (
    <div className="px-4 py-2 border-b border-border bg-card/60">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-muted-foreground">
          <ShieldCheck className="w-3 h-3 text-primary" />
          {provider && model ? `${provider} · ${model}` : 'Model boundary configured'}
        </span>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${
          canWrite ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-muted text-muted-foreground'
        }`}>
          {canWrite ? <ShieldAlert className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
          {canWrite ? 'Writes visible and scoped' : 'Writes disabled'}
        </span>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${
          canHandoff ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
        }`}>
          <GitPullRequestArrow className="w-3 h-3" />
          {canHandoff ? 'Handoffs enabled' : 'Handoffs read-only'}
        </span>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${
          autoExtract ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-muted text-muted-foreground'
        }`}>
          <Database className="w-3 h-3" />
          {autoExtract ? 'Memory review available' : 'Memory extraction off'}
        </span>
      </div>
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
  const statusTone =
    task.status === 'complete' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' :
    task.status === 'failed' ? 'bg-destructive/10 text-destructive' :
    task.status === 'waiting_approval' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' :
    'bg-primary/10 text-primary';
  const riskTone =
    task.risk === 'high' ? 'bg-destructive/10 text-destructive' :
    task.risk === 'medium' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' :
    'bg-muted text-muted-foreground';

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
          <ClipboardList className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">Agent task</p>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusTone}`}>
              {task.status === 'waiting_approval' ? 'waiting approval' : task.status}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${riskTone}`}>
              {task.risk} risk
            </span>
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
      </div>
      <div className="px-4 py-3 space-y-2">
        {task.steps.map(step => (
          <div key={step.id} className="flex items-center gap-2 text-sm">
            {step.status === 'complete' ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> :
              step.status === 'failed' ? <AlertTriangle className="w-4 h-4 text-destructive" /> :
              step.status === 'running' ? <Loader2 className="w-4 h-4 text-primary animate-spin" /> :
              <Circle className="w-4 h-4 text-muted-foreground/40" />}
            <span className={step.status === 'pending' ? 'text-muted-foreground' : 'text-foreground'}>{step.label}</span>
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
    </motion.div>
  );
}

function ContextUsedPanel({ evidence }: { evidence: NonNullable<ReturnType<typeof buildContextEvidence>> }) {
  const subject = evidence.subject;
  return (
    <div className="rounded-xl border border-border bg-card/80 px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <FileCheck2 className="w-4 h-4 text-primary" />
        <p className="text-sm font-semibold text-foreground">Context used</p>
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
      <div className="mt-2 flex flex-wrap gap-3 text-xs">
        <Link to="/context" className="text-primary hover:underline">Memory Browser</Link>
        {subject && (
          <Link to={`/audit-log?object_type=${normalizeSubjectType(subject.type)}&object_id=${encodeURIComponent(subject.id)}`} className="text-primary hover:underline">
            Audit history
          </Link>
        )}
        <Link to="/handoffs" className="text-primary hover:underline">Handoffs</Link>
      </div>
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
        <Bot className="w-4 h-4 text-primary" />
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
            {expanded ? 'Reasoning' : `Reasoned · ${lines} line${lines !== 1 ? 's' : ''}`}
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

function ExpandableStep({ step, verbose }: { step: ToolGroupStep; verbose: boolean }) {
  const [open, setOpen] = useState(false);
  const done = step.status.endsWith('✓');
  const err = step.status.startsWith('Error') || step.is_error;
  const hasDetail = verbose && (step.arguments !== undefined || step.result !== undefined);

  return (
    <div className="text-xs text-muted-foreground">
      <button
        onClick={() => hasDetail && setOpen(v => !v)}
        className={`flex items-center gap-1.5 w-full text-left py-0.5 ${hasDetail ? 'hover:text-foreground transition-colors cursor-pointer' : 'cursor-default'}`}
      >
        <code className="font-mono text-muted-foreground/60 bg-muted px-1 rounded shrink-0">{step.name}</code>
        <span className={err ? 'text-destructive' : done ? 'text-muted-foreground' : 'text-foreground/60'}>
          {step.status}
        </span>
        {hasDetail && (
          <span className="ml-auto opacity-60">
            {open ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
          </span>
        )}
      </button>
      {open && verbose && (
        <div className="mt-1 ml-2 space-y-2">
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

function ToolGroup({ group, verbose }: { group: ToolGroupItem; verbose: boolean }) {
  const allDone = group.steps.every(s => s.status.endsWith('✓') || s.status.startsWith('Error') || s.is_error);
  const hasError = group.steps.some(s => s.status.startsWith('Error') || s.is_error);
  const [expanded, setExpanded] = useState(hasError); // auto-expand on error

  // While running: show current active step name
  const activeStep = group.steps.find(s => !s.status.endsWith('✓') && !s.status.startsWith('Error'));
  const currentStatus = activeStep?.status ?? (hasError ? 'Error in tool call' : `${group.steps.length} step${group.steps.length !== 1 ? 's' : ''} complete`);

  const iconClass = hasError ? 'text-destructive' : allDone ? 'text-emerald-500' : 'text-primary animate-pulse';

  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="px-3 py-1">
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-2 w-full text-left text-xs text-muted-foreground hover:text-foreground transition-colors group"
      >
        <Wrench className={`w-3 h-3 shrink-0 ${iconClass}`} />
        <span className={hasError ? 'text-destructive' : allDone ? 'text-muted-foreground' : 'text-foreground/70'}>
          {allDone
            ? `✓ ${group.steps.length} step${group.steps.length !== 1 ? 's' : ''}`
            : currentStatus}
        </span>
        <span className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </span>
      </button>
      {expanded && (
        <div className="mt-1 ml-5 space-y-0.5 border-l border-border pl-3">
          {group.steps.map(step => (
            <ExpandableStep key={step.id} step={step} verbose={verbose} />
          ))}
        </div>
      )}
    </motion.div>
  );
}

// ── Message Bubble ──────────────────────────────────────────────────────────

function MessageBubble({ item, index, verbose, onRetry }: { item: RenderItem; index: number; verbose: boolean; onRetry?: () => void }) {
  if (item.kind === 'tool_group') {
    return <ToolGroup group={item} verbose={verbose} />;
  }

  const msg = item as DisplayMessage;

  if (msg.kind === 'thinking') {
    return verbose ? <ThinkingBubble content={msg.content} /> : null;
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
          <Bot className="w-4 h-4 text-primary" />
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
