import { useState, useEffect } from 'react';
import { TopBar } from '@/components/layout/TopBar';
import { AgentStatusDot } from '@/components/crm/CrmWidgets';
import { useAppStore, type AIContextEntity } from '@/store/appStore';
import { Send, Sparkles, CheckCircle, Bot, X, User, Briefcase, Building, Layers, Clock } from 'lucide-react';
import { motion } from 'framer-motion';

type Message = { role: 'agent' | 'user'; content: string };

const defaultMessages: Message[] = [
  { role: 'agent', content: "Good morning! I've reviewed your pipeline overnight. Here's what needs attention:\n\n1. **Sarah Chen's deal** — appraisal should arrive today. I'll draft a follow-up email once it's in.\n2. **Hannah Williams** — her Brooklyn viewings are stale (16 days). I suggest scheduling new showings.\n3. **Sacramento listing** for Maria Santos has been in lead stage for 22 days. Consider a nurture sequence.\n\nWant me to take action on any of these?" },
];

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

interface Session {
  id: string;
  label: string;
  messages: Message[];
  context: AIContextEntity | null;
}

const mockSessions: Session[] = [
  { id: '1', label: 'Follow-up for Sarah Chen', messages: [
    { role: 'agent', content: "I drafted a follow-up email for **Sarah Chen** regarding the appraisal results. Ready for your review." },
    { role: 'user', content: "Looks good, send it." },
    { role: 'agent', content: "✅ Email sent to Sarah Chen." },
  ], context: { type: 'opportunity', id: 'd1', name: "Sarah Chen's Opportunity", detail: '$850K' } },
  { id: '2', label: 'Nurture sequence for Maria Santos', messages: [
    { role: 'agent', content: "I created a 4-email nurture sequence for **Maria Santos**. Starting with a home value assessment offer." },
    { role: 'user', content: "Add a market trends email as step 2." },
    { role: 'agent', content: "✅ Updated. The sequence now includes market trends as step 2." },
  ], context: { type: 'contact', id: 'c3', name: 'Maria Santos', detail: 'Sacramento' } },
  { id: '3', label: 'Pipeline review — Q1', messages: [
    { role: 'agent', content: "Here's your Q1 pipeline summary:\n\n• **Weighted pipeline**: $1.2M\n• **Best case**: $2.1M\n• **3 deals** stale >14 days\n\nWant me to flag the stale deals?" },
  ], context: null },
];

export default function Agent() {
  const [messages, setMessages] = useState<Message[]>(defaultMessages);
  const [input, setInput] = useState('');
  const [entityContext, setEntityContext] = useState<AIContextEntity | null>(null);
  const { aiContext } = useAppStore();

  useEffect(() => {
    if (aiContext) {
      setEntityContext(aiContext);
      setInput(`Update ${aiContext.name}: `);
      setMessages([{
        role: 'agent',
        content: `I'm ready to help with **${aiContext.name}**${aiContext.detail ? ` (${aiContext.detail})` : ''}. What would you like to update?`
      }]);
      useAppStore.setState({ aiContext: null });
    }
  }, [aiContext]);

  const sendMessage = () => {
    if (!input.trim()) return;
    setMessages([...messages, { role: 'user', content: input }]);
    setInput('');
    setTimeout(() => {
      setMessages((prev) => [...prev, {
        role: 'agent',
        content: "I'm processing your request. In a real implementation, this would connect to an AI model to take actions on your CRM data. 🚀"
      }]);
    }, 1000);
  };

  const suggestions = entityContext
    ? [`Update ${typeLabels[entityContext.type].toLowerCase()} details`, `Summarize activity`, `Draft follow-up`]
    : ['Summarize pipeline', 'Draft follow-up for Sarah', 'Deals needing attention'];

  const IconComponent = entityContext ? typeIcons[entityContext.type] : null;

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
              <span className="text-[10px] text-muted-foreground ml-auto bg-muted px-2 py-0.5 rounded-full">Synced 2m ago</span>
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
                <button
                  onClick={() => setEntityContext(null)}
                  className="p-1 rounded-md hover:bg-muted transition-colors"
                >
                  <X className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>
            </motion.div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-24 md:pb-4">
            {messages.map((msg, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'agent' && (
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center mr-2 flex-shrink-0 mt-1">
                    <Bot className="w-4 h-4 text-primary" />
                  </div>
                )}
                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap
                    ${msg.role === 'user'
                      ? 'bg-gradient-to-br from-primary to-primary/80 text-primary-foreground rounded-br-md'
                      : 'bg-card border border-border text-foreground rounded-bl-md shadow-sm'
                    }`}
                >
                  {msg.content}
                </div>
              </motion.div>
            ))}
          </div>

          {/* Suggestions */}
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

          {/* Input */}
          <div className="p-4">
            <div className="flex gap-2 items-end bg-card border border-border rounded-2xl p-2 shadow-sm">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), sendMessage())}
                placeholder="Ask your AI agent..."
                rows={1}
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground resize-none outline-none px-2 py-1.5"
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim()}
                className="p-2.5 rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground hover:shadow-md disabled:opacity-40 transition-all press-scale"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Context panel (desktop only) */}
        <div className="hidden lg:flex flex-col w-80 border-l border-border bg-surface">
          <div className="p-5 border-b border-border">
            <h3 className="font-display font-bold text-foreground text-sm mb-3">Connected tools</h3>
            <div className="space-y-2.5">
              {[
                { name: 'Google Calendar', status: true },
                { name: 'Email (Gmail)', status: true },
                { name: 'MCP Server', status: true },
              ].map((tool) => (
                <div key={tool.name} className="flex items-center justify-between text-sm">
                  <span className="text-foreground">{tool.name}</span>
                  {tool.status
                    ? <CheckCircle className="w-4 h-4 text-success" />
                    : <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">Not connected</span>
                  }
                </div>
              ))}
            </div>
          </div>

          <div className="p-5 flex-1 overflow-y-auto">
            <h3 className="font-display font-bold text-foreground text-sm mb-3">Recent sessions</h3>
            <div className="space-y-1.5">
              {mockSessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => {
                    setMessages(session.messages);
                    setEntityContext(session.context);
                    setInput('');
                  }}
                  className="w-full flex items-start gap-2.5 px-3 py-2.5 rounded-xl text-left hover:bg-muted/50 transition-colors group"
                >
                  <Clock className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors line-clamp-2">{session.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
