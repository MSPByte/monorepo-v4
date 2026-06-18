"use client"

import {
  ensureActiveOrganization,
  listOrganizations,
  signOut,
} from "@/lib/auth-functions"
import {
  Avatar,
  AvatarFallback,
} from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { ArrowLeftRight, Check, Moon, Power, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { useEffect, useMemo, useState } from "react"

type OrganizationOption = {
  id: string
  name: string
}

type ProfileMenuProps = {
  userName: string
  orgId: string
  orgName: string
}

export function ProfileMenu({ userName, orgId, orgName }: ProfileMenuProps) {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [organizations, setOrganizations] = useState<OrganizationOption[]>([])
  const [loadingOrgs, setLoadingOrgs] = useState(false)
  const [switchingOrgId, setSwitchingOrgId] = useState<string | null>(null)

  const isDark = mounted && resolvedTheme === "dark"
  const initials = useMemo(() => getInitials(userName), [userName])

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!open || organizations.length > 0 || loadingOrgs) return

    setLoadingOrgs(true)
    listOrganizations()
      .then((result) => setOrganizations(result))
      .finally(() => setLoadingOrgs(false))
  }, [loadingOrgs, open, organizations.length])

  async function switchOrganization(newOrgId: string) {
    if (newOrgId === orgId || switchingOrgId) return

    setSwitchingOrgId(newOrgId)
    await ensureActiveOrganization({ data: { organizationId: newOrgId } })
    window.location.href = "/home"
  }

  async function handleSignOut() {
    await signOut()
    window.location.href = "/"
  }

  function toggleTheme() {
    setTheme(isDark ? "light" : "dark")
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <Avatar size="lg">
          <AvatarFallback className="bg-primary text-base font-medium text-primary-foreground">
            {initials}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="space-y-1">
            <span className="block truncate text-sm text-foreground">
              {userName}
            </span>
            <span className="block truncate font-normal">{orgName}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="justify-between"
            onSelect={(event) => {
              event.preventDefault()
              toggleTheme()
            }}
          >
            <span className="flex items-center gap-2">
              {isDark ? <Moon /> : <Sun />}
              {isDark ? "Dark Mode" : "Light Mode"}
            </span>
            <Switch checked={isDark} aria-label="Toggle dark mode" size="sm" />
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <ArrowLeftRight />
              Switch Org
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-56">
              {loadingOrgs ? (
                <DropdownMenuLabel>Loading organizations...</DropdownMenuLabel>
              ) : organizations.length === 0 ? (
                <DropdownMenuLabel>No organizations found</DropdownMenuLabel>
              ) : (
                organizations.map((organization) => (
                  <DropdownMenuItem
                    key={organization.id}
                    className={cn(
                      "justify-between",
                      organization.id === orgId && "font-medium",
                    )}
                    disabled={
                      Boolean(switchingOrgId) || organization.id === orgId
                    }
                    onSelect={(event) => {
                      event.preventDefault()
                      void switchOrganization(organization.id)
                    }}
                  >
                    <span className="truncate">{organization.name}</span>
                    {organization.id === orgId ? <Check /> : null}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem
            variant="destructive"
            onSelect={(event) => {
              event.preventDefault()
              void handleSignOut()
            }}
          >
            <Power />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function getInitials(name: string) {
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  return initials || "AA"
}
