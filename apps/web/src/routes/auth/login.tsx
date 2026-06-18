import { authClient } from "@/lib/auth-client"
import { getSession } from "@/lib/auth-functions"
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

export const Route = createFileRoute("/auth/login")({
  validateSearch: (search) => ({
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  beforeLoad: async () => {
    const session = await getSession()
    if (session) {
      throw redirect({ to: "/home" })
    }
  },
  component: LoginPage,
})

function LoginPage() {
  const search = Route.useSearch()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function signInWithMicrosoft() {
    setLoading(true)
    setError(null)

    const result = await authClient.signIn.social({
      provider: "microsoft",
      callbackURL: "/home",
      errorCallbackURL: "/auth/login",
    })

    if (result.error) {
      setError(result.error.message ?? "Unable to start Microsoft sign in.")
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center px-4">
      <Card className="w-full max-w-sm rounded-lg">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            Use your Microsoft 365 account to continue.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {search.error === "account" ? (
            <p className="text-sm text-destructive">
              Your account could not be found. Please contact your
              administrator.
            </p>
          ) : null}
          <Button
            className="w-full"
            disabled={loading}
            onClick={signInWithMicrosoft}
          >
            {loading ? "Redirecting..." : "Continue with Microsoft"}
          </Button>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>
    </main>
  )
}
