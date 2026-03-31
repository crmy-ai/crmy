// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';

// Warn once at module load if AGENT_ENCRYPTION_KEY is not set independently.
// This is non-breaking — existing installs using JWT_SECRET continue to work.
if (!process.env.AGENT_ENCRYPTION_KEY && process.env.JWT_SECRET) {
  console.warn(
    '[agent/crypto] AGENT_ENCRYPTION_KEY is not set — falling back to JWT_SECRET for API key encryption. ' +
    'Set AGENT_ENCRYPTION_KEY to an independent secret (openssl rand -hex 32) so that agent API keys ' +
    'use a dedicated encryption key, isolated from JWT signing.',
  );
}
const IV_LEN = 12;
const TAG_LEN = 16;

/**
 * Derive a 256-bit key from the configured secret using HKDF-SHA256.
 * Falls back to JWT_SECRET if AGENT_ENCRYPTION_KEY is not set.
 *
 * HKDF is the correct primitive for key derivation: it is designed to take
 * high-entropy input material (our secret) and produce a uniformly random key.
 * Using a raw SHA-256 hash is not equivalent and does not provide the same
 * domain separation or entropy expansion guarantees.
 */
function getKey(): Buffer {
  const raw = process.env.AGENT_ENCRYPTION_KEY ?? process.env.JWT_SECRET;
  if (!raw) throw new Error('No encryption key available (set AGENT_ENCRYPTION_KEY or JWT_SECRET)');
  // hkdfSync(digest, ikm, salt, info, keylen) → ArrayBuffer
  const keyMaterial = crypto.hkdfSync(
    'sha256',
    Buffer.from(raw, 'utf8'),   // IKM
    Buffer.alloc(0),             // salt (empty — raw is already high-entropy)
    Buffer.from('crmy-agent-encryption-key-v1', 'utf8'), // context label
    32,                          // 256 bits
  );
  return Buffer.from(keyMaterial);
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
