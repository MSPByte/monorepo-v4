import { z } from 'zod';
import { ActionLabels } from '@mspbyte/shared';
import type { Capability } from '../types.js';

const inputs = z.object({
  summary: z.string().trim().min(1).max(200),
  details: z.string().trim().min(1).max(12_000),
});

const outputs = z.object({
  ticketId: z.string(),
});

function htmlForTicket(details: string): string {
  const escaped = details
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
  return `<p>${escaped.replace(/\r?\n/g, '<br>')}</p>`;
}

export const coreHaloPSATicketCreate: Capability<
  z.infer<typeof inputs>,
  z.infer<typeof outputs>
> = {
  id: 'core.halopsa.ticket.create',
  vendor: 'halopsa',
  name: 'Create HaloPSA Ticket',
  description:
    'Creates a standard incident ticket in the HaloPSA site linked to this package run. ' +
    'Use this in an On failure lane to route a failed package to the right queue.',
  category: 'admin',
  inputs,
  outputs,
  inputMeta: {
    summary: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Ticket summary',
      description: 'The concise title shown in the HaloPSA queue.',
      required: true,
      group: 'ticket',
      order: 10,
    },
    details: {
      allowedBindings: ['literal', 'runtime', 'failureContext'],
      typeHint: 'text',
      label: 'Ticket details',
      description: 'The technician-facing context for this incident.',
      required: true,
      group: 'ticket',
      order: 20,
    },
  },
  inputGroups: {
    ticket: {
      label: 'Ticket',
      description: 'This uses the HaloPSA site connected to the package run.',
      order: 10,
    },
  },
  outputMeta: {
    ticketId: { label: 'HaloPSA ticket ID', outputType: 'halopsa.ticketId' },
  },
  actionLabel: ActionLabels.CoreHaloPSATicketCreate,
  auditAction: 'create',
  requiredPermission: 'Vendors.Write',
  defaultUnitPrice: 0,
  async handler(ctx, input) {
    try {
      const { connector, haloSiteId } = await ctx.getHaloPSAConnector();
      const ticketId = await connector.tickets.create({
        site_id: haloSiteId,
        priority_id: 4,
        files: null,
        usertype: 1,
        reportedby: ctx.user.email ?? '',
        tickettype_id: 3,
        timerinuse: false,
        itil_tickettype_id: '-1',
        tickettype_group_id: '-1',
        summary: input.summary,
        details_html: htmlForTicket(input.details),
        category_1: 'Standard - Incident',
        impact: '1',
        urgency: '5',
        donotapplytemplateintheapi: true,
        utcoffset: 300,
        form_id: 'newticket622a2b46-24eb-46b5-b5d1-4b1e6ed66834',
        dont_do_rules: true,
        return_this: false,
        phonenumber: '',
        assets: [],
      });
      return { outcome: 'success', outputs: { ticketId } };
    } catch (error) {
      return {
        outcome: 'fail',
        errorClass: 'vendor_error',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
