// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import crypto from 'node:crypto';
import { CrmyError, type ActorContext, type UUID } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';
import * as emailMessageRepo from '../db/repos/email-messages.js';
import * as calendarRepo from '../db/repos/calendar.js';
import { encrypt, decrypt } from '../agent/crypto.js';
import { encryptSecret, decryptSecret } from '../lib/secrets.js';
import { ingestEmailMessage, previewEmailAssociation, type NormalizedEmailInput } from './customer-email.js';
import { upsertCalendarEventWithIntelligence } from './customer-activity.js';
import { getDirectOwnerIds, getVisibleOwnerIds } from './access-control.js';
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
  source: 'tenant_owned' | 'crmy_managed' | 'self_hosted_env';
}

type OAuthSetupStatus = 'ready' | 'tenant_app_incomplete' | 'managed_app_unavailable' | 'self_hosted_env_missing';

export interface OAuthReadinessItem {
  kind: SourceKind;
  provider: Provider;
  label: string;
  configured: boolean;
  ready: boolean;
  can_start_oauth: boolean;
  setup_status: OAuthSetupStatus;
  setup_blockers: string[];
  admin_action: string;
  user_action: string;
  redirect_uri: string;
  callback_path: string;
  accepted_env_vars: {
    client_id: string[];
    client_secret: string[];
    redirect_uri: string[];
  };
  configured_env_vars: string[];
  missing_env_vars: string[];
  scopes: {
    context: string[];
    send?: string[];
    drafts?: string[];
  };
  app_source: 'tenant_owned' | 'crmy_managed' | 'self_hosted_env' | 'missing';
  tenant_owned_configured: boolean;
  crmy_managed_available: boolean;
  self_hosted_env_configured: boolean;
  hosted_managed_enabled: boolean;
}

interface OAuthState {
  kind: SourceKind;
  provider: Provider;
  tenant_id: UUID;
  user_id: UUID;
  email_address: string;
  display_name?: string;
  context_sync_enabled?: boolean;
  account_ingest_scope?: AccountIngestScope;
  meeting_ingest_scope?: MeetingIngestScope;
  send_enabled?: boolean;
  provider_draft_enabled?: boolean;
  is_default_sender?: boolean;
  oauth_client_id?: string;
  oauth_app_source?: OAuthConfig['source'];
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

export interface MailboxSendAsAlias {
  email_address: string;
  display_name?: string;
  is_primary?: boolean;
  is_default?: boolean;
  verified: boolean;
  source: Provider;
}

interface SyncStats {
  customer_synced: number;
  out_of_scope_skipped: number;
  filtered_internal: number;
  filtered_spam_trash: number;
  filtered_automated: number;
  filtered_unknown: number;
  needs_review: number;
  processed: number;
  recovery_note?: string;
}

type SyncStatCounter = Exclude<keyof SyncStats, 'recovery_note'>;
type AccountIngestScope = 'owned_accounts' | 'accessible_accounts';
type MeetingIngestScope = 'owned_accounts' | 'accessible_accounts' | 'all_meetings';

const SOURCE_SYNC_MAX_PAGES = Math.max(1, Number(process.env.SOURCE_SYNC_MAX_PAGES ?? 10));
const SOURCE_SYNC_FETCH_TIMEOUT_MS = Number(process.env.SOURCE_SYNC_FETCH_TIMEOUT_MS ?? 30_000);

function defaultStats(): SyncStats {
  return {
    customer_synced: 0,
    out_of_scope_skipped: 0,
    filtered_internal: 0,
    filtered_spam_trash: 0,
    filtered_automated: 0,
    filtered_unknown: 0,
    needs_review: 0,
    processed: 0,
  };
}

function bump(stats: SyncStats, reason: SourceFilterReason): void {
  const key = sourceFilterStatKey(reason) as SyncStatCounter;
  stats[key] = stats[key] + 1;
}

function accountIngestScope(connection: emailMessageRepo.MailboxConnection): AccountIngestScope {
  const value = connection.settings?.account_ingest_scope;
  return value === 'accessible_accounts' ? 'accessible_accounts' : 'owned_accounts';
}

function meetingIngestScope(connection: calendarRepo.CalendarConnection): MeetingIngestScope {
  const value = connection.settings?.meeting_ingest_scope;
  if (value === 'accessible_accounts' || value === 'all_meetings') return value;
  return 'owned_accounts';
}

async function ownerIdsForIngestScope(
  db: DbPool,
  actor: ActorContext | undefined,
  scope: AccountIngestScope | MeetingIngestScope,
): Promise<UUID[] | null | undefined> {
  if (!actor) return undefined;
  if (scope === 'all_meetings') return undefined;
  return scope === 'accessible_accounts'
    ? getVisibleOwnerIds(db, actor)
    : getDirectOwnerIds(db, actor);
}

async function keepEmailForConnectionScope(
  db: DbPool,
  connection: emailMessageRepo.MailboxConnection,
  input: NormalizedEmailInput,
  actor: ActorContext | undefined,
): Promise<boolean> {
  const ownerIds = await ownerIdsForIngestScope(db, actor, accountIngestScope(connection));
  const association = await previewEmailAssociation(db, connection.tenant_id, input, ownerIds);
  return association.has_linked_subject && association.in_owner_scope;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function signingSecret(): string {
  return process.env.JWT_SECRET ?? process.env.CRMY_ENCRYPTION_KEY ?? process.env.AGENT_ENCRYPTION_KEY ?? 'crmy-dev-oauth-state';
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

function envFlag(name: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env[name] ?? '').trim().toLowerCase());
}

function normalizeLoopbackOAuthOrigin(origin: string): string {
  try {
    const url = new URL(origin);
    if (url.hostname === '127.0.0.1' || url.hostname === '::1' || url.hostname === '[::1]') {
      return `${url.protocol}//localhost${url.port ? `:${url.port}` : ''}`;
    }
  } catch {
    return origin;
  }
  return origin;
}

function appBaseUrl(reqOrigin?: string): string {
  const configured = envFirst(['CRMY_PUBLIC_URL', 'APP_BASE_URL', 'PUBLIC_APP_URL']);
  return (configured ?? normalizeLoopbackOAuthOrigin(reqOrigin ?? 'http://localhost:3000')).replace(/\/$/, '');
}

function configuredEnvNames(names: string[]): string[] {
  return names.filter(name => Boolean(process.env[name]?.trim()));
}

function oauthEnvGroups(kind: SourceKind, provider: Provider): OAuthReadinessItem['accepted_env_vars'] {
  if (provider === 'google') {
    return {
      client_id: ['GOOGLE_CLIENT_ID', kind === 'mailbox' ? 'GOOGLE_MAIL_CLIENT_ID' : 'GOOGLE_CALENDAR_CLIENT_ID'],
      client_secret: ['GOOGLE_CLIENT_SECRET', kind === 'mailbox' ? 'GOOGLE_MAIL_CLIENT_SECRET' : 'GOOGLE_CALENDAR_CLIENT_SECRET'],
      redirect_uri: [kind === 'mailbox' ? 'GOOGLE_MAIL_REDIRECT_URI' : 'GOOGLE_CALENDAR_REDIRECT_URI', 'GOOGLE_OAUTH_REDIRECT_URI'],
    };
  }
  return {
    client_id: ['MICROSOFT_CLIENT_ID', kind === 'mailbox' ? 'MICROSOFT_MAIL_CLIENT_ID' : 'MICROSOFT_CALENDAR_CLIENT_ID'],
    client_secret: ['MICROSOFT_CLIENT_SECRET', kind === 'mailbox' ? 'MICROSOFT_MAIL_CLIENT_SECRET' : 'MICROSOFT_CALENDAR_CLIENT_SECRET'],
    redirect_uri: [kind === 'mailbox' ? 'MICROSOFT_MAIL_REDIRECT_URI' : 'MICROSOFT_CALENDAR_REDIRECT_URI', 'MICROSOFT_OAUTH_REDIRECT_URI'],
  };
}

function defaultRedirectUri(kind: SourceKind, provider: Provider, reqOrigin?: string): string {
  const base = appBaseUrl(reqOrigin);
  return `${base}/api/v1/${kind === 'mailbox' ? 'mailbox' : 'calendar'}/oauth/${provider}/callback`;
}

function hostedManagedOAuthEnabled(): boolean {
  return envFlag('CRMY_HOSTED_OAUTH_APPS_ENABLED') || envFlag('CRMY_MANAGED_OAUTH_APPS_ENABLED');
}

function managedEnvGroups(provider: Provider): { client_id: string[]; client_secret: string[]; microsoft_tenant_id: string[] } {
  if (provider === 'google') {
    return {
      client_id: ['CRMY_MANAGED_GOOGLE_CLIENT_ID', 'CRMY_HOSTED_GOOGLE_CLIENT_ID'],
      client_secret: ['CRMY_MANAGED_GOOGLE_CLIENT_SECRET', 'CRMY_HOSTED_GOOGLE_CLIENT_SECRET'],
      microsoft_tenant_id: [],
    };
  }
  return {
    client_id: ['CRMY_MANAGED_MICROSOFT_CLIENT_ID', 'CRMY_HOSTED_MICROSOFT_CLIENT_ID'],
    client_secret: ['CRMY_MANAGED_MICROSOFT_CLIENT_SECRET', 'CRMY_HOSTED_MICROSOFT_CLIENT_SECRET'],
    microsoft_tenant_id: ['CRMY_MANAGED_MICROSOFT_TENANT_ID', 'CRMY_HOSTED_MICROSOFT_TENANT_ID'],
  };
}

interface TenantOAuthAppConfig {
  id: UUID;
  tenant_id: UUID;
  provider: Provider;
  enabled: boolean;
  client_id: string;
  client_secret_enc: unknown;
  microsoft_tenant_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface TenantOAuthAppPublic {
  provider: Provider;
  enabled: boolean;
  client_id?: string;
  has_client_secret: boolean;
  microsoft_tenant_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

async function getTenantOAuthApp(db: DbPool, tenantId: UUID, provider: Provider): Promise<TenantOAuthAppConfig | null> {
  const result = await db.query(
    `SELECT id, tenant_id, provider, enabled, client_id, client_secret_enc, microsoft_tenant_id, created_at, updated_at
     FROM tenant_oauth_apps
     WHERE tenant_id = $1 AND provider = $2
     LIMIT 1`,
    [tenantId, provider],
  );
  return (result.rows[0] as TenantOAuthAppConfig | undefined) ?? null;
}

function decryptTenantOAuthSecret(row: TenantOAuthAppConfig): string | null {
  const decrypted = decryptSecret<{ client_secret?: string }>(row.client_secret_enc);
  const secret = typeof decrypted.client_secret === 'string' ? decrypted.client_secret.trim() : '';
  return secret || null;
}

function publicTenantOAuthApp(row: TenantOAuthAppConfig): TenantOAuthAppPublic {
  return {
    provider: row.provider,
    enabled: row.enabled,
    client_id: row.client_id,
    has_client_secret: Boolean(row.client_secret_enc),
    microsoft_tenant_id: row.microsoft_tenant_id ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listTenantOAuthApps(db: DbPool, tenantId: UUID): Promise<TenantOAuthAppPublic[]> {
  const result = await db.query(
    `SELECT id, tenant_id, provider, enabled, client_id, client_secret_enc, microsoft_tenant_id, created_at, updated_at
     FROM tenant_oauth_apps
     WHERE tenant_id = $1
     ORDER BY provider ASC`,
    [tenantId],
  );
  return (result.rows as TenantOAuthAppConfig[]).map(publicTenantOAuthApp);
}

export async function upsertTenantOAuthApp(
  db: DbPool,
  tenantId: UUID,
  provider: Provider,
  input: { client_id: string; client_secret?: string; microsoft_tenant_id?: string | null; enabled?: boolean },
  actorId?: UUID,
): Promise<TenantOAuthAppPublic> {
  const clientId = input.client_id.trim();
  if (!clientId) throw new Error('OAuth client ID is required');
  const existing = await getTenantOAuthApp(db, tenantId, provider);
  const clientSecret = input.client_secret?.trim();
  if (!existing && !clientSecret) throw new Error('OAuth client secret is required when creating a tenant-owned app');
  const encryptedSecret = clientSecret
    ? encryptSecret({ client_secret: clientSecret })
    : existing?.client_secret_enc;
  const enabled = input.enabled !== false;
  const microsoftTenantId = provider === 'microsoft'
    ? (input.microsoft_tenant_id?.trim() || 'common')
    : null;
  const result = await db.query(
    `INSERT INTO tenant_oauth_apps
       (tenant_id, provider, enabled, client_id, client_secret_enc, microsoft_tenant_id, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
     ON CONFLICT (tenant_id, provider) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       client_id = EXCLUDED.client_id,
       client_secret_enc = EXCLUDED.client_secret_enc,
       microsoft_tenant_id = EXCLUDED.microsoft_tenant_id,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()
     RETURNING id, tenant_id, provider, enabled, client_id, client_secret_enc, microsoft_tenant_id, created_at, updated_at`,
    [tenantId, provider, enabled, clientId, JSON.stringify(encryptedSecret), microsoftTenantId, actorId ?? null],
  );
  return publicTenantOAuthApp(result.rows[0] as TenantOAuthAppConfig);
}

export async function deleteTenantOAuthApp(db: DbPool, tenantId: UUID, provider: Provider): Promise<boolean> {
  const result = await db.query(
    'DELETE FROM tenant_oauth_apps WHERE tenant_id = $1 AND provider = $2',
    [tenantId, provider],
  );
  return (result.rowCount ?? 0) > 0;
}

function scopeGroups(kind: SourceKind, provider: Provider): OAuthReadinessItem['scopes'] {
  if (kind === 'calendar') {
    return {
      context: provider === 'google'
        ? ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/calendar.readonly']
        : ['openid', 'email', 'profile', 'offline_access', 'Calendars.Read'],
    };
  }
  if (provider === 'google') {
    return {
      context: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/gmail.readonly'],
      send: ['https://www.googleapis.com/auth/gmail.send'],
      drafts: ['https://www.googleapis.com/auth/gmail.compose'],
    };
  }
  return {
    context: ['openid', 'email', 'profile', 'offline_access', 'User.Read', 'Mail.Read'],
    send: ['Mail.Send'],
    drafts: ['Mail.ReadWrite'],
  };
}

function buildProviderConfig(
  kind: SourceKind,
  provider: Provider,
  source: OAuthConfig['source'],
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  options: { send_enabled?: boolean; provider_draft_enabled?: boolean } = {},
  microsoftTenantId?: string | null,
): OAuthConfig {
  if (provider === 'google') {
    return {
      clientId,
      clientSecret,
      redirectUri,
      source,
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: kind === 'mailbox'
        ? [
            'openid',
            'email',
            'profile',
            'https://www.googleapis.com/auth/gmail.readonly',
            ...(options.send_enabled ? ['https://www.googleapis.com/auth/gmail.send'] : []),
            ...(options.provider_draft_enabled ? ['https://www.googleapis.com/auth/gmail.compose'] : []),
          ]
        : ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/calendar.readonly'],
    };
  }
  const tenant = microsoftTenantId?.trim() || 'common';
  return {
    clientId,
    clientSecret,
    redirectUri,
    source,
    authUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    scopes: kind === 'mailbox'
      ? [
          'openid',
          'email',
          'profile',
          'offline_access',
          'User.Read',
          'Mail.Read',
          ...(options.send_enabled ? ['Mail.Send'] : []),
          ...(options.provider_draft_enabled ? ['Mail.ReadWrite'] : []),
        ]
      : ['openid', 'email', 'profile', 'offline_access', 'Calendars.Read'],
  };
}

function selfHostedOAuthConfig(
  kind: SourceKind,
  provider: Provider,
  reqOrigin?: string,
  options: { send_enabled?: boolean; provider_draft_enabled?: boolean } = {},
): OAuthConfig | null {
  const base = appBaseUrl(reqOrigin);
  if (provider === 'google') {
    const clientId = envFirst(['GOOGLE_CLIENT_ID', kind === 'mailbox' ? 'GOOGLE_MAIL_CLIENT_ID' : 'GOOGLE_CALENDAR_CLIENT_ID']);
    const clientSecret = envFirst(['GOOGLE_CLIENT_SECRET', kind === 'mailbox' ? 'GOOGLE_MAIL_CLIENT_SECRET' : 'GOOGLE_CALENDAR_CLIENT_SECRET']);
    if (!clientId || !clientSecret) return null;
    return buildProviderConfig(
      kind,
      provider,
      'self_hosted_env',
      clientId,
      clientSecret,
      envFirst([kind === 'mailbox' ? 'GOOGLE_MAIL_REDIRECT_URI' : 'GOOGLE_CALENDAR_REDIRECT_URI', 'GOOGLE_OAUTH_REDIRECT_URI'])
        ?? `${base}/api/v1/${kind === 'mailbox' ? 'mailbox' : 'calendar'}/oauth/google/callback`,
      options,
    );
  }
  const clientId = envFirst(['MICROSOFT_CLIENT_ID', kind === 'mailbox' ? 'MICROSOFT_MAIL_CLIENT_ID' : 'MICROSOFT_CALENDAR_CLIENT_ID']);
  const clientSecret = envFirst(['MICROSOFT_CLIENT_SECRET', kind === 'mailbox' ? 'MICROSOFT_MAIL_CLIENT_SECRET' : 'MICROSOFT_CALENDAR_CLIENT_SECRET']);
  if (!clientId || !clientSecret) return null;
  const tenant = envFirst(['MICROSOFT_TENANT_ID']) ?? 'common';
  return buildProviderConfig(
    kind,
    provider,
    'self_hosted_env',
    clientId,
    clientSecret,
    envFirst([kind === 'mailbox' ? 'MICROSOFT_MAIL_REDIRECT_URI' : 'MICROSOFT_CALENDAR_REDIRECT_URI', 'MICROSOFT_OAUTH_REDIRECT_URI'])
      ?? `${base}/api/v1/${kind === 'mailbox' ? 'mailbox' : 'calendar'}/oauth/microsoft/callback`,
    options,
    tenant,
  );
}

function managedOAuthConfig(
  kind: SourceKind,
  provider: Provider,
  reqOrigin?: string,
  options: { send_enabled?: boolean; provider_draft_enabled?: boolean } = {},
): OAuthConfig | null {
  if (!hostedManagedOAuthEnabled()) return null;
  const envGroups = managedEnvGroups(provider);
  const clientId = envFirst(envGroups.client_id);
  const clientSecret = envFirst(envGroups.client_secret);
  if (!clientId || !clientSecret) return null;
  return buildProviderConfig(
    kind,
    provider,
    'crmy_managed',
    clientId,
    clientSecret,
    defaultRedirectUri(kind, provider, reqOrigin),
    options,
    provider === 'microsoft' ? (envFirst(envGroups.microsoft_tenant_id) ?? 'common') : null,
  );
}

function providerSuiteLabel(provider: Provider): string {
  return provider === 'google' ? 'Google Workspace' : 'Microsoft 365';
}

function capabilityLabel(kind: SourceKind, provider: Provider): string {
  return kind === 'mailbox'
    ? (provider === 'google' ? 'Gmail' : 'Outlook Mail')
    : (provider === 'google' ? 'Google Calendar' : 'Outlook Calendar');
}

function readinessActions(
  kind: SourceKind,
  provider: Provider,
  config: OAuthConfig | null,
  input: {
    tenantApp?: TenantOAuthAppConfig | null;
    managedConfigured: boolean;
    selfHostedConfigured: boolean;
    missingEnvVars: string[];
  },
): Pick<OAuthReadinessItem, 'can_start_oauth' | 'setup_status' | 'setup_blockers' | 'admin_action' | 'user_action'> {
  const destination = kind === 'mailbox'
    ? 'Customer Email -> Mailboxes & Senders'
    : 'Customer Activity -> Connections';
  if (config) {
    const sourceLabel = config.source === 'tenant_owned'
      ? 'the tenant-owned OAuth app'
      : config.source === 'crmy_managed'
        ? 'the CRMy-managed OAuth app'
        : 'self-hosted environment credentials';
    return {
      can_start_oauth: true,
      setup_status: 'ready',
      setup_blockers: [],
      admin_action: `${capabilityLabel(kind, provider)} is ready through ${sourceLabel}. Users can connect from ${destination}.`,
      user_action: `Connect from ${destination}.`,
    };
  }

  const blockers: string[] = [];
  let setupStatus: OAuthSetupStatus = 'self_hosted_env_missing';
  const providerLabel = providerSuiteLabel(provider);
  if (input.tenantApp?.enabled && (!input.tenantApp.client_id || !input.tenantApp.client_secret_enc)) {
    setupStatus = 'tenant_app_incomplete';
    blockers.push(`The tenant-owned ${providerLabel} app is enabled but missing a Client ID or Client Secret.`);
  }
  if (hostedManagedOAuthEnabled() && !input.managedConfigured) {
    setupStatus = setupStatus === 'tenant_app_incomplete' ? setupStatus : 'managed_app_unavailable';
    blockers.push(`CRMy-managed ${providerLabel} OAuth is enabled for this deployment, but managed client credentials are missing.`);
  }
  if (!input.selfHostedConfigured) {
    blockers.push(`Self-hosted ${providerLabel} OAuth credentials are missing: ${input.missingEnvVars.join(', ')}.`);
  }
  if (blockers.length === 0) {
    blockers.push(`No usable ${providerLabel} OAuth app source is configured for ${capabilityLabel(kind, provider)}.`);
  }

  return {
    can_start_oauth: false,
    setup_status: setupStatus,
    setup_blockers: blockers,
    admin_action: `Before users connect, save an enterprise app for ${providerLabel}, enable CRMy-managed OAuth credentials, or configure the missing self-hosted environment variables.`,
    user_action: `Ask an admin to finish ${providerLabel} OAuth setup before connecting from ${destination}.`,
  };
}

export async function oauthConfig(
  db: DbPool,
  tenantId: UUID,
  kind: SourceKind,
  provider: Provider,
  reqOrigin?: string,
  options: { send_enabled?: boolean; provider_draft_enabled?: boolean } = {},
): Promise<OAuthConfig | null> {
  const tenantApp = await getTenantOAuthApp(db, tenantId, provider);
  if (tenantApp?.enabled) {
    const secret = decryptTenantOAuthSecret(tenantApp);
    if (tenantApp.client_id && secret) {
      return buildProviderConfig(
        kind,
        provider,
        'tenant_owned',
        tenantApp.client_id,
        secret,
        defaultRedirectUri(kind, provider, reqOrigin),
        options,
        tenantApp.microsoft_tenant_id,
      );
    }
  }
  return managedOAuthConfig(kind, provider, reqOrigin, options)
    ?? selfHostedOAuthConfig(kind, provider, reqOrigin, options);
}

async function oauthConfigForClientId(
  db: DbPool,
  tenantId: UUID,
  kind: SourceKind,
  provider: Provider,
  clientId: string | undefined,
  reqOrigin?: string,
  options: { send_enabled?: boolean; provider_draft_enabled?: boolean } = {},
): Promise<OAuthConfig | null> {
  const expectedClientId = clientId?.trim();
  if (!expectedClientId) return null;

  const tenantApp = await getTenantOAuthApp(db, tenantId, provider);
  const tenantSecret = tenantApp?.enabled ? decryptTenantOAuthSecret(tenantApp) : null;
  if (tenantApp?.enabled && tenantApp.client_id.trim() === expectedClientId && tenantSecret) {
    return buildProviderConfig(
      kind,
      provider,
      'tenant_owned',
      tenantApp.client_id,
      tenantSecret,
      defaultRedirectUri(kind, provider, reqOrigin),
      options,
      tenantApp.microsoft_tenant_id,
    );
  }

  const managedConfig = managedOAuthConfig(kind, provider, reqOrigin, options);
  if (managedConfig?.clientId.trim() === expectedClientId) return managedConfig;

  const selfHostedConfig = selfHostedOAuthConfig(kind, provider, reqOrigin, options);
  if (selfHostedConfig?.clientId.trim() === expectedClientId) return selfHostedConfig;

  return null;
}

export async function oauthReadiness(db: DbPool, tenantId: UUID, kind: SourceKind, provider: Provider, reqOrigin?: string): Promise<OAuthReadinessItem> {
  const envGroups = oauthEnvGroups(kind, provider);
  const configuredClientId = configuredEnvNames(envGroups.client_id);
  const configuredClientSecret = configuredEnvNames(envGroups.client_secret);
  const configuredRedirect = configuredEnvNames(envGroups.redirect_uri);
  const managedGroups = managedEnvGroups(provider);
  const managedConfigured = hostedManagedOAuthEnabled()
    && configuredEnvNames(managedGroups.client_id).length > 0
    && configuredEnvNames(managedGroups.client_secret).length > 0;
  const tenantApp = await getTenantOAuthApp(db, tenantId, provider);
  const tenantOwnedConfigured = Boolean(tenantApp?.enabled && tenantApp.client_id && tenantApp.client_secret_enc);
  const missingEnvVars = [
    ...(configuredClientId.length === 0 ? [envGroups.client_id[1] ?? envGroups.client_id[0]] : []),
    ...(configuredClientSecret.length === 0 ? [envGroups.client_secret[1] ?? envGroups.client_secret[0]] : []),
  ];
  const selfHostedConfigured = missingEnvVars.length === 0;
  const config = await oauthConfig(db, tenantId, kind, provider, reqOrigin, { send_enabled: true, provider_draft_enabled: true });
  const readiness = readinessActions(kind, provider, config, {
    tenantApp,
    managedConfigured,
    selfHostedConfigured,
    missingEnvVars,
  });
  return {
    kind,
    provider,
    label: capabilityLabel(kind, provider),
    configured: Boolean(config),
    ready: Boolean(config),
    ...readiness,
    redirect_uri: config?.redirectUri ?? defaultRedirectUri(kind, provider, reqOrigin),
    callback_path: `/api/v1/${kind === 'mailbox' ? 'mailbox' : 'calendar'}/oauth/${provider}/callback`,
    accepted_env_vars: envGroups,
    configured_env_vars: [...configuredClientId, ...configuredClientSecret, ...configuredRedirect],
    missing_env_vars: missingEnvVars,
    scopes: scopeGroups(kind, provider),
    app_source: config?.source ?? 'missing',
    tenant_owned_configured: tenantOwnedConfigured,
    crmy_managed_available: managedConfigured,
    self_hosted_env_configured: selfHostedConfigured,
    hosted_managed_enabled: hostedManagedOAuthEnabled(),
  };
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = SOURCE_SYNC_FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Provider API request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function buildOAuthUrl(db: DbPool, kind: SourceKind, provider: Provider, state: Omit<OAuthState, 'exp' | 'nonce'>, reqOrigin?: string): Promise<string | null> {
  const config = await oauthConfig(db, state.tenant_id, kind, provider, reqOrigin, {
    send_enabled: state.send_enabled,
    provider_draft_enabled: state.provider_draft_enabled,
  });
  if (!config) return null;
  const url = new URL(config.authUrl);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', config.scopes.join(' '));
  url.searchParams.set('state', encodeOAuthState({
    ...state,
    oauth_client_id: config.clientId,
    oauth_app_source: config.source,
  }));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

export function oauthCallbackErrorMessage(err: unknown, provider: Provider, kind: SourceKind): string {
  if (err instanceof CrmyError) return err.message;
  const message = err instanceof Error ? err.message : String(err);
  const providerLabel = providerSuiteLabel(provider);
  const destination = kind === 'mailbox' ? 'mailbox' : 'calendar';
  if (/OAuth token exchange failed \(400\)/i.test(message)) {
    return `${providerLabel} rejected the OAuth callback. Confirm the redirect URI in System Connections exactly matches the provider app, then reconnect this ${destination}.`;
  }
  if (/OAuth token exchange failed/i.test(message)) {
    return `${providerLabel} did not finish the OAuth token exchange. Confirm the active OAuth app client ID and secret are correct, then reconnect this ${destination}.`;
  }
  if (/OAuth refresh failed/i.test(message)) {
    return `${providerLabel} token refresh failed. Reconnect this ${destination} so CRMy receives a fresh grant.`;
  }
  if (/OAuth app changed or is no longer available/i.test(message)) {
    return `The OAuth app used for this ${destination} changed or is no longer available. Reconnect after an admin verifies System Connections.`;
  }
  if (/OAuth credentials are not configured/i.test(message)) {
    return `${providerLabel} OAuth is not ready yet. Ask an admin to verify System Connections before reconnecting this ${destination}.`;
  }
  return message || `Could not complete ${providerLabel} OAuth. Verify System Connections and try again.`;
}

async function exchangeCode(
  db: DbPool,
  tenantId: UUID,
  kind: SourceKind,
  provider: Provider,
  code: string,
  reqOrigin?: string,
  options: { send_enabled?: boolean; provider_draft_enabled?: boolean } = {},
  expectedClientId?: string,
): Promise<TokenResponse> {
  const config = expectedClientId
    ? await oauthConfigForClientId(db, tenantId, kind, provider, expectedClientId, reqOrigin, options)
    : await oauthConfig(db, tenantId, kind, provider, reqOrigin, options);
  if (!config) {
    throw new Error(expectedClientId
      ? `${provider} ${kind} OAuth app changed or is no longer available. Reauthorize this ${kind} connection.`
      : `${provider} OAuth credentials are not configured`);
  }
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code',
  });
  const response = await fetchWithTimeout(config.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) throw new Error(`OAuth token exchange failed (${response.status})`);
  return await response.json() as TokenResponse;
}

async function refreshAccessToken(
  db: DbPool,
  tenantId: UUID,
  kind: SourceKind,
  provider: Provider,
  refreshToken: string,
  expectedClientId?: string,
  reqOrigin?: string,
): Promise<TokenResponse> {
  const config = expectedClientId
    ? await oauthConfigForClientId(db, tenantId, kind, provider, expectedClientId, reqOrigin)
    : await oauthConfig(db, tenantId, kind, provider, reqOrigin);
  if (!config) {
    throw new Error(expectedClientId
      ? `${provider} ${kind} OAuth app changed or is no longer available. Reauthorize this ${kind} connection.`
      : `${provider} OAuth credentials are not configured`);
  }
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const response = await fetchWithTimeout(config.tokenUrl, {
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

function connectionOAuthClientId(settings: Record<string, unknown> | undefined): string | undefined {
  const value = settings?.oauth_client_id;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function mailboxGrantState(
  provider: Provider,
  grantedScopes: string[],
  requested: { send_enabled?: boolean; provider_draft_enabled?: boolean },
): {
  sendEnabled: boolean;
  providerDraftEnabled: boolean;
  sendStatus: emailMessageRepo.MailboxSendStatus;
  sendLastError?: string | null;
} {
  const scopeSet = new Set(grantedScopes.map(scope => scope.toLowerCase()));
  const has = (scope: string) => scopeSet.has(scope.toLowerCase());
  const hasSend = provider === 'google'
    ? has('https://www.googleapis.com/auth/gmail.send') || has('https://mail.google.com/')
    : has('Mail.Send');
  const hasDraft = provider === 'google'
    ? has('https://www.googleapis.com/auth/gmail.compose') || has('https://mail.google.com/')
    : has('Mail.ReadWrite');
  const sendEnabled = Boolean(requested.send_enabled && hasSend);
  const providerDraftEnabled = Boolean(requested.provider_draft_enabled && hasDraft);
  if (!requested.send_enabled) {
    return { sendEnabled: false, providerDraftEnabled: false, sendStatus: 'disabled', sendLastError: null };
  }
  if (!hasSend) {
    return {
      sendEnabled: false,
      providerDraftEnabled: false,
      sendStatus: 'not_authorized',
      sendLastError: 'Provider did not grant mailbox send scope. Reauthorize this mailbox with send permissions enabled.',
    };
  }
  if (requested.provider_draft_enabled && !hasDraft) {
    return {
      sendEnabled,
      providerDraftEnabled: false,
      sendStatus: 'ready',
      sendLastError: 'Provider did not grant draft/write scope. Sending is enabled; provider draft creation is disabled until reauthorized.',
    };
  }
  return { sendEnabled, providerDraftEnabled, sendStatus: 'ready', sendLastError: null };
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
  const requested = {
    send_enabled: state.send_enabled,
    provider_draft_enabled: state.provider_draft_enabled,
  };
  const tokens = await exchangeCode(db, state.tenant_id, 'mailbox', provider, code, reqOrigin, requested, state.oauth_client_id);
  const verifiedIdentity = await verifiedProviderMailboxIdentity(provider, tokens.access_token);
  const selectedOAuthConfig = state.oauth_client_id
    ? await oauthConfigForClientId(db, state.tenant_id, 'mailbox', provider, state.oauth_client_id, reqOrigin, requested)
    : await oauthConfig(db, state.tenant_id, 'mailbox', provider, reqOrigin, requested);
  const requestedScopes = selectedOAuthConfig?.scopes ?? [];
  const grantedScopes = tokens.scope ? tokens.scope.split(' ').filter(Boolean) : requestedScopes;
  const aliasResult: { aliases: MailboxSendAsAlias[]; warning?: string } = provider === 'google'
    ? { aliases: [primaryAlias(provider, verifiedIdentity)] }
    : await fetchMailboxSendAsAliases(provider, tokens.access_token, verifiedIdentity);
  const requestedMailbox = aliasKey(state.email_address);
  if (!aliasResult.aliases.some(alias => alias.email_address === requestedMailbox)) {
    throw new Error(`Connected mailbox identity mismatch. You started setup for ${state.email_address}, but ${provider} authorized ${verifiedIdentity.email_address}. Start mailbox setup again with the authorized address.`);
  }
  const { selected, aliasSettings } = selectedAliasSettings(aliasResult.aliases, requestedMailbox);
  const grant = mailboxGrantState(provider, grantedScopes, requested);
  const oauthAppSettings = {
    oauth_app_source: selectedOAuthConfig?.source ?? state.oauth_app_source ?? null,
    oauth_client_id: selectedOAuthConfig?.clientId ?? state.oauth_client_id ?? null,
    oauth_connected_at: new Date().toISOString(),
  };
  const connection = await emailMessageRepo.createPlaceholderConnection(db, state.tenant_id, {
    user_id: state.user_id,
    provider,
    email_address: verifiedIdentity.email_address,
    display_name: state.display_name ?? selected.display_name ?? verifiedIdentity.display_name ?? null,
    status: 'connected',
	    last_error: null,
	      settings: {
	      setup_required: false,
	      ...oauthAppSettings,
        account_ingest_scope: state.account_ingest_scope ?? 'owned_accounts',
	      ...aliasSettings,
	      alias_sync_status: aliasResult.warning ? 'warning' : 'ready',
	      alias_sync_warning: aliasResult.warning ?? null,
	    },
	    context_sync_enabled: state.context_sync_enabled ?? true,
	    send_enabled: grant.sendEnabled,
	    provider_draft_enabled: grant.providerDraftEnabled,
	    send_status: grant.sendStatus,
	    send_last_error: grant.sendLastError,
	    is_default_sender: grant.sendEnabled && (state.is_default_sender ?? true),
	  });
  const updated = await emailMessageRepo.updateMailboxConnection(db, state.tenant_id, connection.id, {
    status: 'connected',
	    scopes: grantedScopes,
    access_token_enc: encrypt(tokens.access_token),
    ...(tokens.refresh_token ? { refresh_token_enc: encrypt(tokens.refresh_token) } : {}),
	    token_expires_at: expiresAt(tokens),
	    last_error: null,
	    context_sync_enabled: state.context_sync_enabled ?? true,
	    send_enabled: grant.sendEnabled,
	    provider_draft_enabled: grant.providerDraftEnabled,
	    send_status: grant.sendStatus,
	    send_last_error: grant.sendLastError,
	    is_default_sender: grant.sendEnabled && (state.is_default_sender ?? true),
	    display_name: state.display_name ?? selected.display_name ?? verifiedIdentity.display_name ?? null,
	    settings: {
	      setup_required: false,
	      ...oauthAppSettings,
        account_ingest_scope: state.account_ingest_scope ?? 'owned_accounts',
	      ...aliasSettings,
	      alias_sync_status: aliasResult.warning ? 'warning' : 'ready',
	      alias_sync_warning: aliasResult.warning ?? null,
	    },
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
  const tokens = await exchangeCode(db, state.tenant_id, 'calendar', provider, code, reqOrigin, {}, state.oauth_client_id);
  const verifiedIdentity = await verifiedProviderCalendarIdentity(provider, tokens.access_token);
  if (aliasKey(state.email_address) !== aliasKey(verifiedIdentity.email_address)) {
    throw new Error(`Connected calendar identity mismatch. You started setup for ${state.email_address}, but ${provider} authorized ${verifiedIdentity.email_address}. Start calendar setup again with the authorized address.`);
  }
  const selectedOAuthConfig = state.oauth_client_id
    ? await oauthConfigForClientId(db, state.tenant_id, 'calendar', provider, state.oauth_client_id, reqOrigin)
    : await oauthConfig(db, state.tenant_id, 'calendar', provider, reqOrigin);
  const requestedScopes = selectedOAuthConfig?.scopes ?? [];
  const grantedScopes = tokens.scope ? tokens.scope.split(' ').filter(Boolean) : requestedScopes;
  const oauthAppSettings = {
    oauth_app_source: selectedOAuthConfig?.source ?? state.oauth_app_source ?? null,
    oauth_client_id: selectedOAuthConfig?.clientId ?? state.oauth_client_id ?? null,
    oauth_connected_at: new Date().toISOString(),
  };
  const connection = await calendarRepo.createPlaceholderCalendarConnection(db, state.tenant_id, {
    user_id: state.user_id,
    provider,
    email_address: verifiedIdentity.email_address,
    display_name: state.display_name ?? verifiedIdentity.display_name ?? null,
    status: 'connected',
    last_error: null,
    settings: {
      setup_required: false,
      verified_provider_email: verifiedIdentity.email_address,
      meeting_ingest_scope: state.meeting_ingest_scope ?? 'owned_accounts',
      ...oauthAppSettings,
    },
  });
  const updated = await calendarRepo.updateCalendarConnection(db, state.tenant_id, connection.id, {
    status: 'connected',
    scopes: grantedScopes,
    email_address: verifiedIdentity.email_address,
    display_name: state.display_name ?? verifiedIdentity.display_name ?? null,
    access_token_enc: encrypt(tokens.access_token),
    ...(tokens.refresh_token ? { refresh_token_enc: encrypt(tokens.refresh_token) } : {}),
    token_expires_at: expiresAt(tokens),
    last_error: null,
    settings: {
      setup_required: false,
      verified_provider_email: verifiedIdentity.email_address,
      meeting_ingest_scope: state.meeting_ingest_scope ?? 'owned_accounts',
      ...oauthAppSettings,
    },
  }) ?? connection;
  await calendarRepo.enqueueCalendarSyncJob(db, state.tenant_id, updated.id, { reason: 'oauth_connected' });
  return updated;
}

export async function mailboxAccessToken(db: DbPool, connection: emailMessageRepo.MailboxConnection): Promise<string> {
  if (!connection.access_token_enc) throw new Error('Mailbox OAuth is not connected');
  const expires = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0;
  if (expires && expires > Date.now() + 60_000) return decrypt(connection.access_token_enc);
  if (!connection.refresh_token_enc) return decrypt(connection.access_token_enc);
  const tokens = await refreshAccessToken(
    db,
    connection.tenant_id,
    'mailbox',
    connection.provider as Provider,
    decrypt(connection.refresh_token_enc),
    connectionOAuthClientId(connection.settings),
  );
  await emailMessageRepo.updateMailboxConnection(db, connection.tenant_id, connection.id, {
    access_token_enc: encrypt(tokens.access_token),
    ...(tokens.refresh_token ? { refresh_token_enc: encrypt(tokens.refresh_token) } : {}),
    token_expires_at: expiresAt(tokens),
  });
  return tokens.access_token;
}

export async function calendarAccessToken(db: DbPool, connection: calendarRepo.CalendarConnection): Promise<string> {
  if (!connection.access_token_enc) throw new Error('Calendar OAuth is not connected');
  const expires = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0;
  if (expires && expires > Date.now() + 60_000) return decrypt(connection.access_token_enc);
  if (!connection.refresh_token_enc) return decrypt(connection.access_token_enc);
  const tokens = await refreshAccessToken(
    db,
    connection.tenant_id,
    'calendar',
    connection.provider as Provider,
    decrypt(connection.refresh_token_enc),
    connectionOAuthClientId(connection.settings),
  );
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

function providerApiFailureMessage(url: string, status: number, bodyText: string): string {
  if (url.includes('gmail.googleapis.com') && status === 403) {
    const lower = bodyText.toLowerCase();
    if (lower.includes('access_not_configured') || lower.includes('api has not been used') || lower.includes('disabled')) {
      return 'Google accepted OAuth, but the Gmail API is not enabled for this OAuth app project. Enable the Gmail API in Google Cloud, wait a few minutes, then reconnect the mailbox.';
    }
    return 'Google accepted OAuth, but Gmail API access was denied. Confirm the OAuth app has Gmail API access, the requested Gmail scopes are allowed, and the mailbox is permitted by your Google Workspace app-access policy.';
  }
  if (url.includes('graph.microsoft.com') && status === 403) {
    return 'Microsoft accepted OAuth, but Microsoft Graph access was denied. Confirm the app has the requested delegated permissions and the mailbox is permitted by tenant policy.';
  }
  return `Provider API request failed (${status})`;
}

async function fetchJson(url: string, token: string): Promise<any> {
  const response = await fetchWithTimeout(url, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new CrmyError(
      'VALIDATION_ERROR',
      providerApiFailureMessage(url, response.status, bodyText),
      response.status === 401 || response.status === 403 ? 422 : 502,
      { provider_status: response.status },
    );
  }
  return await response.json();
}

async function verifiedProviderMailboxIdentity(provider: Provider, token: string): Promise<{ email_address: string; display_name?: string }> {
  if (provider === 'google') {
    const profile = await fetchJson('https://www.googleapis.com/oauth2/v3/userinfo', token);
    const email = String(profile.email ?? '').trim().toLowerCase();
    if (!email) throw new Error('Google did not return a verified mailbox address.');
    return { email_address: email, display_name: typeof profile.name === 'string' ? profile.name : undefined };
  }
  const me = await fetchJson('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName', token);
  const email = String(me.mail ?? me.userPrincipalName ?? '').trim().toLowerCase();
  if (!email) throw new Error('Microsoft did not return a verified mailbox address.');
  return { email_address: email, display_name: typeof me.displayName === 'string' ? me.displayName : undefined };
}

async function verifiedProviderCalendarIdentity(provider: Provider, token: string): Promise<{ email_address: string; display_name?: string }> {
  if (provider === 'google') {
    const profile = await fetchJson('https://www.googleapis.com/oauth2/v3/userinfo', token);
    const email = String(profile.email ?? '').trim().toLowerCase();
    if (!email) throw new Error('Google did not return a verified calendar account address.');
    return { email_address: email, display_name: typeof profile.name === 'string' ? profile.name : undefined };
  }
  const me = await fetchJson('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName', token);
  const email = String(me.mail ?? me.userPrincipalName ?? '').trim().toLowerCase();
  if (!email) throw new Error('Microsoft did not return a verified calendar account address.');
  return { email_address: email, display_name: typeof me.displayName === 'string' ? me.displayName : undefined };
}

function aliasKey(email: string): string {
  return email.trim().toLowerCase();
}

function primaryAlias(provider: Provider, identity: { email_address: string; display_name?: string }): MailboxSendAsAlias {
  return {
    email_address: aliasKey(identity.email_address),
    display_name: identity.display_name,
    is_primary: true,
    is_default: true,
    verified: true,
    source: provider,
  };
}

export async function fetchMailboxSendAsAliases(
  provider: Provider,
  token: string,
  identity: { email_address: string; display_name?: string },
): Promise<{ aliases: MailboxSendAsAlias[]; warning?: string }> {
  const primary = primaryAlias(provider, identity);
  if (provider === 'microsoft') {
    return {
      aliases: [primary],
      warning: 'Microsoft alias send-as discovery is conservative in this release. CRMy will send from the authenticated mailbox address unless a tenant-specific send-as flow is added.',
    };
  }

  try {
    const body = await fetchJson('https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs', token);
    const aliases = (Array.isArray(body.sendAs) ? body.sendAs : [])
      .map((entry: any): MailboxSendAsAlias => ({
        email_address: aliasKey(String(entry.sendAsEmail ?? '')),
        display_name: typeof entry.displayName === 'string' && entry.displayName.trim() ? entry.displayName.trim() : undefined,
        is_primary: entry.isPrimary === true,
        is_default: entry.isDefault === true,
        verified: entry.verificationStatus === 'accepted' || entry.isPrimary === true,
        source: provider,
      }))
      .filter((alias: MailboxSendAsAlias) => alias.email_address && alias.verified);
    const deduped = new Map<string, MailboxSendAsAlias>();
    for (const alias of [primary, ...aliases]) {
      const existing = deduped.get(alias.email_address);
      deduped.set(alias.email_address, {
        ...existing,
        ...alias,
        is_primary: existing?.is_primary === true || alias.is_primary === true,
        is_default: existing?.is_default === true || alias.is_default === true,
        verified: true,
      });
    }
    return { aliases: Array.from(deduped.values()) };
  } catch (err) {
    return {
      aliases: [primary],
      warning: err instanceof Error
        ? `Could not read Gmail send-as aliases: ${err.message}. CRMy will use the primary mailbox address until aliases are refreshed.`
        : 'Could not read Gmail send-as aliases. CRMy will use the primary mailbox address until aliases are refreshed.',
    };
  }
}

function selectedAliasSettings(
  aliases: MailboxSendAsAlias[],
  requestedEmail: string,
): { selected: MailboxSendAsAlias; aliasSettings: Record<string, unknown> } {
  const requested = aliasKey(requestedEmail);
  const selected = aliases.find(alias => alias.email_address === requested)
    ?? aliases.find(alias => alias.is_default)
    ?? aliases.find(alias => alias.is_primary)
    ?? aliases[0];
  return {
    selected,
    aliasSettings: {
      send_as_aliases: aliases,
      selected_send_as_email: selected.email_address,
      selected_send_as_name: selected.display_name ?? null,
      aliases_refreshed_at: new Date().toISOString(),
    },
  };
}

export async function refreshMailboxSendAsAliases(
  db: DbPool,
  tenantId: UUID,
  connectionId: UUID,
): Promise<emailMessageRepo.MailboxConnection> {
  const connection = await emailMessageRepo.getMailboxConnection(db, tenantId, connectionId);
  if (!connection) throw new Error('Mailbox connection not found');
  if (connection.provider !== 'google' && connection.provider !== 'microsoft') {
    throw new Error('Sender aliases are available only for Gmail or Microsoft mailbox connections.');
  }
  const token = await mailboxAccessToken(db, connection);
  const identity = await verifiedProviderMailboxIdentity(connection.provider, token);
  const aliasResult = await fetchMailboxSendAsAliases(connection.provider, token, identity);
  const existingSelected = typeof connection.settings?.selected_send_as_email === 'string'
    ? connection.settings.selected_send_as_email
    : connection.email_address;
  const { aliasSettings } = selectedAliasSettings(aliasResult.aliases, existingSelected);
  const updated = await emailMessageRepo.updateMailboxConnection(db, tenantId, connection.id, {
    email_address: identity.email_address,
    display_name: connection.display_name ?? identity.display_name ?? null,
    settings: {
      ...aliasSettings,
      alias_sync_status: aliasResult.warning ? 'warning' : 'ready',
      alias_sync_warning: aliasResult.warning ?? null,
    },
  });
  return updated ?? connection;
}

async function syncGmail(db: DbPool, connection: emailMessageRepo.MailboxConnection, token: string, actor?: ActorContext): Promise<SyncStats> {
  const settings = await getSourceFilterSettings(db, connection.tenant_id);
  const stats = defaultStats();
  const after = Math.floor((Date.now() - settings.email_initial_backfill_days * 24 * 60 * 60 * 1000) / 1000);
  const messageIds = new Set<string>();
  let nextCursor = connection.sync_cursor ?? undefined;
  let cursorRecovered = false;

  if (connection.sync_cursor) {
    let pageToken: string | undefined;
    let pages = 0;
    try {
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
    } catch (err) {
      const status = err instanceof CrmyError && typeof err.details?.provider_status === 'number'
        ? err.details.provider_status
        : (err as Error & { status?: number }).status;
      if (status !== 400 && status !== 404) throw err;
      messageIds.clear();
      nextCursor = undefined;
      cursorRecovered = true;
      stats.recovery_note = 'Gmail history cursor expired; CRMy used a bounded recent-message resync.';
    }
  }

  if (!connection.sync_cursor || cursorRecovered) {
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
      pageToken = listed.nextPageToken ? String(listed.nextPageToken) : undefined;
      pages++;
    } while (pageToken && pages < SOURCE_SYNC_MAX_PAGES);
  }

  for (const id of messageIds) {
    const raw = await fetchJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, token);
    nextCursor = raw.historyId ? String(raw.historyId) : nextCursor;
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
    const input: NormalizedEmailInput = {
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
      metadata: { label_ids: labels, provider: 'gmail', filter_reason: decision.message, cursor_recovered: cursorRecovered },
    };
    if (!await keepEmailForConnectionScope(db, connection, input, actor)) {
      stats.out_of_scope_skipped++;
      continue;
    }
    const result = await ingestEmailMessage(db, connection.tenant_id, input, actor);
    stats.customer_synced++;
    if (result.processing_status === 'processed') stats.processed++;
    if (result.processing_status === 'needs_review') stats.needs_review++;
  }
  if (!connection.sync_cursor && !nextCursor) {
    try {
      const profile = await fetchJson('https://gmail.googleapis.com/gmail/v1/users/me/profile', token);
      nextCursor = profile.historyId ? String(profile.historyId) : nextCursor;
    } catch {
      // Leave the cursor unchanged; the sync remains safe because messages are upserted idempotently.
    }
  }
  await emailMessageRepo.updateMailboxConnection(db, connection.tenant_id, connection.id, {
    sync_cursor: nextCursor,
    sync_stats: { ...stats, cursor_recovered: cursorRecovered } as unknown as Record<string, unknown>,
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
    const headers = Object.fromEntries((raw.internetMessageHeaders ?? []).map((h: any) => [String(h.name ?? '').toLowerCase(), String(h.value ?? '')]));
    const decision = shouldKeepEmailSource(settings, {
      from_email: from.address,
      to_emails: to,
      cc_emails: cc,
      subject: raw.subject,
      body_text: text,
      headers,
      folder: 'inbox',
    });
    if (!decision.keep) {
      bump(stats, decision.reason);
      continue;
    }
    const input: NormalizedEmailInput = {
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
      in_reply_to: headers['in-reply-to'],
      references_header: String(headers.references ?? '').split(/\s+/).filter(Boolean),
      received_at: raw.receivedDateTime,
      metadata: { provider: 'microsoft', filter_reason: decision.message },
    };
    if (!await keepEmailForConnectionScope(db, connection, input, actor)) {
      stats.out_of_scope_skipped++;
      continue;
    }
    const result = await ingestEmailMessage(db, connection.tenant_id, input, actor);
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
  const scope = meetingIngestScope(connection);
  const ownerIds = await ownerIdsForIngestScope(db, actor, scope);
  const requireLinkedCustomer = scope !== 'all_meetings';
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
    const event = await upsertCalendarEventWithIntelligence(db, connection.tenant_id, {
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
    }, actor, { ownerIds, requireLinkedCustomer });
    if (!event) {
      stats.out_of_scope_skipped++;
      continue;
    }
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
  const scope = meetingIngestScope(connection);
  const ownerIds = await ownerIdsForIngestScope(db, actor, scope);
  const requireLinkedCustomer = scope !== 'all_meetings';
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
    const event = await upsertCalendarEventWithIntelligence(db, connection.tenant_id, {
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
    }, actor, { ownerIds, requireLinkedCustomer });
    if (!event) {
      stats.out_of_scope_skipped++;
      continue;
    }
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
  if (connection.status === 'disconnected') {
    const stats = { ...defaultStats(), recovery_note: 'Mailbox sync paused because this connection is deactivated.' };
    await emailMessageRepo.updateMailboxConnection(db, tenantId, connection.id, {
      sync_stats: stats as unknown as Record<string, unknown>,
      last_sync_at: new Date().toISOString(),
      last_error: null,
      status: 'disconnected',
    });
    return stats;
  }
  if (connection.context_sync_enabled === false) {
    const stats = defaultStats();
    await emailMessageRepo.updateMailboxConnection(db, tenantId, connection.id, {
      sync_stats: stats as unknown as Record<string, unknown>,
      last_sync_at: new Date().toISOString(),
      last_error: null,
      status: 'connected',
    });
    return stats;
  }
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
  if (connection.status === 'disconnected') {
    const stats = { ...defaultStats(), recovery_note: 'Calendar sync paused because this connection is deactivated.' };
    await calendarRepo.updateCalendarConnection(db, tenantId, connection.id, {
      sync_stats: stats as unknown as Record<string, unknown>,
      last_sync_at: new Date().toISOString(),
      last_error: null,
      status: 'disconnected',
    });
    return stats;
  }
  await calendarRepo.updateCalendarConnection(db, tenantId, connection.id, { status: 'syncing', last_error: null });
  const actor = await actorForUser(db, tenantId, connection.user_id);
  const token = await calendarAccessToken(db, connection);
  return connection.provider === 'google'
    ? syncGoogleCalendar(db, connection, token, actor)
    : syncMicrosoftCalendar(db, connection, token, actor);
}
