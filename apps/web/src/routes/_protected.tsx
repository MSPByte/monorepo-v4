import { requireAuthContext, signOut } from "@/lib/auth-functions"
import { Button } from "@/components/ui/button"
import { Link, Outlet, createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_protected")({
  beforeLoad: async () => {
    const authContext = await requireAuthContext()

    if (authContext.state === "no_session") {
      throw redirect({ to: "/auth/login", search: { error: undefined } })
    }

    if (authContext.state === "select_org") {
      throw redirect({ to: "/auth/organization" })
    }

    if (authContext.state === "invalid") {
      await signOut()
      throw redirect({ to: "/auth/login", search: { error: "account" } })
    }

    return authContext
  },
  component: ProtectedLayout,
})

function ProtectedLayout() {
  const authContext = Route.useRouteContext()

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="flex h-14 min-h-14 items-center justify-between border-b px-6">
        <Link to="/home" className="text-lg font-semibold tracking-tight">
          MSPByte
        </Link>
        <div className="flex items-center gap-3">
          <div className="hidden text-right text-sm sm:block">
            <p className="font-medium">{authContext.user.name}</p>
            <p className="text-muted-foreground">{authContext.orgName}</p>
          </div>
          <Button asChild variant="outline">
            <a href="/auth/signout">Sign out</a>
          </Button>
        </div>
      </header>
      <Outlet />
    </div>
  )
}
