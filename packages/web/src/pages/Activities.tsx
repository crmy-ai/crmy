// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity as ActivityIcon,
  AlertCircle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileText,
  Link2,
  Loader2,
  NotebookText,
  RefreshCw,
  SlidersHorizontal,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { TopBar } from '@/components/layout/TopBar';
import { OnboardingEmptyState } from '@/components/crm/OnboardingEmptyState';
import { ActivityFeed } from '@/components/crm/CrmWidgets';
import { PaginationBar } from '@/components/crm/PaginationBar';
import { CompactList } from '@/components/crm/CompactList';
import { ListToolbar, type FilterConfig } from '@/components/crm/ListToolbar';
import {
  useActivities,
  useAddActivityContext,
  useAddMeetingArtifact,
  useCalendarConnections,
  useCalendarEvent,
  useCalendarEvents,
  useIgnoreCalendarEvent,
  useMeetingClassifications,
  useProcessCalendarEvent,
  useStartCalendarConnection,
  useSyncCalendarConnection,
} from '@/api/hooks';
import { useAppStore } from '@/store/appStore';
import { headerDescription } from '@/lib/headerCopy';
import { ENTITY_COLORS, STATUS_TONES } from '@/lib/entityColors';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';

type CustomerActivityTab = 'meetings' | 'needs_context' | 'calls_notes' | 'all' | 'connections';
type CalendarProvider = 'google' | 'microsoft';

type CalendarEvent = {
  id: string;
  title: string;
  starts_at: string;
  ends_at?: string | null;
  status: 'scheduled' | 'held' | 'cancelled' | 'ignored';
  classification: string;
  validation_status: string;
  validation_blockers?: string[];
  processing_status: string;
  processing_reason?: string | null;
  attendee_emails?: string[];
  attendee_names?: string[];
  account_id?: string | null;
  account_name?: string | null;
  contact_id?: string | null;
  contact_name?: string | null;
  opportunity_id?: string | null;
  opportunity_name?: string | null;
  use_case_id?: string | null;
  use_case_name?: string | null;
  meeting_url?: string | null;
  location?: string | null;
  extraction_receipt?: Record<string, unknown>;
  artifact_count?: number;
  transcript_count?: number;
  notes_count?: number;
};

const PAGE_SIZE = 50;
const ACTIVITY_BANNER_HIDDEN_KEY = 'crmy_customer_activity_banner_hidden';

const tabs: Array<{ key: CustomerActivityTab; label: string; icon: typeof CalendarClock }> = [
  { key: 'meetings', label: 'Meetings', icon: CalendarClock },
  { key: 'needs_context', label: 'Needs Context', icon: AlertCircle },
  { key: 'calls_notes', label: 'Calls & Notes', icon: NotebookText },
  { key: 'all', label: 'All Activity', icon: ActivityIcon },
  { key: 'connections', label: 'Connections', icon: SlidersHorizontal },
];

const CALENDAR_PROVIDER_COPY: Record<CalendarProvider, {
  label: string;
  title: string;
  description: string;
  credentialLabel: string;
  callbackPath: string;
}> = {
  google: {
    label: 'Google Calendar',
    title: 'Set up Google Calendar',
    description: 'Capture customer meetings from Google Workspace calendars and turn notes or transcripts into Signals and Memory.',
    credentialLabel: 'Google Cloud OAuth app',
    callbackPath: '/api/v1/calendar/oauth/google/callback',
  },
  microsoft: {
    label: 'Outlook Calendar',
    title: 'Set up Outlook Calendar',
    description: 'Sync customer meetings from Microsoft 365 calendars and keep missing meeting context visible.',
    credentialLabel: 'Microsoft Entra OAuth app',
    callbackPath: '/api/v1/calendar/oauth/microsoft/callback',
  },
};

const validationCopy: Record<string, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  ready: { label: 'Ready for context processing', className: 'border-green-500/30 bg-green-500/10 text-green-200', icon: CheckCircle2 },
  missing_context: { label: 'Missing transcript or notes', className: 'border-amber-500/30 bg-amber-500/10 text-amber-200', icon: AlertCircle },
  needs_record_link: { label: 'Needs customer record link', className: 'border-blue-500/30 bg-blue-500/10 text-blue-200', icon: Link2 },
  needs_review: { label: 'Needs review', className: STATUS_TONES.warning, icon: AlertCircle },
  skipped_internal: { label: 'Skipped internal meeting', className: STATUS_TONES.muted, icon: CheckCircle2 },
  failed: { label: 'Processing failed', className: STATUS_TONES.destructive, icon: AlertCircle },
};

const processingCopy: Record<string, { label: string; className: string }> = {
  unprocessed: { label: 'Not processed', className: STATUS_TONES.muted },
  processing: { label: 'Processing', className: STATUS_TONES.info },
  processed: { label: 'Processed', className: STATUS_TONES.success },
  needs_review: { label: 'Needs review', className: STATUS_TONES.warning },
  skipped: { label: 'Skipped', className: STATUS_TONES.muted },
  failed: { label: 'Failed', className: STATUS_TONES.destructive },
  ignored: { label: 'Ignored', className: STATUS_TONES.muted },
};

const connectionCopy: Record<string, { label: string; description: string; className: string }> = {
  configuration_required: {
    label: 'Setup needed',
    description: 'OAuth app credentials are not configured yet.',
    className: STATUS_TONES.warning,
  },
  connected: {
    label: 'Connected',
    description: 'Calendar sync is available.',
    className: STATUS_TONES.success,
  },
  syncing: {
    label: 'Syncing',
    description: 'CRMy is catching up calendar events.',
    className: STATUS_TONES.info,
  },
  error: {
    label: 'Needs attention',
    description: 'The last sync failed.',
    className: STATUS_TONES.destructive,
  },
  disconnected: {
    label: 'Disconnected',
    description: 'Reconnect to resume sync.',
    className: STATUS_TONES.muted,
  },
};

function formatWhen(value?: string | null) {
  if (!value) return 'No date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No date';
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function meetingRecord(event: CalendarEvent): { type: string; id?: string | null; name?: string | null } {
  if (event.opportunity_id) return { type: 'opportunity', id: event.opportunity_id, name: event.opportunity_name };
  if (event.use_case_id) return { type: 'use-case', id: event.use_case_id, name: event.use_case_name };
  if (event.contact_id) return { type: 'contact', id: event.contact_id, name: event.contact_name };
  if (event.account_id) return { type: 'account', id: event.account_id, name: event.account_name };
  return { type: 'record', name: 'No linked record' };
}

function countFromReceipt(event: CalendarEvent, key: 'signals_created' | 'memory_created') {
  const receipt = event.extraction_receipt ?? {};
  const direct = receipt[key];
  if (typeof direct === 'number') return direct;
  const extracted = receipt.extraction;
  if (extracted && typeof extracted === 'object' && key in extracted && typeof (extracted as Record<string, unknown>)[key] === 'number') {
    return (extracted as Record<string, number>)[key];
  }
  return 0;
}

function MeetingCard({
  event,
  onOpen,
  onProcess,
  onAddContext,
  onOpenRecord,
  processing,
}: {
  event: CalendarEvent;
  onOpen: (id: string) => void;
  onProcess: (id: string) => void;
  onAddContext: (id: string) => void;
  onOpenRecord: (event: CalendarEvent) => void;
  processing: boolean;
}) {
  const validation = validationCopy[event.validation_status] ?? validationCopy.needs_review;
  const process = processingCopy[event.processing_status] ?? processingCopy.unprocessed;
  const record = meetingRecord(event);
  const signals = countFromReceipt(event, 'signals_created');
  const memory = countFromReceipt(event, 'memory_created');
  const artifactCount = Number(event.artifact_count ?? 0);

  let cta: { label: string; action: () => void; variant: 'default' | 'outline' } = {
    label: 'Open Meeting',
    action: () => onOpen(event.id),
    variant: 'outline',
  };
  if (event.validation_status === 'missing_context') {
    cta = { label: 'Add Context', action: () => onAddContext(event.id), variant: 'default' as const };
  } else if (event.validation_status === 'needs_record_link') {
    cta = { label: 'Link Record', action: () => onOpen(event.id), variant: 'outline' as const };
  } else if (event.processing_status === 'processed' && signals > 0) {
    cta = { label: 'Review Signals', action: () => { window.location.href = '/app/context?tab=signals'; }, variant: 'outline' as const };
  } else if (event.validation_status === 'ready' && event.processing_status !== 'processed') {
    cta = { label: 'Process Context', action: () => onProcess(event.id), variant: 'default' as const };
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(event.id)}
      className="w-full text-left rounded-xl border border-border bg-card p-4 hover:border-blue-500/30 hover:bg-muted/30 transition-colors"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-blue-500/25 bg-blue-500/10 text-blue-200">
              {event.classification?.replace(/_/g, ' ') || 'Unknown'}
            </Badge>
            <Badge variant="outline" className={validation.className}>
              <validation.icon className="mr-1 h-3 w-3" />
              {validation.label}
            </Badge>
            <Badge variant="outline" className={process.className}>{process.label}</Badge>
          </div>
          <h3 className="font-display text-base font-semibold text-foreground">{event.title}</h3>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{formatWhen(event.starts_at)}</span>
            <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{event.attendee_emails?.length ?? 0} attendees</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onOpenRecord(event); }}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-foreground hover:border-blue-500/40"
            >
              <Link2 className="h-3 w-3" />
              {record.type.replace('-', ' ')} · {record.name ?? 'Unnamed'}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          <span className="rounded-lg bg-muted px-2.5 py-1 text-xs text-muted-foreground">{artifactCount} artifacts</span>
          <span className="rounded-lg bg-purple-500/10 px-2.5 py-1 text-xs text-purple-200">{signals} Signals</span>
          <span className="rounded-lg bg-green-500/10 px-2.5 py-1 text-xs text-green-200">{memory} Memory</span>
          <Button
            size="sm"
            variant={cta.variant}
            disabled={processing}
            className={cta.variant === 'default' ? 'bg-blue-600 text-white hover:bg-blue-500' : ''}
            onClick={(e) => {
              e.stopPropagation();
              cta.action();
            }}
          >
            {processing && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {cta.label}
          </Button>
        </div>
      </div>
    </button>
  );
}

function ActivityTable({
  activities,
  page,
  pageSize,
  total,
  onPageChange,
  onOpen,
  onAddContext,
}: {
  activities: Array<Record<string, any>>;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onOpen: (id: string) => void;
  onAddContext: (activity: Record<string, any>) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <table className="w-full text-left">
        <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Activity</th>
            <th className="hidden px-4 py-3 font-medium md:table-cell">Type</th>
            <th className="hidden px-4 py-3 font-medium lg:table-cell">Linked record</th>
            <th className="hidden px-4 py-3 font-medium md:table-cell">Outcome</th>
            <th className="px-4 py-3 font-medium">When</th>
            <th className="px-4 py-3 font-medium"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {activities.map(activity => {
            const id = String(activity.id ?? '');
            const title = String(activity.subject ?? activity.body ?? 'Untitled activity');
            const body = String(activity.body ?? activity.description ?? '');
            const subjectType = String(activity.subject_type ?? '').replace(/_/g, ' ');
            const linkedName = String(activity.contact_name ?? activity.account_name ?? activity.opportunity_name ?? activity.use_case_name ?? '');
            return (
              <tr key={id} onClick={() => onOpen(id)} className="cursor-pointer bg-card transition-colors hover:bg-muted/35">
                <td className="min-w-0 px-4 py-3">
                  <p className="truncate text-sm font-semibold text-foreground">{title}</p>
                  {body && <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{body}</p>}
                </td>
                <td className="hidden px-4 py-3 md:table-cell">
                  <Badge variant="outline" className={STATUS_TONES.muted}>{String(activity.type ?? 'activity').replace(/_/g, ' ')}</Badge>
                </td>
                <td className="hidden px-4 py-3 text-sm text-muted-foreground lg:table-cell">
                  {subjectType ? `${subjectType}${linkedName ? ` · ${linkedName}` : ''}` : 'No linked record'}
                </td>
                <td className="hidden px-4 py-3 text-sm text-muted-foreground md:table-cell">
                  {String(activity.outcome ?? '').replace(/_/g, ' ') || '-'}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-muted-foreground">
                  {formatWhen(String(activity.occurred_at ?? activity.created_at ?? ''))}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  {!body.trim() && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        onAddContext(activity);
                      }}
                    >
                      Add Debrief
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <PaginationBar page={page} pageSize={pageSize} total={total} onPageChange={onPageChange} />
    </div>
  );
}

function CalendarSetupStep({
  active,
  index,
  label,
}: {
  active: boolean;
  index: number;
  label: string;
}) {
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs ${
      active ? 'border-blue-500/35 bg-blue-500/10 text-blue-200' : 'border-border bg-muted/20 text-muted-foreground'
    }`}
    >
      <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${
        active ? 'bg-blue-500 text-white' : 'bg-muted text-muted-foreground'
      }`}
      >
        {index + 1}
      </span>
      {label}
    </div>
  );
}

function CalendarConnectionCard({
  connection,
  onSync,
  onSetup,
  syncing,
}: {
  connection: Record<string, any>;
  onSync: (id: string) => void;
  onSetup: (provider: CalendarProvider, connection?: Record<string, any>) => void;
  syncing: boolean;
}) {
  const connected = connection.status === 'connected';
  const provider = CALENDAR_PROVIDER_COPY[connection.provider as CalendarProvider] ?? CALENDAR_PROVIDER_COPY.google;
  const status = connectionCopy[connection.status] ?? connectionCopy.configuration_required;
  return (
    <div className="rounded-xl border border-border bg-card/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CalendarClock className={`h-4 w-4 ${connected ? 'text-emerald-400' : 'text-blue-300'}`} />
            <h3 className="text-sm font-semibold text-foreground">{provider.label}</h3>
            <Badge variant="outline" className={status.className}>{status.label}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{connection.email_address}</p>
        </div>
        {connected ? (
          <Button variant="outline" size="sm" onClick={() => onSync(connection.id)} disabled={syncing} className="gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} /> Sync
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => onSetup(connection.provider as CalendarProvider, connection)} className="gap-1.5">
            <SlidersHorizontal className="h-3.5 w-3.5" /> Setup guide
          </Button>
        )}
      </div>
      <div className="mt-3 space-y-1 text-xs text-muted-foreground">
        {connection.sync_stats && Object.keys(connection.sync_stats).length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            <span className="rounded-md border border-blue-500/20 bg-blue-500/8 px-2 py-0.5 text-blue-200">
              {connection.sync_stats.customer_synced ?? 0} customer synced
            </span>
            <span className="rounded-md border border-border bg-muted/20 px-2 py-0.5">
              {connection.sync_stats.filtered_internal ?? 0} internal skipped
            </span>
            <span className="rounded-md border border-border bg-muted/20 px-2 py-0.5">
              {connection.sync_stats.filtered_unknown ?? 0} unmatched skipped
            </span>
          </div>
        )}
        {!connected && (
          <p>
            Live sync is waiting for provider setup. The guide shows calendar scope, customer meeting filtering, and OAuth steps.
          </p>
        )}
        {connection.last_sync_at
          ? <p>{`Last sync ${new Date(connection.last_sync_at).toLocaleString()}`}</p>
          : <p>{connection.last_error || 'OAuth credentials are required before live calendar sync can run.'}</p>}
      </div>
    </div>
  );
}

function CalendarConnectionsPanel({
  connections,
  summary,
  onSetup,
  onSync,
  syncingId,
}: {
  connections: Array<Record<string, any>>;
  summary?: Record<string, number>;
  onSetup: (provider: CalendarProvider, connection?: Record<string, any>) => void;
  onSync: (id: string) => void;
  syncingId?: string | null;
}) {
  const providers = [
    { provider: 'google' as const, title: 'Set up Google Calendar', description: 'Guided setup for customer meeting capture from Google Workspace calendars.' },
    { provider: 'microsoft' as const, title: 'Set up Outlook Calendar', description: 'Guided setup for customer meeting capture from Microsoft 365 calendars.' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Customer meetings</p>
          <p className="mt-1 text-2xl font-display font-semibold text-foreground">{summary?.meetings ?? 0}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Needs context</p>
          <p className="mt-1 text-2xl font-display font-semibold text-foreground">{summary?.needs_context ?? 0}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Processed</p>
          <p className="mt-1 text-2xl font-display font-semibold text-foreground">{summary?.processed ?? 0}</p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {providers.map((provider) => {
          return (
            <button
              key={provider.provider}
              type="button"
              onClick={() => onSetup(provider.provider)}
              className="rounded-xl border border-border bg-card/70 p-4 text-left hover:bg-muted/35"
            >
              <CalendarClock className="h-5 w-5 text-blue-300" />
              <h3 className="mt-3 text-sm font-semibold text-foreground">{provider.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{provider.description}</p>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-blue-300">
                Open setup guide <ArrowRight className="h-3 w-3" />
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {connections.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground md:col-span-2">
            No calendar connections yet. Set up Google Calendar or Outlook Calendar to start capturing customer meetings.
          </div>
        ) : connections.map(connection => (
          <CalendarConnectionCard
            key={connection.id}
            connection={connection}
            onSync={onSync}
            onSetup={onSetup}
            syncing={syncingId === connection.id}
          />
        ))}
      </div>
    </div>
  );
}

function MeetingDetailDrawer({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { openDrawer } = useAppStore();
  const { data, isLoading } = useCalendarEvent(id) as any;
  const addArtifact = useAddMeetingArtifact();
  const processEvent = useProcessCalendarEvent();
  const ignoreEvent = useIgnoreCalendarEvent();
  const [artifactType, setArtifactType] = useState('notes');
  const [artifactText, setArtifactText] = useState('');

  if (!id) return null;
  const event = data?.calendar_event as CalendarEvent | undefined;
  const artifacts = (data?.artifacts ?? []) as Array<Record<string, any>>;
  const validation = event ? validationCopy[event.validation_status] ?? validationCopy.needs_review : validationCopy.needs_review;
  const record = event ? meetingRecord(event) : null;

  const submitArtifact = async () => {
    if (!event || !artifactText.trim()) return;
    try {
      await addArtifact.mutateAsync({
        id: event.id,
        artifact_type: artifactType,
        text_content: artifactText.trim(),
        source_label: `${event.title} ${artifactType}`,
        process: true,
      });
      setArtifactText('');
      toast({ title: 'Meeting context added', description: 'CRMy processed this meeting artifact as Raw Context.' });
    } catch (err) {
      toast({ title: 'Could not add context', description: err instanceof Error ? err.message : 'Try again.', variant: 'destructive' });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-background/40 backdrop-blur-sm">
      <button type="button" className="flex-1" aria-label="Close meeting details" onClick={onClose} />
      <aside className="h-full w-full max-w-2xl overflow-y-auto border-l border-border bg-background shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-5 py-4 backdrop-blur">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-300">Meeting</p>
            <h2 className="truncate font-display text-lg font-semibold text-foreground">{event?.title ?? 'Meeting details'}</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        {isLoading || !event ? (
          <div className="p-5 space-y-3">
            {[...Array(5)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-muted/50 animate-pulse" />)}
          </div>
        ) : (
          <div className="space-y-5 p-5">
            <section className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-blue-500/25 bg-blue-500/10 text-blue-200">{event.classification}</Badge>
                <Badge variant="outline" className={validation.className}>{validation.label}</Badge>
                <Badge variant="outline" className={processingCopy[event.processing_status]?.className ?? STATUS_TONES.muted}>
                  {processingCopy[event.processing_status]?.label ?? event.processing_status}
                </Badge>
              </div>
              <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">When</dt>
                  <dd className="text-foreground">{formatWhen(event.starts_at)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Linked record</dt>
                  <dd>
                    {record?.id ? (
                      <button
                        type="button"
                        className="text-blue-200 hover:underline"
                        onClick={() => openDrawer(record.type as any, record.id as string)}
                      >
                        {record.type.replace('-', ' ')} · {record.name}
                      </button>
                    ) : (
                      <span className="text-muted-foreground">No linked record</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Attendees</dt>
                  <dd className="text-foreground">{(event.attendee_emails ?? []).slice(0, 4).join(', ') || 'No attendees captured'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Meeting URL</dt>
                  <dd className="truncate text-foreground">{event.meeting_url ?? 'Not captured'}</dd>
                </div>
              </dl>
              {event.validation_blockers?.length ? (
                <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3">
                  <p className="text-xs font-medium text-foreground">Validation blockers</p>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                    {event.validation_blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
                  </ul>
                </div>
              ) : null}
            </section>

            <section className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-sm font-semibold text-foreground">Transcript or notes</h3>
                  <p className="text-xs text-muted-foreground">Add meeting notes, a transcript, or a recap. CRMy processes it as Raw Context.</p>
                </div>
                <Badge variant="outline" className={STATUS_TONES.muted}>{artifacts.length} artifacts</Badge>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {['notes', 'transcript', 'summary'].map(type => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setArtifactType(type)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${artifactType === type ? 'bg-blue-600 text-white' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
                  >
                    {type}
                  </button>
                ))}
              </div>
              <Textarea
                value={artifactText}
                onChange={(e) => setArtifactText(e.target.value)}
                placeholder="Paste meeting notes or transcript..."
                className="mt-3 min-h-32"
              />
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button variant="outline" onClick={() => processEvent.mutate(event.id, {
                  onSuccess: () => toast({ title: 'Meeting processed' }),
                  onError: (err) => toast({ title: 'Could not process meeting', description: err instanceof Error ? err.message : 'Try again.', variant: 'destructive' }),
                })}>
                  Process existing context
                </Button>
                <Button disabled={!artifactText.trim() || addArtifact.isPending} onClick={submitArtifact} className="bg-blue-600 text-white hover:bg-blue-500">
                  {addArtifact.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Add Context
                </Button>
              </div>
            </section>

            <section className="rounded-xl border border-border bg-card p-4">
              <h3 className="font-display text-sm font-semibold text-foreground">Artifacts</h3>
              <div className="mt-3 space-y-2">
                {artifacts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No transcript, notes, or recap has been attached yet.</p>
                ) : artifacts.map((artifact) => (
                  <div key={artifact.id} className="rounded-lg border border-border bg-muted/30 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-foreground">{artifact.source_label ?? artifact.artifact_type}</span>
                      <Badge variant="outline" className={processingCopy[artifact.processing_status]?.className ?? STATUS_TONES.muted}>
                        {processingCopy[artifact.processing_status]?.label ?? artifact.processing_status}
                      </Badge>
                    </div>
                    {artifact.text_excerpt && <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">{artifact.text_excerpt}</p>}
                  </div>
                ))}
              </div>
            </section>

            <section className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => navigate('/app/context?tab=observations&add=context')}>
                <Upload className="mr-1.5 h-3.5 w-3.5" />
                Add Context page
              </Button>
              <Button variant="outline" onClick={() => ignoreEvent.mutate({ id: event.id, reason: 'Ignored from Customer Activity.' }, {
                onSuccess: () => { toast({ title: 'Meeting ignored' }); onClose(); },
              })}>
                Ignore
              </Button>
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}

export default function Activities() {
  const navigate = useNavigate();
  const { openQuickAdd, openDrawer } = useAppStore();
  const [tab, setTab] = useState<CustomerActivityTab>('meetings');
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({});
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [setupProvider, setSetupProvider] = useState<CalendarProvider | null>(null);
  const [setupStep, setSetupStep] = useState(0);
  const [setupEmail, setSetupEmail] = useState('');
  const [setupDisplayName, setSetupDisplayName] = useState('');
  const [debriefActivity, setDebriefActivity] = useState<Record<string, any> | null>(null);
  const [debriefText, setDebriefText] = useState('');
  const [page, setPage] = useState(1);
  const [bannerHidden, setBannerHidden] = useState(() => {
    try {
      return localStorage.getItem(ACTIVITY_BANNER_HIDDEN_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const startGoogle = useStartCalendarConnection('google');
  const startMicrosoft = useStartCalendarConnection('microsoft');
  const syncConnection = useSyncCalendarConnection();
  const processEvent = useProcessCalendarEvent();
  const addActivityContext = useAddActivityContext();
  const classificationsQ = useMeetingClassifications() as any;
  const meetingClassificationOptions = ((classificationsQ.data?.data ?? []) as Array<any>).map(classification => ({
    value: classification.type_name,
    label: classification.label ?? classification.type_name,
  }));
  const meetingFilterConfigs: FilterConfig[] = [
    { key: 'classification', label: 'Type', options: meetingClassificationOptions },
    {
      key: 'validation_status',
      label: 'Status',
      options: [
        { value: 'ready', label: 'Ready' },
        { value: 'missing_context', label: 'Missing context' },
        { value: 'needs_record_link', label: 'Needs record link' },
        { value: 'needs_review', label: 'Needs review' },
        { value: 'failed', label: 'Failed' },
      ],
    },
  ].filter(filter => filter.options.length > 0);
  const activityFilterConfigs: FilterConfig[] = [
    {
      key: 'type',
      label: 'Type',
      options: [
        { value: 'call', label: 'Call' },
        { value: 'note', label: 'Note' },
        { value: 'task', label: 'Task' },
        { value: 'research', label: 'Research' },
        { value: 'outreach_call', label: 'Outbound call' },
      ],
    },
  ];
  const currentFilterConfigs = tab === 'meetings' || tab === 'needs_context' ? meetingFilterConfigs : tab === 'connections' ? [] : activityFilterConfigs;
  const handleFilterChange = (key: string, values: string[]) => {
    setActiveFilters(prev => {
      const next = { ...prev };
      if (values.length === 0) delete next[key]; else next[key] = values;
      return next;
    });
  };

  const calendarTab = tab === 'calls_notes' || tab === 'connections' ? 'meetings' : tab;
  const calendarQ = useCalendarEvents({
    tab: calendarTab === 'all' ? 'all' : calendarTab,
    q: search,
    classification: activeFilters.classification?.[0],
    validation_status: activeFilters.validation_status?.[0],
    limit: 100,
  }) as any;
  const connectionsQ = useCalendarConnections() as any;
  const activitiesQ = useActivities({ limit: 200 }) as any;

  const meetings: CalendarEvent[] = calendarQ.data?.data ?? [];
  const summary = calendarQ.data?.summary ?? connectionsQ.data?.summary;
  const connections = connectionsQ.data?.data ?? [];
  const calendarConnected = connections.some((connection: any) => connection.status === 'connected');
  const allActivities = activitiesQ.data?.data ?? [];
  const activityRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allActivities.filter((activity: any) => {
      const type = String(activity.type ?? '');
      const isCallOrNote = ['call', 'note', 'task', 'research', 'note_added', 'outreach_call'].includes(type);
      if (tab === 'calls_notes' && !isCallOrNote) return false;
      if (activeFilters.type?.length && !activeFilters.type.includes(type)) return false;
      if (!q) return true;
      return String(activity.description ?? activity.body ?? activity.subject ?? '').toLowerCase().includes(q)
        || String(activity.outcome ?? '').toLowerCase().includes(q)
        || String(activity.contact_name ?? '').toLowerCase().includes(q);
    });
  }, [allActivities, search, tab, activeFilters]);
  const paginatedActivities = activityRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const openRecord = (event: CalendarEvent) => {
    const record = meetingRecord(event);
    if (record.id) openDrawer(record.type as any, record.id);
    else setSelectedMeetingId(event.id);
  };

  const setupCopy = setupProvider ? CALENDAR_PROVIDER_COPY[setupProvider] : null;
  const setupSaving = startGoogle.isPending || startMicrosoft.isPending;

  const openSetup = (provider: CalendarProvider, connection?: Record<string, any>) => {
    setSetupProvider(provider);
    setSetupStep(0);
    setSetupEmail(String(connection?.email_address ?? ''));
    setSetupDisplayName(String(connection?.display_name ?? ''));
  };

  const closeSetup = () => {
    setSetupProvider(null);
    setSetupStep(0);
    setSetupEmail('');
    setSetupDisplayName('');
  };

  const nextSetupStep = () => {
    if (setupStep === 0 && !setupEmail.trim().includes('@')) {
      toast({ title: 'Calendar email required', description: 'Enter the Google or Outlook calendar CRMy should watch.', variant: 'destructive' });
      return;
    }
    setSetupStep(step => Math.min(step + 1, 3));
  };

  const saveCalendarSetup = async () => {
    if (!setupProvider) return;
    if (!setupEmail.trim().includes('@')) {
      toast({ title: 'Calendar email required', description: 'Enter a valid calendar email before saving setup.', variant: 'destructive' });
      return;
    }
    const payload = {
      email_address: setupEmail.trim().toLowerCase(),
      display_name: setupDisplayName.trim(),
    };
    try {
      const result = await (setupProvider === 'google' ? startGoogle : startMicrosoft).mutateAsync(payload) as any;
      if (result?.auth_url) {
        window.location.assign(result.auth_url);
        return;
      }
      toast({
        title: `${CALENDAR_PROVIDER_COPY[setupProvider].label} setup saved`,
        description: 'CRMy saved the calendar and setup steps. Complete OAuth credentials before live sync runs.',
      });
      setTab('connections');
      closeSetup();
    } catch (err) {
      toast({ title: 'Calendar setup failed', description: err instanceof Error ? err.message : 'Try again.', variant: 'destructive' });
    }
  };

  const hideBanner = () => {
    setBannerHidden(true);
    try {
      localStorage.setItem(ACTIVITY_BANNER_HIDDEN_KEY, 'true');
    } catch {
      // Ignore storage failures; the current session can still hide it.
    }
  };

  return (
    <div className="flex h-full flex-col">
      <TopBar
        title="Customer Activity"
        icon={ActivityIcon}
        iconClassName={ENTITY_COLORS.activities.text}
        description={headerDescription('Turn meetings, calls, notes, and transcripts into Signals and Memory', Number(summary?.total ?? activityRows.length), 'activity', 'activities')}
      />

      <div className="border-b border-border px-4 pt-4 md:px-6">
        {!bannerHidden && (
          <div className="mb-4 rounded-xl border border-blue-500/20 bg-blue-500/8 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <CalendarClock className="h-4 w-4 text-blue-300" />
                  <p className="text-sm font-semibold text-foreground">Customer activities can become Signals and Memory</p>
                  <button
                    type="button"
                    onClick={hideBanner}
                    className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
                    aria-label="Hide activity context message"
                    title="Hide message"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                  Connect your calendar when you want customer meetings auto matched to customer records and flagged when notes, transcripts, or debriefs are missing. This is optional: meeting transcripts and call notes can still feed context and agent memory through{' '}
                  <button
                    type="button"
                    onClick={() => navigate('/context?tab=observations&add=context')}
                    className="font-medium text-blue-300 underline-offset-2 hover:underline"
                  >
                    Add Context
                  </button>
                  {' '}or MCP (<code className="font-mono text-xs text-foreground">context_ingest_auto</code>).
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {!calendarConnected && (
                  <>
                    <Button variant="ghost" onClick={() => navigate('/context?tab=sources')}>View Sources</Button>
                    <Button variant="outline" onClick={() => setTab('connections')}>Connect calendar</Button>
                  </>
                )}
                {calendarConnected && (
                  <Button className="shrink-0" variant="ghost" onClick={() => navigate('/context?tab=sources')}>View Sources</Button>
                )}
                <button
                  type="button"
                  onClick={hideBanner}
                  className="hidden h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:inline-flex"
                  aria-label="Hide activity context message"
                  title="Hide message"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {tabs.map(item => {
            const Icon = item.icon;
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => { setTab(item.key); setPage(1); setActiveFilters({}); }}
                className={`inline-flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
                  active
                    ? 'border-blue-500 text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
                {item.key === 'needs_context' && Number(summary?.needs_context ?? 0) > 0 && (
                  <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-200">{summary?.needs_context}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {tab !== 'connections' && (
        <ListToolbar
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search customer activity..."
          filters={currentFilterConfigs}
          activeFilters={activeFilters}
          onFilterChange={handleFilterChange}
          onClearFilters={() => setActiveFilters({})}
          sortOptions={[]}
          currentSort={null}
          onSortChange={() => undefined}
          entityType="activities"
          onAdd={() => openQuickAdd('activity')}
          addLabel="Log Activity"
        />
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4 pb-24 md:px-6 md:pb-6">
        {tab === 'connections' ? (
          <CalendarConnectionsPanel
            connections={connections}
            summary={connectionsQ.data?.summary}
            onSetup={openSetup}
            onSync={(id) => syncConnection.mutate(id, { onSuccess: () => toast({ title: 'Calendar sync queued' }) })}
            syncingId={syncConnection.variables ?? null}
          />
        ) : tab === 'calls_notes' || tab === 'all' ? (
          activitiesQ.isLoading ? (
            <div className="space-y-3">
              {[...Array(6)].map((_, i) => <div key={i} className="h-12 rounded-xl bg-muted/50 animate-pulse" />)}
            </div>
          ) : activityRows.length === 0 ? (
            <OnboardingEmptyState
              icon={FileText}
              title={tab === 'calls_notes' ? 'No calls or notes yet' : 'No activity yet'}
              description="Log manual calls, notes, and off-calendar meetings when they do not come from calendar or email."
              showSampleData={false}
              iconClassName={ENTITY_COLORS.activities.text}
              iconBgClassName={ENTITY_COLORS.activities.bg}
            />
          ) : tab === 'calls_notes' ? (
            <ActivityTable
              activities={paginatedActivities}
              page={page}
              pageSize={PAGE_SIZE}
              total={activityRows.length}
              onPageChange={setPage}
              onOpen={(id) => openDrawer('activity', id)}
              onAddContext={(activity) => {
                setDebriefActivity(activity);
                setDebriefText('');
              }}
            />
          ) : (
            <CompactList className="p-4">
              <ActivityFeed activities={paginatedActivities} />
              <PaginationBar page={page} pageSize={PAGE_SIZE} total={activityRows.length} onPageChange={setPage} />
            </CompactList>
          )
        ) : calendarQ.isLoading ? (
          <div className="space-y-3">
            {[...Array(6)].map((_, i) => <div key={i} className="h-24 rounded-xl bg-muted/50 animate-pulse" />)}
          </div>
        ) : meetings.length === 0 ? (
          <OnboardingEmptyState
            icon={CalendarClock}
            title={tab === 'needs_context' ? 'No meetings need context' : 'No customer meetings yet'}
            description={tab === 'needs_context'
              ? 'Meetings that need transcripts, notes, or record links will appear here.'
              : 'Connect a calendar or log a meeting manually to start capturing customer context.'}
            showSampleData={false}
            iconClassName="text-blue-300"
            iconBgClassName="bg-blue-500/10"
          />
        ) : (
          <div className="space-y-3">
            {meetings.map(event => (
              <MeetingCard
                key={event.id}
                event={event}
                onOpen={setSelectedMeetingId}
                onOpenRecord={openRecord}
                onAddContext={setSelectedMeetingId}
                onProcess={(id) => processEvent.mutate(id, {
                  onSuccess: () => toast({ title: 'Meeting processed', description: 'CRMy processed available meeting context.' }),
                  onError: (err) => toast({ title: 'Could not process meeting', description: err instanceof Error ? err.message : 'Try again.', variant: 'destructive' }),
                })}
                processing={processEvent.isPending && processEvent.variables === event.id}
              />
            ))}
          </div>
        )}

        {tab === 'meetings' && (classificationsQ.data?.data?.length ?? 0) > 0 && (
          <div className="mt-5 rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            Classifications are customizable in Settings: {(classificationsQ.data.data as Array<any>).slice(0, 6).map(c => c.label).join(', ')}
            {(classificationsQ.data.data.length > 6) ? ', ...' : ''}.
            <button type="button" onClick={() => navigate('/app/settings/registries')} className="ml-2 text-blue-200 hover:underline">
              Manage classifications
            </button>
          </div>
        )}
      </div>

      <Dialog open={Boolean(setupProvider)} onOpenChange={(open) => { if (!open) closeSetup(); }}>
        {setupProvider && setupCopy && (
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CalendarClock className="h-5 w-5 text-blue-500" /> {setupCopy.title}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{setupCopy.description}</p>
              <div className="grid gap-2 md:grid-cols-4">
                {['Calendar', 'Customer meetings', 'Provider setup', 'Review'].map((label, index) => (
                  <CalendarSetupStep key={label} active={setupStep === index} index={index} label={label} />
                ))}
              </div>

              {setupStep === 0 && (
                <section className="rounded-xl border border-border bg-card/70 p-4">
                  <h3 className="text-sm font-semibold text-foreground">Choose the calendar CRMy should watch</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    CRMy uses this calendar as an observation source. It reads meetings, attendees, timing, and conference links so customer meetings can be matched to customer records.
                  </p>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Calendar email</label>
                      <Input
                        value={setupEmail}
                        onChange={event => setSetupEmail(event.target.value)}
                        placeholder="seller@company.com"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Display name</label>
                      <Input
                        value={setupDisplayName}
                        onChange={event => setSetupDisplayName(event.target.value)}
                        placeholder="Optional"
                      />
                    </div>
                  </div>
                </section>
              )}

              {setupStep === 1 && (
                <section className="rounded-xl border border-border bg-card/70 p-4">
                  <h3 className="text-sm font-semibold text-foreground">Keep Activities focused on customer meetings</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    CRMy classifies meetings before processing so internal calendar noise does not become Raw Context by accident.
                  </p>
                  <div className="mt-4 grid gap-2 md:grid-cols-3">
                    <div className="rounded-lg border border-blue-500/20 bg-blue-500/8 p-3">
                      <p className="text-sm font-semibold text-blue-200">Shown by default</p>
                      <p className="mt-1 text-xs text-muted-foreground">Customer-facing meetings and mixed meetings with external attendees.</p>
                    </div>
                    <div className="rounded-lg border border-border bg-background/40 p-3">
                      <p className="text-sm font-semibold text-foreground">Skipped by default</p>
                      <p className="mt-1 text-xs text-muted-foreground">Internal-only meetings unless a user explicitly adds context.</p>
                    </div>
                    <div className="rounded-lg border border-purple-500/20 bg-purple-500/8 p-3">
                      <p className="text-sm font-semibold text-purple-200">Needs Context</p>
                      <p className="mt-1 text-xs text-muted-foreground">Meetings missing notes, transcripts, or record links are queued for review.</p>
                    </div>
                  </div>
                </section>
              )}

              {setupStep === 2 && (
                <section className="rounded-xl border border-border bg-card/70 p-4">
                  <h3 className="text-sm font-semibold text-foreground">Prepare {setupCopy.credentialLabel}</h3>
                  <div className="mt-3 space-y-3 text-sm text-muted-foreground">
                    <p>
                      Live calendar sync requires OAuth credentials configured by an admin. Until then, CRMy saves this as a setup request and shows exactly what remains.
                    </p>
                    <div className="grid gap-2 md:grid-cols-2">
                      <div className="rounded-lg border border-border bg-background/40 p-3">
                        <p className="font-medium text-foreground">Redirect path</p>
                        <code className="mt-1 block break-all rounded bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
                          {setupCopy.callbackPath}
                        </code>
                      </div>
                      <div className="rounded-lg border border-border bg-background/40 p-3">
                        <p className="font-medium text-foreground">Access model</p>
                        <p className="mt-1 text-xs">Read meetings, classify customer-facing events, and process notes or transcripts as Raw Context. Calendar writeback is not enabled.</p>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {setupStep === 3 && (
                <section className="rounded-xl border border-border bg-card/70 p-4">
                  <h3 className="text-sm font-semibold text-foreground">Review setup</h3>
                  <div className="mt-3 grid gap-2 text-sm">
                    <div className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-3 py-2">
                      <span className="text-muted-foreground">Source</span>
                      <span className="font-medium text-foreground">{setupCopy.label}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-3 py-2">
                      <span className="text-muted-foreground">Calendar</span>
                      <span className="font-medium text-foreground">{setupEmail.trim() || 'Required'}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-3 py-2">
                      <span className="text-muted-foreground">Default processing</span>
                      <span className="font-medium text-foreground">Customer meetings and mixed meetings</span>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-3 py-2">
                      <span className="text-muted-foreground">Missing context</span>
                      <span className="font-medium text-foreground">Queued in Needs Context</span>
                    </div>
                  </div>
                </section>
              )}
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={closeSetup}>Cancel</Button>
              {setupStep > 0 && (
                <Button variant="outline" onClick={() => setSetupStep(step => Math.max(step - 1, 0))}>
                  Back
                </Button>
              )}
              {setupStep < 3 ? (
                <Button onClick={nextSetupStep} className="gap-1.5 bg-blue-600 text-white hover:bg-blue-500">
                  Continue <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <Button onClick={saveCalendarSetup} disabled={setupSaving} className="gap-1.5 bg-blue-600 text-white hover:bg-blue-500">
                  {setupSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Save setup request
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={!!debriefActivity} onOpenChange={(open) => {
        if (!open) {
          setDebriefActivity(null);
          setDebriefText('');
        }
      }}>
        {debriefActivity && (
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Add debrief</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-muted/25 p-3">
                <p className="text-sm font-semibold text-foreground">{String(debriefActivity.subject ?? 'Activity')}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Add call notes, meeting notes, or a quick summary. CRMy will process this as Raw Context.
                </p>
              </div>
              <Textarea
                value={debriefText}
                onChange={(event) => setDebriefText(event.target.value)}
                placeholder="What happened? Include commitments, risks, next steps, blockers, or decisions..."
                className="min-h-36"
              />
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setDebriefActivity(null)}>Cancel</Button>
              <Button
                disabled={!debriefText.trim() || addActivityContext.isPending}
                onClick={() => addActivityContext.mutate({
                  id: String(debriefActivity.id),
                  text: debriefText.trim(),
                  artifact_type: 'debrief',
                  source_label: 'Activity debrief',
                }, {
                  onSuccess: () => {
                    toast({ title: 'Debrief processed', description: 'CRMy processed this activity as Raw Context.' });
                    setDebriefActivity(null);
                    setDebriefText('');
                  },
                  onError: (err) => toast({ title: 'Could not process debrief', description: err instanceof Error ? err.message : 'Try again.', variant: 'destructive' }),
                })}
                className="bg-blue-600 text-white hover:bg-blue-500"
              >
                {addActivityContext.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Process debrief
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      <MeetingDetailDrawer id={selectedMeetingId} onClose={() => setSelectedMeetingId(null)} />
    </div>
  );
}
