import { z } from 'zod';
import { ActionLabels } from '@mspbyte/shared';
import type { Capability } from '../types.js';

const IMPACT_CHOICES = [
  { value: '1', label: 'High' },
  { value: '2', label: 'Medium' },
  { value: '3', label: 'Low' },
] as const;

const URGENCY_CHOICES = [
  { value: '1', label: 'Critical' },
  { value: '2', label: 'High' },
  { value: '3', label: 'Medium' },
  { value: '4', label: 'Low' },
  { value: '5', label: 'Planning' },
] as const;

const inputs = z.object({
  summary: z.string().trim().min(1).max(200),
  details: z.string().trim().min(1).max(12_000),
  ticketTypeId: z.coerce.number().int().positive(),
  priorityId: z.coerce.number().int().positive(),
  category: z.string().trim().min(1).max(200),
  impact: z.enum(['1', '2', '3']),
  urgency: z.enum(['1', '2', '3', '4', '5']),
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
    'Creates a ticket in the HaloPSA site linked to this package run. ' +
    'Ticket type, priority, and category are picked from the connected HaloPSA instance at run time.',
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
      description: 'The technician-facing context for this ticket.',
      required: true,
      group: 'ticket',
      order: 20,
    },
    ticketTypeId: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'number',
      label: 'Ticket type',
      description: 'Chosen from the ticket types configured in your HaloPSA instance.',
      required: true,
      group: 'ticket',
      order: 30,
      dynamicSource: 'halopsaTicketTypes',
    },
    priorityId: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'number',
      label: 'Priority',
      description: 'Chosen from the priorities configured in your HaloPSA instance.',
      required: true,
      group: 'ticket',
      order: 40,
      dynamicSource: 'halopsaTicketPriorities',
    },
    category: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Category',
      description: 'Top-level ticket category (category_1 in HaloPSA).',
      required: true,
      group: 'ticket',
      order: 50,
      dynamicSource: 'halopsaTicketCategories',
    },
    impact: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Impact',
      description: 'ITIL impact level.',
      required: true,
      group: 'ticket',
      order: 60,
      choices: IMPACT_CHOICES,
      defaultValue: '2',
    },
    urgency: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Urgency',
      description: 'ITIL urgency level.',
      required: true,
      group: 'ticket',
      order: 70,
      choices: URGENCY_CHOICES,
      defaultValue: '3',
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
        priority_id: input.priorityId,
        files: null,
        usertype: 1,
        reportedby: ctx.user.email ?? '',
        tickettype_id: input.ticketTypeId,
        timerinuse: false,
        itil_tickettype_id: '-1',
        tickettype_group_id: '-1',
        summary: input.summary,
        details_html: htmlForTicket(input.details),
        category_1: input.category,
        impact: input.impact,
        urgency: input.urgency,
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
