// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Select } from '../../components/ui/select';
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import {
  useUseCase, useAdvanceUseCaseStage, useSetConsumption, useSetHealth,
  useUseCaseContacts, useAddUseCaseContact, useRemoveUseCaseContact,
  useUseCaseTimeline,
} from '../../api/hooks';

const STAGES = ['discovery', 'poc', 'production', 'scaling', 'sunset'] as const;

function formatCurrency(cents?: number) {
  if (cents == null) return '$0';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100);
}

export function UseCaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useUseCase(id!);
  const { data: contactsData } = useUseCaseContacts(id!);
  const { data: timelineData } = useUseCaseTimeline(id!);
  const advanceStage = useAdvanceUseCaseStage(id!);
  const setConsumption = useSetConsumption(id!);
  const setHealth = useSetHealth(id!);
  const addContact = useAddUseCaseContact(id!);
  const removeContact = useRemoveUseCaseContact(id!);

  const [stageModal, setStageModal] = useState<string | null>(null);
  const [stageNote, setStageNote] = useState('');
  const [stageArr, setStageArr] = useState('');

  const [showConsumption, setShowConsumption] = useState(false);
  const [consCurrent, setConsCurrent] = useState('');
  const [consCapacity, setConsCapacity] = useState('');
  const [consLabel, setConsLabel] = useState('');

  const [showHealth, setShowHealth] = useState(false);
  const [healthScore, setHealthScore] = useState('');
  const [healthNote, setHealthNote] = useState('');

  const [showAddContact, setShowAddContact] = useState(false);
  const [newContactId, setNewContactId] = useState('');
  const [newContactRole, setNewContactRole] = useState('');

  const uc = (data as any)?.data ?? data;
  const contacts = (contactsData as any)?.data ?? [];
  const activities = (timelineData as any)?.data ?? (timelineData as any)?.activities ?? [];

  if (isLoading) return <p className="text-muted-foreground">Loading...</p>;
  if (!uc) return <p className="text-muted-foreground">Use case not found</p>;

  const pct = uc.consumption_capacity
    ? Math.round(((uc.consumption_current ?? 0) / uc.consumption_capacity) * 100)
    : null;

  const handleAdvance = async () => {
    if (!stageModal) return;
    await advanceStage.mutateAsync({
      stage: stageModal,
      note: stageNote || undefined,
      attributed_arr: stageArr ? Math.round(parseFloat(stageArr) * 100) : undefined,
    });
    setStageModal(null);
    setStageNote('');
    setStageArr('');
  };

  const handleConsumption = async () => {
    await setConsumption.mutateAsync({
      consumption_current: parseInt(consCurrent),
      consumption_capacity: consCapacity ? parseInt(consCapacity) : undefined,
      unit_label: consLabel || undefined,
    });
    setShowConsumption(false);
  };

  const handleHealth = async () => {
    await setHealth.mutateAsync({
      health_score: parseInt(healthScore),
      health_note: healthNote,
    });
    setShowHealth(false);
    setHealthScore('');
    setHealthNote('');
  };

  const handleAddContact = async () => {
    await addContact.mutateAsync({
      contact_id: newContactId,
      role: newContactRole || undefined,
    });
    setShowAddContact(false);
    setNewContactId('');
    setNewContactRole('');
  };

  return (
    <div className="space-y-6">
      {/* Stage bar */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-1">
            {STAGES.map((s, i) => (
              <button
                key={s}
                onClick={() => s !== uc.stage && setStageModal(s)}
                className={`flex-1 rounded-md px-3 py-2 text-center text-xs font-medium transition-colors ${
                  s === uc.stage
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-accent cursor-pointer'
                }`}
              >
                {s.replace('_', ' ')}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left panel */}
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-base">{uc.name}</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              {uc.description && <p className="text-muted-foreground">{uc.description}</p>}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Account</span>
                {uc.account_id ? (
                  <Link to={`/app/accounts/${uc.account_id}`} className="text-primary hover:underline">View</Link>
                ) : '—'}
              </div>
              {uc.opportunity_id && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Opportunity</span>
                  <Link to={`/app/opportunities/${uc.opportunity_id}`} className="text-primary hover:underline">View</Link>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Revenue */}
          <Card>
            <CardHeader><CardTitle className="text-base">Revenue</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Attributed ARR</span>
                <span className="font-semibold">{formatCurrency(uc.attributed_arr)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Expansion potential</span>
                <span>{formatCurrency(uc.expansion_potential)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Consumption */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Consumption</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => {
                  setConsCurrent(String(uc.consumption_current ?? ''));
                  setConsCapacity(String(uc.consumption_capacity ?? ''));
                  setConsLabel(uc.unit_label ?? '');
                  setShowConsumption(true);
                }}>Edit</Button>
              </div>
            </CardHeader>
            <CardContent>
              {pct != null ? (
                <div className="space-y-2">
                  <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                  <p className="text-sm">
                    <span className="font-semibold">{pct}%</span>
                    {' — '}
                    {(uc.consumption_current ?? 0).toLocaleString()} / {(uc.consumption_capacity ?? 0).toLocaleString()}
                    {uc.unit_label && ` ${uc.unit_label}`}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No consumption data</p>
              )}
            </CardContent>
          </Card>

          {/* Health */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Health</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => {
                  setHealthScore(String(uc.health_score ?? ''));
                  setHealthNote(uc.health_note ?? '');
                  setShowHealth(true);
                }}>Update</Button>
              </div>
            </CardHeader>
            <CardContent>
              {uc.health_score != null ? (
                <div className="space-y-1">
                  <Badge
                    variant={uc.health_score >= 70 ? 'success' : uc.health_score >= 40 ? 'warning' : 'danger'}
                    className="text-lg px-3 py-1"
                  >
                    {uc.health_score}
                  </Badge>
                  {uc.health_note && <p className="text-sm text-muted-foreground mt-1">{uc.health_note}</p>}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No health score set</p>
              )}
            </CardContent>
          </Card>

          {/* Contacts */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Contacts</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => setShowAddContact(true)}>+ Add</Button>
              </div>
            </CardHeader>
            <CardContent>
              {contacts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No contacts linked</p>
              ) : (
                <div className="space-y-2">
                  {contacts.map((c: any) => (
                    <div key={c.contact_id} className="flex items-center justify-between text-sm border-b pb-2">
                      <div className="flex items-center gap-2">
                        <Link to={`/app/contacts/${c.contact_id}`} className="text-primary hover:underline">
                          {c.contact?.first_name ?? ''} {c.contact?.last_name ?? c.contact_id}
                        </Link>
                        {c.role && <Badge variant="secondary">{c.role}</Badge>}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => removeContact.mutate(c.contact_id)}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right panel — Activity feed */}
        <div>
          <Card className="h-fit">
            <CardHeader><CardTitle className="text-base">Activity Timeline</CardTitle></CardHeader>
            <CardContent>
              {activities.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity yet</p>
              ) : (
                <div className="space-y-3">
                  {activities.map((a: any) => (
                    <div key={a.id} className="border-b pb-3 last:border-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{a.type ?? a.event_type}</Badge>
                        <time className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString()}</time>
                      </div>
                      <p className="mt-1 text-sm">{a.subject ?? a.event_type}</p>
                      {a.body && <p className="text-xs text-muted-foreground mt-0.5">{a.body}</p>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Stage advance modal */}
      <Dialog open={!!stageModal} onClose={() => setStageModal(null)}>
        <DialogHeader>
          <DialogTitle>Advance Stage</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground mb-4">
          {uc.stage?.replace('_', ' ')} → {stageModal?.replace('_', ' ')}
        </p>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">
              Note {stageModal === 'sunset' ? '(required)' : '(optional)'}
            </label>
            <Textarea value={stageNote} onChange={(e) => setStageNote(e.target.value)} required={stageModal === 'sunset'} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Update ARR ($, optional)</label>
            <Input type="number" step="0.01" value={stageArr} onChange={(e) => setStageArr(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setStageModal(null)}>Cancel</Button>
          <Button onClick={handleAdvance} disabled={advanceStage.isPending || (stageModal === 'sunset' && !stageNote)}>
            Advance Stage
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Consumption modal */}
      <Dialog open={showConsumption} onClose={() => setShowConsumption(false)}>
        <DialogHeader><DialogTitle>Edit Consumption</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Current</label>
            <Input type="number" value={consCurrent} onChange={(e) => setConsCurrent(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Capacity</label>
            <Input type="number" value={consCapacity} onChange={(e) => setConsCapacity(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Unit label</label>
            <Input value={consLabel} onChange={(e) => setConsLabel(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowConsumption(false)}>Cancel</Button>
          <Button onClick={handleConsumption} disabled={setConsumption.isPending}>Save</Button>
        </DialogFooter>
      </Dialog>

      {/* Health modal */}
      <Dialog open={showHealth} onClose={() => setShowHealth(false)}>
        <DialogHeader><DialogTitle>Update Health</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Score (0–100)</label>
            <Input type="number" min="0" max="100" value={healthScore} onChange={(e) => setHealthScore(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Note (required)</label>
            <Textarea value={healthNote} onChange={(e) => setHealthNote(e.target.value)} required />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowHealth(false)}>Cancel</Button>
          <Button onClick={handleHealth} disabled={setHealth.isPending || !healthNote}>Save</Button>
        </DialogFooter>
      </Dialog>

      {/* Add contact modal */}
      <Dialog open={showAddContact} onClose={() => setShowAddContact(false)}>
        <DialogHeader><DialogTitle>Add Contact</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Contact ID</label>
            <Input value={newContactId} onChange={(e) => setNewContactId(e.target.value)} placeholder="Paste contact UUID" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Role</label>
            <Select value={newContactRole} onChange={(e) => setNewContactRole(e.target.value)}>
              <option value="">None</option>
              <option value="champion">Champion</option>
              <option value="technical_lead">Technical Lead</option>
              <option value="economic_buyer">Economic Buyer</option>
              <option value="user">User</option>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowAddContact(false)}>Cancel</Button>
          <Button onClick={handleAddContact} disabled={addContact.isPending || !newContactId}>Add</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
