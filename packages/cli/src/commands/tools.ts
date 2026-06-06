// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { getClient } from '../client.js';

interface ToolDescription {
  name: string;
  tier?: string;
  description?: string;
  input_schema?: Record<string, unknown>;
  required?: string[];
  example?: Record<string, unknown>;
}

async function loadJsonInput(opts: { json?: string; file?: string }): Promise<Record<string, unknown>> {
  if (opts.json && opts.file) {
    throw new Error('Use either --json or --file, not both.');
  }
  if (!opts.json && !opts.file) return {};

  const raw = opts.file ? await readFile(opts.file, 'utf8') : opts.json!;
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Tool input must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

export function toolsCommand(): Command {
  const cmd = new Command('tools')
    .description('List and call CRMy MCP tools through the CLI');

  cmd.command('list')
    .description('List MCP tools available to the current actor')
    .option('--json', 'Print raw JSON')
    .option('--tier <tier>', 'Filter by tool tier')
    .option('--query <query>', 'Filter by name or description')
    .action(async (opts: { json?: boolean; tier?: string; query?: string }) => {
      const client = await getClient();
      try {
        if (!client.listTools) throw new Error('This client cannot list tools.');
        const query = String(opts.query ?? '').toLowerCase();
        const tier = opts.tier ? String(opts.tier) : '';
        const tools = (await client.listTools())
          .filter(tool => !tier || tool.tier === tier)
          .filter(tool => !query
            || tool.name.toLowerCase().includes(query)
            || String(tool.description ?? '').toLowerCase().includes(query));

        if (opts.json) {
          console.log(JSON.stringify({ data: tools, total: tools.length }, null, 2));
        } else if (tools.length === 0) {
          console.log('No tools found for the current actor.');
        } else {
          console.table(tools.map(tool => ({
            name: tool.name,
            tier: tool.tier ?? '',
            description: String(tool.description ?? '').slice(0, 90),
          })));
        }
      } finally {
        await client.close();
      }
    });

  cmd.command('call <tool_name>')
    .description('Call an MCP tool by name with JSON input')
    .option('--json <json>', 'JSON object input')
    .option('--file <path>', 'Read JSON object input from a file')
    .action(async (toolName: string, opts: { json?: string; file?: string }) => {
      const input = await loadJsonInput(opts);
      const client = await getClient();
      try {
        const result = await client.call(toolName, input);
        console.log(JSON.stringify(JSON.parse(result), null, 2));
      } finally {
        await client.close();
      }
    });

  cmd.command('describe <tool_name>')
    .description('Show a tool description, input fields, and example JSON')
    .option('--json', 'Print raw JSON including the full input schema')
    .action(async (toolName: string, opts: { json?: boolean }) => {
      const client = await getClient();
      try {
        if (!client.describeTool) throw new Error('This client cannot describe tools.');
        const tool = await client.describeTool(toolName);
        if (opts.json) {
          console.log(JSON.stringify(tool, null, 2));
          return;
        }
        printToolDescription(tool);
      } finally {
        await client.close();
      }
    });

  return cmd;
}

function printToolDescription(tool: ToolDescription): void {
  const schema = asRecord(tool.input_schema);
  const properties = asRecord(schema.properties);
  const required = new Set(tool.required ?? []);

  console.log(`\n${tool.name}`);
  if (tool.tier) console.log(`Tier: ${tool.tier}`);
  if (tool.description) console.log(`\n${tool.description}`);

  const fields = Object.entries(properties);
  if (fields.length > 0) {
    console.log('\nInput fields:');
    for (const [name, fieldSchema] of fields) {
      const field = asRecord(fieldSchema);
      const marker = required.has(name) ? 'required' : 'optional';
      const detail = fieldDescription(field);
      console.log(`  - ${name} (${marker}, ${fieldType(field)})${detail ? ` — ${detail}` : ''}`);
    }
  } else {
    console.log('\nInput fields: none');
  }

  console.log('\nExample:');
  console.log(`  crmy tools call ${tool.name} --json '${JSON.stringify(tool.example ?? {})}'`);
}

function fieldDescription(schema: Record<string, unknown>): string {
  if (typeof schema.description === 'string') return schema.description;
  if (Array.isArray(schema.enum)) return `Allowed: ${schema.enum.map(String).join(', ')}`;
  if (schema.format === 'uuid') return 'UUID';
  return '';
}

function fieldType(schema: Record<string, unknown>): string {
  if (Array.isArray(schema.enum)) return 'enum';
  if (Array.isArray(schema.anyOf)) return 'union';
  if (typeof schema.type === 'string') return schema.type;
  return 'value';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
