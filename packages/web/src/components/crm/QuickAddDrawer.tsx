// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useRef, useEffect } from 'react';
import { useAppStore } from '@/store/appStore';
import { X, Send, Sparkles, Check } from 'lucide-react';
import { useCreateContact, useCreateAccount, useCreateOpportunity, useCreateUseCase, useCreateActivity } from '@/api/hooks';
import { toast } from '@/components/ui/use-toast';

const typeLabels: Record<string, string> = {
  contact: 'Contact',
  deal: 'Deal',
  'use-case': 'Use Case',
  activity: 'Activity',
  account: 'Account',
};

const typeGreetings: Record<string, string> = {
  contact: "Hi! Tell me about the new contact — name, email, company, and any other details.",
  deal: "Let's create a new deal! What's the deal name, amount, and who's the contact?",
  'use-case': "Let's set up a new use case. What's the name and which client is it for?",
  activity: "Log an activity — tell me the type (call/email/meeting/note), contact, and any notes.",
  account: "Let's add a new account. What's the company name and any other details?",
};

type Message = { role: 'user' | 'assistant'; content: string };

function parseFieldsFromText(text: string, type: string): Record<string, unknown> {
  const lower = text.toLowerCase();
  const fields: Record<string, unknown> = {};

  // Extract name (first sentence or "name is X" pattern)
  const nameMatch = text.match(/(?:name(?:\s+is)?|called|named)\s+([A-Z][^\.,\n]+)/i) || text.match(/^([A-Z][a-z]+ [A-Z][a-z]+)/);
  if (nameMatch) fields.name = nameMatch[1].trim();

  // Extract email
  const emailMatch = text.match(/[\w.-]+@[\w.-]+\.\w+/);
  if (emailMatch) fields.email = emailMatch[0];

  // Extract phone
  const phoneMatch = text.match(/\+?[\d\s\-().]{10,}/);
  if (phoneMatch) fields.phone = phoneMatch[0].trim();

  // Extract company
  const companyMatch = text.match(/(?:at|from|company|works at|with)\s+([A-Z][^\.,\n]+)/i);
  if (companyMatch) fields.company = companyMatch[1].trim();

  if (type === 'deal') {
    const amountMatch = text.match(/\$?([\d,]+(?:\.\d+)?)\s*[kKmM]?/);
    if (amountMatch) {
      let amount = parseFloat(amountMatch[1].replace(',', ''));
      if (lower.includes('k') || lower.includes('thousand')) amount *= 1000;
      if (lower.includes('m') || lower.includes('million')) amount *= 1000000;
      fields.amount = Math.round(amount);
    }
    fields.stage = 'prospecting';
  }

  if (type === 'activity') {
    const types = ['call', 'email', 'meeting', 'note', 'task'];
    const foundType = types.find(t => lower.includes(t));
    fields.type = foundType ?? 'note';
    fields.description = text;
  }

  if (type === 'use-case') {
    fields.stage = 'discovery';
  }

  return fields;
}

function ChatAddPanel({ type, onClose }: { type: string; onClose: () => void }) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: typeGreetings[type] ?? typeGreetings.contact },
  ]);
  const [input, setInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [extractedFields, setExtractedFields] = useState<Record<string, unknown> | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const createContact = useCreateContact();
  const createAccount = useCreateAccount();
  const createOpportunity = useCreateOpportunity();
  const createUseCase = useCreateUseCase();
  const createActivity = useCreateActivity();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = () => {
    if (!input.trim() || isSubmitting) return;
    const userText = input.trim();
    setInput('');

    setMessages(prev => [...prev, { role: 'user', content: userText }]);

    // Parse fields from message
    const fields = parseFieldsFromText(userText, type);
    setExtractedFields(prev => ({ ...(prev ?? {}), ...fields }));

    // Generate assistant confirmation
    const fieldsList = Object.entries({ ...(extractedFields ?? {}), ...fields })
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `• **${k}**: ${v}`)
      .join('\n');

    setMessages(prev => [
      ...prev,
      {
        role: 'assistant',
        content: fieldsList
          ? `Got it! Here's what I'll create:\n\n${fieldsList}\n\nDoes this look right? Reply "yes" to confirm or add more details.`
          : "Thanks! Can you share more details like name, email, or any other relevant information?",
      },
    ]);
  };

  const handleConfirm = async () => {
    if (!extractedFields || isSubmitting) return;
    setIsSubmitting(true);

    try {
      if (type === 'contact') await createContact.mutateAsync(extractedFields);
      else if (type === 'account') await createAccount.mutateAsync(extractedFields);
      else if (type === 'deal') await createOpportunity.mutateAsync(extractedFields);
      else if (type === 'use-case') await createUseCase.mutateAsync(extractedFields);
      else if (type === 'activity') await createActivity.mutateAsync(extractedFields);

      setConfirmed(true);
      toast({ title: `${typeLabels[type]} created!`, description: 'Successfully added to your CRM.' });
      setTimeout(onClose, 1200);
    } catch {
      toast({ title: 'Error', description: 'Failed to create record. Please try again.', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const lastMsg = messages[messages.length - 1];
  const showConfirmButton =
    lastMsg?.role === 'assistant' &&
    lastMsg.content.includes("Does this look right") &&
    extractedFields !== null &&
    !confirmed;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (input.toLowerCase().trim() === 'yes' || input.toLowerCase().trim() === 'confirm') {
        handleConfirm();
      } else {
        handleSend();
      }
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-accent" />
          <span className="font-display font-bold text-foreground">New {typeLabels[type]}</span>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
          <X className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {confirmed && (
          <div className="flex justify-center">
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-success/15 text-success text-sm font-semibold">
              <Check className="w-4 h-4" /> Created successfully!
            </div>
          </div>
        )}
      </div>

      {/* Confirm button */}
      {showConfirmButton && (
        <div className="px-4 pb-2">
          <button
            onClick={handleConfirm}
            disabled={isSubmitting}
            className="w-full py-2.5 rounded-xl bg-success text-success-foreground text-sm font-semibold hover:bg-success/90 transition-colors disabled:opacity-50"
          >
            {isSubmitting ? 'Creating...' : `Confirm & Create ${typeLabels[type]}`}
          </button>
        </div>
      )}

      {/* Input */}
      <div className="flex items-end gap-2 p-3 border-t border-border">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type details or 'yes' to confirm..."
          rows={1}
          className="flex-1 resize-none bg-muted rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/30 min-h-[38px] max-h-28"
          style={{ height: 'auto' }}
        />
        <button
          onClick={() => {
            if (input.toLowerCase().trim() === 'yes' || input.toLowerCase().trim() === 'confirm') {
              handleConfirm();
            } else {
              handleSend();
            }
          }}
          disabled={!input.trim() || isSubmitting}
          className="p-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export function QuickAddDrawer() {
  const { quickAddType, closeQuickAdd } = useAppStore();

  if (!quickAddType) return null;

  return (
    <>
      <div className="fixed inset-0 bg-background/60 backdrop-blur-sm z-[80]" onClick={closeQuickAdd} />
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-card border-l border-border z-[90] shadow-2xl flex flex-col animate-slide-in-right">
        <ChatAddPanel type={quickAddType} onClose={closeQuickAdd} />
      </div>
    </>
  );
}
