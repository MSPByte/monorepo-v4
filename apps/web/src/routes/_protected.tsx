import { requireAuthContext, signOut } from "@/lib/auth-functions"
import { ProfileMenu } from "@/components/profile-menu"
import { Link, Outlet, createFileRoute, redirect } from "@tanstack/react-router"
import type React from "react"
import {
  ClipboardList,
  ChevronDown,
  Home,
  PanelsTopLeft,
  Settings,
  SlidersHorizontal,
  Users,
  Workflow,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

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
    <div className="flex size-full flex-col bg-background">
      <header className="flex h-14 min-h-14 items-center justify-between border-b px-6">
        <div className="flex min-w-0 items-center gap-4">
          <Link to="/home" className="text-lg font-semibold tracking-tight">
            MSPByte
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            <HeaderLink to="/home" icon={Home}>
              Home
            </HeaderLink>
            <HeaderLink to="/sites" icon={PanelsTopLeft}>
              Sites
            </HeaderLink>
            <SetupMenu />
          </nav>
        </div>
        <div className="flex min-w-0 items-center gap-3">
          <div className="hidden text-right text-sm sm:block">
            <p className="max-w-48 truncate font-medium">
              {authContext.user.name}
            </p>
            <p className="max-w-48 truncate text-muted-foreground">
              {authContext.orgName}
            </p>
          </div>
          <ProfileMenu
            userName={authContext.user.name}
            orgId={authContext.orgId}
            orgName={authContext.orgName}
          />
        </div>
      </header>
      <Outlet />
    </div>
  )
}

function HeaderLink({
  to,
  icon: Icon,
  children,
}: {
  to: "/home" | "/sites"
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}) {
  return (
    <Link
      to={to}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&.active]:bg-muted [&.active]:text-foreground"
      activeOptions={{ exact: to === "/home" }}
    >
      <Icon className="size-4" />
      {children}
    </Link>
  )
}

function SetupMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            "h-8 px-2.5 text-muted-foreground hover:text-foreground"
          )}
        >
          <Settings />
          Setup
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuItem asChild>
          <Link to="/setup">
            <Settings />
            Overview
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/setup/integrations">
            <SlidersHorizontal />
            Integrations
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/setup/users">
            <Users />
            Users
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/setup/pipeline">
            <Workflow />
            Pipeline
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/setup/audit">
            <ClipboardList />
            Audit
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
