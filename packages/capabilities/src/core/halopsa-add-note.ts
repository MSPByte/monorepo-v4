import { z } from 'zod';
import { ActionLabels } from '@mspbyte/shared';
import type { Capability } from '../types.js';

// A ticket note that may also carry billable time. When minutesSpent is
// present it becomes a Halo "time-log" style action; when absent it's a
// plain note. Only the tenant-wide HaloPSA integration is required —
// there's no need for the package run's site to be linked to Halo.
const inputs = z.object({
  ticketId: z.string().trim().min(1).max(64),
  note: z.string().trim().min(1).max(12_000),
  minutesSpent: z.coerce.number().nonnegative().max(24 * 60).optional(),
  chargeable: z.boolean().default(true),
  outcome: z.string().trim().min(1).max(120).default('Note'),
});

const outputs = z.object({
  actionId: z.string(),
});

function htmlForNote(note: string): string {
  const escaped = note
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
  return `<p>${escaped.replace(/\r?\n/g, '<br>')}</p>`;
}

export const coreHaloPSATicketAddNote: Capability<
  z.infer<typeof inputs>,
  z.infer<typeof outputs>
> = {
  id: 'core.halopsa.ticket.add_note',
  vendor: 'halopsa',
  integration: { integrationId: 'halopsa', connection: 'configured' },
  name: 'Add HaloPSA Ticket Note',
  description:
    'Posts a note (optionally with tracked time) to a HaloPSA ticket. ' +
    'Wire the ticket ID from a prior Create HaloPSA Ticket step, or ask for it at run time.',
  category: 'admin',
  inputs,
  outputs,
  inputMeta: {
    ticketId: {
      allowedBindings: ['literal', 'runtime', 'priorOutput'],
      typeHint: 'text',
      label: 'Ticket',
      description: 'HaloPSA ticket ID. Wire from a Create HaloPSA Ticket step, or enter one at run time.',
      required: true,
      group: 'entry',
      order: 10,
      priorOutputCompat: ['halopsa.ticketId'],
    },
    note: {
      allowedBindings: ['literal', 'runtime', 'failureContext', 'priorOutput'],
      typeHint: 'text',
      label: 'Note',
      description: 'Technician-facing description of the update.',
      required: true,
      group: 'entry',
      order: 20,
    },
    minutesSpent: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'number',
      label: 'Minutes spent',
      description: 'Optional. When set, the note is recorded as a time entry (converted to Halo\'s decimal-hour format).',
      required: false,
      group: 'entry',
      order: 30,
    },
    chargeable: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'boolean',
      label: 'Chargeable',
      description: 'Whether tracked time is billable to the customer. Ignored when no time is logged.',
      required: false,
      advanced: true,
      group: 'entry',
      order: 40,
      defaultValue: true,
    },
    outcome: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Action outcome',
      description: 'HaloPSA action outcome name. Defaults to "Note" for plain updates; override if your tenant uses a different outcome name for tracked time.',
      required: false,
      advanced: true,
      group: 'entry',
      order: 50,
      defaultValue: 'Note',
    },
  },
  inputGroups: {
    entry: {
      label: 'Ticket update',
      description: 'The action posted to HaloPSA.',
      order: 10,
    },
  },
  outputMeta: {
    actionId: { label: 'HaloPSA action ID', outputType: 'halopsa.actionId' },
  },
  actionLabel: ActionLabels.CoreHaloPSATicketAddNote,
  auditAction: 'create',
  requiredPermission: 'Vendors.Write',
  defaultUnitPrice: 0,
  async handler(ctx, input) {
    const ticketIdNum = Number(input.ticketId);
    if (!Number.isInteger(ticketIdNum) || ticketIdNum <= 0) {
      return {
        outcome: 'fail',
        errorClass: 'invalid_input',
        message: `Ticket ID must be a positive integer (got "${input.ticketId}")`,
      };
    }

    try {
      const connector = await ctx.getHaloPSAConnectorGlobal();
      const hasTime = input.minutesSpent != null && input.minutesSpent > 0;
      const actionId = await connector.actions.create({
        ticket_id: ticketIdNum,
        outcome: input.outcome,
        note: input.note,
        note_html: htmlForNote(input.note),
        // Only include the time / chargeable fields when time is being logged,
        // so a plain note doesn't get billed as 0-hour work.
        ...(hasTime
          ? {
              timetaken: Number((input.minutesSpent! / 60).toFixed(4)),
              actionchargable: input.chargeable,
            }
          : {}),
        who: ctx.user.name ?? ctx.user.email ?? undefined,
      });
      return { outcome: 'success', outputs: { actionId } };
    } catch (error) {
      return {
        outcome: 'fail',
        errorClass: 'vendor_error',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
