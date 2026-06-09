// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

export interface ToolUxMetadata {
  /** Short product-language label used in user-facing tool/error summaries. */
  displayName?: string;
  /** Natural phrase for validation blockers, e.g. "create the contact". */
  actionPhrase?: string;
  /** Friendly message when the tool is hidden or unavailable to the agent. */
  unavailableMessage?: string;
  /** Field labels for required/invalid argument messages. */
  fieldLabels?: Record<string, string>;
}

export const COMMON_TOOL_FIELD_LABELS: Record<string, string> = {
  account_id: 'Account',
  contact_id: 'Contact',
  opportunity_id: 'Opportunity',
  use_case_id: 'Use case',
  subject_id: 'Record',
  subject_type: 'Record type',
  record_id: 'Record',
  record_type: 'Record type',
  object_type: 'Record type',
  first_name: 'First name',
  last_name: 'Last name',
  full_name: 'Name',
  email: 'Email',
  phone: 'Phone',
  name: 'Name',
  title: 'Title',
  text: 'Context',
  body: 'Body',
  body_text: 'Body',
  source_type: 'Source type',
  content_type: 'Content type',
};

export function writeToolUx(input: {
  displayName: string;
  actionPhrase: string;
  objectLabel?: string;
  fieldLabels?: Record<string, string>;
  unavailableMessage?: string;
}): ToolUxMetadata {
  const object = input.objectLabel ?? input.displayName;
  return {
    displayName: input.displayName,
    actionPhrase: input.actionPhrase,
    unavailableMessage: input.unavailableMessage
      ?? `${input.displayName} is unavailable in this session because Workspace Agent write permissions, your role, or the required provider/settings do not allow it. Offer to draft the ${object.toLowerCase()} details or route the action for review instead.`,
    fieldLabels: {
      ...COMMON_TOOL_FIELD_LABELS,
      ...input.fieldLabels,
    },
  };
}

