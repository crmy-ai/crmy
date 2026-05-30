// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import crypto from 'node:crypto';
import type { ActorContext, UUID } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';
import * as emailMessageRepo from '../db/repos/email-messages.js';
import * as calendarRepo from '../db/repos/calendar.js';
import { encrypt, decrypt } from '../agent/crypto.js';
import { ingestEmailMessage } from './customer-email.js';
import { upsertCalendarEventWithIntelligence } from './customer-activity.js';
import {
  getSourceFilterSettings,
  shouldKeepCalendarEventSource,
  shouldKeepEmailSource,
  sourceFilterStatKey,
  type SourceFilterReason,
} from './source-filters.js';

type Provider = 'google' | 'microsoft';
type SourceKind = 'mailbox' | 'calendar';

interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
}

interface OAuthState {
  kind: SourceKind;
  provider: Provider;
  tenant_id: UUID;
  user_id: UUID;
  email_address: string;
  display_name?: string;
  exp: number;
  nonce: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

interface SyncStats {
  customer_synced: number;
  filtered_internal: number;
  filtered_spam_trash: number;
  filtered_automated: number;
  filtered_unknown: number;
  needs_review: number;
  processed: number;
}

const SOURCE_SYNC_MAX_PAGES = Math.max(1, Number(process.env.SOURCE_SYNC_MAX_PAGES ?? 10));

function defaultStats(): SyncStats {
  return {
    customer_synced: 0,
    filtered_internal: 0,
    filtered_spam_trash: 0,
    filtered_automated: 0,
    filtered_unknown: 0,
    needs_review: 0,
    processed: 0,
  };
}

function bump(stats: SyncStats, reason: SourceFilterReason): void {
  const key = sourceFilterStatKey(reason) as keyof SyncStats;
  stats[key] = (stats[key] ?? 0) + 1;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function signingSecret(): string {
  return process.env.JWT_SECRET ?? process.env.AGENT_ENCRYPTION_KEY ?? 'crmy-dev-oauth-state';
}

function signState(payload: string): string {
  return crypto.createHmac('sha256', signingSecret()).update(payload).digest('base64url');
}

export function encodeOAuthState(state: Omit<OAuthState, 'exp' | 'nonce'>): string {
  const full: OAuthState = {
    ...state,
    exp: Math.floor(Date.now() / 1000) + 10 * 60,
    nonce: crypto.randomBytes(12).toString('hex'),
  };
  const payload = base64url(JSON.stringify(full));
  return `${payload}.${signState(payload)}`;
}

export function decodeOAuthState(value: string): OAuthState {
  const [payload, sig] = value.split('.');
  if (!payload || !sig || signState(payload) !== sig) throw new Error('Invalid OAuth state');
  const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as OAuthState;
  if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) throw new Error('OAuth state expired');
  return parsed;
}

function envFirst(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function appBaseUrl(reqOrigin?: string): string {
  return (envFirst(['CRMY_PUBLIC_URL', 'APP_BASE_URL', 'PUBLIC_APP_URL']) ?? reqOrigin ?? 'http://localhost:3000').replace(/\/$/, '');
}

export function oauthConfig(kind: SourceKind, provider: Provider, reqOrigin?: string): OAuthConfig | null {
  const base = appBaseUrl(reqOrigin);
  if (provider === 'google') {
    const clientId = envFirst(['GOOGLE_CLIENT_ID', kind === 'mailbox' ? 'GOOGLE_MAIL_CLIENT_ID' : 'GOOGLE_CALENDAR_CLIENT_ID']);
    const clientSecret = envFirst(['GOOGLE_CLIENT_SECRET', kind === 'mailbox' ? 'GOOGLE_MAIL_CLIENT_SECRET' : 'GOOGLE_CALENDAR_CLIENT_SECRET']);
    if (!clientId || !clientSecret) return null;
    return {
      clientId,
      clientSecret,
      redirectUri: envFirst([kind === 'mailbox' ? 'GOOGLE_MAIL_REDIRECT_URI' : 'GOOGLE_CALENDAR_REDIRECT_URI', 'GOOGLE_OAUTH_REDIRECT_URI'])
        ?? `${base}/api/v1/${kind === 'mailbox' ? 'mailbox' : 'calendar'}/oauth/google/callback`,
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: kind === 'mailbox'
        ? ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/gmail.readonly']
        : ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/calendar.readonly'],
    };
  }
  const clientId = envFirst(['MICROSOFT_CLIENT_ID', kind === 'mailbox' ? 'MICROSOFT_MAIL_CLIENT_ID' : 'MICROSOFT_CALENDAR_CLIENT_ID']);
  const clientSecret = envFirst(['MICROSOFT_CLIENT_SECRET', kind === 'mailbox' ? 'MICROSOFT_MAIL_CLIENT_SECRET' : 'MICROSOFT_CALENDAR_CLIENT_SECRET']);
  if (!clientId || !clientSecret) return null;
  const tenant = envFirst(['MICROSOFT_TENANT_ID']) ?? 'common';
  return {
    clientId,
    clientSecret,
    redirectUri: envFirst([kind === 'mailbox' ? 'MICROSOFT_MAIL_REDIRECT_URI' : 'MICROSOFT_CALENDAR_REDIRECT_URI', 'MICROSOFT_OAUTH_REDIRECT_URI'])
      ?? `${base}/api/v1/${kind === 'mailbox' ? 'mailbox' : 'calendar'}/oauth/microsoft/callback`,
    authUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    scopes: kind === 'mailbox'
      ? ['openid', 'email', 'profile', 'offline_access', 'Mail.Read']
      : ['openid', 'email', 'profile', 'offline_access', 'Calendars.Read'],
  };
}

export function buildOAuthUrl(kind: SourceKind, provider: Provider, state: Omit<OAuthState, 'exp' | 'nonce'>, reqOrigin?: string): string | null {
  const config = oauthConfig(kind, provider, reqOrigin);
  if (!config) return null;
  const url = new URL(config.authUrl);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', config.scopes.join(' '));
  url.searchParams.set('state', encodeOAuthState(state));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

async function exchangeCode(kind: SourceKind, provider: Provider, code: string, reqOrigin?: string): Promise<TokenResponse> {
  const config = oauthConfig(kind, provider, reqOrigin);
  if (!config) throw new Error(`${provider} OAuth credentials are not configured`);
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code',
  });
  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) throw new Error(`OAuth token exchange failed (${response.status})`);
  return await response.json() as TokenResponse;
}

async function refreshAccessToken(
  kind: SourceKind,
  provider: Provider,
  refreshToken: string,
  reqOrigin?: string,
): Promise<TokenResponse> {
  const config = oauthConfig(kind, provider, reqOrigin);
  if (!config) throw new Error(`${provider} OAuth credentials are not configured`);
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) throw new Error(`OAuth refresh failed (${response.status})`);
  return await response.json() as TokenResponse;
}

async function actorForUser(db: DbPool, tenantId: UUID, userId?: UUID | null): Promise<ActorContext | undefined> {
  if (!userId) return undefined;
  const result = await db.query(
    'SELECT id, role FROM users WHERE tenant_id = $1 AND id = $2 LIMIT 1',
    [tenantId, userId],
  );
  if (!result.rows[0]) return undefined;
  return {
    tenant_id: tenantId,
    actor_id: String(result.rows[0].id),
    actor_type: 'user',
    role: result.rows[0].role,
  };
}

function expiresAt(tokens: TokenResponse): string | null {
  return tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null;
}

export async function completeMailboxOAuth(
  db: DbPool,
  provider: Provider,
  code: string,
  stateValue: string,
  reqOrigin?: string,
): Promise<emailMessageRepo.MailboxConnection> {
  const state = decodeOAuthState(stateValue);
  if (state.kind !== 'mailbox' || state.provider !== provider) throw new Error('OAuth state does not match mailbox provider');
  const tokens = await exchangeCode('mailbox', provider, code, reqOrigin);
  const connection = await emailMessageRepo.createPlaceholderConnection(db, state.tenant_id, {
    user_id: state.user_id,
    provider,
    email_address: state.email_address,
    display_name: state.display_name ?? null,
    status: 'connected',
    last_error: null,
    settings: { setup_required: false },
  });
  const updated = await emailMessageRepo.updateMailboxConnection(db, state.tenant_id, connection.id, {
    status: 'connected',
    scopes: (tokens.scope ?? '').split(' ').filter(Boolean),
    access_token_enc: encrypt(tokens.access_token),
    ...(tokens.refresh_token ? { refresh_token_enc: encrypt(tokens.refresh_token) } : {}),
    token_expires_at: expiresAt(tokens),
    last_error: null,
  }) ?? connection;
  await emailMessageRepo.enqueueMailboxSyncJob(db, state.tenant_id, updated.id, { reason: 'oauth_connected' });
  return updated;
}

export async function completeCalendarOAuth(
  db: DbPool,
  provider: Provider,
  code: string,
  stateValue: string,
  reqOrigin?: string,
): Promise<calendarRepo.CalendarConnection> {
  const state = decodeOAuthState(stateValue);
  if (state.kind !== 'calendar' || state.provider !== provider) throw new Error('OAuth state does not match calendar provider');
  const tokens = await exchangeCode('calendar', provider, code, reqOrigin);
  const connection = await calendarRepo.createPlaceholderCalendarConnection(db, state.tenant_id, {
    user_id: state.user_id,
    provider,
    email_address: state.email_address,
    display_name: state.display_name ?? null,
    status: 'connected',
    last_error: null,
    settings: { setup_required: false },
  });
  const updated = await calendarRepo.updateCalendarConnection(db, state.tenant_id, connection.id, {
    status: 'connected',
    scopes: (tokens.scope ?? '').split(' ').filter(Boolean),
    access_token_enc: encrypt(tokens.access_token),
    ...(tokens.refresh_token ? { refresh_token_enc: encrypt(tokens.refresh_token) } : {}),
    token_expires_at: expiresAt(tokens),
    last_error: null,
  }) ?? connection;
  await calendarRepo.enqueueCalendarSyncJob(db, state.tenant_id, updated.id, { reason: 'oauth_connected' });
  return updated;
}

async function mailboxAccessToken(db: DbPool, connection: emailMessageRepo.MailboxConnection): Promise<string> {
  if (!connection.access_token_enc) throw new Error('Mailbox OAuth is not connected');
  const expires = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0;
  if (expires && expires > Date.now() + 60_000) return decrypt(connection.access_token_enc);
  if (!connection.refresh_token_enc) return decrypt(connection.access_token_enc);
  const tokens = await refreshAccessToken('mailbox', connection.provider as Provider, decrypt(connection.refresh_token_enc));
  await emailMessageRepo.updateMailboxConnection(db, connection.tenant_id, connection.id, {
    access_token_enc: encrypt(tokens.access_token),
    ...(tokens.refresh_token ? { refresh_token_enc: encrypt(tokens.refresh_token) } : {}),
    token_expires_at: expiresAt(tokens),
  });
  return tokens.access_token;
}

async function calendarAccessToken(db: DbPool, connection: calendarRepo.CalendarConnection): Promise<string> {
  if (!connection.access_token_enc) throw new Error('Calendar OAuth is not connected');
  const expires = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0;
  if (expires && expires > Date.now() + 60_000) return decrypt(connection.access_token_enc);
  if (!connection.refresh_token_enc) return decrypt(connection.access_token_enc);
  const tokens = await refreshAccessToken('calendar', connection.provider as Provider, decrypt(connection.refresh_token_enc));
  await calendarRepo.updateCalendarConnection(db, connection.tenant_id, connection.id, {
    access_token_enc: encrypt(tokens.access_token),
    ...(tokens.refresh_token ? { refresh_token_enc: encrypt(tokens.refresh_token) } : {}),
    token_expires_at: expiresAt(tokens),
  });
  return tokens.access_token;
}

function decodeGmailBody(value: string | undefined): string {
  if (!value) return '';
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function header(headers: Array<{ name?: string; value?: string }> | undefined, name: string): string | undefined {
  return headers?.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value;
}

function parseEmailAddress(value: string | undefined): { email: string; name?: string } {
  const raw = value ?? '';
  const match = raw.match(/^(.*?)<([^>]+)>$/);
  if (match) return { name: match[1].replace(/"/g, '').trim() || undefined, email: match[2].trim().toLowerCase() };
  const email = raw.split(',')[0]?.trim().toLowerCase() || 'unknown@local';
  return { email };
}

function parseEmailList(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(',').map(part => parseEmailAddress(part).email).filter(Boolean);
}

function gmailText(payload: any): { text: string; html?: string } {
  if (!payload) return { text: '' };
  if (payload.mimeType === 'text/plain') return { text: decodeGmailBody(payload.body?.data) };
  if (payload.mimeType === 'text/html') {
    const html = decodeGmailBody(payload.body?.data);
    return { text: stripHtml(html), html };
  }
  const parts = Array.isArray(payload.parts) ? payload.parts : [];
  const collected = parts.map(gmailText);
  const text = collected.map((part: { text: string; html?: string }) => part.text).filter(Boolean).join('\n\n');
  const html = collected.find((part: { text: string; html?: string }) => part.html)?.html;
  return { text, html };
}

async function fetchJson(url: string, token: string): Promise<any> {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Provider API request failed (${response.status})`);
  return await response.json();
}

async function syncGmail(db: DbPool, connection: emailMessageRepo.MailboxConnection, token: string, actor?: ActorContext): Promise<SyncStats> {
  const settings = await getSourceFilterSettings(db, connection.tenant_id);
  const stats = defaultStats();
  const after = Math.floor((Date.now() - settings.email_initial_backfill_days * 24 * 60 * 60 * 1000) / 1000);
  const messageIds = new Set<string>();
  let nextCursor = connection.sync_cursor ?? undefined;

  if (connection.sync_cursor) {
    let pageToken: string | undefined;
    let pages = 0;
    do {
      const historyUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/history');
      historyUrl.searchParams.set('startHistoryId', connection.sync_cursor);
      historyUrl.searchParams.set('historyTypes', 'messageAdded');
      historyUrl.searchParams.set('maxResults', '100');
      if (pageToken) historyUrl.searchParams.set('pageToken', pageToken);
      const listed = await fetchJson(historyUrl.toString(), token);
      for (const item of Array.isArray(listed.history) ? listed.history : []) {
        for (const added of Array.isArray(item.messagesAdded) ? item.messagesAdded : []) {
          const id = added?.message?.id;
          if (id) messageIds.add(String(id));
        }
      }
      nextCursor = listed.historyId ? String(listed.historyId) : nextCursor;
      pageToken = listed.nextPageToken ? String(listed.nextPageToken) : undefined;
      pages++;
    } while (pageToken && pages < SOURCE_SYNC_MAX_PAGES);
  } else {
    let pageToken: string | undefined;
    let pages = 0;
    do {
      const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
      listUrl.searchParams.set('maxResults', '100');
      listUrl.searchParams.set('q', `newer:${after}`);
      if (pageToken) listUrl.searchParams.set('pageToken', pageToken);
      const listed = await fetchJson(listUrl.toString(), token);
      for (const item of Array.isArray(listed.messages) ? listed.messages : []) {
        if (item.id) messageIds.add(String(item.id));
      }
      nextCursor = listed.historyId ? String(listed.historyId) : nextCursor;
      pageToken = listed.nextPageToken ? String(listed.nextPageToken) : undefined;
      pages++;
    } while (pageToken && pages < SOURCE_SYNC_MAX_PAGES);
  }

  for (const id of messageIds) {
    const raw = await fetchJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, token);
    const headers = raw.payload?.headers ?? [];
    const from = parseEmailAddress(header(headers, 'From'));
    const text = gmailText(raw.payload);
    const labels = Array.isArray(raw.labelIds) ? raw.labelIds.map(String) : [];
    const decision = shouldKeepEmailSource(settings, {
      from_email: from.email,
      from_name: from.name,
      to_emails: parseEmailList(header(headers, 'To')),
      cc_emails: parseEmailList(header(headers, 'Cc')),
      subject: header(headers, 'Subject') ?? '(no subject)',
      body_text: text.text,
      headers: Object.fromEntries(headers.map((h: any) => [String(h.name ?? '').toLowerCase(), String(h.value ?? '')])),
      mailbox_labels: labels,
    } as any);
    if (!decision.keep) {
      bump(stats, decision.reason);
      continue;
    }
    const result = await ingestEmailMessage(db, connection.tenant_id, {
      direction: 'inbound',
      source: 'gmail',
      mailbox_connection_id: connection.id,
      user_id: connection.user_id ?? null,
      from_email: from.email,
      from_name: from.name,
      to_emails: parseEmailList(header(headers, 'To')),
      cc_emails: parseEmailList(header(headers, 'Cc')),
      subject: header(headers, 'Subject') ?? '(no subject)',
      body_text: text.text,
      body_html: text.html,
      snippet: raw.snippet,
      provider_message_id: raw.id,
      message_id: header(headers, 'Message-Id') ?? raw.id,
      thread_id: raw.threadId,
      in_reply_to: header(headers, 'In-Reply-To'),
      references_header: (header(headers, 'References') ?? '').split(/\s+/).filter(Boolean),
      received_at: raw.internalDate ? new Date(Number(raw.internalDate)).toISOString() : undefined,
      metadata: { label_ids: labels, provider: 'gmail', filter_reason: decision.message },
    }, actor);
    stats.customer_synced++;
    if (result.processing_status === 'processed') stats.processed++;
    if (result.processing_status === 'needs_review') stats.needs_review++;
  }
  await emailMessageRepo.updateMailboxConnection(db, connection.tenant_id, connection.id, {
    sync_cursor: nextCursor,
    sync_stats: stats as unknown as Record<string, unknown>,
    last_sync_at: new Date().toISOString(),
    last_error: null,
    status: 'connected',
  });
  return stats;
}

async function syncMicrosoftMailbox(db: DbPool, connection: emailMessageRepo.MailboxConnection, token: string, actor?: ActorContext): Promise<SyncStats> {
  const settings = await getSourceFilterSettings(db, connection.tenant_id);
  const stats = defaultStats();
  const after = new Date(Date.now() - settings.email_initial_backfill_days * 24 * 60 * 60 * 1000).toISOString();
  let url: string | undefined = connection.sync_cursor
    ? connection.sync_cursor
    : `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$top=25&$select=id,conversationId,internetMessageId,subject,body,bodyPreview,from,toRecipients,ccRecipients,receivedDateTime,internetMessageHeaders&$filter=receivedDateTime ge ${after}`;
  let nextCursor = connection.sync_cursor ?? undefined;
  let pages = 0;
  while (url && pages < SOURCE_SYNC_MAX_PAGES) {
    const data = await fetchJson(url, token);
    const rows = Array.isArray(data.value) ? data.value : [];
    for (const raw of rows) {
    const from = raw.from?.emailAddress ?? {};
    const to = (raw.toRecipients ?? []).map((r: any) => r.emailAddress?.address).filter(Boolean);
    const cc = (raw.ccRecipients ?? []).map((r: any) => r.emailAddress?.address).filter(Boolean);
    const bodyHtml = raw.body?.contentType === 'html' ? raw.body?.content : undefined;
    const text = raw.body?.contentType === 'html' ? stripHtml(raw.body?.content ?? '') : raw.body?.content ?? raw.bodyPreview ?? '';
    const decision = shouldKeepEmailSource(settings, {
      from_email: from.address,
      to_emails: to,
      cc_emails: cc,
      subject: raw.subject,
      body_text: text,
      headers: Object.fromEntries((raw.internetMessageHeaders ?? []).map((h: any) => [String(h.name ?? '').toLowerCase(), String(h.value ?? '')])),
      folder: 'inbox',
    });
    if (!decision.keep) {
      bump(stats, decision.reason);
      continue;
    }
    const result = await ingestEmailMessage(db, connection.tenant_id, {
      direction: 'inbound',
      source: 'microsoft',
      mailbox_connection_id: connection.id,
      user_id: connection.user_id ?? null,
      from_email: from.address,
      from_name: from.name,
      to_emails: to,
      cc_emails: cc,
      subject: raw.subject ?? '(no subject)',
      body_text: text,
      body_html: bodyHtml,
      snippet: raw.bodyPreview,
      provider_message_id: raw.id,
      message_id: raw.internetMessageId ?? raw.id,
      thread_id: raw.conversationId,
      received_at: raw.receivedDateTime,
      metadata: { provider: 'microsoft', filter_reason: decision.message },
    }, actor);
    stats.customer_synced++;
    if (result.processing_status === 'processed') stats.processed++;
    if (result.processing_status === 'needs_review') stats.needs_review++;
    }
    nextCursor = data['@odata.deltaLink'] ?? data['@odata.nextLink'] ?? nextCursor;
    url = data['@odata.nextLink'] ?? undefined;
    pages++;
  }
  await emailMessageRepo.updateMailboxConnection(db, connection.tenant_id, connection.id, {
    sync_cursor: nextCursor,
    sync_stats: stats as unknown as Record<string, unknown>,
    last_sync_at: new Date().toISOString(),
    last_error: null,
    status: 'connected',
  });
  return stats;
}

function googleMeetingUrl(event: any): string | null {
  return event.hangoutLink ?? event.conferenceData?.entryPoints?.find((entry: any) => entry.uri)?.uri ?? null;
}

function calendarStatus(status: string | undefined): calendarRepo.CalendarEventStatus {
  if (status === 'cancelled') return 'cancelled';
  return 'scheduled';
}

async function syncGoogleCalendar(db: DbPool, connection: calendarRepo.CalendarConnection, token: string, actor?: ActorContext): Promise<SyncStats> {
  const settings = await getSourceFilterSettings(db, connection.tenant_id);
  const stats = defaultStats();
  const timeMin = new Date(Date.now() - settings.calendar_initial_past_days * 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(Date.now() + settings.calendar_initial_future_days * 24 * 60 * 60 * 1000).toISOString();
  const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('maxResults', '50');
  url.searchParams.set('orderBy', 'startTime');
  if (connection.sync_cursor) url.searchParams.set('syncToken', connection.sync_cursor);
  else {
    url.searchParams.set('timeMin', timeMin);
    url.searchParams.set('timeMax', timeMax);
  }
  let pageToken: string | undefined;
  let nextCursor = connection.sync_cursor ?? undefined;
  let pages = 0;
  do {
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const data = await fetchJson(url.toString(), token);
    const events = Array.isArray(data.items) ? data.items : [];
    for (const raw of events) {
    const attendees = (raw.attendees ?? []).map((a: any) => String(a.email ?? '').toLowerCase()).filter(Boolean);
    const organizer = raw.organizer?.email ?? connection.email_address;
    const decision = shouldKeepCalendarEventSource(settings, {
      organizer_email: organizer,
      attendee_emails: attendees,
      title: raw.summary,
    });
    if (!decision.keep) {
      bump(stats, decision.reason);
      continue;
    }
    await upsertCalendarEventWithIntelligence(db, connection.tenant_id, {
      calendar_connection_id: connection.id,
      user_id: connection.user_id ?? null,
      provider: 'google',
      provider_event_id: raw.id,
      i_cal_uid: raw.iCalUID,
      title: raw.summary ?? '(untitled meeting)',
      description: raw.description,
      organizer_email: organizer,
      organizer_name: raw.organizer?.displayName,
      attendee_emails: attendees,
      attendee_names: (raw.attendees ?? []).map((a: any) => String(a.displayName ?? '')).filter(Boolean),
      meeting_url: googleMeetingUrl(raw),
      location: raw.location,
      starts_at: raw.start?.dateTime ?? raw.start?.date ?? new Date().toISOString(),
      ends_at: raw.end?.dateTime ?? raw.end?.date,
      status: calendarStatus(raw.status),
      metadata: { provider: 'google', filter_reason: decision.message },
    }, actor);
    stats.customer_synced++;
    }
    nextCursor = data.nextSyncToken ?? nextCursor;
    pageToken = data.nextPageToken ? String(data.nextPageToken) : undefined;
    pages++;
  } while (pageToken && pages < SOURCE_SYNC_MAX_PAGES);
  await calendarRepo.updateCalendarConnection(db, connection.tenant_id, connection.id, {
    sync_cursor: nextCursor,
    sync_stats: stats as unknown as Record<string, unknown>,
    last_sync_at: new Date().toISOString(),
    last_error: null,
    status: 'connected',
  });
  return stats;
}

async function syncMicrosoftCalendar(db: DbPool, connection: calendarRepo.CalendarConnection, token: string, actor?: ActorContext): Promise<SyncStats> {
  const settings = await getSourceFilterSettings(db, connection.tenant_id);
  const stats = defaultStats();
  const start = new Date(Date.now() - settings.calendar_initial_past_days * 24 * 60 * 60 * 1000).toISOString();
  const end = new Date(Date.now() + settings.calendar_initial_future_days * 24 * 60 * 60 * 1000).toISOString();
  let url: string | undefined = connection.sync_cursor
    ? connection.sync_cursor
    : `https://graph.microsoft.com/v1.0/me/calendarView/delta?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}&$top=50`;
  let nextCursor = connection.sync_cursor ?? undefined;
  let pages = 0;
  while (url && pages < SOURCE_SYNC_MAX_PAGES) {
    const data = await fetchJson(url, token);
    const events = Array.isArray(data.value) ? data.value : [];
    for (const raw of events) {
    const attendees = (raw.attendees ?? []).map((a: any) => String(a.emailAddress?.address ?? '').toLowerCase()).filter(Boolean);
    const organizer = raw.organizer?.emailAddress?.address ?? connection.email_address;
    const decision = shouldKeepCalendarEventSource(settings, {
      organizer_email: organizer,
      attendee_emails: attendees,
      title: raw.subject,
    });
    if (!decision.keep) {
      bump(stats, decision.reason);
      continue;
    }
    await upsertCalendarEventWithIntelligence(db, connection.tenant_id, {
      calendar_connection_id: connection.id,
      user_id: connection.user_id ?? null,
      provider: 'microsoft',
      provider_event_id: raw.id,
      i_cal_uid: raw.iCalUId,
      title: raw.subject ?? '(untitled meeting)',
      description: raw.body?.contentType === 'html' ? stripHtml(raw.body?.content ?? '') : raw.body?.content,
      organizer_email: organizer,
      organizer_name: raw.organizer?.emailAddress?.name,
      attendee_emails: attendees,
      attendee_names: (raw.attendees ?? []).map((a: any) => String(a.emailAddress?.name ?? '')).filter(Boolean),
      meeting_url: raw.onlineMeeting?.joinUrl ?? raw.onlineMeetingUrl,
      location: raw.location?.displayName,
      starts_at: raw.start?.dateTime ? new Date(raw.start.dateTime).toISOString() : new Date().toISOString(),
      ends_at: raw.end?.dateTime ? new Date(raw.end.dateTime).toISOString() : undefined,
      status: raw.isCancelled ? 'cancelled' : 'scheduled',
      metadata: { provider: 'microsoft', filter_reason: decision.message },
    }, actor);
    stats.customer_synced++;
    }
    nextCursor = data['@odata.deltaLink'] ?? data['@odata.nextLink'] ?? nextCursor;
    url = data['@odata.nextLink'] ?? undefined;
    pages++;
  }
  await calendarRepo.updateCalendarConnection(db, connection.tenant_id, connection.id, {
    sync_cursor: nextCursor,
    sync_stats: stats as unknown as Record<string, unknown>,
    last_sync_at: new Date().toISOString(),
    last_error: null,
    status: 'connected',
  });
  return stats;
}

export async function syncMailboxConnection(db: DbPool, tenantId: UUID, connectionId: UUID): Promise<SyncStats> {
  const connection = await emailMessageRepo.getMailboxConnection(db, tenantId, connectionId);
  if (!connection) throw new Error('Mailbox connection not found');
  await emailMessageRepo.updateMailboxConnection(db, tenantId, connection.id, { status: 'syncing', last_error: null });
  const actor = await actorForUser(db, tenantId, connection.user_id);
  const token = await mailboxAccessToken(db, connection);
  return connection.provider === 'google'
    ? syncGmail(db, connection, token, actor)
    : syncMicrosoftMailbox(db, connection, token, actor);
}

export async function syncCalendarConnection(db: DbPool, tenantId: UUID, connectionId: UUID): Promise<SyncStats> {
  const connection = await calendarRepo.getCalendarConnection(db, tenantId, connectionId);
  if (!connection) throw new Error('Calendar connection not found');
  await calendarRepo.updateCalendarConnection(db, tenantId, connection.id, { status: 'syncing', last_error: null });
  const actor = await actorForUser(db, tenantId, connection.user_id);
  const token = await calendarAccessToken(db, connection);
  return connection.provider === 'google'
    ? syncGoogleCalendar(db, connection, token, actor)
    : syncMicrosoftCalendar(db, connection, token, actor);
}
