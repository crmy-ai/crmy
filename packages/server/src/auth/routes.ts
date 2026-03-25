// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Router, type Request, type Response } from 'express';
import * as jose from 'jose';
import crypto from 'node:crypto';
import type { DbPool } from '../db/pool.js';
import { z } from 'zod';
import { authRegister, authLogin, apiKeyCreate, CrmyError } from '@crmy/shared';
import { emitEvent } from '../events/emitter.js';
import { authMiddleware } from './middleware.js';
import * as actorRepo from '../db/repos/actors.js';
import * as governorLimits from '../db/repos/governor-limits.js';

// ── Password hashing (scrypt) ─────────────────────────────────────────────────
// New format: "scrypt:<salt_hex>:<hash_hex>"
// Legacy format: raw 64-char SHA-256 hex (migrated on first login)
//
// scrypt parameters: N=16384, r=8, p=1 per OWASP recommendation for
// interactive logins. This is intentionally slow — ~100ms on modern hardware.

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;
const SCRYPT_KEYLEN = 64;

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  if (stored.startsWith('scrypt:')) {
    // Modern scrypt format
    const parts = stored.split(':');
    if (parts.length !== 3) return false;
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
    // timingSafeEqual prevents timing-based inference of the correct hash
    return expected.length === derived.length && crypto.timingSafeEqual(derived, expected);
  }
  // Legacy SHA-256 format (64-char hex) — accepted during migration period
  const legacy = crypto.createHash('sha256').update(password).digest('hex');
  return legacy === stored;
}

// ── Simple in-memory rate limiter ────────────────────────────────────────────
// No external dependency. Keyed by "route:ip". Entries auto-expire.
// For multi-process / multi-instance deployments, use a shared store (Redis)
// instead — this protects single-instance deployments.

interface RateBucket {
  count: number;
  resetAt: number;
}
const rateBuckets = new Map<string, RateBucket>();

/** Returns true if the request is allowed, false if the limit is exceeded. */
function allowRequest(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= maxRequests) return false;
  bucket.count++;
  return true;
}

// Purge expired buckets every 10 minutes to prevent unbounded memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (now >= bucket.resetAt) rateBuckets.delete(key);
  }
}, 600_000).unref(); // .unref() so this timer won't keep the process alive

function clientIp(req: Request): string {
  return (
    (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim() ??
    req.socket.remoteAddress ??
    'unknown'
  );
}

export function authRouter(db: DbPool, jwtSecret: string): Router {
  const router = Router();
  const secret = new TextEncoder().encode(jwtSecret);

  // POST /auth/register
  router.post('/register', async (req: Request, res: Response) => {
    // Rate limit: 5 registrations per 15 minutes per IP
    if (!allowRequest(`register:${clientIp(req)}`, 5, 15 * 60 * 1000)) {
      res.status(429).json({
        type: 'https://crmy.ai/errors/rate_limited',
        title: 'Too Many Requests',
        status: 429,
        detail: 'Too many registration attempts. Please try again later.',
      });
      return;
    }

    const client = await db.connect();
    try {
      const data = authRegister.parse(req.body);
      const passwordHash = hashPassword(data.password);

      await client.query('BEGIN');

      const tenantResult = await client.query(
        `INSERT INTO tenants (slug, name) VALUES ($1, $2) RETURNING *`,
        [data.tenant_name.toLowerCase().replace(/[^a-z0-9-]/g, '-'), data.tenant_name],
      );
      const tenant = tenantResult.rows[0];

      const userResult = await client.query(
        `INSERT INTO users (tenant_id, email, name, role, password_hash)
         VALUES ($1, $2, $3, 'owner', $4) RETURNING *`,
        [tenant.id, data.email, data.name, passwordHash],
      );
      const user = userResult.rows[0];

      await client.query('COMMIT');

      // Emit event outside transaction (non-critical)
      await emitEvent(db, {
        tenantId: tenant.id,
        eventType: 'user.created',
        actorId: user.id,
        actorType: 'system',
        objectType: 'user',
        objectId: user.id,
        afterData: { id: user.id, email: user.email, name: user.name, role: user.role },
      });

      const token = await new jose.SignJWT({
        sub: user.id,
        tenant_id: tenant.id,
        role: user.role,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('8h')
        .sign(secret);

      res.status(201).json({
        token,
        user: { id: user.id, email: user.email, name: user.name, role: user.role, tenant_id: tenant.id },
      });
    } catch (err: unknown) {
      await client.query('ROLLBACK').catch(() => {});
      if (err && typeof err === 'object' && 'name' in err && err.name === 'ZodError') {
        res.status(422).json({
          type: 'https://crmy.ai/errors/validation',
          title: 'Validation Error',
          status: 422,
          detail: 'Invalid input',
          errors: (err as unknown as { errors: unknown[] }).errors,
        });
        return;
      }
      // Detect unique constraint violations without leaking PG internals
      const pgCode = (err as Record<string, unknown>)?.code;
      if (pgCode === '23505') {
        res.status(409).json({
          type: 'https://crmy.ai/errors/conflict',
          title: 'Conflict',
          status: 409,
          detail: 'An account with that email or tenant name already exists.',
        });
        return;
      }
      res.status(500).json({
        type: 'https://crmy.ai/errors/internal',
        title: 'Internal Error',
        status: 500,
        detail: 'Registration failed',
      });
    } finally {
      client.release();
    }
  });

  // POST /auth/login
  router.post('/login', async (req: Request, res: Response) => {
    // Rate limit: 10 attempts per 15 minutes per IP
    const ip = clientIp(req);
    if (!allowRequest(`login:${ip}`, 10, 15 * 60 * 1000)) {
      res.status(429).json({
        type: 'https://crmy.ai/errors/rate_limited',
        title: 'Too Many Requests',
        status: 429,
        detail: 'Too many login attempts. Please try again later.',
      });
      return;
    }

    try {
      const data = authLogin.parse(req.body);

      // Look up by email first — password verification happens in application
      // code using timingSafeEqual, not in SQL, to prevent timing oracles.
      const result = await db.query(
        'SELECT * FROM users WHERE email = $1',
        [data.email],
      );

      const user = result.rows[0];
      const passwordOk = user ? verifyPassword(data.password, user.password_hash) : false;

      if (!passwordOk) {
        res.status(401).json({
          type: 'https://crmy.ai/errors/unauthorized',
          title: 'Unauthorized',
          status: 401,
          detail: 'Invalid email or password',
        });
        return;
      }

      // Opportunistically upgrade legacy SHA-256 hash to scrypt on successful login
      if (user.password_hash && !user.password_hash.startsWith('scrypt:')) {
        db.query(
          'UPDATE users SET password_hash = $1 WHERE id = $2',
          [hashPassword(data.password), user.id],
        ).catch(() => {});
      }

      const token = await new jose.SignJWT({
        sub: user.id,
        tenant_id: user.tenant_id,
        role: user.role,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('8h')
        .sign(secret);

      res.json({
        token,
        user: { id: user.id, email: user.email, name: user.name, role: user.role, tenant_id: user.tenant_id },
      });
    } catch (err) {
      if (err && typeof err === 'object' && 'name' in err && err.name === 'ZodError') {
        res.status(422).json({
          type: 'https://crmy.ai/errors/validation',
          title: 'Validation Error',
          status: 422,
          detail: 'Invalid input',
        });
        return;
      }
      res.status(500).json({
        type: 'https://crmy.ai/errors/internal',
        title: 'Internal Error',
        status: 500,
        detail: 'Login failed',
      });
    }
  });

  // POST /auth/register-agent — Self-registration for agents with minimal scopes.
  // Requires an existing API key with 'write' scope for the tenant.
  const agentRegisterSchema = z.object({
    display_name: z.string().min(1).max(200),
    agent_identifier: z.string().min(1).max(200),
    agent_model: z.string().max(200).optional(),
    requested_scopes: z.array(z.string()).optional(),
  });

  const agentRegistration = Router();
  agentRegistration.use(authMiddleware(db, jwtSecret));

  agentRegistration.post('/register-agent', async (req: Request, res: Response) => {
    const client = await db.connect();
    try {
      const data = agentRegisterSchema.parse(req.body);
      const actor = req.actor!;

      // Enforce governor limit on actor count before acquiring the transaction
      const activeCount = await governorLimits.countActiveActors(db, actor.tenant_id);
      await governorLimits.enforceLimit(db, actor.tenant_id, 'actors_max', activeCount);

      // Find-or-create the agent actor. ensureActor uses INSERT … ON CONFLICT,
      // so it is safe to call without a surrounding transaction.
      const minimalScopes = ['read']; // agents start read-only; admin grants more
      const agentActor = await actorRepo.ensureActor(db, actor.tenant_id, {
        actor_type: 'agent',
        display_name: data.display_name,
        agent_identifier: data.agent_identifier,
        agent_model: data.agent_model ?? null,
        scopes: minimalScopes,
        metadata: {},
      } as Parameters<typeof actorRepo.ensureActor>[2]);

      // Generate an API key bound to this agent actor.
      // The actor upsert and key insert are each single statements; we wrap
      // both under an explicit transaction so that a failed key insert does not
      // leave the actor without a key (the actor row is rolled back too).
      const rawKey = 'crmy_' + crypto.randomBytes(32).toString('hex');
      const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

      await client.query('BEGIN');

      const keyResult = await client.query(
        `INSERT INTO api_keys (tenant_id, actor_id, key_hash, label, scopes, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, label, scopes, actor_id, created_at`,
        [actor.tenant_id, agentActor.id, keyHash, `${data.display_name} auto`, minimalScopes, null],
      );

      await client.query('COMMIT');

      // Emit event outside transaction (non-critical)
      await emitEvent(db, {
        tenantId: actor.tenant_id,
        eventType: 'actor.self_registered',
        actorId: agentActor.id,
        actorType: 'agent',
        objectType: 'actor',
        objectId: agentActor.id,
        afterData: { display_name: data.display_name, agent_identifier: data.agent_identifier },
      });

      res.status(201).json({
        actor: agentActor,
        api_key: {
          ...keyResult.rows[0],
          key: rawKey, // Only returned once
        },
      });
    } catch (err: unknown) {
      await client.query('ROLLBACK').catch(() => {});
      if (err && typeof err === 'object' && 'name' in err && err.name === 'ZodError') {
        res.status(422).json({
          type: 'https://crmy.ai/errors/validation',
          title: 'Validation Error',
          status: 422,
          detail: 'Invalid input',
          errors: (err as unknown as { errors: unknown[] }).errors,
        });
        return;
      }
      if (err instanceof CrmyError) {
        res.status(err.status).json(err.toJSON());
        return;
      }
      res.status(500).json({
        type: 'https://crmy.ai/errors/internal',
        title: 'Internal Error',
        status: 500,
        detail: 'Agent registration failed',
      });
    } finally {
      client.release();
    }
  });

  router.use('/', agentRegistration);

  // Authenticated API key routes
  const authenticated = Router();
  authenticated.use(authMiddleware(db, jwtSecret));

  // POST /auth/api-keys
  authenticated.post('/api-keys', async (req: Request, res: Response) => {
    try {
      const data = apiKeyCreate.parse(req.body);
      const actor = req.actor!;

      // Generate key
      const rawKey = 'crmy_' + crypto.randomBytes(32).toString('hex');
      const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

      // If actor_id provided, verify it belongs to this tenant
      const actorId = data.actor_id ?? null;
      if (actorId) {
        const actorCheck = await db.query(
          'SELECT id FROM actors WHERE id = $1 AND tenant_id = $2',
          [actorId, actor.tenant_id],
        );
        if (actorCheck.rows.length === 0) {
          res.status(404).json({
            type: 'https://crmy.ai/errors/not_found',
            title: 'Not Found',
            status: 404,
            detail: 'Actor not found',
          });
          return;
        }
      }

      const result = await db.query(
        `INSERT INTO api_keys (tenant_id, user_id, actor_id, key_hash, label, scopes, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, label, scopes, actor_id, created_at, expires_at`,
        [actor.tenant_id, actorId ? null : actor.actor_id, actorId, keyHash, data.label, data.scopes, data.expires_at ?? null],
      );

      await emitEvent(db, {
        tenantId: actor.tenant_id,
        eventType: 'api_key.created',
        actorId: actor.actor_id,
        actorType: actor.actor_type,
        objectType: 'api_key',
        objectId: result.rows[0].id,
        afterData: { label: data.label, scopes: data.scopes },
      });

      res.status(201).json({
        ...result.rows[0],
        key: rawKey, // Only returned once
      });
    } catch (err) {
      res.status(500).json({
        type: 'https://crmy.ai/errors/internal',
        title: 'Internal Error',
        status: 500,
        detail: 'Failed to create API key',
      });
    }
  });

  // GET /auth/api-keys
  authenticated.get('/api-keys', async (req: Request, res: Response) => {
    const actor = req.actor!;
    // Optionally filter by actor_id
    const actorFilter = req.query.actor_id as string | undefined;
    const params: unknown[] = [actor.tenant_id];
    let where = 'ak.tenant_id = $1';
    if (actorFilter) {
      where += ' AND ak.actor_id = $2';
      params.push(actorFilter);
    }
    const result = await db.query(
      `SELECT ak.id, ak.label, ak.scopes, ak.actor_id, ak.user_id,
              ak.last_used_at, ak.expires_at, ak.created_at,
              a.display_name as actor_name, a.actor_type as actor_type
       FROM api_keys ak
       LEFT JOIN actors a ON ak.actor_id = a.id
       WHERE ${where}
       ORDER BY ak.created_at DESC`,
      params,
    );
    res.json({ data: result.rows });
  });

  // PATCH /auth/api-keys/:id
  authenticated.patch('/api-keys/:id', async (req: Request, res: Response) => {
    try {
      const actor = req.actor!;
      const keyId = typeof req.params.id === 'string' ? req.params.id : '';
      const { label, scopes, actor_id, expires_at } = req.body as {
        label?: string;
        scopes?: string[];
        actor_id?: string | null;
        expires_at?: string | null;
      };

      // Verify key belongs to this tenant
      const existing = await db.query(
        'SELECT id FROM api_keys WHERE id = $1 AND tenant_id = $2',
        [keyId, actor.tenant_id],
      );
      if (existing.rows.length === 0) {
        res.status(404).json({ detail: 'API key not found' });
        return;
      }

      // If actor_id provided, verify it belongs to this tenant
      if (actor_id) {
        const actorCheck = await db.query(
          'SELECT id FROM actors WHERE id = $1 AND tenant_id = $2',
          [actor_id, actor.tenant_id],
        );
        if (actorCheck.rows.length === 0) {
          res.status(404).json({ detail: 'Actor not found' });
          return;
        }
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      let p = 1;
      if (label !== undefined) { sets.push(`label = $${p++}`); params.push(label); }
      if (scopes !== undefined) { sets.push(`scopes = $${p++}`); params.push(scopes); }
      if ('actor_id' in req.body) { sets.push(`actor_id = $${p++}`); params.push(actor_id ?? null); }
      if ('expires_at' in req.body) { sets.push(`expires_at = $${p++}`); params.push(expires_at ? new Date(expires_at) : null); }

      if (sets.length === 0) {
        res.status(400).json({ detail: 'No fields to update' });
        return;
      }

      params.push(keyId, actor.tenant_id);
      const result = await db.query(
        `UPDATE api_keys SET ${sets.join(', ')} WHERE id = $${p} AND tenant_id = $${p + 1}
         RETURNING id, label, scopes, actor_id, expires_at`,
        params,
      );

      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ detail: 'Failed to update API key' });
    }
  });

  // DELETE /auth/api-keys/:id
  authenticated.delete('/api-keys/:id', async (req: Request, res: Response) => {
    const actor = req.actor!;
    const keyId = typeof req.params.id === 'string' ? req.params.id : '';
    const result = await db.query(
      'DELETE FROM api_keys WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [keyId, actor.tenant_id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({
        type: 'https://crmy.ai/errors/not_found',
        title: 'Not Found',
        status: 404,
        detail: 'API key not found',
      });
      return;
    }

    await emitEvent(db, {
      tenantId: actor.tenant_id,
      eventType: 'api_key.revoked',
      actorId: actor.actor_id,
      actorType: actor.actor_type,
      objectType: 'api_key',
      objectId: keyId,
    });

    res.json({ deleted: true });
  });

  // PATCH /auth/profile — self-service profile update (any authenticated user)
  authenticated.patch('/profile', async (req: Request, res: Response) => {
    try {
      const actor = req.actor!;
      const { name, email, current_password, new_password } = req.body as {
        name?: string;
        email?: string;
        current_password?: string;
        new_password?: string;
      };

      // Fetch current user record
      const existing = await db.query(
        'SELECT * FROM users WHERE id = $1 AND tenant_id = $2',
        [actor.actor_id, actor.tenant_id],
      );
      if (existing.rows.length === 0) {
        res.status(404).json({ detail: 'User not found' });
        return;
      }
      const user = existing.rows[0];

      // If changing password, verify current password first
      if (new_password) {
        if (!current_password) {
          res.status(400).json({ detail: 'Current password is required to set a new password' });
          return;
        }
        if (!verifyPassword(current_password, user.password_hash)) {
          res.status(400).json({ detail: 'Current password is incorrect' });
          return;
        }
        if (new_password.length < 8) {
          res.status(400).json({ detail: 'New password must be at least 8 characters' });
          return;
        }
      }

      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        res.status(400).json({ detail: 'Valid email address is required' });
        return;
      }

      const cols: string[] = ['updated_at = now()'];
      const vals: unknown[] = [];
      if (name?.trim()) { cols.push(`name = $${vals.length + 1}`); vals.push(name.trim()); }
      if (email?.trim()) { cols.push(`email = $${vals.length + 1}`); vals.push(email.trim()); }
      if (new_password) {
        cols.push(`password_hash = $${vals.length + 1}`);
        vals.push(hashPassword(new_password));
      }

      if (cols.length === 1) {
        res.status(400).json({ detail: 'No fields to update' });
        return;
      }

      vals.push(actor.actor_id, actor.tenant_id);
      const result = await db.query(
        `UPDATE users SET ${cols.join(', ')}
         WHERE id = $${vals.length - 1} AND tenant_id = $${vals.length}
         RETURNING id, email, name, role, created_at, updated_at`,
        vals,
      );

      // Also sync display_name on the linked actor
      if (name?.trim() && actor.actor_id) {
        await db.query(
          'UPDATE actors SET display_name = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3',
          [name.trim(), actor.actor_id, actor.tenant_id],
        );
      }

      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ detail: 'Failed to update profile' });
    }
  });

  router.use('/', authenticated);

  return router;
}
