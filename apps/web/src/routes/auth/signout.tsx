import { signOut } from "@/lib/auth-functions"
import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/auth/signout")({
  beforeLoad: async () => {
    await signOut()
    throw redirect({ to: "/" })
  },
})
