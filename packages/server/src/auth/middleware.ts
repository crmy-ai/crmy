import { type Request, type Response, type NextFunction } from 'express';
import * as jose from 'jose';
import crypto from 'node:crypto';
import type { DbPool } from '../db/pool.js';
import type { ActorContext } from '@crmy/shared';

declare global {
  namespace Express {
    interface Request {
      actor?: ActorContext;
    }
  }
}

export function authMiddleware(db: DbPool, jwtSecret: string) {
  const secret = new TextEncoder().encode(jwtSecret);

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({
        type: 'https://crmy.ai/errors/unauthorized',
        title: 'Unauthorized',
        status: 401,
        detail: 'Missing or invalid Authorization header',
      });
      return;
    }

    const token = authHeader.slice(7);

    // Try JWT first
    if (!token.startsWith('crmy_')) {
      try {
        const { payload } = await jose.jwtVerify(token, secret);
        req.actor = {
          tenant_id: payload.tenant_id as string,
          actor_id: payload.sub as string,
          actor_type: 'user',
          role: payload.role as 'owner' | 'admin' | 'member',
        };
        return next();
      } catch {
        res.status(401).json({
          type: 'https://crmy.ai/errors/unauthorized',
          title: 'Unauthorized',
          status: 401,
          detail: 'Invalid or expired token',
        });
        return;
      }
    }

    // Try API key
    const keyHash = crypto.createHash('sha256').update(token).digest('hex');
    try {
      const result = await db.query(
        `SELECT ak.*, u.role FROM api_keys ak
         LEFT JOIN users u ON ak.user_id = u.id
         WHERE ak.key_hash = $1
           AND (ak.expires_at IS NULL OR ak.expires_at > now())`,
        [keyHash],
      );

      if (result.rows.length === 0) {
        res.status(401).json({
          type: 'https://crmy.ai/errors/unauthorized',
          title: 'Unauthorized',
          status: 401,
          detail: 'Invalid API key',
        });
        return;
      }

      const apiKey = result.rows[0];

      // Update last_used_at (fire and forget)
      db.query('UPDATE api_keys SET last_used_at = now() WHERE id = $1', [apiKey.id]).catch(() => {});

      req.actor = {
        tenant_id: apiKey.tenant_id,
        actor_id: apiKey.user_id ?? apiKey.id,
        actor_type: 'agent',
        role: apiKey.role ?? 'member',
        scopes: apiKey.scopes,
      };
      return next();
    } catch {
      res.status(500).json({
        type: 'https://crmy.ai/errors/internal',
        title: 'Internal Error',
        status: 500,
        detail: 'Authentication service error',
      });
      return;
    }
  };
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.actor) {
      res.status(401).json({
        type: 'https://crmy.ai/errors/unauthorized',
        title: 'Unauthorized',
        status: 401,
        detail: 'Not authenticated',
      });
      return;
    }
    if (!roles.includes(req.actor.role)) {
      res.status(403).json({
        type: 'https://crmy.ai/errors/permission_denied',
        title: 'Permission Denied',
        status: 403,
        detail: `Requires one of: ${roles.join(', ')}`,
      });
      return;
    }
    next();
  };
}
