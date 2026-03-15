// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useRef, useEffect } from 'react';
import { useAppStore } from '@/store/appStore';
import { X, Send, Sparkles, Check, FileText, Pencil } from 'lucide-react';
import { useCreateContact, useCreateAccount, useCreateOpportunity, useCreateUseCase, useCreateActivity, useAccounts } from '@/api/hooks';
import { toast } from '@/components/ui/use-toast';

const typeLabels: Record<string, string> = {
  contact: 'Contact',
  opportunity: 'Opportunity',
  'use-case': 'Use Case',
  activity: 'Activity',
  account: 'Account',
};

const typeGreetings: Record<string, string> = {
  contact: "Hi! Tell me about the new contact — name, email, company, and any other details.",
  opportunity: "Let's create a new opportunity! What's the name, amount, and who's the contact?",
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

  if (type === 'opportunity') {
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
  const [showForm, setShowForm] = useState(false);
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
      else if (type === 'opportunity') await createOpportunity.mutateAsync(extractedFields);
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
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowForm(!showForm)}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border transition-colors ${
              showForm
                ? 'border-border bg-muted text-foreground'
                : 'border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
          >
            <FileText className="w-3 h-3" />
            <span>Form</span>
          </button>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
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
      </>
      )}
    </div>
  );
}

type FieldConfig = {
  key: string;
  label: string;
  placeholder?: string;
  inputType?: 'text' | 'email' | 'tel' | 'number' | 'date' | 'url';
  fieldType?: 'textarea' | 'select' | 'account-select';
  options?: string[];
  required?: boolean;
};

const FIELD_CONFIGS: Record<string, FieldConfig[]> = {
  contact: [
    { key: 'first_name', label: 'First Name', placeholder: 'First name', required: true },
    { key: 'last_name', label: 'Last Name', placeholder: 'Last name' },
    { key: 'email', label: 'Email', placeholder: 'email@example.com', inputType: 'email' },
    { key: 'phone', label: 'Phone', placeholder: '(555) 123-4567', inputType: 'tel' },
    { key: 'company_name', label: 'Company', placeholder: 'Company name' },
  ],
  opportunity: [
    { key: 'name', label: 'Opportunity Name', placeholder: 'e.g. Acme Enterprise', required: true },
    { key: 'amount', label: 'Amount ($)', placeholder: '850000', inputType: 'number' },
    { key: 'close_date', label: 'Close Date', inputType: 'date' },
    { key: 'description', label: 'Description', placeholder: 'Optional notes', fieldType: 'textarea' },
  ],
  'use-case': [
    { key: 'name', label: 'Name', placeholder: 'e.g. Corporate Relocation', required: true },
    { key: 'account_id', label: 'Account', fieldType: 'account-select', required: true },
    { key: 'description', label: 'Description', placeholder: 'Any additional details', fieldType: 'textarea' },
  ],
  activity: [
    { key: 'type', label: 'Type', fieldType: 'select', options: ['call', 'email', 'meeting', 'note', 'task'], required: true },
    { key: 'subject', label: 'Subject', placeholder: 'What was this activity about?', required: true },
    { key: 'body', label: 'Notes', placeholder: 'Additional details...', fieldType: 'textarea' },
  ],
  account: [
    { key: 'name', label: 'Company Name', placeholder: 'e.g. Acme Corp', required: true },
    { key: 'industry', label: 'Industry', placeholder: 'e.g. Real Estate, Technology' },
    { key: 'website', label: 'Website', placeholder: 'https://acme.com', inputType: 'url' },
    { key: 'domain', label: 'Domain', placeholder: 'acme.com' },
  ],
};

function ManualForm({ type, onClose, onBack }: { type: string; onClose: () => void; onBack: () => void }) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { data: accountsData } = useAccounts({ limit: 200 });
  const accounts = (accountsData?.data ?? []) as Array<{ id: string; name: string }>;

  const createContact = useCreateContact();
  const createAccount = useCreateAccount();
  const createOpportunity = useCreateOpportunity();
  const createUseCase = useCreateUseCase();
  const createActivity = useCreateActivity();

  const config = FIELD_CONFIGS[type] ?? FIELD_CONFIGS.contact;

  const isValid = () => {
    if (type === 'contact') return !!fields.first_name?.trim();
    if (type === 'activity') return !!fields.type && !!fields.subject?.trim();
    if (type === 'use-case') return !!fields.name?.trim() && !!fields.account_id;
    return !!fields.name?.trim();
  };

  const set = (key: string, val: string) => setFields(prev => ({ ...prev, [key]: val }));

  const handleSubmit = async () => {
    if (!isValid() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const payload: Record<string, unknown> = { ...fields };

      if (type === 'contact') {
        delete payload.name; // server uses first_name/last_name
      }
      if (type === 'opportunity') {
        if (fields.amount) payload.amount = parseFloat(fields.amount) || 0;
        payload.stage = 'prospecting';
      }
      if (type === 'use-case') {
        payload.stage = 'discovery';
      }
      if (type === 'account' && fields.website) {
        payload.website = fields.website.startsWith('http') ? fields.website : `https://${fields.website}`;
      }

      if (type === 'contact') await createContact.mutateAsync(payload);
      else if (type === 'account') await createAccount.mutateAsync(payload);
      else if (type === 'opportunity') await createOpportunity.mutateAsync(payload);
      else if (type === 'use-case') await createUseCase.mutateAsync(payload);
      else if (type === 'activity') await createActivity.mutateAsync(payload);

      const label = fields.first_name ?? fields.name ?? fields.subject ?? typeLabels[type];
      toast({ title: `${typeLabels[type]} created`, description: `${label} has been added.` });
      onClose();
    } catch {
      toast({ title: 'Error', description: 'Failed to create. Please try again.', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClass = 'w-full h-10 px-3 rounded-md border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-accent hover:underline mb-5">
        <Sparkles className="w-3 h-3" /> Back to AI chat
      </button>
      <div className="space-y-4">
        {config.map(f => (
          <div key={f.key} className="space-y-1.5">
            <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
              {f.label}{f.required && <span className="text-destructive ml-0.5">*</span>}
            </label>

            {f.fieldType === 'select' ? (
              <select
                value={fields[f.key] || ''}
                onChange={(e) => set(f.key, e.target.value)}
                className={`${inputClass} pr-3`}
              >
                <option value="">Select {f.label.toLowerCase()}…</option>
                {f.options?.map(o => (
                  <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>
                ))}
              </select>
            ) : f.fieldType === 'account-select' ? (
              <select
                value={fields[f.key] || ''}
                onChange={(e) => set(f.key, e.target.value)}
                className={`${inputClass} pr-3`}
              >
                <option value="">Select account…</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            ) : f.fieldType === 'textarea' ? (
              <textarea
                value={fields[f.key] || ''}
                onChange={(e) => set(f.key, e.target.value)}
                placeholder={f.placeholder}
                rows={3}
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring resize-none"
              />
            ) : (
              <div className="relative">
                <input
                  type={f.inputType ?? 'text'}
                  value={fields[f.key] || ''}
                  onChange={(e) => set(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  className={`${inputClass} pr-8`}
                />
                <Pencil className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40 pointer-events-none" />
              </div>
            )}
          </div>
        ))}
        <button
          onClick={handleSubmit}
          disabled={!isValid() || isSubmitting}
          className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors mt-2"
        >
          {isSubmitting ? 'Creating...' : `Create ${typeLabels[type]}`}
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
