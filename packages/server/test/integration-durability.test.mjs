// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { runMigrations } from '../dist/db/migrate.js';
import * as contextRepo from '../dist/db/repos/context-entries.js';
import { accountTools } from '../dist/mcp/tools/accounts.js';
import { compoundTools } from '../dist/mcp/tools/compound.js';
import { contactTools } from '../dist/mcp/tools/contacts.js';

const { Pool } = pg;

const databaseUrl = process.env.CRMY_INTEGRATION_DATABASE_URL ?? process.env.TEST_DATABASE_URL;

function quoteIdent(value) {
  return `"${value.replace(/"/g, '""')}"`;
}

async function withMigratedSchema(fn) {
  const schema = `crmy_it_${randomUUID().replaceAll('-', '_')}`;
  const admin = new Pool({ connectionString: databaseUrl });

  await admin.query(`CREATE SCHEMA ${quoteIdent(schema)}`);

  const db = new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schema},public`,
  });

  try {
    await runMigrations(db);
    return await fn(db);
  } finally {
    await db.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`);
    await admin.end();
  }
}

async function seedTenantAndActor(db) {
  const tenantResult = await db.query(
    `INSERT INTO tenants (slug, name) VALUES ($1, $2) RETURNING id`,
    [`tenant-${randomUUID()}`, 'Integration Tenant'],
  );
  const tenantId = tenantResult.rows[0].id;

  const userResult = await db.query(
    `INSERT INTO users (tenant_id, email, name, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [tenantId, `owner-${randomUUID()}@example.com`, 'Integration Owner', 'owner'],
  );
  const userId = userResult.rows[0].id;

  // Use the same UUID for the user and actor so legacy user FKs and newer actor
  // FKs are both satisfied by compound writes.
  await db.query(
    `INSERT INTO actors (id, tenant_id, actor_type, display_name, email, user_id, role)
     VALUES ($1, $2, 'human', $3, $4, $1, 'owner')`,
    [userId, tenantId, 'Integration Owner', `actor-${randomUUID()}@example.com`],
  );

  return {
    tenantId,
    actor: {
      tenant_id: tenantId,
      actor_id: userId,
      actor_type: 'user',
      role: 'owner',
    },
  };
}

async function createOpportunity(db, tenantId, userId, fields = {}) {
  const result = await db.query(
    `INSERT INTO opportunities (tenant_id, name, account_id, contact_id, stage, forecast_cat, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      tenantId,
      fields.name ?? `Opportunity ${randomUUID()}`,
      fields.account_id ?? null,
      fields.contact_id ?? null,
      fields.stage ?? 'prospecting',
      fields.forecast_cat ?? 'pipeline',
      userId,
    ],
  );
  return result.rows[0];
}

async function createAccount(db, tenantId, userId, fields = {}) {
  const result = await db.query(
    `INSERT INTO accounts (tenant_id, name, domain, aliases, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      tenantId,
      fields.name ?? `Account ${randomUUID()}`,
      fields.domain ?? null,
      fields.aliases ?? [],
      userId,
    ],
  );
  return result.rows[0];
}

async function createContact(db, tenantId, userId, fields = {}) {
  const result = await db.query(
    `INSERT INTO contacts (tenant_id, first_name, last_name, email, phone, account_id, aliases, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      tenantId,
      fields.first_name ?? 'Ada',
      fields.last_name ?? 'Lovelace',
      fields.email ?? `ada-${randomUUID()}@example.com`,
      fields.phone ?? null,
      fields.account_id ?? null,
      fields.aliases ?? [],
      userId,
    ],
  );
  return result.rows[0];
}

async function countRows(db, table, where, params) {
  const result = await db.query(`SELECT count(*)::int AS count FROM ${table} WHERE ${where}`, params);
  return result.rows[0].count;
}

if (!databaseUrl) {
  test('database durability integration tests', { skip: 'Set CRMY_INTEGRATION_DATABASE_URL or TEST_DATABASE_URL to run migrated Postgres checks.' }, () => {});
} else {
  test('deal_advance is atomic, idempotent, and version guarded on a migrated database', async () => {
    await withMigratedSchema(async (db) => {
      const { tenantId, actor } = await seedTenantAndActor(db);
      const dealAdvance = compoundTools(db).find(tool => tool.name === 'deal_advance');
      assert.ok(dealAdvance);

      const opportunity = await createOpportunity(db, tenantId, actor.actor_id);
      const input = {
        opportunity_id: opportunity.id,
        stage: 'closed_won',
        note: 'Customer signed the order form.',
        idempotency_key: `deal-${randomUUID()}`,
        expected_version: opportunity.row_version,
        context: {
          title: 'Close reason',
          body: 'Executive sponsor approved the rollout.',
          context_type: 'insight',
        },
      };

      const first = await dealAdvance.handler(input, actor);
      const second = await dealAdvance.handler(input, actor);

      assert.equal(first.opportunity.stage, 'closed_won');
      assert.equal(first.opportunity.forecast_cat, 'closed');
      assert.equal(first.opportunity.row_version, opportunity.row_version + 1);
      assert.equal(first.activity.subject_type, 'opportunity');
      assert.equal(first.activity.subject_id, opportunity.id);
      assert.equal(first.context_entry.subject_id, opportunity.id);
      assert.equal(first.mutation.object_type, 'opportunity');

      assert.equal(second.opportunity.id, first.opportunity.id);
      assert.equal(second.activity.id, first.activity.id);
      assert.equal(second.context_entry.id, first.context_entry.id);
      assert.equal(second.event_id, first.event_id);
      assert.equal(await countRows(db, 'activities', 'tenant_id = $1 AND opportunity_id = $2', [tenantId, opportunity.id]), 1);
      assert.equal(await countRows(db, 'context_entries', 'tenant_id = $1 AND subject_id = $2', [tenantId, opportunity.id]), 1);
      assert.equal(await countRows(db, 'events', 'tenant_id = $1 AND object_id = $2', [tenantId, opportunity.id]), 1);

      await assert.rejects(
        () => dealAdvance.handler({ ...input, note: 'Different retry payload.' }, actor),
        err => err?.code === 'CONFLICT' && err?.status === 409,
      );

      const staleOpportunity = await createOpportunity(db, tenantId, actor.actor_id);
      await assert.rejects(
        () => dealAdvance.handler({
          opportunity_id: staleOpportunity.id,
          stage: 'closed_won',
          idempotency_key: `deal-stale-${randomUUID()}`,
          expected_version: staleOpportunity.row_version + 10,
        }, actor),
        err => err?.code === 'CONFLICT' && err?.status === 409,
      );
      assert.equal(await countRows(db, 'activities', 'tenant_id = $1 AND opportunity_id = $2', [tenantId, staleOpportunity.id]), 0);
      assert.equal(await countRows(db, 'events', 'tenant_id = $1 AND object_id = $2', [tenantId, staleOpportunity.id]), 0);

      const blockedOpportunity = await createOpportunity(db, tenantId, actor.actor_id);
      await assert.rejects(
        () => dealAdvance.handler({
          opportunity_id: blockedOpportunity.id,
          stage: 'qualification',
          idempotency_key: `deal-blocked-${randomUUID()}`,
        }, actor),
        /Missing prerequisite/,
      );

      const persistedBlocked = await db.query('SELECT * FROM opportunities WHERE id = $1', [blockedOpportunity.id]);
      assert.equal(persistedBlocked.rows[0].stage, 'prospecting');
      assert.equal(persistedBlocked.rows[0].row_version, 1);
      assert.equal(await countRows(db, 'activities', 'tenant_id = $1 AND opportunity_id = $2', [tenantId, blockedOpportunity.id]), 0);
      assert.equal(await countRows(db, 'context_entries', 'tenant_id = $1 AND subject_id = $2', [tenantId, blockedOpportunity.id]), 0);
    });
  });

  test('contact_outreach creates a single canonical activity/context pair when retried', async () => {
    await withMigratedSchema(async (db) => {
      const { tenantId, actor } = await seedTenantAndActor(db);
      const contactOutreach = compoundTools(db).find(tool => tool.name === 'contact_outreach');
      assert.ok(contactOutreach);

      const contact = await createContact(db, tenantId, actor.actor_id);
      const input = {
        contact_id: contact.id,
        channel: 'email',
        subject: 'Follow up',
        body: 'Checking in after the workshop.',
        outcome: 'positive',
        idempotency_key: `outreach-${randomUUID()}`,
        context: {
          title: 'Workshop feedback',
          body: 'The buyer wants implementation help next week.',
        },
      };

      const first = await contactOutreach.handler(input, actor);
      const second = await contactOutreach.handler(input, actor);

      assert.equal(first.activity.type, 'outreach_email');
      assert.equal(first.activity.subject_type, 'contact');
      assert.equal(first.activity.subject_id, contact.id);
      assert.equal(first.context_entry.subject_id, contact.id);
      assert.equal(first.context_entry.source_activity_id, first.activity.id);
      assert.equal(first.mutation.object_type, 'activity');
      assert.equal(second.activity.id, first.activity.id);
      assert.equal(second.context_entry.id, first.context_entry.id);
      assert.equal(second.event_id, first.event_id);

      assert.equal(await countRows(db, 'activities', 'tenant_id = $1 AND contact_id = $2', [tenantId, contact.id]), 1);
      assert.equal(await countRows(db, 'context_entries', 'tenant_id = $1 AND subject_id = $2', [tenantId, contact.id]), 1);
      assert.equal(await countRows(db, 'events', 'tenant_id = $1 AND object_id = $2', [tenantId, first.activity.id]), 1);
    });
  });

  test('contact_merge reassigns children atomically and replays idempotently', async () => {
    await withMigratedSchema(async (db) => {
      const { tenantId, actor } = await seedTenantAndActor(db);
      const contactMerge = contactTools(db).find(tool => tool.name === 'contact_merge');
      assert.ok(contactMerge);

      const primary = await createContact(db, tenantId, actor.actor_id, {
        first_name: 'Primary',
        last_name: 'Buyer',
        aliases: ['primary-alias'],
      });
      const secondary = await createContact(db, tenantId, actor.actor_id, {
        first_name: 'Duplicate',
        last_name: 'Buyer',
        email: `duplicate-${randomUUID()}@example.com`,
        phone: '+15555550123',
        aliases: ['duplicate-alias'],
      });
      await db.query(
        `INSERT INTO activities (tenant_id, type, subject, contact_id, subject_type, subject_id, created_by)
         VALUES ($1, 'note', 'Secondary note', $2, 'contact', $2, $3)`,
        [tenantId, secondary.id, actor.actor_id],
      );
      await contextRepo.createContextEntry(db, tenantId, {
        subject_type: 'contact',
        subject_id: secondary.id,
        context_type: 'insight',
        title: 'Secondary context',
        body: 'Context should move to the primary contact.',
        authored_by: actor.actor_id,
      });
      await createOpportunity(db, tenantId, actor.actor_id, { contact_id: secondary.id });

      const input = {
        primary_id: primary.id,
        secondary_id: secondary.id,
        idempotency_key: `contact-merge-${randomUUID()}`,
        primary_expected_version: primary.row_version,
        secondary_expected_version: secondary.row_version,
      };
      const first = await contactMerge.handler(input, actor);
      const second = await contactMerge.handler(input, actor);

      assert.equal(second.primary.id, first.primary.id);
      assert.equal(second.event_id, first.event_id);
      assert.equal(first.primary.row_version, primary.row_version + 1);
      assert.deepEqual(first.merged_count, {
        activities: 1,
        context_entries: 1,
        opportunities: 1,
        assignments: 0,
        sequence_enrollments: 0,
      });
      assert.ok(first.primary.aliases.includes('primary-alias'));
      assert.ok(first.primary.aliases.includes(secondary.email));
      assert.ok(first.primary.aliases.includes(secondary.phone));
      assert.ok(first.primary.aliases.includes('Duplicate Buyer'));
      assert.ok(first.primary.aliases.includes('duplicate-alias'));
      assert.equal(await countRows(db, 'activities', 'tenant_id = $1 AND contact_id = $2', [tenantId, primary.id]), 1);
      assert.equal(await countRows(db, 'context_entries', 'tenant_id = $1 AND subject_type = $2 AND subject_id = $3', [tenantId, 'contact', primary.id]), 1);
      assert.equal(await countRows(db, 'opportunities', 'tenant_id = $1 AND contact_id = $2', [tenantId, primary.id]), 1);
      assert.equal(await countRows(db, 'events', 'tenant_id = $1 AND event_type = $2 AND object_id = $3', [tenantId, 'contact.merged', primary.id]), 1);

      const secondaryAfter = await db.query('SELECT merged_into, row_version FROM contacts WHERE id = $1', [secondary.id]);
      assert.equal(secondaryAfter.rows[0].merged_into, primary.id);
      assert.equal(secondaryAfter.rows[0].row_version, secondary.row_version + 1);

      const stalePrimary = await createContact(db, tenantId, actor.actor_id);
      const staleSecondary = await createContact(db, tenantId, actor.actor_id);
      await db.query(
        `INSERT INTO activities (tenant_id, type, subject, contact_id, subject_type, subject_id, created_by)
         VALUES ($1, 'note', 'Should stay put', $2, 'contact', $2, $3)`,
        [tenantId, staleSecondary.id, actor.actor_id],
      );

      await assert.rejects(
        () => contactMerge.handler({
          primary_id: stalePrimary.id,
          secondary_id: staleSecondary.id,
          idempotency_key: `contact-merge-stale-${randomUUID()}`,
          primary_expected_version: stalePrimary.row_version + 1,
          secondary_expected_version: staleSecondary.row_version,
        }, actor),
        err => err?.code === 'CONFLICT' && err?.status === 409,
      );
      assert.equal(await countRows(db, 'activities', 'tenant_id = $1 AND contact_id = $2', [tenantId, staleSecondary.id]), 1);
      assert.equal(await countRows(db, 'activities', 'tenant_id = $1 AND contact_id = $2', [tenantId, stalePrimary.id]), 0);
      const staleSecondaryAfter = await db.query('SELECT merged_into FROM contacts WHERE id = $1', [staleSecondary.id]);
      assert.equal(staleSecondaryAfter.rows[0].merged_into, null);
    });
  });

  test('account_merge reassigns customer graph rows and replays idempotently', async () => {
    await withMigratedSchema(async (db) => {
      const { tenantId, actor } = await seedTenantAndActor(db);
      const accountMerge = accountTools(db).find(tool => tool.name === 'account_merge');
      assert.ok(accountMerge);

      const primary = await createAccount(db, tenantId, actor.actor_id, {
        name: 'Primary Company',
        aliases: ['primary-co'],
      });
      const secondary = await createAccount(db, tenantId, actor.actor_id, {
        name: 'Duplicate Company',
        domain: `duplicate-${randomUUID()}.example.com`,
        aliases: ['duplicate-co'],
      });
      await createContact(db, tenantId, actor.actor_id, { account_id: secondary.id });
      await createOpportunity(db, tenantId, actor.actor_id, { account_id: secondary.id });
      await db.query(
        `INSERT INTO use_cases (tenant_id, account_id, name, created_by)
         VALUES ($1, $2, 'Secondary use case', $3)`,
        [tenantId, secondary.id, actor.actor_id],
      );
      await db.query(
        `INSERT INTO activities (tenant_id, type, subject, account_id, subject_type, subject_id, created_by)
         VALUES ($1, 'note', 'Secondary account note', $2, 'account', $2, $3)`,
        [tenantId, secondary.id, actor.actor_id],
      );

      const input = {
        primary_id: primary.id,
        secondary_id: secondary.id,
        idempotency_key: `account-merge-${randomUUID()}`,
        primary_expected_version: primary.row_version,
        secondary_expected_version: secondary.row_version,
      };
      const first = await accountMerge.handler(input, actor);
      const second = await accountMerge.handler(input, actor);

      assert.equal(second.primary.id, first.primary.id);
      assert.equal(second.event_id, first.event_id);
      assert.equal(first.primary.row_version, primary.row_version + 1);
      assert.deepEqual(first.merged_count, {
        contacts: 1,
        opportunities: 1,
        use_cases: 1,
        activities: 1,
      });
      assert.ok(first.primary.aliases.includes('primary-co'));
      assert.ok(first.primary.aliases.includes(secondary.domain));
      assert.ok(first.primary.aliases.includes('Duplicate Company'));
      assert.ok(first.primary.aliases.includes('duplicate-co'));
      assert.equal(await countRows(db, 'contacts', 'tenant_id = $1 AND account_id = $2', [tenantId, primary.id]), 1);
      assert.equal(await countRows(db, 'opportunities', 'tenant_id = $1 AND account_id = $2', [tenantId, primary.id]), 1);
      assert.equal(await countRows(db, 'use_cases', 'tenant_id = $1 AND account_id = $2', [tenantId, primary.id]), 1);
      assert.equal(await countRows(db, 'activities', 'tenant_id = $1 AND account_id = $2', [tenantId, primary.id]), 1);
      assert.equal(await countRows(db, 'events', 'tenant_id = $1 AND event_type = $2 AND object_id = $3', [tenantId, 'account.merged', primary.id]), 1);

      const secondaryAfter = await db.query('SELECT merged_into, row_version FROM accounts WHERE id = $1', [secondary.id]);
      assert.equal(secondaryAfter.rows[0].merged_into, primary.id);
      assert.equal(secondaryAfter.rows[0].row_version, secondary.row_version + 1);
    });
  });

  test('concurrent context supersession allows only one replacement for a current entry', async () => {
    await withMigratedSchema(async (db) => {
      const { tenantId, actor } = await seedTenantAndActor(db);
      const contact = await createContact(db, tenantId, actor.actor_id);
      const original = await contextRepo.createContextEntry(db, tenantId, {
        subject_type: 'contact',
        subject_id: contact.id,
        context_type: 'insight',
        title: 'Buying concern',
        body: 'Original belief.',
        authored_by: actor.actor_id,
      });

      const attempts = await Promise.allSettled([
        contextRepo.supersedeContextEntry(db, tenantId, original.id, {
          title: 'Buying concern',
          body: 'Replacement one.',
          authored_by: actor.actor_id,
        }),
        contextRepo.supersedeContextEntry(db, tenantId, original.id, {
          title: 'Buying concern',
          body: 'Replacement two.',
          authored_by: actor.actor_id,
        }),
      ]);

      const fulfilled = attempts.filter(result => result.status === 'fulfilled');
      const rejected = attempts.filter(result => result.status === 'rejected');
      assert.equal(fulfilled.length, 1);
      assert.equal(rejected.length, 1);
      assert.match(String(rejected[0].reason?.message ?? rejected[0].reason), /already been superseded/);

      const rows = await db.query(
        `SELECT id, is_current, supersedes_id
         FROM context_entries
         WHERE tenant_id = $1 AND subject_id = $2
         ORDER BY created_at ASC`,
        [tenantId, contact.id],
      );
      assert.equal(rows.rows.length, 2);
      assert.equal(rows.rows.filter(row => row.is_current).length, 1);
      assert.equal(rows.rows.filter(row => row.supersedes_id === original.id).length, 1);
    });
  });
}
