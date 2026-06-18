import { createCatalogDb } from "@mspbyte/drizzle-catalog"
import * as authSchema from "@mspbyte/drizzle-catalog/catalog"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { organization as organizationPlugin } from "better-auth/plugins"
import { tanstackStartCookies } from "better-auth/tanstack-start"

const betterAuthUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000"
const betterAuthHostname = new URL(betterAuthUrl).hostname
const crossSubDomainCookieDomain =
  betterAuthHostname === "mspbyte.pro" ||
  betterAuthHostname.endsWith(".mspbyte.pro")
    ? "mspbyte.pro"
    : undefined

const trustedOrigins = (
  process.env.BETTER_AUTH_TRUSTED_ORIGINS ??
  process.env.PUBLIC_API_URL ??
  betterAuthUrl
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean)

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: betterAuthUrl,
  trustedOrigins,
  database: drizzleAdapter(createCatalogDb(process.env.CATALOG_DATABASE_URL), {
    provider: "pg",
    schema: authSchema,
  }),
  advanced: {
    database: {
      generateId: "uuid",
    },
    crossSubDomainCookies: {
      enabled: Boolean(crossSubDomainCookieDomain),
      domain: crossSubDomainCookieDomain,
    },
    useSecureCookies: betterAuthUrl.startsWith("https://"),
  },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["microsoft"],
    },
  },
  socialProviders: {
    microsoft: {
      clientId: process.env.MICROSOFT_AUTH_CLIENT_ID ?? "",
      clientSecret: process.env.MICROSOFT_AUTH_CLIENT_SECRET ?? "",
      tenantId: process.env.MICROSOFT_AUTH_TENANT_ID ?? "common",
      authority:
        process.env.MICROSOFT_AUTH_AUTHORITY ??
        "https://login.microsoftonline.com",
      prompt: "select_account",
      mapProfileToUser: (profile) => ({
        email: profile.preferred_username,
        emailVerified: true,
        name: profile.name ?? profile.displayName,
      }),
    },
  },
  plugins: [organizationPlugin(), tanstackStartCookies()],
})

export type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>
