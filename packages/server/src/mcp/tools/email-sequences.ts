// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import {
  emailSequenceCreate,
  emailSequenceGet,
  emailSequenceUpdate,
  emailSequenceDelete,
  emailSequenceList,
  emailSequenceEnroll,
  emailSequenceUnenroll,
  emailSequenceEnrollmentList,
} from '@crmy/shared';
import type { ActorContext } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ToolDef } from '../server.js';
import * as seqRepo from '../../db/repos/email-sequences.js';

export function emailSequenceTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'email_sequence_create',
      description:
        'Create an email sequence (drip campaign). Steps define delay_days between sends, ' +
        'subject, and body. The sequence starts sending when contacts are enrolled.',
      inputSchema: emailSequenceCreate,
      handler: async (input: z.infer<typeof emailSequenceCreate>, actor: ActorContext) => {
        return seqRepo.createSequence(db, actor.tenant_id, {
          name: input.name,
          description: input.description,
          steps: input.steps,
          created_by: actor.actor_id,
        });
      },
    },
    {
      name: 'email_sequence_get',
      description: 'Get an email sequence by ID, including its steps.',
      inputSchema: emailSequenceGet,
      handler: async (input: z.infer<typeof emailSequenceGet>, actor: ActorContext) => {
        const seq = await seqRepo.getSequence(db, actor.tenant_id, input.id);
        return seq ?? { error: 'Sequence not found' };
      },
    },
    {
      name: 'email_sequence_update',
      description: 'Update an email sequence name, description, steps, or active status.',
      inputSchema: emailSequenceUpdate,
      handler: async (input: z.infer<typeof emailSequenceUpdate>, actor: ActorContext) => {
        const updated = await seqRepo.updateSequence(db, actor.tenant_id, input.id, input.patch);
        return updated ?? { error: 'Sequence not found' };
      },
    },
    {
      name: 'email_sequence_delete',
      description: 'Delete an email sequence. Active enrollments will be cancelled.',
      inputSchema: emailSequenceDelete,
      handler: async (input: z.infer<typeof emailSequenceDelete>, actor: ActorContext) => {
        const deleted = await seqRepo.deleteSequence(db, actor.tenant_id, input.id);
        return { deleted };
      },
    },
    {
      name: 'email_sequence_list',
      description: 'List email sequences with optional active status filter.',
      inputSchema: emailSequenceList,
      handler: async (input: z.infer<typeof emailSequenceList>, actor: ActorContext) => {
        return seqRepo.listSequences(db, actor.tenant_id, {
          is_active: input.is_active,
          limit: input.limit,
          cursor: input.cursor,
        });
      },
    },
    {
      name: 'email_sequence_enroll',
      description:
        'Enroll a contact in an email sequence. The contact will receive sequence emails ' +
        'according to the step delays. A contact can only be enrolled in a sequence once.',
      inputSchema: emailSequenceEnroll,
      handler: async (input: z.infer<typeof emailSequenceEnroll>, actor: ActorContext) => {
        try {
          return await seqRepo.enrollContact(db, actor.tenant_id, {
            sequence_id: input.sequence_id,
            contact_id: input.contact_id,
            enrolled_by: actor.actor_id,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Enrollment failed';
          if (msg.includes('unique') || msg.includes('duplicate')) {
            return { error: 'Contact is already enrolled in this sequence' };
          }
          return { error: msg };
        }
      },
    },
    {
      name: 'email_sequence_unenroll',
      description: 'Cancel an active enrollment by enrollment ID.',
      inputSchema: emailSequenceUnenroll,
      handler: async (input: z.infer<typeof emailSequenceUnenroll>, actor: ActorContext) => {
        const cancelled = await seqRepo.unenrollContact(db, actor.tenant_id, input.id);
        return { cancelled };
      },
    },
    {
      name: 'email_sequence_enrollment_list',
      description: 'List sequence enrollments filtered by sequence, contact, or status.',
      inputSchema: emailSequenceEnrollmentList,
      handler: async (input: z.infer<typeof emailSequenceEnrollmentList>, actor: ActorContext) => {
        return seqRepo.listEnrollments(db, actor.tenant_id, {
          sequence_id: input.sequence_id,
          contact_id: input.contact_id,
          status: input.status,
          limit: input.limit,
          cursor: input.cursor,
        });
      },
    },
  ];
}
