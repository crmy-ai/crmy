// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { type Request, type Response, type NextFunction } from 'express';
import * as jose from 'jose';
import crypto from 'node:crypto';
import type { DbPool } from '../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import { effectiveJwtScopes } from './scopes.js';

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (rawKey === name) {
      try {
        return decodeURIComponent(rawValue.join('='));
      } catch {
        return rawValue.join('=');
      }
    }
  }
  return undefined;
}

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
    const cookieToken = process.env.CRMY_BROWSER_COOKIE_AUTH === 'true'
      ? cookieValue(req.headers.cookie, 'crmy_session')
      : undefined;
    if (!authHeader?.startsWith('Bearer ') && !cookieToken) {
      res.status(401).json({
        type: 'https://crmy.ai/errors/unauthorized',
        title: 'Unauthorized',
        status: 401,
        detail: 'Missing or invalid Authorization header',
      });
      return;
    }

    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : cookieToken ?? '';

    // Try JWT first
    if (!token.startsWith('crmy_')) {
      let payload: jose.JWTPayload;
      try {
        ({ payload } = await jose.jwtVerify(token, secret));
      } catch {
        res.status(401).json({
          type: 'https://crmy.ai/errors/unauthorized',
          title: 'Unauthorized',
          status: 401,
          detail: 'Invalid or expired token',
        });
        return;
      }

      try {
        const userId = payload.sub as string | undefined;
        const tenantId = payload.tenant_id as string | undefined;
        if (!userId || !tenantId) {
          res.status(401).json({
            type: 'https://crmy.ai/errors/unauthorized',
            title: 'Unauthorized',
            status: 401,
            detail: 'Invalid token claims',
          });
          return;
        }

        const userResult = await db.query(
          `SELECT u.id, u.tenant_id, u.role, u.is_active,
                  a.id as actor_record_id, a.scopes as actor_scopes,
                  a.is_active as actor_is_active, a.registration_status as actor_registration_status
           FROM users u
           LEFT JOIN actors a
             ON a.tenant_id = u.tenant_id
            AND a.user_id = u.id
            AND a.actor_type = 'human'
           WHERE u.id = $1 AND u.tenant_id = $2
           LIMIT 1`,
          [userId, tenantId],
        );
        const user = userResult.rows[0];
        if (!user) {
          res.status(401).json({
            type: 'https://crmy.ai/errors/unauthorized',
            title: 'Unauthorized',
            status: 401,
            detail: 'User no longer exists',
          });
          return;
        }
        if (user.is_active === false || user.actor_is_active === false || user.actor_registration_status === 'rejected') {
          res.status(403).json({
            type: 'https://crmy.ai/errors/permission_denied',
            title: 'Permission Denied',
            status: 403,
            detail: 'User is deactivated',
          });
          return;
        }
        const role = user.role as 'owner' | 'admin' | 'manager' | 'member';
        req.actor = {
          tenant_id: user.tenant_id as string,
          actor_id: user.id as string,
          actor_type: 'user',
          role,
          scopes: effectiveJwtScopes(role, Array.isArray(user.actor_scopes) ? user.actor_scopes : undefined),
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
    }

    // Try API key
    const keyHash = crypto.createHash('sha256').update(token).digest('hex');
    try {
      // Join with actors table to resolve identity when actor_id is set
      const result = await db.query(
        `SELECT ak.*, u.role as user_role, u.is_active as user_is_active,
                a.id as resolved_actor_id, a.actor_type as resolved_actor_type,
                a.role as actor_role, a.scopes as actor_scopes, a.is_active as actor_is_active
         FROM api_keys ak
         LEFT JOIN users u ON ak.user_id = u.id
         LEFT JOIN actors a ON ak.actor_id = a.id
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

      // If key is linked to an inactive actor, reject
      if (apiKey.user_id && apiKey.user_is_active === false) {
        res.status(403).json({
          type: 'https://crmy.ai/errors/permission_denied',
          title: 'Permission Denied',
          status: 403,
          detail: 'User is deactivated',
        });
        return;
      }

      if (apiKey.resolved_actor_id && apiKey.actor_is_active === false) {
        res.status(403).json({
          type: 'https://crmy.ai/errors/permission_denied',
          title: 'Permission Denied',
          status: 403,
          detail: 'Actor is deactivated',
        });
        return;
      }

      // Update last_used_at (fire and forget)
      db.query('UPDATE api_keys SET last_used_at = now() WHERE id = $1', [apiKey.id]).catch(() => {});

      // Resolve identity: prefer linked actor, fall back to user or key ID
      const actorId = apiKey.resolved_actor_id ?? apiKey.user_id ?? apiKey.id;
      const actorType = apiKey.resolved_actor_type === 'human' || apiKey.user_id ? 'user' : 'agent';
      const role = apiKey.actor_role ?? apiKey.user_role ?? 'member';
      // Effective scopes: intersection of key scopes and actor scopes (if actor linked)
      const scopes = apiKey.actor_scopes
        ? apiKey.scopes.filter((s: string) => apiKey.actor_scopes.includes(s))
        : apiKey.scopes;

      req.actor = {
        tenant_id: apiKey.tenant_id,
        actor_id: actorId,
        actor_type: actorType as 'user' | 'agent',
        role: role,
        scopes: scopes,
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
