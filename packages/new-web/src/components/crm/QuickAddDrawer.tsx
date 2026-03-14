import { useState, useRef, useEffect, useCallback } from 'react';
import { useAppStore } from '@/store/appStore';
import { X, Send, Mic, MicOff, Sparkles, FileText, Check, Pencil } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import ReactMarkdown from 'react-markdown';

type Message = { role: 'user' | 'assistant'; content: string };

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-record`;

const typeLabels: Record<string, string> = {
  contact: 'Contact',
  deal: 'Deal',
  'use-case': 'Use Case',
  activity: 'Activity',
  account: 'Account',
};

const typeGreetings: Record<string, string> = {
  contact: "Hi! Tell me about the new contact — a name is all I need to start. You can speak or type.",
  deal: "Let's create a new deal! What's the property or deal name? You can tell me as much or as little as you'd like.",
  'use-case': "Let's set up a new use case. What's the scenario you're tracking? Give me a name and any details — client, property type, timeline.",
  activity: "Let's log an activity. What did you do — call, email, meeting, showing? Tell me the contact and any notes.",
  account: "Let's add a new account. What's the company name? You can include industry, website, revenue, or any other details.",
};

export function QuickAddDrawer() {
  const { quickAddType, closeQuickAdd } = useAppStore();

  if (!quickAddType) return null;

  return (
    <>
      <div className="fixed inset-0 bg-background/60 backdrop-blur-sm z-[80]" onClick={closeQuickAdd} />
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-card border-l border-border z-[90] shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        <ChatAddPanel type={quickAddType} onClose={closeQuickAdd} />
      </div>
    </>
  );
}

function ChatAddPanel({ type, onClose }: { type: string; onClose: () => void }) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: typeGreetings[type] || typeGreetings.contact },
  ]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [previewData, setPreviewData] = useState<Record<string, any> | null>(null);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Parse preview data from assistant messages
  useEffect(() => {
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
    if (!lastAssistant) return;

    if (lastAssistant.content.includes('---CONFIRMED---')) {
      setIsConfirmed(true);
      toast({ title: `${typeLabels[type]} created!`, description: `Successfully added to your CRM.` });
      setTimeout(onClose, 1200);
      return;
    }

    const previewMatch = lastAssistant.content.match(/---PREVIEW---\s*([\s\S]*?)\s*---END_PREVIEW---/);
    if (previewMatch) {
      try {
        setPreviewData(JSON.parse(previewMatch[1]));
      } catch { /* ignore parse errors */ }
    }
  }, [messages, type, onClose]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming) return;

    const userMsg: Message = { role: 'user', content: text.trim() };
    const allMessages = [...messages, userMsg];
    setMessages(allMessages);
    setInput('');
    setIsStreaming(true);

    let assistantContent = '';

    try {
      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: allMessages.map(m => ({ role: m.role, content: m.content })),
          recordType: type,
        }),
      });

      if (!resp.ok || !resp.body) {
        const errorData = await resp.json().catch(() => ({}));
        throw new Error(errorData.error || `Request failed (${resp.status})`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
          let line = buffer.slice(0, newlineIdx);
          buffer = buffer.slice(newlineIdx + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') break;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              assistantContent += content;
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === 'assistant' && prev.length > allMessages.length) {
                  return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantContent } : m);
                }
                return [...prev, { role: 'assistant', content: assistantContent }];
              });
            }
          } catch {
            buffer = line + '\n' + buffer;
            break;
          }
        }
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Something went wrong';
      toast({ title: 'AI Error', description: errorMsg, variant: 'destructive' });
      setMessages(prev => [...prev, { role: 'assistant', content: `Sorry, I ran into an issue: ${errorMsg}. You can try again or use the form instead.` }]);
    } finally {
      setIsStreaming(false);
    }
  }, [messages, isStreaming, type]);

  // Voice input using Web Speech API
  const toggleVoice = useCallback(() => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast({ title: 'Voice not supported', description: 'Your browser doesn\'t support speech recognition.', variant: 'destructive' });
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setInput(transcript);

      // Auto-send on final result
      if (event.results[event.results.length - 1].isFinal) {
        setTimeout(() => {
          sendMessage(transcript);
          setIsListening(false);
        }, 300);
      }
    };

    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [isListening, sendMessage]);

  // Clean content for rendering (strip preview markers)
  const cleanContent = (content: string) => {
    return content
      .replace(/---PREVIEW---[\s\S]*?---END_PREVIEW---/g, '')
      .replace(/---CONFIRMED---/g, '')
      .trim();
  };

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center">
            <Sparkles className="w-3.5 h-3.5 text-accent" />
          </div>
          <h2 className="font-display font-bold text-foreground">New {typeLabels[type]}</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground rounded transition-colors"
            title="Switch to manual form"
          >
            <FileText className="w-3 h-3" />
            <span className="hidden sm:inline">Form</span>
          </button>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded-md transition-colors">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
      </div>

      {showForm ? (
        <ManualForm type={type} onClose={onClose} onBack={() => setShowForm(false)} />
      ) : (
        <>
          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((msg, i) => {
              const cleaned = cleanContent(msg.content);
              if (!cleaned && msg.role === 'assistant') return null;

              return (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-foreground'
                  }`}>
                    {msg.role === 'assistant' ? (
                      <div className="prose prose-sm prose-invert max-w-none [&>p]:my-1 [&>ul]:my-1">
                        <ReactMarkdown>{cleaned}</ReactMarkdown>
                      </div>
                    ) : (
                      cleaned
                    )}
                  </div>
                </div>
              );
            })}

            {/* Preview card */}
            {previewData && !isConfirmed && (
              <PreviewCard data={previewData} type={type} />
            )}

            {/* Confirmed state */}
            {isConfirmed && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                <Check className="w-4 h-4 text-green-500" />
                <span className="text-sm text-green-400 font-medium">{typeLabels[type]} created successfully!</span>
              </div>
            )}

            {isStreaming && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg px-3 py-2">
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          {!isConfirmed && (
            <div className="p-3 border-t border-border">
              <div className="flex gap-2 items-end bg-background border border-border rounded-lg p-2">
                <button
                  onClick={toggleVoice}
                  className={`p-2 rounded-md transition-colors flex-shrink-0 ${
                    isListening
                      ? 'bg-destructive/20 text-destructive animate-pulse'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                  title={isListening ? 'Stop listening' : 'Speak to add'}
                >
                  {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage(input);
                    }
                  }}
                  placeholder={isListening ? 'Listening...' : 'Describe the record...'}
                  rows={1}
                  className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground resize-none outline-none px-1 py-1 min-h-[28px] max-h-20"
                />
                <button
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim() || isStreaming}
                  className="p-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors flex-shrink-0"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

function PreviewCard({ data, type }: { data: Record<string, any>; type: string }) {
  const fields = Object.entries(data).filter(([_, v]) => v && v !== '' && !(Array.isArray(v) && v.length === 0));

  return (
    <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Sparkles className="w-3.5 h-3.5 text-accent" />
        <span className="text-xs font-display font-semibold text-accent">Preview</span>
      </div>
      <div className="space-y-1.5">
        {fields.map(([key, value]) => (
          <div key={key} className="flex items-start justify-between gap-2">
            <span className="text-xs text-muted-foreground capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
            <span className="text-xs text-foreground text-right max-w-[60%] truncate">
              {Array.isArray(value) ? value.join(', ') : typeof value === 'number' && key.includes('amount') || key.includes('ARR')
                ? `$${value.toLocaleString()}`
                : String(value)
              }
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Fallback manual form (simplified)
function ManualForm({ type, onClose, onBack }: { type: string; onClose: () => void; onBack: () => void }) {
  const [fields, setFields] = useState<Record<string, string>>({});

  const fieldConfigs: Record<string, { key: string; label: string; placeholder: string }[]> = {
    contact: [
      { key: 'name', label: 'Name', placeholder: 'Full name' },
      { key: 'email', label: 'Email', placeholder: 'email@example.com' },
      { key: 'phone', label: 'Phone', placeholder: '(555) 123-4567' },
      { key: 'company', label: 'Company', placeholder: 'Company name' },
    ],
    deal: [
      { key: 'name', label: 'Deal Name', placeholder: 'e.g. 123 Oak Lane Purchase' },
      { key: 'contactName', label: 'Contact', placeholder: 'Contact name' },
      { key: 'amount', label: 'Amount ($)', placeholder: '850000' },
    ],
    'use-case': [
      { key: 'name', label: 'Name', placeholder: 'e.g. Corporate Relocation' },
      { key: 'client', label: 'Client', placeholder: 'Client name' },
      { key: 'propertyType', label: 'Property Type', placeholder: 'e.g. Residential, Commercial' },
      { key: 'notes', label: 'Notes', placeholder: 'Any additional details' },
    ],
    activity: [
      { key: 'name', label: 'Activity Type', placeholder: 'e.g. Call, Email, Meeting, Showing' },
      { key: 'contact', label: 'Contact', placeholder: 'Contact name' },
      { key: 'date', label: 'Date', placeholder: 'e.g. Today, 2024-03-15' },
      { key: 'notes', label: 'Notes', placeholder: 'What happened?' },
    ],
    account: [
      { key: 'name', label: 'Company Name', placeholder: 'e.g. Acme Corp' },
      { key: 'industry', label: 'Industry', placeholder: 'e.g. Real Estate, Technology' },
      { key: 'website', label: 'Website', placeholder: 'e.g. acme.com' },
      { key: 'phone', label: 'Phone', placeholder: '(555) 123-4567' },
    ],
  };

  const config = fieldConfigs[type] || fieldConfigs.contact;

  const handleSubmit = () => {
    if (!fields.name?.trim()) return;
    toast({ title: `${typeLabels[type]} created`, description: `${fields.name} has been added.` });
    onClose();
  };

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-accent hover:underline mb-4">
        <Sparkles className="w-3 h-3" /> Back to AI chat
      </button>
      <div className="space-y-4">
        {config.map(f => (
          <div key={f.key} className="space-y-1.5">
            <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">{f.label}</label>
            <input
              value={fields[f.key] || ''}
              onChange={(e) => setFields(prev => ({ ...prev, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        ))}
        <button
          onClick={handleSubmit}
          disabled={!fields.name?.trim()}
          className="w-full h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors"
        >
          Create {typeLabels[type]}
        </button>
      </div>
    </div>
  );
}
