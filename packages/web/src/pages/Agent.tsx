// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useRef, useCallback } from 'react';
import { TopBar } from '@/components/layout/TopBar';
import { AgentStatusDot } from '@/components/crm/CrmWidgets';
import { useAppStore, type AIContextEntity } from '@/store/appStore';
import { useAgentSettings } from '@/contexts/AgentSettingsContext';
import { useAgentSessions, useCreateAgentSession, type AgentSessionSummary } from '@/api/hooks';
import { Send, Bot, X, User, Briefcase, Building, Layers, Clock, Loader2, Wrench } from 'lucide-react';
import { motion } from 'framer-motion';

// ── Types ───────────────────────────────────────────────────────────────────

type DisplayMessage =
  | { kind: 'user'; content: string }
  | { kind: 'assistant'; content: string }
  | { kind: 'tool_call'; id: string; name: string; arguments: Record<string, unknown> }
  | { kind: 'tool_result'; id: string; name: string; is_error: boolean }
  | { kind: 'error'; message: string };

type SSEEvent =
  | { type: 'delta'; content: string }
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
  const { enabled } = useAgentSettings();
  const { data: sessionsData, refetch: refetchSessions } = useAgentSessions();
  const createSession = useCreateAgentSession();

  const sessions = sessionsData?.data ?? [];

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle entity context from AIFab
  useEffect(() => {
    if (aiContext) {
      setEntityContext(aiContext);
      setInput(`Update ${aiContext.name}: `);
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

    // Fetch full session with messages
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
          if (msg.role === 'assistant') display.push({ kind: 'assistant', content: msg.content });
        }
        setMessages(display);
      }
    } catch { /* ignore */ }
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

      // Streaming accumulator for assistant text
      let assistantText = '';
      let addedAssistantMsg = false;

      await streamChat(sessionId, text, (event) => {
        switch (event.type) {
          case 'delta':
            assistantText += event.content;
            setMessages(prev => {
              if (!addedAssistantMsg) {
                addedAssistantMsg = true;
                return [...prev, { kind: 'assistant', content: assistantText }];
              }
              // Update last assistant message
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last?.kind === 'assistant') {
                updated[updated.length - 1] = { ...last, content: assistantText };
              }
              return updated;
            });
            break;

          case 'tool_call':
            // Reset assistant text for the next response after tool calls
            assistantText = '';
            addedAssistantMsg = false;
            setMessages(prev => [...prev, {
              kind: 'tool_call',
              id: event.id,
              name: event.name,
              arguments: event.arguments,
            }]);
            break;

          case 'tool_result':
            setMessages(prev => [...prev, {
              kind: 'tool_result',
              id: event.id,
              name: event.name,
              is_error: event.is_error,
            }]);
            break;

          case 'error':
            setMessages(prev => [...prev, { kind: 'error', message: event.message }]);
            break;

          case 'done':
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
    }
  }, [input, streaming, activeSessionId, entityContext, createSession, refetchSessions]);

  const suggestions = entityContext
    ? [`Update ${typeLabels[entityContext.type]?.toLowerCase() ?? 'record'} details`, 'Summarize activity', 'Draft follow-up']
    : ['Summarize pipeline', 'Deals needing attention', 'List my open activities'];

  const IconComponent = entityContext ? typeIcons[entityContext.type] : null;

  // ── Not enabled state ──
  if (!enabled) {
    return (
      <div className="flex flex-col h-full">
        <TopBar title="AI Agent" />
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-md space-y-3">
            <Bot className="w-12 h-12 mx-auto text-muted-foreground/40" />
            <h2 className="text-lg font-display font-bold text-foreground">AI Agent is not enabled</h2>
            <p className="text-sm text-muted-foreground">
              An administrator needs to enable the AI agent and configure an LLM provider in Settings &rarr; AI Agent.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <TopBar title="AI Agent" />
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Chat */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Agent header */}
          <div className="px-4 py-3 border-b border-border bg-gradient-to-r from-primary/5 to-accent/5">
            <div className="flex items-center gap-2">
              <AgentStatusDot />
              <span className="text-sm font-display font-bold text-foreground">AI Agent active</span>
              {streaming && (
                <span className="flex items-center gap-1 text-[10px] text-primary ml-2">
                  <Loader2 className="w-3 h-3 animate-spin" /> Thinking...
                </span>
              )}
              <button
                onClick={() => { setActiveSessionId(null); setMessages([]); setEntityContext(null); setInput(''); }}
                className="text-[10px] text-muted-foreground ml-auto bg-muted px-2 py-0.5 rounded-full hover:bg-muted/80 transition-colors"
              >
                New chat
              </button>
            </div>
          </div>

          {/* Context banner */}
          {entityContext && IconComponent && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
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

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 pb-24 md:pb-4">
            {messages.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Bot className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm">Start a conversation with your CRM agent.</p>
              </div>
            )}
            {messages.map((msg, i) => (
              <MessageBubble key={i} msg={msg} index={i} />
            ))}
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
          <div className="p-4">
            <div className="flex gap-2 items-end bg-card border border-border rounded-2xl p-2 shadow-sm">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), sendMessage())}
                placeholder="Ask your AI agent..."
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

        {/* Sidebar — sessions (desktop only) */}
        <div className="hidden lg:flex flex-col w-80 border-l border-border bg-surface">
          <div className="p-5 flex-1 overflow-y-auto">
            <h3 className="font-display font-bold text-foreground text-sm mb-3">Recent sessions</h3>
            {sessions.length === 0 && (
              <p className="text-xs text-muted-foreground">No conversations yet.</p>
            )}
            <div className="space-y-1.5">
              {sessions.map((session: AgentSessionSummary) => (
                <button
                  key={session.id}
                  onClick={() => loadSession(session)}
                  className={`w-full flex items-start gap-2.5 px-3 py-2.5 rounded-xl text-left hover:bg-muted/50 transition-colors group ${activeSessionId === session.id ? 'bg-muted/50' : ''}`}
                >
                  <Clock className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors line-clamp-2">
                    {session.label || 'Untitled conversation'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Message Bubble ──────────────────────────────────────────────────────────

function MessageBubble({ msg, index }: { msg: DisplayMessage; index: number }) {
  if (msg.kind === 'tool_call') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground"
      >
        <Wrench className="w-3 h-3" />
        <span>Calling <code className="font-mono bg-muted px-1 rounded">{msg.name}</code></span>
      </motion.div>
    );
  }

  if (msg.kind === 'tool_result') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className={`flex items-center gap-2 px-3 py-1.5 text-xs ${msg.is_error ? 'text-destructive' : 'text-muted-foreground'}`}
      >
        <Wrench className="w-3 h-3" />
        <span>{msg.is_error ? 'Error from' : 'Result from'} <code className="font-mono bg-muted px-1 rounded">{msg.name}</code></span>
      </motion.div>
    );
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
