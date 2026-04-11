// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TopBar } from '@/components/layout/TopBar';
import { toast } from '@/hooks/use-toast';
import {
  useEmailSequences, useCreateEmailSequence, useUpdateEmailSequence,
  useDeleteEmailSequence, useSequenceEnrollments, useEnrollInSequence,
  useUnenrollFromSequence, useContacts,
} from '@/api/hooks';
import {
  Mail, Plus, Trash2, Pencil, Power, PowerOff, ChevronDown, ChevronUp,
  X, GripVertical, Users, CheckCircle2, Clock, XCircle, AlertCircle,
  PlayCircle, ListOrdered,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SequenceStep {
  delay_days: number;
  subject: string;
  body: string;
}

interface EmailSequence {
  id: string;
  name: string;
  description?: string;
  steps: SequenceStep[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface Enrollment {
  id: string;
  sequence_id: string;
  contact_id: string;
  current_step: number;
  status: 'active' | 'completed' | 'paused' | 'cancelled';
  next_send_at?: string;
  created_at: string;
  contact?: { first_name?: string; last_name?: string; email?: string };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const inputCls = 'w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';
const textareaCls = 'w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring resize-none';
const btnPrimary = 'px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors';
const btnOutline = 'px-3 py-1.5 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors';

const ENROLLMENT_STATUS: Record<string, { label: string; cls: string; icon: typeof Mail }> = {
  active:    { label: 'Active',    cls: 'text-blue-500 bg-blue-500/10 border-blue-500/20',          icon: PlayCircle },
  completed: { label: 'Completed', cls: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20', icon: CheckCircle2 },
  paused:    { label: 'Paused',    cls: 'text-amber-500 bg-amber-500/10 border-amber-500/20',       icon: Clock },
  cancelled: { label: 'Cancelled', cls: 'text-muted-foreground bg-muted border-border',             icon: XCircle },
};

function contactName(e: Enrollment): string {
  if (!e.contact) return e.contact_id.slice(0, 8);
  const name = [e.contact.first_name, e.contact.last_name].filter(Boolean).join(' ');
  return name || e.contact.email || e.contact_id.slice(0, 8);
}

// ─── Step Builder ─────────────────────────────────────────────────────────────

function StepBuilder({ steps, onChange }: { steps: SequenceStep[]; onChange: (s: SequenceStep[]) => void }) {
  const add = () => onChange([...steps, { delay_days: steps.length === 0 ? 0 : 3, subject: '', body: '' }]);
  const remove = (i: number) => onChange(steps.filter((_, idx) => idx !== i));
  const update = (i: number, patch: Partial<SequenceStep>) =>
    onChange(steps.map((s, idx) => idx === i ? { ...s, ...patch } : s));

  return (
    <div className="space-y-3">
      {steps.map((step, i) => (
        <div key={i} className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-b border-border">
            <GripVertical className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs font-semibold text-muted-foreground flex-1">
              Step {i + 1}
            </span>
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-muted-foreground">Delay</label>
              <input
                type="number"
                min={0}
                value={step.delay_days}
                onChange={e => update(i, { delay_days: parseInt(e.target.value) || 0 })}
                className="w-16 h-7 px-2 rounded border border-border bg-background text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
              />
              <span className="text-xs text-muted-foreground">days</span>
            </div>
            <button onClick={() => remove(i)} className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="p-3 space-y-2">
            <input
              type="text"
              placeholder="Email subject"
              value={step.subject}
              onChange={e => update(i, { subject: e.target.value })}
              className={inputCls}
            />
            <textarea
              placeholder="Email body (plain text or markdown)"
              value={step.body}
              onChange={e => update(i, { body: e.target.value })}
              rows={4}
              className={textareaCls}
            />
          </div>
        </div>
      ))}
      <button onClick={add} className="flex items-center gap-1.5 text-xs text-primary hover:underline">
        <Plus className="w-3.5 h-3.5" /> Add step
      </button>
      {steps.length === 0 && (
        <p className="text-xs text-muted-foreground">No steps yet. Add at least one email step.</p>
      )}
    </div>
  );
}

// ─── Enrollment Tab ───────────────────────────────────────────────────────────

function EnrollmentTab({ sequence }: { sequence: EmailSequence }) {
  const { data, isLoading } = useSequenceEnrollments({ sequence_id: sequence.id, limit: 50 }) as {
    data: { data: Enrollment[] } | undefined; isLoading: boolean;
  };
  const unenroll = useUnenrollFromSequence();
  const enrollMutation = useEnrollInSequence();
  const { data: contactsData } = useContacts({ limit: 100 }) as { data: { data: any[] } | undefined };
  const [contactId, setContactId] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const enrollments = data?.data ?? [];
  const contacts = contactsData?.data ?? [];
  const filtered = statusFilter === 'all' ? enrollments : enrollments.filter(e => e.status === statusFilter);

  const handleEnroll = async () => {
    if (!contactId) return;
    try {
      await enrollMutation.mutateAsync({ sequence_id: sequence.id, contact_id: contactId });
      setContactId('');
      toast({ title: 'Contact enrolled' });
    } catch (err: any) {
      toast({ title: err?.message ?? 'Enrollment failed', variant: 'destructive' });
    }
  };

  const handleUnenroll = async (id: string) => {
    try {
      await unenroll.mutateAsync(id);
      toast({ title: 'Enrollment cancelled' });
    } catch {
      toast({ title: 'Failed to cancel enrollment', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      {/* Quick enroll */}
      <div className="flex gap-2 items-end">
        <div className="flex-1 space-y-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Enroll Contact</label>
          <select value={contactId} onChange={e => setContactId(e.target.value)} className={inputCls}>
            <option value="">Select a contact…</option>
            {contacts.map((c: any) => {
              const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || c.id;
              return <option key={c.id} value={c.id}>{name}</option>;
            })}
          </select>
        </div>
        <button
          onClick={handleEnroll}
          disabled={!contactId || enrollMutation.isPending}
          className={`${btnPrimary} shrink-0`}
        >
          {enrollMutation.isPending ? 'Enrolling…' : 'Enroll'}
        </button>
      </div>

      {/* Status filter */}
      <div className="flex gap-1 flex-wrap">
        {['all', 'active', 'completed', 'paused', 'cancelled'].map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
              statusFilter === s ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
            {s === 'all' && enrollments.length > 0 && <span className="ml-1 opacity-60">{enrollments.length}</span>}
            {s !== 'all' && <span className="ml-1 opacity-60">{enrollments.filter(e => e.status === s).length}</span>}
          </button>
        ))}
      </div>

      {/* Enrollment list */}
      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No enrollments{statusFilter !== 'all' ? ` with status "${statusFilter}"` : ''}</p>
        </div>
      ) : (
        <div className="space-y-1">
          {filtered.map(e => {
            const cfg = ENROLLMENT_STATUS[e.status] ?? ENROLLMENT_STATUS.active;
            const Icon = cfg.icon;
            return (
              <div key={e.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border bg-card">
                <span className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-semibold shrink-0 ${cfg.cls}`}>
                  <Icon className="w-3 h-3" /> {cfg.label}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{contactName(e)}</p>
                  <p className="text-xs text-muted-foreground">
                    Step {e.current_step + 1} of {sequence.steps.length}
                    {e.next_send_at && ` · Next send ${new Date(e.next_send_at).toLocaleDateString()}`}
                  </p>
                </div>
                {e.status === 'active' && (
                  <button
                    onClick={() => handleUnenroll(e.id)}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                    title="Cancel enrollment"
                  >
                    <XCircle className="w-4 h-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Sequence Row ─────────────────────────────────────────────────────────────

function SequenceRow({ sequence, onDelete }: { sequence: EmailSequence; onDelete: () => void }) {
  const update = useUpdateEmailSequence(sequence.id);
  const del = useDeleteEmailSequence(sequence.id);
  const [tab, setTab] = useState<'steps' | 'enrollments'>('steps');
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [name, setName] = useState(sequence.name);
  const [description, setDescription] = useState(sequence.description ?? '');
  const [steps, setSteps] = useState<SequenceStep[]>(sequence.steps ?? []);

  const handleToggleActive = async () => {
    try {
      await update.mutateAsync({ patch: { is_active: !sequence.is_active } });
    } catch {
      toast({ title: 'Failed to update sequence', variant: 'destructive' });
    }
  };

  const handleSave = async () => {
    try {
      await update.mutateAsync({ patch: { name, description: description || undefined, steps } });
      setEditing(false);
      toast({ title: 'Sequence updated' });
    } catch {
      toast({ title: 'Failed to save sequence', variant: 'destructive' });
    }
  };

  const handleDelete = async () => {
    try {
      await del.mutateAsync();
      onDelete();
      toast({ title: 'Sequence deleted' });
    } catch {
      toast({ title: 'Failed to delete sequence', variant: 'destructive' });
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
          sequence.is_active ? 'bg-blue-500/15' : 'bg-muted'
        }`}>
          <Mail className={`w-4 h-4 ${sequence.is_active ? 'text-blue-500' : 'text-muted-foreground'}`} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground truncate">{sequence.name}</span>
            {!sequence.is_active && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">Inactive</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {sequence.steps.length} step{sequence.steps.length !== 1 ? 's' : ''}
            {sequence.description ? ` · ${sequence.description}` : ''}
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button onClick={handleToggleActive} title={sequence.is_active ? 'Deactivate' : 'Activate'}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors">
            {sequence.is_active
              ? <Power className="w-4 h-4 text-emerald-500" />
              : <PowerOff className="w-4 h-4" />
            }
          </button>
          <button onClick={() => { setEditing(!editing); setExpanded(true); }}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <Pencil className="w-4 h-4" />
          </button>
          <button onClick={() => setExpanded(!expanded)}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {!confirmDelete ? (
            <button onClick={() => setConfirmDelete(true)}
              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-destructive transition-colors">
              <Trash2 className="w-4 h-4" />
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <button onClick={handleDelete} className="text-xs font-semibold text-destructive hover:underline">Delete</button>
              <button onClick={() => setConfirmDelete(false)} className="p-1 text-muted-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Expanded panel */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border">
              {/* Tab bar */}
              <div className="flex border-b border-border px-4">
                {([['steps', 'Steps', ListOrdered], ['enrollments', 'Enrollments', Users]] as const).map(([key, label, Icon]) => (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
                      tab === key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                  </button>
                ))}
              </div>

              <div className="p-4 bg-muted/10 space-y-4">
                {tab === 'steps' ? (
                  editing ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Name</label>
                          <input type="text" value={name} onChange={e => setName(e.target.value)} className={inputCls} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Description</label>
                          <input type="text" value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional" className={inputCls} />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Steps</label>
                        <StepBuilder steps={steps} onChange={setSteps} />
                      </div>
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setEditing(false)} className={btnOutline}>Cancel</button>
                        <button onClick={handleSave} disabled={update.isPending || !name.trim()} className={btnPrimary}>
                          {update.isPending ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    sequence.steps.length === 0 ? (
                      <div className="text-center py-6 text-muted-foreground">
                        <ListOrdered className="w-6 h-6 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">No steps configured</p>
                        <button onClick={() => setEditing(true)} className="text-xs text-primary hover:underline mt-1">Add steps</button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {sequence.steps.map((step, i) => (
                          <div key={i} className="flex gap-3 items-start">
                            <div className="flex flex-col items-center shrink-0 pt-0.5">
                              <span className="w-5 h-5 rounded-full bg-primary/15 text-primary text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                              {i < sequence.steps.length - 1 && <div className="w-px flex-1 bg-border mt-1 min-h-[16px]" />}
                            </div>
                            <div className="flex-1 pb-2">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs font-semibold text-foreground">{step.subject || '(no subject)'}</span>
                                {step.delay_days > 0 && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                                    +{step.delay_days}d
                                  </span>
                                )}
                                {i === 0 && step.delay_days === 0 && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 border border-blue-500/20">
                                    Immediately
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{step.body || '(no body)'}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  )
                ) : (
                  <EnrollmentTab sequence={sequence} />
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Create Form ──────────────────────────────────────────────────────────────

function CreateSequenceForm({ onClose }: { onClose: () => void }) {
  const create = useCreateEmailSequence();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState<SequenceStep[]>([
    { delay_days: 0, subject: '', body: '' },
  ]);

  const handleCreate = async () => {
    if (!name.trim()) { toast({ title: 'Name is required', variant: 'destructive' }); return; }
    try {
      await create.mutateAsync({ name: name.trim(), description: description || undefined, steps });
      toast({ title: 'Sequence created' });
      onClose();
    } catch {
      toast({ title: 'Failed to create sequence', variant: 'destructive' });
    }
  };

  return (
    <div className="rounded-xl border border-primary/30 bg-card p-4 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Name</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Cold outreach — SaaS" className={inputCls} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Description</label>
          <input type="text" value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional" className={inputCls} />
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Steps</label>
        <StepBuilder steps={steps} onChange={setSteps} />
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className={btnOutline}>Cancel</button>
        <button onClick={handleCreate} disabled={create.isPending || !name.trim()} className={btnPrimary}>
          {create.isPending ? 'Creating…' : 'Create Sequence'}
        </button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function EmailSequencesPage() {
  const { data, isLoading } = useEmailSequences() as { data: { data: EmailSequence[] } | undefined; isLoading: boolean };
  const [showCreate, setShowCreate] = useState(false);
  const sequences = data?.data ?? [];
  const active = sequences.filter(s => s.is_active).length;

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Email Sequences"
        icon={Mail}
        iconClassName="text-blue-500"
        description={`${sequences.length} sequence${sequences.length !== 1 ? 's' : ''} · ${active} active`}
      >
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
        >
          {showCreate ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showCreate ? 'Cancel' : 'New Sequence'}
        </button>
      </TopBar>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-24 md:pb-6 space-y-4">
        {/* Create form */}
        <AnimatePresence>
          {showCreate && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <CreateSequenceForm onClose={() => setShowCreate(false)} />
            </motion.div>
          )}
        </AnimatePresence>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-xl bg-muted/50 animate-pulse" />)}
          </div>
        ) : sequences.length === 0 && !showCreate ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-blue-500/15 flex items-center justify-center mb-4">
              <Mail className="w-8 h-8 text-blue-500" />
            </div>
            <h2 className="text-lg font-display font-semibold text-foreground mb-1">No sequences yet</h2>
            <p className="text-sm text-muted-foreground max-w-xs mb-4">
              Create automated drip campaigns to nurture leads with timed email sequences.
            </p>
            <button onClick={() => setShowCreate(true)} className={btnPrimary}>
              <span className="flex items-center gap-1.5"><Plus className="w-4 h-4" /> Create your first sequence</span>
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {sequences.map(seq => (
              <SequenceRow key={seq.id} sequence={seq} onDelete={() => {}} />
            ))}
          </div>
        )}

        {/* Info callout */}
        {sequences.length > 0 && (
          <div className="rounded-xl border border-border bg-muted/30 p-4">
            <p className="text-xs font-semibold text-foreground mb-1">How sequences work</p>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
              <li>Enroll contacts manually or via agent actions using <code className="bg-muted px-1 rounded">email_sequence_enroll</code></li>
              <li>Step 1 with delay 0 days sends immediately upon enrollment</li>
              <li>Subsequent steps are queued at <strong className="text-foreground">enrolled_at + cumulative delay</strong></li>
              <li>Unenrolling cancels all pending sends — completed sends are preserved</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
