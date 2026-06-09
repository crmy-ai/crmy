// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ActorContext } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ToolDef } from '../server.js';
import { writeToolUx } from '../tool-ux.js';
import { previewRecordDraft, recordDraftPreviewSchema, type RecordDraftPreviewInput } from '../../services/record-drafts.js';
import { runToolOperation } from '../tool-operation.js';

export function recordDraftTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'record_draft_preview',
      tier: 'extended',
      description: 'Draft Account, Contact, Opportunity, Use Case, Activity, or Assignment fields from natural language without writing. Supports create mode and edit mode for existing records. Returns a structured preview with field rows, missing required fields, linked records, duplicate candidates, unresolved references, policy blockers, and Account enrichment suggestions. Use this before creating or updating records from agent or CLI workflows.',
      inputSchema: recordDraftPreviewSchema,
      ux: writeToolUx({
        displayName: 'Draft record fields',
        actionPhrase: 'draft the record fields',
        objectLabel: 'record draft',
        unavailableMessage: 'Draft record fields is unavailable in this session because Workspace Agent write/draft permissions are not enabled for this user. Offer to collect the details manually or ask an admin to enable Workspace Agent record workflows.',
      }),
      handler: async (input: RecordDraftPreviewInput, actor: ActorContext) => {
        return runToolOperation(db, actor, 'record_draft_preview', input, async () => (
          previewRecordDraft(db, actor, input)
        ));
      },
    },
  ];
}
