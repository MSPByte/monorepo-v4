import { getRequestEvent } from '$app/server';
import { env } from '$env/dynamic/private';
import { BETTER_AUTH_SECRET, CATALOG_DATABASE_URL } from '$env/static/private';
import { PUBLIC_API_URL } from '$env/static/public';
import { createCatalogDb } from '@mspbyte/drizzle-catalog';
import * as authSchema from '@mspbyte/drizzle-catalog/catalog';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization as organizationPlugin } from 'better-auth/plugins';
import { sveltekitCookies } from 'better-auth/svelte-kit';

const trustedOrigins = (env.BETTER_AUTH_TRUSTED_ORIGINS ?? PUBLIC_API_URL)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const betterAuthUrl = env.BETTER_AUTH_URL ?? 'http://localhost:5173';
const betterAuthHostname = new URL(betterAuthUrl).hostname;
const crossSubDomainCookieDomain =
  betterAuthHostname === 'mspbyte.pro' || betterAuthHostname.endsWith('.mspbyte.pro')
    ? 'mspbyte.pro'
    : undefined;

export const auth = betterAuth({
  secret: BETTER_AUTH_SECRET,
  baseURL: betterAuthUrl,
  trustedOrigins,
  database: drizzleAdapter(createCatalogDb(CATALOG_DATABASE_URL), {
    provider: 'pg',
    schema: authSchema,
  }),
  advanced: {
    database: {
      generateId: 'uuid',
    },
    crossSubDomainCookies: {
      enabled: Boolean(crossSubDomainCookieDomain),
      domain: crossSubDomainCookieDomain,
    },
    useSecureCookies: betterAuthUrl.startsWith('https://'),
  },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ['microsoft'],
    },
  },
  socialProviders: {
    microsoft: {
      clientId: env.MICROSOFT_AUTH_CLIENT_ID ?? '',
      clientSecret: env.MICROSOFT_AUTH_CLIENT_SECRET ?? '',
      tenantId: env.MICROSOFT_AUTH_TENANT_ID ?? 'common',
      authority: env.MICROSOFT_AUTH_AUTHORITY ?? 'https://login.microsoftonline.com',
      prompt: 'select_account',
      mapProfileToUser: (profile) => {
        return {
          email: profile.preferred_username,
          emailVerified: true,
          name: profile.name ?? profile.displayName,
        };
      },
    },
  },
  plugins: [organizationPlugin(), sveltekitCookies(getRequestEvent)],
});

export type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;
