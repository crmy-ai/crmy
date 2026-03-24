// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

/**
 * Derive a 256-bit key from the configured secret.
 * Falls back to JWT_SECRET if AGENT_ENCRYPTION_KEY is not set.
 */
function getKey(): Buffer {
  const raw = process.env.AGENT_ENCRYPTION_KEY ?? process.env.JWT_SECRET;
  if (!raw) throw new Error('No encryption key available (set AGENT_ENCRYPTION_KEY or JWT_SECRET)');
  return crypto.createHash('sha256').update(raw).digest();
}

/** Encrypt a plaintext string → base64-encoded ciphertext. */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv(12) + tag(16) + ciphertext → base64
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/** Decrypt a base64 ciphertext → plaintext string. */
export function decrypt(encoded: string): string {
  const key = getKey();
  const buf = Buffer.from(encoded, 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data) + decipher.final('utf8');
}
