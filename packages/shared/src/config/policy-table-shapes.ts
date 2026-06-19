import type { SchemaFields } from "../types/schema-registry.js";
import { INTEGRATIONS } from "./integrations/index.js";
import { M365PoliciesShape } from "./integrations/microsoft-365/policies.js";

export type PolicyTableShape = {
  table: string;
  label: string;
  resourceType: string;
  targetType: "tenant" | "site" | "integration_link" | "person" | "asset" | "vendor";
  providerId?: string;
  canonicalResourceTypes?: ("person" | "asset")[];
  shape: SchemaFields;
};

export type PolicyScopeTag = {
  label: string;
  ingestPath: string;
  group: string;
};

export const PolicyScopeTags: PolicyScopeTag[] = [
  {
    label: "Integration link name",
    ingestPath: "integrationLink.name",
    group: "Integration link",
  },
  {
    label: "Integration link external ID",
    ingestPath: "integrationLink.externalId",
    group: "Integration link",
  },
  { label: "Site name", ingestPath: "site.name", group: "Site" },
];

const sourceOptions = Object.values(INTEGRATIONS).map((integration) => ({
  value: integration.id,
  label: integration.name,
}));

export const CanonicalAssetsShape: SchemaFields = {
  hostname: {
    label: "Hostname",
    type: "string",
    modality: "single",
    trackable: true,
    ingestPath: "hostname",
    required: true,
  },
  displayName: {
    label: "Display Name",
    type: "string",
    modality: "single",
    trackable: true,
    ingestPath: "displayName",
    required: false,
  },
  type: {
    label: "Asset Type",
    type: "enum",
    modality: "single",
    trackable: true,
    ingestPath: "assetType",
    required: false,
    options: [
      { value: "server", label: "Server" },
      { value: "workstation", label: "Workstation" },
      { value: "network", label: "Network" },
      { value: "mobile", label: "Mobile" },
      { value: "unknown", label: "Unknown" },
    ],
  },
  status: {
    label: "Status",
    type: "string",
    modality: "single",
    trackable: true,
    ingestPath: "status",
    required: false,
  },
  sources: {
    label: "Sources",
    type: "string",
    modality: "array",
    trackable: true,
    ingestPath: "sources",
    required: false,
    options: sourceOptions,
  },
  lastSeenAt: {
    label: "Last Seen",
    type: "string",
    modality: "single",
    trackable: true,
    ingestPath: "lastSeenAt",
    required: false,
  },
};

export const CanonicalPeopleShape: SchemaFields = {
  displayName: {
    label: "Display Name",
    type: "string",
    modality: "single",
    trackable: true,
    ingestPath: "displayName",
    required: true,
  },
  email: {
    label: "Email",
    type: "string",
    modality: "single",
    trackable: true,
    ingestPath: "email",
    required: false,
  },
  enabled: {
    label: "Status",
    type: "enum",
    modality: "single",
    trackable: true,
    ingestPath: "status",
    required: false,
    options: [
      { value: "active", label: "Active" },
      { value: "inactive", label: "Inactive" },
      { value: "unknown", label: "Unknown" },
    ],
  },
  sources: {
    label: "Sources",
    type: "string",
    modality: "array",
    trackable: true,
    ingestPath: "sources",
    required: false,
    options: sourceOptions,
  },
  type: {
    label: "Person Type",
    type: "string",
    modality: "single",
    trackable: true,
    ingestPath: "type",
    required: false,
  },
  lastSignInAt: {
    label: "Last Sign-In",
    type: "string",
    modality: "single",
    trackable: true,
    ingestPath: "lastSignInAt",
    required: false,
  },
};

export const M365IdentitiesShape: SchemaFields = {
  displayName: {
    label: "Display Name",
    type: "string",
    modality: "single",
    trackable: true,
    ingestPath: "displayName",
    required: true,
  },
  email: {
    label: "Email",
    type: "string",
    modality: "single",
    trackable: true,
    ingestPath: "email",
    required: false,
  },
  enabled: {
    label: "Enabled",
    type: "boolean",
    modality: "single",
    trackable: true,
    ingestPath: "enabled",
    required: false,
  },
  mfaEnforced: {
    label: "MFA Enforced",
    type: "boolean",
    modality: "single",
    trackable: true,
    ingestPath: "mfaEnforced",
    required: false,
  },
  userType: {
    label: "User Type",
    type: "enum",
    modality: "single",
    trackable: true,
    ingestPath: "userType",
    required: false,
    options: [
      { value: "Member", label: "Member" },
      { value: "Guest", label: "Guest" },
    ],
  },
};

export const M365DevicesShape: SchemaFields = {
  displayName: {
    label: "Display Name",
    type: "string",
    modality: "single",
    trackable: true,
    ingestPath: "displayName",
    required: true,
  },
  enabled: {
    label: "Enabled",
    type: "boolean",
    modality: "single",
    trackable: true,
    ingestPath: "enabled",
    required: false,
  },
  compliant: {
    label: "Compliant",
    type: "boolean",
    modality: "single",
    trackable: true,
    ingestPath: "compliant",
    required: false,
  },
  operatingSystem: {
    label: "Operating System",
    type: "string",
    modality: "single",
    trackable: true,
    ingestPath: "operatingSystem",
    required: false,
  },
};

export const PolicyTableShapes: PolicyTableShape[] = [
  {
    table: "assets",
    label: "Assets",
    resourceType: "asset",
    targetType: "asset",
    shape: CanonicalAssetsShape,
  },
  {
    table: "people",
    label: "People",
    resourceType: "person",
    targetType: "person",
    shape: CanonicalPeopleShape,
  },
  {
    table: "m365Identities",
    label: "M365 Identities",
    resourceType: "m365_identity",
    targetType: "vendor",
    providerId: "microsoft-365",
    canonicalResourceTypes: ["person"],
    shape: M365IdentitiesShape,
  },
  {
    table: "m365Policies",
    label: "M365 Conditional Access Policies",
    resourceType: "m365_policy",
    targetType: "vendor",
    providerId: "microsoft-365",
    shape: M365PoliciesShape,
  },
  {
    table: "m365Devices",
    label: "M365 Devices",
    resourceType: "m365_device",
    targetType: "vendor",
    providerId: "microsoft-365",
    canonicalResourceTypes: ["asset"],
    shape: M365DevicesShape,
  },
];
