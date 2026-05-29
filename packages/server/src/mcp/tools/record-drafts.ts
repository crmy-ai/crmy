// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ActorContext } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ToolDef } from '../server.js';
import { previewRecordDraft, recordDraftPreviewSchema, type RecordDraftPreviewInput } from '../../services/record-drafts.js';
import { runToolOperation } from '../tool-operation.js';

export function recordDraftTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'record_draft_preview',
      tier: 'extended',
      description: 'Draft Account, Contact, Opportunity, Use Case, Activity, or Assignment fields from natural language without writing. Returns a structured preview with field rows, missing required fields, linked records, duplicate candidates, unresolved references, and Account enrichment suggestions. Use this before creating records from agent or CLI workflows.',
      inputSchema: recordDraftPreviewSchema,
      handler: async (input: RecordDraftPreviewInput, actor: ActorContext) => {
        return runToolOperation(db, actor, 'record_draft_preview', input, async () => (
          previewRecordDraft(db, actor, input)
        ));
      },
    },
  ];
}
