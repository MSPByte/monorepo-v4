import { t } from './trpc.js';
import { authRouter } from './routers/auth.js';
import { sitesRouter } from './routers/sites.js';
import { siteGroupsRouter } from './routers/site-groups.js';
import { siteProfileRouter } from './routers/site-profile.js';
import { assetsRouter } from './routers/assets.js';
import { findingsRouter } from './routers/findings.js';
import { policiesRouter } from './routers/policies.js';
import { frameworksRouter } from './routers/frameworks.js';
import { overviewRouter } from './routers/overview.js';
import { usersRouter } from './routers/users.js';
import { rolesRouter } from './routers/roles.js';
import { integrationsRouter } from './routers/integrations.js';
import { integrationLinksRouter } from './routers/integration-links.js';
import { vendorRouter } from './routers/vendor.js';
import { packagesRouter } from './routers/packages.js';
import { packageRunsRouter } from './routers/package-runs.js';
import { agentsRouter } from './routers/agents.js';
import { formsRouter } from './routers/forms.js';
import { pipelineRouter } from './routers/pipeline.js';
import { wikiRouter } from './routers/wiki.js';
import { auditRouter } from './routers/audit.js';
import { billingRouter } from './routers/billing.js';
import { entitySourcesRouter } from './routers/entity-sources.js';
import { factRulesRouter } from './routers/fact-rules.js';
import { reportsRouter } from './routers/reports.js';
import { dashboardsRouter } from './routers/dashboards.js';
import { capabilitiesRouter } from './routers/capabilities.js';

export const appRouter = t.router({
  auth: authRouter,
  overview: overviewRouter,
  findings: findingsRouter,
  sites: sitesRouter,
  siteGroups: siteGroupsRouter,
  siteProfile: siteProfileRouter,
  assets: assetsRouter,
  policies: policiesRouter,
  frameworks: frameworksRouter,
  users: usersRouter,
  roles: rolesRouter,
  integrations: integrationsRouter,
  integrationLinks: integrationLinksRouter,
  vendor: vendorRouter,
  packages: packagesRouter,
  packageRuns: packageRunsRouter,
  agents: agentsRouter,
  forms: formsRouter,
  pipeline: pipelineRouter,
  wiki: wikiRouter,
  audit: auditRouter,
  billing: billingRouter,
  entitySources: entitySourcesRouter,
  factRules: factRulesRouter,
  reports: reportsRouter,
  dashboards: dashboardsRouter,
  capabilities: capabilitiesRouter,
});

export type AppRouter = typeof appRouter;
