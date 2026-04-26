// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * GlobalAgentPanel — a persistent slide-over chat panel mounted at the root
 * of the app (never unmounted). Because it stays mounted across navigation,
 * the SSE stream keeps running while the user browses other pages.
 *
 * The panel is hidden (translated off-screen) when closed rather than
 * unmounted, so in-flight agent turns complete in the background and all
 * messages are present when the user reopens it.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  Bot, Send, X, Loader2, Maximize2, Wrench,
  User, Briefcase, Building, Layers,
  ChevronDown, ChevronRight, Sparkles,
} from 'lucide-react';
import { useAppStore, type AIContextEntity } from '@/store/appStore';
import { useAgentSettings } from '@/contexts/AgentSettingsContext';
import { useCreateAgentSession } from '@/api/hooks';
import {
  streamChat, groupToolMessages, getSuggestions, SYSTEM_INIT_PREFIX,
  type DisplayMessage, type RenderItem, type ToolGroupItem,
} from '@/lib/agentStream';

// ── Icon maps ─────────────────────────────────────────────────────────────────

const typeIcons: Record<string, typeof User> = {
  contact: User, opportunity: Briefcase, 'use-case': Layers, account: Building,
};
const typeLabels: Record<string, string> = {
  contact: 'Contact', opportunity: 'Opportunity', 'use-case': 'Use Case', account: 'Account',
};

// ── ToolGroup (collapsible steps) ─────────────────────────────────────────────

function ToolGroup({ group }: { group: ToolGroupItem }) {
  const allDone = group.steps.every(s => s.status.endsWith('✓') || s.status.startsWith('Error'));
  const hasError = group.steps.some(s => s.status.startsWith('Error'));
  const [expanded, setExpanded] = useState(hasError);
  const activeStep = group.steps.find(s => !s.status.endsWith('✓') && !s.status.startsWith('Error'));
  const iconClass = hasError ? 'text-destructive' : allDone ? 'text-emerald-500' : 'text-primary animate-pulse';

  return (
    <div className="px-2 py-0.5">
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-2 w-full text-left text-xs text-muted-foreground hover:text-foreground transition-colors group"
      >
        <Wrench className={`w-3 h-3 shrink-0 ${iconClass}`} />
        <span className={hasError ? 'text-destructive' : allDone ? 'text-muted-foreground' : 'text-foreground/70'}>
          {allDone ? `✓ ${group.steps.length} step${group.steps.length !== 1 ? 's' : ''}` : (activeStep?.status ?? 'Working…')}
        </span>
        <span className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </span>
      </button>
      {expanded && (
        <div className="mt-1 ml-5 space-y-0.5 border-l border-border pl-3">
          {group.steps.map(step => {
            const done = step.status.endsWith('✓');
            const err = step.status.startsWith('Error');
            return (
              <div key={step.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <code className="font-mono text-muted-foreground/60 bg-muted px-1 rounded shrink-0">{step.name}</code>
                <span className={err ? 'text-destructive' : done ? 'text-muted-foreground' : 'text-foreground/60'}>{step.status}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────

function Bubble({ item, index }: { item: RenderItem; index: number }) {
  if (item.kind === 'tool_group') return <ToolGroup group={item} />;
  const msg = item as DisplayMessage;
  if (msg.kind === 'tool_status' || msg.kind === 'tool_call' || msg.kind === 'tool_result') return null;

  if (msg.kind === 'error') {
    return (
      <div className="mx-3 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs">
        {msg.message}
      </div>
    );
  }

  const isUser = msg.kind === 'user';
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.02, 0.2) }}
      className={`flex px-3 ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      {!isUser && (
        <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center mr-2 shrink-0 mt-1">
          <Bot className="w-3.5 h-3.5 text-primary" />
        </div>
      )}
      <div className={`max-w-[82%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap
        ${isUser
          ? 'bg-gradient-to-br from-primary to-primary/80 text-primary-foreground rounded-br-sm'
          : 'bg-card border border-border text-foreground rounded-bl-sm shadow-sm'
        }`}
      >
        {msg.content}
      </div>
    </motion.div>
  );
}

function TypingDots() {
  return (
    <div className="flex px-3">
      <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center mr-2 shrink-0">
        <Bot className="w-3.5 h-3.5 text-primary" />
      </div>
      <div className="bg-card border border-border rounded-2xl rounded-bl-sm px-3 py-2.5 flex items-center gap-1">
        {[0, 150, 300].map(delay => (
          <span key={delay} className="w-1.5 h-1.5 rounded-full bg-primary/50 animate-bounce" style={{ animationDelay: `${delay}ms` }} />
        ))}
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function GlobalAgentPanel() {
  const { agentPanelOpen, closeAgentPanel, aiContext } = useAppStore();
  const { enabled } = useAgentSettings();
  const createSession = useCreateAgentSession();
  const navigate = useNavigate();

  // ── Chat state (never reset on close — persists across navigation) ──────────
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [entityContext, setEntityContext] = useState<AIContextEntity | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    if (agentPanelOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, agentPanelOpen]);

  // Focus input when panel opens
  useEffect(() => {
    if (agentPanelOpen) {
      setUnreadCount(0);
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [agentPanelOpen]);

  // ── SSE event handler (shared between autoGreet and sendMessage) ────────────
  const handleSSEEvent = useCallback((event: Parameters<typeof streamChat>[2] extends (e: infer E) => void ? E : never) => {
    switch (event.type) {
      case 'delta': {
        const content = event.content;
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.kind === 'assistant') return [...prev.slice(0, -1), { kind: 'assistant', content: (last.content) + content }];
          return [...prev, { kind: 'assistant', content }];
        });
        if (!agentPanelOpen) setUnreadCount(c => c + 1);
        break;
      }
      case 'tool_status':
        setMessages(prev => {
          const idx = prev.findIndex(m => m.kind === 'tool_status' && m.id === event.id);
          const msg: DisplayMessage = { kind: 'tool_status', id: event.id, name: event.name, status: event.status, turn_id: event.turn_id };
          if (idx >= 0) { const u = [...prev]; u[idx] = msg; return u; }
          return [...prev, msg];
        });
        break;
      case 'tool_result':
        setMessages(prev => prev.map(m =>
          m.kind === 'tool_status' && m.id === event.id
            ? { ...m, status: event.is_error ? `Error from ${m.name.replace(/_/g, ' ')}` : m.status.replace('…', ' ✓') }
            : m
        ));
        break;
    }
  }, [agentPanelOpen]);

  // ── Auto-greet when entity context is injected ─────────────────────────────
  const autoGreet = useCallback(async (ctx: AIContextEntity) => {
    const abort = new AbortController();
    abortRef.current = abort;
    setStreaming(true);
    setMessages([]);

    try {
      const session = await createSession.mutateAsync({
        context_type: ctx.type,
        context_id: ctx.id,
        context_name: ctx.name,
      });
      const sessionId = session.data.id;
      setActiveSessionId(sessionId);

      await streamChat(sessionId, SYSTEM_INIT_PREFIX, handleSSEEvent, abort.signal, { auto_greet: true });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages([{ kind: 'error', message: (err as Error).message }]);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [createSession, handleSSEEvent]);

  // Handle context injection from record pages
  useEffect(() => {
    if (aiContext) {
      setEntityContext(aiContext);
      setInput('');
      setActiveSessionId(null);
      useAppStore.setState({ aiContext: null });
      autoGreet(aiContext);
    }
  }, [aiContext, autoGreet]);

  // ── Send message ────────────────────────────────────────────────────────────
  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    setMessages(prev => [...prev, { kind: 'user', content: text }]);
    setStreaming(true);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
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

      await streamChat(sessionId, text, handleSSEEvent, abort.signal);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages(prev => [...prev, { kind: 'error', message: (err as Error).message }]);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [input, streaming, activeSessionId, entityContext, createSession, handleSSEEvent]);

  const startNewChat = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setActiveSessionId(null);
    setEntityContext(null);
    setInput('');
    setStreaming(false);
  }, []);

  // Escape closes panel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && agentPanelOpen) {
        closeAgentPanel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [agentPanelOpen, closeAgentPanel]);

  const IconComponent = entityContext ? typeIcons[entityContext.type] : null;
  const suggestions = getSuggestions(entityContext?.type ?? null, entityContext?.name ?? null);
  const renderItems = groupToolMessages(messages);
  const lastKind = messages[messages.length - 1]?.kind;
  const showTyping = streaming && lastKind !== 'assistant' && lastKind !== 'tool_status';

  // Panel is always in the DOM — just transformed off-screen when closed.
  // This keeps component state (messages, streaming) alive across navigation.
  return (
    <>
      {/* Backdrop — only rendered/interactive when open */}
      <AnimatePresence>
        {agentPanelOpen && (
          <motion.div
            key="agent-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[65] bg-foreground/10 backdrop-blur-[2px]"
            onClick={closeAgentPanel}
          />
        )}
      </AnimatePresence>

      {/* Panel — always mounted, translated off-screen when closed */}
      <motion.div
        initial={false}
        animate={{ x: agentPanelOpen ? 0 : '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="fixed top-0 right-0 h-full w-full sm:w-[420px] z-[70] flex flex-col bg-background border-l border-border shadow-2xl"
      >
        {/* ── Header ── */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border bg-gradient-to-r from-primary/5 to-accent/5 shrink-0">
          <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
            <Bot className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-display font-bold text-foreground leading-tight">Workspace Agent</p>
            {streaming && (
              <p className="text-xs text-primary flex items-center gap-1">
                <Loader2 className="w-2.5 h-2.5 animate-spin" /> Working…
              </p>
            )}
          </div>

          <div className="flex items-center gap-1">
            {streaming && (
              <button
                onClick={() => abortRef.current?.abort()}
                className="text-xs text-destructive bg-destructive/10 px-2 py-0.5 rounded-full hover:bg-destructive/20 transition-colors"
              >
                Stop
              </button>
            )}
            <button
              onClick={startNewChat}
              className="text-xs text-muted-foreground px-2 py-1 rounded-lg hover:bg-muted transition-colors"
            >
              New
            </button>
            <button
              onClick={() => navigate('/agent')}
              title="Open full screen"
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={closeAgentPanel}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* ── Context banner ── */}
        <AnimatePresence>
          {entityContext && IconComponent && (
            <motion.div
              key="ctx-banner"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden shrink-0"
            >
              <div className="flex items-center gap-2.5 px-4 py-2 border-b border-border bg-accent/5">
                <div className="w-6 h-6 rounded-md bg-accent/15 flex items-center justify-center shrink-0">
                  <IconComponent className="w-3 h-3 text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">{typeLabels[entityContext.type]}</p>
                  <p className="text-xs font-semibold text-foreground truncate">
                    {entityContext.name}
                    {entityContext.detail && <span className="font-normal text-muted-foreground ml-1">· {entityContext.detail}</span>}
                  </p>
                </div>
                <button onClick={() => setEntityContext(null)} className="p-1 rounded hover:bg-muted transition-colors">
                  <X className="w-3 h-3 text-muted-foreground" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Messages ── */}
        {!enabled ? (
          <div className="flex-1 flex items-center justify-center p-6 text-center">
            <div className="space-y-2">
              <Bot className="w-8 h-8 mx-auto text-muted-foreground/30" />
              <p className="text-sm font-medium text-foreground">Agent not enabled</p>
              <p className="text-xs text-muted-foreground">Configure a provider in Settings → Local Workspace Agent.</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto py-4 space-y-2">
            {messages.length === 0 && !streaming && (
              <div className="flex flex-col items-center justify-center h-full gap-2 px-4 text-center">
                <Sparkles className="w-8 h-8 text-primary/30" />
                <p className="text-sm text-muted-foreground">Ask your workspace agent anything.</p>
              </div>
            )}

            {renderItems.map((item, i) => <Bubble key={i} item={item} index={i} />)}
            {showTyping && <TypingDots />}
            <div ref={messagesEndRef} />
          </div>
        )}

        {/* ── Suggestion chips ── */}
        {enabled && messages.length === 0 && !streaming && (
          <div className="px-3 pb-2 flex flex-wrap gap-1.5 shrink-0">
            {suggestions.map(s => (
              <button
                key={s}
                onClick={() => setInput(s)}
                className="px-2.5 py-1.5 rounded-xl text-xs bg-card border border-border text-muted-foreground hover:bg-primary/5 hover:text-primary hover:border-primary/30 transition-all"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* ── Input ── */}
        {enabled && (
          <div className="px-3 pb-4 pt-1 shrink-0">
            <div className="flex gap-2 items-end bg-card border border-border rounded-2xl p-2 shadow-sm focus-within:border-primary/40 transition-colors">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), sendMessage())}
                placeholder="Ask your workspace agent…"
                rows={1}
                disabled={streaming}
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground resize-none outline-none px-2 py-1.5 disabled:opacity-50 max-h-32"
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || streaming}
                className="p-2 rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground hover:shadow-md disabled:opacity-40 transition-all shrink-0"
              >
                {streaming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </>
  );
}
