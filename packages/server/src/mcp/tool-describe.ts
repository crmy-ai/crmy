// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ToolDef } from './server.js';

export interface ToolDescription {
  name: string;
  tier: ToolDef['tier'];
  description: string;
  input_schema: Record<string, unknown>;
  required: string[];
  example: Record<string, unknown>;
}

/**
 * Minimal Zod-to-JSON-Schema converter for CRMy MCP tool inputs.
 * This intentionally mirrors the provider tool schema used by Workspace Agent
 * and the CLI/API tool inspection surface.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function zodToJsonSchema(schema: any): Record<string, unknown> {
  if (schema?._def) {
    const def = schema._def;
    const typeName = def.typeName;

    if (typeName === 'ZodObject') {
      const shape = typeof schema.shape === 'function' ? schema.shape() : schema.shape;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const [key, val] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(val);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const childType = (val as any)?._def?.typeName;
        if (childType !== 'ZodOptional' && childType !== 'ZodDefault') {
          required.push(key);
        }
      }

      return {
        type: 'object',
        properties,
        additionalProperties: false,
        ...(required.length > 0 ? { required } : {}),
        ...(schema.description ? { description: schema.description } : {}),
      };
    }

    if (typeName === 'ZodString') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const checks: any[] = def.checks ?? [];
      const result: Record<string, unknown> = { type: 'string' };
      for (const check of checks) {
        if (check.kind === 'min' && check.value > 0) result.minLength = check.value;
        if (check.kind === 'max') result.maxLength = check.value;
        if (check.kind === 'email') result.format = 'email';
        if (check.kind === 'uuid') result.format = 'uuid';
        if (check.kind === 'regex') result.pattern = check.regex?.source;
      }
      return { ...result, ...(schema.description ? { description: schema.description } : {}) };
    }

    if (typeName === 'ZodNumber') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const checks: any[] = def.checks ?? [];
      const result: Record<string, unknown> = {
        type: checks.some(check => check.kind === 'int') ? 'integer' : 'number',
      };
      for (const check of checks) {
        if (check.kind === 'min') result.minimum = check.value;
        if (check.kind === 'max') result.maximum = check.value;
      }
      return { ...result, ...(schema.description ? { description: schema.description } : {}) };
    }

    if (typeName === 'ZodBoolean') return { type: 'boolean', ...(schema.description ? { description: schema.description } : {}) };
    if (typeName === 'ZodEnum') return { type: 'string', enum: def.values };
    if (typeName === 'ZodNativeEnum') return { type: 'string', enum: Object.values(def.values ?? {}) };
    if (typeName === 'ZodArray') return { type: 'array', items: zodToJsonSchema(def.type) };

    if (typeName === 'ZodOptional' || typeName === 'ZodNullable') {
      return zodToJsonSchema(def.innerType);
    }

    if (typeName === 'ZodDefault') {
      return zodToJsonSchema(def.innerType);
    }

    if (typeName === 'ZodEffects' || typeName === 'ZodPipeline' || typeName === 'ZodCatch') {
      return zodToJsonSchema(def.schema ?? def.in ?? def.innerType);
    }

    if (typeName === 'ZodRecord') {
      return { type: 'object', additionalProperties: true };
    }

    if (typeName === 'ZodUnion' || typeName === 'ZodDiscriminatedUnion') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const options = (def.options ?? []).map((option: any) => zodToJsonSchema(option));
      return { anyOf: options };
    }

    if (typeName === 'ZodLiteral') {
      return { type: typeof def.value, const: def.value };
    }
  }

  return { type: 'string' };
}

export function describeTool(tool: ToolDef): ToolDescription {
  const inputSchema = zodToJsonSchema(tool.inputSchema);
  const required = Array.isArray(inputSchema.required)
    ? inputSchema.required.filter((field): field is string => typeof field === 'string')
    : [];

  return {
    name: tool.name,
    tier: tool.tier,
    description: tool.description,
    input_schema: inputSchema,
    required,
    example: buildExampleInput(inputSchema),
  };
}

function buildExampleInput(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = asRecord(schema.properties);
  const required = Array.isArray(schema.required)
    ? schema.required.filter((field): field is string => typeof field === 'string')
    : [];
  const keys = required.length > 0 ? required : Object.keys(properties).slice(0, 3);

  return Object.fromEntries(keys.map(key => [
    key,
    exampleValue(key, asRecord(properties[key])),
  ]));
}

function exampleValue(key: string, schema: Record<string, unknown>): unknown {
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return exampleValue(key, asRecord(schema.anyOf[0]));
  }

  const type = schema.type;
  if (type === 'string') return stringExample(key, schema);
  if (type === 'integer') return key === 'limit' ? 20 : 1;
  if (type === 'number') return 1;
  if (type === 'boolean') return false;
  if (type === 'array') return [];
  if (type === 'object') {
    const properties = asRecord(schema.properties);
    const required = Array.isArray(schema.required)
      ? schema.required.filter((field): field is string => typeof field === 'string')
      : [];
    return Object.fromEntries(required.map(childKey => [
      childKey,
      exampleValue(childKey, asRecord(properties[childKey])),
    ]));
  }

  return null;
}

function stringExample(key: string, schema: Record<string, unknown>): string {
  if (schema.format === 'uuid' || key === 'id' || key.endsWith('_id')) {
    return '00000000-0000-4000-8000-000000000000';
  }
  if (schema.format === 'email' || key.includes('email')) return 'customer@example.com';
  if (key === 'subject_type' || key === 'record_type' || key === 'object_type') return 'account';
  if (key === 'query' || key === 'q') return 'Northstar Labs';
  if (key === 'text' || key === 'body' || key === 'content') return 'Customer context text...';
  if (key === 'source_label') return 'CLI';
  if (key === 'idempotency_key') return 'unique-operation-key';
  if (key.includes('date') || key.endsWith('_at')) return new Date().toISOString();
  return 'string';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
