// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import fs from 'node:fs';
import { getClient } from '../client.js';

function short(id?: unknown): string {
  return typeof id === 'string' ? id.slice(0, 8) : '';
}

function parseJsonObject(value: string | undefined, label: string, required = true): Record<string, unknown> {
  if (!value) {
    if (required) throw new Error(`${label} is required. Pass JSON or @path/to/file.json`);
    return {};
  }
  const raw = value.startsWith('@')
    ? fs.readFileSync(value.slice(1), 'utf-8')
    : value;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Payload must be a JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not parse ${label} as a JSON object: ${detail}`);
  }
}

function parseJsonPayload(value?: string): Record<string, unknown> {
  return parseJsonObject(value, '--payload');
}

function parseCsv(value?: string): string[] {
  return (value ?? '').split(',').map(item => item.trim()).filter(Boolean);
}

function buildWritebackInput(systemId: string, opts: Record<string, string | boolean | undefined>): Record<string, unknown> {
  return {
    system_id: systemId,
    mapping_id: opts.mapping,
    object_type: opts.objectType,
    object_id: opts.objectId,
    external_object: opts.externalObject,
    external_record_id: opts.externalRecordId,
    operation: opts.operation,
    writeback_mode: opts.mode,
    payload: parseJsonPayload(opts.payload as string | undefined),
    require_approval: opts.noApproval ? false : true,
    idempotency_key: opts.idempotencyKey,
  };
}

export function systemsCommand(): Command {
  const cmd = new Command('systems')
    .description('Manage enterprise systems of record such as HubSpot, Salesforce, Databricks, and Snowflake');

  cmd.command('list')
    .description('List configured systems of record')
    .option('--type <type>', 'Filter by type: hubspot, salesforce, databricks, snowflake')
    .option('--status <status>', 'Filter by status')
    .action(async (opts) => {
      const client = await getClient();
      const result = await client.call('sor_system_list', {
        system_type: opts.type,
        status: opts.status,
        limit: 50,
      });
      const data = JSON.parse(result);
      if (!data.systems?.length) {
        console.log('No systems of record configured.');
        await client.close();
        return;
      }
      console.table(data.systems.map((s: Record<string, unknown>) => ({
        id: short(s.id),
        name: s.name,
        type: s.system_type,
        status: s.status,
        credentials: s.has_credentials ? 'set' : 'missing',
        last_sync: s.last_sync_at ?? '',
      })));
      await client.close();
    });

  cmd.command('test <id>')
    .description('Test a system-of-record connection')
    .action(async (id) => {
      const client = await getClient();
      const result = await client.call('sor_system_test', { id });
      console.log(JSON.stringify(JSON.parse(result), null, 2));
      await client.close();
    });

  cmd.command('discover <id>')
    .description('Discover objects or fields for a system of record')
    .option('--object <name>', 'Discover fields for one external object/table')
    .action(async (id, opts) => {
      const client = await getClient();
      const result = await client.call('sor_discover', { system_id: id, object_name: opts.object });
      console.log(JSON.stringify(JSON.parse(result), null, 2));
      await client.close();
    });

  cmd.command('mappings')
    .description('List configured object mappings')
    .option('--system <id>', 'Filter by system ID')
    .option('--object <type>', 'Filter by CRMy object type')
    .action(async (opts) => {
      const client = await getClient();
      const result = await client.call('sor_mapping_list', {
        system_id: opts.system,
        object_type: opts.object,
        limit: 100,
      });
      const data = JSON.parse(result);
      if (!data.mappings?.length) {
        console.log('No system mappings configured.');
        await client.close();
        return;
      }
      console.table(data.mappings.map((m: Record<string, unknown>) => ({
        id: short(m.id),
        system: short(m.system_id),
        object: m.object_type,
        external: m.external_object,
        authority: m.source_authority ?? 'external',
        mode: m.writeback_mode ?? '',
        writable: Array.isArray(m.writable_fields) ? m.writable_fields.length : 0,
        active: m.is_active === false ? 'no' : 'yes',
        last_sync: m.last_sync_at ?? '',
      })));
      await client.close();
    });

  cmd.command('upsert-mapping')
    .description('Create or update a system-of-record object mapping')
    .requiredOption('--system <id>', 'System ID')
    .requiredOption('--object-type <type>', 'CRMy object type: contact, account, opportunity, or activity. use_case/context_entry mappings are accepted for conflict review but are not directly synced yet.')
    .requiredOption('--external-object <name>', 'External object/table/view name')
    .requiredOption('--field-mapping <json|@file>', 'JSON object mapping CRMy fields to external fields')
    .option('--id <id>', 'Existing mapping ID to update')
    .option('--external-id-field <field>', 'External ID field', 'id')
    .option('--watermark-field <field>', 'Incremental sync watermark field')
    .option('--readable-fields <csv>', 'Extra readable external fields')
    .option('--writable-fields <csv>', 'External fields CRMy may write')
    .option('--source-authority <authority>', 'crmy, external, bidirectional, read_only, approval_required', 'external')
    .option('--writeback-mode <mode>', 'append_event, mapped_upsert, or stored_procedure')
    .option('--writeback-config <json|@file>', 'Writeback config JSON, e.g. sql_template and parameter_order')
    .option('--allow-source-loop', 'Allow sync-originated events to write back to the same source')
    .option('--inactive', 'Save mapping as inactive')
    .action(async (opts) => {
      const client = await getClient();
      const result = await client.call('sor_mapping_upsert', {
        id: opts.id,
        system_id: opts.system,
        object_type: opts.objectType,
        external_object: opts.externalObject,
        external_id_field: opts.externalIdField,
        watermark_field: opts.watermarkField,
        field_mapping: parseJsonObject(opts.fieldMapping, '--field-mapping'),
        readable_fields: parseCsv(opts.readableFields),
        writable_fields: parseCsv(opts.writableFields),
        source_authority: opts.sourceAuthority,
        writeback_mode: opts.writebackMode,
        writeback_config: parseJsonObject(opts.writebackConfig, '--writeback-config', false),
        allow_source_loop: Boolean(opts.allowSourceLoop),
        is_active: opts.inactive ? false : true,
      });
      console.log(JSON.stringify(JSON.parse(result), null, 2));
      await client.close();
    });

  cmd.command('delete-mapping <id>')
    .description('Delete a system-of-record mapping')
    .requiredOption('--yes', 'Confirm deletion')
    .action(async (id) => {
      const client = await getClient();
      const result = await client.call('sor_mapping_delete', { id });
      console.log(JSON.stringify(JSON.parse(result), null, 2));
      await client.close();
    });

  cmd.command('sync <id>')
    .description('Run a governed sync for a system of record')
    .option('--mapping <id>', 'Sync only one mapping')
    .option('--mode <mode>', 'Sync mode: incremental, full, test, replay', 'incremental')
    .action(async (id, opts) => {
      const client = await getClient();
      const result = await client.call('sor_sync_run', {
        system_id: id,
        mapping_id: opts.mapping,
        mode: opts.mode,
      });
      console.log(JSON.stringify(JSON.parse(result), null, 2));
      await client.close();
    });

  cmd.command('conflicts')
    .description('List open sync conflicts')
    .option('--system <id>', 'Filter by system ID')
    .option('--status <status>', 'Conflict status', 'open')
    .action(async (opts) => {
      const client = await getClient();
      const result = await client.call('sor_conflict_list', {
        system_id: opts.system,
        status: opts.status,
        limit: 50,
      });
      const data = JSON.parse(result);
      if (!data.conflicts?.length) {
        console.log('No sync conflicts found.');
        await client.close();
        return;
      }
      console.table(data.conflicts.map((c: Record<string, unknown>) => ({
        id: short(c.id),
        system: short(c.system_id),
        object: `${c.object_type ?? ''}:${short(c.object_id)}`,
        field: c.field_name,
        status: c.status,
        created: c.created_at,
      })));
      await client.close();
    });

  cmd.command('resolve-conflict <id>')
    .description('Resolve a sync conflict')
    .requiredOption('--resolution <resolution>', 'resolved_local, resolved_external, or ignored')
    .option('--note <note>', 'Optional resolution note')
    .action(async (id, opts) => {
      if (!['resolved_local', 'resolved_external', 'ignored'].includes(opts.resolution)) {
        throw new Error('--resolution must be resolved_local, resolved_external, or ignored');
      }
      const client = await getClient();
      const result = await client.call('sor_conflict_resolve', {
        id,
        resolution: opts.resolution,
        note: opts.note,
      });
      console.log(JSON.stringify(JSON.parse(result), null, 2));
      await client.close();
    });

  cmd.command('writebacks')
    .description('List external writeback requests')
    .option('--system <id>', 'Filter by system ID')
    .option('--status <status>', 'Filter by status')
    .action(async (opts) => {
      const client = await getClient();
      const result = await client.call('sor_writeback_status', {
        system_id: opts.system,
        status: opts.status,
        limit: 50,
      });
      const data = JSON.parse(result);
      if (!data.writebacks?.length) {
        console.log('No writeback requests found.');
        await client.close();
        return;
      }
      console.table(data.writebacks.map((w: Record<string, unknown>) => ({
        id: short(w.id),
        system: short(w.system_id),
        object: `${w.object_type ?? ''}:${short(w.object_id)}`,
        operation: w.operation,
        mode: w.writeback_mode,
        status: w.status,
        created: w.created_at,
      })));
      await client.close();
    });

  cmd.command('preview-writeback <system-id>')
    .description('Preview a governed external writeback without creating a request')
    .requiredOption('--object-type <type>', 'CRMy object type: contact, account, opportunity, or activity')
    .requiredOption('--external-object <name>', 'External object/table/procedure name')
    .requiredOption('--operation <operation>', 'create, update, upsert, append_event, or stored_procedure')
    .requiredOption('--mode <mode>', 'append_event, mapped_upsert, or stored_procedure')
    .requiredOption('--payload <json|@file>', 'JSON object payload or @path/to/payload.json')
    .option('--mapping <id>', 'Mapping ID')
    .option('--object-id <id>', 'CRMy object ID')
    .option('--external-record-id <id>', 'External record ID')
    .action(async (systemId, opts) => {
      const client = await getClient();
      const input = buildWritebackInput(systemId, opts);
      delete input.require_approval;
      delete input.idempotency_key;
      const result = await client.call('sor_writeback_preview', input);
      console.log(JSON.stringify(JSON.parse(result), null, 2));
      await client.close();
    });

  cmd.command('request-writeback <system-id>')
    .description('Create a governed external writeback request')
    .requiredOption('--object-type <type>', 'CRMy object type: contact, account, opportunity, or activity')
    .requiredOption('--external-object <name>', 'External object/table/procedure name')
    .requiredOption('--operation <operation>', 'create, update, upsert, append_event, or stored_procedure')
    .requiredOption('--mode <mode>', 'append_event, mapped_upsert, or stored_procedure')
    .requiredOption('--payload <json|@file>', 'JSON object payload or @path/to/payload.json')
    .option('--mapping <id>', 'Mapping ID')
    .option('--object-id <id>', 'CRMy object ID')
    .option('--external-record-id <id>', 'External record ID')
    .option('--no-approval', 'Do not request approval when policy allows direct execution')
    .option('--idempotency-key <key>', 'Idempotency key for retry-safe request creation')
    .action(async (systemId, opts) => {
      const client = await getClient();
      const result = await client.call('sor_writeback_request', buildWritebackInput(systemId, opts));
      console.log(JSON.stringify(JSON.parse(result), null, 2));
      await client.close();
    });

  cmd.command('execute-writeback <id>')
    .description('Execute an approved external writeback request')
    .action(async (id) => {
      const client = await getClient();
      const result = await client.call('sor_writeback_execute', { id });
      console.log(JSON.stringify(JSON.parse(result), null, 2));
      await client.close();
    });

  cmd.command('review-writeback <id>')
    .description('Approve or reject an external writeback request')
    .requiredOption('--decision <approved|rejected>', 'Review decision')
    .option('--note <note>', 'Optional review note')
    .action(async (id, opts) => {
      if (!['approved', 'rejected'].includes(opts.decision)) {
        throw new Error('--decision must be approved or rejected');
      }
      const client = await getClient();
      const result = await client.call('sor_writeback_review', { id, decision: opts.decision, note: opts.note });
      console.log(JSON.stringify(JSON.parse(result), null, 2));
      await client.close();
    });

  return cmd;
}
