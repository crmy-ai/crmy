import { Router, type Request, type Response } from 'express';
import * as jose from 'jose';
import crypto from 'node:crypto';
import type { DbPool } from '../db/pool.js';
import { authRegister, authLogin, apiKeyCreate } from '@crmy/shared';
import { emitEvent } from '../events/emitter.js';
import { authMiddleware } from './middleware.js';

export function authRouter(db: DbPool, jwtSecret: string): Router {
  const router = Router();
  const secret = new TextEncoder().encode(jwtSecret);

  // POST /auth/register
  router.post('/register', async (req: Request, res: Response) => {
    try {
      const data = authRegister.parse(req.body);

      // Hash password
      const passwordHash = crypto.createHash('sha256').update(data.password).digest('hex');

      // Create tenant
      const tenantResult = await db.query(
        `INSERT INTO tenants (slug, name) VALUES ($1, $2) RETURNING *`,
        [data.tenant_name.toLowerCase().replace(/[^a-z0-9-]/g, '-'), data.tenant_name],
      );
      const tenant = tenantResult.rows[0];

      // Create owner user
      const userResult = await db.query(
        `INSERT INTO users (tenant_id, email, name, role, password_hash)
         VALUES ($1, $2, $3, 'owner', $4) RETURNING *`,
        [tenant.id, data.email, data.name, passwordHash],
      );
      const user = userResult.rows[0];

      // Emit events
      await emitEvent(db, {
        tenantId: tenant.id,
        eventType: 'user.created',
        actorId: user.id,
        actorType: 'system',
        objectType: 'user',
        objectId: user.id,
        afterData: { id: user.id, email: user.email, name: user.name, role: user.role },
      });

      // Generate JWT
      const token = await new jose.SignJWT({
        sub: user.id,
        tenant_id: tenant.id,
        role: user.role,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(secret);

      res.status(201).json({
        token,
        user: { id: user.id, email: user.email, name: user.name, role: user.role, tenant_id: tenant.id },
      });
    } catch (err: unknown) {
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
      const message = err instanceof Error ? err.message : 'Registration failed';
      const status = message.includes('duplicate') ? 409 : 500;
      res.status(status).json({
        type: 'https://crmy.ai/errors/internal',
        title: status === 409 ? 'Conflict' : 'Internal Error',
        status,
        detail: message,
      });
    }
  });

  // POST /auth/login
  router.post('/login', async (req: Request, res: Response) => {
    try {
      const data = authLogin.parse(req.body);
      const passwordHash = crypto.createHash('sha256').update(data.password).digest('hex');

      const result = await db.query(
        'SELECT * FROM users WHERE email = $1 AND password_hash = $2',
        [data.email, passwordHash],
      );

      if (result.rows.length === 0) {
        res.status(401).json({
          type: 'https://crmy.ai/errors/unauthorized',
          title: 'Unauthorized',
          status: 401,
          detail: 'Invalid email or password',
        });
        return;
      }

      const user = result.rows[0];
      const token = await new jose.SignJWT({
        sub: user.id,
        tenant_id: user.tenant_id,
        role: user.role,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('1h')
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

      const result = await db.query(
        `INSERT INTO api_keys (tenant_id, user_id, key_hash, label, scopes, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, label, scopes, created_at, expires_at`,
        [actor.tenant_id, actor.actor_id, keyHash, data.label, data.scopes, data.expires_at ?? null],
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
    const result = await db.query(
      `SELECT id, label, scopes, last_used_at, expires_at, created_at
       FROM api_keys WHERE tenant_id = $1
       ORDER BY created_at DESC`,
      [actor.tenant_id],
    );
    res.json({ data: result.rows });
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

  router.use('/', authenticated);

  return router;
}
