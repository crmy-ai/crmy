// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ActorContext, UUID } from '@crmy/shared';
import { permissionDenied, validationError } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';
import type { CalendarConnection } from '../db/repos/calendar.js';
import { calendarAccessToken } from './source-sync.js';
import { assertSubjectAccess, getActorUserId, getVisibleOwnerIds, isGlobalActor } from './access-control.js';

type SubjectType = 'account' | 'contact' | 'opportunity' | 'use_case';
type AvailabilityProvider = 'google' | 'microsoft';

export interface AvailabilitySuggestInput {
  subject_type?: SubjectType;
  subject_id?: UUID;
  account_id?: UUID;
  contact_id?: UUID;
  opportunity_id?: UUID;
  use_case_id?: UUID;
  actor_ids?: UUID[];
  duration_minutes?: number;
  date_start?: string;
  date_end?: string;
  timezone?: string;
  business_hours_start?: string;
  business_hours_end?: string;
  business_days_only?: boolean;
  increment_minutes?: number;
  limit?: number;
}

interface ActorAvailabilityTarget {
  actor_id: UUID;
  actor_name: string;
  user_id: UUID;
  user_email?: string | null;
}

interface BusyInterval {
  start: string;
  end: string;
  source: string;
}

interface CalendarCheck {
  actor_id?: UUID;
  actor_name?: string;
  calendar_connection_id: UUID;
  provider: AvailabilityProvider;
  email_address: string;
  status: 'checked' | 'failed';
  busy_count: number;
  checked_at: string;
  error?: string;
}

interface PreferenceHint {
  id: UUID;
  title?: string | null;
  body: string;
  context_type: string;
  updated_at?: string;
  valid_until?: string | null;
}

const FETCH_TIMEOUT_MS = Number(process.env.SOURCE_SYNC_FETCH_TIMEOUT_MS ?? 30_000);
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value as number)));
}

function parseDate(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw validationError(`Invalid date: ${value}`);
  return parsed;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function roundUp(date: Date, minutes: number): Date {
  const step = minutes * 60_000;
  return new Date(Math.ceil(date.getTime() / step) * step);
}

function parseLocalTime(value: string | undefined, fallback: string): number {
  const raw = value ?? fallback;
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(raw);
  if (!match) throw validationError(`Invalid local time "${raw}". Use HH:mm.`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function assertTimezone(value: string | undefined): { timezone: string; caveat?: string } {
  const timezone = value || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return { timezone };
  } catch {
    return { timezone: 'UTC', caveat: `Invalid timezone "${timezone}". Suggestions are shown in UTC.` };
  }
}

function localParts(date: Date, timezone: string): { weekday: string; minutes: number; label: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  return {
    weekday: get('weekday').toLowerCase(),
    minutes: hour * 60 + minute,
    label: new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(date),
  };
}

function overlaps(start: Date, end: Date, busy: BusyInterval): boolean {
  const busyStart = new Date(busy.start).getTime();
  const busyEnd = new Date(busy.end).getTime();
  return start.getTime() < busyEnd && end.getTime() > busyStart;
}

function normalizeSubject(input: AvailabilitySuggestInput): { subject_type?: SubjectType; subject_id?: UUID } {
  if (input.subject_type && input.subject_id) return { subject_type: input.subject_type, subject_id: input.subject_id };
  if (input.account_id) return { subject_type: 'account', subject_id: input.account_id };
  if (input.contact_id) return { subject_type: 'contact', subject_id: input.contact_id };
  if (input.opportunity_id) return { subject_type: 'opportunity', subject_id: input.opportunity_id };
  if (input.use_case_id) return { subject_type: 'use_case', subject_id: input.use_case_id };
  if (input.subject_type || input.subject_id) {
    throw validationError('Both subject_type and subject_id are required when either is provided.');
  }
  return {};
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Provider free/busy request timed out after ${FETCH_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function parseProviderDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const withZone = /Z$|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`;
  const parsed = new Date(withZone);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function googleBusyIntervals(token: string, start: Date, end: Date): Promise<BusyInterval[]> {
  const response = await fetchWithTimeout('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      items: [{ id: 'primary' }],
    }),
  });
  if (!response.ok) throw new Error(`Google Calendar free/busy failed (${response.status})`);
  const data = await response.json() as { calendars?: Record<string, { busy?: Array<{ start?: string; end?: string }> }> };
  const busy = data.calendars?.primary?.busy ?? [];
  return busy
    .map(item => ({ start: parseProviderDate(item.start), end: parseProviderDate(item.end), source: 'google_freebusy' }))
    .filter((item): item is BusyInterval => Boolean(item.start && item.end));
}

async function microsoftBusyIntervals(connection: CalendarConnection, token: string, start: Date, end: Date): Promise<BusyInterval[]> {
  const response = await fetchWithTimeout('https://graph.microsoft.com/v1.0/me/calendar/getSchedule', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      schedules: [connection.email_address],
      startTime: { dateTime: start.toISOString(), timeZone: 'UTC' },
      endTime: { dateTime: end.toISOString(), timeZone: 'UTC' },
      availabilityViewInterval: 30,
    }),
  });
  if (!response.ok) throw new Error(`Microsoft Calendar free/busy failed (${response.status})`);
  const data = await response.json() as { value?: Array<{ scheduleItems?: Array<{ status?: string; start?: { dateTime?: string }; end?: { dateTime?: string } }> }> };
  return (data.value ?? [])
    .flatMap(schedule => schedule.scheduleItems ?? [])
    .filter(item => String(item.status ?? '').toLowerCase() !== 'free')
    .map(item => ({ start: parseProviderDate(item.start?.dateTime), end: parseProviderDate(item.end?.dateTime), source: 'microsoft_getSchedule' }))
    .filter((item): item is BusyInterval => Boolean(item.start && item.end));
}

async function resolveActorTargets(
  db: DbPool,
  actor: ActorContext,
  actorIds?: UUID[],
): Promise<{ targets: ActorAvailabilityTarget[]; caveats: string[] }> {
  const caveats: string[] = [];
  const params: unknown[] = [actor.tenant_id];
  const conditions = ['a.tenant_id = $1', 'a.actor_type = \'human\'', 'a.user_id IS NOT NULL', 'a.is_active = TRUE'];

  if (actorIds?.length) {
    params.push(actorIds);
    conditions.push(`a.id = ANY($${params.length}::uuid[])`);
  } else {
    const userId = await getActorUserId(db, actor);
    if (!userId) {
      return {
        targets: [],
        caveats: ['No human session owner is linked to this actor, so no internal calendar could be checked.'],
      };
    }
    params.push(userId);
    conditions.push(`a.user_id = $${params.length}`);
  }

  const result = await db.query(
    `SELECT a.id AS actor_id, a.display_name AS actor_name, a.user_id, u.email AS user_email
     FROM actors a
     LEFT JOIN users u ON u.tenant_id = a.tenant_id AND u.id = a.user_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY a.display_name ASC`,
    params,
  );
  const targets = result.rows.map(row => ({
    actor_id: row.actor_id as UUID,
    actor_name: String(row.actor_name ?? 'Unknown actor'),
    user_id: row.user_id as UUID,
    user_email: row.user_email as string | null | undefined,
  }));

  if (actorIds?.length && targets.length !== actorIds.length) {
    caveats.push('One or more requested actors were not found, inactive, or not linked to a human user.');
  }

  if (!isGlobalActor(actor)) {
    const visibleUserIds = await getVisibleOwnerIds(db, actor);
    const allowed = new Set(visibleUserIds ?? []);
    const unauthorized = targets.filter(target => !allowed.has(target.user_id));
    if (unauthorized.length > 0) {
      throw permissionDenied('You cannot inspect availability for actors outside your visible workspace scope.');
    }
  }

  return { targets, caveats };
}

async function listConnectedCalendars(
  db: DbPool,
  tenantId: UUID,
  targets: ActorAvailabilityTarget[],
): Promise<Array<CalendarConnection & { actor_id?: UUID; actor_name?: string }>> {
  if (targets.length === 0) return [];
  const byUserId = new Map(targets.map(target => [target.user_id, target]));
  const result = await db.query(
    `SELECT *
     FROM calendar_connections
     WHERE tenant_id = $1
       AND user_id = ANY($2::uuid[])
       AND status = 'connected'
       AND access_token_enc IS NOT NULL
     ORDER BY created_at DESC`,
    [tenantId, targets.map(target => target.user_id)],
  );
  return result.rows.map(row => {
    const target = byUserId.get(row.user_id as UUID);
    return {
      ...(row as CalendarConnection),
      actor_id: target?.actor_id,
      actor_name: target?.actor_name,
    };
  });
}

async function loadPreferenceHints(
  db: DbPool,
  tenantId: UUID,
  subject?: { subject_type?: SubjectType; subject_id?: UUID },
): Promise<PreferenceHint[]> {
  if (!subject?.subject_type || !subject.subject_id) return [];
  const result = await db.query(
    `SELECT id, title, body, context_type, updated_at, valid_until
     FROM context_entries
     WHERE tenant_id = $1
       AND subject_type = $2
       AND subject_id = $3
       AND is_current = TRUE
       AND memory_status = 'active'
       AND (
         context_type = 'preference'
         OR tags @> '["availability"]'::jsonb
         OR body ILIKE ANY($4::text[])
       )
     ORDER BY updated_at DESC
     LIMIT 5`,
    [
      tenantId,
      subject.subject_type,
      subject.subject_id,
      ['%availability%', '%available%', '%meet%', '%meeting%', '%calendar%', '%morning%', '%afternoon%', '%timezone%', '%time zone%'],
    ],
  );
  return result.rows as PreferenceHint[];
}

function preferenceScore(preferences: PreferenceHint[], parts: { weekday: string; minutes: number }): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const text = preferences.map(pref => `${pref.title ?? ''} ${pref.body}`).join(' ').toLowerCase();
  if (!text) return { score, reasons };
  if (text.includes('morning') && parts.minutes < 12 * 60) {
    score += 3;
    reasons.push('matches customer morning preference context');
  }
  if (text.includes('afternoon') && parts.minutes >= 12 * 60 && parts.minutes < 17 * 60) {
    score += 3;
    reasons.push('matches customer afternoon preference context');
  }
  if (text.includes('avoid friday') && parts.weekday === 'friday') score -= 5;
  for (const day of DAY_NAMES) {
    if (text.includes(day) && parts.weekday === day) {
      score += 2;
      reasons.push(`matches customer ${day} preference context`);
    }
  }
  return { score, reasons: [...new Set(reasons)] };
}

export async function suggestAvailabilityTimes(
  db: DbPool,
  actor: ActorContext,
  input: AvailabilitySuggestInput,
) {
  const durationMinutes = clampInt(input.duration_minutes, 15, 480, 30);
  const incrementMinutes = clampInt(input.increment_minutes, 5, 120, 30);
  const limit = clampInt(input.limit, 1, 10, 3);
  const now = new Date();
  const rangeStart = roundUp(parseDate(input.date_start, addMinutes(now, 60)), incrementMinutes);
  const rangeEnd = parseDate(input.date_end, addMinutes(rangeStart, 14 * 24 * 60));
  if (rangeEnd <= rangeStart) throw validationError('date_end must be after date_start.');
  if (rangeEnd.getTime() - rangeStart.getTime() > 45 * 24 * 60 * 60_000) {
    throw validationError('Availability search range cannot exceed 45 days.');
  }

  const { timezone, caveat: timezoneCaveat } = assertTimezone(input.timezone);
  const businessStart = parseLocalTime(input.business_hours_start, '09:00');
  const businessEnd = parseLocalTime(input.business_hours_end, '17:00');
  if (businessEnd <= businessStart) throw validationError('business_hours_end must be after business_hours_start.');

  const subject = normalizeSubject(input);
  if (subject.subject_type && subject.subject_id) {
    await assertSubjectAccess(db, actor, subject.subject_type, subject.subject_id);
  }

  const caveats: string[] = [
    'Customer calendar availability is not checked unless that person explicitly exists as a connected calendar actor. Customer timing context is treated as a preference, not confirmed availability.',
  ];
  if (timezoneCaveat) caveats.push(timezoneCaveat);

  const { targets, caveats: targetCaveats } = await resolveActorTargets(db, actor, input.actor_ids);
  caveats.push(...targetCaveats);
  const connections = await listConnectedCalendars(db, actor.tenant_id, targets);
  if (targets.length > 0 && connections.length === 0) {
    caveats.push('No connected internal calendars were found for the selected actor(s); suggestions are tentative business-hour windows.');
  }

  const preferences = await loadPreferenceHints(db, actor.tenant_id, subject);
  if (preferences.length > 0) {
    caveats.push('Customer timing preferences from Memory influenced ranking, but they are not treated as confirmed free/busy.');
  }

  const calendarChecks: CalendarCheck[] = [];
  const busyIntervals: BusyInterval[] = [];
  for (const connection of connections) {
    const checkedAt = new Date().toISOString();
    try {
      const token = await calendarAccessToken(db, connection);
      const intervals = connection.provider === 'google'
        ? await googleBusyIntervals(token, rangeStart, rangeEnd)
        : await microsoftBusyIntervals(connection, token, rangeStart, rangeEnd);
      busyIntervals.push(...intervals.map(interval => ({
        ...interval,
        source: `${connection.provider}:${connection.id}:${interval.source}`,
      })));
      calendarChecks.push({
        actor_id: connection.actor_id,
        actor_name: connection.actor_name,
        calendar_connection_id: connection.id,
        provider: connection.provider,
        email_address: connection.email_address,
        status: 'checked',
        busy_count: intervals.length,
        checked_at: checkedAt,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Provider free/busy lookup failed';
      caveats.push(`Could not check ${connection.email_address}: ${message}`);
      calendarChecks.push({
        actor_id: connection.actor_id,
        actor_name: connection.actor_name,
        calendar_connection_id: connection.id,
        provider: connection.provider,
        email_address: connection.email_address,
        status: 'failed',
        busy_count: 0,
        checked_at: checkedAt,
        error: message,
      });
    }
  }

  const hasProviderFailure = calendarChecks.some(check => check.status === 'failed');
  const candidates: Array<{
    start: string;
    end: string;
    display: string;
    timezone: string;
    score: number;
    reason: string;
    requires_manual_confirmation: boolean;
  }> = [];
  for (let cursor = new Date(rangeStart); addMinutes(cursor, durationMinutes) <= rangeEnd; cursor = addMinutes(cursor, incrementMinutes)) {
    const end = addMinutes(cursor, durationMinutes);
    const parts = localParts(cursor, timezone);
    const endParts = localParts(end, timezone);
    if (input.business_days_only !== false && (parts.weekday === 'saturday' || parts.weekday === 'sunday')) continue;
    if (parts.minutes < businessStart || endParts.minutes > businessEnd) continue;
    if (busyIntervals.some(interval => overlaps(cursor, end, interval))) continue;
    const pref = preferenceScore(preferences, parts);
    const checkedScore = calendarChecks.filter(check => check.status === 'checked').length * 5;
    candidates.push({
      start: cursor.toISOString(),
      end: end.toISOString(),
      display: `${parts.label} - ${localParts(end, timezone).label}`,
      timezone,
      score: checkedScore + pref.score,
      reason: pref.reasons.length > 0
        ? `Free on checked internal calendars and ${pref.reasons.join('; ')}.`
        : calendarChecks.some(check => check.status === 'checked')
          ? 'Free on checked internal calendars.'
          : 'Fits requested business-hour constraints; no internal free/busy was checked.',
      requires_manual_confirmation: hasProviderFailure || calendarChecks.every(check => check.status !== 'checked'),
    });
  }

  candidates.sort((a, b) => b.score - a.score || new Date(a.start).getTime() - new Date(b.start).getTime());

  return {
    suggestions: candidates.slice(0, limit).map(({ score: _score, ...candidate }) => candidate),
    checked_actor_count: new Set(calendarChecks.filter(check => check.status === 'checked').map(check => check.actor_id).filter(Boolean)).size,
    checked_calendar_count: calendarChecks.filter(check => check.status === 'checked').length,
    calendar_checks: calendarChecks,
    customer_preferences: preferences.map(pref => ({
      id: pref.id,
      title: pref.title,
      body: pref.body,
      context_type: pref.context_type,
      updated_at: pref.updated_at,
      valid_until: pref.valid_until,
    })),
    range: {
      start: rangeStart.toISOString(),
      end: rangeEnd.toISOString(),
      duration_minutes: durationMinutes,
      timezone,
      business_hours_start: input.business_hours_start ?? '09:00',
      business_hours_end: input.business_hours_end ?? '17:00',
      business_days_only: input.business_days_only !== false,
    },
    evidence: {
      basis: 'provider_free_busy',
      checked_at: new Date().toISOString(),
      raw_calendar_event_details_returned: false,
      customer_availability_is_confirmed: false,
    },
    caveats: [...new Set(caveats)],
  };
}
