import { authClient } from "@/lib/auth-client"
import {
  ensureActiveOrganization,
  listOrganizations,
} from "@/lib/auth-functions"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { useState } from "react"

export const Route = createFileRoute("/auth/organization")({
  loader: async () => {
    const organizations = await listOrganizations()

    if (organizations.length === 1) {
      await ensureActiveOrganization({
        data: {
          organizationId: organizations[0]!.id,
        },
      })
      throw redirect({ to: "/home" })
    }

    return { organizations }
  },
  component: OrganizationPage,
})

function OrganizationPage() {
  const { organizations } = Route.useLoaderData()
  const [selecting, setSelecting] = useState(false)

  async function selectOrganization(organizationId: string) {
    if (selecting) return
    setSelecting(true)
    await authClient.organization.setActive({ organizationId })
    window.location.href = "/home"
  }

  return (
    <main className="flex min-h-svh items-center justify-center px-4">
      <Card className="w-full max-w-sm rounded-lg">
        <CardHeader>
          <CardTitle>Select Organization</CardTitle>
          <CardDescription>
            Choose which organization to work in.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {organizations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No organizations are available for this account.
            </p>
          ) : (
            organizations.map((org) => (
              <Button
                key={org.id}
                variant="outline"
                className="w-full justify-start"
                disabled={selecting}
                onClick={() => selectOrganization(org.id)}
              >
                {org.name}
              </Button>
            ))
          )}
          {selecting ? (
            <p className="pt-2 text-center text-sm text-muted-foreground">
              Switching...
            </p>
          ) : null}
        </CardContent>
      </Card>
    </main>
  )
}
