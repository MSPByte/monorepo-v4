import { z } from 'zod';
import { ActionLabels } from '@mspbyte/shared';
import type { Capability } from '../types.js';

// Maps ISO 3166-1 alpha-2 country codes to the nearest Sophos data geography.
// Covers the full set of Sophos geography options (US, IE, DE, CA, AU, JP, IN, BR, AE).
// Used to auto-derive dataGeography when neither dataGeography nor dataRegion is supplied.
const COUNTRY_TO_GEOGRAPHY: Record<string, 'US' | 'IE' | 'DE' | 'CA' | 'AU' | 'JP' | 'IN' | 'BR' | 'AE'> = {
  // Direct matches
  US: 'US', CA: 'CA', AU: 'AU', NZ: 'AU',
  JP: 'JP', IN: 'IN', BR: 'BR',
  AE: 'AE', SA: 'AE', OM: 'AE', QA: 'AE', KW: 'AE', BH: 'AE',
  // Germany (strict GDPR) — DE, Austria, Switzerland
  DE: 'DE', AT: 'DE', CH: 'DE',
  // Ireland + remaining EEA/UK
  IE: 'IE', GB: 'IE',
  FR: 'IE', ES: 'IE', IT: 'IE', NL: 'IE', BE: 'IE', PL: 'IE',
  SE: 'IE', DK: 'IE', FI: 'IE', NO: 'IE', PT: 'IE',
  CZ: 'IE', HU: 'IE', RO: 'IE', SK: 'IE', HR: 'IE', BG: 'IE',
  LT: 'IE', LV: 'IE', EE: 'IE', SI: 'IE', LU: 'IE', MT: 'IE', CY: 'IE', GR: 'IE',
};

const DATA_GEOGRAPHY_CHOICES = [
  { value: 'US', label: 'United States' },
  { value: 'IE', label: 'Ireland' },
  { value: 'DE', label: 'Germany' },
  { value: 'CA', label: 'Canada' },
  { value: 'AU', label: 'Australia' },
  { value: 'JP', label: 'Japan' },
  { value: 'IN', label: 'India' },
  { value: 'BR', label: 'Brazil' },
  { value: 'AE', label: 'UAE' },
] as const;

const DATA_REGION_CHOICES = [
  { value: 'eu01', label: 'EU (eu01)' },
  { value: 'eu02', label: 'EU (eu02)' },
  { value: 'us01', label: 'US (us01)' },
  { value: 'us02', label: 'US (us02)' },
  { value: 'us03', label: 'US (us03)' },
  { value: 'ca01', label: 'Canada (ca01)' },
  { value: 'au01', label: 'Australia (au01)' },
  { value: 'jp01', label: 'Japan (jp01)' },
  { value: 'in01', label: 'India (in01)' },
  { value: 'br01', label: 'Brazil (br01)' },
  { value: 'ae01', label: 'UAE (ae01)' },
] as const;

const inputs = z.object({
  // MSPByte site to link the new Sophos tenant to.
  mspbyteSiteId: z.uuid(),

  // === Tenant identity ===
  sophosName: z.string().min(1).max(200),
  billingType: z.enum(['trial', 'usage', 'ordered']),

  // One of dataGeography or dataRegion is required by the API.
  dataGeography: z.enum(['US', 'IE', 'DE', 'CA', 'AU', 'JP', 'IN', 'BR', 'AE']).optional(),
  dataRegion: z.enum(['eu01', 'eu02', 'us01', 'us02', 'us03', 'ca01', 'au01', 'jp01', 'in01', 'br01', 'ae01']).optional(),

  // === Contact (required by API) ===
  contactFirstName: z.string().min(1).max(100),
  contactLastName: z.string().min(1).max(100),
  contactPhone: z.string().min(1).max(50),
  contactEmail: z.string().email().optional(),
  contactMobile: z.string().max(50).optional(),

  // === Contact address (required by API) ===
  contactAddress1: z.string().min(1).max(200),
  contactAddress2: z.string().max(200).optional(),
  contactCity: z.string().min(1).max(100),
  contactState: z.string().max(100).optional(),
  contactCountryCode: z.string().length(2),
  contactPostalCode: z.string().min(1).max(20),

  // === Admin account (optional — creates a tenant admin user) ===
  adminName: z.string().min(1).max(200).optional(),
  adminEmail: z.string().email().optional(),
  adminFirstName: z.string().max(100).optional(),
  adminLastName: z.string().max(100).optional(),

  acceptedSampleSubmission: z.boolean().optional(),
}).refine(
  (d) => !d.adminEmail || d.adminName,
  { message: 'adminName is required when adminEmail is provided', path: ['adminName'] }
);

const outputs = z.object({
  externalId: z.string(),
  name: z.string(),
  internalId: z.string(),
  sophosApiHost: z.string().optional(),
});

export const sophosCreateSite: Capability<
  z.infer<typeof inputs>,
  z.infer<typeof outputs>
> = {
  id: 'sophos.site.create',
  vendor: 'sophos-partner',
  integration: { integrationId: 'sophos-partner', connection: 'configured' },
  name: 'Create Sophos Partner Site',
  description:
    'Creates a new Sophos tenant via the Partner API and links it to an MSPByte site. ' +
    'Run core.site.provision first to establish the site. ' +
    'Credentials are loaded automatically from the configured Sophos Partner integration.',
  category: 'site',
  inputs,
  outputs,
  inputMeta: {
    mspbyteSiteId: {
      allowedBindings: ['priorOutput', 'entity', 'literal', 'runtime'],
      entityType: 'site',
      typeHint: 'text',
      label: 'MSPByte site',
      description: 'The MSPByte site to link the new Sophos tenant to.',
      required: true,
      priorOutputCompat: ['mspbyte.siteId'],
    },
    sophosName: {
      allowedBindings: ['literal', 'runtime', 'priorOutput'],
      typeHint: 'text',
      label: 'Tenant name',
      description: 'Name to assign the new Sophos tenant. Cannot be changed after creation.',
      required: true,
      priorOutputCompat: ['mspbyte.siteName'],
    },
    billingType: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Billing type',
      description: 'How the tenant is billed. Use "trial" for evaluation, "usage" for consumption-based, "ordered" for committed licensing.',
      required: true,
      choices: [
        { value: 'trial', label: 'Trial' },
        { value: 'usage', label: 'Usage (consumption-based)' },
        { value: 'ordered', label: 'Ordered (committed)' },
      ],
    },
    dataGeography: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Data geography',
      description: 'Where Sophos stores this tenant\'s data. Auto-derived from the contact country code when left blank.',
      required: false,
      choices: DATA_GEOGRAPHY_CHOICES as unknown as { value: string; label: string }[],
    },
    dataRegion: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Data region',
      description: 'Specific data region (e.g. eu02). Use instead of or alongside Data geography for precise placement.',
      required: false,
      advanced: true,
      choices: DATA_REGION_CHOICES as unknown as { value: string; label: string }[],
    },
    contactFirstName: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Contact first name',
      required: true,
    },
    contactLastName: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Contact last name',
      required: true,
    },
    contactPhone: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Contact phone',
      required: true,
    },
    contactEmail: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Contact email',
      required: false,
      advanced: true,
    },
    contactMobile: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Contact mobile',
      required: false,
      advanced: true,
    },
    contactAddress1: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Address line 1',
      required: true,
    },
    contactAddress2: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Address line 2',
      required: false,
      advanced: true,
    },
    contactPostalCode: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'postalCode',
      label: 'Postal code',
      description: 'City and country will auto-fill from this.',
      required: true,
    },
    contactCity: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'city',
      label: 'City',
      required: true,
    },
    contactState: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'state',
      label: 'State / Province',
      required: false,
      advanced: true,
    },
    contactCountryCode: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'countryCode',
      label: 'Country code',
      description: 'ISO 3166-1 alpha-2 (e.g. US, DE, AU). Auto-filled from postal code.',
      required: true,
    },
    adminName: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Admin display name',
      description: 'Creates a tenant admin account. Required if Admin email is set.',
      required: false,
      advanced: true,
    },
    adminEmail: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Admin email',
      description: 'Email for the tenant admin account. Must be unique across Sophos.',
      required: false,
      advanced: true,
    },
    adminFirstName: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Admin first name',
      required: false,
      advanced: true,
    },
    adminLastName: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Admin last name',
      required: false,
      advanced: true,
    },
    acceptedSampleSubmission: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'boolean',
      label: 'Accepted sample submission',
      description: 'Whether the tenant has accepted the Sophos sample submission agreement.',
      required: false,
      advanced: true,
    },
  },
  outputMeta: {
    externalId: { label: 'Sophos tenant ID', outputType: 'sophos.tenantId' },
    name: { label: 'Sophos tenant name', outputType: 'sophos.tenantName' },
    internalId: { label: 'Integration link ID', outputType: 'mspbyte.integrationLinkId' },
    sophosApiHost: { label: 'Sophos API host', outputType: 'sophos.apiHost' },
  },
  actionLabel: ActionLabels.SophosPartnerSiteCreate,
  auditAction: 'create',
  requiredPermission: 'Vendors.Write',
  defaultUnitPrice: 0,
  async handler(ctx, input) {
    if (input.adminEmail && !input.adminName) {
      return {
        outcome: 'fail',
        errorClass: 'invalid_input',
        message: 'adminName is required when adminEmail is provided',
      };
    }

    // Derive dataGeography from the contact country when neither geo field is provided.
    const resolvedGeography =
      input.dataGeography ??
      (!input.dataRegion
        ? (COUNTRY_TO_GEOGRAPHY[input.contactCountryCode.toUpperCase()] ?? 'US')
        : undefined);

    try {
      const connector = await ctx.getSophosPartnerConnector();

      const req = {
        name: input.sophosName,
        billingType: input.billingType,
        ...(resolvedGeography && { dataGeography: resolvedGeography }),
        ...(input.dataRegion && { dataRegion: input.dataRegion }),
        contact: {
          firstName: input.contactFirstName,
          lastName: input.contactLastName,
          phone: input.contactPhone,
          ...(input.contactEmail && { email: input.contactEmail }),
          ...(input.contactMobile && { mobile: input.contactMobile }),
          address: {
            address1: input.contactAddress1,
            ...(input.contactAddress2 && { address2: input.contactAddress2 }),
            city: input.contactCity,
            ...(input.contactState && { state: input.contactState }),
            countryCode: input.contactCountryCode,
            postalCode: input.contactPostalCode,
          },
        },
        ...(input.adminEmail && input.adminName && {
          admin: {
            name: input.adminName,
            email: input.adminEmail,
            ...(input.adminFirstName && { firstName: input.adminFirstName }),
            ...(input.adminLastName && { lastName: input.adminLastName }),
          },
        }),
        ...(input.acceptedSampleSubmission !== undefined && {
          acceptedSampleSubmission: input.acceptedSampleSubmission,
        }),
      };

      const tenant = await connector.partner.tenants.create(req);
      const apiHost = (tenant as unknown as Record<string, unknown>).apiHost as string | undefined;

      const link = await ctx.createIntegrationLink({
        siteId: input.mspbyteSiteId,
        integrationId: 'sophos-partner',
        externalId: tenant.id,
        name: tenant.name,
        status: 'active',
        meta: apiHost ? { apiHost } : undefined,
      });

      return {
        outcome: 'success',
        outputs: {
          externalId: tenant.id,
          name: tenant.name,
          internalId: link.id,
          sophosApiHost: apiHost,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      let errorClass: 'permission_denied' | 'rate_limited' | 'already_exists' | 'invalid_input' | 'vendor_error' =
        'vendor_error';
      if (message.includes(' 403') || message.toLowerCase().includes('forbidden')) errorClass = 'permission_denied';
      else if (message.includes(' 429')) errorClass = 'rate_limited';
      else if (message.includes(' 409') || message.toLowerCase().includes('already exist')) errorClass = 'already_exists';
      else if (message.includes(' 400')) errorClass = 'invalid_input';
      return {
        outcome: 'fail',
        errorClass,
        message,
        retryable: errorClass === 'rate_limited' || errorClass === 'vendor_error',
      };
    }
  },
};
