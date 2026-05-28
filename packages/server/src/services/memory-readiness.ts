// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

export type MemoryReadinessStatus = 'ready_for_memory' | 'needs_more_detail';

export interface MemoryReadinessResult {
  readiness_status: MemoryReadinessStatus;
  readiness_blockers: string[];
  missing_details: string[];
  unmapped_details: string[];
  extraction_completeness: number;
  normalized_structured_data: Record<string, unknown>;
  validation_warnings: string[];
}

function friendlyFieldName(field: string): string {
  return field
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function normalizeEnumValue(value: string, allowed: string[]): string | null {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return allowed.find(option => option === value || option.toLowerCase() === value.toLowerCase() || option === normalized) ?? null;
}

export function evaluateMemoryReadiness(
  data: Record<string, unknown> | undefined,
  schema: Record<string, unknown> | null | undefined,
): MemoryReadinessResult {
  const structured = { ...(data ?? {}) };
  const props = schema?.properties as Record<string, { enum?: string[] }> | undefined;
  const required = Array.isArray(schema?.required) ? schema.required.map(String) : [];
  const missingDetails: string[] = [];
  const unmappedDetails: string[] = [];
  const readinessBlockers: string[] = [];
  const validationWarnings: string[] = [];

  if (!props || Object.keys(props).length === 0) {
    return {
      readiness_status: 'ready_for_memory',
      readiness_blockers: [],
      missing_details: [],
      unmapped_details: [],
      extraction_completeness: 1,
      normalized_structured_data: structured,
      validation_warnings: [],
    };
  }

  for (const field of required) {
    if (structured[field] === undefined || structured[field] === null || structured[field] === '') {
      const friendly = friendlyFieldName(field);
      missingDetails.push(friendly);
      readinessBlockers.push(`Needs ${friendly.toLowerCase()} before agents can rely on this as Memory.`);
      validationWarnings.push(`Missing ${friendly}.`);
    }
  }

  const unmappedFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(structured)) {
    if (!props[key]) {
      unmappedDetails.push(friendlyFieldName(key));
      unmappedFields[key] = value;
      delete structured[key];
      continue;
    }
    const allowed = props[key]?.enum;
    if (Array.isArray(allowed) && typeof value === 'string') {
      const normalized = normalizeEnumValue(value, allowed);
      if (normalized) {
        structured[key] = normalized;
      } else {
        const friendly = friendlyFieldName(key);
        readinessBlockers.push(`Needs a supported ${friendly.toLowerCase()} value before agents can rely on this as Memory.`);
        validationWarnings.push(`${friendly} should be one of: ${allowed.join(', ')}.`);
      }
    }
  }

  if (Object.keys(unmappedFields).length > 0) {
    structured.unmapped_details = {
      ...(structured.unmapped_details && typeof structured.unmapped_details === 'object' && !Array.isArray(structured.unmapped_details)
        ? structured.unmapped_details as Record<string, unknown>
        : {}),
      ...unmappedFields,
    };
    validationWarnings.push(`Preserved unmapped details: ${unmappedDetails.join(', ')}.`);
  }

  const presentRequired = required.filter(field => structured[field] !== undefined && structured[field] !== null && structured[field] !== '').length;
  const completeness = required.length === 0 ? 1 : Number((presentRequired / required.length).toFixed(2));
  const status: MemoryReadinessStatus = readinessBlockers.length === 0 ? 'ready_for_memory' : 'needs_more_detail';

  return {
    readiness_status: status,
    readiness_blockers: readinessBlockers,
    missing_details: missingDetails,
    unmapped_details: unmappedDetails,
    extraction_completeness: completeness,
    normalized_structured_data: structured,
    validation_warnings: validationWarnings,
  };
}

