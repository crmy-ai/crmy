// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
  useDeleteCalendarConnection,
  useContextSourceConnections,
  useContextSourceObject,
  useContextSourceObjects,
  useCreateContextSourceConnection,
  useIgnoreContextSourceObject,
  useCalendarEvent,
  useCalendarEvents,
  useIgnoreCalendarEvent,
  useMeetingClassifications,
  useProcessCalendarEvent,
  useReprocessContextSourceObject,
  useResolveContextSourceObject,
  useStartCalendarConnection,
  useSyncContextSourceConnection,
  useSyncCalendarConnection,
  useUpdateCalendarConnectionStatus,
} from '@/api/hooks';
import { useAppStore } from '@/store/appStore';
import { headerDescription } from '@/lib/headerCopy';
import { ENTITY_COLORS, STATUS_TONES } from '@/lib/entityColors';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { getUser } from '@/api/client';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';

type CustomerActivityTab = 'meetings' | 'needs_context' | 'calls_notes' | 'all' | 'meeting_sources';
type CalendarProvider = 'google' | 'microsoft';
type MeetingIngestScope = 'owned_accounts' | 'accessible_accounts' | 'all_meetings';

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

type ContextSourceObject = {
  id: string;
  object_key: string;
  source_label?: string | null;
  match_status: string;
  processing_status: string;
  match_reason?: string | null;
  failure_reason?: string | null;
  text_excerpt?: string | null;
  candidates?: Array<Record<string, any>>;
  connection_name?: string | null;
  connection_provider?: string | null;
  account_name?: string | null;
  contact_name?: string | null;
  opportunity_name?: string | null;
  use_case_name?: string | null;
  calendar_title?: string | null;
  extraction_receipt?: Record<string, any>;
  sidecar_metadata?: Record<string, any>;
};

const PAGE_SIZE = 50;
const ACTIVITY_BANNER_HIDDEN_KEY = 'crmy_customer_activity_banner_hidden';

const tabs: Array<{ key: CustomerActivityTab; label: string; icon: typeof CalendarClock }> = [
  { key: 'meetings', label: 'Meetings', icon: CalendarClock },
  { key: 'needs_context', label: 'Needs Context', icon: AlertCircle },
  { key: 'calls_notes', label: 'Calls & Notes', icon: NotebookText },
  { key: 'all', label: 'All Activity', icon: ActivityIcon },
  { key: 'meeting_sources', label: 'Meeting Sources', icon: SlidersHorizontal },
];

function activityTabFromQuery(value: string | null): CustomerActivityTab {
  if (value === 'connections') return 'meeting_sources';
  if (value === 'meeting_sources' || value === 'meetings' || value === 'needs_context' || value === 'calls_notes' || value === 'all') return value;
  return 'meetings';
}

const CALENDAR_PROVIDER_COPY: Record<CalendarProvider, {
  label: string;
  title: string;
  description: string;
  credentialLabel: string;
  callbackPath: string;
}> = {
  google: {
    label: 'Google Calendar',
    title: 'Connect Google Calendar',
    description: 'Capture customer meetings from Google Workspace calendars and turn notes or transcripts into Signals and Memory.',
    credentialLabel: 'Google Cloud OAuth app',
    callbackPath: '/api/v1/calendar/oauth/google/callback',
  },
  microsoft: {
    label: 'Outlook Calendar',
    title: 'Connect Outlook Calendar',
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
  onToggleActive,
  onDisconnect,
  syncing,
  connectionActionPending,
}: {
  connection: Record<string, any>;
  onSync: (id: string) => void;
  onSetup: (provider: CalendarProvider, connection?: Record<string, any>) => void;
  onToggleActive: (connection: Record<string, any>, active: boolean) => void;
  onDisconnect: (connection: Record<string, any>) => void;
  syncing: boolean;
  connectionActionPending?: boolean;
}) {
  const connected = connection.status === 'connected';
  const paused = connection.status === 'disconnected';
  const canToggle = connected || paused;
  const provider = CALENDAR_PROVIDER_COPY[connection.provider as CalendarProvider] ?? CALENDAR_PROVIDER_COPY.google;
  const status = connectionCopy[connection.status] ?? connectionCopy.configuration_required;
  const statusLabel = connected ? `Connected as ${connection.email_address}` : paused ? 'Paused' : status.label === 'Setup needed' ? 'Waiting for admin OAuth setup' : status.label;
  const statusClassName = paused ? STATUS_TONES.muted : status.className;
  const scope = connection.settings?.meeting_ingest_scope as MeetingIngestScope | undefined;
  const scopeLabel = scope === 'all_meetings'
    ? 'All external meetings'
    : scope === 'accessible_accounts'
      ? 'Accounts I can access'
      : 'My accounts';
  return (
    <div className="rounded-xl border border-border bg-card/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CalendarClock className={`h-4 w-4 ${connected ? 'text-emerald-400' : 'text-blue-300'}`} />
            <h3 className="text-sm font-semibold text-foreground">{provider.label}</h3>
            <Badge variant="outline" className={statusClassName}>{statusLabel}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{connection.email_address}</p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {connected ? (
            <Button variant="outline" size="sm" onClick={() => onSync(connection.id)} disabled={syncing} className="gap-1.5">
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} /> Sync
            </Button>
          ) : !paused ? (
            <Button variant="outline" size="sm" onClick={() => onSetup(connection.provider as CalendarProvider, connection)} className="gap-1.5">
              <SlidersHorizontal className="h-3.5 w-3.5" /> Setup guide
            </Button>
          ) : null}
          {canToggle && (
            <Button
              variant="outline"
              size="sm"
              disabled={connectionActionPending}
              onClick={() => onToggleActive(connection, !connected)}
            >
              {connected ? 'Deactivate' : 'Activate'}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={connectionActionPending}
            onClick={() => onDisconnect(connection)}
            className="border-destructive/30 text-destructive hover:bg-destructive/10"
          >
            Disconnect calendar
          </Button>
        </div>
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
            <span className="rounded-md border border-border bg-muted/20 px-2 py-0.5">
              {connection.sync_stats.out_of_scope_skipped ?? 0} outside scope
            </span>
          </div>
        )}
        <div className="mb-2 flex flex-wrap gap-1.5">
          <span className="rounded-md border border-blue-500/20 bg-blue-500/8 px-2 py-0.5 text-blue-200">
            Ingest: {scopeLabel}
          </span>
        </div>
        {paused ? (
          <p>Paused. CRMy is not reading this calendar for customer meeting context or availability.</p>
        ) : !connected && (
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
  onToggleActive,
  onDisconnect,
  syncingId,
  connectionActionPending,
  oauthReady,
  isAdmin,
}: {
  connections: Array<Record<string, any>>;
  summary?: Record<string, number>;
  onSetup: (provider: CalendarProvider, connection?: Record<string, any>) => void;
  onSync: (id: string) => void;
  onToggleActive: (connection: Record<string, any>, active: boolean) => void;
  onDisconnect: (connection: Record<string, any>) => void;
  syncingId?: string | null;
  connectionActionPending?: boolean;
  oauthReady?: Record<'google' | 'microsoft', boolean>;
  isAdmin?: boolean;
}) {
  const providers = [
    { provider: 'google' as const, title: oauthReady?.google === false ? 'Request Google Calendar setup' : 'Connect Google Calendar', description: 'Connect Google Workspace meeting context for customer activity capture.' },
    { provider: 'microsoft' as const, title: oauthReady?.microsoft === false ? 'Request Outlook Calendar setup' : 'Connect Outlook Calendar', description: 'Connect Microsoft 365 meeting context for customer activity capture.' },
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
                {oauthReady?.[provider.provider] === true ? 'Connect calendar' : oauthReady?.[provider.provider] === false ? (isAdmin ? 'Open setup guide' : 'Request admin setup') : 'Open setup guide'} <ArrowRight className="h-3 w-3" />
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
            onToggleActive={onToggleActive}
            onDisconnect={onDisconnect}
            syncing={syncingId === connection.id}
            connectionActionPending={connectionActionPending}
          />
        ))}
      </div>
    </div>
  );
}

function TranscriptDropsPanel({ isAdmin, onReview }: { isAdmin?: boolean; onReview: () => void }) {
  const connectionsQ = useContextSourceConnections() as any;
  const objectsQ = useContextSourceObjects({ limit: 50 }) as any;
  const createConnection = useCreateContextSourceConnection();
  const syncConnection = useSyncContextSourceConnection();
  const [provider, setProvider] = useState<'local_folder' | 's3'>('local_folder');
  const [name, setName] = useState('');
  const [pathValue, setPathValue] = useState('');
  const [bucket, setBucket] = useState('');
  const [prefix, setPrefix] = useState('');
  const [region, setRegion] = useState('us-east-1');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const connections = (connectionsQ.data?.data ?? []) as Array<Record<string, any>>;
  const objects = (objectsQ.data?.data ?? []) as ContextSourceObject[];
  const reviewCount = objects.filter(item => ['needs_review', 'ambiguous'].includes(item.match_status)).length;
  const processedCount = objects.filter(item => item.processing_status === 'processed').length;

  const create = async () => {
    try {
      if (!name.trim()) {
        toast({ title: 'Source name required', description: 'Give this transcript drop a recognizable name.', variant: 'destructive' });
        return;
      }
      const payload = provider === 'local_folder'
        ? {
            name: name.trim(),
            provider,
            config: { path: pathValue.trim(), include_globs: ['**/*.txt', '**/*.md', '**/*.vtt', '**/*.srt', '**/*.json', '**/*.docx', '**/*.pdf'] },
          }
        : {
            name: name.trim(),
            provider,
            config: { bucket: bucket.trim(), prefix: prefix.trim(), region: region.trim(), include_globs: ['**/*.txt', '**/*.md', '**/*.vtt', '**/*.srt', '**/*.json', '**/*.docx', '**/*.pdf'] },
            credentials: { access_key_id: accessKeyId.trim(), secret_access_key: secretAccessKey },
          };
      await createConnection.mutateAsync(payload);
      setName('');
      setPathValue('');
      setBucket('');
      setPrefix('');
      setAccessKeyId('');
      setSecretAccessKey('');
      toast({ title: 'Transcript drop added', description: 'Run sync to discover transcripts and notes.' });
    } catch (err) {
      toast({ title: 'Could not add transcript drop', description: err instanceof Error ? err.message : 'Check the settings and try again.', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h3 className="font-display text-lg font-semibold text-foreground">Transcript & Notes Sources</h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            CRMy watches transcript and note drops configured by admins, matches files to meetings or customer records, and keeps anything uncertain in Needs Context.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-lg border border-border bg-card px-3 py-2">
            <p className="text-muted-foreground">Sources</p>
            <p className="text-lg font-semibold text-foreground">{connections.length}</p>
          </div>
          <div className="rounded-lg border border-border bg-card px-3 py-2">
            <p className="text-muted-foreground">Review</p>
            <p className="text-lg font-semibold text-amber-300">{reviewCount}</p>
          </div>
          <div className="rounded-lg border border-border bg-card px-3 py-2">
            <p className="text-muted-foreground">Processed</p>
            <p className="text-lg font-semibold text-emerald-300">{processedCount}</p>
          </div>
        </div>
      </div>

      {isAdmin ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap gap-2">
            {[
              { key: 'local_folder', label: 'Local folder' },
              { key: 's3', label: 'S3 bucket' },
            ].map(item => (
              <button
                key={item.key}
                type="button"
                onClick={() => setProvider(item.key as 'local_folder' | 's3')}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${provider === item.key ? 'border-blue-500 bg-blue-500/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              Source name
              <Input value={name} onChange={event => setName(event.target.value)} placeholder="Zoom transcript drop" />
            </label>
            {provider === 'local_folder' ? (
              <label className="space-y-1 text-xs font-medium text-muted-foreground">
                Folder path
                <Input value={pathValue} onChange={event => setPathValue(event.target.value)} placeholder="/tmp/crmy-transcripts" />
              </label>
            ) : (
              <>
                <label className="space-y-1 text-xs font-medium text-muted-foreground">
                  Bucket
                  <Input value={bucket} onChange={event => setBucket(event.target.value)} placeholder="customer-transcripts" />
                </label>
                <label className="space-y-1 text-xs font-medium text-muted-foreground">
                  Prefix
                  <Input value={prefix} onChange={event => setPrefix(event.target.value)} placeholder="transcripts/" />
                </label>
                <label className="space-y-1 text-xs font-medium text-muted-foreground">
                  Region
                  <Input value={region} onChange={event => setRegion(event.target.value)} placeholder="us-east-1" />
                </label>
                <label className="space-y-1 text-xs font-medium text-muted-foreground">
                  Access key ID
                  <Input value={accessKeyId} onChange={event => setAccessKeyId(event.target.value)} placeholder="Read/list key" />
                </label>
                <label className="space-y-1 text-xs font-medium text-muted-foreground">
                  Secret access key
                  <Input type="password" value={secretAccessKey} onChange={event => setSecretAccessKey(event.target.value)} placeholder="Stored encrypted" />
                </label>
              </>
            )}
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Sidecar JSON is optional but recommended for explicit meeting/account IDs, attendees, and authorship.
            </p>
            <Button onClick={create} disabled={createConnection.isPending}>
              {createConnection.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Add drop
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-blue-500/20 bg-blue-500/8 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">Transcript drops are managed by admins</p>
              <p className="mt-1 text-sm text-muted-foreground">
                You do not need to configure storage. When a transcript or note needs your judgment, it appears in Needs Context so you can link it to the right customer record.
              </p>
            </div>
            <Button variant={reviewCount > 0 ? 'default' : 'outline'} onClick={onReview}>
              {reviewCount > 0 ? `Review ${reviewCount}` : 'Open Needs Context'}
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {connections.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground md:col-span-2">
            {isAdmin
              ? 'No transcript drops configured yet.'
              : 'No transcript drops are configured for this workspace yet. You can still add notes directly to a meeting or use Add Context.'}
          </div>
        ) : connections.map(connection => (
          <div key={connection.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">{connection.name}</p>
                <p className="text-xs text-muted-foreground">{connection.provider === 's3' ? 'S3-compatible bucket' : 'Local folder'} · {connection.status}</p>
              </div>
              {isAdmin && (
                <Button size="sm" variant="outline" onClick={() => syncConnection.mutate(String(connection.id), { onSuccess: () => toast({ title: 'Transcript sync queued' }) })}>
                  {syncConnection.isPending && syncConnection.variables === connection.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
                  Sync
                </Button>
              )}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {connection.last_sync_at ? `Last sync ${new Date(connection.last_sync_at).toLocaleString()}` : connection.last_error || 'Ready to sync transcripts and notes.'}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function TranscriptReviewList({ objects, onOpen }: { objects: ContextSourceObject[]; onOpen: (id: string) => void }) {
  if (objects.length === 0) return null;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-amber-300" />
        <h3 className="text-sm font-semibold text-foreground">Transcript drops needing a link</h3>
        <Badge variant="outline">{objects.length}</Badge>
      </div>
      {objects.map(object => (
        <button
          key={object.id}
          type="button"
          onClick={() => onOpen(object.id)}
          className="w-full rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-muted/30"
        >
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{object.source_label ?? object.object_key}</p>
              <p className="mt-1 text-xs text-muted-foreground">{object.connection_name ?? object.connection_provider ?? 'Transcript source'} · {object.match_reason ?? object.failure_reason ?? 'Needs review before processing'}</p>
            </div>
            <Badge className={object.match_status === 'ambiguous' ? 'bg-amber-500/15 text-amber-200' : 'bg-blue-500/15 text-blue-200'}>
              {object.match_status === 'ambiguous' ? 'Choose match' : 'Needs link'}
            </Badge>
          </div>
          {object.text_excerpt && <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{object.text_excerpt}</p>}
        </button>
      ))}
    </div>
  );
}

function MeetingContextShortcuts({
  isAdmin,
  reviewCount,
  calendarConnected,
  sourceCount,
  onNeedsContext,
  onMeetingSources,
  onLogActivity,
}: {
  isAdmin: boolean;
  reviewCount: number;
  calendarConnected: boolean;
  sourceCount: number;
  onNeedsContext: () => void;
  onMeetingSources: () => void;
  onLogActivity: () => void;
}) {
  return (
    <div className="mb-4 rounded-xl border border-border bg-card/70 p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-blue-300" />
            <p className="text-sm font-semibold text-foreground">Meeting context</p>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {reviewCount > 0
              ? `${reviewCount} transcript or meeting item${reviewCount === 1 ? '' : 's'} need a customer link before CRMy can turn them into Signals and Memory.`
              : calendarConnected || sourceCount > 0
                ? 'Calendar events and transcript drops feed this Activity workflow. Anything uncertain appears in Needs Context.'
                : 'Connect a calendar or add notes manually when meetings should become customer context.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={reviewCount > 0 ? 'default' : 'outline'} onClick={onNeedsContext}>
            {reviewCount > 0 ? `Review ${reviewCount}` : 'Needs Context'}
          </Button>
          <Button size="sm" variant="outline" onClick={onMeetingSources}>
            {isAdmin ? 'Manage Sources' : 'Meeting Sources'}
          </Button>
          <Button size="sm" variant="ghost" onClick={onLogActivity}>
            Log Activity
          </Button>
        </div>
      </div>
    </div>
  );
}

function ContextSourceObjectDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, isLoading } = useContextSourceObject(id) as any;
  const resolveObject = useResolveContextSourceObject();
  const reprocessObject = useReprocessContextSourceObject();
  const ignoreObject = useIgnoreContextSourceObject();
  const [calendarEventId, setCalendarEventId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [contactId, setContactId] = useState('');
  const [opportunityId, setOpportunityId] = useState('');
  const [useCaseId, setUseCaseId] = useState('');
  const object = data?.source_object as ContextSourceObject | undefined;

  if (!id) return null;
  const resolve = async () => {
    try {
      await resolveObject.mutateAsync({
        id,
        calendar_event_id: calendarEventId || undefined,
        account_id: accountId || undefined,
        contact_id: contactId || undefined,
        opportunity_id: opportunityId || undefined,
        use_case_id: useCaseId || undefined,
        note: 'Linked from Customer Activity review.',
      });
      toast({ title: 'Transcript linked', description: 'Processing has been queued.' });
      onClose();
    } catch (err) {
      toast({ title: 'Could not resolve transcript', description: err instanceof Error ? err.message : 'Check the record IDs and try again.', variant: 'destructive' });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-background/40 backdrop-blur-sm">
      <button type="button" className="flex-1" aria-label="Close transcript source details" onClick={onClose} />
      <aside className="h-full w-full max-w-2xl overflow-y-auto border-l border-border bg-background shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-5 py-4 backdrop-blur">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">Transcript source</p>
            <h2 className="truncate font-display text-lg font-semibold text-foreground">{object?.source_label ?? object?.object_key ?? 'Source object'}</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        {isLoading || !object ? (
          <div className="p-5 space-y-3">
            {[...Array(5)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-muted/50 animate-pulse" />)}
          </div>
        ) : (
          <div className="space-y-5 p-5">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap gap-2">
                <Badge>{object.match_status}</Badge>
                <Badge variant="outline">{object.processing_status}</Badge>
                {object.connection_name && <Badge variant="outline">{object.connection_name}</Badge>}
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{object.match_reason ?? object.failure_reason ?? 'Review this file and link it to a meeting or customer record.'}</p>
              {object.text_excerpt && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">{object.text_excerpt}</p>}
            </div>

            {(object.account_name || object.contact_name || object.calendar_title) && (
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-sm font-semibold text-foreground">Current links</p>
                <div className="mt-2 grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
                  <p>Meeting: {object.calendar_title ?? 'None'}</p>
                  <p>Account: {object.account_name ?? 'None'}</p>
                  <p>Contact: {object.contact_name ?? 'None'}</p>
                  <p>Opportunity: {object.opportunity_name ?? 'None'}</p>
                </div>
              </div>
            )}

            {Array.isArray(object.candidates) && object.candidates.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-sm font-semibold text-foreground">Possible matches</p>
                <div className="mt-2 space-y-2">
                  {object.candidates.slice(0, 5).map((candidate, index) => (
                    <div key={index} className="rounded-lg bg-muted/40 p-2 text-xs text-muted-foreground">
                      {candidate.type ?? candidate.record_type ?? 'record'} · {candidate.name ?? candidate.title ?? candidate.email ?? candidate.id}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-sm font-semibold text-foreground">Resolve link</p>
              <p className="mt-1 text-xs text-muted-foreground">Paste the meeting or customer record ID. Linking queues processing through Raw Context, Signals, and Memory.</p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Input placeholder="Calendar event ID" value={calendarEventId} onChange={event => setCalendarEventId(event.target.value)} />
                <Input placeholder="Account ID" value={accountId} onChange={event => setAccountId(event.target.value)} />
                <Input placeholder="Contact ID" value={contactId} onChange={event => setContactId(event.target.value)} />
                <Input placeholder="Opportunity ID" value={opportunityId} onChange={event => setOpportunityId(event.target.value)} />
                <Input placeholder="Use case ID" value={useCaseId} onChange={event => setUseCaseId(event.target.value)} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={resolve} disabled={resolveObject.isPending}>
                  {resolveObject.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}
                  Resolve and process
                </Button>
                <Button variant="outline" onClick={() => reprocessObject.mutate(id, { onSuccess: () => toast({ title: 'Reprocessing queued' }) })}>
                  <RefreshCw className="mr-2 h-4 w-4" /> Reprocess
                </Button>
                <Button variant="ghost" onClick={() => ignoreObject.mutate({ id, reason: 'Ignored from Customer Activity review.' }, { onSuccess: () => { toast({ title: 'Transcript ignored' }); onClose(); } })}>
                  Ignore
                </Button>
              </div>
            </div>
          </div>
        )}
      </aside>
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
  const location = useLocation();
  const { openQuickAdd, openDrawer } = useAppStore();
  const queryParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const [tab, setTab] = useState<CustomerActivityTab>(() => activityTabFromQuery(queryParams.get('tab')));
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({});
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [selectedSourceObjectId, setSelectedSourceObjectId] = useState<string | null>(null);
  const [setupProvider, setSetupProvider] = useState<CalendarProvider | null>(null);
  const [setupStep, setSetupStep] = useState(0);
  const [setupEmail, setSetupEmail] = useState('');
  const [setupDisplayName, setSetupDisplayName] = useState('');
  const [setupMeetingScope, setSetupMeetingScope] = useState<MeetingIngestScope>('owned_accounts');
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
  const updateCalendarStatus = useUpdateCalendarConnectionStatus();
  const deleteCalendarConnection = useDeleteCalendarConnection();
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
  const currentFilterConfigs = tab === 'meetings' || tab === 'needs_context' ? meetingFilterConfigs : tab === 'meeting_sources' ? [] : activityFilterConfigs;
  useEffect(() => {
    const nextTab = activityTabFromQuery(queryParams.get('tab'));
    if (nextTab !== tab) {
      setTab(nextTab);
      setPage(1);
      setActiveFilters({});
    }
  }, [queryParams, tab]);
  useEffect(() => {
    const message = queryParams.get('calendar_error');
    if (!message) return;
    toast({
      title: 'Calendar connection needs attention',
      description: message,
      variant: 'destructive',
    });
    const next = new URLSearchParams(queryParams);
    next.delete('calendar_error');
    const search = next.toString();
    navigate(search ? `${location.pathname}?${search}` : location.pathname, { replace: true });
  }, [location.pathname, navigate, queryParams]);

  const handleFilterChange = (key: string, values: string[]) => {
    setActiveFilters(prev => {
      const next = { ...prev };
      if (values.length === 0) delete next[key]; else next[key] = values;
      return next;
    });
  };

  const setActivityTab = (nextTab: CustomerActivityTab) => {
    setTab(nextTab);
    setPage(1);
    setActiveFilters({});
    const next = new URLSearchParams(location.search);
    next.set('tab', nextTab);
    navigate(`${location.pathname}?${next.toString()}`, { replace: false });
  };

  const calendarTab = tab === 'calls_notes' || tab === 'meeting_sources' ? 'meetings' : tab;
  const calendarQ = useCalendarEvents({
    tab: calendarTab === 'all' ? 'all' : calendarTab,
    q: search,
    classification: activeFilters.classification?.[0],
    validation_status: activeFilters.validation_status?.[0],
    limit: 100,
  }) as any;
  const connectionsQ = useCalendarConnections() as any;
  const contextSourceObjectsQ = useContextSourceObjects({ limit: 100 }) as any;
  const activitiesQ = useActivities({ limit: 200 }) as any;

  const meetings: CalendarEvent[] = calendarQ.data?.data ?? [];
  const summary = calendarQ.data?.summary ?? connectionsQ.data?.summary;
  const connections = connectionsQ.data?.data ?? [];
  const contextSourceObjects = (contextSourceObjectsQ.data?.data ?? []) as ContextSourceObject[];
  const transcriptReviewObjects = contextSourceObjects.filter(object => ['needs_review', 'ambiguous'].includes(object.match_status) || object.processing_status === 'failed');
  const meetingContextReviewCount = Number(summary?.needs_context ?? 0) + transcriptReviewObjects.length;
  const transcriptSourceCount = new Set(contextSourceObjects.map(object => object.connection_name ?? object.connection_provider ?? object.id)).size;
  const oauthReady = connectionsQ.data?.oauth_ready as Record<'google' | 'microsoft', boolean> | undefined;
  const currentUser = getUser();
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'owner';
  const selectedProviderReady = setupProvider ? oauthReady?.[setupProvider] === true : false;
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
    setSetupMeetingScope(connection?.settings?.meeting_ingest_scope ?? 'owned_accounts');
  };

  const closeSetup = () => {
    setSetupProvider(null);
    setSetupStep(0);
    setSetupEmail('');
    setSetupDisplayName('');
    setSetupMeetingScope('owned_accounts');
  };

  const toggleCalendarActive = (connection: Record<string, any>, active: boolean) => {
    updateCalendarStatus.mutate({ id: String(connection.id), active }, {
      onSuccess: () => toast({ title: active ? 'Calendar activated' : 'Calendar paused' }),
      onError: (err) => toast({
        title: active ? 'Could not activate calendar' : 'Could not pause calendar',
        description: err instanceof Error ? err.message : 'Try again or reconnect the calendar.',
        variant: 'destructive',
      }),
    });
  };

  const disconnectCalendar = (connection: Record<string, any>) => {
    const email = String(connection.email_address ?? 'this calendar');
    const ok = window.confirm(`Disconnect ${email}? This removes the calendar connection and OAuth tokens. Reconnecting requires provider consent again.`);
    if (!ok) return;
    deleteCalendarConnection.mutate(String(connection.id), {
      onSuccess: () => toast({ title: 'Calendar disconnected' }),
      onError: (err) => toast({
        title: 'Could not disconnect calendar',
        description: err instanceof Error ? err.message : 'Try again from Customer Activity Meeting Sources.',
        variant: 'destructive',
      }),
    });
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
      meeting_ingest_scope: setupMeetingScope,
    };
    try {
      const result = await (setupProvider === 'google' ? startGoogle : startMicrosoft).mutateAsync(payload) as any;
      if (result?.auth_url) {
        window.location.assign(result.auth_url);
        return;
      }
      toast({
        title: 'Admin setup requested',
        description: `${CALENDAR_PROVIDER_COPY[setupProvider].label} is waiting for an admin to finish OAuth setup before live sync can run.`,
      });
      setActivityTab('meeting_sources');
      closeSetup();
      if (isAdmin) navigate('/settings/connections');
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
                  Connect your calendar when you want customer meetings auto matched to customer records and flagged when notes, transcripts, or debriefs are missing. Transcript drops and meeting notes live in Meeting Sources and Needs Context, so review work stays in the Activity flow.
                  {' '}You can also add context manually through{' '}
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
                    <Button variant="outline" onClick={() => setActivityTab('meeting_sources')}>Meeting Sources</Button>
                  </>
                )}
                {calendarConnected && (
                  <>
                    <Button className="shrink-0" variant="ghost" onClick={() => setActivityTab('needs_context')}>Needs Context</Button>
                    <Button className="shrink-0" variant="outline" onClick={() => setActivityTab('meeting_sources')}>Meeting Sources</Button>
                  </>
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
                onClick={() => setActivityTab(item.key)}
                className={`inline-flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
                  active
                    ? 'border-blue-500 text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
                {item.key === 'needs_context' && meetingContextReviewCount > 0 && (
                  <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-200">{meetingContextReviewCount}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {tab !== 'meeting_sources' && (
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
        {tab !== 'meeting_sources' && (
          <MeetingContextShortcuts
            isAdmin={isAdmin}
            reviewCount={meetingContextReviewCount}
            calendarConnected={calendarConnected}
            sourceCount={transcriptSourceCount}
            onNeedsContext={() => setActivityTab('needs_context')}
            onMeetingSources={() => setActivityTab('meeting_sources')}
            onLogActivity={() => openQuickAdd('activity')}
          />
        )}
        {tab === 'meeting_sources' ? (
          <div className="space-y-6">
            <CalendarConnectionsPanel
              connections={connections}
              summary={connectionsQ.data?.summary}
              onSetup={openSetup}
              onSync={(id) => syncConnection.mutate(id, { onSuccess: () => toast({ title: 'Calendar sync queued' }) })}
              onToggleActive={toggleCalendarActive}
              onDisconnect={disconnectCalendar}
              syncingId={syncConnection.variables ?? null}
              connectionActionPending={updateCalendarStatus.isPending || deleteCalendarConnection.isPending}
              oauthReady={oauthReady}
              isAdmin={isAdmin}
            />
            <TranscriptDropsPanel isAdmin={isAdmin} onReview={() => setActivityTab('needs_context')} />
          </div>
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
        ) : tab === 'needs_context' && meetings.length === 0 && transcriptReviewObjects.length > 0 ? (
          <TranscriptReviewList objects={transcriptReviewObjects} onOpen={setSelectedSourceObjectId} />
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
            {tab === 'needs_context' && (
              <TranscriptReviewList objects={transcriptReviewObjects} onOpen={setSelectedSourceObjectId} />
            )}
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
                {['Choose calendar', 'What CRMy uses', 'Connect', 'Review'].map((label, index) => (
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
                  <h3 className="text-sm font-semibold text-foreground">CRMy looks for customer meetings</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    CRMy reads meeting metadata so customer meetings can be matched to accounts and contacts.
                  </p>
                  <div className="mt-4 grid gap-2 md:grid-cols-3">
                    <div className="rounded-lg border border-blue-500/20 bg-blue-500/8 p-3">
                      <p className="text-sm font-semibold text-blue-200">Meeting context</p>
                      <p className="mt-1 text-xs text-muted-foreground">Customer-facing meetings and mixed meetings with external attendees.</p>
                    </div>
                    <div className="rounded-lg border border-border bg-background/40 p-3">
                      <p className="text-sm font-semibold text-foreground">Signals and Memory</p>
                      <p className="mt-1 text-xs text-muted-foreground">Notes and transcripts can become Signals and Memory.</p>
                    </div>
                    <div className="rounded-lg border border-purple-500/20 bg-purple-500/8 p-3">
                      <p className="text-sm font-semibold text-purple-200">Read-only calendar</p>
                      <p className="mt-1 text-xs text-muted-foreground">CRMy does not create invites from this setup.</p>
                    </div>
                  </div>
                  <div className="mt-4 rounded-lg border border-border bg-background/40 p-3">
                    <p className="text-sm font-semibold text-foreground">Which meetings should CRMy ingest?</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      CRMy matches attendees to accounts by contact email and account domains, including additional domains.
                    </p>
                    <div className="mt-3 grid gap-2 md:grid-cols-3">
                      {([
                        ['owned_accounts', 'Meetings with my accounts', 'Best for a focused personal book.'],
                        ['accessible_accounts', 'Accounts I can access', 'Best for managers and shared customer coverage.'],
                        ['all_meetings', 'All external meetings', 'Capture external meetings even before CRMy can match a record.'],
                      ] as Array<[MeetingIngestScope, string, string]>).map(([value, label, description]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setSetupMeetingScope(value)}
                          className={`rounded-lg border p-3 text-left transition-colors ${
                            setupMeetingScope === value ? 'border-blue-500/45 bg-blue-500/12' : 'border-border bg-card/40 hover:bg-muted/35'
                          }`}
                        >
                          <span className="block text-sm font-semibold text-foreground">{label}</span>
                          <span className="mt-1 block text-xs text-muted-foreground">{description}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </section>
              )}

              {setupStep === 2 && (
                <section className="rounded-xl border border-border bg-card/70 p-4">
                  <h3 className="text-sm font-semibold text-foreground">
                    {selectedProviderReady
                      ? `Connect ${setupCopy.label}`
                      : isAdmin
                        ? 'OAuth setup required'
                        : `Ask an admin to enable ${setupCopy.label} connections`}
                  </h3>
                  <div className="mt-3 space-y-3 text-sm text-muted-foreground">
                    <p>
                      {selectedProviderReady
                        ? 'Continue to provider consent to connect this calendar. You will choose the Google or Microsoft account CRMy can use.'
                        : isAdmin
                          ? 'Prepare System Connections -> OAuth, then users can connect their own calendar here.'
                          : 'Your workspace admin needs to enable this provider before you can connect your calendar.'}
                    </p>
                    {selectedProviderReady ? (
                      <div className="rounded-lg border border-blue-500/20 bg-blue-500/8 p-3">
                        <p className="font-medium text-foreground">What happens next</p>
                        <p className="mt-1 text-xs">CRMy sends you to {setupCopy.label} to grant read-only calendar access. When you return, customer meetings can be matched and queued for notes or transcripts.</p>
                      </div>
                    ) : isAdmin ? (
                      <div className="rounded-lg border border-border bg-background/40 p-3">
                        <p className="font-medium text-foreground">Admin setup</p>
                        <p className="mt-1 text-xs">Redirect URIs, OAuth app source, tenant-owned credentials, and provider scopes live in System Connections.</p>
                        <Button variant="outline" size="sm" onClick={() => navigate('/settings/connections')} className="mt-3">
                          Open System Connections
                        </Button>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-amber-500/20 bg-amber-500/8 p-3">
                        <p className="font-medium text-foreground">Admin setup needed</p>
                        <p className="mt-1 text-xs">Request setup now. CRMy will record that you need calendar access so an admin can finish provider configuration.</p>
                      </div>
                    )}
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
                      <span className="font-medium text-foreground">
                        {setupMeetingScope === 'all_meetings'
                          ? 'All external meetings'
                          : setupMeetingScope === 'accessible_accounts'
                            ? 'Meetings with accessible accounts'
                            : 'Meetings with my accounts'}
                      </span>
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
                  {selectedProviderReady ? `Connect ${setupCopy.label}` : isAdmin ? 'Save and open OAuth setup' : 'Request admin setup'}
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
      <ContextSourceObjectDrawer id={selectedSourceObjectId} onClose={() => setSelectedSourceObjectId(null)} />
    </div>
  );
}
