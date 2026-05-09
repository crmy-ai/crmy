// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useRef, useEffect } from 'react';
import { useAppStore } from '@/store/appStore';
import { useAgentSettings } from '@/contexts/AgentSettingsContext';
import { X, Send, Sparkles, Check, FileText, Pencil, ChevronLeft } from 'lucide-react';
import { useCreateContact, useCreateAccount, useCreateOpportunity, useCreateUseCase, useCreateActivity, useCreateAssignment, useActors, useExtractRecordDraft } from '@/api/hooks';
import { EntityCombobox } from '@/components/ui/entity-combobox';
import { toast } from '@/components/ui/use-toast';
import { DatePicker, DateTimePicker } from '@/components/ui/date-picker';
import { DuplicateWarning, type DuplicateCandidate } from '@/components/crm/DuplicateWarning';
import { ApiError } from '@/api/client';
import { assertReferenceExists, assertSubjectReference, normalizeSubjectLink, trimStringPayload } from '@/lib/referenceValidation';

const typeLabels: Record<string, string> = {
  contact: 'Contact',
  opportunity: 'Opportunity',
  'use-case': 'Use Case',
  activity: 'Activity',
  account: 'Account',
  assignment: 'Assignment',
};

const typeGreetings: Record<string, string> = {
  contact: "Hi! Tell me about the new contact — name, email, company, and any other details.",
  opportunity: "Let's create a new opportunity! What's the name, amount, and who's the contact?",
  'use-case': "Let's set up a new use case. What's the name and which client is it for?",
  activity: "Log an activity — tell me the type (call, email, meeting, note, demo, proposal, etc.), what it's about, and any outcome or notes.",
  account: "Let's add a new account. What's the company name and any other details?",
  assignment: "Let's create a new assignment. What's the title, type (call, email, research, etc.), and who should it be assigned to?",
};

type Message = { role: 'user' | 'assistant'; content: string };

const MONTH_INDEX: Record<string, number> = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sept: 8, sep: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
};

function cleanExtractedName(value?: string | null): string | undefined {
  if (!value) return undefined;
  const cleaned = value
    .replace(/\s+(?:who|that|which|wants?|needs?|asked|said|has|had|is|was|for|about|on)\b.*$/i, '')
    .replace(/[.,;:!?]+$/g, '')
    .trim();
  return cleaned || undefined;
}

function extractCompanyName(text: string): string | undefined {
  const companyMatch =
    text.match(/\b(?:works at|company is|company|from|at)\s+([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,5})/i);
  return cleanExtractedName(companyMatch?.[1]);
}

function extractPersonAndCompany(text: string): { personName?: string; companyName?: string } {
  const personMatch = text.match(/\b(?:with|spoke with|met with|called|emailed)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})(?:\s+(?:from|at)\s+([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,5}))?/i);
  return {
    personName: cleanExtractedName(personMatch?.[1]),
    companyName: cleanExtractedName(personMatch?.[2]) ?? extractCompanyName(text),
  };
}

function extractMentionedDate(text: string): { label: string; isoDate?: string } | undefined {
  const dateMatch = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*(\d{4}))?\b/i);
  if (!dateMatch) return undefined;
  const month = MONTH_INDEX[dateMatch[1].toLowerCase().replace('.', '')];
  const day = Number(dateMatch[2]);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return { label: dateMatch[0] };

  const now = new Date();
  let year = dateMatch[3] ? Number(dateMatch[3]) : now.getFullYear();
  let date = new Date(year, month, day);
  if (!dateMatch[3] && date.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) {
    year += 1;
    date = new Date(year, month, day);
  }
  const isoDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return { label: dateMatch[0], isoDate };
}

function sentenceParts(text: string): string[] {
  return text
    .split(/[.!?]\s+/)
    .map(part => part.trim().replace(/[.!?]+$/g, ''))
    .filter(Boolean);
}

function titleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

function splitContactName(name: string): { first_name: string; last_name?: string } {
  const parts = name.trim().split(/\s+/);
  return {
    first_name: parts[0] ?? name,
    last_name: parts.slice(1).join(' ') || undefined,
  };
}

function parseActivityFields(text: string): Record<string, unknown> {
  const lower = text.toLowerCase();
  const fields: Record<string, unknown> = {};
  const types = ['call', 'email', 'meeting', 'note', 'task', 'demo', 'proposal', 'research', 'handoff', 'status_update'];
  const foundType = types.find(t => lower.includes(t.replace('_', ' ')) || lower.includes(t)) ?? 'note';
  const { personName, companyName } = extractPersonAndCompany(text);
  const mentionedDate = extractMentionedDate(text);
  const parts = sentenceParts(text);
  const notes = parts.length > 1 ? parts.slice(1).join('. ') : text;

  fields.type = foundType;
  if (personName) {
    fields.subject = `${titleCase(foundType)} with ${personName}${companyName ? ` from ${companyName}` : ''}`;
  } else if (companyName) {
    fields.subject = `${titleCase(foundType)} with ${companyName}`;
  } else {
    fields.subject = parts[0] || `${titleCase(foundType)} activity`;
  }
  fields.body = notes;

  const outcomes = ['connected', 'voicemail', 'positive', 'negative', 'neutral', 'no show', 'no_show', 'follow up needed', 'follow_up_needed'];
  const foundOutcome = outcomes.find(o => lower.includes(o));
  if (foundOutcome) fields.outcome = foundOutcome.replace(/ /g, '_');
  else if (/\b(wants?|requested|asked for|needs?)\b.*\b(demo|follow.?up|meeting|proposal)\b/.test(lower)) fields.outcome = 'follow_up_needed';

  if (lower.includes('yesterday')) fields.occurred_at = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  else if (lower.includes('today')) fields.occurred_at = new Date().toISOString();

  const detail: Record<string, unknown> = {};
  if (personName) detail.contact_name = personName;
  if (companyName) detail.company_name = companyName;
  if (mentionedDate) {
    detail.mentioned_date = mentionedDate.isoDate ?? mentionedDate.label;
    if (/\bdemo\b/.test(lower)) detail.next_step = 'demo';
  }
  if (Object.keys(detail).length > 0) fields.detail = detail;

  return fields;
}

function formatFieldName(key: string): string {
  const labels: Record<string, string> = {
    body: 'notes',
    company_name: 'company',
    first_name: 'first name',
    last_name: 'last name',
    occurred_at: 'occurred at',
  };
  return labels[key] ?? key.replace(/_/g, ' ');
}

function formatFieldValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${formatFieldName(k)}: ${String(v)}`)
      .join(', ');
  }
  return String(value);
}

function missingRequiredDraftFields(type: string, fields: Record<string, unknown>): string[] {
  if (type === 'contact') return fields.first_name ? [] : ['first name'];
  if (type === 'account') return fields.name ? [] : ['company name'];
  if (type === 'opportunity') return fields.name ? [] : ['opportunity name'];
  if (type === 'activity') return fields.type && fields.subject ? [] : ['type', 'subject'].filter(key => !fields[key]);
  if (type === 'use-case') {
    const missing: string[] = [];
    if (!fields.name) missing.push('use case name');
    if (!fields.account_id) missing.push('client');
    return missing;
  }
  if (type === 'assignment') {
    const missing: string[] = [];
    if (!fields.title) missing.push('title');
    if (!fields.assignment_type) missing.push('type');
    if (!fields.assigned_to) missing.push('assignee');
    return missing;
  }
  return [];
}

function parseFieldsFromText(text: string, type: string): Record<string, unknown> {
  const lower = text.toLowerCase();
  const fields: Record<string, unknown> = {};

  if (type === 'activity') return parseActivityFields(text);

  // Extract name (first sentence or "name is X" pattern)
  const nameMatch = text.match(/(?:name(?:\s+is)?|called|named)\s+([A-Z][^\.,\n]+)/i) || text.match(/^([A-Z][a-z]+ [A-Z][a-z]+)/);
  if (nameMatch) {
    const name = cleanExtractedName(nameMatch[1]) ?? nameMatch[1].trim();
    if (type === 'contact') Object.assign(fields, splitContactName(name));
    else fields.name = name;
  }

  // Extract email
  const emailMatch = text.match(/[\w.-]+@[\w.-]+\.\w+/);
  if (emailMatch) fields.email = emailMatch[0];

  // Extract phone
  const phoneMatch = text.match(/\+?[\d\s\-().]{10,}/);
  if (phoneMatch) fields.phone = phoneMatch[0].trim();

  const companyName = extractCompanyName(text);
  if (companyName) {
    if (type === 'contact') fields.company_name = companyName;
    else if (type === 'account' && !fields.name) fields.name = companyName;
  }

  if (type === 'account' && !fields.name) {
    fields.name = cleanExtractedName(sentenceParts(text)[0]) ?? text.trim();
  }

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

  if (type === 'use-case') {
    fields.stage = 'discovery';
  }

  if (type === 'assignment') {
    // Extract assignment type
    const assignmentTypes = ['call', 'draft', 'email', 'follow_up', 'follow up', 'research', 'review', 'send'];
    const foundType = assignmentTypes.find(t => lower.includes(t));
    if (foundType) fields.assignment_type = foundType.replace(' ', '_');
    // Use first sentence as title if no explicit name
    if (!fields.name) {
      const firstSentence = text.split(/[.!?]/)[0].trim();
      if (firstSentence) fields.title = firstSentence;
    } else {
      fields.title = fields.name;
      delete fields.name;
    }
    // Extract priority
    if (lower.includes('urgent')) fields.priority = 'urgent';
    else if (lower.includes('high priority') || lower.includes('high-priority')) fields.priority = 'high';
    else if (lower.includes('low priority') || lower.includes('low-priority')) fields.priority = 'low';
    else fields.priority = 'normal';
  }

  return fields;
}

function ChatAddPanel({ type, onClose }: { type: string; onClose: () => void }) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: typeGreetings[type] ?? typeGreetings.contact },
  ]);
  const [input, setInput] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [extractedFields, setExtractedFields] = useState<Record<string, unknown> | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [chatDuplicates, setChatDuplicates] = useState<DuplicateCandidate[] | null>(null);
  const [chatPendingFields, setChatPendingFields] = useState<Record<string, unknown> | null>(null);
  const { openDrawer, closeQuickAdd } = useAppStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { enabled: agentEnabled, connectivity, config } = useAgentSettings();

  const createContact = useCreateContact();
  const createAccount = useCreateAccount();
  const createOpportunity = useCreateOpportunity();
  const createUseCase = useCreateUseCase();
  const createActivity = useCreateActivity();
  const createAssignment = useCreateAssignment();
  const extractRecordDraft = useExtractRecordDraft();
  const canUseAgentExtraction = agentEnabled && Boolean(config?.model && config?.base_url) && connectivity !== 'offline';
  const extractionModeDetail = connectivity === 'unknown'
    ? 'Using the saved Workspace Agent config. If the model cannot be reached, this will switch to the form.'
    : 'Your local or configured model drafts fields before you confirm.';

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = async () => {
    if (!input.trim() || isSubmitting || isExtracting) return;
    const userText = input.trim();
    setInput('');

    setMessages(prev => [...prev, { role: 'user', content: userText }]);

    let fields: Record<string, unknown>;
    let extractionSource = 'Workspace Agent';
    if (canUseAgentExtraction) {
      setIsExtracting(true);
      try {
        const result = await extractRecordDraft.mutateAsync({ text: userText, object_type: type });
        fields = result.data;
        extractionSource = 'Workspace Agent';
      } catch (err) {
        console.warn('[quick-add] agent extraction failed, opening form:', err);
        toast({
          title: 'Workspace Agent unavailable',
          description: 'Use the form to create this record. The quick parser is intentionally not used for record creation.',
          variant: 'destructive',
        });
        setMessages(prev => [
          ...prev,
          { role: 'assistant', content: 'I could not reach the Workspace Agent, so I opened the form. That is safer than guessing fields with the quick parser.' },
        ]);
        setShowForm(true);
        setIsExtracting(false);
        return;
      } finally {
        setIsExtracting(false);
      }
    } else {
      setShowForm(true);
      return;
    }

    const mergedFields = { ...(extractedFields ?? {}), ...fields };
    setExtractedFields(mergedFields);
    const missing = missingRequiredDraftFields(type, mergedFields);

    // Generate assistant confirmation
    const fieldsList = Object.entries(mergedFields)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `• **${formatFieldName(k)}**: ${formatFieldValue(v)}`)
      .join('\n');

    setMessages(prev => [
      ...prev,
      {
        role: 'assistant',
        content: missing.length > 0
          ? `I drafted this with ${extractionSource}:\n\n${fieldsList || 'No reliable fields yet.'}\n\nI still need ${missing.join(', ')}. Add that here, or use the form for fields that require selecting an existing record.`
          : fieldsList
          ? `Got it — I drafted this with ${extractionSource}:\n\n${fieldsList}\n\nDoes this look right? Reply "yes" to confirm or add more details.`
          : "Thanks! Can you share more details like name, email, or any other relevant information?",
      },
    ]);
  };

  const handleConfirm = async (fields = extractedFields, allowDuplicates = false) => {
    if (!fields || isSubmitting || isExtracting) return;
    setIsSubmitting(true);

    try {
      const payload = allowDuplicates ? { ...fields, allow_duplicates: true } : fields;
      if (type === 'contact') await createContact.mutateAsync(payload);
      else if (type === 'account') await createAccount.mutateAsync(payload);
      else if (type === 'opportunity') await createOpportunity.mutateAsync(payload);
      else if (type === 'use-case') await createUseCase.mutateAsync(payload);
      else if (type === 'activity') await createActivity.mutateAsync(payload);
      else if (type === 'assignment') await createAssignment.mutateAsync(payload);

      setChatDuplicates(null);
      setChatPendingFields(null);
      setConfirmed(true);
      toast({ title: `${typeLabels[type]} created!`, description: 'Added to operational state. Next: open it for a briefing or audit trail.' });
      setTimeout(onClose, 1200);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.candidates.length > 0) {
        setChatDuplicates(err.candidates as DuplicateCandidate[]);
        setChatPendingFields(fields);
      } else {
        toast({ title: `Failed to create ${typeLabels[type]}`, description: err instanceof Error ? err.message : 'Please try again.', variant: 'destructive' });
      }
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

  // ── Duplicate warning (chat mode) ───────────────────────────────────────
  if (chatDuplicates && chatPendingFields) {
    const entityType = type as 'contact' | 'account' | 'opportunity' | 'use-case';
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="font-display font-bold text-foreground">New {typeLabels[type]}</span>
          <button onClick={onClose}><X className="w-4 h-4 text-muted-foreground" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <DuplicateWarning
            entityType={entityType}
            candidates={chatDuplicates}
            onUseExisting={(id) => {
              openDrawer(entityType === 'use-case' ? 'use-case' : entityType as Parameters<typeof openDrawer>[0], id);
              closeQuickAdd();
            }}
            onCreateAnyway={() => handleConfirm(chatPendingFields, true)}
            onCancel={() => { setChatDuplicates(null); setChatPendingFields(null); }}
          />
        </div>
      </div>
    );
  }

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
        <ManualForm type={type} onClose={onClose} onBack={() => setShowForm(false)} backLabel="Back to guided add" />
      ) : (
      <>
      {canUseAgentExtraction && (
        <div className="border-b border-border px-4 py-2.5">
          <div className="flex items-start gap-2 rounded-xl border border-violet-500/25 bg-violet-500/8 px-3 py-2 text-violet-300">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-violet-400" />
            <div className="min-w-0">
              <p className="text-xs font-semibold">Workspace Agent extraction</p>
              <p className="mt-0.5 text-xs opacity-80">{extractionModeDetail}</p>
            </div>
          </div>
        </div>
      )}
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
            onClick={() => handleConfirm()}
            disabled={isSubmitting || isExtracting}
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
          disabled={!input.trim() || isSubmitting || isExtracting}
          className="p-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
        >
          {isExtracting ? <Sparkles className="w-4 h-4 animate-pulse" /> : <Send className="w-4 h-4" />}
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
  inputType?: 'text' | 'email' | 'tel' | 'number' | 'date' | 'url' | 'datetime-local';
  fieldType?: 'textarea' | 'select' | 'account-select' | 'contact-select' | 'opportunity-select' | 'subject-type-select' | 'entity-select' | 'datalist' | 'actor-select';
  options?: string[];
  datalistId?: string;
  suggestions?: string[];
  required?: boolean;
  dependsOn?: { key: string; values?: string[] };
};

const FIELD_CONFIGS: Record<string, FieldConfig[]> = {
  contact: [
    { key: 'first_name', label: 'First Name', placeholder: 'First name', required: true },
    { key: 'last_name', label: 'Last Name', placeholder: 'Last name' },
    { key: 'email', label: 'Email', placeholder: 'email@example.com', inputType: 'email' },
    { key: 'phone', label: 'Phone', placeholder: '(555) 123-4567', inputType: 'tel' },
    { key: 'company_name', label: 'Company', placeholder: 'Company name' },
    { key: 'account_id', label: 'Existing Account', fieldType: 'account-select' },
  ],
  opportunity: [
    { key: 'name', label: 'Opportunity Name', placeholder: 'e.g. Acme Enterprise', required: true },
    { key: 'account_id', label: 'Account', fieldType: 'account-select' },
    { key: 'contact_id', label: 'Primary Contact', fieldType: 'contact-select' },
    { key: 'amount', label: 'Amount ($)', placeholder: '850000', inputType: 'number' },
    { key: 'close_date', label: 'Close Date', inputType: 'date' },
    { key: 'description', label: 'Description', placeholder: 'Optional notes', fieldType: 'textarea' },
  ],
  'use-case': [
    { key: 'name', label: 'Name', placeholder: 'e.g. Corporate Relocation', required: true },
    { key: 'account_id', label: 'Account', fieldType: 'account-select', required: true },
    { key: 'opportunity_id', label: 'Opportunity', fieldType: 'opportunity-select' },
    { key: 'stage', label: 'Stage', fieldType: 'select', options: ['discovery', 'poc', 'production', 'scaling', 'sunset'] },
    { key: 'attributed_arr', label: 'Attributed ARR ($)', placeholder: '120000', inputType: 'number' },
    { key: 'target_prod_date', label: 'Target Prod Date', inputType: 'date' },
    { key: 'description', label: 'Description', placeholder: 'Any additional details', fieldType: 'textarea' },
  ],
  activity: [
    { key: 'type', label: 'Type', fieldType: 'select', options: ['call', 'email', 'meeting', 'note', 'task', 'demo', 'proposal', 'research', 'handoff', 'status_update'], required: true},
    { key: 'subject', label: 'Subject', placeholder: 'What was this activity about?', required: true },
    { key: 'subject_type', label: 'Linked To', fieldType: 'subject-type-select', placeholder: 'Link to a customer object (optional)' },
    { key: 'subject_id', label: 'Record', fieldType: 'entity-select', dependsOn: { key: 'subject_type' } },
    { key: 'direction', label: 'Direction', fieldType: 'select', options: ['inbound', 'outbound'] },
    { key: 'occurred_at', label: 'When', inputType: 'datetime-local', placeholder: 'When did this happen?' },
    { key: 'duration_minutes', label: 'Duration (minutes)', placeholder: '30', inputType: 'number' },
    { key: 'outcome', label: 'Outcome', fieldType: 'datalist', datalistId: 'outcome-suggestions', suggestions: ['connected', 'voicemail', 'positive', 'negative', 'neutral', 'no_show', 'follow_up_needed'], placeholder: 'e.g. connected, positive, voicemail' },
    { key: 'body', label: 'Notes', placeholder: 'Additional details...', fieldType: 'textarea' },
  ],
  account: [
    { key: 'name', label: 'Company Name', placeholder: 'e.g. Acme Corp', required: true },
    { key: 'industry', label: 'Industry', placeholder: 'e.g. Real Estate, Technology' },
    { key: 'website', label: 'Website', placeholder: 'https://acme.com', inputType: 'url' },
    { key: 'domain', label: 'Domain', placeholder: 'acme.com' },
  ],
  assignment: [
    { key: 'title', label: 'Title', placeholder: 'e.g. Follow up with Acme about contract', required: true },
    { key: 'assignment_type', label: 'Type', fieldType: 'select', options: ['call', 'draft', 'email', 'follow_up', 'research', 'review', 'send'], required: true },
    { key: 'assigned_to', label: 'Assign To', fieldType: 'actor-select', required: true },
    { key: 'subject_type', label: 'Linked To', fieldType: 'subject-type-select' },
    { key: 'subject_id', label: 'Record', fieldType: 'entity-select', dependsOn: { key: 'subject_type' } },
    { key: 'priority', label: 'Priority', fieldType: 'select', options: ['low', 'normal', 'high', 'urgent'] },
    { key: 'due_at', label: 'Due Date', inputType: 'date' },
    { key: 'context', label: 'Context', placeholder: 'Brief context for the assignee', fieldType: 'textarea' },
    { key: 'description', label: 'Description', placeholder: 'Additional details', fieldType: 'textarea' },
  ],
};

const SUBJECT_TYPE_OPTIONS = [
  { value: '', label: 'None (no link)' },
  { value: 'contact', label: 'Contact' },
  { value: 'account', label: 'Account' },
  { value: 'opportunity', label: 'Opportunity' },
  { value: 'use_case', label: 'Use Case' },
];

function EntitySelect({ subjectType, value, onChange }: { subjectType: string; value: string; onChange: (v: string) => void }) {
  const validTypes = ['account', 'contact', 'opportunity', 'use_case'];
  if (!subjectType || !validTypes.includes(subjectType)) return null;
  return (
    <EntityCombobox
      entityType={subjectType as 'account' | 'contact' | 'opportunity' | 'use_case'}
      value={value}
      onChange={onChange}
      placeholder={`Select ${subjectType.replace('_', ' ')}…`}
    />
  );
}

function ActorSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: actorsData } = useActors({ limit: 100, is_active: true }) as any;
  const actors: Array<{ id: string; display_name: string; actor_type: string }> = actorsData?.data ?? actorsData?.actors ?? [];
  const inputClass = 'w-full h-10 px-3 rounded-md border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={`${inputClass} pr-3`}>
      <option value="">Select actor…</option>
      {actors.map(a => (
        <option key={a.id} value={a.id}>
          {a.display_name} ({a.actor_type})
        </option>
      ))}
    </select>
  );
}

function ManualForm({ type, onClose, onBack, backLabel }: { type: string; onClose: () => void; onBack: () => void; backLabel?: string }) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [duplicateCandidates, setDuplicateCandidates] = useState<DuplicateCandidate[] | null>(null);
  const [pendingPayload, setPendingPayload] = useState<Record<string, unknown> | null>(null);
  const { openDrawer, closeQuickAdd } = useAppStore();

  const createContact = useCreateContact();
  const createAccount = useCreateAccount();
  const createOpportunity = useCreateOpportunity();
  const createUseCase = useCreateUseCase();
  const createActivity = useCreateActivity();
  const createAssignment = useCreateAssignment();

  const config = FIELD_CONFIGS[type] ?? FIELD_CONFIGS.contact;

  const isValid = () => {
    if (type === 'contact') return !!fields.first_name?.trim();
    if (type === 'activity') return !!fields.type && !!fields.subject?.trim();
    if (type === 'use-case') return !!fields.name?.trim() && !!fields.account_id;
    if (type === 'assignment') return !!fields.title?.trim() && !!fields.assignment_type && !!fields.assigned_to;
    return !!fields.name?.trim();
  };

  const set = (key: string, val: string) => setFields(prev => ({ ...prev, [key]: val }));

  const buildPayload = (): Record<string, unknown> => {
    const payload: Record<string, unknown> = { ...fields };
    trimStringPayload(payload);
    if (type === 'contact') delete payload.name;
    if (type === 'opportunity') { if (fields.amount) payload.amount = parseFloat(fields.amount) || 0; payload.stage = 'prospecting'; }
    if (type === 'use-case') { if (!payload.stage) payload.stage = 'discovery'; if (fields.attributed_arr) payload.attributed_arr = parseFloat(fields.attributed_arr) || 0; }
    if (type === 'account' && typeof payload.website === 'string') {
      payload.website = payload.website.startsWith('http') ? payload.website : `https://${payload.website}`;
    }
    if (type === 'activity') {
      if (fields.occurred_at) payload.occurred_at = new Date(fields.occurred_at).toISOString();
      normalizeSubjectLink(payload);
      if (fields.duration_minutes) {
        const duration = parseInt(fields.duration_minutes, 10);
        if (Number.isFinite(duration) && duration > 0) payload.detail = { duration_minutes: duration };
      }
      delete payload.duration_minutes;
    }
    if (type === 'assignment') {
      if (fields.due_at) payload.due_at = new Date(fields.due_at + 'T00:00:00').toISOString();
      normalizeSubjectLink(payload);
      if (!fields.due_at) delete payload.due_at;
      if (!fields.priority) payload.priority = 'normal';
    }
    return payload;
  };

  const validateReferences = async (payload: Record<string, unknown>) => {
    if (typeof payload.account_id === 'string') await assertReferenceExists('account', payload.account_id, 'account');
    if (typeof payload.contact_id === 'string') await assertReferenceExists('contact', payload.contact_id, 'contact');
    if (typeof payload.opportunity_id === 'string') await assertReferenceExists('opportunity', payload.opportunity_id, 'opportunity');
    if (typeof payload.assigned_to === 'string') await assertReferenceExists('actor', payload.assigned_to, 'assignee');
    if (type === 'activity' || type === 'assignment') {
      await assertSubjectReference(payload.subject_type as string | undefined, payload.subject_id as string | undefined);
    }
  };

  const executeCreate = async (payload: Record<string, unknown>) => {
    if (type === 'contact') await createContact.mutateAsync(payload);
    else if (type === 'account') await createAccount.mutateAsync(payload);
    else if (type === 'opportunity') await createOpportunity.mutateAsync(payload);
    else if (type === 'use-case') await createUseCase.mutateAsync(payload);
    else if (type === 'activity') await createActivity.mutateAsync(payload);
    else if (type === 'assignment') await createAssignment.mutateAsync(payload);
    const label = fields.first_name ?? fields.title ?? fields.name ?? fields.subject ?? typeLabels[type];
    toast({ title: `${typeLabels[type]} created`, description: `${label} has been added. Open the record for briefing, context, and audit actions.` });
    onClose();
  };

  const handleSubmit = async () => {
    if (!isValid() || isSubmitting) return;
    setIsSubmitting(true);
    const payload = buildPayload();
    try {
      await validateReferences(payload);
      await executeCreate(payload);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.candidates.length > 0) {
        setDuplicateCandidates(err.candidates as DuplicateCandidate[]);
        setPendingPayload(payload);
      } else {
        toast({ title: `Failed to create ${typeLabels[type]}`, description: err instanceof Error ? err.message : 'Please try again.', variant: 'destructive' });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClass = 'w-full h-10 px-3 rounded-md border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';

  // Check if a field should be visible based on its dependsOn condition
  const isFieldVisible = (f: FieldConfig) => {
    if (!f.dependsOn) return true;
    const depVal = fields[f.dependsOn.key];
    if (!depVal) return false;
    if (f.dependsOn.values) return f.dependsOn.values.includes(depVal);
    return true;
  };

  // ── Duplicate warning overlay ────────────────────────────────────────────
  if (duplicateCandidates && pendingPayload) {
    const entityType = type as 'contact' | 'account' | 'opportunity' | 'use-case';
    return (
      <div className="flex-1 overflow-y-auto p-4">
        <DuplicateWarning
          entityType={entityType}
          candidates={duplicateCandidates}
          onUseExisting={(id) => {
            openDrawer(entityType === 'use-case' ? 'use-case' : entityType as Parameters<typeof openDrawer>[0], id);
            closeQuickAdd();
          }}
          onCreateAnyway={async () => {
            setDuplicateCandidates(null);
            setIsSubmitting(true);
            try {
              await executeCreate({ ...pendingPayload, allow_duplicates: true });
            } catch (err) {
              toast({ title: `Failed to create ${typeLabels[type]}`, description: err instanceof Error ? err.message : 'Please try again.', variant: 'destructive' });
            } finally {
              setIsSubmitting(false);
              setPendingPayload(null);
            }
          }}
          onCancel={() => { setDuplicateCandidates(null); setPendingPayload(null); }}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-accent hover:underline mb-5">
        {backLabel ? <><Sparkles className="w-3 h-3" /> {backLabel}</> : <><ChevronLeft className="w-3.5 h-3.5" /> Back</>}
      </button>
      <div className="space-y-4">
        {config.filter(isFieldVisible).map(f => (
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
                  <option key={o} value={o}>{o.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
                ))}
              </select>
            ) : f.fieldType === 'account-select' ? (
              <EntityCombobox
                entityType="account"
                value={fields[f.key] || ''}
                onChange={(v) => set(f.key, v)}
                placeholder="Select company…"
              />
            ) : f.fieldType === 'contact-select' ? (
              <EntityCombobox
                entityType="contact"
                value={fields[f.key] || ''}
                onChange={(v) => set(f.key, v)}
                placeholder="Select contact…"
              />
            ) : f.fieldType === 'opportunity-select' ? (
              <EntityCombobox
                entityType="opportunity"
                value={fields[f.key] || ''}
                onChange={(v) => set(f.key, v)}
                placeholder="Select opportunity…"
              />
            ) : f.fieldType === 'subject-type-select' ? (
              <select
                value={fields[f.key] || ''}
                onChange={(e) => { set(f.key, e.target.value); set('subject_id', ''); }}
                className={`${inputClass} pr-3`}
              >
                {SUBJECT_TYPE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            ) : f.fieldType === 'entity-select' ? (
              <EntitySelect
                subjectType={fields.subject_type || ''}
                value={fields[f.key] || ''}
                onChange={(v) => set(f.key, v)}
              />
            ) : f.fieldType === 'actor-select' ? (
              <ActorSelect
                value={fields[f.key] || ''}
                onChange={(v) => set(f.key, v)}
              />
            ) : f.fieldType === 'datalist' ? (
              <>
                <input
                  type="text"
                  value={fields[f.key] || ''}
                  onChange={(e) => set(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  list={f.datalistId}
                  className={`${inputClass} pr-3`}
                />
                {f.datalistId && f.suggestions && (
                  <datalist id={f.datalistId}>
                    {f.suggestions.map(s => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                )}
              </>
            ) : f.fieldType === 'textarea' ? (
              <textarea
                value={fields[f.key] || ''}
                onChange={(e) => set(f.key, e.target.value)}
                placeholder={f.placeholder}
                rows={3}
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring resize-none"
              />
            ) : f.inputType === 'date' ? (
              <DatePicker
                value={fields[f.key] || ''}
                onChange={(v) => set(f.key, v)}
                required={f.required}
              />
            ) : f.inputType === 'datetime-local' ? (
              <DateTimePicker
                value={fields[f.key] || ''}
                onChange={(v) => set(f.key, v)}
                required={f.required}
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
  const { enabled: agentEnabled, config, connectivity, loading } = useAgentSettings();

  if (!quickAddType) return null;
  const agentReady = agentEnabled && Boolean(config?.model && config?.base_url) && connectivity !== 'offline';

  return (
    <>
      <div className="fixed inset-0 bg-background/60 backdrop-blur-sm z-[80]" onClick={closeQuickAdd} />
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-card border-l border-border z-[90] shadow-2xl flex flex-col animate-slide-in-right">
        {loading ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <Sparkles className="h-5 w-5 animate-pulse text-violet-400" />
            <p className="text-sm text-muted-foreground">Checking Workspace Agent settings…</p>
          </div>
        ) : agentReady
          ? <ChatAddPanel type={quickAddType} onClose={closeQuickAdd} />
          : <ManualForm type={quickAddType} onClose={closeQuickAdd} onBack={closeQuickAdd} />
        }
      </div>
    </>
  );
}
