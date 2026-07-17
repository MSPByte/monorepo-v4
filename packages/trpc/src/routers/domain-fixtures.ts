const now = Date.now();
const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString();

export const mockSites = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Northwind Dental',
    description: 'Primary managed tenant with Microsoft 365, Datto, Sophos, and Cove coverage.',
    openFindingCount: 9,
    assetCount: 42,
    peopleCount: 38,
    frameworkScore: 86,
    policyHealth: 82,
    sources: ['Microsoft 365', 'Datto RMM', 'Sophos', 'Cove'],
    recentActivity: ['Conditional access policy drift detected', 'Three inactive users confirmed']
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Contoso Manufacturing',
    description: 'Multi-site client with server backup and endpoint coverage policies enabled.',
    openFindingCount: 5,
    assetCount: 64,
    peopleCount: 71,
    frameworkScore: 91,
    policyHealth: 88,
    sources: ['Microsoft 365', 'Datto RMM', 'Sophos'],
    recentActivity: ['Server backup coverage improved', 'One endpoint protection gap opened']
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Contoso Warehouse',
    description: 'Warehouse devices and shared identities.',
    openFindingCount: 2,
    assetCount: 18,
    peopleCount: 12,
    frameworkScore: 78,
    policyHealth: 74,
    sources: ['Datto RMM', 'Sophos'],
    recentActivity: ['Two stale workstations require review']
  }
];

export const mockAssets = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    siteId: mockSites[0]!.id,
    hostname: 'ND-SRV-01',
    displayName: 'ND-SRV-01',
    type: 'server',
    os: 'Windows Server 2022',
    status: 'active',
    sources: ['Datto RMM', 'Sophos', 'Cove'],
    openFindingCount: 2,
    relatedPeople: ['Operations Admin'],
    vendorEvidence: ['Datto device online', 'Cove backup last success 4 days ago']
  },
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    siteId: mockSites[1]!.id,
    hostname: 'CM-WKS-144',
    displayName: 'CM-WKS-144',
    type: 'workstation',
    os: 'Windows 11 Pro',
    status: 'active',
    sources: ['Datto RMM', 'Sophos'],
    openFindingCount: 1,
    relatedPeople: ['Maya Patel'],
    vendorEvidence: ['Sophos endpoint missing MDR flag']
  },
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
    siteId: mockSites[2]!.id,
    hostname: 'CW-WKS-009',
    displayName: 'CW-WKS-009',
    type: 'workstation',
    os: 'Windows 10 Pro',
    status: 'inactive',
    sources: ['Datto RMM'],
    openFindingCount: 2,
    relatedPeople: ['Warehouse Shared'],
    vendorEvidence: ['No heartbeat for 46 days']
  }
];

export const mockPeople = [
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    siteId: mockSites[0]!.id,
    displayName: 'Avery Nguyen',
    primaryEmail: 'avery.nguyen@northwind.example',
    status: 'active',
    sources: ['Microsoft 365', 'PSA Contact'],
    openFindingCount: 2,
    relatedAssets: ['ND-LAP-022'],
    licenses: ['Microsoft 365 Business Premium'],
    vendorEvidence: ['MFA disabled', 'Last sign-in 2 hours ago']
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    siteId: mockSites[1]!.id,
    displayName: 'Maya Patel',
    primaryEmail: 'maya.patel@contoso.example',
    status: 'active',
    sources: ['Microsoft 365'],
    openFindingCount: 1,
    relatedAssets: ['CM-WKS-144'],
    licenses: [],
    vendorEvidence: ['Enabled user has no assigned license']
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
    siteId: mockSites[0]!.id,
    displayName: 'Legacy Billing',
    primaryEmail: 'legacy.billing@northwind.example',
    status: 'inactive',
    sources: ['Microsoft 365', 'PSA Contact'],
    openFindingCount: 1,
    relatedAssets: [],
    licenses: ['Exchange Online Plan 1'],
    vendorEvidence: ['No interactive sign-in for 74 days']
  }
];

export const mockPolicies = [
  {
    id: 'm365-require-mfa-enabled-users',
    name: 'Require MFA for enabled users',
    description: 'Every enabled Microsoft 365 person should have MFA enforced.',
    expectation: 'Enabled people must have at least one strong authentication method.',
    enabled: true,
    severity: 3,
    category: 'Identity',
    scope: 'Microsoft 365 identities',
    source: 'catalog',
    frameworkMembership: ['Identity Baseline'],
    openFindingCount: 2,
    lastEvaluation: daysAgo(0.1)
  },
  {
    id: 'm365-admin-ca-signin-frequency',
    name: 'Require admin sign-in frequency policy',
    description: 'A conditional access policy should enforce sign-in frequency for administrator roles.',
    expectation: 'At least one enabled CA policy targets privileged roles and requires sign-in every time.',
    enabled: true,
    severity: 4,
    category: 'Tenant Configuration',
    scope: 'Microsoft 365 tenant',
    source: 'catalog',
    frameworkMembership: ['Identity Baseline', 'CIS Microsoft 365 Preview'],
    openFindingCount: 1,
    lastEvaluation: daysAgo(0.1)
  },
  {
    id: 'server-backup-coverage',
    name: 'Servers require backup coverage',
    description: 'Every active server asset should have an active backup source.',
    expectation: 'Active server assets must have Cove or equivalent backup source coverage.',
    enabled: true,
    severity: 3,
    category: 'Backup',
    scope: 'Server assets',
    source: 'custom',
    frameworkMembership: ['Internal MSP Baseline'],
    openFindingCount: 2,
    lastEvaluation: daysAgo(0.2)
  }
];

export const mockFrameworks = [
  {
    id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
    name: 'Identity Baseline',
    description: 'Default identity controls for Microsoft 365 managed tenants.',
    enabled: true,
    policyCount: 12,
    passRate: 84,
    openFindings: 5,
    lastEvaluation: daysAgo(0.1),
    policies: [mockPolicies[0]!.id, mockPolicies[1]!.id],
    sitesAffected: [mockSites[0]!.id, mockSites[1]!.id]
  },
  {
    id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
    name: 'Internal MSP Baseline',
    description: 'Operational baseline for backup, endpoint protection, identity, and stale asset review.',
    enabled: true,
    policyCount: 28,
    passRate: 89,
    openFindings: 7,
    lastEvaluation: daysAgo(0.2),
    policies: [mockPolicies[2]!.id],
    sitesAffected: [mockSites[0]!.id, mockSites[2]!.id]
  }
];

export const mockFindings = [
  {
    id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
    title: 'Enabled user does not have MFA enforced',
    severity: 3,
    status: 'open',
    siteId: mockSites[0]!.id,
    resourceType: 'person',
    resourceId: mockPeople[0]!.id,
    policyId: mockPolicies[0]!.id,
    evidenceSummary: 'Microsoft 365 identity is enabled and mfaEnforced=false.',
    recommendation: 'Enable MFA or document an approved exception.',
    firstSeenAt: daysAgo(8),
    lastSeenAt: daysAgo(0.1),
    timeline: ['Opened after latest Microsoft 365 sync', 'Still present in current policy run'],
    vendorSources: ['Microsoft 365 identity', 'Authentication methods']
  },
  {
    id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2',
    title: 'Admin sign-in frequency policy is missing',
    severity: 4,
    status: 'open',
    siteId: mockSites[0]!.id,
    resourceType: 'integration_link',
    resourceId: mockSites[0]!.id,
    policyId: mockPolicies[1]!.id,
    evidenceSummary: 'No enabled conditional access policy matched required privileged-role controls.',
    recommendation: 'Create or enable a CA policy targeting administrator roles with every-time sign-in frequency.',
    firstSeenAt: daysAgo(4),
    lastSeenAt: daysAgo(0.1),
    timeline: ['Policy threshold failed', 'No matching CA policy found'],
    vendorSources: ['Microsoft 365 conditional access policies']
  },
  {
    id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd3',
    title: 'Active server has stale backup coverage',
    severity: 3,
    status: 'acknowledged',
    siteId: mockSites[0]!.id,
    resourceType: 'asset',
    resourceId: mockAssets[0]!.id,
    policyId: mockPolicies[2]!.id,
    evidenceSummary: 'Cove last successful backup is older than the allowed threshold.',
    recommendation: 'Investigate the Cove backup job and confirm the server is protected.',
    firstSeenAt: daysAgo(12),
    lastSeenAt: daysAgo(0.2),
    timeline: ['Technician acknowledged', 'Backup still stale in latest sync'],
    vendorSources: ['Cove endpoint', 'Datto asset']
  },
  {
    id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd4',
    title: 'Enabled user has no assigned license',
    severity: 2,
    status: 'open',
    siteId: mockSites[1]!.id,
    resourceType: 'person',
    resourceId: mockPeople[1]!.id,
    policyId: mockPolicies[0]!.id,
    evidenceSummary: 'User is enabled but assignedLicenses is empty.',
    recommendation: 'Assign the expected license or disable the account.',
    firstSeenAt: daysAgo(2),
    lastSeenAt: daysAgo(0.1),
    timeline: ['Detected after Microsoft 365 sync'],
    vendorSources: ['Microsoft 365 identity', 'Microsoft 365 licenses']
  },
  {
    id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd5',
    title: 'Workstation has not checked in recently',
    severity: 1,
    status: 'open',
    siteId: mockSites[2]!.id,
    resourceType: 'asset',
    resourceId: mockAssets[2]!.id,
    policyId: 'stale-asset-review',
    evidenceSummary: 'Datto RMM last heartbeat is 46 days old.',
    recommendation: 'Confirm whether the workstation is retired, offline, or missing agent coverage.',
    firstSeenAt: daysAgo(6),
    lastSeenAt: daysAgo(0.3),
    timeline: ['Opened by stale asset policy'],
    vendorSources: ['Datto RMM endpoint']
  }
];

export const mockReports = [
  {
    id: 'site-health-summary',
    name: 'Site Health Summary',
    description: 'Open findings, policy coverage, and source health by site.',
    category: 'Operations',
    status: 'stub'
  },
  {
    id: 'billing-reconciliation-preview',
    name: 'Billing Reconciliation Preview',
    description: 'Compare managed assets and services against expected billing signals.',
    category: 'Business',
    status: 'stub'
  },
  {
    id: 'policy-exceptions',
    name: 'Policy Exceptions',
    description: 'Acknowledged and suppressed findings grouped by policy and site.',
    category: 'Governance',
    status: 'stub'
  },
  {
    id: 'executive-summary',
    name: 'Executive Summary',
    description: 'High-level operational health and trend narrative for client reviews.',
    category: 'Executive',
    status: 'stub'
  },
  {
    id: 'stale-assets',
    name: 'Stale Assets',
    description: 'Assets with stale source signals, missing protection, or unknown status.',
    category: 'Operations',
    status: 'stub'
  },
  {
    id: 'identity-review',
    name: 'Identity Review',
    description: 'Inactive users, MFA gaps, privileged identities, and license issues.',
    category: 'Identity',
    status: 'stub'
  }
];
