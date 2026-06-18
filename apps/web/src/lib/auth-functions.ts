import { getTenantServiceDbByOrgId } from "@mspbyte/drizzle-catalog"
import { roles, users } from "@mspbyte/drizzle"
import { createServerFn } from "@tanstack/react-start"
import { getRequestHeaders } from "@tanstack/react-start/server"

import { auth } from "@/lib/auth"

export const getSession = createServerFn({ method: "GET" }).handler(
  async () => {
    return auth.api.getSession({ headers: getRequestHeaders() })
  },
)

export const listOrganizations = createServerFn({ method: "GET" }).handler(
  async () => {
    const organizations = await auth.api.listOrganizations({
      headers: getRequestHeaders(),
    })

    return organizations.map((organization) => ({
      id: organization.id,
      name: organization.name,
    }))
  },
)

export const ensureActiveOrganization = createServerFn({
  method: "POST",
})
  .validator((data: { organizationId: string }) => data)
  .handler(async ({ data }) => {
    await auth.api.setActiveOrganization({
      headers: getRequestHeaders(),
      body: { organizationId: data.organizationId },
    })
  })

export const signOut = createServerFn({ method: "POST" }).handler(async () => {
  await auth.api.signOut({ headers: getRequestHeaders() }).catch(() => null)
})

export const requireAuthContext = createServerFn({ method: "GET" }).handler(
  async () => {
    const headers = getRequestHeaders()
    const session = await auth.api.getSession({ headers })

    if (!session) {
      return { state: "no_session" as const }
    }

    let authOrgId = session.session.activeOrganizationId

    if (!authOrgId) {
      const organizations = await auth.api.listOrganizations({ headers })

      if (organizations.length === 1) {
        authOrgId = organizations[0]?.id
        if (authOrgId) {
          await auth.api
            .setActiveOrganization({
              headers,
              body: { organizationId: authOrgId },
            })
            .catch(() => null)
        }
      } else {
        return { state: "select_org" as const }
      }
    }

    if (!authOrgId) {
      return { state: "invalid" as const }
    }

    const tenant = await getTenantServiceDbByOrgId(
      authOrgId,
      requiredEnv("ENCRYPTION_KEY"),
      requiredEnv("CATALOG_DATABASE_URL"),
    )

    if (!tenant || tenant.org.status !== "active") {
      return { state: "invalid" as const }
    }

    const tenantUsers = await tenant.db.select().from(users)
    const user = tenantUsers.find((row) => row.authUserId === session.user.id)

    if (!user?.roleId) {
      return { state: "invalid" as const }
    }

    const tenantRoles = await tenant.db.select().from(roles)
    const role = tenantRoles.find((row) => row.id === user.roleId)

    if (!role) {
      return { state: "invalid" as const }
    }

    return {
      state: "ok" as const,
      user: {
        id: user.id,
        authUserId: user.authUserId,
        email: user.email,
        name: user.name,
        roleId: user.roleId,
      },
      role: {
        id: role.id,
        name: role.name,
        description: role.description,
        level: role.level,
      },
      orgId: tenant.org.id,
      orgName: tenant.org.name,
      authUser: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
      },
    }
  },
)

function requiredEnv(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}
