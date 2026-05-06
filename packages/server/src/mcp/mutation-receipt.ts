// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ActorContext } from '@crmy/shared';

interface MutationReceiptInput {
  objectType: string;
  objectId: string;
  rowVersion?: number;
  eventId?: number;
  sideEffects?: string[];
}

export function mutationReceipt(actor: ActorContext, input: MutationReceiptInput) {
  return {
    object_type: input.objectType,
    object_id: input.objectId,
    row_version: input.rowVersion,
    actor: {
      id: actor.actor_id,
      type: actor.actor_type,
    },
    event_id: input.eventId,
    side_effects: input.sideEffects ?? [],
  };
}
