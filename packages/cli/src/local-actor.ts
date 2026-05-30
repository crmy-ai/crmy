// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ActorContext } from '@crmy/shared';

type Queryable = {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

type TenantRow = { id: string };
type UserRow = { id: string; tenant_id: string; role: ActorContext['role'] };

export async function resolveLocalActor(db: Queryable, tenantSlugOrId?: string): Promise<ActorContext> {
  let tenant: TenantRow | undefined;
  const hasExplicitTenant = Boolean(tenantSlugOrId);

  if (tenantSlugOrId) {
    const configured = await db.query<TenantRow>(
      'SELECT id FROM tenants WHERE id::text = $1 OR slug = $1 LIMIT 1',
      [tenantSlugOrId],
    );
    tenant = configured.rows[0];
    if (!tenant) {
      throw new Error(`No tenant matched "${tenantSlugOrId}". Update your CRMy config or pass a valid tenant.`);
    }
  }

  if (!tenant) {
    const fallback = await db.query<TenantRow>(
      `SELECT id
       FROM tenants
       ORDER BY CASE WHEN slug = 'default' THEN 0 ELSE 1 END, slug ASC
       LIMIT 1`,
    );
    tenant = fallback.rows[0];
  }

  if (!tenant) {
    throw new Error('No tenant found. Run `crmy init` to create a local CRMy workspace.');
  }

  let userResult = await db.query<UserRow>(
    `SELECT id, tenant_id, role
     FROM users
     WHERE tenant_id = $1
       AND is_active IS DISTINCT FROM false
     ORDER BY CASE role
       WHEN 'owner' THEN 0
       WHEN 'admin' THEN 1
       WHEN 'manager' THEN 2
       ELSE 3
     END, created_at ASC
     LIMIT 1`,
    [tenant.id],
  );
  let user = userResult.rows[0];

  if (!user && !hasExplicitTenant) {
    userResult = await db.query<UserRow>(
      `SELECT id, tenant_id, role
       FROM users
       WHERE is_active IS DISTINCT FROM false
       ORDER BY CASE role
         WHEN 'owner' THEN 0
         WHEN 'admin' THEN 1
         WHEN 'manager' THEN 2
         ELSE 3
       END, created_at ASC
       LIMIT 1`,
    );
    user = userResult.rows[0];
  }

  if (!user) {
    throw new Error('No active local user found. Run `crmy init` or log in over HTTP with `crmy auth login`.');
  }

  return {
    tenant_id: user.tenant_id ?? tenant.id,
    actor_id: user.id,
    actor_type: 'user',
    role: user.role,
  };
}
