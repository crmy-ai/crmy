// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useRef, useCallback } from 'react';
import { TopBar } from '@/components/layout/TopBar';
import { AgentStatusDot } from '@/components/crm/CrmWidgets';
import { useAppStore, type AIContextEntity } from '@/store/appStore';
import { useAgentSettings } from '@/contexts/AgentSettingsContext';
import {
  useAgentSessions,
  useCreateAgentSession,
  useDeleteAgentSession,
  useRenameAgentSession,
  type AgentSessionSummary,
} from '@/api/hooks';
import {
  Send, Bot, X, User, Briefcase, Building, Layers, Clock, Loader2, Wrench,
  ChevronDown, ChevronRight, Pencil, Trash2, Check, MessageSquare,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// ── Types ───────────────────────────────────────────────────────────────────

type DisplayMessage =
  | { kind: 'user'; content: string }
  | { kind: 'assistant'; content: string }
  | { kind: 'tool_status'; id: string; name: string; status: string }
  | { kind: 'tool_call'; id: string; name: string; arguments: Record<string, unknown> }
  | { kind: 'tool_result'; id: string; name: string; is_error: boolean; result?: unknown }
  | { kind: 'error'; message: string };

type SSEEvent =
  | { type: 'delta'; content: string }
  | { type: 'tool_status'; id: string; name: string; status: string }
  | { type: 'tool_call'; id: string; name: string; arguments: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; result: unknown; is_error: boolean }
  | { type: 'done'; session_id: string; label: string | null }
  | { type: 'error'; message: string };

const typeIcons: Record<string, typeof User> = {
  contact: User,
  opportunity: Briefcase,
  'use-case': Layers,
  account: Building,
};
const typeLabels: Record<string, string> = {
  contact: 'Contact',
  opportunity: 'Opportunity',
  'use-case': 'Use Case',
  account: 'Account',
};

// ── SSE Chat Helper ─────────────────────────────────────────────────────────

async function streamChat(
  sessionId: string,
  message: string,
  onEvent: (event: SSEEvent) => void,
  signal?: AbortSignal,
) {
  const token = localStorage.getItem('crmy_token');
  const res = await fetch(`/api/v1/agent/sessions/${sessionId}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ message }),
    signal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || body.detail || `HTTP ${res.status}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop()!;

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const event: SSEEvent = JSON.parse(line.slice(6));
        onEvent(event);
      } catch { /* skip malformed */ }
    }
  }
}

// ── Session item with rename/delete ─────────────────────────────────────────

function SessionItem({
  session,
  isActive,
  onSelect,
  onRenamed,
  onDeleted,
}: {
  session: AgentSessionSummary;
  isActive: boolean;
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
          <span className="text-[10px] text-muted-foreground/60 truncate block mt-0.5">
            {typeLabels[session.context_type ?? ''] ?? session.context_type} · {session.context_name}
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
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [entityContext, setEntityContext] = useState<AIContextEntity | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { aiContext } = useAppStore();
  const { enabled, loading: configLoading, connectivity } = useAgentSettings();
  const { data: sessionsData, refetch: refetchSessions } = useAgentSessions();
  const createSession = useCreateAgentSession();

  const sessions: AgentSessionSummary[] = sessionsData?.data ?? [];

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle entity context from AIFab
  useEffect(() => {
    if (aiContext) {
      setEntityContext(aiContext);
      setInput('');
      setMessages([{
        kind: 'assistant',
        content: `I'm ready to help with **${aiContext.name}**${aiContext.detail ? ` (${aiContext.detail})` : ''}. What would you like to do?`,
      }]);
      setActiveSessionId(null); // will create a new session on send
      useAppStore.setState({ aiContext: null });
    }
  }, [aiContext]);

  // Load existing session
  const loadSession = useCallback(async (session: AgentSessionSummary) => {
    setActiveSessionId(session.id);
    setEntityContext(session.context_type ? {
      type: session.context_type as AIContextEntity['type'],
      id: session.context_id ?? '',
      name: session.context_name ?? '',
    } : null);

    const token = localStorage.getItem('crmy_token');
    try {
      const res = await fetch(`/api/v1/agent/sessions/${session.id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const { data } = await res.json();
        const display: DisplayMessage[] = [];
        for (const msg of data.messages) {
          if (msg.role === 'system') continue;
          if (msg.role === 'user') display.push({ kind: 'user', content: msg.content });
          if (msg.role === 'assistant' && msg.content) display.push({ kind: 'assistant', content: msg.content });
        }
        setMessages(display);
      }
    } catch { /* ignore */ }
  }, []);

  const startNewChat = useCallback(() => {
    setActiveSessionId(null);
    setMessages([]);
    setEntityContext(null);
    setInput('');
  }, []);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');

    // Add user message immediately
    setMessages(prev => [...prev, { kind: 'user', content: text }]);

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
        });
        sessionId = session.data.id;
        setActiveSessionId(sessionId);
      }
      resolvedSessionId = sessionId;

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
              };
              if (existingIdx >= 0) {
                const updated = [...prev];
                updated[existingIdx] = newMsg;
                return updated;
              }
              return [...prev, newMsg];
            });
            break;

          case 'tool_call':
            // tool_call arrives right after tool_status — no UI action needed
            // (the status line already shows the user what's happening)
            break;

          case 'tool_result':
            // Update the matching tool_status to show completion
            setMessages(prev =>
              prev.map(m =>
                m.kind === 'tool_status' && m.id === event.id
                  ? { ...m, status: event.is_error ? `Error from ${m.name.replace(/_/g, ' ')}` : m.status.replace('…', ' ✓') }
                  : m
              )
            );
            break;

          case 'error':
            setMessages(prev => [...prev, { kind: 'error', message: event.message }]);
            break;

          case 'done':
            receivedDone = true;
            refetchSessions();
            break;
        }
      }, abort.signal);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
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
            const display: DisplayMessage[] = [];
            for (const msg of json.data.messages as { role: string; content: string }[]) {
              if (msg.role === 'system') continue;
              if (msg.role === 'user') display.push({ kind: 'user', content: msg.content });
              if (msg.role === 'assistant' && msg.content) display.push({ kind: 'assistant', content: msg.content });
            }
            if (display.length > 0) setMessages(display);
          })
          .catch(() => { /* ignore */ });
      }
    }
  }, [input, streaming, activeSessionId, entityContext, createSession, refetchSessions]);

  const suggestions = entityContext
    ? [`Summarize ${typeLabels[entityContext.type]?.toLowerCase() ?? 'record'}`, 'Recent activities', 'Draft follow-up']
    : ['Summarize pipeline', 'Deals needing attention', 'List my open activities'];

  const IconComponent = entityContext ? typeIcons[entityContext.type] : null;

  const connectivityLabel =
    connectivity === 'online'  ? 'Workspace Agent online' :
    connectivity === 'offline' ? 'Agent offline' :
    'Workspace Agent';

  // ── Loading state — wait for config before deciding enabled/disabled ──
  if (configLoading) {
    return (
      <div className="flex flex-col h-full">
        <TopBar title="Workspace Agent" icon={Bot} iconClassName="text-primary" description="AI-powered assistant with access to your full CRM context." />
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
        <TopBar title="Workspace Agent" icon={Bot} iconClassName="text-primary" description="AI-powered assistant with access to your full CRM context." />
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-md space-y-3">
            <Bot className="w-12 h-12 mx-auto text-muted-foreground/40" />
            <h2 className="text-lg font-display font-bold text-foreground">Workspace Agent is not enabled</h2>
            <p className="text-sm text-muted-foreground">
              An administrator needs to enable the agent and configure an LLM provider in{' '}
              <span className="text-foreground font-medium">Settings → Local Workspace Agent</span>.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Workspace Agent" icon={Bot} iconClassName="text-primary" description="AI-powered assistant with access to your full CRM context." />
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
                <span className="flex items-center gap-1 text-[10px] text-primary ml-2">
                  <Loader2 className="w-3 h-3 animate-spin" /> Thinking…
                </span>
              )}
              <div className="ml-auto flex items-center gap-2">
                {streaming && (
                  <button
                    onClick={() => abortRef.current?.abort()}
                    className="text-[10px] text-destructive bg-destructive/10 px-2 py-0.5 rounded-full hover:bg-destructive/20 transition-colors"
                  >
                    Stop
                  </button>
                )}
                <button
                  onClick={startNewChat}
                  className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full hover:bg-muted/80 transition-colors"
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

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 pb-24 md:pb-4">
            {messages.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Bot className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm">Ask your workspace agent anything about your CRM.</p>
              </div>
            )}
            {messages.map((msg, i) => (
              <MessageBubble key={i} msg={msg} index={i} />
            ))}
            {streaming && messages[messages.length - 1]?.kind !== 'assistant' && messages[messages.length - 1]?.kind !== 'tool_status' && (
              <TypingIndicator />
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Suggestions */}
          {messages.length === 0 && (
            <div className="px-4 flex gap-2 flex-wrap">
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
                onClick={sendMessage}
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
              className="text-[10px] text-primary hover:underline"
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

// ── Tool Status Row ──────────────────────────────────────────────────────────

function ToolStatusRow({ msg }: { msg: DisplayMessage & { kind: 'tool_status' } }) {
  const [expanded, setExpanded] = useState(false);
  const isDone = msg.status.endsWith('✓');
  const isError = msg.status.startsWith('Error');

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-start gap-2 px-3 py-1.5 text-xs text-muted-foreground group"
    >
      <Wrench className={`w-3 h-3 mt-0.5 flex-shrink-0 ${isError ? 'text-destructive' : isDone ? 'text-success' : 'text-primary animate-pulse'}`} />
      <span className={isError ? 'text-destructive' : isDone ? 'text-muted-foreground' : 'text-foreground/70'}>
        {msg.status}
      </span>
      <button
        onClick={() => setExpanded(v => !v)}
        className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 text-[10px] text-muted-foreground/60 hover:text-muted-foreground"
      >
        <code className="font-mono bg-muted px-1 rounded">{msg.name}</code>
        {expanded ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
      </button>
    </motion.div>
  );
}

// ── Message Bubble ──────────────────────────────────────────────────────────

function MessageBubble({ msg, index }: { msg: DisplayMessage; index: number }) {
  if (msg.kind === 'tool_status') {
    return <ToolStatusRow msg={msg} />;
  }

  if (msg.kind === 'tool_call') {
    // tool_call is now handled via tool_status — skip rendering to avoid duplicates
    return null;
  }

  if (msg.kind === 'tool_result') {
    // Results are surfaced through the tool_status update — skip rendering
    return null;
  }

  if (msg.kind === 'error') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="px-4 py-2 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm"
      >
        {msg.message}
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
        className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap
          ${isUser
            ? 'bg-gradient-to-br from-primary to-primary/80 text-primary-foreground rounded-br-md'
            : 'bg-card border border-border text-foreground rounded-bl-md shadow-sm'
          }`}
      >
        {msg.content}
      </div>
    </motion.div>
  );
}
