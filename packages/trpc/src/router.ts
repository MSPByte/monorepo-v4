import { t } from './trpc.js';
import { authRouter } from './routers/auth.js';
import { sitesRouter } from './routers/sites.js';
import { alertsRouter } from './routers/alerts.js';
import { complianceRouter } from './routers/compliance.js';
import { usersRouter } from './routers/users.js';
import { rolesRouter } from './routers/roles.js';
import { integrationsRouter } from './routers/integrations.js';
import { integrationLinksRouter } from './routers/integration-links.js';
import { vendorRouter } from './routers/vendor.js';
import { agentsRouter } from './routers/agents.js';
import { pipelineRouter } from './routers/pipeline.js';
import { wikiRouter } from './routers/wiki.js';
import { auditRouter } from './routers/audit.js';

export const appRouter = t.router({
  auth: authRouter,
  sites: sitesRouter,
  alerts: alertsRouter,
  compliance: complianceRouter,
  users: usersRouter,
  roles: rolesRouter,
  integrations: integrationsRouter,
  integrationLinks: integrationLinksRouter,
  vendor: vendorRouter,
  agents: agentsRouter,
  pipeline: pipelineRouter,
  wiki: wikiRouter,
  audit: auditRouter
});

export type AppRouter = typeof appRouter;
