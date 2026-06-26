// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import crypto from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {
  ActorContext,
  KnowledgeApprovalStatus,
  KnowledgeClaimStatus,
  KnowledgeSourceConnection,
  KnowledgeSourceConnectionAuthType,
  KnowledgeSourceConnectionStatus,
  KnowledgeSourceConnectionTransport,
  KnowledgeSourcePriority,
  KnowledgeType,
  KnowledgeVisibility,
  UUID,
} from '@crmy/shared';
import { CrmyError, notFound, validationError } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';
import * as sourceRepo from '../db/repos/knowledge-source-connections.js';
import { getKnowledgeClaimByExternalKey } from '../db/repos/knowledge-claims.js';
import { decryptSecret } from '../lib/secrets.js';
import { upsertProductKnowledgeClaim, type UpsertProductKnowledgeClaimInput } from './knowledge-retrieval.js';

type Json = Record<string, unknown>;
type RemoteClaim = Record<string, unknown>;

const DEFAULT_MCP_TIMEOUT_MS = 30_000;
const KNOWLEDGE_TYPES = new Set<KnowledgeType>(['company', 'product', 'competitor']);
const SOURCE_PRIORITIES = new Set<KnowledgeSourcePriority>(['authoritative', 'secondary', 'informal']);
const VISIBILITIES = new Set<KnowledgeVisibility>(['external', 'internal']);
const CLAIM_STATUSES = new Set<KnowledgeClaimStatus>(['active', 'stale', 'deprecated', 'conflicting', 'rejected']);
const APPROVAL_STATUSES = new Set<KnowledgeApprovalStatus>(['approved', 'pending', 'unapproved', 'rejected']);

export interface KnowledgeSourceConnectionInput {
  name: string;
  endpoint_url: string;
  transport?: KnowledgeSourceConnectionTransport;
  auth_type?: KnowledgeSourceConnectionAuthType;
  token?: string;
  description?: string | null;
}

export interface KnowledgeSourceConnectionPatch {
  name?: string;
  endpoint_url?: string;
  transport?: KnowledgeSourceConnectionTransport;
  auth_type?: KnowledgeSourceConnectionAuthType;
  token?: string | null;
  description?: string | null;
  status?: KnowledgeSourceConnectionStatus;
}

function nowIso(): string {
  return new Date().toISOString();
}

function sha256(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map(item => stringValue(item)).filter((item): item is string => Boolean(item));
  return items.length ? items : undefined;
}

function normalizeEndpointUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw validationError('endpoint_url must be a valid HTTP or HTTPS URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw validationError('Only HTTP and HTTPS MCP endpoints are supported.');
  }
  return url.toString();
}

function configFromInput(input: Pick<KnowledgeSourceConnectionInput, 'endpoint_url' | 'description'>): Json {
  return {
    endpoint_url: normalizeEndpointUrl(input.endpoint_url),
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
  };
}

function credentialsFromInput(authType: KnowledgeSourceConnectionAuthType, token?: string | null): Json | undefined {
  if (authType === 'none') return undefined;
  const trimmed = token?.trim();
  if (!trimmed) return undefined;
  return { token: trimmed };
}

function requireBearerToken(authType: KnowledgeSourceConnectionAuthType, credentials: Json | undefined, existingHasCredentials = false): void {
  if (authType === 'bearer_token' && !credentials && !existingHasCredentials) {
    throw validationError('MCP connector credentials are required for bearer token authentication.');
  }
}

function credentialHeaders(authType: KnowledgeSourceConnectionAuthType, credentials: Json): Record<string, string> {
  if (authType === 'none') return {};
  const token = stringValue(credentials.token);
  if (!token) throw validationError('MCP connector credentials are missing a bearer token.');
  return { Authorization: `Bearer ${token}` };
}

function endpointFromConnection(connection: sourceRepo.KnowledgeSourceConnectionRow): string {
  const endpoint = stringValue(connection.config?.endpoint_url);
  if (!endpoint) throw validationError('MCP endpoint URL is not configured.');
  return normalizeEndpointUrl(endpoint);
}

async function withTimeout<T>(label: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_MCP_TIMEOUT_MS);
  try {
    return await fn(controller.signal);
  } catch (err) {
    if (controller.signal.aborted) {
      throw new CrmyError('INTERNAL_ERROR', `${label} timed out after ${DEFAULT_MCP_TIMEOUT_MS / 1000} seconds.`, 504);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function withMcpClient<T>(
  connection: sourceRepo.KnowledgeSourceConnectionRow,
  operation: (client: Client) => Promise<T>,
): Promise<T> {
  const credentials = decryptSecret<Json>(connection.credentials_enc);
  const headers = credentialHeaders(connection.auth_type, credentials);
  const endpoint = endpointFromConnection(connection);

  return withTimeout('MCP knowledge connector request', async (signal) => {
    const client = new Client({ name: 'crmy-knowledge-source-connector', version: '1.0.0' }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
      requestInit: { headers, signal },
    });
    try {
      await client.connect(transport);
      return await operation(client);
    } finally {
      await transport.close().catch(() => {});
    }
  });
}

function toolResultToPayload(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result;
  const obj = result as Record<string, unknown>;
  if (obj.isError) {
    const text = Array.isArray(obj.content)
      ? obj.content
        .map(item => (item && typeof item === 'object' && 'text' in item ? String((item as { text?: unknown }).text ?? '') : ''))
        .filter(Boolean)
        .join('\n')
      : undefined;
    throw validationError(text || 'Remote MCP knowledge tool returned an error.');
  }
  if (obj.structuredContent && typeof obj.structuredContent === 'object') return obj.structuredContent;
  if ('toolResult' in obj) return obj.toolResult;
  if (Array.isArray(obj.content)) {
    const text = obj.content
      .map(item => (item && typeof item === 'object' && 'text' in item ? String((item as { text?: unknown }).text ?? '') : ''))
      .find(Boolean);
    if (text) {
      try {
        return JSON.parse(text);
      } catch {
        return { text };
      }
    }
  }
  return result;
}

function claimsFromPayload(payload: unknown): RemoteClaim[] {
  if (Array.isArray(payload)) return payload.filter((item): item is RemoteClaim => Boolean(item && typeof item === 'object'));
  if (!payload || typeof payload !== 'object') {
    throw validationError('Remote MCP knowledge_claim_list did not return a claim list.');
  }
  const obj = payload as Record<string, unknown>;
  const rawClaims = Array.isArray(obj.claims)
    ? obj.claims
    : Array.isArray(obj.data)
      ? obj.data
      : undefined;
  if (!rawClaims) throw validationError('Remote MCP knowledge_claim_list must return { claims: [...] }.');
  return rawClaims.filter((item): item is RemoteClaim => Boolean(item && typeof item === 'object'));
}

async function fetchRemoteClaimsWithClient(client: Client, limit: number): Promise<RemoteClaim[]> {
  const result = await client.callTool({
    name: 'knowledge_claim_list',
    arguments: { limit: Math.min(Math.max(limit, 1), 100) },
  });
  return claimsFromPayload(toolResultToPayload(result));
}

async function fetchRemoteClaims(connection: sourceRepo.KnowledgeSourceConnectionRow, limit: number): Promise<RemoteClaim[]> {
  return withMcpClient(connection, client => fetchRemoteClaimsWithClient(client, limit));
}

function normalizeClaim(connection: sourceRepo.KnowledgeSourceConnectionRow, remote: RemoteClaim): {
  input: UpsertProductKnowledgeClaimInput;
  sourceHash: string;
} | null {
  const title = stringValue(remote.title);
  const body = stringValue(remote.body) ?? stringValue(remote.summary);
  const category = stringValue(remote.category);
  if (!title || !body || !category) return null;

  const remoteKey = stringValue(remote.external_key) ?? stringValue(remote.id) ?? sha256({ title, body, category });
  const sourceHash = sha256({
    title,
    body,
    summary: stringValue(remote.summary),
    category,
    product_scope: stringArray(remote.product_scope) ?? [],
    competitors: stringArray(remote.competitors) ?? [],
    source_ref: stringValue(remote.source_ref),
    source_url: stringValue(remote.source_url),
    source_version: stringValue(remote.source_version),
  });
  const knowledgeType = KNOWLEDGE_TYPES.has(remote.knowledge_type as KnowledgeType)
    ? remote.knowledge_type as KnowledgeType
    : undefined;
  const sourcePriority = SOURCE_PRIORITIES.has(remote.source_priority as KnowledgeSourcePriority)
    ? remote.source_priority as KnowledgeSourcePriority
    : 'secondary';
  const sourceRef = stringValue(remote.source_ref) ?? `mcp:${connection.id}:${remoteKey}`;

  return {
    sourceHash,
    input: {
      external_key: `mcp:${connection.id}:${sha256(remoteKey)}`,
      knowledge_type: knowledgeType,
      category,
      title,
      body,
      summary: stringValue(remote.summary),
      product_scope: stringArray(remote.product_scope),
      competitors: stringArray(remote.competitors),
      personas: stringArray(remote.personas),
      industries: stringArray(remote.industries),
      source_ref: sourceRef,
      source_url: stringValue(remote.source_url),
      source_label: stringValue(remote.source_label) ?? connection.name,
      source_version: stringValue(remote.source_version),
      source_text: stringValue(remote.source_text),
      grounded: remote.grounded === true,
      confidence: typeof remote.confidence === 'number' ? remote.confidence : undefined,
      source_priority: sourcePriority,
      effective_at: stringValue(remote.effective_at),
      valid_until: stringValue(remote.valid_until),
      metadata: {
        source_provider: 'mcp',
        source_connection_id: connection.id,
        source_connection_name: connection.name,
        remote_claim_id: stringValue(remote.id),
        remote_external_key: stringValue(remote.external_key),
        mcp_source_hash: sourceHash,
      },
    },
  };
}

async function applyLocalGovernanceDefaults(
  db: DbPool,
  tenantId: UUID,
  input: UpsertProductKnowledgeClaimInput,
  sourceHash: string,
): Promise<UpsertProductKnowledgeClaimInput> {
  const existing = input.external_key
    ? await getKnowledgeClaimByExternalKey(db, tenantId, input.external_key)
    : null;
  const unchanged = existing?.metadata?.mcp_source_hash === sourceHash;
  if (unchanged) {
    return {
      ...input,
      approval_status: APPROVAL_STATUSES.has(existing.approval_status) ? existing.approval_status : 'pending',
      approved_for_external_use: existing.approved_for_external_use,
      visibility: VISIBILITIES.has(existing.visibility) ? existing.visibility : 'internal',
      status: CLAIM_STATUSES.has(existing.status) ? existing.status : 'active',
    };
  }
  return {
    ...input,
    approval_status: 'pending',
    approved_for_external_use: false,
    visibility: 'internal',
    status: 'active',
  };
}

export async function listKnowledgeSourceConnections(db: DbPool, actor: ActorContext): Promise<{ data: KnowledgeSourceConnection[] }> {
  return { data: await sourceRepo.listConnections(db, actor.tenant_id) };
}

export async function createKnowledgeSourceConnection(
  db: DbPool,
  actor: ActorContext,
  input: KnowledgeSourceConnectionInput,
): Promise<KnowledgeSourceConnection> {
  const authType = input.auth_type ?? 'bearer_token';
  const credentials = credentialsFromInput(authType, input.token);
  requireBearerToken(authType, credentials);
  return sourceRepo.createConnection(db, actor.tenant_id, {
    name: input.name.trim(),
    transport: input.transport ?? 'streamable_http',
    auth_type: authType,
    config: configFromInput(input),
    credentials,
    created_by: actor.actor_id ?? null,
  });
}

export async function updateKnowledgeSourceConnection(
  db: DbPool,
  actor: ActorContext,
  id: UUID,
  patch: KnowledgeSourceConnectionPatch,
): Promise<KnowledgeSourceConnection> {
  const existing = await sourceRepo.getConnection(db, actor.tenant_id, id, true);
  if (!existing) throw notFound('knowledge_source_connection', id);

  const nextAuthType = patch.auth_type ?? existing.auth_type;
  const credentials = patch.token !== undefined
    ? credentialsFromInput(nextAuthType, patch.token)
    : undefined;
  const canReuseStoredCredentials = patch.token === undefined
    && nextAuthType === existing.auth_type
    && existing.credentials_enc != null;
  requireBearerToken(nextAuthType, credentials, canReuseStoredCredentials);

  const nextConfig: Json = {
    ...existing.config,
    ...(patch.endpoint_url !== undefined ? { endpoint_url: normalizeEndpointUrl(patch.endpoint_url) } : {}),
    ...(patch.description !== undefined
      ? patch.description?.trim()
        ? { description: patch.description.trim() }
        : { description: undefined }
      : {}),
  };
  if (nextConfig.description === undefined) delete nextConfig.description;

  const updated = await sourceRepo.updateConnection(db, actor.tenant_id, id, {
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.transport !== undefined ? { transport: patch.transport } : {}),
    ...(patch.auth_type !== undefined ? { auth_type: patch.auth_type } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.endpoint_url !== undefined || patch.description !== undefined ? { config: nextConfig } : {}),
    ...(patch.token !== undefined || nextAuthType === 'none' ? { credentials: credentials ?? null } : {}),
    last_error: null,
  });
  if (!updated) throw notFound('knowledge_source_connection', id);
  return updated;
}

export async function deleteKnowledgeSourceConnection(db: DbPool, actor: ActorContext, id: UUID): Promise<{ deleted: boolean }> {
  const deleted = await sourceRepo.deleteConnection(db, actor.tenant_id, id);
  if (!deleted) throw notFound('knowledge_source_connection', id);
  return { deleted };
}

export async function testKnowledgeSourceConnection(
  db: DbPool,
  actor: ActorContext,
  id: UUID,
): Promise<{ ok: true; tool_count: number; claim_count_sample: number }> {
  const connection = await sourceRepo.getConnection(db, actor.tenant_id, id, true);
  if (!connection) throw notFound('knowledge_source_connection', id);

  try {
    const result = await withMcpClient(connection, async (client) => {
      const tools = await client.listTools();
      const hasKnowledgeList = tools.tools.some(tool => tool.name === 'knowledge_claim_list');
      if (!hasKnowledgeList) {
        throw validationError('Remote MCP server does not expose the required knowledge_claim_list tool.');
      }
      const sample = await fetchRemoteClaimsWithClient(client, 1);
      return { tool_count: tools.tools.length, claim_count_sample: sample.length };
    });
    await sourceRepo.updateConnection(db, actor.tenant_id, id, {
      ...(connection.status === 'disabled' ? {} : { status: 'configured' }),
      last_test_at: nowIso(),
      last_error: null,
      sync_stats: { ...(connection.sync_stats ?? {}), last_test_tool_count: result.tool_count },
    });
    return { ok: true, ...result };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'MCP connection test failed.';
    await sourceRepo.updateConnection(db, actor.tenant_id, id, {
      ...(connection.status === 'disabled' ? {} : { status: 'error' }),
      last_test_at: nowIso(),
      last_error: message,
    }).catch(() => {});
    throw err;
  }
}

export async function syncKnowledgeSourceConnection(
  db: DbPool,
  actor: ActorContext,
  id: UUID,
  options: { limit?: number } = {},
): Promise<{ imported: number; skipped: number; failed: number }> {
  const connection = await sourceRepo.getConnection(db, actor.tenant_id, id, true);
  if (!connection) throw notFound('knowledge_source_connection', id);
  if (connection.status === 'disabled') throw validationError('Enable this MCP connector before syncing.');

  await sourceRepo.updateConnection(db, actor.tenant_id, id, { status: 'syncing', last_error: null });
  try {
    const remoteClaims = await fetchRemoteClaims(connection, options.limit ?? 100);
    let imported = 0;
    let skipped = 0;
    let failed = 0;
    const importedAt = nowIso();

    for (const remote of remoteClaims) {
      const normalized = normalizeClaim(connection, remote);
      if (!normalized) {
        skipped += 1;
        continue;
      }
      try {
        const governedInput = await applyLocalGovernanceDefaults(db, actor.tenant_id, {
          ...normalized.input,
          metadata: {
            ...(normalized.input.metadata ?? {}),
            imported_at: importedAt,
          },
        }, normalized.sourceHash);
        await upsertProductKnowledgeClaim(db, actor, governedInput);
        imported += 1;
      } catch {
        failed += 1;
      }
    }

    const result = { imported, skipped, failed };
    await sourceRepo.updateConnection(db, actor.tenant_id, id, {
      status: failed > 0 && imported === 0 ? 'error' : 'configured',
      last_sync_at: importedAt,
      last_error: failed > 0 ? `${failed} remote claim(s) could not be imported.` : null,
      sync_stats: result,
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'MCP knowledge sync failed.';
    await sourceRepo.updateConnection(db, actor.tenant_id, id, {
      status: 'error',
      last_error: message,
      sync_stats: { failed: 1 },
    }).catch(() => {});
    throw err;
  }
}
