// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import crypto from 'node:crypto';
import type { DbPool } from '../db/pool.js';
import type { UUID } from '@crmy/shared';
import * as emailRepo from '../db/repos/emails.js';
import { getEmailProvider } from '../email/providers/index.js';

export type UserAuthTokenType = 'invite' | 'password_reset';

export interface AuthTokenResult {
  token: string;
  token_hash: string;
  expires_at: string;
}

export function hashAuthToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createUserAuthToken(
  db: DbPool,
  input: {
    tenant_id: UUID;
    user_id: UUID;
    token_type: UserAuthTokenType;
    created_by?: UUID | null;
    ttl_hours?: number;
  },
): Promise<AuthTokenResult> {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashAuthToken(token);
  const ttlHours = input.ttl_hours ?? (input.token_type === 'invite' ? 72 : 2);
  const result = await db.query<{ expires_at: string }>(
    `INSERT INTO user_auth_tokens (tenant_id, user_id, token_hash, token_type, expires_at, created_by)
     VALUES ($1, $2, $3, $4, now() + ($5::text || ' hours')::interval, $6)
     RETURNING expires_at`,
    [input.tenant_id, input.user_id, tokenHash, input.token_type, ttlHours, input.created_by ?? null],
  );

  return {
    token,
    token_hash: tokenHash,
    expires_at: result.rows[0].expires_at,
  };
}

export function buildSetupUrl(req: { protocol: string; get(name: string): string | undefined }, token: string): string {
  const base = process.env.CRMY_APP_URL?.replace(/\/+$/, '')
    ?? `${req.protocol}://${req.get('host')}/app`;
  return `${base}/setup/${encodeURIComponent(token)}`;
}

export async function sendAuthLifecycleEmail(
  db: DbPool,
  input: {
    tenant_id: UUID;
    to_email: string;
    to_name?: string | null;
    token_type: UserAuthTokenType;
    setup_url: string;
    expires_at: string;
  },
): Promise<{ sent: boolean; error?: string }> {
  const providerConfig = await emailRepo.getProvider(db, input.tenant_id);
  if (!providerConfig) return { sent: false, error: 'No email provider configured' };

  const provider = getEmailProvider(providerConfig.provider);
  if (!provider) return { sent: false, error: `Unknown email provider: ${providerConfig.provider}` };

  const action = input.token_type === 'invite' ? 'set up your CRMy account' : 'reset your CRMy password';
  const subject = input.token_type === 'invite' ? 'Set up your CRMy account' : 'Reset your CRMy password';
  const body = [
    `Hello${input.to_name ? ` ${input.to_name}` : ''},`,
    '',
    `An administrator requested that you ${action}.`,
    '',
    input.setup_url,
    '',
    `This link expires at ${new Date(input.expires_at).toLocaleString()}.`,
    '',
    'If you were not expecting this email, you can safely ignore it.',
  ].join('\n');

  const result = await provider.send(providerConfig.config, {
    from_name: providerConfig.from_name,
    from_email: providerConfig.from_email,
    to_email: input.to_email,
    to_name: input.to_name ?? undefined,
    subject,
    body_text: body,
  });

  return result.success ? { sent: true } : { sent: false, error: result.error ?? 'Email provider did not send' };
}
