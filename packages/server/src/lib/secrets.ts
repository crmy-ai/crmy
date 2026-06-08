// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import crypto from 'node:crypto';
import { CrmyError } from '@crmy/shared';

const SECRET_KEYS = [
  'access_token',
  'api_key',
  'client_secret',
  'password',
  'pat',
  'private_key',
  'refresh_token',
  'secret',
  'token',
];

function getKeyMaterial(): Buffer {
  const raw = process.env.CRMY_ENCRYPTION_KEY ?? process.env.AGENT_ENCRYPTION_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new CrmyError(
        'INTERNAL_ERROR',
        'CRMY_ENCRYPTION_KEY is required in production before storing secrets.',
        500,
      );
    }
    return crypto.createHash('sha256').update('crmy-development-connector-key').digest();
  }

  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  return crypto.createHash('sha256').update(raw).digest();
}

export interface EncryptedEnvelope {
  alg: 'aes-256-gcm';
  iv: string;
  tag: string;
  data: string;
  created_at: string;
}

export function encryptSecret(value: unknown): EncryptedEnvelope {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKeyMaterial(), iv);
  const plaintext = JSON.stringify(value ?? {});
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64'),
    created_at: new Date().toISOString(),
  };
}

export function decryptSecret<T = Record<string, unknown>>(envelope: unknown): T {
  if (!envelope || typeof envelope !== 'object') return {} as T;
  const env = envelope as EncryptedEnvelope;
  if (env.alg !== 'aes-256-gcm' || !env.iv || !env.tag || !env.data) {
    throw new CrmyError('INTERNAL_ERROR', 'Connector credentials are not in a supported encrypted format.', 500);
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKeyMaterial(), Buffer.from(env.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(env.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(env.data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(decrypted) as T;
}

export function redactSecrets<T>(input: T): T {
  if (Array.isArray(input)) return input.map(item => redactSecrets(item)) as T;
  if (!input || typeof input !== 'object') return input;

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (SECRET_KEYS.some(secretKey => lower.includes(secretKey))) {
      output[key] = value == null || value === '' ? value : '***';
    } else {
      output[key] = redactSecrets(value);
    }
  }
  return output as T;
}
