// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Workflow variable interpolation — resolves {{path.to.value}} tokens.
 *
 * Syntax: {{namespace.field}} or {{namespace.nested.field}}
 *
 * Available namespaces built from event payload:
 *   {{event.*}}       — raw event payload top-level fields
 *   {{subject.*}}     — alias for event (triggered entity)
 *   {{contact.*}}     — payload.contact fields (if present)
 *   {{account.*}}     — payload.account fields (if present)
 *   {{opportunity.*}} — payload.opportunity fields (if present)
 *
 * Unknown paths resolve to empty string — never throws.
 */

/**
 * Replace all {{path}} tokens in a string with values from context.
 */
export function interpolate(template: string, context: Record<string, unknown>): string {
  if (!template || !template.includes('{{')) return template;
  return template.replace(/\{\{([^}]+)\}\}/g, (_, path: string) => {
    const value = getNestedPath(context, path.trim());
    return value != null ? String(value) : '';
  });
}

/**
 * Resolve all string values in an action config object using interpolation.
 * Non-string values are passed through unchanged.
 */
export function resolveConfig(
  config: Record<string, unknown>,
  context: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(config).map(([k, v]) => [
      k,
      typeof v === 'string' ? interpolate(v, context) : v,
    ]),
  );
}

/**
 * Build the variable context from an event payload.
 * The payload is the raw `afterData` / event payload from emitEvent.
 */
export function buildVariableContext(payload: unknown): Record<string, unknown> {
  const p = (payload ?? {}) as Record<string, unknown>;
  return {
    event: p,
    subject: p,
    contact: (p.contact ?? {}) as Record<string, unknown>,
    account: (p.account ?? {}) as Record<string, unknown>,
    opportunity: (p.opportunity ?? {}) as Record<string, unknown>,
  };
}

/**
 * Walk a dot-notation path through a nested object.
 * Returns undefined if any segment is missing.
 */
function getNestedPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce((cur: unknown, key: string) => {
    if (cur == null || typeof cur !== 'object') return undefined;
    return (cur as Record<string, unknown>)[key];
  }, obj);
}
