import { t, authProcedure } from '../trpc.js';
import {
  mockAssets,
  mockFindings,
  mockFrameworks,
  mockPeople,
  mockPolicies,
  mockSites
} from './domain-fixtures.js';

export const overviewRouter = t.router({
  summary: authProcedure.query(() => {
    const openFindings = mockFindings.filter((finding) => finding.status !== 'resolved');
    const bySeverity = [4, 3, 2, 1].map((severity) => ({
      severity,
      count: openFindings.filter((finding) => finding.severity === severity).length
    }));

    return {
      bySeverity,
      highestPriorityFindings: [...openFindings]
        .sort((a, b) => b.severity - a.severity || b.lastSeenAt.localeCompare(a.lastSeenAt))
        .slice(0, 5),
      sitesNeedingAttention: [...mockSites]
        .sort((a, b) => b.openFindingCount - a.openFindingCount)
        .slice(0, 4),
      correlationHealth: {
        assetsWithMultipleSources: mockAssets.filter((asset) => asset.sources.length > 1).length,
        peopleWithMultipleSources: mockPeople.filter((person) => person.sources.length > 1).length,
        unmatchedSignals: 6
      },
      policyCoverage: {
        enabledPolicies: mockPolicies.filter((policy) => policy.enabled).length,
        frameworksEnabled: mockFrameworks.filter((framework) => framework.enabled).length,
        averagePassRate: Math.round(
          mockFrameworks.reduce((sum, framework) => sum + framework.passRate, 0) /
            mockFrameworks.length
        )
      },
      syncHealth: {
        healthySources: 9,
        warningSources: 2,
        failedSources: 0
      },
      recentActivity: [
        'Policy engine evaluated Microsoft 365 identity baseline',
        'Cove backup evidence refreshed for Northwind Dental',
        'Two stale assets opened for Contoso Warehouse',
        'Admin sign-in frequency policy still failing'
      ]
    };
  })
});
