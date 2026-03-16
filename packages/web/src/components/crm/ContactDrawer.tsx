// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useRef } from 'react';
import { useContact, useActivities, useUpdateContact, useDeleteContact, useUsers, useCustomFields, useNotes, useCreateNote } from '@/api/hooks';
import { ContactAvatar } from './ContactAvatar';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store/appStore';
import { useAgentSettings } from '@/contexts/AgentSettingsContext';
import { StageBadge, LeadScoreBadge, CustomFieldsSection } from './CrmWidgets';
import { ActivityTimeline } from './ActivityTimeline';
import { Phone, Mail, StickyNote, Sparkles, Pencil, ChevronLeft, Send, Pin, Trash2, FileText } from 'lucide-react';
import { ContextPanel } from './ContextPanel';
import { BriefingPanel } from './BriefingPanel';
import { toast } from '@/components/ui/use-toast';
import { DatePicker } from '@/components/ui/date-picker';

const inputClass = 'w-full h-10 px-3 rounded-md border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';
const labelClass = 'text-xs font-mono text-muted-foreground uppercase tracking-wider';

const LIFECYCLE_STAGES = ['lead', 'qualified', 'opportunity', 'customer', 'churned'];

function ContactEditForm({
  contact,
  onSave,
  onCancel,
  onDelete,
  isSaving,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  contact: any;
  onSave: (data: Record<string, unknown>) => void;
  onCancel: () => void;
  onDelete: () => void;
  isSaving: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({
    first_name: contact.first_name ?? '',
    last_name: contact.last_name ?? '',
    email: contact.email ?? '',
    phone: contact.phone ?? '',
    company_name: contact.company_name ?? '',
    title: contact.title ?? '',
    lifecycle_stage: contact.lifecycle_stage ?? 'lead',
    source: contact.source ?? '',
    owner_id: contact.owner_id ?? '',
  });

  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    if (contact.custom_fields) {
      for (const [k, v] of Object.entries(contact.custom_fields as Record<string, unknown>)) {
        init[k] = String(v ?? '');
      }
    }
    return init;
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: usersData } = useUsers() as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const users: any[] = usersData?.data ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: customFieldDefs } = useCustomFields('contact') as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fieldDefs: any[] = customFieldDefs?.fields ?? [];

  const set = (key: string, val: string) => setFields(prev => ({ ...prev, [key]: val }));
  const setCF = (key: string, val: string) => setCustomFieldValues(prev => ({ ...prev, [key]: val }));

  const handleSave = () => {
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v !== '') payload[k] = v;
    }
    const cfPayload: Record<string, unknown> = {};
    for (const def of fieldDefs) {
      const val = customFieldValues[def.field_key] ?? '';
      if (val === '') continue;
      if (def.field_type === 'number') cfPayload[def.field_key] = Number(val);
      else if (def.field_type === 'boolean') cfPayload[def.field_key] = val === 'true';
      else cfPayload[def.field_key] = val;
    }
    if (Object.keys(cfPayload).length > 0) payload.custom_fields = cfPayload;
    onSave(payload);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-border">
        <button onClick={onCancel} className="flex items-center gap-1 text-xs text-accent hover:underline">
          <ChevronLeft className="w-3.5 h-3.5" /> Back
        </button>
        <span className="text-xs text-muted-foreground ml-auto">Editing contact</span>
      </div>
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className={labelClass}>First Name<span className="text-destructive ml-0.5">*</span></label>
            <input type="text" value={fields.first_name} onChange={e => set('first_name', e.target.value)} placeholder="First name" className={inputClass} />
          </div>
          <div className="space-y-1.5">
            <label className={labelClass}>Last Name</label>
            <input type="text" value={fields.last_name} onChange={e => set('last_name', e.target.value)} placeholder="Last name" className={inputClass} />
          </div>
        </div>
        {[
          { key: 'email', label: 'Email', type: 'email', placeholder: 'email@example.com' },
          { key: 'phone', label: 'Phone', type: 'tel', placeholder: '(555) 123-4567' },
          { key: 'company_name', label: 'Company', type: 'text', placeholder: 'Company name' },
          { key: 'title', label: 'Title', type: 'text', placeholder: 'Job title' },
          { key: 'source', label: 'Source', type: 'text', placeholder: 'e.g. inbound, referral' },
        ].map(f => (
          <div key={f.key} className="space-y-1.5">
            <label className={labelClass}>{f.label}</label>
            <input type={f.type} value={fields[f.key]} onChange={e => set(f.key, e.target.value)} placeholder={f.placeholder} className={inputClass} />
          </div>
        ))}
        <div className="space-y-1.5">
          <label className={labelClass}>Stage</label>
          <select value={fields.lifecycle_stage} onChange={e => set('lifecycle_stage', e.target.value)} className={`${inputClass} pr-3`}>
            {LIFECYCLE_STAGES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>
        {users.length > 0 && (
          <div className="space-y-1.5">
            <label className={labelClass}>Owner</label>
            <select value={fields.owner_id} onChange={e => set('owner_id', e.target.value)} className={`${inputClass} pr-3`}>
              <option value="">Unassigned</option>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {users.map((u: any) => (
                <option key={u.id} value={u.id}>{u.name || u.email}</option>
              ))}
            </select>
          </div>
        )}
        {fieldDefs.length > 0 && (
          <>
            <div className="border-t border-border pt-2">
              <p className={labelClass}>Custom Fields</p>
            </div>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {fieldDefs.map((def: any) => (
              <div key={def.field_key} className="space-y-1.5">
                <label className={labelClass}>{def.label}{def.required && <span className="text-destructive ml-0.5">*</span>}</label>
                {(def.field_type === 'text' || !def.field_type) && (
                  <input type="text" value={customFieldValues[def.field_key] ?? ''} onChange={e => setCF(def.field_key, e.target.value)} className={inputClass} />
                )}
                {def.field_type === 'number' && (
                  <input type="number" value={customFieldValues[def.field_key] ?? ''} onChange={e => setCF(def.field_key, e.target.value)} className={inputClass} />
                )}
                {def.field_type === 'date' && (
                  <DatePicker
                    value={customFieldValues[def.field_key] ?? ''}
                    onChange={val => setCF(def.field_key, val)}
                    required={def.required}
                  />
                )}
                {def.field_type === 'boolean' && (
                  <div className="flex items-center gap-2 h-10">
                    <input type="checkbox" checked={customFieldValues[def.field_key] === 'true'} onChange={e => setCF(def.field_key, e.target.checked ? 'true' : 'false')} className="w-4 h-4 rounded border-border accent-primary" />
                    <span className="text-sm text-foreground">Yes</span>
                  </div>
                )}
                {(def.field_type === 'select' || def.field_type === 'multi_select') && (
                  <select value={customFieldValues[def.field_key] ?? ''} onChange={e => setCF(def.field_key, e.target.value)} className={`${inputClass} pr-3`}>
                    <option value="">Select…</option>
                    {(def.options ?? []).map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                )}
              </div>
            ))}
          </>
        )}
        <button
          onClick={handleSave}
          disabled={!fields.first_name.trim() || isSaving}
          className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors"
        >
          {isSaving ? 'Saving…' : 'Save Changes'}
        </button>
        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="w-full h-9 rounded-md border border-destructive/40 text-destructive text-sm font-medium hover:bg-destructive/10 transition-colors flex items-center justify-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete Contact
          </button>
        ) : (
          <div className="flex gap-2">
            <button onClick={() => setConfirmDelete(false)} className="flex-1 h-9 rounded-md border border-border text-sm text-muted-foreground hover:bg-muted/50 transition-colors">
              Cancel
            </button>
            <button onClick={onDelete} className="flex-1 h-9 rounded-md bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 transition-colors">
              Confirm Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function ContactDrawer() {
  const { drawerEntityId, openAIWithContext, closeDrawer } = useAppStore();
  const { enabled: agentEnabled } = useAgentSettings();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [briefing, setBriefing] = useState(false);
  const [noting, setNoting] = useState(false);
  const [noteBody, setNoteBody] = useState('');
  const noteRef = useRef<HTMLTextAreaElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: contactData, isLoading } = useContact(drawerEntityId ?? '') as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: activitiesData } = useActivities({ contact_id: drawerEntityId ?? undefined, limit: 20 }) as any;
  const activities: any[] = activitiesData?.data ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: notesData } = useNotes({ object_type: 'contact', object_id: drawerEntityId ?? '' }) as any;
  const notes: any[] = notesData?.data ?? [];
  const createNote = useCreateNote();
  const updateContact = useUpdateContact(drawerEntityId ?? '');
  const deleteContact = useDeleteContact(drawerEntityId ?? '');

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 p-6 animate-pulse">
        <div className="flex gap-4">
          <div className="w-14 h-14 rounded-2xl bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-muted rounded w-3/4" />
            <div className="h-3 bg-muted rounded w-1/2" />
          </div>
        </div>
      </div>
    );
  }

  if (!contactData?.contact) {
    return <div className="p-4 text-muted-foreground">Contact not found</div>;
  }

  const contact = contactData.contact;
  const name: string = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.email || '';
  const company: string = contact.company_name ?? '';
  const stage: string = contact.lifecycle_stage ?? '';
  const leadScore: number = contact.lead_score ?? 0;

  if (briefing) {
    return <BriefingPanel subjectType="contact" subjectId={drawerEntityId!} onClose={() => setBriefing(false)} />;
  }

  if (editing) {
    return (
      <ContactEditForm
        contact={contact}
        onSave={async (data) => {
          await updateContact.mutateAsync(data);
          setEditing(false);
          toast({ title: 'Contact updated' });
        }}
        onCancel={() => setEditing(false)}
        onDelete={async () => {
          await deleteContact.mutateAsync();
          closeDrawer();
          toast({ title: 'Contact deleted' });
        }}
        isSaving={updateContact.isPending}
      />
    );
  }

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-border">
        <div className="flex items-start gap-4">
          <ContactAvatar name={name} className="w-14 h-14 rounded-2xl text-lg" />
          <div className="flex-1">
            <h2 className="font-display font-extrabold text-xl text-foreground">{name}</h2>
            {company && <p className="text-sm text-muted-foreground">{company}</p>}
            <div className="flex items-center gap-2 mt-2">
              {stage && <StageBadge stage={stage} />}
              {leadScore > 0 && <LeadScoreBadge score={leadScore} />}
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          {contact.phone && (
            <a
              href={`tel:${contact.phone}`}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-all press-scale"
            >
              <Phone className="w-3.5 h-3.5" /> Call
            </a>
          )}
          {contact.email && (
            <a
              href={`mailto:${contact.email}`}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-muted text-foreground text-sm font-medium hover:bg-muted/80 transition-all press-scale"
            >
              <Mail className="w-3.5 h-3.5" /> Email
            </a>
          )}
          <button
            onClick={() => { setNoting(v => !v); setTimeout(() => noteRef.current?.focus(), 50); }}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium transition-all press-scale ${noting ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground hover:bg-muted/80'}`}
          >
            <StickyNote className="w-3.5 h-3.5" /> Note
          </button>
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-muted text-foreground text-sm font-medium hover:bg-muted/80 transition-all press-scale"
          >
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
          <button
            onClick={() => setBriefing(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-muted text-foreground text-sm font-medium hover:bg-muted/80 transition-all press-scale"
          >
            <FileText className="w-3.5 h-3.5" /> Brief
          </button>
          {agentEnabled && (
            <button
              onClick={() => {
                openAIWithContext({ type: 'contact', id: contact.id, name, detail: company });
                closeDrawer();
                navigate('/agent');
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-accent/30 bg-accent/5 text-accent text-sm font-semibold hover:bg-accent/10 transition-all ml-auto press-scale"
            >
              <Sparkles className="w-3.5 h-3.5" /> Chat
            </button>
          )}
        </div>
      </div>

      {/* Note compose panel */}
      {noting && (
        <div className="mx-4 mt-4 rounded-xl border border-border bg-card p-3 space-y-2">
          <textarea
            ref={noteRef}
            value={noteBody}
            onChange={e => setNoteBody(e.target.value)}
            placeholder="Write a note…"
            rows={3}
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring resize-none"
          />
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => { setNoting(false); setNoteBody(''); }} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
            <button
              disabled={!noteBody.trim() || createNote.isPending}
              onClick={async () => {
                await createNote.mutateAsync({ object_type: 'contact', object_id: drawerEntityId, body: noteBody.trim() });
                setNoteBody('');
                setNoting(false);
                toast({ title: 'Note saved' });
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-40 transition-colors"
            >
              <Send className="w-3 h-3" /> Save
            </button>
          </div>
        </div>
      )}

      {/* Notes list */}
      {notes.length > 0 && (
        <div className="p-4 mx-4 mt-4 space-y-3">
          <h3 className="text-xs font-display font-bold text-muted-foreground uppercase tracking-wide">Notes</h3>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {notes.map((note: any) => (
            <div key={note.id} className="rounded-xl bg-muted/50 p-3 space-y-1">
              <div className="flex items-center gap-1.5">
                {note.pinned && <Pin className="w-3 h-3 text-accent" />}
                <span className="text-[10px] text-muted-foreground ml-auto">
                  {new Date(note.created_at).toLocaleDateString()}
                </span>
              </div>
              <p className="text-sm text-foreground whitespace-pre-wrap">{note.body}</p>
              {note.author_type && (
                <p className="text-[10px] text-muted-foreground capitalize">{note.author_type === 'agent' ? 'AI Agent' : note.author_type}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Details */}
      <div className="p-4 mx-4 mt-4 space-y-3">
        <h3 className="text-xs font-display font-bold text-muted-foreground uppercase tracking-wide">Details</h3>
        {[
          { label: 'Email', value: contact.email },
          { label: 'Phone', value: contact.phone },
          { label: 'Company', value: company },
          { label: 'Source', value: contact.source },
          { label: 'Last Contacted', value: contact.last_contacted_at ? new Date(contact.last_contacted_at).toLocaleDateString() : undefined },
          { label: 'Created', value: contact.created_at ? new Date(contact.created_at).toLocaleDateString() : undefined },
        ]
          .filter((f) => f.value)
          .map((field) => (
            <div key={field.label} className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{field.label}</span>
              <span className="text-sm text-foreground">{field.value}</span>
            </div>
          ))}
        {contact.tags && contact.tags.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mt-2">
            {(contact.tags as string[]).map((tag: string) => (
              <span key={tag} className="px-2.5 py-1 rounded-lg bg-muted text-xs text-muted-foreground font-medium">{tag}</span>
            ))}
          </div>
        )}
      </div>

      {/* Custom Fields */}
      <CustomFieldsSection objectType="contact" values={(contact.custom_fields ?? {}) as Record<string, unknown>} />

      {/* Context */}
      <ContextPanel subjectType="contact" subjectId={drawerEntityId!} />

      {/* Timeline */}
      <div className="p-4 mx-4 mt-4 mb-6">
        <h3 className="text-xs font-display font-bold text-muted-foreground uppercase tracking-wide mb-3">Timeline</h3>
        <ActivityTimeline activities={activities} />
      </div>
    </div>
  );
}
