// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../pool.js';
import type { UUID } from '@crmy/shared';
import { validationError } from '@crmy/shared';
import { listCustomFields, type CustomFieldRow } from './custom-fields.js';

export interface CustomFieldErrors {
  [fieldKey: string]: string;
}

/**
 * Validates custom_fields values against their definitions for a given object type.
 * - Checks unknown keys
 * - Enforces required fields (on create)
 * - Type-checks values against field_type
 * - Validates select/multi_select options
 *
 * Returns the validated (and potentially coerced) custom_fields object.
 * Throws CrmyError on validation failure.
 */
export async function validateCustomFields(
  db: DbPool,
  tenantId: UUID,
  objectType: string,
  customFields: Record<string, unknown> | undefined,
  opts: { isCreate?: boolean } = {},
): Promise<Record<string, unknown>> {
  if (!customFields || Object.keys(customFields).length === 0) {
    // On create, check for required fields even if none provided
    if (opts.isCreate) {
      const defs = await listCustomFields(db, tenantId, objectType);
      const required = defs.filter(d => d.is_required);
      if (required.length > 0) {
        const errors: CustomFieldErrors = {};
        for (const def of required) {
          errors[def.field_key] = `${def.label} is required`;
        }
        const errorList = Object.entries(errors).map(([field, message]) => ({ field, message }));
        throw validationError(`Missing required custom fields: ${required.map(d => d.label).join(', ')}`, errorList);
      }
    }
    return customFields ?? {};
  }

  const defs = await listCustomFields(db, tenantId, objectType);
  const defMap = new Map<string, CustomFieldRow>();
  for (const d of defs) {
    defMap.set(d.field_key, d);
  }

  const errors: CustomFieldErrors = {};
  const validated: Record<string, unknown> = {};

  // Check for unknown keys
  for (const key of Object.keys(customFields)) {
    if (!defMap.has(key)) {
      errors[key] = `Unknown custom field "${key}" for ${objectType}`;
      continue;
    }

    const def = defMap.get(key)!;
    const value = customFields[key];

    // Allow null to clear a field
    if (value === null || value === undefined) {
      validated[key] = null;
      continue;
    }

    const err = validateFieldValue(def, value);
    if (err) {
      errors[key] = err;
    } else {
      validated[key] = value;
    }
  }

  // Check required fields on create
  if (opts.isCreate) {
    for (const def of defs) {
      if (def.is_required && !(def.field_key in customFields)) {
        errors[def.field_key] = `${def.label} is required`;
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    const summary = Object.entries(errors).map(([k, v]) => `${k}: ${v}`).join('; ');
    const errorList = Object.entries(errors).map(([field, message]) => ({ field, message }));
    throw validationError(`Custom field validation failed: ${summary}`, errorList);
  }

  return validated;
}

function validateFieldValue(def: CustomFieldRow, value: unknown): string | null {
  switch (def.field_type) {
    case 'text':
      if (typeof value !== 'string') return `${def.label} must be a string`;
      return null;

    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) return `${def.label} must be a number`;
      return null;

    case 'boolean':
      if (typeof value !== 'boolean') return `${def.label} must be a boolean`;
      return null;

    case 'date':
      if (typeof value !== 'string') return `${def.label} must be a date string`;
      if (Number.isNaN(Date.parse(value))) return `${def.label} must be a valid date`;
      return null;

    case 'select': {
      if (typeof value !== 'string') return `${def.label} must be a string`;
      const options = parseOptions(def.options);
      if (options.length > 0 && !options.includes(value)) {
        return `${def.label} must be one of: ${options.join(', ')}`;
      }
      return null;
    }

    case 'multi_select': {
      if (!Array.isArray(value)) return `${def.label} must be an array`;
      if (!value.every(v => typeof v === 'string')) return `${def.label} must be an array of strings`;
      const options = parseOptions(def.options);
      if (options.length > 0) {
        const invalid = value.filter(v => !options.includes(v as string));
        if (invalid.length > 0) {
          return `${def.label} contains invalid options: ${invalid.join(', ')}`;
        }
      }
      return null;
    }

    default:
      return null;
  }
}

function parseOptions(options: unknown): string[] {
  if (!options) return [];
  if (Array.isArray(options)) return options.map(String);
  if (typeof options === 'string') {
    try { return JSON.parse(options); } catch { return []; }
  }
  return [];
}
